import { askDailyQuestion, DAILY } from "./daily-question.mjs";
import { celebrationOn, composeStory, occasionLabel } from "./story.mjs";
import { memberLanguage } from "./together-domain.mjs";
import { memberTimezone } from "./reminder-service.mjs";
import { asAiUser } from "./ai-budget.mjs";
import { askWatchChecks, WATCH_HOUR } from "./watched.mjs";

// The daily question and the celebration card (100 days, anniversaries) used to start only when one partner opened Us, so a
// couple who did not open the App that day was never told by push. The maintenance tick (every 5 minutes) now starts them at a
// sensible hour in the couple's own time zone; posting in Us is what pushes both partners (reminder-service notifyTogether,
// App phones and installed web apps). Opening Us earlier still starts them then, as before.
export const CELEBRATION_HOUR = 9, DAILY_HOUR = 20, LAST_HOUR = 22;

/** `reachable(userId)` says whether a push could reach that member; `emit(conversation)` publishes a changed Us (no actor:
 * nobody opened it, so both partners are told). */
export function createCoupleRituals({ store, mediator, reachable, emit = () => {}, now = () => new Date() }) {
  // One scheduled attempt per couple, day and kind in this process: a failing model is not retried every tick.
  const tried = new Set();
  const once = (key) => tried.has(key) ? false : (tried.add(key), true);
  return async function runCoupleRituals() {
    const current = now();
    let started = 0;
    for (const conversation of await store.listRecordsForJob("togetherConversations")) {
      try { started += await forCouple(conversation, current); }
      catch (error) { console.error("Couple ritual failed:", error?.message || error); }
    }
    return { started };
  };

  async function forCouple(conversation, current) {
    const relationshipId = conversation.relationshipId;
    if (!relationshipId || conversation.archivedAt) return 0;
    const context = await store.getRelationshipContext(conversation.createdByUserId);
    if (!(context?.relationship.id === relationshipId && context.relationship.status === "active" && context.members.length === 2)) return 0;
    const ids = context.members.map((member) => member.userId);
    // Nobody would hear it: leave it to whoever opens Us next, as before (and spend nothing on it).
    if (!(await Promise.all(ids.map((id) => reachable(id)))).some(Boolean)) return 0;
    let zone = null;
    for (const id of ids) { zone = await memberTimezone(store, id); if (zone) break; }
    // Without a known time zone there is no sensible local hour to pick.
    if (!zone) return 0;
    const { day, hour } = localDayHour(current, zone);
    if (hour < CELEBRATION_HOUR || hour >= LAST_HOUR) return 0;
    const userId = ids[0], language = await memberLanguage(store, userId), publish = (updated) => emit(updated);
    // Nobody's request is running on the tick: name the couple, so the guarded mediator counts these calls (and tomorrow's
    // question, prepared after posting) in this couple's background pool, not the anonymous demo allowance.
    return asAiUser({ userId, language }, () => startRituals({ relationshipId, userId, language, publish, day, hour, conversation }));
  }

  async function startRituals({ relationshipId, userId, language, publish, day, hour, conversation }) {
    let started = 0;
    const since = (await store.listRelationshipRecordsForUser("milestones", userId)).find((item) => item.relationshipId === relationshipId && item.type === "relationship_started" && !item.archivedAt)?.date;
    const occasion = celebrationOn(since, day);
    if (occasion && once(`story:${relationshipId}:${occasion.key}`)) {
      started += Number(await composeStory({ store, mediator, relationshipId, userId, language, key: occasion.key, occasion: occasionLabel(occasion, language), emit: publish }));
    }
    // 看完了吗: the morning after a plan to watch something together (no model call).
    if (hour >= WATCH_HOUR && once(`watch:${relationshipId}:${day}`)) started += await askWatchChecks({ store, relationshipId, userId, day, emit: publish });
    if (hour >= DAILY_HOUR) {
      const last = (conversation.messages || []).filter((message) => message.kind === DAILY).at(-1);
      // After a question neither of them answered, the next one waits until one of them opens Us: a couple who stopped
      // answering is not pinged (or paid for) every evening.
      const engaged = !last || Object.keys(last.answers || {}).length > 0;
      if (engaged && once(`daily:${relationshipId}:${day}`)) started += Number(await askDailyQuestion({ store, mediator, relationshipId, userId, language, today: day, emit: publish }));
    }
    return started;
  }
}

export function localDayHour(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(date).map(({ type, value }) => [type, value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
