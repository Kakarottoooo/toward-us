import { createRelationshipRecord } from "./relationship-domain.mjs";

// 连续一起来 (founder 11-06): how many days in a row the two of them both came by. A member "showed up" on a day when, on
// that calendar day in their own time zone, they answered the daily question, said anything in Us (a member message: text,
// 想你了, a letter, a voice line…) or petted the little one. A day counts only when BOTH showed up on it. The streak is the run
// of counted days ending today; while today is not done by both yet it ends yesterday (so it never looks broken mid-day),
// and `me` / `partner` say who has already come by today.
//
// Where the days come from: each member's own owner-private mark (accountSettings `showedup:<relationship>:<user>`, only
// dates, never content), written when they show up (markShowedUp), plus whatever the live conversation still shows (the
// working set of Us and the last 30 days of petting), so couples who were already here before the marks existed start
// with the days Us still remembers. No model call; at most LOOKBACK_DAYS days are kept and counted.
export const LOOKBACK_DAYS = 400;
const markId = (relationshipId, userId) => `showedup:${relationshipId}:${userId}`;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const validZone = (zone) => { if (typeof zone !== "string" || !zone || zone.length > 64) return null; try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return zone; } catch { return null; } };
/** The calendar day an instant falls on in `zone` (UTC when the zone is unusable). */
export const dayIn = (at, zone) => { const date = new Date(at); if (Number.isNaN(date.getTime())) return ""; try { return date.toLocaleDateString("en-CA", { timeZone: validZone(zone) || "UTC" }); } catch { return date.toISOString().slice(0, 10); } };
export const shiftDay = (day, by) => new Date(Date.parse(`${day}T12:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);

/** Records that `userId` showed up now, on their own calendar day in `zone`. Call inside the relationship transaction; it
 * reads one record and writes only on the first visit of a day. */
export async function markShowedUp(tx, { relationshipId, userId, zone, at = new Date() }) {
  const day = dayIn(at, zone);
  if (!relationshipId || !userId || !DAY_RE.test(day)) return null;
  const id = markId(relationshipId, userId);
  const current = await tx.getRelationshipRecordForUser("accountSettings", id, userId);
  if (current?.days?.includes(day)) return current;
  const keep = (days) => [...new Set([...(days || []), day])].filter((item) => DAY_RE.test(item)).sort().slice(-LOOKBACK_DAYS);
  if (current) return tx.updateRelationshipRecordForUser("accountSettings", id, userId, (draft) => { draft.days = keep(draft.days); });
  const record = createRelationshipRecord({ relationshipId, userId, visibility: "private", aiAccessScope: "none", provenanceSource: "system", kind: "showed_up", days: keep([]) });
  record.id = id;
  return tx.createRelationshipRecord("accountSettings", record);
}

/** The days each member showed up that the live conversation still shows, in that member's own time zone. */
function daysInConversation(conversation, userId, zone) {
  const days = [];
  for (const message of conversation?.messages || []) {
    if (message.role === "member" && message.actorUserId === userId) days.push(dayIn(message.createdAt, zone));
    const answer = message.kind === "daily_question" ? message.answers?.[userId] : null;
    if (answer?.at) days.push(dayIn(answer.at, zone));
  }
  for (const [day, members] of Object.entries(conversation?.pets || {})) if (Array.isArray(members) && members.includes(userId)) days.push(day);
  return days;
}

/** The couple's streak as seen by `userId` (the reader; `me` is them). `timezone` is the reader's own zone and decides
 * "today"; each member's days are counted in their own zone (kept on the shared conversation when they open Us).
 * Returns `{ days, me, partner, byUser }`, where byUser says for each member whether they showed up today. */
export async function coupleStreak(store, relationshipId, { now = new Date(), timezone = null, userId } = {}) {
  const none = { days: 0, me: false, partner: false, byUser: {} };
  const context = userId ? await store.getRelationshipContext(userId) : null;
  if (!context || context.relationship.id !== relationshipId || context.members.length !== 2) return none;
  const conversation = await store.getRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, userId);
  const zoneOf = (id) => validZone(conversation?.zones?.[id]) || (id === userId ? validZone(timezone) : null) || "UTC";
  const today = dayIn(now, validZone(timezone) || zoneOf(userId));
  if (!DAY_RE.test(today)) return none;
  const oldest = shiftDay(today, -(LOOKBACK_DAYS - 1));
  const shown = {};
  for (const { userId: id } of context.members) {
    const mark = await store.getRelationshipRecordForUser("accountSettings", markId(relationshipId, id), userId);
    shown[id] = new Set([...(Array.isArray(mark?.days) ? mark.days : []), ...daysInConversation(conversation, id, zoneOf(id))].filter((day) => DAY_RE.test(day) && day >= oldest));
  }
  const ids = context.members.map((member) => member.userId), partnerId = ids.find((id) => id !== userId);
  const both = (day) => ids.every((id) => shown[id].has(day));
  let day = both(today) ? today : shiftDay(today, -1), days = 0;
  while (day >= oldest && both(day)) { days += 1; day = shiftDay(day, -1); }
  const byUser = Object.fromEntries(ids.map((id) => [id, shown[id].has(today)]));
  return { days, me: byUser[userId], partner: Boolean(partnerId && byUser[partnerId]), byUser };
}
