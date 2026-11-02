import { randomUUID } from "node:crypto";
import { agreementValues, audit, clean, decisionError, markCommitmentsForRenegotiation } from "./agreement-actions.mjs";
import { buildMemoryContext } from "./memory-domain.mjs";
import { createRelationshipRecord } from "./relationship-domain.mjs";

// The relationship-level "together" conversation. App, iMessage group and relay all write through these functions, so
// channel adapters stay thin and every privacy rule lives here once.
const SOURCES = new Set(["app", "imessage", "relay"]);
const KINDS = new Set(["text", "relay", "agreement_card", "reminder", "review"]);
const AGENT_CALL = /彼此|toward\s*us|@toward|@agent/i;
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

// `userId` is the member whose access scope performs the write; it defaults to the author and is required for agent turns.
export async function appendTogetherMessage(tx, { relationshipId, actorUserId = null, userId = actorUserId, source, kind = "text", text, handle = null, refs = [], replyTo = null }) {
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
  };
  const updated = await tx.updateRelationshipRecordForUser("togetherConversations", conversation.id, userId, (draft) => {
    draft.messages = [...(draft.messages || []), message].slice(-MESSAGE_LIMIT);
    if (message.role === "agent") draft.agentLastMessageId = message.id;
    draft.version += 1;
  });
  if (message.role === "member") await audit(tx, updated, userId, "together.message_added");
  return { conversation: updated, message, duplicate: false };
}

/** Light agreement path (decision #11): no shareable summaries required, but both principals must still approve the same
 * version. `values` lets a member edit the Agent's draft before sending it for approval. */
export async function draftAgreementFromTogether(tx, { relationshipId, userId, values = null, source = "app" }) {
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
  await appendTogetherMessage(tx, { relationshipId, actorUserId: null, userId, source, kind: "agreement_card", text: agreement.title, refs: [{ type: "agreement", id: agreement.id, version: agreement.version }] });
  return agreement;
}
