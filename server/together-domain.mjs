import { randomUUID } from "node:crypto";
import { agreementValues, audit, clean, decisionError, markCommitmentsForRenegotiation } from "./agreement-actions.mjs";
import { buildMemoryContext } from "./memory-domain.mjs";
import { createRelationshipRecord, hideUnrevealedAnswers } from "./relationship-domain.mjs";
import { addSpaceItem, archiveSpaceRecord, createSpace, ensureMomentSpaces, MOMENTS, WATCHED, updateSpace, updateSpaceItem, visibleSpace } from "./space-domain.mjs";
import { handoffUrl, isCalendar } from "./handoff.mjs";
import { importContext, searchImport } from "./chat-import.mjs";
import { composeStory } from "./story.mjs";
import { startGame } from "./games.mjs";
import { notTriedYet } from "./discover.mjs";
import { markShowedUp } from "./streak.mjs";

// The relationship-level "together" conversation. App, iMessage group and relay all write through these functions, so
// channel adapters stay thin and every privacy rule lives here once.
const SOURCES = new Set(["app", "imessage", "relay", "voice"]);
// "nudge" is 想你了: one tap, no words (founder 11-06).
const KINDS = new Set(["text", "relay", "agreement_card", "reminder", "review", "call", "story", "daily_question", "nudge", "letter_sealed", "letter", "game", "match_invite", "watch_check"]);
const AGENT_CALL = /\bpinky\b|@agent/i;
const LANGUAGES = new Set(["zh", "en", "es"]);
// The conversation record carries at most MESSAGE_LIMIT messages (the working set every read and prompt sees). What falls off
// the front is not lost: it moves, KEEP_AFTER_ARCHIVE at a time, into archive chunks of up to ARCHIVE_CHUNK messages each,
// which /together/history and the daily question read on demand.
const MESSAGE_LIMIT = 200, KEEP_AFTER_ARCHIVE = 150, ARCHIVE_CHUNK = 200;
const OPEN_COMMITMENTS = new Set(["active", "awaiting_confirmations", "renegotiation_requested"]);
const togetherId = (relationshipId) => `together:${relationshipId}`;
const archiveId = (relationshipId, seq) => `${togetherId(relationshipId)}:archive:${seq}`;

// Pinky's check-in on an agreement ("这周做到了吗？回复我说说看") asks both of them. For a while after it, each member's first
// message in Us is their answer to it, so a plain reply reaches Pinky without @-mentioning it; after that, Pinky waits to be
// called again. Only Pinky's own agreement check-ins open such a window; outcome reviews are answered privately.
const CHECK_IN_REPLY_MS = 12 * 3_600_000;
const isCheckIn = (item) => item?.role === "agent" && item.kind === "review" && (item.refs || []).some((ref) => ref.type === "agreement");
/** The check-in a member's next message answers: the latest one, asked within the window, that they have not written after. */
export function openCheckIn(messages, actorUserId, now = Date.now()) {
  const index = messages.findLastIndex(isCheckIn);
  if (index < 0 || !actorUserId || now - Date.parse(messages[index].createdAt) > CHECK_IN_REPLY_MS) return null;
  return messages.slice(index + 1).some((item) => item.role === "member" && item.actorUserId === actorUserId) ? null : messages[index];
}

/** `repliedTo` is the message `message.replyTo` points at: Pinky answers a reply to its last message or to a check-in. */
export function shouldAgentSpeak(message, { agentLastMessageId = null, repliedTo = null } = {}) {
  if (!message || message.role !== "member") return false;
  return AGENT_CALL.test(String(message.text || "")) || Boolean(agentLastMessageId && message.replyTo === agentLastMessageId) || Boolean(message.replyTo && repliedTo?.id === message.replyTo && isCheckIn(repliedTo));
}

/** Reads only the shared conversation, shared agreements/commitments and jointly approved memories. Never private threads,
 * assistant sessions, perspectives, evaluations, summaries or reminders, even though the caller's snapshot contains them. */
