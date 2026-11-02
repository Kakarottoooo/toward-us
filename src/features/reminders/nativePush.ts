// Inside the Capacitor shell (server.url loads this web app) the native push plugin is reached through Capacitor's global
// bridge; in an ordinary browser every function here is a no-op.
type Listener = { remove: () => Promise<void> };
type PushPlugin = {
  checkPermissions(): Promise<{ receive: string }>; requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>; unregister?(): Promise<void>;
  addListener(event: string, callback: (data: any) => void): Promise<Listener>;
};
type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string; Plugins?: { PushNotifications?: PushPlugin } };
const TOKEN_KEY = "toward-us-native-push-token";
const ASKED_KEY = "toward-us-native-push-asked";
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string | null) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage may be unavailable */ } };
const capacitor = () => (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
const platform = () => capacitor()?.getPlatform?.() === "ios" ? "ios" : "android";
export function nativePushPlugin() { const cap = capacitor(); return cap?.isNativePlatform?.() ? cap.Plugins?.PushNotifications || null : null; }

let tapsBound = false;
// Tapping a notification opens the in-app path it carries; only same-origin paths are followed.
export function listenNativePushTaps() {
  const plugin = nativePushPlugin(); if (!plugin || tapsBound) return; tapsBound = true;
  void plugin.addListener("pushNotificationActionPerformed", ({ notification }) => {
    const url = notification?.data?.url;
    if (typeof url === "string" && url.startsWith("/") && !url.startsWith("//")) location.assign(url);
  }).catch(() => {});
}

// Called from a user action: right after sign-in (once per sign-in) or from the reminders panel (`force`). The permission prompt
// only appears when the server can actually send; an App built without Firebase config must never reach register().
export async function enableNativePush({ force = false } = {}): Promise<"unsupported" | "off" | "denied" | "registered" | "failed"> {
  const plugin = nativePushPlugin(); if (!plugin) return "unsupported";
  if (!force && read(ASKED_KEY)) return "off";
  const settings = await fetch("/api/reminder-settings", { credentials: "same-origin" }).then((response) => response.ok ? response.json() : null).catch(() => null);
  if (!settings?.nativeConfigured) return "off";
  write(ASKED_KEY, "1");
  try {
    let permission = (await plugin.checkPermissions()).receive;
    if (permission !== "granted") permission = (await plugin.requestPermissions()).receive;
    if (permission !== "granted") return "denied";
    const token = await new Promise<string>((resolve) => {
      const handles: Array<Promise<Listener>> = [];
      const done = (value: string) => { clearTimeout(timer); handles.forEach((handle) => void handle.then((listener) => listener.remove()).catch(() => {})); resolve(value); };
      const timer = setTimeout(() => done(""), 15_000);
      handles.push(plugin.addListener("registration", ({ value }) => done(typeof value === "string" ? value : "")));
      handles.push(plugin.addListener("registrationError", () => done("")));
      plugin.register().catch(() => done(""));
    });
    // iOS must hand over a Firebase token: a raw APNs hex token cannot be addressed through FCM.
    if (!token || (platform() === "ios" && /^[a-f0-9]+$/i.test(token))) return "failed";
    const response = await fetch("/api/push/native-devices", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, platform: platform() }) });
    if (!response.ok) return "failed";
    write(TOKEN_KEY, token); return "registered";
  } catch { return "failed"; }
}

// Sign-out: this phone stops receiving this account's pushes; the next sign-in may ask again.
export async function disableNativePush() {
  const plugin = nativePushPlugin(), token = read(TOKEN_KEY);
  write(ASKED_KEY, null);
  if (!plugin || !token) return;
  await fetch("/api/push/native-devices", { method: "DELETE", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => {});
  write(TOKEN_KEY, null);
  await plugin.unregister?.().catch(() => {});
}
