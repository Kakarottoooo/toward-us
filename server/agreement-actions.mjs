import { createRelationshipRecord } from "./relationship-domain.mjs";

// Channel-independent agreement transitions. Callers (HTTP routes, the shared conversation, iMessage approvals) own the
// relationship transaction and the realtime emit; these functions only mutate through `tx` and throw errors carrying
// `statusCode` and `code` (the DECISION_ERRORS key). `decisionCode` mirrors `code` for the router's error handler.
export const decisionError = (statusCode, code) => Object.assign(new Error(code), { statusCode, code, decisionCode: code });
export function assertVersion(record, version) { if (!Number.isInteger(version) || version !== record.version) throw decisionError(409, "stale_version"); }
export const clean = (value, limit) => String(value || "").trim().replace(/\0/g, "").slice(0, limit);
export const cleanArray = (value, count, limit) => Array.isArray(value) ? value.slice(0, count).map((item) => clean(item, limit)).filter(Boolean) : [];
export async function audit(store, source, userId, eventType) { const event = createRelationshipRecord({ relationshipId: source.relationshipId, userId, visibility: "private", aiAccessScope: "none", approvalPolicy: "owner", status: "recorded", objectId: source.id, objectType: eventType.split(".")[0], eventType, sourceVersion: source.version }); await store.createRelationshipRecord("consentEvents", event); }

export function agreementValues(body) {
  const title = clean(body?.title, 160), summary = clean(body?.summary, 1200), terms = cleanArray(body?.terms, 8, 500);
  if (!title || !summary || !terms.length) throw decisionError(400, "agreement_fields");
  return { title, summary, terms, unresolvedPoints: cleanArray(body?.unresolvedPoints, 8, 500) };
}

export async function markCommitmentsForRenegotiation(tx, agreement, userId) {
  const commitments = await tx.listRelationshipRecordsForUser("commitments", userId);
  for (const item of commitments.filter((item) => item.agreementId === agreement.id && ["active", "awaiting_confirmations"].includes(item.status))) {
    await tx.updateRelationshipRecordForUser("commitments", item.id, userId, (draft) => { draft.status = "renegotiation_requested"; draft.version += 1; });
  }
}

export async function approveAgreement(tx, { agreementId, version, userId, context }) {
  const agreement = await tx.getRelationshipRecordForUser("agreements", agreementId, userId);
  if (!agreement) throw decisionError(404, "not_found");
  assertVersion(agreement, version);
  if (!["awaiting_approvals", "active"].includes(agreement.status)) throw decisionError(409, "agreement_not_pending");
  const snapshot = await tx.relationshipSnapshotForUser(userId);
  const matching = snapshot.approvals.filter((item) => item.agreementId === agreement.id && item.approvedVersion === agreement.version && !item.withdrawnAt);
  if (!matching.some((item) => item.ownerUserId === userId)) {
    if (agreement.status !== "awaiting_approvals") throw decisionError(409, "agreement_not_pending");
    const approval = createRelationshipRecord({ relationshipId: agreement.relationshipId, userId, visibility: "private", aiAccessScope: "none", approvalPolicy: "owner", status: "approved", agreementId: agreement.id, approvedVersion: agreement.version, approvedAt: new Date().toISOString() });
    approval.id = `approval:${agreement.id}:${agreement.version}:${userId}`;
    await tx.createRelationshipRecord("approvals", approval); matching.push(approval);
  }
  const approvedUsers = new Set(matching.map((item) => item.ownerUserId));
  const everyone = context.members.every((item) => approvedUsers.has(item.userId)) && agreement.status !== "active";
  // Who has said yes to this version, on the shared agreement itself, so each sees "TA 已经同意了" (founder 11-06).
  const updated = await tx.updateRelationshipRecordForUser("agreements", agreement.id, userId, (draft) => {
    draft.approvedBy = [...approvedUsers];
    if (everyone) { draft.status = "active"; draft.effectiveAt = new Date().toISOString(); }
  });
  await audit(tx, updated, userId, "agreement.approved");
  return { agreement: updated, approvedCount: approvedUsers.size, requiredCount: context.members.length };
}