export function buildTogetherContext(snapshot, relationshipId, { userId = null, query = "" } = {}) {
  const conversation = (snapshot.togetherConversations || []).find((item) => item.id === togetherId(relationshipId) && item.relationshipId === relationshipId) || null;
  const agreements = (snapshot.agreements || []).filter((item) => item.relationshipId === relationshipId && item.visibility === "shared" && !item.archivedAt && !item.withdrawnAt);
  const agreement = ({ id, title, summary, terms, unresolvedPoints, status, version, approvedBy, proposedBy }) => ({ id, title, summary, terms, unresolvedPoints: unresolvedPoints || [], status, version, approvedBy: approvedBy || [], proposedBy: proposedBy || null });
  // One pending agreement per couple, whatever path created it (together, full decision flow).
  const pending = agreements.filter((item) => item.status === "awaiting_approvals").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return {
    messages: (conversation?.messages || []).slice(-40).map(({ id, role, actorUserId, kind, text, replyTo, createdAt, photoIds, call, answers }) => ({ id, role, actorUserId, kind, text: call ? `${text}\n${call.rows.map((row) => `${row.role === "agent" ? "Pinky" : "Speaker"}: ${row.text}`).join("\n")}`.slice(-4000) : text, replyTo, createdAt, ...(photoIds?.length ? { photoIds } : {}),
      // A daily question carries its answers only once both have answered; before that neither answer reaches the model.
      ...(answers && Object.keys(answers).length >= 2 ? { answers: Object.entries(answers).map(([userId, answer]) => ({ userId, text: answer.text })) } : {}) })),
    activeAgreements: agreements.filter((item) => item.status === "active").map(agreement),
    openCommitments: (snapshot.commitments || []).filter((item) => item.relationshipId === relationshipId && item.visibility === "shared" && OPEN_COMMITMENTS.has(item.status) && !item.archivedAt).map(({ id, agreementId, description, ownerType, status, dueAt }) => ({ id, agreementId, description, ownerType, status, dueAt })),
    pendingAgreement: pending ? agreement(pending) : null,
    // Promises noticed in Us that are still owed ("还欠着什么"); a member's private ones never reach the shared Agent.
    // 喜好档案: only facts both of them can see (said together in Us, or one shared about themselves); never private notes.
    sharedProfile: (snapshot.memories || []).filter((item) => item.kind === "profile" && item.relationshipId === relationshipId && item.visibility === "shared" && item.status === "active" && !item.archivedAt).slice(0, 80).map(({ subjectUserId, category, text }) => ({ about: subjectUserId || null, category, fact: text })),
    noticedPromises: (snapshot.commitments || []).filter((item) => item.relationshipId === relationshipId && item.visibility === "shared" && item.origin === "conversation" && item.status === "noticed" && !item.archivedAt).slice(0, 20).map(({ id, description, whenText, ownerType }) => ({ id, description, when: whenText || "", ownerType })),
    authorizedMemories: userId ? buildMemoryContext(snapshot.memories || [], { userId, relationshipId, scope: "joint", query }).memories : [],
    spaces: (snapshot.spaces || []).filter((space) => space.relationshipId === relationshipId && space.visibility === "shared" && !space.archivedAt).slice(0, 30).map((space) => ({
      id: space.id, title: space.system === MOMENTS ? "memories (回忆 / recuerdos)" : space.system === WATCHED ? "watched together (一起看过的 / vistos juntos)" : space.title, layout: space.layout, ...(space.system ? { system: space.system } : {}),
      items: (snapshot.spaceItems || []).filter((item) => item.spaceId === space.id && item.visibility === "shared" && !item.archivedAt).slice(-15).map((item) => ({ id: item.id, title: item.title || String(item.text || "").slice(0, 80), date: item.date, done: item.done })),
    })),
    // Chat-history analyses only as the shared copies both partners approved; never a member's private import.
    chatHistory: importContext((snapshot.chatImports || []).filter((item) => item.relationshipId === relationshipId && item.visibility === "shared" && !item.archivedAt)),
    sharedDates: (snapshot.milestones || []).filter((item) => item.relationshipId === relationshipId && item.visibility === "shared" && !item.archivedAt).slice(0, 30).map(({ id, title, date, recurringRule }) => ({ id, title, date, recurringRule })),
    safety: { rule: "Use only this shared context. Never quote or imply either person's private conversations, judge who is right, or approve on anyone's behalf." },
  };
}

/** Exactly one conversation per relationship, created lazily inside the caller's relationship transaction. */
export async function ensureTogetherConversation(tx, { relationshipId, userId }) {
  const existing = await tx.getRelationshipRecordForUser("togetherConversations", togetherId(relationshipId), userId);
  if (existing) return { conversation: existing, created: false };
  const record = createRelationshipRecord({ relationshipId, userId, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "active", messages: [], agentLastMessageId: null, draftAgreement: null });
  record.id = togetherId(relationshipId);
  return { conversation: await tx.createRelationshipRecord("togetherConversations", record), created: true };
}

/** System copy in every interface language, so each reader sees it in their own; `text` stays the trigger language. */
export function togetherI18n(build) { return Object.fromEntries([...LANGUAGES].map((language) => [language, build(language)])); }
const cleanI18n = (value) => value && typeof value === "object" && [...LANGUAGES].every((language) => typeof value[language] === "string") ? Object.fromEntries([...LANGUAGES].map((language) => [language, clean(value[language], 4000)])) : null;

// `userId` is the member whose access scope performs the write; it defaults to the author and is required for agent turns.
// `i18n` is only for the Agent's fixed system copy; each variant carries exactly the same shared fields as `text`.
// `answersCheckIn`: a member's turn without a `replyTo` of its own answers an open check-in (see openCheckIn).
export async function appendTogetherMessage(tx, { relationshipId, actorUserId = null, userId = actorUserId, source, kind = "text", text, handle = null, refs = [], replyTo = null, i18n = null, photoIds = [], recordedByUserId = null, call = null, story = null, watch = null, answersCheckIn = false }) {
  const body = clean(text, 4000);
  if (!body && !photoIds.length) throw decisionError(400, "message_required");
  if (!SOURCES.has(source) || !KINDS.has(kind) || !userId) throw decisionError(400, "message_required");
  const { conversation } = await ensureTogetherConversation(tx, { relationshipId, userId });
  const key = clean(handle, 200) || null;
  const duplicate = key && conversation.messages.find((item) => item.handle === key);
  if (duplicate) return { conversation, message: duplicate, duplicate: true };
  const repliesTo = replyTo && conversation.messages.some((item) => item.id === replyTo) ? replyTo : answersCheckIn && actorUserId ? openCheckIn(conversation.messages, actorUserId)?.id || null : null;
  const message = {
    id: randomUUID(), role: actorUserId ? "member" : "agent", actorUserId: actorUserId || null, source, kind, text: body,
    refs: Array.isArray(refs) ? refs.slice(0, 8) : [], handle: key, replyTo: repliesTo, createdAt: new Date().toISOString(),
    ...(!actorUserId && cleanI18n(i18n) ? { i18n: cleanI18n(i18n) } : {}),
    ...(photoIds.length ? { photoIds: photoIds.slice(0, 6) } : {}),
    ...(recordedByUserId && recordedByUserId !== actorUserId ? { recordedByUserId } : {}),
    // A finished voice call keeps its captions on the message; both partners were part of it.
    ...(kind === "call" && call ? { call } : {}),
    ...(kind === "story" && story ? { story } : {}),
    // 看完了吗: the show they planned to watch together, asked about the next day (watched.mjs).
    ...(kind === "watch_check" && watch ? { watch } : {}),
  };
  const appended = await tx.updateRelationshipRecordForUser("togetherConversations", conversation.id, userId, (draft) => {
    draft.messages = [...(draft.messages || []), message];
    if (message.role === "agent") draft.agentLastMessageId = message.id;
    draft.version += 1;
  });
  // 连续一起来: saying anything in Us is showing up that day (streak.mjs), in the member's own time zone.
  if (message.role === "member") await markShowedUp(tx, { relationshipId, userId: actorUserId, zone: conversation.zones?.[actorUserId] });
  const updated = appended.messages.length > MESSAGE_LIMIT ? await archiveOldestMessages(tx, appended, userId) : appended;
  return { conversation: updated, message, duplicate: false };
}

