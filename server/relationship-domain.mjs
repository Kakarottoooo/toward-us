import { randomUUID } from "node:crypto";

export const GRAPH_COLLECTIONS = Object.freeze([
  "privateAgentThreads",
  "milestones", "reminders", "lists", "listItems", "issues", "perspectives", "summaries",
  "proposals", "evaluations", "agreements", "approvals", "commitments", "outcomes",
  "outcomeResponses", "notifications", "consentEvents", "productEvents",
  "memories", "checkins", "deliveryPreferences", "pushSubscriptions", "deliveryJobs", "accountSettings",
]);

export const PERSONAL_COLLECTIONS = new Set(["privateAgentThreads", "memories", "checkins", "reminders", "notifications", "consentEvents", "deliveryPreferences", "pushSubscriptions", "deliveryJobs", "accountSettings"]);
const INTERNAL_COLLECTIONS = new Set(["accountSettings", "pushSubscriptions", "deliveryJobs", "deliveryPreferences"]);

export function assertRecordScope(collection, record) {
  if (!record.ownerUserId || !record.createdByUserId) throw new Error("A record requires an owner and a creator.");
  if (!record.relationshipId && (!PERSONAL_COLLECTIONS.has(collection) || record.visibility !== "private")) throw new Error("Unpaired records must be private and belong to a personal collection.");
}

const PRIVATE_VISIBILITIES = new Set(["private", "private_surprise"]);
const JOINT_VISIBILITIES = new Set(["shared", "jointly_confirmed", "revealed"]);

export function createRelationshipRecord({ relationshipId, userId, visibility = "shared", aiAccessScope = "none", approvalPolicy = "owner", status = "active", ...data }) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), relationshipId, createdByUserId: userId, ownerUserId: data.ownerUserId || userId,
    visibility, aiAccessScope, approvalPolicy, status, version: 1, createdAt: now, updatedAt: now,
    archivedAt: null, withdrawnAt: null, expiresAt: data.expiresAt || null, supersedesId: data.supersedesId || null,
    provenance: { source: data.provenanceSource || "member", createdByUserId: userId, createdAt: now },
    ...data,
  };
}

export function canViewRecord(record, userId) {
  if (!record || record.archivedAt || record.status === "archived") return false;
  if (PRIVATE_VISIBILITIES.has(record.visibility)) return record.ownerUserId === userId;
  if (record.visibility === "shareable_summary") return record.ownerUserId === userId || record.status === "confirmed";
  return JOINT_VISIBILITIES.has(record.visibility) || record.createdByUserId === userId;
}

export function projectRecord(record, userId) {
  if (!canViewRecord(record, userId)) return null;
  const projected = structuredClone(record);
  if (projected.ownerUserId !== userId) {
    delete projected.privateNotes;
    delete projected.estimatedCostRange;
    delete projected.conditions;
    delete projected.rawPerspective;
  }
  return projected;
}

export function projectGraph(snapshot, userId) {
  return Object.fromEntries(GRAPH_COLLECTIONS.map((collection) => [
    collection,
    INTERNAL_COLLECTIONS.has(collection) ? [] : (snapshot[collection] || []).map((record) => projectRecord(record, userId)).filter(Boolean),
  ]));
}

export function buildJointDecisionContext(snapshot, issueId) {
  const issue = (snapshot.issues || []).find((candidate) => candidate.id === issueId);
  if (!issue) return null;
  const summaries = (snapshot.summaries || [])
    .filter((summary) => summary.issueId === issueId && summary.status === "confirmed" && summary.aiAccessScope === "joint" && !summary.withdrawnAt)
    .map(({ ownerUserId, text, provenance, version }) => ({ ownerUserId, text, provenance, version }));
  const agreements = (snapshot.agreements || [])
    .filter((agreement) => agreement.status === "active")
    .map(({ id, title, summary, terms, version }) => ({ id, title, summary, terms, version }));
  const commitments = (snapshot.commitments || [])
    .filter((commitment) => ["active", "completed", "reviewed"].includes(commitment.status))
    .map(({ id, agreementId, description, ownerType, status, dueAt }) => ({ id, agreementId, description, ownerType, status, dueAt }));
  return {
    issue: { id: issue.id, title: issue.title, category: issue.category, sharedContext: issue.sharedContext || "" },
    confirmedSummaries: summaries,
    activeAgreements: agreements,
    commitments,
    safety: { rule: "Do not infer motives, reveal private data, shame either person, or approve on their behalf." },
  };
}

