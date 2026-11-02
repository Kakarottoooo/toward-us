import { randomUUID } from "node:crypto";
import { agreementValues, audit, clean, decisionError, markCommitmentsForRenegotiation } from "./agreement-actions.mjs";
import { buildMemoryContext } from "./memory-domain.mjs";
import { createRelationshipRecord } from "./relationship-domain.mjs";
import { addSpaceItem, archiveSpaceRecord, createSpace, updateSpace, updateSpaceItem, visibleSpace } from "./space-domain.mjs";
import { handoffUrl } from "./handoff.mjs";

// The relationship-level "together" conversation. App, iMessage group and relay all write through these functions, so
// channel adapters stay thin and every privacy rule lives here once.
const SOURCES = new Set(["app", "imessage", "relay"]);
const KINDS = new Set(["text", "relay", "agreement_card", "reminder", "review"]);
const AGENT_CALL = /\bpinky\b|@agent/i;
const LANGUAGES = new Set(["zh", "en", "es"]);
const MESSAGE_LIMIT = 200;
const OPEN_COMMITMENTS = new Set(["active", "awaiting_confirmations", "renegotiation_requested"]);
const togetherId = (relationshipId) => `together:${relationshipId}`;

export function shouldAgentSpeak(message, { agentLastMessageId = null } = {}) {
  if (!message || message.role !== "member") return false;
  return AGENT_CALL.test(String(message.text || "")) || Boolean(agentLastMessageId && message.replyTo === agentLastMessageId);
}

/** Reads only the shared conversation, shared agreements/commitments and jointly approved memories. Never private threads,
 * assistant sessions, perspectives, evaluations, summaries or reminders, even though the caller's snapshot contains them. */