/** Moves the oldest messages of an over-full working set into the newest archive chunk (or a new one), in the caller's
 * transaction, so the two writes land together. Chunks are shared records of the couple, like the conversation itself. */
async function archiveOldestMessages(tx, conversation, userId) {
  const { relationshipId } = conversation, moving = conversation.messages.slice(0, conversation.messages.length - KEEP_AFTER_ARCHIVE);
  const chunks = conversation.archived?.chunks || 0;
  const latest = chunks ? await tx.getRelationshipRecordForUser("togetherArchives", archiveId(relationshipId, chunks), userId) : null;
  let seq = chunks;
  if (latest && latest.messages.length + moving.length <= ARCHIVE_CHUNK) {
    await tx.updateRelationshipRecordForUser("togetherArchives", latest.id, userId, (draft) => { draft.messages = [...draft.messages, ...moving]; draft.lastAt = moving.at(-1).createdAt; });
  } else {
    seq += 1;
    const chunk = createRelationshipRecord({ relationshipId, userId, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "active", provenanceSource: "system", conversationId: conversation.id, seq, messages: moving, firstAt: moving[0].createdAt, lastAt: moving.at(-1).createdAt });
    chunk.id = archiveId(relationshipId, seq);
    await tx.createRelationshipRecord("togetherArchives", chunk);
  }
  // Bookkeeping, no version bump: nobody's turn in Us conflicts with the archive moving underneath it.
  return tx.updateRelationshipRecordForUser("togetherConversations", conversation.id, userId, (draft) => {
    draft.messages = draft.messages.slice(moving.length);
    draft.archived = { chunks: seq, messages: (draft.archived?.messages || 0) + moving.length };
  });
}

/** Up to `limit` messages older than the message `before` (an id the reader already has), oldest first, with `more` when
 * older ones remain. The working set is searched first, then each archive chunk from the newest down; a page may span
 * several. Answers to a daily question are hidden exactly as in the live conversation. */
export async function olderTogetherMessages(store, { relationshipId, userId, before, limit = 50 }) {
  const conversation = await store.getRelationshipRecordForUser("togetherConversations", togetherId(relationshipId), userId);
  if (!conversation || !before) return { messages: [], more: false };
  const chunks = conversation.archived?.chunks || 0, page = [];
  let seq = chunks + 1, list = conversation.messages || [], end = list.findIndex((item) => item.id === before), found = end >= 0;
  while (true) {
    if (end >= 0) {
      const take = list.slice(Math.max(0, end - (limit - page.length)), end);
      page.unshift(...take); end -= take.length;
      if (page.length >= limit) return { messages: hideUnrevealedAnswers({ messages: page }, userId).messages, more: end > 0 || seq > 1 };
    }
    if (seq <= 1) return { messages: hideUnrevealedAnswers({ messages: page }, userId).messages, more: false };
    seq -= 1; list = (await store.getRelationshipRecordForUser("togetherArchives", archiveId(relationshipId, seq), userId))?.messages || [];
    // Once `before` was found, every older chunk is read from its end; until then each chunk is searched for it.
    end = found ? list.length : list.findIndex((item) => item.id === before); found = found || end >= 0;
  }
}

/** The daily questions asked so far, oldest first: those still in the working set, then as many archive chunks back as it
 * takes to reach `limit`, so a question is never repeated just because the conversation moved past it. */
export async function previousDailyQuestions(store, { relationshipId, userId, limit = 120 }) {
  const conversation = await store.getRelationshipRecordForUser("togetherConversations", togetherId(relationshipId), userId);
  if (!conversation) return [];
  const asked = (list) => (list || []).filter((item) => item.kind === "daily_question").map((item) => item.text);
  let found = asked(conversation.messages);
  for (let seq = conversation.archived?.chunks || 0; seq >= 1 && found.length < limit; seq -= 1) {
    found = [...asked((await store.getRelationshipRecordForUser("togetherArchives", archiveId(relationshipId, seq), userId))?.messages), ...found];
  }
  return found.slice(-limit);
}

/** One member turn in the together conversation, shared by every channel (App, iMessage). The member's words are saved
 * before the model is called so a slow or failed reply never loses them; repeating the same `handle` re-runs only a missing
 * Agent reply. `emit` receives each changed conversation. Returns { conversation, message, reply|null, duplicate }. */
