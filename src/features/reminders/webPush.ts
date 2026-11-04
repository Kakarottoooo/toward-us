// Pinky as an installed web app (no App Store needed): the service worker, the install prompt and browser push. Nothing here
// may throw into React, and nothing runs inside the Capacitor App, whose own push lives in nativePush.ts.
import { nativePushPlugin } from "./nativePush";

const DEVICE_KEY = "toward-us-push-device";
const WORKER = "/toward-us-sw.js";
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice?: Promise<{ outcome: string }> };
type Settings = { configured: boolean; enabled: boolean; publicKey: string; devices: Array<{ id: string }> };

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string | null) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage may be unavailable */ } };
const json = async <T,>(path: string, init: RequestInit = {}) => {
  const response = await fetch(path, { credentials: "same-origin", ...init, headers: init.body ? { "content-type": "application/json" } : undefined });
  if (!response.ok) throw new Error(String(response.status));
  return (response.status === 204 ? {} : await response.json().catch(() => ({}))) as T;
};

export const isStandalone = () => { try { return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true; } catch { return false; } };
export const isIOS = () => { try { return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); } catch { return false; } };
// WeChat, Facebook, Instagram, LINE and similar in-app browsers cannot add to the Home Screen; Safari can.
export const inAppBrowser = () => { try { return /MicroMessenger|FBAN|FBAV|Instagram|Line\/|WeiBo|QQ\//i.test(navigator.userAgent); } catch { return false; } };

// Chrome fires this once, early, often before any screen that offers installing is mounted: keep it for later.
let installPrompt: InstallPrompt | null = null;
const installListeners = new Set<() => void>();
try {
  window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); installPrompt = event as InstallPrompt; installListeners.forEach((listener) => listener()); });
  window.addEventListener("appinstalled", () => { installPrompt = null; installListeners.forEach((listener) => listener()); });
} catch { /* not a browser */ }
export const canPromptInstall = () => Boolean(installPrompt);
export function onInstallPromptChange(listener: () => void) { installListeners.add(listener); return () => { installListeners.delete(listener); }; }
export async function promptInstall() {
  const prompt = installPrompt; installPrompt = null;
  if (!prompt) return false;
  try { await prompt.prompt(); return (await prompt.userChoice)?.outcome === "accepted"; } catch { return false; }
}

/** Registers the worker so the web app is installable and works offline (an offline page only). Production builds only. */
export function registerAppWorker() {
  try {
    if (!import.meta.env.PROD || nativePushPlugin() || !window.isSecureContext || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register(WORKER, { scope: "/" }).catch(() => {});
  } catch { /* best effort */ }
}

/** "ready" when this browser can take push now; "install" on iPhone/iPad before Pinky is on the Home Screen (iOS 16.4+ only
 * delivers web push to installed web apps); "unsupported" otherwise. */
export function webPushSupport(): "ready" | "install" | "unsupported" {
  try {
    if (nativePushPlugin()) return "unsupported";
    const capable = window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (isIOS() && !isStandalone()) return "install";
    return capable ? "ready" : "unsupported";
  } catch { return "unsupported"; }
}

/** Whether this browser (not another one the member connected) receives this account's pushes. */
export const thisBrowserConnected = (devices: Array<{ id: string }> | undefined) => { const id = read(DEVICE_KEY); return Boolean(id && devices?.some((device) => device.id === id)); };

function applicationServerKey(publicKey: string) {
  const base64 = publicKey.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(publicKey.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

/** Call straight from a tap: Safari only shows the permission prompt inside a user gesture, so it is asked first. */
export async function enableWebPush({ timezone, language }: { timezone: string; language: string }): Promise<"registered" | "denied" | "install" | "unsupported" | "failed"> {
  const support = webPushSupport();
  if (support !== "ready") return support;
  try {
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") return "denied";
    const settings = await json<Settings>("/api/reminder-settings");
    if (!settings.configured || !settings.publicKey) return "unsupported";
    const registration = await navigator.serviceWorker.register(WORKER, { scope: "/" });
    await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(settings.publicKey) });
    const device = await json<{ id: string }>("/api/push-subscriptions", { method: "POST", body: JSON.stringify(subscription.toJSON()) });
    write(DEVICE_KEY, device.id);
    await json("/api/reminder-settings", { method: "PATCH", body: JSON.stringify({ enabled: true, timezone, language }) });
    return "registered";
  } catch { return "failed"; }
}

/** App start while signed in: a browser that was connected hands its (possibly rotated) subscription over again. Never prompts. */
export async function restoreWebPush() {
  try {
    if (webPushSupport() !== "ready" || Notification.permission !== "granted" || !read(DEVICE_KEY)) return;
    const subscription = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
    if (!subscription) return;
    const device = await json<{ id: string }>("/api/push-subscriptions", { method: "POST", body: JSON.stringify(subscription.toJSON()) });
    write(DEVICE_KEY, device.id);
  } catch { /* best effort */ }
}

/** Sign-out: this browser stops receiving this account's pushes. */
export async function disableWebPush() {
  try {
    const id = read(DEVICE_KEY); write(DEVICE_KEY, null);
    if (!id || nativePushPlugin()) return;
    await fetch(`/api/push-subscriptions/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" }).catch(() => {});
    await (await (await navigator.serviceWorker?.getRegistration("/"))?.pushManager.getSubscription())?.unsubscribe();
  } catch { /* sign-out must still proceed */ }
}
