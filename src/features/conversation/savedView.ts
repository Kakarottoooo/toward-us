// The conversation last shown, kept so opening Ourever (or coming back from another page) draws it at once and refreshes
// underneath, like any messaging app (founder 11-26: "把软件关掉重新开启的时候还是会这个样子"). It lives in memory and,
// trimmed to the latest lines, on this device only for the signed-in member; signing out or deleting the account clears it.
const PREFIX = "ourever.view:";
const KEEP = 60, MAX_CHARS = 1_500_000, MAX_AGE_MS = 30 * 86_400_000;

type View = { userId: string; session: unknown; together: unknown };
let memory: View | null = null;

const trimmed = <T>(value: T, pick: (value: T) => unknown[] | undefined, put: (value: T, list: unknown[]) => T): T => {
  const list = value ? pick(value) : undefined;
  return list && list.length > KEEP ? put(value, list.slice(-KEEP)) : value;
};

export function readView(userId: string): View | null {
  if (memory?.userId === userId) return memory;
  try {
    const saved = JSON.parse(localStorage.getItem(PREFIX + userId) || "null");
    if (!saved || saved.userId !== userId || !(Date.now() - Number(saved.at) < MAX_AGE_MS)) return null;
    memory = { userId, session: saved.session ?? null, together: saved.together ?? null };
    return memory;
  } catch { return null; }
}

let timer: number | undefined, quietUntil = 0;
export function saveView(userId: string, part: { session?: unknown; together?: unknown }) {
  // Right after signing out, a reply still on its way must not put the conversation back on the device.
  if (Date.now() < quietUntil) return;
  const base = memory?.userId === userId ? memory : { userId, session: null, together: null };
  memory = { ...base, ...part };
  // At most one write per 800ms, and always one: a busy conversation (receipts, status polls) must not keep postponing it.
  if (timer === undefined) timer = window.setTimeout(flush, 800);
}

function flush() {
  timer = undefined;
  if (!memory) return;
  const { userId } = memory;
  {
    const session = trimmed(memory.session as { messages?: unknown[] } | null, (value) => value?.messages, (value, messages) => ({ ...value!, messages }));
    const together = trimmed(memory.together as { conversation?: { messages?: unknown[] } } | null, (value) => value?.conversation?.messages,
      (value, messages) => ({ ...value!, conversation: { ...value!.conversation!, messages } }));
    try {
      const text = JSON.stringify({ userId, at: Date.now(), session, together });
      if (text.length <= MAX_CHARS) localStorage.setItem(PREFIX + userId, text);
    } catch { /* storage full or private mode: the in-memory copy still helps */ }
  }
}
// Leaving the App (switching away, locking the phone, closing the tab) saves at once.
if (typeof window !== "undefined") {
  const now = () => { if (timer !== undefined) { window.clearTimeout(timer); flush(); } };
  window.addEventListener("pagehide", now);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") now(); });
}

/** Signing out or deleting the account: nothing of the conversation stays on this device. */
export function forgetViews() {
  memory = null; window.clearTimeout(timer); timer = undefined; quietUntil = Date.now() + 5000;
  try { for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) localStorage.removeItem(key); } catch { /* nothing stored */ }
}
