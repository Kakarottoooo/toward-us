import { randomUUID } from "node:crypto";
import express from "express";
import { createDecisionAgent } from "./decision-agent.mjs";
import {
  buildJointDecisionContext, buildRelationshipHome, canViewRecord, createRelationshipRecord,
  projectGraph, projectRecord, publicRelationshipEvent,
} from "./relationship-domain.mjs";

const MILESTONE_TYPES = new Set(["met", "relationship_started", "first_date", "engagement", "marriage", "birthday", "anniversary", "trip", "custom"]);
const LIST_TYPES = new Set(["date_ideas", "restaurants", "movies", "travel", "gifts", "things_to_learn", "shared_goals", "groceries", "custom"]);
const ISSUE_CATEGORIES = new Set(["money", "time", "chores", "family", "travel", "living_together", "moving", "career", "marriage", "children", "boundaries", "custom"]);
const EVALUATIONS = new Set(["accept", "accept_with_conditions", "revise", "reject"]);

export function createRelationshipRouter({ store, mediator, decisionAgent = createDecisionAgent() }) {
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

  router.get("/private-agent/threads", async (req, res) => {
    const context = await activeRelationship(store, req, res); if (!context) return;
    const records = await store.listRelationshipRecordsForUser("privateAgentThreads", req.auth.user.id);
    res.json({ threads: records.filter((item) => item.ownerUserId === req.auth.user.id && canViewRecord(item, req.auth.user.id)).map((item) => projectRecord(item, req.auth.user.id)) });
  });
  router.post("/private-agent/threads", async (req, res) => {
    const context = await activeRelationship(store, req, res); if (!context) return;
    const intentType = req.body?.intentType === "plan" ? "plan" : "decision";
    const issueId = clean(req.body?.issueId, 80) || null;
    if (issueId) { const issue = await store.getRelationshipRecordForUser("issues", issueId, req.auth.user.id); if (!issue) return res.status(404).json({ error: "没有找到这个共同决定。" }); }
    const thread = createRelationshipRecord({ relationshipId: context.relationship.id, userId: req.auth.user.id, visibility: "private", aiAccessScope: "private", approvalPolicy: "owner", status: "exploring", intentType, issueId, language: ["zh", "en", "es"].includes(req.body?.language) ? req.body.language : "zh", messages: [], draft: {}, readyToShare: false, source: "member" });
    await store.createRelationshipRecord("privateAgentThreads", thread); await audit(store, thread, req.auth.user.id, "private_agent_thread.created"); emit(thread, "private_agent_thread.updated", req.auth.user.id);
    res.status(201).json({ thread: projectRecord(thread, req.auth.user.id) });
  });
  router.get("/private-agent/threads/:id", async (req, res) => {
    const thread = await ownedPrivateThread(store, req.params.id, req.auth.user.id); if (!thread) return res.status(404).json({ error: "没有找到这个私人对话。" });
    res.json({ thread: projectRecord(thread, req.auth.user.id) });
  });
  router.post("/private-agent/threads/:id/messages", async (req, res) => {
    const thread = await ownedPrivateThread(store, req.params.id, req.auth.user.id); if (!thread) return res.status(404).json({ error: "没有找到这个私人对话。" });
    const text = clean(req.body?.text, 2000); if (!text) return res.status(400).json({ error: "请先说点什么。" });
    const updated = await appendPrivateAgentTurn(store, mediator, thread, req.auth.user.id, text, req.body?.language || "zh", clean(req.body?.itemId, 120));
    emit(updated, "private_agent_thread.updated", req.auth.user.id); res.json({ thread: projectRecord(updated, req.auth.user.id) });
  });
  router.post("/private-agent/threads/:id/realtime", express.text({ type: "application/sdp", limit: "128kb" }), async (req, res, next) => {
    try {
      const thread = await ownedPrivateThread(store, req.params.id, req.auth.user.id); if (!thread) return res.status(404).json({ error: "没有找到这个私人对话。" });
      const answer = await mediator.createRealtimeSession({ sdp: req.body, language: thread.language || "zh", safetyIdentifier: req.auth.user.id }); res.type("application/sdp").send(answer);
    } catch (error) { next(error); }
  });
  router.post("/private-agent/threads/:id/transcripts", async (req, res) => {
    const thread = await ownedPrivateThread(store, req.params.id, req.auth.user.id); if (!thread) return res.status(404).json({ error: "没有找到这个私人对话。" });
    const text = clean(req.body?.text, 2000); const itemId = clean(req.body?.itemId, 120); if (!text) return res.status(400).json({ error: "没有识别到可保存的语音。" });
    if (itemId && (thread.messages || []).some((item) => item.itemId === itemId)) return res.json({ thread: projectRecord(thread, req.auth.user.id) });
    const updated = await appendPrivateAgentTurn(store, mediator, thread, req.auth.user.id, text, thread.language || "zh", itemId);
    emit(updated, "private_agent_thread.updated", req.auth.user.id); res.json({ thread: projectRecord(updated, req.auth.user.id) });
  });
  router.post("/private-agent/threads/:id/share-decision", async (req, res) => {
    const context = await activeRelationship(store, req, res); if (!context) return;
    const thread = await ownedPrivateThread(store, req.params.id, req.auth.user.id); if (!thread || thread.intentType !== "decision") return res.status(404).json({ error: "没有找到这个私人决定对话。" });
    if (thread.sharedObjectId) { const issue = await store.getRelationshipRecordForUser("issues", thread.sharedObjectId, req.auth.user.id); return res.json({ issue, thread }); }
    const draft = thread.draft || {}; const title = clean(req.body?.title, 160) || clean(draft.title, 160); const summaryText = clean(req.body?.summary, 1600) || clean(draft.shareableSummary, 1600);
    if (!title || !summaryText) return res.status(409).json({ error: "先和 Agent 把要讨论的事情与可分享观点整理清楚。" });
    let issue = thread.issueId ? await store.getRelationshipRecordForUser("issues", thread.issueId, req.auth.user.id) : null;
    if (!issue) {
      issue = createRelationshipRecord({ relationshipId: context.relationship.id, userId: req.auth.user.id, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "collecting_perspectives", title, category: ISSUE_CATEGORIES.has(draft.category) ? draft.category : "custom", sharedContext: summaryText, sourceThreadId: thread.id });
      await store.createRelationshipRecord("issues", issue); await audit(store, issue, req.auth.user.id, "issue.shared_from_private_agent");
    }
    const snapshot = await store.relationshipSnapshotForUser(req.auth.user.id);
    let perspective = snapshot.perspectives.find((item) => item.issueId === issue.id && item.ownerUserId === req.auth.user.id && !item.archivedAt);
    if (!perspective) {
      perspective = createRelationshipRecord({ relationshipId: issue.relationshipId, userId: req.auth.user.id, visibility: "private", aiAccessScope: "private", approvalPolicy: "owner", status: "submitted", issueId: issue.id, goal: clean(draft.goal, 1200) || summaryText, importance: clean(draft.importance, 1200), constraints: clean(draft.constraints, 1200), negotiables: clean(draft.negotiables, 1200), concerns: clean(draft.concerns, 1200), privateNotes: "", rawPerspective: "", sourceThreadId: thread.id });
      await store.createRelationshipRecord("perspectives", perspective);
    }
    let summary = snapshot.summaries.find((item) => item.issueId === issue.id && item.ownerUserId === req.auth.user.id && item.status === "confirmed");
    if (!summary) {
      summary = createRelationshipRecord({ relationshipId: issue.relationshipId, userId: req.auth.user.id, visibility: "shareable_summary", aiAccessScope: "joint", approvalPolicy: "owner", status: "confirmed", issueId: issue.id, perspectiveId: perspective.id, text: summaryText, source: thread.source || "private-agent", confirmedAt: new Date().toISOString() });
      await store.createRelationshipRecord("summaries", summary);
    }
    const updated = await store.updateRelationshipRecordForUser("privateAgentThreads", thread.id, req.auth.user.id, (record) => { record.status = "shared"; record.sharedObjectId = issue.id; record.sharedAt = new Date().toISOString(); record.version += 1; });
    await audit(store, updated, req.auth.user.id, "private_agent_thread.shared"); await notifyMembers(context, req.auth.user.id, "decision_shared", `${req.auth.user.name} 想和你一起考虑：${title}`, `/decisions/${issue.id}`); emit(issue, "issue.updated"); emit(updated, "private_agent_thread.updated", req.auth.user.id);
    res.status(201).json({ issue, summary, thread: projectRecord(updated, req.auth.user.id) });
  });
  router.post("/private-agent/threads/:id/apply-plan", async (req, res) => {
    const context = await activeRelationship(store, req, res); if (!context) return;
    const thread = await ownedPrivateThread(store, req.params.id, req.auth.user.id); if (!thread || thread.intentType !== "plan") return res.status(404).json({ error: "没有找到这个私人计划对话。" });
    if (thread.sharedObjectId) { const milestone = await store.getRelationshipRecordForUser("milestones", thread.sharedObjectId, req.auth.user.id); return res.json({ milestone, thread }); }
    const draft = thread.draft || {}; const title = clean(req.body?.title, 120) || clean(draft.title, 120); const date = cleanDate(req.body?.date || draft.date); if (!title || !date) return res.status(409).json({ error: "先和 Agent 确认计划名称与日期。" });
    const milestone = createRelationshipRecord({ relationshipId: context.relationship.id, userId: req.auth.user.id, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "active", type: "custom", title, date, timezone: clean(req.body?.timezone, 64) || "UTC", recurringRule: draft.recurringRule === "yearly" ? "yearly" : "once", jointlyConfirmed: false, notes: clean(draft.shareableSummary, 1200), sourceThreadId: thread.id });
    await store.createRelationshipRecord("milestones", milestone); const updated = await store.updateRelationshipRecordForUser("privateAgentThreads", thread.id, req.auth.user.id, (record) => { record.status = "shared"; record.sharedObjectId = milestone.id; record.sharedAt = new Date().toISOString(); record.version += 1; });
    await audit(store, milestone, req.auth.user.id, "milestone.shared_from_private_agent"); await notifyMembers(context, req.auth.user.id, "plan_shared", `${req.auth.user.name} 添加了共同计划：${title}`, `/plans/${milestone.id}`); emit(milestone, "milestone.updated"); emit(updated, "private_agent_thread.updated", req.auth.user.id);
    res.status(201).json({ milestone, thread: projectRecord(updated, req.auth.user.id) });
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
    const snapshot = await store.relationshipSnapshotForUser(req.auth.user.id); const existing = snapshot.proposals.filter((item) => item.issueId === issue.id && !item.archivedAt); if (existing.length) return res.json({ proposals: existing.map((item) => projectRecord(item, req.auth.user.id)) }); const context = buildJointDecisionContext(snapshot, issue.id, req.auth.user.id);
    if (!context || context.confirmedSummaries.length !== 2) return res.status(409).json({ error: "双方分别确认可共享摘要后才能生成方案。" });
    const generated = await mediator.generateDecisionOptions(context, req.body?.language || "zh");
    const result = await store.transaction(`relationship:${issue.relationshipId}`, async (tx) => {
      const current = await tx.getRelationshipRecordForUser("issues", issue.id, req.auth.user.id);
      if (!current) throw decisionError(404, "not_found");
      const freshSnapshot = await tx.relationshipSnapshotForUser(req.auth.user.id);
      const alreadyGenerated = freshSnapshot.proposals.filter((item) => item.issueId === issue.id && !item.archivedAt);
      if (alreadyGenerated.length) return { proposals: alreadyGenerated, created: false, issue: current };
      assertVersion(current, issue.version);
      if (JSON.stringify(buildJointDecisionContext(freshSnapshot, issue.id, req.auth.user.id)) !== JSON.stringify(context)) throw decisionError(409, "stale_version");
      const proposals = [];
      for (const option of generated.options.slice(0, 4)) { const record = createRelationshipRecord({ relationshipId: issue.relationshipId, userId: req.auth.user.id, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "open", issueId: issue.id, ...option, source: generated.source }); await tx.createRelationshipRecord("proposals", record); proposals.push(record); }
      const updated = await tx.updateRelationshipRecordForUser("issues", issue.id, req.auth.user.id, (draft) => { draft.status = "evaluating"; draft.version += 1; });
      await audit(tx, updated, req.auth.user.id, "decision_options.generated"); return { proposals, created: true, issue: updated };
    });
    emit(result.issue, "issue.updated"); res.status(result.created ? 201 : 200).json({ proposals: result.proposals });
  });
  router.post("/proposals/:id/evaluations", decisionTransaction(async (tx, req) => {
    const proposal = await tx.getRelationshipRecordForUser("proposals", req.params.id, req.auth.user.id); if (!proposal) throw decisionError(404, "not_found");
    const value = EVALUATIONS.has(req.body?.value) ? req.body.value : null; if (!value) throw decisionError(400, "invalid_proposal");
    const snapshot = await tx.relationshipSnapshotForUser(req.auth.user.id);
    const existing = snapshot.evaluations.find((item) => item.proposalId === proposal.id && item.ownerUserId === req.auth.user.id && !item.withdrawnAt);
    if (existing) { if (existing.value === value && existing.conditions === clean(req.body?.conditions, 800)) return { body: { evaluation: existing } }; throw decisionError(409, "evaluation_submitted"); }
    const evaluation = createRelationshipRecord({ relationshipId: proposal.relationshipId, userId: req.auth.user.id, visibility: "private", aiAccessScope: "private", approvalPolicy: "owner", status: "submitted", issueId: proposal.issueId, proposalId: proposal.id, value, conditions: clean(req.body?.conditions, 800) });
    await tx.createRelationshipRecord("evaluations", evaluation); await audit(tx, evaluation, req.auth.user.id, "proposal.evaluated");
    return { status: 201, record: proposal, event: "proposal.evaluated", body: { evaluation } };
  }));

  router.post("/agreements", decisionTransaction(async (tx, req, context) => {
    const userId = req.auth.user.id;
    const issue = await tx.getRelationshipRecordForUser("issues", req.body?.sourceIssueId, userId);
    const proposal = await tx.getRelationshipRecordForUser("proposals", req.body?.proposalId, userId);
    if (!issue || !proposal || proposal.issueId !== issue.id) throw decisionError(400, "invalid_proposal");
    const snapshot = await tx.relationshipSnapshotForUser(userId);
    const evaluatedUsers = new Set(snapshot.evaluations.filter((item) => item.proposalId === proposal.id && !item.withdrawnAt).map((item) => item.ownerUserId));
    if (!context.members.every((item) => evaluatedUsers.has(item.userId))) throw decisionError(409, "both_evaluations");
    const existing = snapshot.agreements.find((item) => item.proposalId === proposal.id && !item.archivedAt);
    if (existing) return { body: { agreement: existing } };
    const record = createRelationshipRecord({ relationshipId: issue.relationshipId, userId, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "awaiting_approvals", sourceIssueId: issue.id, proposalId: proposal.id, title: clean(req.body?.title, 160) || proposal.title, summary: clean(req.body?.summary, 1200) || proposal.rationale, terms: cleanArray(req.body?.terms, 8, 500), unresolvedPoints: cleanArray(req.body?.unresolvedPoints, 8, 500), effectiveAt: null, reviewAt: validIso(req.body?.reviewAt), supersedesAgreementId: null });
    if (!record.terms.length) record.terms = [String(record.summary)];
    await tx.createRelationshipRecord("agreements", record);
    await tx.updateRelationshipRecordForUser("issues", issue.id, userId, (draft) => { draft.status = "agreement_pending"; draft.version += 1; });
    await audit(tx, record, userId, "agreement.created");
    return { status: 201, record, event: "agreement.updated", body: { agreement: record } };
  }));
  router.patch("/agreements/:id", decisionTransaction(async (tx, req) => {
    const current = await tx.getRelationshipRecordForUser("agreements", req.params.id, req.auth.user.id);
    if (!current) throw decisionError(404, "not_found");
    assertVersion(current, req.body?.version);
    if (!["draft", "awaiting_approvals"].includes(current.status)) throw decisionError(409, "agreement_not_editable");
    if (req.body?.confirmed !== true) throw decisionError(400, "confirm_draft");
    const values = agreementValues(req.body);
    const agreement = await tx.updateRelationshipRecordForUser("agreements", current.id, req.auth.user.id, (draft) => { Object.assign(draft, values); draft.version += 1; draft.status = "awaiting_approvals"; });
    await audit(tx, agreement, req.auth.user.id, "agreement.changed");
    return { record: agreement, event: "agreement.updated", body: { agreement } };
  }));
  router.post("/agreements/:id/approve", decisionTransaction(async (tx, req, context) => {
    const userId = req.auth.user.id;
    const agreement = await tx.getRelationshipRecordForUser("agreements", req.params.id, userId);
    if (!agreement) throw decisionError(404, "not_found");
    assertVersion(agreement, req.body?.version);
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
    let updated = agreement;
    if (context.members.every((item) => approvedUsers.has(item.userId)) && agreement.status !== "active") {
      updated = await tx.updateRelationshipRecordForUser("agreements", agreement.id, userId, (draft) => { draft.status = "active"; draft.effectiveAt = new Date().toISOString(); });
    }
    await audit(tx, updated, userId, "agreement.approved");
    return { record: updated, event: "agreement.updated", body: { agreement: updated, approvedCount: approvedUsers.size, requiredCount: context.members.length } };
  }));
  router.post("/agreements/:id/reject", decisionState("agreements", "cancelled", "agreement.rejected"));
  router.post("/agreements/:id/request-change", decisionState("agreements", "draft", "agreement.change_requested"));

  router.post("/issues/:id/messages", sharedDiscussion);
  router.post(["/issues/:id/transcripts", "/issues/:id/:language/transcripts"], sharedDiscussion);
  router.post(["/issues/:id/realtime", "/issues/:id/:language/realtime"], express.text({ type: "application/sdp", limit: "128kb" }), async (req, res) => {
    const issue = await store.getRelationshipRecordForUser("issues", req.params.id, req.auth.user.id);
    if (!issue) throw decisionError(404, "not_found");
    await jointDiscussionContext(store, issue, req.auth.user.id);
    const answer = await mediator.createRealtimeSession({ sdp: req.body, language: ["zh", "en", "es"].includes(req.params.language) ? req.params.language : "zh", safetyIdentifier: req.auth.user.id });
    res.type("application/sdp").send(answer);
  });
  router.post("/issues/:id/discussion-draft/confirm", decisionTransaction(async (tx, req) => {
    const userId = req.auth.user.id;
    const issue = await tx.getRelationshipRecordForUser("issues", req.params.id, userId);
    if (!issue) throw decisionError(404, "not_found");
    assertVersion(issue, req.body?.version);
    const candidate = issue.discussionDraft;
    if (!candidate || candidate.id !== req.body?.draftId || candidate.confirmedAt) throw decisionError(409, "draft_changed");
    if (req.body?.confirmed !== true) throw decisionError(400, "confirm_draft");
    const context = await jointDiscussionContext(tx, issue, userId);
    if (JSON.stringify(candidate.sourceRefs) !== JSON.stringify(context.confirmedSummaries.map(({ id, version }) => ({ id, version })))) throw decisionError(409, "draft_changed");
    const values = agreementValues(req.body);
    let agreement;
    if (candidate.agreementId) {
      const current = await tx.getRelationshipRecordForUser("agreements", candidate.agreementId, userId);
      if (!current) throw decisionError(404, "not_found");
      assertVersion(current, candidate.agreementVersion);
      if (!["draft", "awaiting_approvals", "active"].includes(current.status)) throw decisionError(409, "agreement_not_editable");
      agreement = await tx.updateRelationshipRecordForUser("agreements", current.id, userId, (draft) => { Object.assign(draft, values); draft.status = "awaiting_approvals"; draft.effectiveAt = null; draft.version += 1; });
      await markCommitmentsForRenegotiation(tx, agreement, userId);
    } else {
      agreement = createRelationshipRecord({ relationshipId: issue.relationshipId, userId, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "awaiting_approvals", sourceIssueId: issue.id, proposalId: null, ...values, effectiveAt: null, reviewAt: null, discussionDraftId: candidate.id });
      await tx.createRelationshipRecord("agreements", agreement);
    }
    const updated = await tx.updateRelationshipRecordForUser("issues", issue.id, userId, (draft) => { draft.discussionDraft = { ...draft.discussionDraft, confirmedAt: new Date().toISOString(), confirmedByUserId: userId, agreementId: agreement.id }; draft.status = "agreement_pending"; draft.version += 1; });
    await audit(tx, agreement, userId, "agreement.discussion_draft_confirmed");
    return { record: updated, event: "issue.updated", body: { issue: updated, agreement } };
  }));

  router.post("/commitments", decisionTransaction(async (tx, req, context) => {
    const userId = req.auth.user.id;
    const agreement = await tx.getRelationshipRecordForUser("agreements", req.body?.agreementId, userId);
    if (!agreement || agreement.status !== "active") throw decisionError(409, "active_agreement_required");
    assertVersion(agreement, req.body?.agreementVersion);
    if (req.body?.confirmed !== true) throw decisionError(400, "confirm_commitment");
    if (!["member_a", "member_b", "both"].includes(req.body?.ownerType)) throw decisionError(400, "commitment_fields");
    const description = clean(req.body?.description, 600), dueAt = validIso(req.body?.dueAt), reviewAt = validIso(req.body?.reviewAt);
    if (!description || !dueAt || !reviewAt || reviewAt < dueAt) throw decisionError(400, "commitment_fields");
    const ownerType = req.body.ownerType;
    const existing = (await tx.listRelationshipRecordsForUser("commitments", userId)).find((item) => item.agreementId === agreement.id && item.agreementVersion === agreement.version && item.ownerType === ownerType && item.description === description && item.dueAt === dueAt && item.reviewAt === reviewAt && !item.archivedAt && item.status !== "renegotiation_requested");
    if (existing) return { body: { commitment: existing } };
    const responsible = responsibilityIds(context, ownerType);
    const confirmedBy = responsible.includes(userId) ? [userId] : [];
    const record = createRelationshipRecord({ relationshipId: agreement.relationshipId, userId, visibility: "shared", aiAccessScope: "joint", approvalPolicy: ownerType === "both" ? "both" : "owner", status: responsible.every((id) => confirmedBy.includes(id)) ? "active" : "awaiting_confirmations", agreementId: agreement.id, agreementVersion: agreement.version, ownerType, description, dueAt, reviewAt, recurrence: "none", completionEvidence: null, completedAt: null, completedBy: [], confirmedBy, reviewRequired: true });
    await tx.createRelationshipRecord("commitments", record); await audit(tx, record, userId, "commitment.created");
    return { status: 201, record, event: "commitment.updated", body: { commitment: record } };
  }));
  router.post("/commitments/:id/confirm", decisionTransaction(async (tx, req, context) => {
    const userId = req.auth.user.id;
    const current = await tx.getRelationshipRecordForUser("commitments", req.params.id, userId);
    if (!current) throw decisionError(404, "not_found");
    assertVersion(current, req.body?.version);
    const responsible = responsibilityIds(context, current.ownerType);
    if (!responsible.includes(userId)) throw decisionError(403, "responsible_only");
    if (!["awaiting_confirmations", "active"].includes(current.status)) throw decisionError(409, "commitment_not_active");
    const agreement = await tx.getRelationshipRecordForUser("agreements", current.agreementId, userId);
    if (!agreement || agreement.status !== "active" || agreement.version !== current.agreementVersion) throw decisionError(409, "active_agreement_required");
    const commitment = await tx.updateRelationshipRecordForUser("commitments", current.id, userId, (draft) => { draft.confirmedBy = [...new Set([...(draft.confirmedBy || []), userId])]; if (responsible.every((id) => draft.confirmedBy.includes(id))) draft.status = "active"; });
    await audit(tx, commitment, userId, "commitment.confirmed");
    return { record: commitment, event: "commitment.updated", body: { commitment } };
  }));
  router.patch("/commitments/:id", decisionTransaction(async (tx, req, context) => {
    const current = await tx.getRelationshipRecordForUser("commitments", req.params.id, req.auth.user.id);
    if (!current) throw decisionError(404, "not_found");
    assertVersion(current, req.body?.version);
    if (!["active", "awaiting_confirmations"].includes(current.status) || req.body?.confirmed !== true) throw decisionError(409, "confirm_commitment");
    const description = clean(req.body?.description, 600), dueAt = validIso(req.body?.dueAt), reviewAt = validIso(req.body?.reviewAt);
    if (!description || !dueAt || !reviewAt || reviewAt < dueAt) throw decisionError(400, "commitment_fields");
    const responsible = responsibilityIds(context, current.ownerType);
    const record = await tx.updateRelationshipRecordForUser("commitments", current.id, req.auth.user.id, (draft) => { Object.assign(draft, { description, dueAt, reviewAt, completedBy: [], completedAt: null, completionEvidence: null }); draft.confirmedBy = responsible.includes(req.auth.user.id) ? [req.auth.user.id] : []; draft.status = responsible.every((id) => draft.confirmedBy.includes(id)) ? "active" : "awaiting_confirmations"; draft.version += 1; });
    await audit(tx, record, req.auth.user.id, "commitment.changed");
    return { record, event: "commitment.updated", body: { commitment: record } };
  }));
  router.post("/commitments/:id/complete", decisionTransaction(async (tx, req, context) => {
    const userId = req.auth.user.id;
    const current = await tx.getRelationshipRecordForUser("commitments", req.params.id, userId);
    if (!current) throw decisionError(404, "not_found");
    assertVersion(current, req.body?.version);
    const responsible = responsibilityIds(context, current.ownerType);
    if (!responsible.includes(userId)) throw decisionError(403, "responsible_only");
    if (!["active", "completed"].includes(current.status)) throw decisionError(409, "commitment_not_active");
    const agreement = await tx.getRelationshipRecordForUser("agreements", current.agreementId, userId);
    if (!agreement || agreement.status !== "active" || agreement.version !== current.agreementVersion) throw decisionError(409, "active_agreement_required");
    const commitment = await tx.updateRelationshipRecordForUser("commitments", current.id, userId, (draft) => {
      if ((draft.completedBy || []).includes(userId)) return;
      draft.completedBy = [...(draft.completedBy || []), userId];
      draft.completionEvidenceByUser = { ...(draft.completionEvidenceByUser || {}), [userId]: clean(req.body?.completionEvidence, 800) };
      if (responsible.every((id) => draft.completedBy.includes(id))) { draft.status = "completed"; draft.completedAt = new Date().toISOString(); }
    });
    const outcome = commitment.status === "completed" ? await ensureOutcome(tx, commitment, userId) : null;
    await audit(tx, commitment, userId, "commitment.completed");
    return { record: commitment, event: "commitment.updated", body: { commitment, outcome } };
  }));
  router.post("/commitments/:id/review", decisionTransaction(async (tx, req) => {
    const commitment = await tx.getRelationshipRecordForUser("commitments", req.params.id, req.auth.user.id);
    if (!commitment) throw decisionError(404, "not_found");
    assertVersion(commitment, req.body?.version);
    if (!["active", "completed", "renegotiation_requested"].includes(commitment.status)) throw decisionError(409, "commitment_not_active");
    // Incomplete or harmful attempts also need a real review; completion is never a prerequisite.
    const outcome = await ensureOutcome(tx, commitment, req.auth.user.id, true);
    return { record: outcome, event: "outcome.updated", body: { outcome } };
  }));
  router.post("/commitments/:id/renegotiate", decisionState("commitments", "renegotiation_requested", "commitment.renegotiation_requested"));

  router.get("/outcome-reviews/due", async (req, res) => { const graph = projectGraph(await store.relationshipSnapshotForUser(req.auth.user.id), req.auth.user.id); res.json({ outcomes: graph.outcomes.filter((item) => item.status === "pending" && new Date(item.reviewAt) <= new Date()) }); });
  router.post("/outcome-reviews/:id/responses", decisionTransaction(async (tx, req) => {
    const userId = req.auth.user.id;
    const outcome = await tx.getRelationshipRecordForUser("outcomes", req.params.id, userId);
    if (!outcome) throw decisionError(404, "not_found");
    if (outcome.status !== "pending" || new Date(outcome.reviewAt) > new Date()) throw decisionError(409, "review_not_due");
    const body = req.body || {};
    if (typeof body.actionCompleted !== "boolean" || typeof body.stillAccept !== "boolean" || typeof body.renegotiate !== "boolean" || !["improved", "same", "worse"].includes(body.improvement)) throw decisionError(400, "review_answers_required");
    const values = { actionCompleted: body.actionCompleted, improvement: body.improvement, effective: clean(body.effective, 1000), ineffective: clean(body.ineffective, 1000), stillAccept: body.stillAccept, renegotiate: body.renegotiate, shareResponse: body.shareResponse === true, allowLearnedPattern: body.allowLearnedPattern === true, learnedPatternCandidate: clean(body.learnedPatternCandidate, 600) };
    if (values.allowLearnedPattern && !values.learnedPatternCandidate) throw decisionError(400, "learning_text_required");
    const snapshot = await tx.relationshipSnapshotForUser(userId);
    const existing = snapshot.outcomeResponses.find((item) => item.outcomeId === outcome.id && item.ownerUserId === userId && !item.archivedAt && !item.withdrawnAt);
    if (existing) {
      if (Object.entries(values).every(([key, value]) => existing[key] === value)) return { body: { response: projectRecord(existing, userId) } };
      throw decisionError(409, "review_already_submitted");
    }
    const response = createRelationshipRecord({ relationshipId: outcome.relationshipId, userId, visibility: "private", aiAccessScope: "private", approvalPolicy: "owner", status: "submitted", outcomeId: outcome.id, ...values });
    response.id = `response:${outcome.id}:${userId}`;
    await tx.createRelationshipRecord("outcomeResponses", response); await audit(tx, response, userId, "outcome.response_submitted");
    const updated = await tx.updateRelationshipRecordForUser("outcomes", outcome.id, userId, (draft) => { draft.responseCount = snapshot.outcomeResponses.filter((item) => item.outcomeId === outcome.id && !item.archivedAt && !item.withdrawnAt).length + 1; if (values.allowLearnedPattern) draft.learningCandidates = [...(draft.learningCandidates || []), { ownerUserId: userId, text: values.learnedPatternCandidate }]; draft.version += 1; });
    return { status: 201, record: updated, event: "outcome.updated", body: { response: projectRecord(response, userId) } };
  }));
  router.post("/outcome-reviews/:id/finalize", decisionTransaction(async (tx, req, context) => {
    const userId = req.auth.user.id;
    const outcome = await tx.getRelationshipRecordForUser("outcomes", req.params.id, userId);
    if (!outcome) throw decisionError(404, "not_found");
    if (outcome.status === "completed") return { body: { outcome } };
    if (outcome.status !== "pending") throw decisionError(409, "review_not_due");
    const snapshot = await tx.relationshipSnapshotForUser(userId);
    const responses = snapshot.outcomeResponses.filter((item) => item.outcomeId === outcome.id && !item.archivedAt && !item.withdrawnAt);
    if (!context.members.every((member) => responses.some((item) => item.ownerUserId === member.userId))) throw decisionError(409, "both_reviews");
    const candidates = [...new Set(responses.map((item) => item.learnedPatternCandidate).filter(Boolean))];
    const learned = responses.every((item) => item.actionCompleted && item.allowLearnedPattern && item.stillAccept && !item.renegotiate && item.improvement === "improved") && candidates.length === 1 ? candidates[0] : null;
    const sharedResponses = responses.filter((item) => item.shareResponse);
    const updated = await tx.updateRelationshipRecordForUser("outcomes", outcome.id, userId, (draft) => {
      draft.status = "completed"; draft.finalizedAt = new Date().toISOString();
      // Only explicitly shared answers may be reproduced or aggregated in the joint record.
      draft.executionStatus = sharedResponses.length === 2 ? responses.every((item) => item.actionCompleted) ? "completed" : "partial" : "not_shared";
      draft.mutualSatisfaction = sharedResponses.length === 2 ? responses.every((item) => item.improvement === "improved") ? "mutually_improved" : responses.some((item) => item.improvement === "worse") ? "worse_reported" : "mixed" : "not_shared";
      draft.sharedResponses = sharedResponses.map(({ ownerUserId, actionCompleted, improvement, effective, ineffective, stillAccept, renegotiate }) => ({ ownerUserId, actionCompleted, improvement, effective, ineffective, stillAccept, renegotiate }));
      draft.effectiveElements = sharedResponses.map((item) => item.effective).filter(Boolean); draft.ineffectiveElements = sharedResponses.map((item) => item.ineffective).filter(Boolean);
      draft.nextAction = sharedResponses.some((item) => item.renegotiate || !item.stillAccept) ? "renegotiate" : sharedResponses.length === 2 ? "continue" : "not_shared";
      draft.learnedPattern = learned; draft.version += 1;
    });
    if (updated.nextAction === "renegotiate") {
      const agreement = await tx.getRelationshipRecordForUser("agreements", outcome.agreementId, userId);
      if (agreement && agreement.status !== "cancelled") {
        const revised = await tx.updateRelationshipRecordForUser("agreements", agreement.id, userId, (draft) => { draft.status = "draft"; draft.effectiveAt = null; draft.version += 1; });
        await markCommitmentsForRenegotiation(tx, revised, userId);
      }
    }
    await audit(tx, updated, userId, "outcome.finalized");
    return { record: updated, event: "outcome.updated", body: { outcome: updated } };
  }));

  router.get("/notifications", async (req, res) => { const items = await store.listRelationshipRecordsForUser("notifications", req.auth.user.id); res.json({ notifications: items.filter((item) => item.ownerUserId === req.auth.user.id && canViewRecord(item, req.auth.user.id)) }); });
  router.post("/notifications/:id/read", notificationMutation("readAt"));
  router.post("/notifications/:id/dismiss", notificationMutation("dismissedAt"));

  function decisionTransaction(action) {
    return async (req, res) => {
      const initial = await activeRelationship(store, req, res); if (!initial) return;
      const result = await store.transaction(`relationship:${initial.relationship.id}`, async (tx) => {
        const context = await tx.getRelationshipContext(req.auth.user.id);
        if (!context || context.relationship.id !== initial.relationship.id || context.relationship.status !== "active" || context.members.length !== 2) throw decisionError(409, "relationship_changed");
        return action(tx, req, context);
      });
      if (result.record) emit(result.record, result.event);
      res.status(result.status || 200).json(result.body);
    };
  }
  function decisionState(collection, status, event) {
    return decisionTransaction(async (tx, req) => {
      const record = await tx.getRelationshipRecordForUser(collection, req.params.id, req.auth.user.id);
      if (!record) throw decisionError(404, "not_found");
      assertVersion(record, req.body?.version);
      if (["cancelled", "superseded", "archived"].includes(record.status)) throw decisionError(409, "agreement_not_editable");
      const updated = await tx.updateRelationshipRecordForUser(collection, record.id, req.auth.user.id, (draft) => { draft.status = status; draft.changeReason = clean(req.body?.reason, 1200); draft.changedByUserId = req.auth.user.id; draft.effectiveAt = null; draft.version += 1; });
      if (collection === "agreements") await markCommitmentsForRenegotiation(tx, updated, req.auth.user.id);
      await audit(tx, updated, req.auth.user.id, event);
      return { record: updated, event, body: { item: updated } };
    });
  }
  async function sharedDiscussion(req, res) {
    const userId = req.auth.user.id;
    const issue = await store.getRelationshipRecordForUser("issues", req.params.id, userId);
    if (!issue) throw decisionError(404, "not_found");
    const text = clean(req.body?.text, 2000), itemId = clean(req.body?.itemId, 120);
    if (!text) throw decisionError(400, "message_required");
    if (itemId && (issue.discussion || []).some((item) => item.actorUserId === userId && item.itemId === itemId)) return res.json({ issue: projectRecord(issue, userId) });
    const preferredLanguage = req.body?.language || req.params.language;
    const language = ["zh", "en", "es"].includes(preferredLanguage) ? preferredLanguage : issue.discussionLanguage || "zh";
    const userMessage = { id: randomUUID(), role: "user", actorUserId: userId, text, itemId: itemId || null, createdAt: new Date().toISOString() };
    // Save every explicit shared turn before calling the model. Concurrent speech must never lose a transcript.
    const saved = await store.transaction(`relationship:${issue.relationshipId}`, async (tx) => {
      const current = await tx.getRelationshipRecordForUser("issues", issue.id, userId);
      if (!current) throw decisionError(404, "not_found");
      if (itemId && (current.discussion || []).some((item) => item.actorUserId === userId && item.itemId === itemId)) return { issue: current, duplicate: true };
      const context = await jointDiscussionContext(tx, current, userId);
      context.messages = [...context.messages, userMessage].slice(-24);
      const updated = await tx.updateRelationshipRecordForUser("issues", issue.id, userId, (draft) => { draft.discussion = [...(draft.discussion || []), userMessage].slice(-80); draft.discussionLanguage = language; draft.version += 1; });
      await audit(tx, updated, userId, "issue.shared_discussion_added");
      return { issue: updated, context, duplicate: false };
    });
    if (saved.duplicate) return res.json({ issue: projectRecord(saved.issue, userId) });
    emit(saved.issue, "issue.updated");
    const context = saved.context;
    const result = await decisionAgent.discuss(context, language);
    const updated = await store.transaction(`relationship:${issue.relationshipId}`, async (tx) => {
      const current = await tx.getRelationshipRecordForUser("issues", issue.id, userId);
      if (!current) throw decisionError(404, "not_found");
      // A newer request sees all saved messages and owns the next AI draft. Older model results are discarded.
      if (current.version !== saved.issue.version) return current;
      const fresh = await jointDiscussionContext(tx, current, userId);
      if (JSON.stringify(fresh.confirmedSummaries) !== JSON.stringify(context.confirmedSummaries) || JSON.stringify(fresh.agreement) !== JSON.stringify(context.agreement)) {
        return tx.updateRelationshipRecordForUser("issues", issue.id, userId, (draft) => { draft.discussion = [...draft.discussion, { id: randomUUID(), role: "assistant", source: "local", text: DECISION_ERRORS.context_changed[language === "en" ? 1 : language === "es" ? 2 : 0], createdAt: new Date().toISOString() }]; draft.version += 1; });
      }
      const draft = { ...result.draft, id: randomUUID(), agreementId: context.agreement?.id || null, agreementVersion: context.agreement?.version || null, source: result.source, createdAt: new Date().toISOString(), confirmedAt: null, sourceRefs: context.confirmedSummaries.map((summary) => ({ id: summary.id, version: summary.version })) };
      const record = await tx.updateRelationshipRecordForUser("issues", issue.id, userId, (next) => {
        next.discussion = [...(next.discussion || []), { id: randomUUID(), role: "assistant", text: result.reply, source: result.source, createdAt: new Date().toISOString(), sourceRefs: draft.sourceRefs, draftId: draft.id }].slice(-80);
        next.discussionDraft = draft; next.discussionLanguage = language; next.version += 1;
      });
      await audit(tx, record, userId, "issue.discussion_draft_prepared"); return record;
    });
    emit(updated, "issue.updated"); res.json({ issue: projectRecord(updated, userId) });
  }

  router.use((error, req, res, next) => {
    if (!error.decisionCode) return next(error);
    const language = req.body?.language || req.query?.language || "zh";
    const copy = DECISION_ERRORS[error.decisionCode] || DECISION_ERRORS.not_found;
    res.status(error.statusCode || 400).json({ error: copy[language === "en" ? 1 : language === "es" ? 2 : 0], code: error.decisionCode });
  });

  function listRoute(collection) { return async (req, res) => { const records = await store.listRelationshipRecordsForUser(collection, req.auth.user.id); res.json({ items: records.map((item) => projectRecord(item, req.auth.user.id)).filter(Boolean) }); }; }
  function updateOwnedShared(collection, fields) { return async (req, res) => { const current = await store.getRelationshipRecordForUser(collection, req.params.id, req.auth.user.id); if (!current || current.createdByUserId !== req.auth.user.id) return res.status(404).json({ error: "没有找到可修改的对象。" }); const record = await store.updateRelationshipRecordForUser(collection, current.id, req.auth.user.id, (draft) => { for (const field of fields) if (req.body?.[field] !== undefined) draft[field] = typeof req.body[field] === "string" ? clean(req.body[field], 1200) : req.body[field]; draft.version += 1; }); await audit(store, record, req.auth.user.id, `${collection}.updated`); emit(record, `${collection}.updated`, PRIVATE_VISIBILITY(record) ? req.auth.user.id : null); res.json({ item: projectRecord(record, req.auth.user.id) }); }; }
  function archiveOwned(collection) { return async (req, res) => { const current = await store.getRelationshipRecordForUser(collection, req.params.id, req.auth.user.id); if (!current || current.createdByUserId !== req.auth.user.id) return res.status(404).json({ error: "没有找到可归档的对象。" }); const record = await store.updateRelationshipRecordForUser(collection, current.id, req.auth.user.id, (draft) => { draft.status = "archived"; draft.archivedAt = new Date().toISOString(); draft.version += 1; }); await audit(store, record, req.auth.user.id, `${collection}.archived`); emit(record, `${collection}.updated`, PRIVATE_VISIBILITY(record) ? req.auth.user.id : null); res.status(204).end(); }; }
  function notificationMutation(field) { return async (req, res) => { const current = await store.getRelationshipRecordForUser("notifications", req.params.id, req.auth.user.id); if (!current || current.ownerUserId !== req.auth.user.id) return res.status(404).json({ error: "没有找到通知。" }); const notification = await store.updateRelationshipRecordForUser("notifications", current.id, req.auth.user.id, (draft) => { draft[field] = new Date().toISOString(); draft.version += 1; }); res.json({ notification }); }; }
  function emit(record, eventType, ownerUserId = null) { const payload = publicRelationshipEvent(eventType, record.id, record.version); for (const client of clients.get(record.relationshipId) || []) if (!ownerUserId || client.userId === ownerUserId) client.res.write(`event: relationship\ndata: ${JSON.stringify(payload)}\n\n`); }
  async function notifyMembers(context, actorId, type, title, actionUrl) { if (!context?.members) return; const current = await store.listRelationshipRecordsForUser("notifications", actorId); for (const member of context.members.filter((item) => item.userId !== actorId)) { const dedupeKey = `${type}:${actionUrl}:${member.userId}`; if (current.some((item) => item.dedupeKey === dedupeKey && !item.dismissedAt)) continue; const notification = createRelationshipRecord({ relationshipId: context.relationship.id, userId: actorId, ownerUserId: member.userId, visibility: "private", aiAccessScope: "none", approvalPolicy: "owner", status: "unread", type, title, actionUrl, dedupeKey, readAt: null, dismissedAt: null }); await store.createRelationshipRecord("notifications", notification); emit(notification, "notification.updated", member.userId); } }
  return router;
}

