import { keepMessages } from "./thread-pages.mjs";
import { randomUUID } from "node:crypto";
import { createRelationshipRecord } from "./relationship-domain.mjs";
import { PROFILE_KIND } from "./profile.mjs";

// 约会之后问一句 (founder 11-07, borrowed from Known): the day after a one-off plan on their shared calendar, Pinky asks each
// member privately, in Just me, how it went. One tap answers (很开心 / 还行 / 不太行); the answer becomes one of their own private
// notes in About us, so Pinky's next ideas for the two of them fit better. No model call, no push: it waits until they open
// Just me, and Pinky asks at most one such question a day (shared with the promise check). Telling the partner is a
// separate tap that sends their own words in Us.
const DAY = 86_400_000, LOOK_BACK = 3;
export const RATINGS = { great: "likes", ok: "other", meh: "dislikes" };
const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;
const dayIn = (date, timeZone) => { try { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date); } catch { return date.toISOString().slice(0, 10); } };
const shift = (day, days) => new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
// Plans Pinky already asks about some other way, or that are not plans at all.
const notADate = (item) => /^watch:/.test(String(item.notes || "")) || ["together_since"].includes(String(item.notes || "")) || item.type === "relationship_started";

/** One-off shared plans of this member's couple from the last few days (not today), newest first. */
export async function recentDates(store, userId, today) {
  const context = await store.getRelationshipContext(userId);
  if (!(context?.relationship.status === "active" && context.members.length === 2)) return { context: null, dates: [] };
  const from = shift(today, -LOOK_BACK);
  const dates = (await store.listRelationshipRecordsForUser("milestones", userId))
    .filter((item) => item.relationshipId === context.relationship.id && item.visibility === "shared" && !item.archivedAt && item.recurringRule !== "yearly" && !notADate(item) && /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || "")) && item.date >= from && item.date < today && String(item.title || "").trim())
    .sort((a, b) => b.date.localeCompare(a.date));
  return { context, dates };
}

/** Posts the question in this private session when a recent date has not been asked about yet. Returns the session or null. */
export async function askAfterDate(store, { userId, session, now = new Date() }) {
  if (!session || session.channel || session.status !== "active") return null;
  const today = dayIn(now, session.timezone || "UTC");
  const askedToday = (map) => Object.values(map || {}).some((at) => dayIn(new Date(at), session.timezone || "UTC") === today);
  if (askedToday(session.dateChecks) || askedToday(session.promiseChecks) || askedToday({ knowYou: session.knowYouAt })) return null;
  const { context, dates } = await recentDates(store, userId, today);
  if (!dates.length) return null;
  const threads = (await store.listRelationshipRecordsForUser("privateAgentThreads", userId)).filter((thread) => thread.ownerUserId === userId);
  const plan = dates.find((item) => !threads.some((thread) => thread.dateChecks?.[item.id]));
  if (!plan) return null;
  const language = session.language || "zh", partner = context.members.find((member) => member.userId !== userId)?.user?.name || say(language, "TA", "your partner", "tu pareja");
  // Calendar titles often lead with the time ("19:00 海底捞"); the question is about the place or thing.
  const title = (String(plan.title).trim().replace(/^\d{1,2}[:：]\d{2}\s*/, "") || String(plan.title).trim()).slice(0, 80), yesterday = plan.date === shift(today, -1);
  const when = yesterday ? say(language, "昨天", "yesterday", "ayer") : say(language, `${Number(plan.date.slice(5, 7))} 月 ${Number(plan.date.slice(8, 10))} 日`, `on ${plan.date.slice(5)}`, `el ${plan.date.slice(8, 10)}/${plan.date.slice(5, 7)}`);
  const text = say(language, `${when}和 ${partner} 的「${title}」怎么样？点一下就行，想多说也可以直接打字。`, `How was "${title}" with ${partner} ${when}? One tap is enough, or tell me more.`, `¿Qué tal «${title}» con ${partner} ${when}? Basta un toque, o cuéntame más.`);
  return store.transaction("reminder-delivery", (tx) => tx.updateRelationshipRecordForUser("privateAgentThreads", session.id, userId, (draft) => {
    if (askedToday(draft.dateChecks) || askedToday(draft.promiseChecks) || draft.dateChecks?.[plan.id]) return;
    keepMessages(draft, [...draft.messages, { id: randomUUID(), role: "assistant", text, dateCheck: { milestoneId: plan.id, title, date: plan.date }, createdAt: now.toISOString() }]);
    draft.dateChecks = { ...(draft.dateChecks || {}), [plan.id]: now.toISOString() }; draft.version += 1;
  }));
}

