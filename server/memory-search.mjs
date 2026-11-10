import { listPeople, personOf, personSubject } from "./people.mjs";
import { activePair, isProfileFact, visibleTo } from "./profile.mjs";

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

/**
 * Searches this member's own past conversations (pages included) and their notes, newest matches first among equals.
 * Inside a person's own conversation (`personId`), only that person's conversation and notes are searched.
 */
export async function searchMemory({ store, userId, query = "", date = "", personId = null, limit = 10 }) {
  const words = terms(query);
  if (!words.length && !date) return "Nothing to search for.";
  const context = await store.getRelationshipContext(userId);
  const relationshipId = activePair(context) ? context.relationship.id : null;
  const people = await listPeople(store, userId, { archived: true });
  const nameOf = (id) => people.find((person) => person.id === id)?.name || null;
  const hits = [];
  const consider = (text, at, label) => {
    if (date && !String(at || "").startsWith(date)) return;
    const value = words.length ? score(text, words) : 1;
    // A day asked for is the filter; words then only rank. Without a day, a short query needs its words, a long one two.
    if (!date && words.length && value < Math.min(2, words.length)) return;
    hits.push({ value, at: String(at || ""), line: `[${String(at || "").slice(0, 10)} · ${label}] ${squash(text, 300)}` });
  };
  const threads = (await store.listRelationshipRecordsForUser("privateAgentThreads", userId)).filter((thread) => thread.ownerUserId === userId && thread.intentType === "assistant" && !thread.archivedAt && (!personId || thread.personId === personId));
  for (const thread of threads) {
    const where = thread.personId ? `只聊${nameOf(thread.personId) || "TA"}` : "和 Pinky 的对话";
    for (const message of [...(thread.earlier || []).flatMap((page) => page.messages || []), ...(thread.messages || [])]) {
      if (!message?.text || message.kind) continue;
      consider(message.text, message.createdAt, `${where} · ${message.role === "user" ? "你说" : "Pinky 说"}`);
    }
  }
  const notes = (await store.listRelationshipRecordsForUser("memories", userId)).filter((item) => isProfileFact(item) && visibleTo(item, userId, relationshipId) && (!personId || item.subjectUserId === personSubject(personId)));
  for (const note of notes) {
    const about = note.subjectUserId === userId ? "关于你" : personOf(note.subjectUserId) ? `关于${nameOf(personOf(note.subjectUserId)) || "TA"}` : note.subjectUserId ? "关于伴侣" : "关于你们";
    consider(note.text, note.evidence?.saidAt || note.createdAt, `记忆卡 · ${about}`);
  }
  if (!hits.length) return "No matching record in their past conversations or notes.";
  return hits.sort((a, b) => b.value - a.value || b.at.localeCompare(a.at)).slice(0, limit).map((hit) => hit.line).join("\n");
}
