// This worker receives notifications only. It deliberately has no fetch/cache handler.
self.addEventListener("push", (event) => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  if (!payload || typeof payload.body !== "string") return;
  event.waitUntil(self.registration.showNotification("Toward Us", {
    body: payload.body.slice(0, 160), tag: String(payload.tag || "toward-us-reminder").slice(0, 64),
    data: { url: safeDestination(payload.url) }, renotify: false,
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

function safeDestination(value) {
  if (typeof value !== "string" || !value.startsWith("/?")) return "/?view=reminders";
  const url = new URL(value, self.location.origin);
  if (url.origin !== self.location.origin || url.pathname !== "/" || !["reminders", "decide", "plans", "checkins"].includes(url.searchParams.get("view"))) return "/?view=reminders";
  const allowed = new URLSearchParams({ view: url.searchParams.get("view") });
  for (const name of ["issue", "outcome", "milestone", "reminder"]) {
    const id = url.searchParams.get(name);
    if (id && /^[a-zA-Z0-9-]{1,80}$/.test(id)) allowed.set(name, id);
  }
  return `/?${allowed}`;
}