export async function continueTogetherTurn({ store, mediator, relationshipId, actorUserId, recordedByUserId = null, text, photoIds = [], timezone = "UTC", source = "app", handle = null, replyTo = null, language = "zh", emit = () => {}, notifyPrivate = () => {}, progress = () => {} }) {
  // Every write re-checks membership inside the relationship lock; an ended relationship is read-only.
  const transaction = (action) => store.transaction(`relationship:${relationshipId}`, async (tx) => {
    const context = await tx.getRelationshipContext(actorUserId);
    if (!context || context.relationship.id !== relationshipId || context.relationship.status !== "active" || context.members.length !== 2) throw decisionError(409, "relationship_changed");
    return action(tx);
  });
  const saved = await transaction((tx) => appendTogetherMessage(tx, { relationshipId, actorUserId, source, kind: "text", text, handle, replyTo, photoIds, recordedByUserId, answersCheckIn: true }));
  const { message } = saved, messages = saved.conversation.messages;
  // The Agent that was last to speak before this turn, so a retried turn is judged exactly as it was the first time.
  const agentLastMessageId = messages.slice(0, messages.findIndex((item) => item.id === message.id)).findLast((item) => item.role === "agent")?.id || null;
  const answered = (conversation) => conversation.messages.find((item) => item.role === "agent" && item.replyTo === message.id);
  if (!saved.duplicate) emit(saved.conversation);
  const repliedTo = message.replyTo ? messages.find((item) => item.id === message.replyTo) || null : null;
  if (!shouldAgentSpeak(message, { agentLastMessageId, repliedTo }) || (saved.duplicate && answered(saved.conversation))) return { conversation: saved.conversation, message, reply: null, duplicate: saved.duplicate };
  // From here Pinky works on a reply both of them will see; `progress` tells the App which step it is on (the caller ends it).
  progress("thinking");
  await ensureMomentSpaces(store, actorUserId);
  const membership = await store.getRelationshipContext(actorUserId);
  const members = (membership?.members || []).map((member) => ({ id: member.userId, name: member.user?.name || "" }));
  const built = buildTogetherContext(await store.relationshipSnapshotForUser(actorUserId), relationshipId, { userId: actorUserId, query: message.text });
  // Each line says who wrote it, so the Agent answers the right person by name.
  const name = (id) => members.find((member) => member.id === id)?.name || "";
  // Each open commitment says whose it is, so an answer to a check-in is recorded against the writer's own part only.
  const owner = (ownerType) => ownerType === "both" ? "both" : (membership?.members || []).find((member) => ownerType === `member_${String(member.role).toLowerCase()}`)?.user?.name || "";
  const context = { ...built, messages: built.messages.map((item) => ({ ...item, from: item.role === "agent" ? "Pinky" : name(item.actorUserId), ...(item.answers ? { answers: item.answers.map((answer) => ({ from: name(answer.userId), text: answer.text })) } : {}) })), openCommitments: built.openCommitments.map((item) => ({ ...item, owner: owner(item.ownerType) })), sharedProfile: built.sharedProfile.map((item) => ({ ...item, about: item.about ? name(item.about) : "both" })), notTriedYet: await notTriedYet(store, actorUserId, "us").catch(() => []) };
  // Today in the writer's time zone, with its weekday, so "this Sunday" becomes the right date on the calendar (founder 11-06).
  const zone = await import("./reminder-service.mjs").then((module) => module.memberTimezone(store, actorUserId)).catch(() => null) || "UTC";
  const today = `${new Date().toLocaleDateString("en-CA", { timeZone: zone })} (${new Date().toLocaleDateString("en-US", { weekday: "long", timeZone: zone })})`;
  // Each member's own time zone (异地), so a plan to watch together can name the time on both sides.
  const zones = Object.fromEntries((await Promise.all(members.map(async (member) => [member.name, await import("./reminder-service.mjs").then((module) => module.memberTimezone(store, member.id)).catch(() => null)]))).filter(([, value]) => value));
  let turn = await mediator.continueTogether({ ...context, today, ...(Object.keys(zones).length ? { timezones: zones } : {}), webSearch: Boolean(mediator.webSearch) }, language);
  // Real-world questions: look them up, then let the Agent answer once more with the findings. Searches never run twice.
  const searches = (turn.actions || []).filter((action) => action.kind === "web_search" && action.text && mediator.lookup || action.kind === "chat_search" && context.chatHistory.some((item) => item.id === action.targetId)).slice(0, 3);
  if (searches.length) {
    const web = searches.find((action) => action.kind === "web_search");
    progress(web ? "searching_web" : "searching_chats", web?.text || null);
    const sharedImport = async (id) => (await store.relationshipSnapshotForUser(actorUserId)).chatImports?.find((item) => item.id === id && item.relationshipId === relationshipId && item.visibility === "shared" && !item.archivedAt);
    const lookups = await Promise.all(searches.map(async (action) => action.kind === "chat_search"
      ? { query: `chat history ${action.text || ""} ${action.date || ""}`.trim(), findings: await sharedImport(action.targetId).then((record) => record ? searchImport(record, { query: action.text || "", date: action.date || "" }) : "Not available.").catch(() => "Not available.") }
      : { query: action.text, findings: await mediator.lookup(action.text, language).catch(() => "No results: the search failed.") }));
    progress("writing");
    turn = await mediator.continueTogether({ ...context, today, webSearch: true, lookups }, language);
  }
  turn = { ...turn, actions: (turn.actions || []).filter((action) => !["web_search", "chat_search"].includes(action.kind)) };
  // Mediation: a shared reflection replaces the reply, and each partner gets private feedback in their own chat.
  if (turn.actions.some((action) => action.kind === "mediate") && mediator.mediateTogether) {
    progress("mediating");
    const mediation = await mediator.mediateTogether(context, members, language);
    if (mediation) turn = { ...turn, reply: mediation.shared, i18n: null, actions: [...turn.actions, { kind: "private_notes", notes: mediation.feedback }] };
  }
  // A recap card is made after the reply, in the background (it takes a little while), and posted here when ready.
  const recaps = turn.actions.filter((action) => action.kind === "recap");
  // A game card follows the reply; its round is written separately (小游戏).
  const games = turn.actions.filter((action) => action.kind === "game");
  turn = { ...turn, actions: turn.actions.filter((action) => !["mediate", "recap", "game"].includes(action.kind)) };
  const reply = (outcome) => transaction(async (tx) => {
    // A concurrent retry may have answered while the model was thinking: keep exactly one reply.
    const { conversation: current } = await ensureTogetherConversation(tx, { relationshipId, userId: actorUserId });
    const existing = answered(current); if (existing) return { conversation: current, message: existing, duplicate: true };
    const made = await applyTogetherActions(tx, { relationshipId, userId: actorUserId, actions: outcome.actions || [], asked, timezone, language });
    const result = await appendTogetherMessage(tx, { relationshipId, actorUserId: null, userId: actorUserId, source, kind: "text", text: outcome.reply, i18n: outcome.i18n || null, refs: [...made, ...context.authorizedMemories.map(({ id, version }) => ({ type: "memory", id, version }))], replyTo: message.id });
    if (!outcome.draftAgreement) return result;
    const conversation = await tx.updateRelationshipRecordForUser("togetherConversations", result.conversation.id, actorUserId, (draft) => { draft.draftAgreement = { ...outcome.draftAgreement, messageId: result.message.id, source: outcome.source, createdAt: new Date().toISOString() }; draft.version += 1; });
    return { ...result, conversation };
  });
  // Actions and reply land together or not at all; if an action cannot be applied, say so instead of claiming it.
  const asked = [];
  if (turn.actions.length || turn.draftAgreement) progress("acting");
  let replied;
  try { replied = await reply(turn); }
  catch (error) {
    if (!turn.actions?.length) throw error;
    asked.length = 0;
    const failed = { zh: "抱歉，这件事我没能办成，什么都没有改动。可以换个说法再试一次。", en: "Sorry, I couldn't do that, and nothing was changed. Try saying it another way.", es: "Lo siento, no pude hacerlo y no se cambió nada. Prueba a decirlo de otra forma." };
    replied = await reply({ reply: failed[language] || failed.zh, i18n: failed, actions: [], draftAgreement: null, source: "local" });
  }
  if (!replied.duplicate) emit(replied.conversation);
  if (!replied.duplicate && games.length) void startGame({ store, mediator, relationshipId, userId: actorUserId, type: games[0].title, language, emit });
  if (!replied.duplicate && recaps.length) void composeStory({ store, mediator, relationshipId, userId: actorUserId, language, occasion: recaps[0].title || "", key: `asked-${message.id}`, emit });
  for (const session of asked) notifyPrivate(session);
  return { conversation: replied.conversation, message, reply: replied.message, duplicate: saved.duplicate };
}

