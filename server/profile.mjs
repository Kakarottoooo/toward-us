import express from "express";
import { createHash, randomUUID } from "node:crypto";
import { createRelationshipRecord } from "./relationship-domain.mjs";

// 喜好档案 (founder 11-06): Pinky's long-term memory of each partner and of the two of them: what they like and dislike,
// what they wish for, their habits and traits, the people and days that matter. It is kept automatically from their
// conversations (founder: "自动记，事后可见") and every fact stays visible, editable and removable. Each person's notes are
// their own (founder: "各自私有，可挑着分享"): what Ziwei tells Pinky privately about himself or about Mia stays Ziwei's alone;
// he may share a line about himself with Mia; what they both said in Us belongs to both. Facts live in the existing
// memories collection (kind "profile"), so export, retention and deletion already cover them.
export const CATEGORIES = ["food", "likes", "dislikes", "wishes", "traits", "people", "history", "other"];
export const PROFILE_KIND = "profile";
const SCAN_LIMIT = 40, SCAN_CONTEXT = 6, KNOWN_LIMIT = 150, CONTEXT_LIMIT = 80, HISTORY_LIMIT = 60;
// The day a line was said where the member lives: "昨天" late in the evening in California is not yesterday in UTC.
const localDay = (at, timeZone) => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at)); } catch { return String(at || "").slice(0, 10); } };
const historyDay = (text) => /^\d{4}-\d{2}-\d{2}/.exec(text)?.[0] || "0000";
const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;
const squash = (value) => String(value || "").replace(/\s+/g, " ").trim();
const clean = (value, limit) => squash(value).replace(/\0/g, "").slice(0, limit);
const key = (value) => squash(value).toLowerCase().replace(/[\s。.!！,，、;；:："“”'‘’「」]/g, "");
const object = (properties) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const schema = object({ facts: { type: "array", maxItems: 10, items: object({ messageId: { type: "string" }, quote: { type: "string" }, subject: { type: "string", enum: ["A", "B", "both"] }, category: { type: "string", enum: CATEGORIES }, fact: { type: "string" }, replaces: { type: "string" } }) } });
const activePair = (context, relationshipId = null) => context?.relationship.status === "active" && context.members.length === 2 && (!relationshipId || context.relationship.id === relationshipId);
export const isProfileFact = (record) => record?.kind === PROFILE_KIND;
const live = (record) => isProfileFact(record) && record.status === "active" && !record.archivedAt && !record.deletedAt;
/** A fact this member may see: their own private ones, and shared ones of their current couple. */
const visibleTo = (record, userId, relationshipId) => live(record) && (record.visibility === "private" ? record.ownerUserId === userId : Boolean(relationshipId) && record.relationshipId === relationshipId && (record.memberUserIds || []).includes(userId));

// Pinky works alone first (founder 11-08: the reply coach needs no invitation) and learns the partner as it is used. Before a
// partner joins, a note about "TA" points at this stand-in instead of a user id; like every private note it is the member's
// alone, and after pairing it still counts as being about the partner.
export const pendingPartner = (userId) => `partner-of:${userId}`;
const isPartner = (subjectUserId, userId, partnerId) => Boolean(subjectUserId) && subjectUserId !== userId && (subjectUserId === partnerId || subjectUserId === pendingPartner(userId));
/** Where this member's private notes go now: their couple once paired, otherwise just them. */
async function memberScope(db, userId) {
  const context = await db.getRelationshipContext(userId);
  if (!activePair(context)) return { relationshipId: null, partnerId: pendingPartner(userId), a: "", b: "", lock: `user:${userId}` };
  const me = context.members.find((member) => member.userId === userId), partner = context.members.find((member) => member.userId !== userId);
  return { relationshipId: context.relationship.id, partnerId: partner.userId, a: me?.user?.name || "", b: partner?.user?.name || "", lock: `relationship:${context.relationship.id}` };
}

function instructions({ a, b, privateChat, between = false }) {
  return `You keep a long-term profile of two partners for Pinky, a couple's app, so Pinky understands them better over time. A is ${a || "the first partner"}, B is ${b || "the second partner"}.
${between ? "This is a chat between A and B that A brought to Pinky privately (screenshots or pasted text). A's and B's own lines both count; what B says about B is the best evidence about B. Keep lasting things and what happened between them (history), never only how they feel in this one exchange." : privateChat ? "This is A's private chat with Pinky; only A's own lines count. A may tell you things about B." : "This is the couple's shared chat; Pinky's lines never count."}
Keep lasting facts that help to know a person or the couple later. Categories: food (food and drink they love or avoid, allergies, diet); likes (hobbies, music, films, places, styles, what makes them happy); dislikes (what annoys or hurts them, sore spots, boundaries); wishes (things they want, gift ideas, places they want to go, sizes); traits (personality, habits and routines, how they like to be cared for or comforted, how they handle conflict); people (family, friends, pets, birthdays and dates that matter to them); history (what happened between them; founder 11-08: Pinky must remember what happened before, past fights and experiences): a fight, what it was about and how it ended, an important talk or decision, a first date or any date, a trip, a first, a hard time in their lives (a family member in hospital, losing a job), something one of them did that mattered; a place or plan B said they want for next time (下次想去爬山) is also a wish about B; other (work, studies, where they live, other lasting facts). For both: how the two of them work best together, their rituals and lessons ("we talk after ten quiet minutes").
Not kept: periods, health or medical details (kept elsewhere, privately; that someone close went into hospital is history, without medical details), today's mood, small talk and trivial events, one-off plans or picks for right now, promises, jokes or sarcasm, guesses ("maybe he likes…"), facts about other people that say nothing about A or B, and anything already in known unless it changed.
When A explicitly asks Pinky to remember something (记住, 记一下, 帮我记, remember, keep in mind, recuerda, apunta), keep every distinct point of what they asked to remember as its own fact, each with its own quote; an explicit request outweighs being selective. A standing arrangement the two of them made about how they handle things from now on (who tells whom what and when, how they talk after a fight) is lasting: keep it under traits with subject both. It is not a one-off promise.
A history fact begins with the date it happened as YYYY-MM-DD, worked out from the message's date (昨天 is the day before it); when only roughly known (上周, 上个月, last week) the date is followed by 前后 (around, alrededor de), as in "2026-11-01 前后"; something from long ago at an unknown time begins with 以前 (Before, Antes) instead. Then one short line in the language of the quote that says who did what, in A's own words: in a private chat or a brought chat 我 is A and B is called the way A calls B (他, 她, a name), so "2026-11-07 他打游戏一晚上不回我消息，吵了一架，后来他道歉了"; in the shared chat use their names. Never write the letters A or B inside any fact. When a new line tells how something in known history went on (they made up, the trip happened), give the updated line with replaces set to that fact's id instead of a new fact; subject is both unless it is only about one of them.
Look only at messages with isNew true; the others are context. For each fact give messageId, copied exactly from the id of the very message the quote is in; quote, copied exactly from that message's text, unchanged and contiguous (the shortest part that states the fact), never paraphrased or translated; subject, whom it is about (A, B or both); category; fact, a short phrase without the person's name, in the language of the quote ("不吃香菜", "loves rainy-day films", "生日是 3 月 5 日", "吵架后需要先安静一会儿"); replaces, the id of the fact in known that this one updates or contradicts (they started eating cilantro), else "".
Be selective: only clear, lasting things the speaker means. Most lines hold none; then return facts: [].`;
}

/** Keeps only findings whose quote really is in a new line that counts. */
export function verifyFacts(found, lines, counts) {
  const kept = [];
  for (const item of Array.isArray(found) ? found : []) {
    const line = lines.find((entry) => entry.id === item?.messageId);
    const quote = clean(String(item?.quote || "").replace(/^["“「'‘]+|["”」'’]+$/g, ""), 300), fact = clean(item?.fact, 160);
    if (!line || !counts(line) || quote.length < 2 || !fact || !squash(line.text).includes(quote)) continue;
    if (!["A", "B", "both"].includes(item.subject) || !CATEGORIES.includes(item.category)) continue;
    kept.push({ line, quote, fact, subject: item.subject, category: item.category, replaces: clean(item.replaces, 80) });
  }
  return kept;
}

// The first look reads only the latest lines; after that every new line is read, a batch at a time (as promises do).
const freshLines = (messages, cursor, eligible) => {
  const index = cursor?.messageId ? messages.findIndex((item) => item.id === cursor.messageId) : -1;
  const after = index >= 0 ? messages.slice(index + 1) : cursor?.at ? messages.filter((item) => item.createdAt > cursor.at) : messages;
  const pending = after.filter(eligible);
  const more = Boolean(cursor) && pending.length > SCAN_LIMIT;
  const fresh = cursor ? pending.slice(0, SCAN_LIMIT) : pending.slice(-SCAN_LIMIT);
  const start = fresh.length ? messages.indexOf(fresh[0]) : -1;
  return { fresh, more, last: more ? fresh.at(-1) : messages.at(-1), before: start > 0 ? messages.slice(Math.max(0, start - SCAN_CONTEXT), start).filter((item) => item.text) : [] };
};

/** Writes verified facts in one scope (a member's private notes, or the couple's shared ones). Returns what changed. */
async function keepFacts(tx, { relationshipId, userId, visibility, ownerUserId, memberUserIds, subjectOf, findings, channel, sessionId = null }) {
  const scoped = (await tx.listRelationshipRecordsForUser("memories", userId)).filter((item) => live(item) && item.relationshipId === relationshipId && item.visibility === visibility && (visibility === "shared" || item.ownerUserId === ownerUserId));
  const changed = [];
  for (const found of findings) {
    const subjectUserId = subjectOf(found.subject);
    const evidence = { channel, ...(sessionId ? { sessionId } : {}), messageId: found.line.id, quote: found.quote, saidAt: found.line.createdAt };
    const target = found.replaces && scoped.find((item) => item.id === found.replaces);
    if (target) {
      if (key(target.text) === key(found.fact)) continue;
      const updated = await tx.updateRelationshipRecordForUser("memories", target.id, userId, (draft) => { draft.text = found.fact; draft.category = found.category; draft.evidence = evidence; draft.previousText = target.text; draft.version += 1; draft.updatedAt = new Date().toISOString(); });
      if (updated) { Object.assign(target, updated); changed.push(updated); }
      continue;
    }
    if (scoped.some((item) => (item.subjectUserId || null) === subjectUserId && key(item.text) === key(found.fact))) continue;
    const speaker = visibility === "shared" ? found.line.actorUserId : ownerUserId;
    const record = createRelationshipRecord({
      relationshipId, userId: speaker, ownerUserId: speaker, visibility, aiAccessScope: visibility === "shared" ? "joint" : "private", status: "active", provenanceSource: "agent",
      kind: PROFILE_KIND, subjectUserId, category: found.category, text: found.fact, evidence, approvals: [], ...(memberUserIds ? { memberUserIds } : {}),
    });
    await tx.createRelationshipRecord("memories", record);
    scoped.push(record); changed.push(record);
  }
  return changed;
}

const knownFor = (records, userId, relationshipId, label) => records.filter((item) => visibleTo(item, userId, relationshipId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, KNOWN_LIMIT).map((item) => ({ id: item.id, subject: label(item.subjectUserId || null), fact: item.text }));

/** Reads one member's new private lines and keeps what they reveal, privately for that member. */
export async function scanPrivateProfile({ store, mediator, userId, sessionId }) {
  if (!mediator?.structured) return [];
  const scope = await memberScope(store, userId);
  const session = await store.getRelationshipRecordForUser("privateAgentThreads", sessionId, userId);
  if (!session || session.ownerUserId !== userId || session.visibility !== "private" || session.intentType !== "assistant") return [];
  const messages = session.messages || [];
  const { fresh, more, last, before } = freshLines(messages, session.profileScan, (item) => item.role === "user" && !item.call && Boolean(squash(item.text)));
  if (!last || (!fresh.length && session.profileScan?.messageId === last.id)) return [];
  const { relationshipId, partnerId } = scope;
  let findings = [];
  if (fresh.length) {
    const label = (subjectUserId) => subjectUserId === userId ? "A" : isPartner(subjectUserId, userId, partnerId) ? "B" : "both";
    const known = knownFor(await store.listRelationshipRecordsForUser("memories", userId), userId, relationshipId, label);
    const input = { known, messages: [...before.map((item) => ({ id: item.id, from: item.role === "user" ? "A" : "Pinky", text: String(item.text).slice(0, 600), isNew: false })), ...fresh.map((item) => ({ id: item.id, from: "A", date: localDay(item.createdAt, session.timezone), text: String(item.text).slice(0, 1200), isNew: true }))] };
    const result = await mediator.structured({ name: "couple_profile", schema, instructions: instructions({ a: scope.a, b: scope.b, privateChat: true }), input: JSON.stringify(input), maxOutputTokens: 900 });
    findings = verifyFacts(result?.facts, fresh, () => true);
  }
  return store.transaction(scope.lock, async (tx) => {
    if ((await memberScope(tx, userId)).relationshipId !== relationshipId) return [];
    const changed = await keepFacts(tx, { relationshipId, userId, visibility: "private", ownerUserId: userId, subjectOf: (subject) => subject === "A" ? userId : subject === "B" ? partnerId : null, findings, channel: "private", sessionId });
    // No version bump: the member's next turn checks the session version and must never fail because of this.
    await tx.updateRelationshipRecordForUser("privateAgentThreads", sessionId, userId, (draft) => {
      draft.profileScan = { messageId: last.id, at: last.createdAt };
      // Visible afterwards (founder: "事后可见"): one quiet line in the chat says what Pinky now remembers.
      if (changed.length) draft.messages = [...draft.messages, { id: randomUUID(), role: "assistant", kind: "noted", text: notedText(session.language, changed, { userId, partnerName: scope.b }), noted: changed.map((item) => item.id), createdAt: new Date().toISOString() }].slice(-200);
    });
    return Object.assign(changed, { more, sessionId });
  });
}

// 让 Pinky 认识你 (founder 11-07, borrowed from Known): no separate entry. While Pinky barely knows a member, their private
// call opens as a getting-to-know-you chat, and in Just me Pinky offers to ask a few questions right there. Every private
// call is read once when it ends and what the member said is kept as their own private notes (About us), where they choose
// any line about themselves to share with their partner. Pinky's lines are context only.
const KNOWN_ENOUGH = 5;
/** True while Pinky barely knows this member: connected, never interviewed on a call, and fewer than five notes about them. */
export async function gettingToKnow(store, userId) {
  const context = await store.getRelationshipContext(userId);
  if (!activePair(context)) return false;
  const threads = (await store.listRelationshipRecordsForUser("privateAgentThreads", userId)).filter((thread) => thread.ownerUserId === userId);
  if (threads.some((thread) => (thread.messages || []).some((message) => message.call?.interview))) return false;
  const notes = (await store.listRelationshipRecordsForUser("memories", userId)).filter((item) => live(item) && item.visibility === "private" && item.ownerUserId === userId && item.subjectUserId === userId);
  return notes.length < KNOWN_ENOUGH;
}
const INTERVIEW = `
This chat is a getting-to-know-you voice interview: Pinky asked A questions so it can help A and B later, and A answered on purpose. Here being selective means skipping only small talk and hesitation: keep every clear, lasting thing A says about themselves, about B or about the two of them (how A likes to be cared for and comforted, what upsets or hurts them, what they need after a fight, what they love doing together and want more of, small things that make them happy, wishes, people and days that matter), each as its own fact, up to 20. Lines are speech captions and may hold small recognition errors: quote them exactly as written anyway. Pinky's lines are only context: never take a fact from Pinky's question itself.`;
const CALL = `
This chat is the captions of a private voice call between A and Pinky. Lines are speech captions and may hold small recognition errors: quote them exactly as written anyway. Pinky's lines are only context.`;
const CALL_EVIDENCE = `
Read the whole answer, including later corrections and negations. Never turn a suggestion in Pinky's question, an uncertain guess about B, or a third person's preference or birthday into A's or B's fact. Keep negations intact. A saying "I like doing X with B" describes A's preference, subject A; it does not establish that B likes X too. Use subject both only when A explicitly describes a mutual habit, preference or arrangement ("we agreed to pause for twenty minutes").`;
const interviewSchema = object({ facts: { type: "array", maxItems: 20, items: schema.properties.facts.items } });

/** Reads what the member said on a finished private call and keeps what it reveals, privately for that member. */
export async function scanCall({ store, mediator, userId, sessionId, noteId, rows, interview = false, at = new Date().toISOString() }) {
  if (!mediator?.structured) return [];
  const scope = await memberScope(store, userId);
  const session = await store.getRelationshipRecordForUser("privateAgentThreads", sessionId, userId);
  if (!session || session.ownerUserId !== userId || session.visibility !== "private" || session.intentType !== "assistant") return [];
  const { relationshipId, partnerId } = scope;
  // Match the caption router's per-turn limit: a second, shorter cutoff silently lost facts and corrections at the end.
  const lines = (rows || []).map((row, index) => ({ id: `${noteId}:${index}`, from: row.role === "agent" ? "Pinky" : "A", text: squash(row.text).slice(0, 2000), createdAt: at })).filter((line) => line.text);
  const answers = lines.filter((line) => line.from === "A");
  if (!answers.length) return [];
  const label = (subjectUserId) => subjectUserId === userId ? "A" : isPartner(subjectUserId, userId, partnerId) ? "B" : "both";
  const known = knownFor(await store.listRelationshipRecordsForUser("memories", userId), userId, relationshipId, label);
  const input = { known, messages: lines.map((line) => ({ id: line.id, from: line.from, text: line.text, isNew: line.from === "A" })) };
  const result = await mediator.structured({ name: "couple_profile", schema: interviewSchema, instructions: instructions({ a: scope.a, b: scope.b, privateChat: true }) + (interview ? INTERVIEW : CALL) + CALL_EVIDENCE, input: JSON.stringify(input), maxOutputTokens: 1800 });
  const findings = verifyFacts(result?.facts, answers, () => true);
  return store.transaction(scope.lock, async (tx) => {
    if ((await memberScope(tx, userId)).relationshipId !== relationshipId) return [];
    const changed = await keepFacts(tx, { relationshipId, userId, visibility: "private", ownerUserId: userId, subjectOf: (subject) => subject === "A" ? userId : subject === "B" ? partnerId : null, findings, channel: "private", sessionId });
    const language = session.language || "zh", partnerName = scope.b || say(language, "TA", "your partner", "tu pareja");
    if (!changed.length && !interview) return changed;
    const text = changed.length
      ? `${notedText(language, changed, { userId, partnerName: scope.b })}${say(language, `。这些只有你能看到；想让 ${partnerName} 知道哪条，点这里去「关于我们」分享。`, `. Only you see these; tap here to choose any to share with ${partnerName} in About us.`, `. Solo tú los ves; toca aquí para elegir cuáles compartir con ${partnerName} en Sobre nosotros.`)}`
      : say(language, "这次通话没记下新的东西；想补充的，随时跟我说。", "Nothing new to keep from this call; tell me more any time.", "Nada nuevo que guardar de esta llamada; cuéntame más cuando quieras.");
    await tx.updateRelationshipRecordForUser("privateAgentThreads", sessionId, userId, (draft) => {
      draft.messages = [...draft.messages, { id: randomUUID(), role: "assistant", kind: "noted", text, noted: changed.map((item) => item.id), createdAt: new Date().toISOString() }].slice(-200);
    });
    return Object.assign(changed, { sessionId });
  });
}

/** Reads a chat between the member and their partner that the member brought privately (screenshots or pasted text with a
 * question, the reply coach) and keeps what it shows about either of them, privately for the member (founder 11-08: "用得越多
 * 越懂她"). Runs after the answer, so it never slows it down; B's own words are the evidence about B. */
export async function scanBroughtChat({ store, mediator, userId, sessionId, sourceId, messages, at = new Date().toISOString() }) {
  if (!mediator?.structured) return [];
  const session = await store.getRelationshipRecordForUser("privateAgentThreads", sessionId, userId);
  if (!session || session.ownerUserId !== userId || session.visibility !== "private" || session.intentType !== "assistant") return [];
  const lines = (messages || []).slice(-SCAN_LIMIT).map((message, index) => ({ id: `${sourceId}:${index}`, from: message.role === "me" ? "A" : message.role === "partner" ? "B" : null, text: squash(message.text).slice(0, 600), createdAt: at }))
    .filter((line) => line.from && line.text);
  if (!lines.length) return [];
  const scope = await memberScope(store, userId), { relationshipId, partnerId } = scope;
  const label = (subjectUserId) => subjectUserId === userId ? "A" : isPartner(subjectUserId, userId, partnerId) ? "B" : "both";
  const known = knownFor(await store.listRelationshipRecordsForUser("memories", userId), userId, relationshipId, label);
  const input = { known, messages: lines.map((line) => ({ id: line.id, from: line.from, date: localDay(line.createdAt, session.timezone), text: line.text, isNew: true })) };
  const result = await mediator.structured({ name: "couple_profile", schema, instructions: instructions({ a: scope.a, b: scope.b, between: true }), input: JSON.stringify(input), maxOutputTokens: 900 });
  const findings = verifyFacts(result?.facts, lines, () => true);
  if (!findings.length) return [];
  return store.transaction(scope.lock, async (tx) => {
    if ((await memberScope(tx, userId)).relationshipId !== relationshipId) return [];
    const changed = await keepFacts(tx, { relationshipId, userId, visibility: "private", ownerUserId: userId, subjectOf: (subject) => subject === "A" ? userId : subject === "B" ? partnerId : null, findings, channel: "private", sessionId });
    if (changed.length) await tx.updateRelationshipRecordForUser("privateAgentThreads", sessionId, userId, (draft) => {
      draft.messages = [...draft.messages, { id: randomUUID(), role: "assistant", kind: "noted", text: notedText(session.language || "zh", changed, { userId, partnerName: scope.b }), noted: changed.map((item) => item.id), createdAt: new Date().toISOString() }].slice(-200);
    });
    return Object.assign(changed, { sessionId });
  });
}

/** Reads the new lines of Us and keeps what they reveal as shared facts that belong to both. */
export async function scanTogetherProfile({ store, mediator, relationshipId, userId }) {
  if (!mediator?.structured) return [];
  const context = await store.getRelationshipContext(userId);
  if (!activePair(context, relationshipId)) return [];
  const conversation = await store.getRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, userId);
  const messages = conversation?.messages || [];
  const { fresh, more, last, before } = freshLines(messages, conversation?.profileScan, (item) => item.role === "member" && item.kind === "text" && Boolean(squash(item.text)));
  if (!last || (!fresh.length && conversation.profileScan?.messageId === last.id)) return [];
  const byRole = (role) => context.members.find((member) => member.role === role);
  let findings = [];
  if (fresh.length) {
    const from = (item) => item.role === "agent" ? "Pinky" : context.members.find((member) => member.userId === item.actorUserId)?.role || "?";
    const label = (subjectUserId) => subjectUserId ? context.members.find((member) => member.userId === subjectUserId)?.role || "both" : "both";
    const known = knownFor(await store.listRelationshipRecordsForUser("memories", userId), userId, relationshipId, label).filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index);
    const input = { known, messages: [...before.map((item) => ({ id: item.id, from: from(item), text: String(item.text).slice(0, 600), isNew: false })), ...fresh.map((item) => ({ id: item.id, from: from(item), date: String(item.createdAt || "").slice(0, 10), text: String(item.text).slice(0, 1200), isNew: true }))] };
    const result = await mediator.structured({ name: "couple_profile", schema, instructions: instructions({ a: byRole("A")?.user?.name || "", b: byRole("B")?.user?.name || "", privateChat: false }), input: JSON.stringify(input), maxOutputTokens: 900 });
    findings = verifyFacts(result?.facts, fresh, (line) => context.members.some((member) => member.userId === line.actorUserId));
  }
  return store.transaction(`relationship:${relationshipId}`, async (tx) => {
    const current = await tx.getRelationshipContext(userId);
    if (!activePair(current, relationshipId)) return [];
    const changed = await keepFacts(tx, { relationshipId, userId, visibility: "shared", ownerUserId: null, memberUserIds: current.members.map((member) => member.userId), subjectOf: (subject) => subject === "both" ? null : byRole(subject)?.userId || null, findings, channel: "together" });
    await tx.updateRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, userId, (draft) => { draft.profileScan = { messageId: last.id, at: last.createdAt }; });
    return Object.assign(changed, { more });
  });
}

function notedText(language, facts, { userId, partnerName }) {
  const who = (fact) => fact.subjectUserId === userId ? say(language, "你", "you", "tú") : fact.subjectUserId ? partnerName || say(language, "TA", "your partner", "tu pareja") : say(language, "你们", "you two", "ustedes");
  const list = facts.slice(0, 3).map((fact) => say(language, `${who(fact)}${/[A-Za-z0-9]$/.test(who(fact)) ? " " : ""}${fact.text}`, `${who(fact)}: ${fact.text}`, `${who(fact)}: ${fact.text}`)).join(say(language, "；", "; ", "; "));
  // Pinky's own reply may already say it will remember; this line says where it went, so it never just repeats it.
  return say(language, `已记进「关于我们」：${list}`, `Kept in About us: ${list}`, `Guardado en Sobre nosotros: ${list}`) + (facts.length > 3 ? say(language, ` 等 ${facts.length} 条`, ` and ${facts.length - 3} more`, ` y ${facts.length - 3} más`) : "");
}

/** What Pinky knows, for this member's own conversations: their notes and what is shared with them. */
export async function profileContext(store, userId) {
  const context = await store.getRelationshipContext(userId);
  const relationshipId = activePair(context) ? context.relationship.id : null;
  const partner = relationshipId ? context.members.find((member) => member.userId !== userId) : null;
  const records = (await store.listRelationshipRecordsForUser("memories", userId)).filter((item) => visibleTo(item, userId, relationshipId) || (item.kind === "memory" && item.visibility === "private" && item.ownerUserId === userId && item.aiAccessScope === "private" && item.status === "active" && !item.archivedAt));
  const line = (item) => ({ id: item.id, version: item.version, category: item.category || "other", fact: item.text, ...(item.visibility !== "private" ? { from: item.evidence?.channel === "together" ? "said together in Us" : "they shared it with you" } : {}) });
  const pick = (test) => records.filter(test).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, CONTEXT_LIMIT).map(line);
  // What happened between them is its own list, newest first by the date it starts with, so a month-old fight is still
  // there after many new preferences (founder 11-08: a month later Pinky must still remember last month's talks).
  const history = records.filter((item) => isProfileFact(item) && item.category === "history").sort((a, b) => historyDay(b.text).localeCompare(historyDay(a.text)) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, HISTORY_LIMIT).map(line);
  const lasting = (item) => !isProfileFact(item) || item.category !== "history";
  return {
    me: pick((item) => lasting(item) && isProfileFact(item) && item.subjectUserId === userId),
    partner: pick((item) => lasting(item) && isProfileFact(item) && isPartner(item.subjectUserId, userId, partner?.userId || null)),
    us: pick((item) => lasting(item) && (!isProfileFact(item) || !item.subjectUserId)),
    history,
  };
}

/** One fact as this member sees it. */
export function projectFact(record, userId) {
  const mine = record.visibility === "private";
  return {
    id: record.id, version: record.version, text: record.text, category: record.category, subject: record.subjectUserId === userId ? "me" : record.subjectUserId ? "partner" : "us",
    source: mine ? "mine" : record.evidence?.channel === "together" ? "together" : record.ownerUserId === userId ? "i_shared" : "partner_shared",
    quote: mine || record.evidence?.channel === "together" ? record.evidence?.quote || null : null, sharedAt: record.sharedAt || null, updatedAt: record.updatedAt,
  };
}

const shareDigest = (record) => createHash("sha256").update(JSON.stringify([record.id, record.version, record.text])).digest("hex");

/** 关于我们: see, correct, remove and share what Pinky keeps about each of them. */
export function createProfileRouter({ store, emit = () => {} }) {
  const router = express.Router();
  const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
  const language = (req) => ["en", "es"].includes(req.body?.language || req.query?.language) ? req.body?.language || req.query?.language : "zh";
  router.use("/profile", (req, res, next) => req.auth ? next() : res.status(401).json({ error: "Please sign in." }));
  const scope = async (db, userId) => { const context = await db.getRelationshipContext(userId); return activePair(context) ? context : null; };
  const find = async (db, req) => {
    const context = await scope(db, req.auth.user.id);
    const record = await db.getRelationshipRecordForUser("memories", req.params.id, req.auth.user.id);
    if (!visibleTo(record, req.auth.user.id, context?.relationship.id || null)) throw fail(404, say(language(req), "没有找到这一条。", "This was not found.", "No se encontró."));
    if (req.body?.expectedVersion !== record.version) throw fail(409, say(language(req), "这一条刚刚变了，请刷新再试。", "This just changed. Refresh and try again.", "Esto acaba de cambiar. Actualiza e inténtalo de nuevo."));
    return { record, context };
  };
  const lock = async (req) => { const context = await scope(store, req.auth.user.id); return context ? `relationship:${context.relationship.id}` : `user:${req.auth.user.id}`; };
  const changed = (record) => emit(record, "profile.updated", record.visibility === "private" ? record.ownerUserId : null);

  router.get("/profile", async (req, res) => {
    const userId = req.auth.user.id, context = await scope(store, userId);
    const facts = (await store.listRelationshipRecordsForUser("memories", userId)).filter((item) => visibleTo(item, userId, context?.relationship.id || null)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((item) => projectFact(item, userId));
    res.json({ facts, partnerName: context?.members.find((member) => member.userId !== userId)?.user?.name || null });
  });

  router.patch("/profile/:id", async (req, res) => {
    const text = clean(req.body?.text, 160);
    if (!text) throw fail(400, say(language(req), "写一句吧。", "Write something.", "Escribe algo."));
    const record = await store.transaction(await lock(req), async (tx) => {
      const { record: current } = await find(tx, req);
      if (current.visibility !== "private") throw fail(403, say(language(req), "一起说过或对方分享的，只能删掉，不能改。", "Things said together or shared with you can be removed, not edited.", "Lo dicho juntos o compartido contigo se puede quitar, no editar."));
      return tx.updateRelationshipRecordForUser("memories", current.id, req.auth.user.id, (draft) => { draft.text = text; if (CATEGORIES.includes(req.body?.category)) draft.category = req.body.category; draft.provenance = { ...draft.provenance, correctedByUserId: req.auth.user.id, correctedAt: new Date().toISOString() }; draft.version += 1; });
    });
    changed(record); res.json({ fact: projectFact(record, req.auth.user.id) });
  });

  // Remove: a private note is deleted; a shared one is archived for both (either may remove what was said in Us; only the
  // person who shared a line about themselves may take it back).
  router.delete("/profile/:id", async (req, res) => {
    const userId = req.auth.user.id;
    const record = await store.transaction(await lock(req), async (tx) => {
      const { record: current } = await find(tx, req);
      if (current.visibility === "private") { await tx.deleteRelationshipRecordForUser("memories", current.id, userId); if (current.sharedCopyId) await archive(tx, current.sharedCopyId, userId); return current; }
      if (current.evidence?.channel !== "together" && current.ownerUserId !== userId) throw fail(403, say(language(req), "这是 TA 分享给你的，只有 TA 能收回。", "Your partner shared this; only they can take it back.", "Tu pareja lo compartió; solo esa persona puede retirarlo."));
      const archived = await archive(tx, current.id, userId);
      if (current.sourceId) await tx.updateRelationshipRecordForUser("memories", current.sourceId, userId, (draft) => { draft.sharedCopyId = null; draft.sharedAt = null; });
      return archived;
    });
    changed(record); res.status(204).end();
  });
  const archive = (tx, id, userId) => tx.updateRelationshipRecordForUser("memories", id, userId, (draft) => { draft.status = "archived"; draft.archivedAt = new Date().toISOString(); draft.aiAccessScope = "none"; draft.version += 1; });

  // Share a line about yourself with your partner. The exact words are shown first and the digest must match them.
  router.post("/profile/:id/share", async (req, res) => {
    const userId = req.auth.user.id;
    const shared = await store.transaction(await lock(req), async (tx) => {
      const { record: current, context } = await find(tx, req);
      if (!context) throw fail(409, say(language(req), "和 TA 连接后才能分享。", "Connect with your partner first.", "Conéctate primero con tu pareja."));
      if (current.visibility !== "private" || current.subjectUserId !== userId) throw fail(403, say(language(req), "只能分享关于你自己的。", "You can only share things about yourself.", "Solo puedes compartir lo que es sobre ti."));
      if (req.body?.confirm !== true || req.body?.digest !== shareDigest(current)) throw fail(409, say(language(req), "请先确认要分享的这句话。", "Confirm the exact words first.", "Confirma primero las palabras exactas."));
      if (current.sharedCopyId) { const copy = await tx.getRelationshipRecordForUser("memories", current.sharedCopyId, userId); if (live(copy)) return copy; }
      const copy = createRelationshipRecord({ relationshipId: context.relationship.id, userId, visibility: "shared", aiAccessScope: "joint", status: "active", kind: PROFILE_KIND, subjectUserId: userId, category: current.category, text: current.text, memberUserIds: context.members.map((member) => member.userId), approvals: [], sourceId: current.id, sharedAt: new Date().toISOString(), evidence: { channel: "shared" } });
      await tx.createRelationshipRecord("memories", copy);
      await tx.createRelationshipRecord("consentEvents", createRelationshipRecord({ relationshipId: context.relationship.id, userId, visibility: "private", aiAccessScope: "none", status: "recorded", objectId: copy.id, objectType: PROFILE_KIND, eventType: "profile.shared", sourceVersion: current.version }));
      await tx.updateRelationshipRecordForUser("memories", current.id, userId, (draft) => { draft.sharedCopyId = copy.id; draft.sharedAt = copy.sharedAt; });
      return copy;
    });
    changed(shared); res.status(201).json({ fact: projectFact(shared, userId) });
  });
  router.get("/profile/:id/share-preview", async (req, res) => {
    const record = await store.getRelationshipRecordForUser("memories", req.params.id, req.auth.user.id);
    if (!live(record) || record.visibility !== "private" || record.ownerUserId !== req.auth.user.id) throw fail(404, "Not found.");
    res.json({ text: record.text, digest: shareDigest(record), version: record.version });
  });
  return router;
}

/** Looks a little after a conversation goes quiet, so a burst of lines costs one model call. */
export function createProfileKeeper({ store, mediator, delayMs = 20_000, emit = () => {} }) {
  const timers = new Map(), running = new Map();
  const run = async (name, task) => {
    if (running.has(name)) { running.set(name, true); return; }
    running.set(name, false);
    try {
      const changed = await task();
      for (const record of changed) emit(record, "profile.updated", record.visibility === "private" ? record.ownerUserId : null);
      if (changed.sessionId && changed.length) {
        const context = await store.getRelationshipContext(changed[0].ownerUserId);
        if (context?.relationship) emit({ id: changed.sessionId, relationshipId: context.relationship.id }, "assistant.updated", changed[0].ownerUserId);
      }
      if (changed.more) running.set(name, true);
    }
    catch (error) { console.error("Profile scan failed:", error?.message || error); }
    finally { const again = running.get(name); running.delete(name); if (again) schedule(name, task); }
  };
  const schedule = (name, task) => {
    clearTimeout(timers.get(name));
    const timer = setTimeout(() => { timers.delete(name); void run(name, task); }, delayMs); timer.unref?.();
    timers.set(name, timer);
  };
  return {
    noteTogether: (relationshipId, userId) => schedule(`together:${relationshipId}`, () => scanTogetherProfile({ store, mediator, relationshipId, userId })),
    notePrivate: (userId, sessionId) => schedule(`private:${sessionId}`, () => scanPrivateProfile({ store, mediator, userId, sessionId })),
    close: () => { for (const timer of timers.values()) clearTimeout(timer); timers.clear(); },
  };
}
