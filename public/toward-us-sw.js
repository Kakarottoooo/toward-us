// Pinky's installed web app: notifications, plus an offline page. It never caches the app, an API response or anything
// private: the only cached file is the static /offline.html, shown when a page navigation finds no network.
const SHELL = "pinky-shell-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.add(new Request(OFFLINE, { cache: "reload" }))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== SHELL) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Page navigations go to the network as usual; only when that fails is the offline page shown. Nothing is written to a cache.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(fetch(request).catch(async () => (await caches.match(OFFLINE, { cacheName: SHELL })) || Response.error()));
});

self.addEventListener("push", (event) => {
  let payload = null;
  try { payload = event.data?.json(); } catch { payload = null; }
  // Every push must show something (Safari revokes a subscription that receives silent pushes); the body is always vague.
  const body = typeof payload?.body === "string" ? payload.body.slice(0, 160) : "Pinky";
  event.waitUntil(self.registration.showNotification("Pinky", {
    body, tag: String(payload?.tag || "toward-us-reminder").slice(0, 64), icon: "/assets/brand/pinky-icon-192.png",
    data: { url: safeDestination(payload?.url) }, renotify: false,
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = new URL(safeDestination(event.notification.data?.url), self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(destination); return existing.focus(); }
    return self.clients.openWindow(destination);
  })());
});

// Only in-app paths the server sends: a reminder view, or "/?channel=us" for news in Us.
function safeDestination(value) {
  if (typeof value !== "string" || !value.startsWith("/?")) return "/?view=reminders";
  const url = new URL(value, self.location.origin);
  if (url.origin !== self.location.origin || url.pathname !== "/") return "/?view=reminders";
  if (url.searchParams.get("channel") === "us") { const game = url.searchParams.get("game"); return game && /^[a-zA-Z0-9-]{1,80}$/.test(game) ? `/?channel=us&game=${game}` : "/?channel=us"; }
  if (!["reminders", "decide", "plans", "checkins"].includes(url.searchParams.get("view"))) return "/?view=reminders";
  const allowed = new URLSearchParams({ view: url.searchParams.get("view") });
  for (const name of ["issue", "outcome", "milestone", "reminder"]) {
    const id = url.searchParams.get(name);
    if (id && /^[a-zA-Z0-9-]{1,80}$/.test(id)) allowed.set(name, id);
  }
  return `/?${allowed}`;
}