/** The agent speaks in the shared conversation on its own only for real business: an agreement card, a due joint reminder,
 * a due outcome review. Messages are role "agent"; a deterministic `handle` makes every retry or repeated tick a no-op.
 * `text` must only contain shared content. */
/** What the shared Agent may change for both partners, applied in the same transaction as its reply. Returns refs the
 * conversation shows as links. Only shared spaces and dates of this couple; nothing private, nothing needing two approvals. */
async function applyTogetherActions(tx, { relationshipId, userId, actions, asked = [], timezone = "UTC", language = "zh" }) {
  const refs = []; let created = null;
  for (const action of actions) {
    if (action.kind === "link") {
      const calendar = isCalendar(action.text, action.localDateTime);
      const url = handoffUrl({ url: calendar ? null : action.text, localDateTime: calendar ? action.localDateTime : null, title: action.title || "", location: calendar ? action.text || "" : "", timezone });
      if (url && action.title) refs.push({ type: "link", id: randomUUID(), title: action.title.slice(0, 60), url });
      continue;
    }
    if (action.kind === "private_notes") {
      // Mediation feedback: each note goes only to its own member's private chat.
      const context = await tx.getRelationshipContext(userId);
      for (const note of action.notes || []) {
        if (!context?.members.some((member) => member.userId === note.memberId)) continue;
        const session = await privateSessionFor(tx, note.memberId);
        const header = { zh: "Pinky 给你的私下反馈（只有你能看到）", en: "Private feedback from Pinky (only you can see this)", es: "Comentario privado de Pinky (solo tú puedes verlo)" }[session.language] || "Pinky 给你的私下反馈（只有你能看到）";
        const updated = await tx.updateRelationshipRecordForUser("privateAgentThreads", session.id, note.memberId, (draft) => {
          draft.messages = [...(draft.messages || []), { id: randomUUID(), role: "assistant", text: `${header}\n\n${clean(note.text, 2000)}`, askedFrom: "mediation", createdAt: new Date().toISOString() }].slice(-200);
          draft.version += 1;
        });
        asked.push({ id: updated.id, version: updated.version, ownerUserId: note.memberId, relationshipId });
      }
      continue;
    }
    if (action.kind === "ask_privately") {
      // The question comes from the shared conversation only; each answer stays in its owner's private chat.
      const question = clean(action.text, 600); if (!question || asked.length) continue;
      const context = await tx.getRelationshipContext(userId);
      for (const member of context?.members || []) {
        const session = await privateSessionFor(tx, member.userId);
        if (!session) continue;
        const updated = await tx.updateRelationshipRecordForUser("privateAgentThreads", session.id, member.userId, (draft) => {
          draft.messages = [...(draft.messages || []), { id: randomUUID(), role: "assistant", text: question, askedFrom: "together", plannerQuestion: true, createdAt: new Date().toISOString() }].slice(-200);
          draft.version += 1;
        });
        asked.push({ id: updated.id, version: updated.version, ownerUserId: member.userId, relationshipId });
      }
      continue;
    }
    if (action.kind === "commitment") {
      // An answer to a check-in records the writer's own part only, never their partner's: each principal speaks for themselves.
      const current = await tx.getRelationshipRecordForUser("commitments", action.targetId || "", userId);
      if (!current || current.relationshipId !== relationshipId || current.visibility !== "shared" || current.archivedAt || !OPEN_COMMITMENTS.has(current.status) || typeof action.done !== "boolean") throw decisionError(404, "not_found");
      const members = (await tx.getRelationshipContext(userId))?.members || [];
      const responsible = members.filter((member) => current.ownerType === "both" || current.ownerType === `member_${String(member.role).toLowerCase()}`).map((member) => member.userId);
      if (!responsible.includes(userId)) throw decisionError(403, "responsible_only");
      const at = new Date().toISOString(), note = clean(action.text, 800);
      const record = await tx.updateRelationshipRecordForUser("commitments", current.id, userId, (draft) => {
        draft.checkIns = [...(draft.checkIns || []), { userId, kept: action.done, note, at }].slice(-20);
        // A one-off commitment the writer kept is done for them (done for good once everyone responsible kept it); a standing
        // rule without a due date ("every Wednesday") stays in force and only keeps the check-in.
        if (action.done && draft.dueAt && draft.status === "active" && !(draft.completedBy || []).includes(userId)) {
          draft.completedBy = [...(draft.completedBy || []), userId];
          draft.completionEvidenceByUser = { ...(draft.completionEvidenceByUser || {}), [userId]: note };
          if (responsible.every((id) => draft.completedBy.includes(id))) { draft.status = "completed"; draft.completedAt = at; }
        }
      });
      await audit(tx, record, userId, action.done ? "commitment.check_in_kept" : "commitment.check_in_missed");
      refs.push({ type: "commitment", id: record.id, version: record.version, title: record.description });
      continue;
    }
    if (action.kind === "milestone") {
      if (action.operation !== "create") continue;
      if (!action.title || !action.date) throw decisionError(400, "message_required");
      // The day they got together is one date per couple: telling Pinky again moves it rather than adding another.
      if (action.text === "together_since") {
        const record = await setTogetherSince(tx, { relationshipId, userId, date: action.date, title: action.title });
        refs.push({ type: "milestone", id: record.id, version: record.version, title: record.title }); continue;
      }
      // 异地: the next time they meet is a "meetup" date, counted down in Us and on Coming up.
      const meetup = action.text === "next_meeting";
      const record = createRelationshipRecord({ relationshipId, userId, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "active", type: meetup ? "meetup" : "custom", title: action.title.slice(0, 120), date: action.date, timezone: "UTC", recurringRule: meetup ? "once" : action.recurringRule, jointlyConfirmed: false, notes: action.text || "", provenanceSource: "agent" });
      await tx.createRelationshipRecord("milestones", record); refs.push({ type: "milestone", id: record.id, version: record.version, title: record.title });
      // A shared reminder on the date makes the Agent post it in this conversation when due (reminder-service announces it).
      if (action.remindDaysBefore !== null && action.remindDaysBefore !== undefined) await tx.createRelationshipRecord("reminders", createRelationshipRecord({ relationshipId, userId, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "owner", status: "active", milestoneId: record.id, minutesBefore: action.remindDaysBefore * 1440, channel: "in_app", provenanceSource: "agent" }));
      continue;
    }
    if (action.kind === "space") {
      const record = action.operation === "create" ? created = await createSpace(tx, { userId, relationshipId, shared: true, title: action.title, layout: action.layout, description: action.text || "", source: "agent" })
        : action.operation === "archive" ? await archiveSpaceRecord(tx, { userId, collection: "spaces", id: action.targetId }) : await updateSpace(tx, { userId, id: action.targetId, fields: { title: action.title ?? undefined, layout: action.layout ?? undefined, description: action.text ?? undefined } });
      if (record.visibility !== "shared" || record.relationshipId !== relationshipId) throw decisionError(404, "not_found");
      refs.push({ type: "space", id: record.id, version: record.version, title: record.title, ...(record.system ? { system: record.system } : {}) }); continue;
    }
    let record;
    if (action.operation === "create") {
      const space = action.spaceId ? await visibleSpace(tx, action.spaceId, userId) : created;
      if (!space || space.visibility !== "shared" || space.relationshipId !== relationshipId) throw decisionError(404, "not_found");
      const photo = action.photoId ? await tx.getRelationshipRecordForUser("photos", action.photoId, userId) : null;
      if (action.photoId && (!photo || photo.visibility !== "shared" || photo.relationshipId !== relationshipId || photo.archivedAt)) throw decisionError(404, "not_found");
      record = await addSpaceItem(tx, { userId, space, title: action.title || "", text: action.text || "", date: action.date, done: action.done === true, photoId: photo?.id || null, idea: space.system === "moments" ? action.idea : null, source: "agent" });
      if (!refs.some((ref) => ref.type === "space" && ref.id === space.id)) refs.push({ type: "space", id: space.id, version: space.version, title: space.title, ...(space.system ? { system: space.system } : {}) });
      continue;
    }
    const item = await tx.getRelationshipRecordForUser("spaceItems", action.targetId || "", userId);
    if (!item || item.visibility !== "shared" || item.relationshipId !== relationshipId) throw decisionError(404, "not_found");
    record = action.operation === "archive" ? await archiveSpaceRecord(tx, { userId, collection: "spaceItems", id: item.id }) : await updateSpaceItem(tx, { userId, id: item.id, fields: { title: action.title ?? undefined, text: action.text ?? undefined, date: action.date ?? undefined, done: action.done ?? undefined } });
    const space = await tx.getRelationshipRecordForUser("spaces", item.spaceId, userId);
    if (!refs.some((ref) => ref.type === "space" && ref.id === item.spaceId)) refs.push({ type: "space", id: item.spaceId, version: space?.version || 1, title: space?.title || "", ...(space?.system ? { system: space.system } : {}) });
  }
  return refs.slice(0, 6);
}

