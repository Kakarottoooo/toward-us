import { randomUUID } from "node:crypto";
import express from "express";
import {
  buildJointDecisionContext, buildRelationshipHome, canViewRecord, createRelationshipRecord,
  projectGraph, projectRecord, publicRelationshipEvent,
} from "./relationship-domain.mjs";

const MILESTONE_TYPES = new Set(["met", "relationship_started", "first_date", "engagement", "marriage", "birthday", "anniversary", "trip", "custom"]);
const LIST_TYPES = new Set(["date_ideas", "restaurants", "movies", "travel", "gifts", "things_to_learn", "shared_goals", "groceries", "custom"]);
const ISSUE_CATEGORIES = new Set(["money", "time", "chores", "family", "travel", "living_together", "moving", "career", "marriage", "children", "boundaries", "custom"]);
const EVALUATIONS = new Set(["accept", "accept_with_conditions", "revise", "reject"]);

export function createRelationshipRouter({ store, mediator }) {
  const router = express.Router();
  const clients = new Map();

  router.use((req, res, next) => req.auth ? next() : res.status(401).json({ error: "请先登录。" }));

  router.get("/relationship/home", async (req, res) => {
    const context = await activeRelationship(store, req, res); if (!context) return;
    const snapshot = await store.relationshipSnapshotForUser(req.auth.user.id);
    res.json({ home: buildRelationshipHome(snapshot, req.auth.user.id), graph: projectGraph(snapshot, req.auth.user.id), relationship: { id: context.relationship.id, members: context.members.map((member) => ({ id: member.userId, name: member.user.name, role: member.role })) }, capabilities: capabilities() });
  });

  router.get("/relationship/events", async (req, res) => {
    const context = await activeRelationship(store, req, res); if (!context) return;
    res.setHeader("Content-Type", "text/event-stream"); res.setHeader("Cache-Control", "no-cache, no-transform"); res.setHeader("Connection", "keep-alive"); res.flushHeaders?.();
    const client = { res, relationshipId: context.relationship.id, userId: req.auth.user.id };
    const bucket = clients.get(context.relationship.id) || new Set(); bucket.add(client); clients.set(context.relationship.id, bucket);
    res.write(`event: ready\ndata: ${JSON.stringify({ eventType: "ready" })}\n\n`);
    req.on("close", () => { bucket.delete(client); if (!bucket.size) clients.delete(context.relationship.id); });
  });

  router.get("/milestones", listRoute("milestones"));
  router.post("/milestones", async (req, res) => {
    const context = await activeRelationship(store, req, res); if (!context) return;
    const type = MILESTONE_TYPES.has(req.body?.type) ? req.body.type : "custom";
    const date = cleanDate(req.body?.date); if (!date) return res.status(400).json({ error: "请提供有效日期。" });
    const record = createRelationshipRecord({ relationshipId: context.relationship.id, userId: req.auth.user.id, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "active", type, title: clean(req.body?.title, 120), date, timezone: clean(req.body?.timezone, 64) || "UTC", recurringRule: req.body?.recurringRule === "yearly" ? "yearly" : "once", jointlyConfirmed: false, notes: clean(req.body?.notes, 1200) });
    if (!record.title) return res.status(400).json({ error: "请输入纪念日名称。" });
    await store.createRelationshipRecord("milestones", record); await audit(store, record, req.auth.user.id, "milestone.created"); emit(record, "milestone.updated");
    res.status(201).json({ milestone: projectRecord(record, req.auth.user.id) });
  });
  router.patch("/milestones/:id", updateOwnedShared("milestones", ["title", "date", "timezone", "recurringRule", "notes"]));
  router.delete("/milestones/:id", archiveOwned("milestones"));
  router.post("/milestones/:id/reminders", async (req, res) => {
    const milestone = await store.getRelationshipRecordForUser("milestones", req.params.id, req.auth.user.id); if (!milestone) return res.status(404).json({ error: "没有找到这个纪念日。" });
    const isShared = req.body?.visibility === "shared";
    const minutesBefore = clampInt(req.body?.minutesBefore, 0, 525600, 1440); const existing = (await store.listRelationshipRecordsForUser("reminders", req.auth.user.id)).find((item) => item.milestoneId === milestone.id && item.ownerUserId === req.auth.user.id && item.visibility === (isShared ? "shared" : "private") && item.minutesBefore === minutesBefore && !item.archivedAt); if (existing) return res.json({ reminder: projectRecord(existing, req.auth.user.id) });
    const record = createRelationshipRecord({ relationshipId: milestone.relationshipId, userId: req.auth.user.id, visibility: isShared ? "shared" : "private", aiAccessScope: isShared ? "joint" : "private", approvalPolicy: "owner", status: "active", milestoneId: milestone.id, minutesBefore, privateNotes: clean(req.body?.privateNotes, 500), channel: "in_app" });
    await store.createRelationshipRecord("reminders", record); await audit(store, record, req.auth.user.id, "reminder.created"); emit(record, "reminder.updated", isShared ? null : req.auth.user.id);
    res.status(201).json({ reminder: projectRecord(record, req.auth.user.id) });
  });

  router.get("/lists", listRoute("lists"));
  router.post("/lists", async (req, res) => {
    const context = await activeRelationship(store, req, res); if (!context) return;
    const record = createRelationshipRecord({ relationshipId: context.relationship.id, userId: req.auth.user.id, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "active", title: clean(req.body?.title, 120), type: LIST_TYPES.has(req.body?.type) ? req.body.type : "custom" });
    if (!record.title) return res.status(400).json({ error: "请输入清单名称。" });
    await store.createRelationshipRecord("lists", record); await audit(store, record, req.auth.user.id, "list.created"); emit(record, "list.updated");
    res.status(201).json({ list: record });
  });
  router.post("/lists/:id/items", async (req, res) => {
    const list = await store.getRelationshipRecordForUser("lists", req.params.id, req.auth.user.id); if (!list) return res.status(404).json({ error: "没有找到这个清单。" });
    const visibility = req.body?.visibility === "private_surprise" ? "private_surprise" : req.body?.visibility === "private" ? "private" : "shared";
    const record = createRelationshipRecord({ relationshipId: list.relationshipId, userId: req.auth.user.id, visibility, aiAccessScope: visibility === "shared" ? "joint" : "private", approvalPolicy: "owner", status: "active", listId: list.id, title: clean(req.body?.title, 160), description: clean(req.body?.description, 1200), link: safeUrl(req.body?.link), category: clean(req.body?.category, 64), desiredDate: cleanDate(req.body?.desiredDate), estimatedCostRange: clean(req.body?.estimatedCostRange, 80), completedAt: null, revealedAt: null });
    if (!record.title) return res.status(400).json({ error: "请输入清单项目。" });
    await store.createRelationshipRecord("listItems", record); await audit(store, record, req.auth.user.id, "list_item.created");
    if (visibility === "shared") { await notifyMembers(await store.getRelationshipContext(req.auth.user.id), req.auth.user.id, "shared_item_added", "Toward Us 有一项共同清单更新。", `/lists/${list.id}`); emit(record, "list_item.updated"); }
    else emit(record, "list_item.updated", req.auth.user.id);
    res.status(201).json({ item: projectRecord(record, req.auth.user.id) });
  });
  router.patch("/list-items/:id", updateOwnedShared("listItems", ["title", "description", "link", "desiredDate", "estimatedCostRange", "status"]));
  router.post("/list-items/:id/reveal", async (req, res) => {
    const current = await store.getRelationshipRecordForUser("listItems", req.params.id, req.auth.user.id);
    if (!current || current.ownerUserId !== req.auth.user.id) return res.status(404).json({ error: "没有找到这个私人项目。" });
    const item = await store.updateRelationshipRecordForUser("listItems", current.id, req.auth.user.id, (draft) => { if (draft.visibility === "revealed") return; if (draft.visibility !== "private_surprise") throw statusError(409, "只有私人惊喜可以揭晓。"); draft.visibility = "revealed"; draft.aiAccessScope = "joint"; draft.revealedAt = new Date().toISOString(); draft.version += 1; });
    await audit(store, item, req.auth.user.id, "list_item.revealed"); emit(item, "list_item.updated"); res.json({ item });
  });
  router.delete("/list-items/:id", archiveOwned("listItems"));

  router.get("/issues", listRoute("issues"));
  router.get("/issues/:id", async (req, res) => {
    const issue = await store.getRelationshipRecordForUser("issues", req.params.id, req.auth.user.id); if (!issue) return res.status(404).json({ error: "没有找到这个共同决定。" });
    const snapshot = await store.relationshipSnapshotForUser(req.auth.user.id); const graph = projectGraph(snapshot, req.auth.user.id);
    const evaluationCounts = Object.fromEntries((snapshot.proposals || []).filter((item) => item.issueId === issue.id).map((proposal) => [proposal.id, new Set((snapshot.evaluations || []).filter((item) => item.proposalId === proposal.id && !item.withdrawnAt).map((item) => item.ownerUserId)).size]));
    res.json({ issue: projectRecord(issue, req.auth.user.id), perspectives: graph.perspectives.filter((item) => item.issueId === issue.id), summaries: graph.summaries.filter((item) => item.issueId === issue.id), proposals: graph.proposals.filter((item) => item.issueId === issue.id), evaluations: graph.evaluations.filter((item) => item.issueId === issue.id), evaluationCounts, agreements: graph.agreements.filter((item) => item.sourceIssueId === issue.id) });
  });
  router.post("/issues", async (req, res) => {
    const context = await activeRelationship(store, req, res); if (!context) return;
    const record = createRelationshipRecord({ relationshipId: context.relationship.id, userId: req.auth.user.id, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "collecting_perspectives", title: clean(req.body?.title, 160), category: ISSUE_CATEGORIES.has(req.body?.category) ? req.body.category : "custom", sharedContext: clean(req.body?.sharedContext, 1200) });
    if (!record.title) return res.status(400).json({ error: "请输入需要共同决定的事情。" });
    await store.createRelationshipRecord("issues", record); await audit(store, record, req.auth.user.id, "issue.created"); emit(record, "issue.updated"); res.status(201).json({ issue: record });
  });
  router.post("/issues/:id/perspectives", async (req, res) => {
    const issue = await store.getRelationshipRecordForUser("issues", req.params.id, req.auth.user.id); if (!issue) return res.status(404).json({ error: "没有找到这个共同决定。" });
    const snapshot = await store.relationshipSnapshotForUser(req.auth.user.id); if (snapshot.perspectives.some((item) => item.issueId === issue.id && item.ownerUserId === req.auth.user.id && !item.archivedAt)) return res.status(409).json({ error: "你已经提交过自己的观点，可以在后续版本中修改。" });
    const perspective = createRelationshipRecord({ relationshipId: issue.relationshipId, userId: req.auth.user.id, visibility: "private", aiAccessScope: "private", approvalPolicy: "owner", status: "submitted", issueId: issue.id, goal: clean(req.body?.goal, 1200), importance: clean(req.body?.importance, 1200), constraints: clean(req.body?.constraints, 1200), negotiables: clean(req.body?.negotiables, 1200), concerns: clean(req.body?.concerns, 1200), shareableText: clean(req.body?.shareableText, 1200), privateNotes: clean(req.body?.privateNotes, 1200), rawPerspective: clean(req.body?.privateNotes, 1200) });
    if (!perspective.goal) return res.status(400).json({ error: "请先说明你希望得到什么。" });
    await store.createRelationshipRecord("perspectives", perspective);
    const draft = await mediator.summarizePerspective(perspective, req.body?.language || "zh");
    const summary = createRelationshipRecord({ relationshipId: issue.relationshipId, userId: req.auth.user.id, visibility: "shareable_summary", aiAccessScope: "none", approvalPolicy: "owner", status: "draft", issueId: issue.id, perspectiveId: perspective.id, text: clean(draft.text, 1600), source: draft.source });
    await store.createRelationshipRecord("summaries", summary); await audit(store, perspective, req.auth.user.id, "perspective.submitted"); emit(issue, "issue.updated");
    res.status(201).json({ perspective: projectRecord(perspective, req.auth.user.id), summary });
  });
  router.post("/issues/:id/shareable-summary", async (req, res) => {
    const issue = await store.getRelationshipRecordForUser("issues", req.params.id, req.auth.user.id); if (!issue) return res.status(404).json({ error: "没有找到这个共同决定。" });
    const snapshot = await store.relationshipSnapshotForUser(req.auth.user.id); const current = snapshot.summaries.find((item) => item.issueId === issue.id && item.ownerUserId === req.auth.user.id && item.status === "draft");
    if (!current) return res.status(404).json({ error: "没有可确认的共享摘要草稿。" });
    const summary = await store.updateRelationshipRecordForUser("summaries", current.id, req.auth.user.id, (draft) => { draft.text = clean(req.body?.text, 1600) || draft.text; draft.status = "confirmed"; draft.aiAccessScope = "joint"; draft.confirmedAt = new Date().toISOString(); draft.version += 1; });
    await audit(store, summary, req.auth.user.id, "shareable_summary.confirmed"); emit(issue, "issue.updated"); res.json({ summary });
  });
  router.post("/issues/:id/generate-options", async (req, res) => {
    const issue = await store.getRelationshipRecordForUser("issues", req.params.id, req.auth.user.id); if (!issue) return res.status(404).json({ error: "没有找到这个共同决定。" });
    const snapshot = await store.relationshipSnapshotForUser(req.auth.user.id); const existing = snapshot.proposals.filter((item) => item.issueId === issue.id && !item.archivedAt); if (existing.length) return res.json({ proposals: existing.map((item) => projectRecord(item, req.auth.user.id)) }); const context = buildJointDecisionContext(snapshot, issue.id);
    if (!context || context.confirmedSummaries.length !== 2) return res.status(409).json({ error: "双方分别确认可共享摘要后才能生成方案。" });
    const generated = await mediator.generateDecisionOptions(context, req.body?.language || "zh"); const proposals = [];
    for (const option of generated.options.slice(0, 4)) { const record = createRelationshipRecord({ relationshipId: issue.relationshipId, userId: req.auth.user.id, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "open", issueId: issue.id, ...option, source: generated.source }); await store.createRelationshipRecord("proposals", record); proposals.push(record); }
    await store.updateRelationshipRecordForUser("issues", issue.id, req.auth.user.id, (draft) => { draft.status = "evaluating"; draft.version += 1; }); await audit(store, issue, req.auth.user.id, "decision_options.generated"); emit(issue, "issue.updated"); res.status(201).json({ proposals });
  });
  router.post("/proposals/:id/evaluations", async (req, res) => {
    const proposal = await store.getRelationshipRecordForUser("proposals", req.params.id, req.auth.user.id); if (!proposal) return res.status(404).json({ error: "没有找到这个方案。" });
    const value = EVALUATIONS.has(req.body?.value) ? req.body.value : null; if (!value) return res.status(400).json({ error: "请选择有效评价。" });
    const snapshot = await store.relationshipSnapshotForUser(req.auth.user.id); if (snapshot.evaluations.some((item) => item.proposalId === proposal.id && item.ownerUserId === req.auth.user.id)) return res.status(409).json({ error: "你已经评价过这个版本。" });
    const evaluation = createRelationshipRecord({ relationshipId: proposal.relationshipId, userId: req.auth.user.id, visibility: "private", aiAccessScope: "private", approvalPolicy: "owner", status: "submitted", issueId: proposal.issueId, proposalId: proposal.id, value, conditions: clean(req.body?.conditions, 800) });
    await store.createRelationshipRecord("evaluations", evaluation); await audit(store, evaluation, req.auth.user.id, "proposal.evaluated"); emit(proposal, "proposal.evaluated"); res.status(201).json({ evaluation });
  });

  router.post("/agreements", async (req, res) => {
    const issue = await store.getRelationshipRecordForUser("issues", req.body?.sourceIssueId, req.auth.user.id); const proposal = await store.getRelationshipRecordForUser("proposals", req.body?.proposalId, req.auth.user.id);
    if (!issue || !proposal || proposal.issueId !== issue.id) return res.status(400).json({ error: "Agreement 必须来自当前关系中的有效方案。" });
    const snapshot = await store.relationshipSnapshotForUser(req.auth.user.id); const context = await store.getRelationshipContext(req.auth.user.id); const evaluatedUsers = new Set(snapshot.evaluations.filter((item) => item.proposalId === proposal.id && !item.withdrawnAt).map((item) => item.ownerUserId));
    if (evaluatedUsers.size !== context.members.length) return res.status(409).json({ error: "双方分别评价这个方案后才能起草 Agreement。" });
    const existing = snapshot.agreements.find((item) => item.proposalId === proposal.id && !item.archivedAt); if (existing) return res.json({ agreement: existing });
    const record = createRelationshipRecord({ relationshipId: issue.relationshipId, userId: req.auth.user.id, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "awaiting_approvals", sourceIssueId: issue.id, proposalId: proposal.id, title: clean(req.body?.title, 160) || proposal.title, summary: clean(req.body?.summary, 1200) || proposal.rationale, terms: cleanArray(req.body?.terms, 8, 500), unresolvedPoints: cleanArray(req.body?.unresolvedPoints, 8, 500), effectiveAt: null, reviewAt: validIso(req.body?.reviewAt), supersedesAgreementId: req.body?.supersedesAgreementId || null });
    await store.createRelationshipRecord("agreements", record); await store.updateRelationshipRecordForUser("issues", issue.id, req.auth.user.id, (draft) => { draft.status = "agreement_pending"; draft.version += 1; }); await audit(store, record, req.auth.user.id, "agreement.created"); emit(record, "agreement.updated"); res.status(201).json({ agreement: record });
  });
  router.patch("/agreements/:id", async (req, res) => {
    const current = await store.getRelationshipRecordForUser("agreements", req.params.id, req.auth.user.id); if (!current || !["draft", "awaiting_approvals"].includes(current.status)) return res.status(409).json({ error: "当前 Agreement 不能修改。" });
    if (Number(req.body?.version) !== current.version) return res.status(409).json({ error: "Agreement 已有新版本，请刷新后再修改。" });
    const agreement = await store.updateRelationshipRecordForUser("agreements", current.id, req.auth.user.id, (draft) => { draft.title = clean(req.body?.title, 160) || draft.title; draft.summary = clean(req.body?.summary, 1200) || draft.summary; if (req.body?.terms) draft.terms = cleanArray(req.body.terms, 8, 500); draft.version += 1; draft.status = "awaiting_approvals"; });
    await audit(store, agreement, req.auth.user.id, "agreement.changed"); emit(agreement, "agreement.updated"); res.json({ agreement });
  });
  router.post("/agreements/:id/approve", async (req, res) => {
    const agreement = await store.getRelationshipRecordForUser("agreements", req.params.id, req.auth.user.id); if (!agreement || agreement.status !== "awaiting_approvals") return res.status(409).json({ error: "当前 Agreement 不等待批准。" });
    const snapshot = await store.relationshipSnapshotForUser(req.auth.user.id); const existing = snapshot.approvals.find((item) => item.agreementId === agreement.id && item.ownerUserId === req.auth.user.id && item.approvedVersion === agreement.version && !item.withdrawnAt);
    if (!existing) {
      const approval = createRelationshipRecord({ relationshipId: agreement.relationshipId, userId: req.auth.user.id, visibility: "private", aiAccessScope: "none", approvalPolicy: "owner", status: "approved", agreementId: agreement.id, approvedVersion: agreement.version, approvedAt: new Date().toISOString() });
      approval.id = `approval:${agreement.id}:${agreement.version}:${req.auth.user.id}`;
      try { await store.createRelationshipRecord("approvals", approval); } catch (error) { if (error?.code !== "23505") throw error; }
    }
    const refreshed = await store.relationshipSnapshotForUser(req.auth.user.id); const approvedUsers = new Set(refreshed.approvals.filter((item) => item.agreementId === agreement.id && item.approvedVersion === agreement.version && !item.withdrawnAt).map((item) => item.ownerUserId)); const context = await store.getRelationshipContext(req.auth.user.id);
    let updated = agreement; if (approvedUsers.size === context.members.length) updated = await store.updateRelationshipRecordForUser("agreements", agreement.id, req.auth.user.id, (draft) => { draft.status = "active"; draft.effectiveAt = new Date().toISOString(); draft.version = agreement.version; });
    await audit(store, updated, req.auth.user.id, "agreement.approved"); emit(updated, "agreement.updated"); res.json({ agreement: updated, approvedCount: approvedUsers.size, requiredCount: context.members.length });
  });
  router.post("/agreements/:id/reject", agreementState("cancelled", "agreement.rejected"));
  router.post("/agreements/:id/request-change", agreementState("draft", "agreement.change_requested"));

  router.post("/commitments", async (req, res) => {
    const agreement = await store.getRelationshipRecordForUser("agreements", req.body?.agreementId, req.auth.user.id); if (!agreement || agreement.status !== "active") return res.status(409).json({ error: "Commitment 只能关联当前关系中已生效的 Agreement。" });
    const ownerType = ["member_a", "member_b", "both"].includes(req.body?.ownerType) ? req.body.ownerType : "both";
    const description = clean(req.body?.description, 600); const existing = (await store.listRelationshipRecordsForUser("commitments", req.auth.user.id)).find((item) => item.agreementId === agreement.id && item.ownerType === ownerType && item.description === description && !item.archivedAt); if (existing) return res.json({ commitment: existing });
    const record = createRelationshipRecord({ relationshipId: agreement.relationshipId, userId: req.auth.user.id, visibility: "shared", aiAccessScope: "joint", approvalPolicy: ownerType === "both" ? "both" : "owner", status: "active", agreementId: agreement.id, ownerType, description, dueAt: validIso(req.body?.dueAt), recurrence: clean(req.body?.recurrence, 64) || "none", completionEvidence: null, completedAt: null, completedBy: [], reviewRequired: req.body?.reviewRequired !== false, reviewAt: validIso(req.body?.reviewAt) });
    if (!record.description) return res.status(400).json({ error: "请输入承诺内容。" });
    await store.createRelationshipRecord("commitments", record); await audit(store, record, req.auth.user.id, "commitment.created"); emit(record, "commitment.updated"); res.status(201).json({ commitment: record });
  });
  router.patch("/commitments/:id", async (req, res) => {
    const current = await store.getRelationshipRecordForUser("commitments", req.params.id, req.auth.user.id); if (!current || current.createdByUserId !== req.auth.user.id || current.status !== "active") return res.status(409).json({ error: "当前 Commitment 不能由这个账号修改。" });
    if (Number(req.body?.version) !== current.version) return res.status(409).json({ error: "Commitment 已有新版本，请刷新后再修改。" });
    const record = await store.updateRelationshipRecordForUser("commitments", current.id, req.auth.user.id, (draft) => { if (req.body?.description !== undefined) draft.description = clean(req.body.description, 600) || draft.description; if (req.body?.dueAt !== undefined) draft.dueAt = validIso(req.body.dueAt); if (req.body?.reviewAt !== undefined) draft.reviewAt = validIso(req.body.reviewAt); if (req.body?.recurrence !== undefined) draft.recurrence = clean(req.body.recurrence, 64) || "none"; draft.version += 1; });
    await audit(store, record, req.auth.user.id, "commitment.updated"); emit(record, "commitment.updated"); res.json({ commitment: record });
  });
  router.post("/commitments/:id/complete", async (req, res) => {
    const context = await activeRelationship(store, req, res); if (!context) return; const commitment = await store.getRelationshipRecordForUser("commitments", req.params.id, req.auth.user.id); if (!commitment || commitment.status !== "active") return res.status(409).json({ error: "当前 Commitment 不能完成。" });
    const role = context.members.find((member) => member.userId === req.auth.user.id)?.role; const allowed = commitment.ownerType === "both" || commitment.ownerType === `member_${String(role).toLowerCase()}`; if (!allowed) return res.status(403).json({ error: "只有该 Commitment 的负责人可以确认完成。" });
    let completedNow = false;
    const updated = await store.updateRelationshipRecordForUser("commitments", commitment.id, req.auth.user.id, (draft) => { if (draft.status !== "active") return; draft.completedBy = [...new Set([...(draft.completedBy || []), req.auth.user.id])]; const required = draft.ownerType === "both" ? 2 : 1; if (draft.completedBy.length >= required) { draft.status = "completed"; draft.completedAt = new Date().toISOString(); completedNow = true; } draft.completionEvidence = clean(req.body?.completionEvidence, 800); draft.version += 1; });
    let outcome = null; if (completedNow && updated.reviewRequired) { const reviewAt = updated.reviewAt || new Date(Date.now() + 3 * 86400000).toISOString(); outcome = createRelationshipRecord({ relationshipId: updated.relationshipId, userId: req.auth.user.id, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "pending", commitmentId: updated.id, agreementId: updated.agreementId, title: "三天后复盘 / Outcome review", reviewAt, finalizedAt: null, learnedPattern: null }); outcome.id = `outcome:${updated.id}`; try { await store.createRelationshipRecord("outcomes", outcome); } catch (error) { if (error?.code !== "23505") throw error; outcome = null; } }
    await audit(store, updated, req.auth.user.id, "commitment.completed"); emit(updated, "commitment.updated"); res.json({ commitment: updated, outcome });
  });
  router.post("/commitments/:id/renegotiate", agreementStateFor("commitments", "renegotiation_requested", "commitment.renegotiation_requested"));

  router.get("/outcome-reviews/due", async (req, res) => { const snapshot = await store.relationshipSnapshotForUser(req.auth.user.id); const graph = projectGraph(snapshot, req.auth.user.id); res.json({ outcomes: graph.outcomes.filter((item) => item.status === "pending" && new Date(item.reviewAt) <= new Date()) }); });
  router.post("/outcome-reviews/:id/responses", async (req, res) => {
    const outcome = await store.getRelationshipRecordForUser("outcomes", req.params.id, req.auth.user.id); if (!outcome || outcome.status !== "pending" || new Date(outcome.reviewAt) > new Date()) return res.status(409).json({ error: "这次复盘尚未到期或已经结束。" });
    const snapshot = await store.relationshipSnapshotForUser(req.auth.user.id); if (snapshot.outcomeResponses.some((item) => item.outcomeId === outcome.id && item.ownerUserId === req.auth.user.id)) return res.status(409).json({ error: "你已经提交过本次复盘。" });
    const response = createRelationshipRecord({ relationshipId: outcome.relationshipId, userId: req.auth.user.id, visibility: "private", aiAccessScope: "private", approvalPolicy: "owner", status: "submitted", outcomeId: outcome.id, actionCompleted: Boolean(req.body?.actionCompleted), improvement: ["improved", "same", "worse"].includes(req.body?.improvement) ? req.body.improvement : "same", effective: clean(req.body?.effective, 1000), ineffective: clean(req.body?.ineffective, 1000), stillAccept: Boolean(req.body?.stillAccept), renegotiate: Boolean(req.body?.renegotiate), allowLearnedPattern: Boolean(req.body?.allowLearnedPattern), learnedPatternCandidate: clean(req.body?.learnedPatternCandidate, 600) });
    await store.createRelationshipRecord("outcomeResponses", response); await audit(store, response, req.auth.user.id, "outcome.response_submitted"); emit(outcome, "outcome.updated"); res.status(201).json({ response: projectRecord(response, req.auth.user.id) });
  });
  router.post("/outcome-reviews/:id/finalize", async (req, res) => {
    const context = await activeRelationship(store, req, res); if (!context) return; const outcome = await store.getRelationshipRecordForUser("outcomes", req.params.id, req.auth.user.id); if (!outcome || outcome.status !== "pending") return res.status(409).json({ error: "当前复盘不能结束。" });
    const snapshot = await store.relationshipSnapshotForUser(req.auth.user.id); const responses = snapshot.outcomeResponses.filter((item) => item.outcomeId === outcome.id); if (new Set(responses.map((item) => item.ownerUserId)).size !== context.members.length) return res.status(409).json({ error: "双方分别完成复盘后才能形成共同结果。" });
    const candidates = [...new Set(responses.map((item) => item.learnedPatternCandidate).filter(Boolean))]; const learned = responses.every((item) => item.actionCompleted && item.allowLearnedPattern && item.improvement !== "worse") && candidates.length === 1 ? candidates[0] : null;
    const updated = await store.updateRelationshipRecordForUser("outcomes", outcome.id, req.auth.user.id, (draft) => { draft.status = "completed"; draft.finalizedAt = new Date().toISOString(); draft.executionStatus = responses.every((item) => item.actionCompleted) ? "completed" : "partial"; draft.mutualSatisfaction = responses.every((item) => item.improvement === "improved") ? "mutually_improved" : "mixed"; draft.effectiveElements = responses.map((item) => item.effective).filter(Boolean); draft.ineffectiveElements = responses.map((item) => item.ineffective).filter(Boolean); draft.nextAction = responses.some((item) => item.renegotiate) ? "renegotiate" : "continue"; draft.learnedPattern = learned; draft.version += 1; });
    await audit(store, updated, req.auth.user.id, "outcome.finalized"); emit(updated, "outcome.updated"); res.json({ outcome: updated });
  });

  router.get("/notifications", async (req, res) => { const items = await store.listRelationshipRecordsForUser("notifications", req.auth.user.id); res.json({ notifications: items.filter((item) => item.ownerUserId === req.auth.user.id && canViewRecord(item, req.auth.user.id)) }); });
  router.post("/notifications/:id/read", notificationMutation("readAt"));
  router.post("/notifications/:id/dismiss", notificationMutation("dismissedAt"));

  function listRoute(collection) { return async (req, res) => { const records = await store.listRelationshipRecordsForUser(collection, req.auth.user.id); res.json({ items: records.map((item) => projectRecord(item, req.auth.user.id)).filter(Boolean) }); }; }
  function updateOwnedShared(collection, fields) { return async (req, res) => { const current = await store.getRelationshipRecordForUser(collection, req.params.id, req.auth.user.id); if (!current || current.createdByUserId !== req.auth.user.id) return res.status(404).json({ error: "没有找到可修改的对象。" }); const record = await store.updateRelationshipRecordForUser(collection, current.id, req.auth.user.id, (draft) => { for (const field of fields) if (req.body?.[field] !== undefined) draft[field] = typeof req.body[field] === "string" ? clean(req.body[field], 1200) : req.body[field]; draft.version += 1; }); await audit(store, record, req.auth.user.id, `${collection}.updated`); emit(record, `${collection}.updated`, PRIVATE_VISIBILITY(record) ? req.auth.user.id : null); res.json({ item: projectRecord(record, req.auth.user.id) }); }; }
  function archiveOwned(collection) { return async (req, res) => { const current = await store.getRelationshipRecordForUser(collection, req.params.id, req.auth.user.id); if (!current || current.createdByUserId !== req.auth.user.id) return res.status(404).json({ error: "没有找到可归档的对象。" }); const record = await store.updateRelationshipRecordForUser(collection, current.id, req.auth.user.id, (draft) => { draft.status = "archived"; draft.archivedAt = new Date().toISOString(); draft.version += 1; }); await audit(store, record, req.auth.user.id, `${collection}.archived`); emit(record, `${collection}.updated`, PRIVATE_VISIBILITY(record) ? req.auth.user.id : null); res.status(204).end(); }; }
  function agreementState(status, event) { return agreementStateFor("agreements", status, event); }
  function agreementStateFor(collection, status, event) { return async (req, res) => { const current = await store.getRelationshipRecordForUser(collection, req.params.id, req.auth.user.id); if (!current) return res.status(404).json({ error: "没有找到对象。" }); const record = await store.updateRelationshipRecordForUser(collection, current.id, req.auth.user.id, (draft) => { draft.status = status; draft.version += 1; }); await audit(store, record, req.auth.user.id, event); emit(record, event); res.json({ item: record }); }; }
  function notificationMutation(field) { return async (req, res) => { const current = await store.getRelationshipRecordForUser("notifications", req.params.id, req.auth.user.id); if (!current || current.ownerUserId !== req.auth.user.id) return res.status(404).json({ error: "没有找到通知。" }); const notification = await store.updateRelationshipRecordForUser("notifications", current.id, req.auth.user.id, (draft) => { draft[field] = new Date().toISOString(); draft.version += 1; }); res.json({ notification }); }; }
  function emit(record, eventType, ownerUserId = null) { const payload = publicRelationshipEvent(eventType, record.id, record.version); for (const client of clients.get(record.relationshipId) || []) if (!ownerUserId || client.userId === ownerUserId) client.res.write(`event: relationship\ndata: ${JSON.stringify(payload)}\n\n`); }
  async function notifyMembers(context, actorId, type, title, actionUrl) { if (!context?.members) return; const current = await store.listRelationshipRecordsForUser("notifications", actorId); for (const member of context.members.filter((item) => item.userId !== actorId)) { const dedupeKey = `${type}:${actionUrl}:${member.userId}`; if (current.some((item) => item.dedupeKey === dedupeKey && !item.dismissedAt)) continue; const notification = createRelationshipRecord({ relationshipId: context.relationship.id, userId: actorId, ownerUserId: member.userId, visibility: "private", aiAccessScope: "none", approvalPolicy: "owner", status: "unread", type, title, actionUrl, dedupeKey, readAt: null, dismissedAt: null }); await store.createRelationshipRecord("notifications", notification); emit(notification, "notification.updated", member.userId); } }
  return router;
}

