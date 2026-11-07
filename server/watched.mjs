import { addSpaceItem, ensureWatchedSpace, updateSpaceItem, WATCHED } from "./space-domain.mjs";
import { appendTogetherMessage, togetherI18n } from "./together-domain.mjs";
import { decisionError } from "./agreement-actions.mjs";

// 看完了吗 (founder 11-07): streaming apps never tell Pinky what a couple watched, so the day after a plan to watch something
// together (a milestone whose notes are "watch:<title>", made by Pinky in Us), Pinky asks once in Us whether they finished
// it. One tap answers for both: "看完了" puts it on their "watched together" shelf with that day; "还没" keeps it for later.
export const WATCH_HOUR = 10;
const PLAN = /^watch:(.+)$/s;
const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;
const dayBefore = (day) => new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const same = (a, b) => String(a || "").replace(/[《》"“”「」\s]/g, "").toLowerCase() === String(b || "").replace(/[《》"“”「」\s]/g, "").toLowerCase();

/** Asks about every plan to watch together that was for yesterday (in the couple's time zone). Returns how many it asked. */
export async function askWatchChecks({ store, relationshipId, userId, day, emit = () => {} }) {
  const yesterday = dayBefore(day);
  const plans = (await store.listRelationshipRecordsForUser("milestones", userId)).filter((item) => item.relationshipId === relationshipId && !item.archivedAt && item.date === yesterday && PLAN.test(String(item.notes || "")));
  let asked = 0;
  for (const plan of plans) {
    const title = PLAN.exec(plan.notes)[1].trim().slice(0, 120);
    if (!title) continue;
    const i18n = togetherI18n((language) => say(language, `昨天说好一起看《${title}》，看完了吗？`, `Yesterday you planned to watch "${title}" together. Did you finish it?`, `Ayer quedaron en ver «${title}» juntos. ¿La terminaron?`));
    const posted = await store.transaction(`relationship:${relationshipId}`, (tx) => appendTogetherMessage(tx, { relationshipId, actorUserId: null, userId, source: "app", kind: "watch_check", text: i18n.zh, i18n, handle: `watch-check:${plan.id}`, watch: { title, date: yesterday, milestoneId: plan.id } }));
    if (!posted.duplicate) { emit(posted.conversation); asked += 1; }
  }
  return asked;
}

/** One member answers for both. Finished: the show goes on (or is ticked off) their shelf, dated the day they planned. */
export async function answerWatchCheck({ store, relationshipId, userId, messageId, finished, emit = () => {} }) {
  if (typeof finished !== "boolean") throw decisionError(400, "message_required");
  await ensureWatchedSpace(store, userId, relationshipId);
  const result = await store.transaction(`relationship:${relationshipId}`, async (tx) => {
    const context = await tx.getRelationshipContext(userId);
    if (!context || context.relationship.id !== relationshipId || context.relationship.status !== "active") throw decisionError(409, "relationship_changed");
    const conversation = await tx.getRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, userId);
    const check = conversation?.messages.find((item) => item.id === messageId && item.kind === "watch_check");
    if (!check?.watch) throw decisionError(404, "not_found");
    if (check.watchAnswer) return { conversation, duplicate: true };
    let item = null;
    if (finished) {
      const shelf = (await tx.listRelationshipRecordsForUser("spaces", userId)).find((space) => space.system === WATCHED && space.relationshipId === relationshipId && !space.archivedAt);
      const existing = (await tx.listRelationshipRecordsForUser("spaceItems", userId)).find((entry) => entry.spaceId === shelf.id && !entry.archivedAt && same(entry.title, check.watch.title));
      item = existing ? await updateSpaceItem(tx, { userId, id: existing.id, fields: { done: true, date: check.watch.date } })
        : await addSpaceItem(tx, { userId, space: shelf, title: check.watch.title, text: "", date: check.watch.date, done: true, source: "member" });
    }
    const answer = { by: userId, finished, at: new Date().toISOString(), ...(item ? { itemId: item.id } : {}) };
    const updated = await tx.updateRelationshipRecordForUser("togetherConversations", conversation.id, userId, (draft) => { draft.messages = draft.messages.map((entry) => entry.id === messageId ? { ...entry, watchAnswer: answer } : entry); });
    return { conversation: updated, duplicate: false };
  });
  if (!result.duplicate) emit(result.conversation);
  return result.conversation;
}