/** The member's current App conversation with their own Pinky (never an iMessage-owned one); created if they have none. */
async function privateSessionFor(tx, memberId) {
  const sessions = (await tx.listRelationshipRecordsForUser("privateAgentThreads", memberId)).filter((record) => record.intentType === "assistant" && record.ownerUserId === memberId && record.visibility === "private" && !record.archivedAt && record.status === "active" && !record.channel);
  const latest = sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (latest) return latest;
  const record = createRelationshipRecord({ relationshipId: null, userId: memberId, visibility: "private", aiAccessScope: "private", intentType: "assistant", language: await memberLanguage(tx, memberId), timezone: "UTC", messages: [] });
  await tx.createRelationshipRecord("privateAgentThreads", record);
  return record;
}

export async function announceInTogether(tx, { relationshipId, userId, kind, refs = [], text, i18n = null, handle = null, source = "app" }) {
  if (!["agreement_card", "reminder", "review"].includes(kind)) throw decisionError(400, "message_required");
  return appendTogetherMessage(tx, { relationshipId, actorUserId: null, userId, source, kind, text, i18n, handle, refs });
}

/** Language for agent-initiated copy: the triggering member's explicit choice, else their saved interface language, else their
 * saved reminder-language preference, else zh. */
export async function memberLanguage(tx, userId, hint = null) {
  if (LANGUAGES.has(hint)) return hint;
  const user = await tx.getUserById(userId);
  if (LANGUAGES.has(user?.language)) return user.language;
  const preference = (await tx.listRelationshipRecordsForUser("deliveryPreferences", userId)).find((item) => item.ownerUserId === userId && !item.archivedAt);
  return LANGUAGES.has(preference?.language) ? preference.language : "zh";
}