async function activeRelationship(store, req, res) { const context = await store.getRelationshipContext(req.auth.user.id); if (!context || context.relationship.status !== "active" || context.members.length !== 2) { res.status(409).json({ error: "需要双方账号完成伴侣绑定。" }); return null; } return context; }
async function audit(store, source, userId, eventType) { const event = createRelationshipRecord({ relationshipId: source.relationshipId, userId, visibility: "private", aiAccessScope: "none", approvalPolicy: "owner", status: "recorded", objectId: source.id, objectType: eventType.split(".")[0], eventType, sourceVersion: source.version }); await store.createRelationshipRecord("consentEvents", event); }
const PRIVATE_VISIBILITY = (record) => ["private", "private_surprise"].includes(record.visibility);
const clean = (value, limit) => String(value || "").trim().replace(/\0/g, "").slice(0, limit);
const cleanArray = (value, count, limit) => Array.isArray(value) ? value.slice(0, count).map((item) => clean(item, limit)).filter(Boolean) : [];
const cleanDate = (value) => { const text = String(value || ""); const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text); if (!match) return null; const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))); return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) ? text : null; };
const validIso = (value) => { const date = new Date(value || ""); return Number.isNaN(date.getTime()) ? null : date.toISOString(); };
const clampInt = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Math.round(Number(value)))) : fallback;
const safeUrl = (value) => { try { const url = new URL(String(value || "")); return ["http:", "https:"].includes(url.protocol) ? url.toString().slice(0, 1200) : ""; } catch { return ""; } };
const statusError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const capabilities = () => ({ p0RelationshipAgent: true, memories: false, checkins: false, sharedCompanion: false, calendarIntegration: false, safeShare: false, moneyProtocol: false, intimacyMatching: false, nativeBackgroundLocation: false });
