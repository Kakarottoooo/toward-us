import { AsyncLocalStorage } from "node:async_hooks";

// The model call being served right now: which feature it is for, whose it is, and whether the cost controls asked for a
// cheaper model (soft limit) or exempted it (safety and consent paths). Set by ai-ledger's runAiFeature around one feature
// call; the provider adapters read it when they record a ledger row.
const calls = new AsyncLocalStorage();

export const currentAiCall = () => calls.getStore() || null;
export const runInAiCall = (call, work) => calls.run(call, work);
/** True while serving a call the caps must never block (a safety signal, or a consent step). */
export const isExemptAiCall = () => Boolean(calls.getStore()?.exempt);
