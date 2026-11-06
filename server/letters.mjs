import { createRelationshipRecord } from "./relationship-domain.mjs";
import { appendTogetherMessage } from "./together-domain.mjs";
import { addSpaceItem, ensureMomentSpaces } from "./space-domain.mjs";

// Letters and time capsules (founder 11-06): written with Pinky in Just me, confirmed by the writer, then sealed until the day
// they open. Until then the words stay on the writer's own private record; Us only shows that a letter is waiting and when it
// opens (so neither the partner nor the shared Pinky can read it early), and the day is on the couple's calendar. On the day
// the maintenance tick delivers it into Us and keeps it in their shared memories.
const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;
export const isDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
export const todayIn = (timezone, now = new Date()) => { try { return now.toLocaleDateString("en-CA", { timeZone: timezone || "UTC" }); } catch { return now.toISOString().slice(0, 10); } };
/** The day a letter opens, if it is a real day after today where the writer is; otherwise it is an ordinary message. */
export const openingDay = (value, timezone, now = new Date()) => isDay(value) && value > todayIn(timezone, now) ? value : null;

/** Seals a confirmed letter: a "waiting" note in Us (no words), a date on the calendar, and the letter kept privately. */
export async function sealLetter(tx, { relationshipId, userId, draft, language }) {
  const title = say(language, "💌 一封信打开", "💌 A letter opens", "💌 Se abre una carta");
  const milestone = createRelationshipRecord({ relationshipId, userId, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "active", type: "letter", title, date: draft.openOn, timezone: "UTC", recurringRule: "once", jointlyConfirmed: false, notes: "" });
  await tx.createRelationshipRecord("milestones", milestone);
  const sent = await appendTogetherMessage(tx, { relationshipId, actorUserId: userId, source: "app", kind: "letter_sealed", text: "💌", handle: `letter_sealed:${draft.cardId}`, refs: [{ type: "letter", id: draft.cardId, openOn: draft.openOn }] });
  return { sent, milestone };
}

/** Delivers every sealed letter whose day has come where its writer is. Safe to run every few minutes. */
export async function deliverLetters({ store, emit = () => {}, now = () => new Date() }) {
  let delivered = 0;
  for (const thread of await store.listRecordsForJob("privateAgentThreads")) {
    for (const letter of Array.isArray(thread.letters) ? thread.letters : []) {
      if (letter.deliveredAt || !isDay(letter.openOn) || letter.openOn > todayIn(thread.timezone, now())) continue;
      try {
        const userId = thread.ownerUserId, context = await store.getRelationshipContext(userId);
        if (!(context?.relationship.status === "active" && context.members.length === 2 && context.relationship.id === letter.relationshipId)) continue;
        await ensureMomentSpaces(store, userId);
        const result = await store.transaction(`relationship:${context.relationship.id}`, async (tx) => {
          const fresh = await tx.getRelationshipRecordForUser("privateAgentThreads", thread.id, userId);
          const kept = fresh?.letters?.find((item) => item.cardId === letter.cardId);
          if (!kept || kept.deliveredAt) return null;
          const sent = await appendTogetherMessage(tx, { relationshipId: context.relationship.id, actorUserId: userId, source: "app", kind: "letter", text: kept.text, handle: `letter:${kept.cardId}`, refs: [{ type: "letter", id: kept.cardId, openOn: kept.openOn }] });
          const album = (await tx.listRelationshipRecordsForUser("spaces", userId)).find((space) => space.system === "moments" && space.visibility === "shared" && space.relationshipId === context.relationship.id && !space.archivedAt);
          if (album) await addSpaceItem(tx, { userId, space: album, title: say(fresh.language, "一封信", "A letter", "Una carta"), text: kept.text, date: kept.openOn, source: "letter" });
          await tx.updateRelationshipRecordForUser("privateAgentThreads", fresh.id, userId, (draft) => { draft.letters = draft.letters.map((item) => item.cardId === kept.cardId ? { ...item, deliveredAt: now().toISOString(), deliveredMessageId: sent.message.id } : item); });
          return sent;
        });
        if (result && !result.duplicate) { emit(result.conversation, "together.updated"); delivered += 1; }
      } catch (error) { console.error("Letter delivery will retry on the next tick:", error?.message || error); }
    }
  }
  return { delivered };
}