const factText = (language, title, rating) => say(language,
  `约会「${title}」${rating === "great" ? "很开心" : rating === "ok" ? "还行" : "不太喜欢"}`,
  `Date "${title}": ${rating === "great" ? "loved it" : rating === "ok" ? "it was okay" : "didn't enjoy it"}`,
  `Cita «${title}»: ${rating === "great" ? "le encantó" : rating === "ok" ? "estuvo bien" : "no le gustó"}`);

/** The member's one-tap answer: kept as their own private note (About us), shown back in one quiet line. `told` marks that
 * they also told their partner (the message itself is sent through Us by the app). */
export async function answerDateCheck(store, { userId, sessionId, messageId, rating, told = false, now = new Date() }) {
  const session = await store.getRelationshipRecordForUser("privateAgentThreads", sessionId, userId);
  if (!session || session.ownerUserId !== userId || session.intentType !== "assistant" || session.archivedAt) throw fail(404, "Private assistant session not found.");
  const language = session.language || "zh";
  const question = (session.messages || []).find((message) => message.id === messageId && message.dateCheck);
  if (!question) throw fail(404, say(language, "没有找到这个问题。", "That question wasn't found.", "No se encontró esa pregunta."));
  if (told) {
    if (question.dateAnswer?.rating !== "great") throw fail(409, say(language, "先回答一下吧。", "Answer first.", "Responde primero."));
    return store.transaction("reminder-delivery", (tx) => tx.updateRelationshipRecordForUser("privateAgentThreads", session.id, userId, (draft) => {
      draft.messages = draft.messages.map((message) => message.id === messageId && message.dateAnswer && !message.dateAnswer.toldAt ? { ...message, dateAnswer: { ...message.dateAnswer, toldAt: now.toISOString() } } : message); draft.version += 1;
    }));
  }
  if (!Object.hasOwn(RATINGS, rating)) throw fail(400, "Choose an answer.");
  if (question.dateAnswer) return session;
  const context = await store.getRelationshipContext(userId);
  if (!(context?.relationship.status === "active" && context.members.length === 2)) throw fail(409, say(language, "你们已经不在一起使用 Pinky 了。", "You are no longer connected.", "Ya no están conectados."));
  return store.transaction(`relationship:${context.relationship.id}`, async (tx) => {
    const current = await tx.getRelationshipRecordForUser("privateAgentThreads", session.id, userId);
    const asked = current?.messages.find((message) => message.id === messageId && message.dateCheck);
    if (!asked) throw fail(404, "Not found.");
    if (asked.dateAnswer) return current;
    const text = factText(language, asked.dateCheck.title, rating);
    const fact = createRelationshipRecord({
      relationshipId: context.relationship.id, userId, ownerUserId: userId, visibility: "private", aiAccessScope: "private", status: "active", provenanceSource: "member",
      kind: PROFILE_KIND, subjectUserId: null, category: RATINGS[rating], text, approvals: [],
      evidence: { channel: "private", sessionId: session.id, messageId, quote: asked.dateCheck.title, saidAt: now.toISOString() },
    });
    await tx.createRelationshipRecord("memories", fact);
    const noted = say(language, `已记进「关于我们」：${text}。下次帮你们出主意时会参考。`, `Kept in About us: ${text}. I'll use it for your next ideas.`, `Guardado en Sobre nosotros: ${text}. Lo usaré para sus próximas ideas.`);
    return tx.updateRelationshipRecordForUser("privateAgentThreads", session.id, userId, (draft) => {
      keepMessages(draft, [...draft.messages.map((message) => message.id === messageId ? { ...message, dateAnswer: { rating, at: now.toISOString(), factId: fact.id } } : message), { id: randomUUID(), role: "assistant", kind: "noted", text: noted, noted: [fact.id], createdAt: now.toISOString() }]);
      draft.version += 1;
    });
  });
}