export function buildRelationshipHome(snapshot, userId, now = new Date()) {
  const graph = projectGraph(snapshot, userId);
  const approvalKeys = new Set(graph.approvals.filter((item) => item.ownerUserId === userId && !item.withdrawnAt).map((item) => `${item.agreementId}:${item.approvedVersion}`));
  const responseKeys = new Set(graph.outcomeResponses.filter((item) => item.ownerUserId === userId).map((item) => item.outcomeId));
  const perspectiveIssueIds = new Set(graph.perspectives.filter((item) => item.ownerUserId === userId).map((item) => item.issueId));
  const pending = [
    ...graph.issues.filter((issue) => ["collecting_perspectives", "ready_for_options", "evaluating", "agreement_pending"].includes(issue.status) && !perspectiveIssueIds.has(issue.id)).map((issue) => ({ type: "perspective", id: issue.id, title: issue.title })),
    ...graph.agreements.filter((agreement) => agreement.status === "awaiting_approvals" && !approvalKeys.has(`${agreement.id}:${agreement.version}`)).map((agreement) => ({ type: "approval", id: agreement.id, title: agreement.title })),
    ...graph.outcomes.filter((outcome) => outcome.status === "pending" && new Date(outcome.reviewAt) <= now && !responseKeys.has(outcome.id)).map((outcome) => ({ type: "outcome_review", id: outcome.id, title: outcome.title })),
  ];
  const upcoming = [
    ...graph.milestones.map((milestone) => ({ type: "milestone", id: milestone.id, title: milestone.title, at: nextOccurrence(milestone.date, milestone.recurringRule, now) })),
    ...graph.commitments.filter((item) => item.status === "active" && item.dueAt).map((item) => ({ type: "commitment", id: item.id, title: item.description, at: item.dueAt })),
  ].filter((item) => item.at && new Date(item.at) >= now).sort((a, b) => a.at.localeCompare(b.at)).slice(0, 8);
  const plans = [
    ...graph.agreements.filter((item) => item.status === "active").map((item) => ({ type: "agreement", id: item.id, title: item.title, status: item.status })),
    ...graph.commitments.filter((item) => ["active", "renegotiation_requested"].includes(item.status)).map((item) => ({ type: "commitment", id: item.id, title: item.description, status: item.status, ownerType: item.ownerType, dueAt: item.dueAt })),
  ];
  return { pending, upcoming, plans, recentMoment: null, notifications: graph.notifications.filter((item) => item.ownerUserId === userId && !item.dismissedAt).slice(0, 20) };
}

export function nextOccurrence(date, recurringRule, now = new Date()) {
  const source = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(source.getTime())) return null;
  if (recurringRule !== "yearly") return source.toISOString();
  let candidate = new Date(Date.UTC(now.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate(), 12));
  if (candidate < now) candidate = new Date(Date.UTC(now.getUTCFullYear() + 1, source.getUTCMonth(), source.getUTCDate(), 12));
  return candidate.toISOString();
}

export function localDecisionOptions(context, language = "zh") {
  const [a, b] = context.confirmedSummaries;
  const text = (zh, en, es) => language === "zh" ? zh : language === "es" ? es : en;
  const common = { risks: [text("仍需核对执行条件。", "Execution conditions still need checking.", "Aún deben comprobarse las condiciones de ejecución.")], disputedFacts: [] };
  return [
    { title: text("更靠近第一种需要", "Closer to the first need", "Más cerca de la primera necesidad"), rationale: a?.text || "", tradeoffs: [b?.text || ""], conditions: [], ...common },
    { title: text("更靠近第二种需要", "Closer to the second need", "Más cerca de la segunda necesidad"), rationale: b?.text || "", tradeoffs: [a?.text || ""], conditions: [], ...common },
    { title: text("减少双方最大损失", "Reduce the largest loss for either person", "Reducir la mayor pérdida para ambos"), rationale: text("分阶段执行，并约定复盘时间。", "Use a staged trial with a review date.", "Usar una prueba por etapas con fecha de revisión."), tradeoffs: [], conditions: [text("双方可以随时提出重新协商。", "Either person may request renegotiation.", "Cualquiera puede pedir una renegociación.")], ...common },
  ];
}

export function publicRelationshipEvent(eventType, objectId, version) {
  return { eventType, objectId, version };
}
