// One connection to /api/relationship/events for the whole signed-in session, shared by every screen that listens.
// Screens used to open and close their own on every change of screen; now the connection stays while anyone listens and
// for a short while after, so moving between screens never reconnects.
const EVENTS_URL = "/api/relationship/events";
const LINGER_MS = 30_000;
let source: EventSource | null = null;
let listeners = 0;
let closing = 0;

function open() {
  window.clearTimeout(closing);
  if (source) return source;
  source = new EventSource(EVENTS_URL);
  // Access ended for this account: every listener hears it, then the connection closes for good.
  source.addEventListener("access-ended", () => window.setTimeout(closeRelationshipEvents));
  return source;
}

/** Listens on the shared connection; `close()` stops this listener only. A "ready" listener added after the connection
 * opened hears "ready" straight away, as a fresh connection would have told it. */
export function relationshipEvents() {
  const shared = open();
  const added: Array<[string, EventListener]> = [];
  let closed = false;
  listeners += 1;
  return {
    addEventListener(type: string, handler: EventListener) {
      if (closed) return;
      added.push([type, handler]);
      shared.addEventListener(type, handler);
      if (type === "ready" && shared.readyState === EventSource.OPEN) queueMicrotask(() => { if (!closed && source === shared) handler(new MessageEvent("ready", { data: JSON.stringify({ eventType: "ready" }) })); });
    },
    close() {
      if (closed) return;
      closed = true;
      for (const [type, handler] of added) shared.removeEventListener(type, handler);
      listeners -= 1;
      if (!listeners && source === shared) closing = window.setTimeout(closeRelationshipEvents, LINGER_MS);
    },
  };
}

/** Closes the shared connection now, as on sign-out. */
export function closeRelationshipEvents() {
  window.clearTimeout(closing);
  source?.close();
  source = null;
}