async function activeRelationship(store, req, res) { const context = await store.getRelationshipContext(req.auth.user.id); if (!context || context.relationship.status !== "active" || context.members.length !== 2) { res.status(409).json({ error: "需要双方账号完成伴侣绑定。" }); return null; } return context; }
const decisionError = (statusCode, decisionCode) => Object.assign(new Error(decisionCode), { statusCode, decisionCode });
function assertVersion(record, version) { if (!Number.isInteger(version) || version !== record.version) throw decisionError(409, "stale_version"); }
function agreementValues(body) {
  const title = clean(body?.title, 160), summary = clean(body?.summary, 1200), terms = cleanArray(body?.terms, 8, 500);
  if (!title || !summary || !terms.length) throw decisionError(400, "agreement_fields");
  return { title, summary, terms, unresolvedPoints: cleanArray(body?.unresolvedPoints, 8, 500) };
}
function responsibilityIds(context, ownerType) { return context.members.filter((member) => ownerType === "both" || ownerType === `member_${member.role.toLowerCase()}`).map((member) => member.userId); }
async function markCommitmentsForRenegotiation(tx, agreement, userId) {
  const commitments = await tx.listRelationshipRecordsForUser("commitments", userId);
  for (const item of commitments.filter((item) => item.agreementId === agreement.id && ["active", "awaiting_confirmations"].includes(item.status))) {
    await tx.updateRelationshipRecordForUser("commitments", item.id, userId, (draft) => { draft.status = "renegotiation_requested"; draft.version += 1; });
  }
}
async function ensureOutcome(tx, commitment, userId, startNow = false) {
  const id = `outcome:${commitment.id}`;
  const existing = await tx.getRelationshipRecordForUser("outcomes", id, userId);
  if (existing) {
    if (startNow && existing.status === "pending" && new Date(existing.reviewAt) > new Date()) return tx.updateRelationshipRecordForUser("outcomes", id, userId, (draft) => { draft.reviewAt = new Date().toISOString(); draft.version += 1; });
    return existing;
  }
  const record = createRelationshipRecord({ relationshipId: commitment.relationshipId, userId, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "pending", commitmentId: commitment.id, agreementId: commitment.agreementId, title: commitment.description, reviewAt: startNow ? new Date().toISOString() : commitment.reviewAt, finalizedAt: null, learnedPattern: null });
  record.id = id; await tx.createRelationshipRecord("outcomes", record); await audit(tx, record, userId, "outcome.created"); return record;
}
async function jointDiscussionContext(tx, issue, userId) {
  const snapshot = await tx.relationshipSnapshotForUser(userId);
  const relationship = await tx.getRelationshipContext(userId);
  const summaries = snapshot.summaries.filter((item) => item.issueId === issue.id && item.status === "confirmed" && item.aiAccessScope === "joint" && !item.withdrawnAt && !item.archivedAt);
  if (!relationship || relationship.relationship.status !== "active" || relationship.members.length !== 2 || !relationship.members.every((member) => summaries.some((item) => item.ownerUserId === member.userId))) throw decisionError(409, "both_summaries");
  const confirmedSummaries = relationship.members.map((member) => summaries.filter((item) => item.ownerUserId === member.userId).sort((a, b) => b.version - a.version)[0]).map(({ id, ownerUserId, text, version }) => ({ id, ownerUserId, text, version }));
  const agreement = snapshot.agreements.filter((item) => item.sourceIssueId === issue.id && !item.archivedAt && !item.withdrawnAt && ["draft", "awaiting_approvals", "active"].includes(item.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return {
    issue: { id: issue.id, title: issue.title, category: issue.category }, confirmedSummaries,
    agreement: agreement ? { id: agreement.id, title: agreement.title, summary: agreement.summary, terms: agreement.terms, unresolvedPoints: agreement.unresolvedPoints, version: agreement.version, status: agreement.status } : null,
    messages: (issue.discussion || []).filter((item) => item.role === "user" || (item.sourceRefs || []).every((ref) => confirmedSummaries.some((summary) => summary.id === ref.id && summary.version === ref.version))).slice(-24).map(({ role, actorUserId, text }) => ({ role, actorUserId, text })),
  };
}
const DECISION_ERRORS = {
  not_found: ["没有找到这个对象。", "This item was not found.", "No se encontró este elemento."],
  stale_version: ["内容已有新版本，请刷新并重新确认。", "This has changed. Refresh and review the new version.", "El contenido cambió. Actualiza y revisa la nueva versión."],
  invalid_proposal: ["请选择当前关系中的有效方案。", "Choose a valid option in this relationship.", "Elige una opción válida de esta relación."],
  evaluation_submitted: ["你已评价过这个方案，可以在共同对话提出新的修改。", "You already evaluated this option. Propose further changes in the shared conversation.", "Ya evaluaste esta opción. Propón nuevos cambios en la conversación compartida."],
  both_evaluations: ["双方分别评价后才能起草。", "Both people must evaluate the option first.", "Ambos deben evaluar la opción primero."],
  both_summaries: ["双方确认可共享摘要后才能共同讨论。", "Both shareable summaries must be confirmed before the shared discussion.", "Ambos resúmenes compartibles deben confirmarse antes de la conversación compartida."],
  agreement_not_editable: ["当前协议不能修改；请重新提出方案。", "This agreement cannot be edited. Propose a new option.", "Este acuerdo no puede editarse. Propón otra opción."],
  agreement_not_pending: ["当前协议不等待批准。", "This agreement is not awaiting approval.", "Este acuerdo no está pendiente de aprobación."],
  confirm_draft: ["请先检查并明确确认草稿。", "Review and explicitly confirm the draft first.", "Revisa y confirma explícitamente el borrador primero."],
  agreement_fields: ["请填写标题、说明和至少一条具体条款。", "Add a title, summary and at least one concrete term.", "Añade un título, un resumen y al menos un término concreto."],
  draft_changed: ["这份草稿已变化或已确认，请刷新。", "This draft has changed or was already confirmed. Refresh.", "Este borrador cambió o ya se confirmó. Actualiza."],
  active_agreement_required: ["承诺需要双方批准的当前协议版本。", "The commitment needs the current agreement approved by both people.", "El compromiso necesita la versión actual del acuerdo aprobada por ambos."],
  confirm_commitment: ["请明确确认承诺内容、分工及日期。", "Explicitly confirm the responsibility, action and dates.", "Confirma explícitamente la responsabilidad, la acción y las fechas."],
  commitment_fields: ["请填写承诺、负责人、到期时间和不早于到期时间的复盘日期。", "Enter an action, owner, due date and a review date on or after the due date.", "Indica una acción, responsable, fecha límite y revisión igual o posterior al vencimiento."],
  responsible_only: ["只有对应负责人能确认自己的责任或完成情况。", "Only the responsible person can confirm their responsibility or completion.", "Solo la persona responsable puede confirmar su responsabilidad o finalización."],
  commitment_not_active: ["当前承诺还不能执行这个操作。", "This commitment cannot perform that action in its current state.", "Este compromiso no permite esa acción en su estado actual."],
  review_not_due: ["复盘尚未到期或已经结束，可从承诺提前开始复盘。", "The review is not due or is already closed. You can start an early review from the commitment.", "La revisión no ha vencido o ya terminó. Puedes iniciarla antes desde el compromiso."],
  review_answers_required: ["请如实选择完成情况、效果、是否接受及是否重新协商。", "Choose completion, effect, acceptance and renegotiation answers.", "Indica finalización, efecto, aceptación y renegociación."],
  learning_text_required: ["请先填写你允许记住的具体经验。", "Write the exact lesson you consent to remember.", "Escribe la experiencia exacta que permites recordar."],
  review_already_submitted: ["你已提交这次复盘。", "You already submitted this review.", "Ya enviaste esta revisión."],
  both_reviews: ["双方分别完成复盘后才能形成共同结果。", "Both people must submit their review first.", "Ambos deben enviar su revisión primero."],
  relationship_changed: ["关系状态已变化，请刷新。", "The relationship changed. Refresh.", "La relación cambió. Actualiza."],
  message_required: ["请先输入想说的话。", "Enter a message first.", "Escribe un mensaje primero."],
  context_changed: ["你说的话已保存。共同摘要或协议刚刚发生变化，请检查新内容后继续讨论。", "Your message is saved. The shared summaries or agreement just changed; review them before continuing.", "Tu mensaje está guardado. Los resúmenes o el acuerdo acaban de cambiar; revísalos antes de continuar."],
};
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

async function ownedPrivateThread(store, id, userId) {
  const thread = await store.getRelationshipRecordForUser("privateAgentThreads", id, userId);
  return thread?.ownerUserId === userId && thread.visibility === "private" ? thread : null;
}

async function appendPrivateAgentTurn(store, mediator, thread, userId, text, language, itemId = "") {
  const userMessage = { id: randomUUID(), role: "user", text, itemId: itemId || null, createdAt: new Date().toISOString() };
  const messages = [...(thread.messages || []), userMessage].slice(-30);
  const result = await mediator.continuePrivateAgentThread({ intentType: thread.intentType, messages, draft: thread.draft || {} }, language);
  const assistantMessage = { id: randomUUID(), role: "assistant", text: clean(result.reply, 2000), createdAt: new Date().toISOString() };
  const updated = await store.updateRelationshipRecordForUser("privateAgentThreads", thread.id, userId, (record) => {
    record.messages = [...messages, assistantMessage].slice(-30); record.draft = result.draft || record.draft || {}; record.readyToShare = Boolean(result.readyToShare); record.source = result.source || "local"; record.status = record.sharedObjectId ? "shared" : "draft_ready"; record.version += 1;
  });
  await audit(store, updated, userId, "private_agent_thread.message_added"); return updated;
}
