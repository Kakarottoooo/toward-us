import { randomUUID } from "node:crypto";

// "Do what you said": now and then, Pinky asks one member privately how a promise from their agreements is going. The
// answer is kept on their private session only; telling the partner is a separate, confirmed message.
const WEEK = 7 * 86_400_000;
const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;

/** Active shared commitments this member is responsible for, with their own latest private answer. */
export async function openPromises(store, userId, session) {
  const context = await store.getRelationshipContext(userId);
  if (!(context?.relationship.status === "active" && context.members.length === 2)) return [];
  const role = context.members.find((member) => member.userId === userId)?.role?.toLowerCase();
  const answers = session?.promiseLog || [];
  return (await store.listRelationshipRecordsForUser("commitments", userId))
    .filter((item) => item.relationshipId === context.relationship.id && item.visibility === "shared" && item.status === "active" && !item.archivedAt && (item.ownerType === "both" || item.ownerType === `member_${role}`))
    .map((item) => { const last = answers.filter((entry) => entry.commitmentId === item.id).at(-1); return { id: item.id, description: String(item.description || ""), dueAt: item.dueAt || null, createdAt: item.createdAt, lastAnswer: last ? { done: last.done, at: last.at } : null }; });
}

/** At most one question a day, and per promise at most once a week (or when its due date has come). Returns the updated session or null. */
export async function askAboutPromise(store, { userId, session, now = new Date() }) {
  if (!session || session.channel || session.status !== "active") return null;
  const today = now.toISOString().slice(0, 10), asked = session.promiseChecks || {};
  // One Pinky question a day in Just me: the after-date question (date-checks.mjs) counts too.
  if ([...Object.values(asked), ...Object.values(session.dateChecks || {}), ...(session.knowYouAt ? [session.knowYouAt] : [])].some((at) => String(at).slice(0, 10) === today)) return null;
  const due = (await openPromises(store, userId, session)).filter((promise) => {
    const last = asked[promise.id] ? Date.parse(asked[promise.id]) : null;
    if (promise.dueAt && Date.parse(promise.dueAt) <= now.getTime() && (!last || last < Date.parse(promise.dueAt))) return true;
    return last ? now.getTime() - last >= WEEK : now.getTime() - Date.parse(promise.createdAt) >= 2 * 86_400_000;
  }).sort((a, b) => (a.dueAt || "9999").localeCompare(b.dueAt || "9999"));
  const promise = due[0]; if (!promise) return null;
  const language = session.language || "zh";
  const text = say(language, `你们约定里，你答应的“${promise.description}”，最近做到了吗？`, `In your agreement you said you'd "${promise.description}". How has it gone lately?`, `En su acuerdo dijiste que harías «${promise.description}». ¿Cómo te ha ido últimamente?`);
  return store.transaction("reminder-delivery", (tx) => tx.updateRelationshipRecordForUser("privateAgentThreads", session.id, userId, (draft) => {
    if (Object.values(draft.promiseChecks || {}).some((at) => String(at).slice(0, 10) === today)) return;
    draft.messages = [...draft.messages, { id: randomUUID(), role: "assistant", text, promiseCheck: { commitmentId: promise.id }, createdAt: now.toISOString() }].slice(-200);
    draft.promiseChecks = { ...(draft.promiseChecks || {}), [promise.id]: now.toISOString() }; draft.version += 1;
  }));
}
