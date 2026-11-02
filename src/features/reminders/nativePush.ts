// Inside the Capacitor shell (server.url loads this web app) the native push plugin is reached through Capacitor's global
// bridge; in an ordinary browser every function here is a no-op. Nothing here may ever throw into React: a push problem must
// not take the App down, so every native call is wrapped.
// The bridge-generated plugin proxy returns `{ remove }` synchronously from addListener (the npm wrapper returns a Promise).
type Listener = { remove: () => unknown };
type PushPlugin = {
  checkPermissions(): Promise<{ receive: string }>; requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>; unregister?(): Promise<void>;
  addListener(event: string, callback: (data: any) => void): Listener | Promise<Listener>;
};
type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string; Plugins?: { PushNotifications?: PushPlugin } };
const TOKEN_KEY = "toward-us-native-push-token";
const ASKED_KEY = "toward-us-native-push-asked";
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string | null) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage may be unavailable */ } };
const capacitor = () => { try { return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor; } catch { return undefined; } };
const platform = () => capacitor()?.getPlatform?.() === "ios" ? "ios" : "android";
// Normalizes both listener shapes and any synchronous throw into a Promise.
const listen = (plugin: PushPlugin, event: string, callback: (data: any) => void) => Promise.resolve().then(() => plugin.addListener(event, callback));
const drop = (handle: Promise<Listener>) => { void handle.then((listener) => listener?.remove?.()).catch(() => {}); };
export function nativePushPlugin() { try { const cap = capacitor(); return cap?.isNativePlatform?.() ? cap.Plugins?.PushNotifications || null : null; } catch { return null; } }
export const nativePushRegistered = () => Boolean(nativePushPlugin() && read(TOKEN_KEY));
const nativeConfigured = async () => Boolean((await fetch("/api/reminder-settings", { credentials: "same-origin" }).then((response) => response.ok ? response.json() : null).catch(() => null))?.nativeConfigured);

let tapsBound = false;
// Tapping a notification opens the in-app path it carries; only same-origin paths are followed.
export function listenNativePushTaps() {
  try {
    const plugin = nativePushPlugin(); if (!plugin || tapsBound) return; tapsBound = true;
    listen(plugin, "pushNotificationActionPerformed", (event) => {
      const url = event?.notification?.data?.url;
      if (typeof url === "string" && url.startsWith("/") && !url.startsWith("//")) location.assign(url);
    }).catch(() => {});
  } catch { /* never break the app over push */ }
}

// Asks the OS for a token and hands it to the server. Resolves "" on any failure or after 15s.
async function registerToken(plugin: PushPlugin): Promise<"registered" | "failed"> {
  const token = await new Promise<string>((resolve) => {
    const handles: Array<Promise<Listener>> = [];
    let settled = false;
    const done = (value: string) => { if (settled) return; settled = true; clearTimeout(timer); handles.forEach(drop); resolve(value); };
    const timer = setTimeout(() => done(""), 15_000);
    handles.push(listen(plugin, "registration", (event) => done(typeof event?.value === "string" ? event.value : "")));
    handles.push(listen(plugin, "registrationError", () => done("")));
    handles.forEach((handle) => handle.catch(() => done("")));
    Promise.all(handles).then(() => plugin.register()).catch(() => done(""));
  });
  // iOS must hand over a Firebase token: a raw APNs hex token cannot be addressed through FCM.
  if (!token || (platform() === "ios" && /^[a-f0-9]+$/i.test(token))) return "failed";
  const response = await fetch("/api/push/native-devices", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, platform: platform() }) }).catch(() => null);
  if (!response?.ok) return "failed";
  write(TOKEN_KEY, token); return "registered";
}

// Called from a user action: right after sign-in (once per sign-in) or from the reminders panel (`force`). The permission prompt
// only appears when the server can actually send; an App built without Firebase config must never reach register().
export async function enableNativePush({ force = false } = {}): Promise<"unsupported" | "off" | "denied" | "registered" | "failed"> {
  try {
    const plugin = nativePushPlugin(); if (!plugin) return "unsupported";
    if (!force && read(ASKED_KEY)) return "off";
    if (!await nativeConfigured()) return "off";
    write(ASKED_KEY, "1");
    let permission = (await plugin.checkPermissions()).receive;
    if (permission !== "granted") permission = (await plugin.requestPermissions()).receive;
    if (permission !== "granted") return "denied";
    return await registerToken(plugin);
  } catch { return "failed"; }
}

// App start while signed in: tokens rotate, so an existing opt-in is refreshed silently. Never prompts.
export async function restoreNativePush() {
  try {
    const plugin = nativePushPlugin(); if (!plugin) return;
    if ((await plugin.checkPermissions()).receive !== "granted" || !await nativeConfigured()) return;
    await registerToken(plugin);
  } catch { /* best effort */ }
}

// Sign-out: this phone stops receiving this account's pushes; the next sign-in may ask again.
export async function disableNativePush() {
  try {
    const plugin = nativePushPlugin(), token = read(TOKEN_KEY);
    write(ASKED_KEY, null);
    if (!plugin || !token) return;
    await fetch("/api/push/native-devices", { method: "DELETE", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => {});
    write(TOKEN_KEY, null);
    await Promise.resolve().then(() => plugin.unregister?.()).catch(() => {});
  } catch { /* sign-out must still proceed */ }
}