// Plain words, no version numbers (founder 11-06: "第 5 版" read like a contract); the card itself shows who has said yes.
const CARD_COPY = {
  zh: { title: (t) => `约定「${t}」`, plain: () => "约定", awaiting_approvals: "等你们俩都点头", active: "你们俩都同意了，已经生效", draft: "有人想改，等新的一份", open: "还没定的：", change: (who, why) => why ? `${who || "有人"} 想改：${why}` : `${who || "有人"} 想改一下` },
  en: { title: (t) => `Agreement "${t}"`, plain: () => "Agreement", awaiting_approvals: "waiting for both of you to say yes", active: "you both agreed; it's in effect", draft: "someone wants a change; waiting for a new one", open: "Still open: ", change: (who, why) => why ? `${who || "Someone"} wants a change: ${why}` : `${who || "Someone"} asked for a change` },
  es: { title: (t) => `Acuerdo "${t}"`, plain: () => "Acuerdo", awaiting_approvals: "esperando a que los dos digan que sí", active: "los dos están de acuerdo; ya está en vigor", draft: "alguien quiere cambiarlo; esperando uno nuevo", open: "Pendiente: ", change: (who, why) => why ? `${who || "Alguien"} quiere cambiar: ${why}` : `${who || "Alguien"} pidió un cambio` },
};
// The status line comes first so the 4000-character message cap can only ever trim trailing terms. A change request says
// who asked and why (`changedBy` is that member's name) right under it, so the card never leaves the other partner guessing.
export function agreementCardText(agreement, language = "zh", { changedBy = "" } = {}) {
  const copy = CARD_COPY[language] || CARD_COPY.zh, status = copy[agreement.status] || copy.awaiting_approvals;
  // Title and summary are dropped when they only repeat the terms, so a card never shows the same words three times.
  const terms = agreement.terms || [], heading = agreement.title && agreement.title !== terms[0] ? copy.title(agreement.title) : copy.plain();
  const summary = agreement.summary && agreement.summary !== terms.join(" / ") && agreement.summary !== agreement.title ? agreement.summary : null;
  const change = agreement.status === "draft" && (changedBy || agreement.changeReason) ? copy.change(changedBy, clean(agreement.changeReason, 1200)) : null;
  const lines = [`${heading}${language === "zh" ? "，" : ", "}${status}`, change, summary, ...terms.map((term, index) => `${index + 1}. ${term}`)];
  if (agreement.unresolvedPoints?.length) lines.push(`${copy.open}${agreement.unresolvedPoints.join("; ")}`);
  return lines.filter(Boolean).join("\n");
}

/** Posts the agreement card for the agreement's current version and status (new, changed, change requested, active). */
export async function announceAgreement(tx, { agreement, userId, language = null, source = "app" }) {
  const changedBy = agreement.status === "draft" && agreement.changedByUserId ? (await tx.getRelationshipContext(userId))?.members.find((member) => member.userId === agreement.changedByUserId)?.user?.name || "" : "";
  const i18n = togetherI18n((item) => agreementCardText(agreement, item, { changedBy }));
  return announceInTogether(tx, {
    relationshipId: agreement.relationshipId, userId, source, kind: "agreement_card", text: i18n[await memberLanguage(tx, userId, language)], i18n,
    refs: [{ type: "agreement", id: agreement.id, version: agreement.version }], handle: `agreement:${agreement.id}:v${agreement.version}:${agreement.status}`,
  });
}

