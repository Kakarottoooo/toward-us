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
type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string; Plugins?: { PushNotifications?: PushPlugin; App?: { addListener(event: string, callback: (event: { url: string }) => void): Listener | Promise<Listener> } } };
const TOKEN_KEY = "toward-us-native-push-token";
const OFF_KEY = "toward-us-native-push-off";
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string | null) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage may be unavailable */ } };
const capacitor = () => { try { return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor; } catch { return undefined; } };
export const inNativeApp = () => capacitor()?.isNativePlatform?.() === true;
const platform = () => capacitor()?.getPlatform?.() === "ios" ? "ios" : "android";
// Normalizes both listener shapes and any synchronous throw into a Promise.
const listen = (plugin: PushPlugin, event: string, callback: (data: any) => void) => Promise.resolve().then(() => plugin.addListener(event, callback));
const drop = (handle: Promise<Listener>) => { void handle.then((listener) => listener?.remove?.()).catch(() => {}); };
export function nativePushPlugin() { try { const cap = capacitor(); return cap?.isNativePlatform?.() && (platform() !== "ios" || Boolean(cap.Plugins?.App)) ? cap.Plugins?.PushNotifications || null : null; } catch { return null; } }
export const nativePushRegistered = () => Boolean(nativePushPlugin() && read(TOKEN_KEY));
export type NativeSettings = { nativeProviders?: { apns: boolean; fcm: boolean }; nativeConfigured?: boolean };
export const nativePushAvailable = (settings?: NativeSettings | null) => Boolean(nativePushPlugin() &&
  (platform() === "ios" ? settings?.nativeProviders?.apns : settings?.nativeProviders?.fcm ?? settings?.nativeConfigured));
const nativeConfigured = async () => nativePushAvailable(await fetch("/api/reminder-settings", { credentials: "same-origin" })
  .then((response) => response.ok ? response.json() : null).catch(() => null));
export const nativePermission = async () => (await nativePushPlugin()?.checkPermissions().catch(() => null))?.receive;

let invitesBound = false;
export function listenNativeInviteLinks() {
  const app = capacitor()?.Plugins?.App;
  if (!app || !inNativeApp() || invitesBound) return;
  invitesBound = true;
  // SceneDelegateProxy delivers both cold-start and warm universal links. App retains the event
  // until this listener is ready; replaying getLaunchUrl on each web reload would reopen old invites.
  Promise.resolve(app.addListener("appUrlOpen", ({ url }) => {
    let target: URL;
    try { target = new URL(url); } catch { return; }
    const invite = target.searchParams.get("invite") || "";
    if (target.origin !== "https://toward-us-private-beta.onrender.com" || target.pathname !== "/" || !/^[A-Z0-9]{8}$/i.test(invite)) return;
    location.assign("/?invite=" + encodeURIComponent(invite.toUpperCase()));
  })).catch(() => { invitesBound = false; });
}

let tapsBound = false;
// Tapping a notification opens the in-app path it carries; only same-origin paths are followed.
export function listenNativePushTaps() {
  try {
    const plugin = nativePushPlugin(); if (!plugin || tapsBound) return; tapsBound = true;
    listen(plugin, "pushNotificationActionPerformed", (event) => {
      const url = event?.notification?.data?.url;
      if (event?.actionId === "dismiss" || typeof url !== "string" || !url.startsWith("/")) return;
      const target = new URL(url, location.origin);
      if (target.origin === location.origin && target.pathname === "/") location.assign(target.href);
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
  if (!token) return "failed";
  const provider = platform() === "ios" ? "apns" : "fcm";
  const response = await fetch("/api/push/native-devices", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, platform: platform(), provider }) }).catch(() => null);
  if (!response?.ok) return "failed";
  write(TOKEN_KEY, token); return "registered";
}

// Serialize device-token changes with sign-out so a refresh cannot reattach the old account.
let pending: Promise<unknown> = Promise.resolve();
function sequential<T>(operation: () => Promise<T>) {
  const next = pending.then(operation, operation);
  pending = next.catch(() => {});
  return next;
}

// The system prompt follows an explicit tap on the explanation card.
export function enableNativePush() {
  return sequential(async (): Promise<"unsupported" | "off" | "denied" | "registered" | "failed"> => {
    try {
      const plugin = nativePushPlugin(); if (!plugin) return "unsupported";
      if (!await nativeConfigured()) return "off";
      let permission = (await plugin.checkPermissions()).receive;
      if (permission === "denied") return "denied";
      if (permission !== "granted") permission = (await plugin.requestPermissions()).receive;
      if (permission !== "granted") return "denied";
      const status = await registerToken(plugin);
      if (status === "registered") write(OFF_KEY, null);
      return status;
    } catch { return "failed"; }
  });
}

// App start while signed in: tokens rotate, so an existing opt-in is refreshed silently. Never prompts.
export function restoreNativePush() {
  return sequential(async () => {
    try {
      const plugin = nativePushPlugin(); if (!plugin) return;
      if (read(OFF_KEY) || (await plugin.checkPermissions()).receive !== "granted" || !await nativeConfigured()) return;
      await registerToken(plugin);
    } catch { /* best effort */ }
  });
}

// Explicit disconnection reports a failure. At sign-out, unregister at the OS even if offline.
export function disableNativePush(requireRemoval = false) {
  return sequential(async () => {
    const plugin = nativePushPlugin(), token = read(TOKEN_KEY);
    if (!plugin || !token) return;
    const response = await fetch("/api/push/native-devices", {
      method: "DELETE", credentials: "same-origin",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ token }),
    }).catch(() => null);
    if (requireRemoval && !response?.ok) throw new Error("push_disconnect_failed");
    write(OFF_KEY, "1"); write(TOKEN_KEY, null);
    await Promise.resolve().then(() => plugin.unregister?.()).catch(() => {});
  });
}
