import type { Language } from "../../i18n";
import { DRAFTS, read, write } from "./feedbackStorage";

type VoiceFailure = "failed" | "network" | "consent" | "session" | "rate";
export type VoiceTake = {
  id: string;
  created: number;
  base: string;
  position: number;
  language: Language;
  transcript?: string;
  failure?: VoiceFailure;
  retryAt?: number;
};
type StoredTake = VoiceTake & { audio?: Blob };

// String keys hold text drafts. Compound keys hold temporary takes for the same account.
export const voiceKeys = (owner: string) => IDBKeyRange.bound([owner], [owner, []]);
export const voiceEvent = "feedback-voice-changed";
const active = new Map<string, { id: string; request: AbortController }>();
export const transcribingId = (owner: string) => active.get(owner)?.id;
let broadcast: BroadcastChannel | undefined;
try { broadcast = new BroadcastChannel("ourever-feedback-voice"); } catch { /* Single-window browsers share updates in-page. */ }
const announce = (owner: string) => window.dispatchEvent(new CustomEvent(voiceEvent, { detail: owner }));
if (broadcast) broadcast.onmessage = event => { if (typeof event.data === "string") announce(event.data); };
export function notifyVoice(owner: string) { announce(owner); broadcast?.postMessage(owner); }

const storedTakes = async (owner: string) => (await read<StoredTake[]>(DRAFTS, s => s.getAll(voiceKeys(owner))))
  .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
export async function listVoiceTakes(owner: string): Promise<VoiceTake[]> {
  return (await storedTakes(owner)).map(({ audio: _audio, ...take }) => take);
}
export async function keepVoiceTake(owner: string, take: VoiceTake, audio: Blob) {
  await write([DRAFTS], tx => { tx.objectStore(DRAFTS).put({ ...take, audio }, [owner, take.id]); });
  notifyVoice(owner);
}
async function updateTake(owner: string, id: string, update: (take: StoredTake) => StoredTake) {
  await write([DRAFTS], tx => {
    const store = tx.objectStore(DRAFTS);
    const get = store.get([owner, id]);
    get.onsuccess = () => { if (get.result?.audio) store.put(update(get.result), [owner, id]); };
  });
  notifyVoice(owner);
}
export async function discardVoiceTake(owner: string, id: string) {
  if (active.get(owner)?.id === id) active.get(owner)?.request.abort();
  await write([DRAFTS], tx => { tx.objectStore(DRAFTS).delete([owner, id]); });
  notifyVoice(owner);
}
export const retryVoiceTake = (owner: string, id: string) =>
  updateTake(owner, id, take => ({ ...take, failure: undefined, retryAt: undefined }));

async function transcribe(owner: string, take: StoredTake, signal: AbortSignal) {
  if (!take.audio) return;
  const request = new AbortController();
  const abort = () => request.abort();
  signal.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; request.abort(); }, 120_000);
  active.set(owner, { id: take.id, request });
  announce(owner);
  try {
    const body = new FormData();
    body.set("owner_ref", owner);
    body.set("language", take.language);
    body.set("audio", take.audio, "feedback.wav");
    const response = await fetch("/api/feedback/voice", { method: "POST", credentials: "same-origin", cache: "no-store", body, signal: request.signal });
    const result = await response.json().catch(() => ({}));
    if (request.signal.aborted) return;
    if (response.ok && typeof result.text === "string" && result.text.trim()) {
      await updateTake(owner, take.id, ({ audio: _audio, ...rest }) => ({ ...rest, transcript: result.text.trim() }));
    } else {
      const consent = result.code === "ai_consent_required" || result.error === "ai_consent_required";
      const failure: VoiceFailure = response.status === 429 ? "rate" : consent ? "consent" :
        [401, 403, 409].includes(response.status) ? "session" : "failed";
      const retryAt = failure === "rate" ? Date.now() + 1000 * (Number(response.headers.get("Retry-After")) || 600) : undefined;
      await updateTake(owner, take.id, record => ({ ...record, failure, retryAt }));
    }
  } catch {
    if (timedOut || !request.signal.aborted) await updateTake(owner, take.id, record => ({ ...record, failure: "network" }));
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    if (active.get(owner)?.request === request) active.delete(owner);
    announce(owner);
  }
}

// A signed-in shell can finish an offline take even after the feedback form closes.
export function startFeedbackVoiceDelivery(owner: string) {
  const controller = new AbortController();
  let busy = false, again = false, reconnect = false;
  const drain = async () => {
    const retryNetwork = reconnect;
    reconnect = false;
    for (const take of await storedTakes(owner)) {
      if (controller.signal.aborted || !navigator.onLine) return;
      if (!take.audio) continue;
      if (take.failure && !(take.failure === "network" && retryNetwork)) break;
      await transcribe(owner, take, controller.signal);
      // Re-read the head after every submission. A failed take pauses the queue until retry/discard.
      again = true;
      break;
    }
  };
  const run = async () => {
    if (busy) { again = true; return; }
    if (controller.signal.aborted || !navigator.onLine) return;
    busy = true;
    try {
      do {
        again = false;
        if (navigator.locks) await navigator.locks.request("feedback-voice-" + owner, { signal: controller.signal }, drain);
        else await drain();
      } while (again && !controller.signal.aborted && navigator.onLine);
    } catch { /* A future visibility or online event can reopen local storage. */ }
    finally { busy = false; }
  };
  const changed = (event: Event) => { if ((event as CustomEvent).detail === owner) void run(); };
  const online = () => { reconnect = true; void run(); };
  const visible = () => { if (!document.hidden) void run(); };
  window.addEventListener(voiceEvent, changed);
  window.addEventListener("online", online);
  document.addEventListener("visibilitychange", visible);
  online();
  return () => {
    controller.abort();
    window.removeEventListener(voiceEvent, changed);
    window.removeEventListener("online", online);
    document.removeEventListener("visibilitychange", visible);
  };
}

// Move the insertion point past edits made while the take was offline or transcribing.
export function insertVoiceText(current: string, take: VoiceTake) {
  const { base } = take;
  let pos = Math.min(take.position, base.length);
  if (base !== current) {
    let start = 0, before = base.length, after = current.length;
    while (start < before && start < after && base[start] === current[start]) start++;
    while (before > start && after > start && base[before - 1] === current[after - 1]) { before--; after--; }
    if (pos >= before) pos += after - before;
    else if (pos > start) pos = after;
  }
  const left = current.slice(0, pos), right = current.slice(pos);
  const spoken = take.transcript || "";
  const latinStart = /^[\p{Script=Latin}\p{N}]/u, latinEnd = /[\p{Script=Latin}\p{N}.!?]$/u;
  const prefix = latinEnd.test(left) && latinStart.test(spoken) ? " " : "";
  const suffix = latinEnd.test(spoken) && latinStart.test(right) ? " " : "";
  return { text: left + prefix + spoken + suffix + right, caret: pos + prefix.length + spoken.length + suffix.length };
}