/** Light agreement path (decision #11): no shareable summaries required, but both principals must still approve the same
 * version. `values` lets a member edit the Agent's draft before sending it for approval. */
export async function draftAgreementFromTogether(tx, { relationshipId, userId, values = null, source = "app", language = null }) {
  const { conversation } = await ensureTogetherConversation(tx, { relationshipId, userId });
  const agreements = (await tx.listRelationshipRecordsForUser("agreements", userId)).filter((item) => item.relationshipId === relationshipId && !item.archivedAt && !item.withdrawnAt);
  if (agreements.some((item) => item.status === "awaiting_approvals")) throw decisionError(409, "one_pending_agreement");
  const own = agreements.filter((item) => item.sourceTogetherId === conversation.id);
  if (!values && !conversation.draftAgreement) throw decisionError(409, "together_draft_required");
  const fields = agreementValues(values || conversation.draftAgreement);
  // A change request moves the agreement back to "draft"; revising it keeps one history and bumps the version both must approve.
  const revisable = own.filter((item) => item.status === "draft").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  let agreement;
  if (revisable) {
    agreement = await tx.updateRelationshipRecordForUser("agreements", revisable.id, userId, (draft) => { Object.assign(draft, fields); draft.status = "awaiting_approvals"; draft.effectiveAt = null; draft.approvedBy = []; draft.proposedBy = userId; draft.version += 1; });
    await markCommitmentsForRenegotiation(tx, agreement, userId);
  } else {
    agreement = createRelationshipRecord({ relationshipId, userId, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "awaiting_approvals", approvedBy: [], proposedBy: userId, sourceIssueId: null, proposalId: null, sourceTogetherId: conversation.id, ...fields, effectiveAt: null, reviewAt: null });
    await tx.createRelationshipRecord("agreements", agreement);
  }
  await audit(tx, agreement, userId, "agreement.together_drafted");
  await tx.updateRelationshipRecordForUser("togetherConversations", conversation.id, userId, (draft) => { draft.draftAgreement = null; draft.version += 1; });
  await announceAgreement(tx, { agreement, userId, language, source });
  return agreement;
}

/** "On this day": the first time either partner opens Us on a date, Pinky recalls shared moments from that day in earlier
 * years, with their photos. Only the couple's shared album counts; one post per day. Returns the updated conversation or null. */
export async function recallOnThisDay(store, { relationshipId, userId, today }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const snapshot = await store.relationshipSnapshotForUser(userId);
  const album = (snapshot.spaces || []).find((space) => space.system === MOMENTS && space.relationshipId === relationshipId && space.visibility === "shared" && !space.archivedAt);
  if (!album) return null;
  const moments = (snapshot.spaceItems || []).filter((item) => item.spaceId === album.id && item.visibility === "shared" && !item.archivedAt && item.date && item.date.slice(5) === today.slice(5) && item.date < today);
  if (!moments.length) return null;
  // One memory per title, oldest first, with all of its photos.
  const groups = [...moments.reduce((map, item) => map.set(`${item.date}|${item.title}`, [...(map.get(`${item.date}|${item.title}`) || []), item]), new Map()).values()].sort((a, b) => a[0].date.localeCompare(b[0].date)).slice(0, 3);
  const line = (language) => groups.map(([first]) => { const years = Number(today.slice(0, 4)) - Number(first.date.slice(0, 4)); const title = first.title || String(first.text || "").slice(0, 60); return language === "en" ? `${years} year${years > 1 ? "s" : ""} ago today: ${title}` : language === "es" ? `Hace ${years} año${years > 1 ? "s" : ""}, hoy: ${title}` : `${years} 年前的今天：${title}`; }).join(language === "zh" ? "；" : "; ");
  const photoIds = groups.flat().map((item) => item.photoId).filter(Boolean).slice(0, 6);
  const result = await store.transaction(`relationship:${relationshipId}`, (tx) => appendTogetherMessage(tx, { relationshipId, actorUserId: null, userId, source: "app", text: line("zh"), i18n: togetherI18n(line), photoIds, refs: [{ type: "space", id: album.id, title: album.title, system: MOMENTS }], handle: `onthisday:${relationshipId}:${today}` }));
  return result.duplicate ? null : result.conversation;
}

/** The day the couple got together, which the together counter counts from and the calendar repeats yearly. Either partner
 * may set or correct it; there is only ever one, so a new date moves it. */
export async function setTogetherSince(tx, { relationshipId, userId, date, title }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || Number.isNaN(Date.parse(`${date}T12:00:00Z`)) || date > new Date().toISOString().slice(0, 10) || date < "1900-01-01") throw decisionError(400, "message_required");
  const existing = (await tx.listRelationshipRecordsForUser("milestones", userId)).find((item) => item.relationshipId === relationshipId && item.type === "relationship_started" && !item.archivedAt);
  if (existing) return tx.updateRelationshipRecordForUser("milestones", existing.id, userId, (draft) => { draft.date = date; if (title) draft.title = String(title).slice(0, 120); draft.recurringRule = "yearly"; draft.version += 1; });
  const record = createRelationshipRecord({ relationshipId, userId, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "active", type: "relationship_started", title: String(title || "").slice(0, 120) || "在一起纪念日", date, timezone: "UTC", recurringRule: "yearly", jointlyConfirmed: false, notes: "", provenanceSource: "member" });
  await tx.createRelationshipRecord("milestones", record);
  return record;
}
