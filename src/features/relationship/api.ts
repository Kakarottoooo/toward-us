import { currentLanguage, apiErrorCode, apiErrorText } from "../../i18n";

// Pages that open from the menu show what they showed last time at once and refresh underneath (founder 11-26: "所有的页面
// 都必须要流畅到秒开"). Only these reads are kept, for the signed-in member, in memory and on this device; any change the
// member makes (a non-GET request) drops them so a page never shows something they just changed back to them; signing out
// or deleting the account clears them (forgetViews). A page learns of fresher data through onFresh.
const CACHED = [/^\/api\/relationship\/home\?/, /^\/api\/spaces$/, /^\/api\/checkins$/, /^\/api\/profile\?/, /^\/api\/play-week\?/, /^\/api\/referrals\/me$/, /^\/api\/feedback\/mine$/];
const STORE = "ourever.api:", MAX_CHARS = 1_500_000;
let cacheUser = "", cache = new Map<string, unknown>(), saving: number | undefined, quietUntil = 0;
const refreshing = new Set<string>();
const cacheable = (path: string, options: RequestInit) => Boolean(cacheUser) && (options.method || "GET").toUpperCase() === "GET" && CACHED.some((re) => re.test(path));
/** The member whose reads may be kept; called when the signed-in member is known (null when signed out). */
export function setApiCacheUser(userId: string | null) {
  if ((userId || "") === cacheUser) return;
  cacheUser = userId || ""; cache = new Map();
  if (!cacheUser) return;
  try { const saved = JSON.parse(localStorage.getItem(STORE + cacheUser) || "null"); if (saved && typeof saved === "object") cache = new Map(Object.entries(saved)); } catch { /* nothing kept */ }
}
/** Signing out or deleting the account: no kept reads stay in memory or on the device. */
export function forgetApiCache() {
  cache = new Map(); cacheUser = ""; window.clearTimeout(saving); saving = undefined; quietUntil = Date.now() + 5000;
  try { for (const key of Object.keys(localStorage)) if (key.startsWith(STORE)) localStorage.removeItem(key); } catch { /* nothing stored */ }
}
const persist = () => {
  if (saving !== undefined || !cacheUser) return;
  saving = window.setTimeout(() => {
    saving = undefined;
    try { const text = JSON.stringify(Object.fromEntries(cache)); if (text.length <= MAX_CHARS) localStorage.setItem(STORE + cacheUser, text); else localStorage.removeItem(STORE + cacheUser); } catch { /* full or private */ }
  }, 600);
};
// Leaving the App (switching away, locking the phone, closing it) writes at once, so a quick close keeps the pages.
if (typeof window !== "undefined") {
  const now = () => {
    if (saving === undefined || !cacheUser) return;
    window.clearTimeout(saving); saving = undefined;
    try { const text = JSON.stringify(Object.fromEntries(cache)); if (text.length <= MAX_CHARS) localStorage.setItem(STORE + cacheUser, text); } catch { /* full or private */ }
  };
  window.addEventListener("pagehide", now);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") now(); });
}
const forget = () => { if (!cache.size) return; cache = new Map(); try { localStorage.removeItem(STORE + cacheUser); } catch { /* nothing stored */ } };
/** What a page showed last time, synchronously, so its first frame already has it (undefined when nothing is kept). */
export function peekApi<T>(path: string): T | undefined { return cacheable(path, {}) ? cache.get(path) as T | undefined : undefined; }
/** Calls back when a kept read has fresher data than the page was given; returns the unsubscribe. */
export function onFresh(test: (path: string) => boolean, reload: () => void) {
  const listener = (event: Event) => { if (test((event as CustomEvent<string>).detail)) reload(); };
  window.addEventListener("ourever:fresh", listener);
  return () => window.removeEventListener("ourever:fresh", listener);
}
/** Fetches the reads the menu's pages open with, in the background, so even a first tap shows them at once. */
export function prefetchPages(paths: string[]) {
  for (const path of paths) if (cacheUser && !cache.has(path)) void relationshipApi(path).catch(() => {});
}

export async function relationshipApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (cacheable(path, options) && cache.has(path)) {
    // Shown at once; the network answer replaces it in the background and tells the page if it changed.
    if (!refreshing.has(path)) {
      refreshing.add(path);
      const user = cacheUser, before = JSON.stringify(cache.get(path));
      void network<T>(path, { ...options, signal: undefined }).then((fresh) => {
        if (user !== cacheUser || Date.now() < quietUntil) return;
        cache.set(path, fresh); persist();
        if (JSON.stringify(fresh) !== before) window.dispatchEvent(new CustomEvent("ourever:fresh", { detail: path }));
      }).catch(() => {}).finally(() => refreshing.delete(path));
    }
    return cache.get(path) as T;
  }
  const result = await network<T>(path, options);
  if (cacheable(path, options) && Date.now() >= quietUntil) { cache.set(path, result); persist(); }
  // Chat traffic (messages, receipts, status) never changes these pages directly; a page still refreshes underneath on open.
  else if ((options.method || "GET").toUpperCase() !== "GET" && !/^\/api\/(together|assistant|agent|me\/language|push|metrics)\b/.test(path)) forget();
  return result;
}

async function network<T>(path: string, options: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers },
  }).catch(error => {
    if (error instanceof TypeError) throw new Error(apiErrorText({ code: "network_unavailable" }, 0, currentLanguage()));
    throw error;
  });
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  // A Chinese server message never reaches an English or Spanish screen.
  if (!response.ok && payload.code === "ai_daily_limit" && payload.upgrade === true && !payload.background) window.dispatchEvent(new Event("ourever:free-limit"));
  if (!response.ok) throw Object.assign(new Error(apiErrorText(payload, response.status, currentLanguage())), { status: response.status, code: apiErrorCode(payload, response.status) });
  return payload as T;
}

export const jsonBody = (value: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(value) });