export function buildTogetherContext(snapshot, relationshipId, { userId = null, query = "" } = {}) {
  const conversation = (snapshot.togetherConversations || []).find((item) => item.id === togetherId(relationshipId) && item.relationshipId === relationshipId) || null;
  const agreements = (snapshot.agreements || []).filter((item) => item.relationshipId === relationshipId && item.visibility === "shared" && !item.archivedAt && !item.withdrawnAt);
  const agreement = ({ id, title, summary, terms, unresolvedPoints, status, version }) => ({ id, title, summary, terms, unresolvedPoints: unresolvedPoints || [], status, version });
  // One pending agreement per couple, whatever path created it (together, full decision flow).
  const pending = agreements.filter((item) => item.status === "awaiting_approvals").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return {
    messages: (conversation?.messages || []).slice(-40).map(({ id, role, actorUserId, kind, text, replyTo, createdAt, photoIds }) => ({ id, role, actorUserId, kind, text, replyTo, createdAt, ...(photoIds?.length ? { photoIds } : {}) })),
    activeAgreements: agreements.filter((item) => item.status === "active").map(agreement),
    openCommitments: (snapshot.commitments || []).filter((item) => item.relationshipId === relationshipId && item.visibility === "shared" && OPEN_COMMITMENTS.has(item.status) && !item.archivedAt).map(({ id, agreementId, description, ownerType, status, dueAt }) => ({ id, agreementId, description, ownerType, status, dueAt })),
    pendingAgreement: pending ? agreement(pending) : null,
    authorizedMemories: userId ? buildMemoryContext(snapshot.memories || [], { userId, relationshipId, scope: "joint", query }).memories : [],
    spaces: (snapshot.spaces || []).filter((space) => space.relationshipId === relationshipId && space.visibility === "shared" && !space.archivedAt).slice(0, 30).map((space) => ({
      id: space.id, title: space.title, layout: space.layout,
      items: (snapshot.spaceItems || []).filter((item) => item.spaceId === space.id && item.visibility === "shared" && !item.archivedAt).slice(-15).map((item) => ({ id: item.id, title: item.title || String(item.text || "").slice(0, 80), date: item.date, done: item.done })),
    })),
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
export async function appendTogetherMessage(tx, { relationshipId, actorUserId = null, userId = actorUserId, source, kind = "text", text, handle = null, refs = [], replyTo = null, i18n = null, photoIds = [] }) {
  const body = clean(text, 4000);
  if (!body && !photoIds.length) throw decisionError(400, "message_required");
  if (!SOURCES.has(source) || !KINDS.has(kind) || !userId) throw decisionError(400, "message_required");
  const { conversation } = await ensureTogetherConversation(tx, { relationshipId, userId });
  const key = clean(handle, 200) || null;
  const duplicate = key && conversation.messages.find((item) => item.handle === key);
  if (duplicate) return { conversation, message: duplicate, duplicate: true };
  const message = {
    id: randomUUID(), role: actorUserId ? "member" : "agent", actorUserId: actorUserId || null, source, kind, text: body,
    refs: Array.isArray(refs) ? refs.slice(0, 8) : [], handle: key, replyTo: replyTo && conversation.messages.some((item) => item.id === replyTo) ? replyTo : null, createdAt: new Date().toISOString(),
    ...(!actorUserId && cleanI18n(i18n) ? { i18n: cleanI18n(i18n) } : {}),
    ...(photoIds.length ? { photoIds: photoIds.slice(0, 6) } : {}),
  };
  const updated = await tx.updateRelationshipRecordForUser("togetherConversations", conversation.id, userId, (draft) => {
    draft.messages = [...(draft.messages || []), message].slice(-MESSAGE_LIMIT);
    if (message.role === "agent") draft.agentLastMessageId = message.id;
    draft.version += 1;
  });
  return { conversation: updated, message, duplicate: false };
}

/** One member turn in the together conversation, shared by every channel (App, iMessage). The member's words are saved
 * before the model is called so a slow or failed reply never loses them; repeating the same `handle` re-runs only a missing
 * Agent reply. `emit` receives each changed conversation. Returns { conversation, message, reply|null, duplicate }. */
export async function continueTogetherTurn({ store, mediator, relationshipId, actorUserId, text, photoIds = [], timezone = "UTC", source = "app", handle = null, replyTo = null, language = "zh", emit = () => {}, notifyPrivate = () => {} }) {
  // Every write re-checks membership inside the relationship lock; an ended relationship is read-only.
  const transaction = (action) => store.transaction(`relationship:${relationshipId}`, async (tx) => {
    const context = await tx.getRelationshipContext(actorUserId);
    if (!context || context.relationship.id !== relationshipId || context.relationship.status !== "active" || context.members.length !== 2) throw decisionError(409, "relationship_changed");
    return action(tx);
  });
  const saved = await transaction((tx) => appendTogetherMessage(tx, { relationshipId, actorUserId, source, kind: "text", text, handle, replyTo, photoIds }));
  const { message } = saved, messages = saved.conversation.messages;
  // The Agent that was last to speak before this turn, so a retried turn is judged exactly as it was the first time.
  const agentLastMessageId = messages.slice(0, messages.findIndex((item) => item.id === message.id)).findLast((item) => item.role === "agent")?.id || null;
  const answered = (conversation) => conversation.messages.find((item) => item.role === "agent" && item.replyTo === message.id);
  if (!saved.duplicate) emit(saved.conversation);
  if (!shouldAgentSpeak(message, { agentLastMessageId }) || (saved.duplicate && answered(saved.conversation))) return { conversation: saved.conversation, message, reply: null, duplicate: saved.duplicate };
  const context = buildTogetherContext(await store.relationshipSnapshotForUser(actorUserId), relationshipId, { userId: actorUserId, query: message.text });
  let turn = await mediator.continueTogether({ ...context, webSearch: Boolean(mediator.webSearch) }, language);
  // Real-world questions: look them up, then let the Agent answer once more with the findings. Searches never run twice.
  const searches = (turn.actions || []).filter((action) => action.kind === "web_search" && action.text).slice(0, 2);
  if (searches.length && mediator.lookup) {
    const lookups = await Promise.all(searches.map(async (action) => ({ query: action.text, findings: await mediator.lookup(action.text, language).catch(() => "No results: the search failed.") })));
    turn = await mediator.continueTogether({ ...context, webSearch: true, lookups }, language);
  }
  turn = { ...turn, actions: (turn.actions || []).filter((action) => action.kind !== "web_search") };
  const reply = (outcome) => transaction(async (tx) => {
    // A concurrent retry may have answered while the model was thinking: keep exactly one reply.
    const { conversation: current } = await ensureTogetherConversation(tx, { relationshipId, userId: actorUserId });
    const existing = answered(current); if (existing) return { conversation: current, message: existing, duplicate: true };
    const made = await applyTogetherActions(tx, { relationshipId, userId: actorUserId, actions: outcome.actions || [], asked, timezone });
    const result = await appendTogetherMessage(tx, { relationshipId, actorUserId: null, userId: actorUserId, source, kind: "text", text: outcome.reply, i18n: outcome.i18n || null, refs: [...made, ...context.authorizedMemories.map(({ id, version }) => ({ type: "memory", id, version }))], replyTo: message.id });
    if (!outcome.draftAgreement) return result;
    const conversation = await tx.updateRelationshipRecordForUser("togetherConversations", result.conversation.id, actorUserId, (draft) => { draft.draftAgreement = { ...outcome.draftAgreement, messageId: result.message.id, source: outcome.source, createdAt: new Date().toISOString() }; draft.version += 1; });
    return { ...result, conversation };
  });
  // Actions and reply land together or not at all; if an action cannot be applied, say so instead of claiming it.
  const asked = [];
  let replied;
  try { replied = await reply(turn); }
  catch (error) {
    if (!turn.actions?.length) throw error;
    asked.length = 0;
    const failed = { zh: "抱歉，这件事我没能办成，什么都没有改动。可以换个说法再试一次。", en: "Sorry, I couldn't do that, and nothing was changed. Try saying it another way.", es: "Lo siento, no pude hacerlo y no se cambió nada. Prueba a decirlo de otra forma." };
    replied = await reply({ reply: failed[language] || failed.zh, i18n: failed, actions: [], draftAgreement: null, source: "local" });
  }
  if (!replied.duplicate) emit(replied.conversation);
  for (const session of asked) notifyPrivate(session);
  return { conversation: replied.conversation, message, reply: replied.message, duplicate: saved.duplicate };
}

/** The agent speaks in the shared conversation on its own only for real business: an agreement card, a due joint reminder,
 * a due outcome review. Messages are role "agent"; a deterministic `handle` makes every retry or repeated tick a no-op.
 * `text` must only contain shared content. */
/** What the shared Agent may change for both partners, applied in the same transaction as its reply. Returns refs the
 * conversation shows as links. Only shared spaces and dates of this couple; nothing private, nothing needing two approvals. */
async function applyTogetherActions(tx, { relationshipId, userId, actions, asked = [], timezone = "UTC" }) {
  const refs = []; let created = null;
  for (const action of actions) {
    if (action.kind === "link") {
      const url = handoffUrl({ url: action.localDateTime ? null : action.text, localDateTime: action.localDateTime, title: action.title || "", location: action.localDateTime ? action.text || "" : "", timezone });
      if (url && action.title) refs.push({ type: "link", id: randomUUID(), title: action.title.slice(0, 60), url });
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
    if (action.kind === "milestone") {
      if (action.operation !== "create") continue;
      if (!action.title || !action.date) throw decisionError(400, "message_required");
      const record = createRelationshipRecord({ relationshipId, userId, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "active", type: "custom", title: action.title.slice(0, 120), date: action.date, timezone: "UTC", recurringRule: action.recurringRule, jointlyConfirmed: false, notes: action.text || "", provenanceSource: "agent" });
      await tx.createRelationshipRecord("milestones", record); refs.push({ type: "milestone", id: record.id, version: record.version, title: record.title });
      // A shared reminder on the date makes the Agent post it in this conversation when due (reminder-service announces it).
      if (action.remindDaysBefore !== null && action.remindDaysBefore !== undefined) await tx.createRelationshipRecord("reminders", createRelationshipRecord({ relationshipId, userId, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "owner", status: "active", milestoneId: record.id, minutesBefore: action.remindDaysBefore * 1440, channel: "in_app", provenanceSource: "agent" }));
      continue;
    }
    if (action.kind === "space") {
      const record = action.operation === "create" ? created = await createSpace(tx, { userId, relationshipId, shared: true, title: action.title, layout: action.layout, description: action.text || "", source: "agent" })
        : action.operation === "archive" ? await archiveSpaceRecord(tx, { userId, collection: "spaces", id: action.targetId }) : await updateSpace(tx, { userId, id: action.targetId, fields: { title: action.title ?? undefined, layout: action.layout ?? undefined, description: action.text ?? undefined } });
      if (record.visibility !== "shared" || record.relationshipId !== relationshipId) throw decisionError(404, "not_found");
      refs.push({ type: "space", id: record.id, version: record.version, title: record.title }); continue;
    }
    let record;
    if (action.operation === "create") {
      const space = action.spaceId ? await visibleSpace(tx, action.spaceId, userId) : created;
      if (!space || space.visibility !== "shared" || space.relationshipId !== relationshipId) throw decisionError(404, "not_found");
      const photo = action.photoId ? await tx.getRelationshipRecordForUser("photos", action.photoId, userId) : null;
      if (action.photoId && (!photo || photo.visibility !== "shared" || photo.relationshipId !== relationshipId || photo.archivedAt)) throw decisionError(404, "not_found");
      record = await addSpaceItem(tx, { userId, space, title: action.title || "", text: action.text || "", date: action.date, done: action.done === true, photoId: photo?.id || null, source: "agent" });
      if (!refs.some((ref) => ref.type === "space" && ref.id === space.id)) refs.push({ type: "space", id: space.id, version: space.version, title: space.title });
      continue;
    }
    const item = await tx.getRelationshipRecordForUser("spaceItems", action.targetId || "", userId);
    if (!item || item.visibility !== "shared" || item.relationshipId !== relationshipId) throw decisionError(404, "not_found");
    record = action.operation === "archive" ? await archiveSpaceRecord(tx, { userId, collection: "spaceItems", id: item.id }) : await updateSpaceItem(tx, { userId, id: item.id, fields: { title: action.title ?? undefined, text: action.text ?? undefined, date: action.date ?? undefined, done: action.done ?? undefined } });
    if (!refs.some((ref) => ref.type === "space" && ref.id === item.spaceId)) refs.push({ type: "space", id: item.spaceId, version: record.version, title: "" });
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

const CARD_COPY = {
  zh: { title: (t, v) => `约定「${t}」v${v}`, plain: (v) => `约定 v${v}`, awaiting_approvals: "等你们两人批准同一版本", active: "已生效", draft: "有人要求修改，等待新版本", open: "待定：" },
  en: { title: (t, v) => `Agreement "${t}" v${v}`, plain: (v) => `Agreement v${v}`, awaiting_approvals: "waiting for both of you to approve this version", active: "now active", draft: "a change was requested; waiting for a new version", open: "Still open: " },
  es: { title: (t, v) => `Acuerdo "${t}" v${v}`, plain: (v) => `Acuerdo v${v}`, awaiting_approvals: "esperando que ambos aprueben esta versión", active: "ya está activo", draft: "se pidió un cambio; esperando una nueva versión", open: "Pendiente: " },
};
// The status line comes first so the 4000-character message cap can only ever trim trailing terms.
export function agreementCardText(agreement, language = "zh") {
  const copy = CARD_COPY[language] || CARD_COPY.zh, status = copy[agreement.status] || copy.awaiting_approvals;
  // Title and summary are dropped when they only repeat the terms, so a card never shows the same words three times.
  const terms = agreement.terms || [], heading = agreement.title && agreement.title !== terms[0] ? copy.title(agreement.title, agreement.version) : copy.plain(agreement.version);
  const summary = agreement.summary && agreement.summary !== terms.join(" / ") && agreement.summary !== agreement.title ? agreement.summary : null;
  const lines = [`${heading}${language === "zh" ? "，" : ", "}${status}`, summary, ...terms.map((term, index) => `${index + 1}. ${term}`)];
  if (agreement.unresolvedPoints?.length) lines.push(`${copy.open}${agreement.unresolvedPoints.join("; ")}`);
  return lines.filter(Boolean).join("\n");
}

/** Posts the agreement card for the agreement's current version and status (new, changed, change requested, active). */
export async function announceAgreement(tx, { agreement, userId, language = null, source = "app" }) {
  const i18n = togetherI18n((item) => agreementCardText(agreement, item));
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
    agreement = await tx.updateRelationshipRecordForUser("agreements", revisable.id, userId, (draft) => { Object.assign(draft, fields); draft.status = "awaiting_approvals"; draft.effectiveAt = null; draft.version += 1; });
    await markCommitmentsForRenegotiation(tx, agreement, userId);
  } else {
    agreement = createRelationshipRecord({ relationshipId, userId, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "awaiting_approvals", sourceIssueId: null, proposalId: null, sourceTogetherId: conversation.id, ...fields, effectiveAt: null, reviewAt: null });
    await tx.createRelationshipRecord("agreements", agreement);
  }
  await audit(tx, agreement, userId, "agreement.together_drafted");
  await tx.updateRelationshipRecordForUser("togetherConversations", conversation.id, userId, (draft) => { draft.draftAgreement = null; draft.version += 1; });
  await announceAgreement(tx, { agreement, userId, language, source });
  return agreement;
}