// `reason` is optional and additive to the brief's signature: the HTTP routes persist the caller's free-text reason as changeReason.
export const rejectAgreement = (tx, { agreementId, version, userId, reason }) => moveAgreement(tx, { agreementId, version, userId, reason }, "cancelled", "agreement.rejected");
export const requestAgreementChange = (tx, { agreementId, version, userId, reason }) => moveAgreement(tx, { agreementId, version, userId, reason }, "draft", "agreement.change_requested");

async function moveAgreement(tx, { agreementId, version, userId, reason }, status, eventType) {
  const record = await tx.getRelationshipRecordForUser("agreements", agreementId, userId);
  if (!record) throw decisionError(404, "not_found");
  assertVersion(record, version);
  if (["cancelled", "superseded", "archived"].includes(record.status)) throw decisionError(409, "agreement_not_editable");
  const agreement = await tx.updateRelationshipRecordForUser("agreements", record.id, userId, (draft) => { draft.status = status; draft.changeReason = clean(reason, 1200); draft.changedByUserId = userId; draft.effectiveAt = null; draft.approvedBy = []; draft.version += 1; });
  await markCommitmentsForRenegotiation(tx, agreement, userId);
  await audit(tx, agreement, userId, eventType);
  return { agreement };
}

/** One of them settles a point still open on an agreement waiting for approval, right on its card (founder 11-06: "还没定的"
 * could only be changed by going back to the conversation). The point becomes a term in their words, so this is a new version:
 * any yes already given is cleared and both approve again. Returns the agreement and the point with its answer. */
/** Pinky turns "an open point + the answer" into one term written like the others ("周日：十二点半出发，打车"). Only the agreement's
 * own terms, the point and the answer are sent. Null when there is no model or it fails: the caller writes "point：answer". */
export async function phrasePoint({ mediator, terms, point, answer }) {
  if (!mediator?.structured) return null;
  try {
    const result = await mediator.structured({ name: "agreement_point", maxOutputTokens: 200,
      schema: { type: "object", additionalProperties: false, required: ["term"], properties: { term: { type: "string" } } },
      instructions: "Two partners are settling an open point of their shared agreement. Rewrite the point and its answer as ONE short new term of the agreement, in the same language and style as the existing terms. If the existing terms start with a day (like \"周日：…\" or \"Sunday: …\") and the point is about one of those days, start the new term the same way. Keep every fact of the answer; add nothing.",
      input: JSON.stringify({ terms, point, answer }) });
    const term = clean(result?.term, 500);
    return term || null;
  } catch { return null; }
}

export async function answerAgreementPoint(tx, { agreementId, version, userId, index, text, term = null }) {
  const record = await tx.getRelationshipRecordForUser("agreements", agreementId, userId);
  if (!record) throw decisionError(404, "not_found");
  assertVersion(record, version);
  if (record.status !== "awaiting_approvals") throw decisionError(409, "agreement_not_pending");
  const points = Array.isArray(record.unresolvedPoints) ? record.unresolvedPoints : [];
  const answer = clean(text, 300);
  if (!Number.isInteger(index) || index < 0 || index >= points.length || !answer) throw decisionError(400, "agreement_fields");
  const point = String(points[index]).replace(/[？?。.\s]+$/u, "");
  const agreement = await tx.updateRelationshipRecordForUser("agreements", record.id, userId, (draft) => {
    draft.terms = [...(draft.terms || []), clean(term, 500) || `${point}：${answer}`].slice(0, 12);
    draft.unresolvedPoints = points.filter((_, at) => at !== index);
    draft.changedByUserId = userId; draft.approvedBy = []; draft.version += 1;
  });
  await markCommitmentsForRenegotiation(tx, agreement, userId);
  await audit(tx, agreement, userId, "agreement.point_answered");
  return { agreement, point, answer };
}
