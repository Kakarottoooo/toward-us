import { randomUUID } from "node:crypto";
import { agreementValues, audit, clean, decisionError, markCommitmentsForRenegotiation } from "./agreement-actions.mjs";
import { buildMemoryContext } from "./memory-domain.mjs";
import { createRelationshipRecord } from "./relationship-domain.mjs";

// The relationship-level "together" conversation. App, iMessage group and relay all write through these functions, so
// channel adapters stay thin and every privacy rule lives here once.
const SOURCES = new Set(["app", "imessage", "relay"]);
const KINDS = new Set(["text", "relay", "agreement_card", "reminder", "review"]);
const AGENT_CALL = /彼此|toward\s*us|@toward|@agent/i;
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
    messages: (conversation?.messages || []).slice(-40).map(({ id, role, actorUserId, kind, text, replyTo, createdAt }) => ({ id, role, actorUserId, kind, text, replyTo, createdAt })),
    activeAgreements: agreements.filter((item) => item.status === "active").map(agreement),
    openCommitments: (snapshot.commitments || []).filter((item) => item.relationshipId === relationshipId && item.visibility === "shared" && OPEN_COMMITMENTS.has(item.status) && !item.archivedAt).map(({ id, agreementId, description, ownerType, status, dueAt }) => ({ id, agreementId, description, ownerType, status, dueAt })),
    pendingAgreement: pending ? agreement(pending) : null,
    authorizedMemories: userId ? buildMemoryContext(snapshot.memories || [], { userId, relationshipId, scope: "joint", query }).memories : [],
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
export async function appendTogetherMessage(tx, { relationshipId, actorUserId = null, userId = actorUserId, source, kind = "text", text, handle = null, refs = [], replyTo = null, i18n = null }) {
  const body = clean(text, 4000);
  if (!body) throw decisionError(400, "message_required");
  if (!SOURCES.has(source) || !KINDS.has(kind) || !userId) throw decisionError(400, "message_required");
  const { conversation } = await ensureTogetherConversation(tx, { relationshipId, userId });
  const key = clean(handle, 200) || null;
  const duplicate = key && conversation.messages.find((item) => item.handle === key);
  if (duplicate) return { conversation, message: duplicate, duplicate: true };
  const message = {
    id: randomUUID(), role: actorUserId ? "member" : "agent", actorUserId: actorUserId || null, source, kind, text: body,
    refs: Array.isArray(refs) ? refs.slice(0, 8) : [], handle: key, replyTo: replyTo && conversation.messages.some((item) => item.id === replyTo) ? replyTo : null, createdAt: new Date().toISOString(),
    ...(!actorUserId && cleanI18n(i18n) ? { i18n: cleanI18n(i18n) } : {}),
  };
  const updated = await tx.updateRelationshipRecordForUser("togetherConversations", conversation.id, userId, (draft) => {
    draft.messages = [...(draft.messages || []), message].slice(-MESSAGE_LIMIT);
    if (message.role === "agent") draft.agentLastMessageId = message.id;
    draft.version += 1;
  });
  if (message.role === "member") await audit(tx, updated, userId, "together.message_added");
  return { conversation: updated, message, duplicate: false };
}

/** The agent speaks in the shared conversation on its own only for real business: an agreement card, a due joint reminder,
 * a due outcome review. Messages are role "agent"; a deterministic `handle` makes every retry or repeated tick a no-op.
 * `text` must only contain shared content. */
export async function announceInTogether(tx, { relationshipId, userId, kind, refs = [], text, i18n = null, handle = null, source = "app" }) {
  if (!["agreement_card", "reminder", "review"].includes(kind)) throw decisionError(400, "message_required");
  return appendTogetherMessage(tx, { relationshipId, actorUserId: null, userId, source, kind, text, i18n, handle, refs });
}

/** Language for agent-initiated copy: the triggering member's explicit choice, else their saved reminder-language preference, else zh. */
export async function memberLanguage(tx, userId, hint = null) {
  if (LANGUAGES.has(hint)) return hint;
  const preference = (await tx.listRelationshipRecordsForUser("deliveryPreferences", userId)).find((item) => item.ownerUserId === userId && !item.archivedAt);
  return LANGUAGES.has(preference?.language) ? preference.language : "zh";
}

const CARD_COPY = {
  zh: { title: (t, v) => `约定「${t}」v${v}`, awaiting_approvals: "等你们两人批准同一版本", active: "已生效", draft: "有人要求修改，等待新版本", open: "待定：" },
  en: { title: (t, v) => `Agreement "${t}" v${v}`, awaiting_approvals: "waiting for both of you to approve this version", active: "now active", draft: "a change was requested; waiting for a new version", open: "Still open: " },
  es: { title: (t, v) => `Acuerdo "${t}" v${v}`, awaiting_approvals: "esperando que ambos aprueben esta versión", active: "ya está activo", draft: "se pidió un cambio; esperando una nueva versión", open: "Pendiente: " },
};
// The status line comes first so the 4000-character message cap can only ever trim trailing terms.
export function agreementCardText(agreement, language = "zh") {
  const copy = CARD_COPY[language] || CARD_COPY.zh, status = copy[agreement.status] || copy.awaiting_approvals;
  const lines = [`${copy.title(agreement.title, agreement.version)}${language === "zh" ? "，" : ", "}${status}`, agreement.summary, ...(agreement.terms || []).map((term, index) => `${index + 1}. ${term}`)];
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
