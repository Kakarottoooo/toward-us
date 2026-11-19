import { DRAFTS, OUTBOX, read, write } from "./feedbackStorage";
import { voiceKeys, startFeedbackVoiceDelivery } from "./feedbackVoiceQueue";
export type FeedbackKind = "bug" | "suggestion" | "other";
export type FeedbackDraft = {
  text: string;
  kind: FeedbackKind;
  images: File[];
  activity?: string;
  context: Record<string, unknown>;
};
export type PendingFeedback = FeedbackDraft & {
  owner: string;
  id: string;
  created: number;
  retryAt: number;
  attempts: number;
  failure?: "network" | "rate" | "image" | "session" | "rejected";
};

export const deliveryEvent = "feedback-delivery";
export function clearFeedbackForDeletedAccount(owner: string) {
  return write([DRAFTS, OUTBOX], tx => {
    tx.objectStore(DRAFTS).delete(owner);
    tx.objectStore(DRAFTS).delete(voiceKeys(owner));
    const store = tx.objectStore(OUTBOX);
    const keys = store.index("owner").getAllKeys(owner);
    keys.onsuccess = () => { for (const key of keys.result) store.delete(key); };
  });
}
export const readDraft = (owner: string) => read<FeedbackDraft | undefined>(DRAFTS, (store) => store.get(owner));
export const saveDraft = (owner: string, draft: FeedbackDraft, inserted: string[] = []) => write([DRAFTS], (tx) => {
  const drafts = tx.objectStore(DRAFTS);
  drafts.put(draft, owner);
  for (const id of inserted) drafts.delete([owner, id]);
});
export const pendingFeedback = (owner: string) => read<PendingFeedback[]>(OUTBOX, (store) => store.index("owner").getAll(owner));
function notify(owner: string, sent = false) {
  window.dispatchEvent(new CustomEvent(deliveryEvent, { detail: { owner, sent } }));
  if (sent) window.dispatchEvent(new Event("feedback-updated"));
}
export async function enqueueFeedback(owner: string, draft: FeedbackDraft) {
  const item: PendingFeedback = { ...draft, owner, id: crypto.randomUUID(), created: Date.now(), retryAt: 0, attempts: 0 };
  // Keep the draft and its Files until the entire queued submission is durable.
  await write([DRAFTS, OUTBOX], (tx) => {
    const clips = tx.objectStore(DRAFTS).count(voiceKeys(owner));
    clips.onsuccess = () => { if (clips.result) tx.abort(); };
    tx.objectStore(OUTBOX).add(item);
    tx.objectStore(DRAFTS).delete(owner);
  });
  notify(owner);
}
export async function retryFeedback(owner: string, id: string) {
  await write([OUTBOX], (tx) => {
    const store = tx.objectStore(OUTBOX);
    const request = store.get([owner, id]);
    request.onsuccess = () => {
      if (request.result) store.put({ ...request.result, failure: undefined, retryAt: 0 });
    };
  });
  notify(owner);
}
export async function discardFailedFeedback(owner: string, id: string) {
  await write([OUTBOX], (tx) => {
    const store = tx.objectStore(OUTBOX);
    const request = store.get([owner, id]);
    request.onsuccess = () => { if (request.result?.failure) store.delete([owner, id]); };
  });
  notify(owner);
}

async function deliver(item: PendingFeedback, signal: AbortSignal) {
  const body = new FormData();
  body.append("payload", JSON.stringify({
    owner_ref: item.owner, client_id: item.id, kind: item.kind, text: item.text.trim(),
    context: item.context, include_activity: item.activity !== undefined, activity: item.activity,
  }));
  for (const file of item.images) body.append("images", file, "screenshot");
  let response: Response | undefined;
  let received = false;
  try {
    response = await fetch("/api/feedback", { method: "POST", credentials: "same-origin", body, signal });
    if (response.ok) received = typeof (await response.json()).id === "string";
  } catch { /* The server may already have committed; reuse this client_id. */ }
  if (signal.aborted) return;
  if (received) {
    await write([OUTBOX], (tx) => { tx.objectStore(OUTBOX).delete([item.owner, item.id]); });
    notify(item.owner, true);
    return;
  }
  const status = response?.status;
  const attempts = item.attempts + 1;
  const backoff = Math.min(300, 5 * 2 ** Math.min(attempts - 1, 6));
  let failure: PendingFeedback["failure"] = "network";
  let retryAt = Date.now() + backoff * 1000;
  if (status === 429) {
    const delay = Number(response?.headers.get("Retry-After"));
    failure = "rate"; retryAt = Date.now() + (delay > 0 ? delay : 600) * 1000;
  } else if (status && status >= 400 && status < 500 && status !== 408) {
    failure = [401, 403, 409].includes(status) ? "session" : [413, 415, 422].includes(status) ? "image" : "rejected";
    retryAt = Infinity;
  }
  // A second tab may have already delivered or discarded the same item.
  await write([OUTBOX], (tx) => {
    const store = tx.objectStore(OUTBOX);
    const request = store.get([item.owner, item.id]);
    request.onsuccess = () => { if (request.result) store.put({ ...request.result, attempts, retryAt, failure }); };
  });
  notify(item.owner);
}

// Mounted by the authenticated app shell, so the feedback screen may be closed during retries.
export function startFeedbackDelivery(owner: string) {
  const stopVoice = startFeedbackVoiceDelivery(owner);
  const controller = new AbortController();
  let busy = false, dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    if (busy) { dirty = true; return; }
    if (controller.signal.aborted || !navigator.onLine) return;
    busy = true;
    clearTimeout(timer);
    try {
      do {
        dirty = false;
        const items = (await pendingFeedback(owner)).sort((a, b) => a.created - b.created);
        let next = Infinity;
        for (const item of items) {
          if (controller.signal.aborted || !navigator.onLine) return;
          if (item.retryAt > Date.now()) { next = Math.min(next, item.retryAt); continue; }
          await deliver(item, controller.signal);
        }
        if (Number.isFinite(next)) {
          clearTimeout(timer);
          timer = setTimeout(() => void run(), Math.max(50, next - Date.now()));
        }
      } while (dirty && !controller.signal.aborted && navigator.onLine);
    } catch {
      // IndexedDB can be temporarily unavailable on resume.
      if (!controller.signal.aborted) timer = setTimeout(() => void run(), 30_000);
    } finally { busy = false; }
  };
  const changed = (event: Event) => { if ((event as CustomEvent).detail.owner === owner) void run(); };
  const wake = () => { void run(); };
  window.addEventListener(deliveryEvent, changed);
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", wake);
  void run();
  return () => {
    stopVoice(); controller.abort(); clearTimeout(timer);
    window.removeEventListener(deliveryEvent, changed);
    window.removeEventListener("online", wake);
    document.removeEventListener("visibilitychange", wake);
  };
}
