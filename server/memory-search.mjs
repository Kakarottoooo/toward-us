import { listPeople, personOf, personSubject } from "./people.mjs";
import { activePair, isProfileFact, visibleTo } from "./profile.mjs";
import { conversationMessages, readableConversation } from "./conversation-recall.mjs";

// 按需检索 (memory plan, founder 11-09: "做按需检索"). Portraits and the newest notes carry the big picture; a specific old
// detail (what was said on a day, the exact words of an apology) lives only in the member's own past conversations and in
// notes no longer listed. Pinky searches them when it needs to, and answers naming the day it was said. Only this member's
// own private conversations and the notes they can see are searched; never a partner's.
const squash = (value, limit) => String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
const CJK = /[㐀-鿿]/;

/** The words a query is matched on: Latin words whole, Chinese runs as overlapping pairs of characters. */
export function terms(query) {
  const out = new Set();
  for (const piece of String(query || "").toLowerCase().split(/[\s,，。.!！?？、;；:："“”'‘’()（）]+/).filter(Boolean)) {
    if (!CJK.test(piece)) { if (piece.length > 1) out.add(piece); continue; }
    const chars = [...piece];
    if (chars.length === 1) out.add(piece);
    for (let index = 0; index < chars.length - 1; index += 1) out.add(chars[index] + chars[index + 1]);
  }
  return [...out];
}

const score = (text, words) => { const lower = String(text || "").toLowerCase(); return words.filter((word) => lower.includes(word)).length; };

// Only explicit requests to recall a past exchange get a first-pass lookup. Ordinary coaching keeps its usual budget.
export const asksToRecall = (text) => /(?:之前|以前|上次|当时|那天|曾经).{0,50}(?:问|答|说|建议|聊)|(?:记得|回忆).{0,30}(?:问|答|说|建议|聊)|\b(?:what|how).{0,60}\b(?:said|asked|answered|told|suggested|recommended)\b|\b(?:what|how)\s+did\s+(?:you|I|we).{0,40}\b(?:say|ask|answer|tell|suggest|recommend)\b|\b(?:last time|previously|back then|recall)\b|\b(?:antes|aquella vez|la otra vez|recuerdas|dijiste|pregunté|respondiste|aconsejaste)\b/i.test(String(text || ""));

export async function prefetchRecall(options, text) {
  if (!asksToRecall(text)) return null;
  // A natural-language question has incidental overlaps (two adjacent Chinese bigrams can be just one short name).
  // Preloading must be more selective than a deliberate short search; weak hits leave query formulation to the model.
  const result = await searchMemoryResults({ ...options, query: text, minimumMatches: CJK.test(text) ? 3 : 2, date: String(text).match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || "" });
  return result.sources.length ? result : null;
}

export function recallLookup(result, query) {
  return { query, findings: result.findings, ...(result.sources.length ? { citationRule: "Use only exchanges answering the question. If none do, say no matching record; omit unrelated exchanges. When asked what was asked and answered, show the date, then separately quote the original question and answer verbatim instead of paraphrasing; if long, quote the relevant passage without changing its words. Put later changes under their own date, separate from the original quotation. Do not append a no-change statement unless asked about changes. For EVERY exchange used, append its EXACT [recall:...] tag to reply. The app hides the tag and renders a source button; without it the user cannot open the original. Copy the tag from findings, never invent one." } : {}) };
}

// Pair before ranking, including a turn split across two storage pages. Never attach the next question to an answer.
export function conversationTurns(messages) {
  const turns = [], questions = new Map();
  for (const message of messages) {
    if (!message?.text || message.kind && message.kind !== "text" || !["user", "assistant", "member", "agent"].includes(message.role)) continue;
    const answer = ["assistant", "agent"].includes(message.role);
    const previous = message.replyTo ? questions.get(message.replyTo) : turns.at(-1);
    if (answer && previous?.question && !previous.answer) previous.answer = message;
    else {
      const turn = answer ? { answer: message } : { question: message };
      turns.push(turn);
      if (!answer) questions.set(message.id, turn);
    }
  }
  return turns;
}

/**
 * Searches this member's own past conversations (pages included) and their notes, newest matches first among equals.
 * Inside a person's own conversation (`personId`), only that person's conversation and notes are searched.
 */
export async function searchMemory({ store, userId, query = "", date = "", personId = null, limit = 10 }) {
  return (await searchMemoryResults({ store, userId, query, date, personId, limit })).findings;
}

export async function searchMemoryResults({ store, userId, query = "", date = "", personId = null, limit = 10, channel = "me", excludeMessageId = null, minimumMatches = 2 }) {
  const words = terms(query);
  if (!words.length && !date) return { findings: "Nothing to search for.", sources: [] };
  const context = await store.getRelationshipContext(userId);
  const relationshipId = activePair(context) ? context.relationship.id : null;
  const people = channel === "us" ? [] : await listPeople(store, userId, { archived: true });
  const nameOf = (id) => people.find((person) => person.id === id)?.name || null;
  const hits = [];
  const consider = (text, at, label, source = null, excerpt = null, answerAt = null) => {
    if (date && !String(at || "").startsWith(date) && !String(answerAt || "").startsWith(date)) return;
    const value = words.length ? score(text, words) : 1;
    // A day asked for is the filter; words then only rank. Without a day, a short query needs its words, a long one two.
    if (!date && words.length && value < Math.min(minimumMatches, words.length)) return;
    hits.push({ value, at: String(at || ""), source, line: `[${String(at || "").slice(0, 10)} · ${label}] ${excerpt || squash(text, 300)}${source ? ` [recall:${source.messageId}]` : ""}` });
  };
  const threads = channel === "us" ? [] : (await store.listRelationshipRecordsForUser("privateAgentThreads", userId)).filter((thread) => thread.ownerUserId === userId && thread.intentType === "assistant" && thread.visibility === "private" && thread.status === "active" && !thread.archivedAt && !thread.withdrawnAt && thread.aiAccessScope === "private" && (!personId || thread.personId === personId));
  const addConversation = async (thread, scope, where) => {
    for (const { question, answer } of conversationTurns(await conversationMessages(store, userId, scope, thread))) {
      const message = question || answer;
      if (message.id === excludeMessageId) continue;
      const source = { channel: scope, conversationId: thread.id, messageId: message.id, date: String(message.createdAt || "").slice(0, 10), ...(thread.personId ? { personId: thread.personId } : {}),
        ...(question?.text && answer?.text ? { exchange: { question: question.text, answer: answer.text, answerDate: String(answer.createdAt || "").slice(0, 10) } } : {}) };
      // Separate caps keep a long question from crowding out the answer. Mark truncation rather than invent the rest.
      const excerpt = (value) => `${squash(value, 220)}${String(value || "").length > 220 ? "…" : ""}`;
      consider([question?.text, answer?.text].filter(Boolean).join("\n"), message.createdAt, `${where} · ${question ? scope === "us" ? "成员说" : "你说" : "Pinky 说"}`, source,
        [question && excerpt(question.text), answer && `Pinky 当时答 (${String(answer.createdAt || "").slice(0, 10)})：${excerpt(answer.text)}`].filter(Boolean).join("\n"), answer?.createdAt);
    }
  };
  for (const thread of threads) {
    const where = thread.personId ? `只聊${nameOf(thread.personId) || "TA"}` : "和 Pinky 的对话";
    await addConversation(thread, "me", where);
  }
  if (relationshipId && !personId) {
    const shared = await readableConversation(store, userId, "us", `together:${relationshipId}`).catch(() => null);
    if (shared?.aiAccessScope === "joint") await addConversation(shared, "us", "我们俩的对话");
  }
  const notes = (await store.listRelationshipRecordsForUser("memories", userId)).filter((item) => isProfileFact(item) && visibleTo(item, userId, relationshipId) && (channel !== "us" || item.visibility === "shared" && item.aiAccessScope === "joint" && item.relationshipId === relationshipId) && (!personId || item.subjectUserId === personSubject(personId)));
  for (const note of notes) {
    const about = note.subjectUserId === userId ? "关于你" : personOf(note.subjectUserId) ? `关于${nameOf(personOf(note.subjectUserId)) || "TA"}` : note.subjectUserId ? "关于伴侣" : "关于你们";
    consider(note.text, note.evidence?.saidAt || note.createdAt, `记忆卡 · ${about}`);
    // What used to be true, with when it changed: "以前住上海" still answers "他以前住哪".
    for (const was of note.past || []) consider(was.text, was.saidAt || note.createdAt, `记忆卡 · ${about} · 以前是这样，${String(was.until || "").slice(0, 10)} 起变成：${squash(note.text, 60)}`);
  }
  const selected = []; let size = 0;
  for (const hit of hits.sort((a, b) => b.value - a.value || b.at.localeCompare(a.at)).slice(0, Math.min(10, limit))) {
    if (size + hit.line.length + 1 > 3600) break;
    selected.push(hit); size += hit.line.length + 1;
  }
  return { findings: selected.map((hit) => hit.line).join("\n") || "No matching record in their past conversations or notes.", sources: selected.flatMap((hit) => hit.source ? [hit.source] : []) };
}
