import { createHash, randomUUID } from "node:crypto";
import express from "express";
import { createRelationshipRecord, projectRecord } from "./relationship-domain.mjs";

const text = (req, zh, en, es) => (req.body?.language || req.query.language || "zh") === "zh" ? zh : (req.body?.language || req.query.language) === "es" ? es : en;
const clean = (value, limit) => String(value || "").trim().replace(/\0/g, "").slice(0, limit);
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function createPrivateAgentRouter({ store, mediator, emit = () => {}, memoryContext = () => ({ memories: [], references: [] }) }) {
  const router = express.Router();
  router.use("/private-agent", (req, res, next) => req.auth ? next() : res.status(401).json({ error: text(req, "请先登录。", "Please sign in.", "Inicia sesión.") }));
  const owned = async (id, userId, tx = store) => {
    const thread = await tx.getRelationshipRecordForUser("privateAgentThreads", id, userId);
    return thread?.ownerUserId === userId && thread.visibility === "private" && !thread.archivedAt ? thread : null;
  };
  const audit = async (tx, record, userId, eventType) => tx.createRelationshipRecord("consentEvents", createRelationshipRecord({ relationshipId: record.relationshipId, userId, visibility: "private", aiAccessScope: "none", status: "recorded", objectId: record.id, eventType, sourceVersion: record.version }));
  const activePair = async (req, tx = store) => {
    const context = await tx.getRelationshipContext(req.auth.user.id);
    if (!context || context.relationship.status !== "active" || context.members.length !== 2) throw fail(409, text(req, "先邀请另一半加入，再分享你确认的内容。私人对话仍可继续。", "Invite your partner before sharing. Your private conversation can continue.", "Invita a tu pareja antes de compartir. Puedes seguir hablando en privado."));
    return context;
  };
  router.get("/private-agent/threads", async (req, res) => {
    const records = await store.listRelationshipRecordsForUser("privateAgentThreads", req.auth.user.id);
    res.json({ threads: records.filter((item) => item.ownerUserId === req.auth.user.id && !item.archivedAt).map((item) => projectRecord(item, req.auth.user.id)) });
  });
  router.post("/private-agent/threads", async (req, res) => {
    const context = await store.getRelationshipContext(req.auth.user.id);
    const issueId = clean(req.body?.issueId, 80) || null;
    const issue = issueId ? await store.getRelationshipRecordForUser("issues", issueId, req.auth.user.id) : null;
    if (issueId && (!issue || context?.relationship.status !== "active")) throw fail(404, text(req, "没有找到这个共同议题。", "Shared topic not found.", "No se encontró el tema compartido."));
    // Unpaired and pre-invitation thinking has no relationship foreign key at all.
    const relationshipId = context?.relationship.status === "active" ? context.relationship.id : null;
    const thread = createRelationshipRecord({ relationshipId, userId: req.auth.user.id, visibility: "private", aiAccessScope: "private", status: "exploring", intentType: req.body?.intentType === "plan" ? "plan" : "decision", issueId, language: ["zh", "en", "es"].includes(req.body?.language) ? req.body.language : "zh", messages: [], draft: {}, readyToShare: false, source: "member" });
    await store.transaction(`user:${req.auth.user.id}`, async (tx) => { await tx.createRelationshipRecord("privateAgentThreads", thread); await audit(tx, thread, req.auth.user.id, "private_agent_thread.created"); });
    emit(thread, "private_agent_thread.updated", req.auth.user.id);
    res.status(201).json({ thread });
  });
  router.get("/private-agent/threads/:id", async (req, res) => {
    const thread = await owned(req.params.id, req.auth.user.id);
    if (!thread) throw fail(404, text(req, "没有找到这个私人对话。", "Private conversation not found.", "No se encontró la conversación privada."));
    res.json({ thread });
  });
  const append = async (req, res) => {
    const userId = req.auth.user.id;
    const thread = await owned(req.params.id, userId);
    if (!thread) throw fail(404, text(req, "没有找到这个私人对话。", "Private conversation not found.", "No se encontró la conversación privada."));
    if (thread.status === "closed") throw fail(409, text(req, "这是已结束关系中的只读记录。请开始新的私人对话。", "This conversation belongs to an ended relationship. Start a new private conversation.", "Esta conversación pertenece a una relación finalizada. Inicia una nueva conversación privada."));
    const content = clean(req.body?.text, 2000); const itemId = clean(req.body?.itemId, 120);
    if (!content) throw fail(400, text(req, "请先说点什么。", "Write something first.", "Escribe algo primero."));
    if (itemId && thread.messages.some((message) => message.itemId === itemId)) return res.json({ thread });
    const context = await store.getRelationshipContext(userId);
    const memories = await store.listRelationshipRecordsForUser("memories", userId);
    const approvedMemory = memoryContext(memories, { userId, relationshipId: context?.relationship.status === "active" ? context.relationship.id : null, scope: "private" });
    const userMessage = { id: randomUUID(), role: "user", text: content, itemId: itemId || null, createdAt: new Date().toISOString() };
    const result = await mediator.continuePrivateAgentThread({ intentType: thread.intentType, messages: [...thread.messages, userMessage].slice(-30), draft: thread.draft || {}, memory: approvedMemory }, thread.language);
    const updated = await store.transaction(`user:${userId}`, async (tx) => {
      const latest = await owned(thread.id, userId, tx);
      if (!latest || latest.status === "closed") throw fail(409, text(req, "对话状态已变化，请刷新。", "The conversation changed. Refresh and retry.", "La conversación cambió. Actualiza e inténtalo de nuevo."));
      if (itemId && latest.messages.some((message) => message.itemId === itemId)) return latest;
      if (latest.version !== thread.version) throw fail(409, text(req, "已有新消息，请刷新后重试。", "A new message arrived. Refresh and retry.", "Hay un mensaje nuevo. Actualiza y vuelve a intentarlo."));
      const record = await tx.updateRelationshipRecordForUser("privateAgentThreads", thread.id, userId, (draft) => {
        draft.messages = [...draft.messages, userMessage, { id: randomUUID(), role: "assistant", text: clean(result.reply, 4000), createdAt: new Date().toISOString() }];
        draft.draft = result.draft || draft.draft; draft.readyToShare = Boolean(result.readyToShare); draft.source = result.source || "local";
        draft.status = draft.sharedObjectId ? "shared" : "draft_ready"; draft.version += 1;
        draft.memoryReferences = approvedMemory.references || [];
      });
      await audit(tx, record, userId, "private_agent_thread.message_added"); return record;
    });
    emit(updated, "private_agent_thread.updated", userId); res.json({ thread: updated });
  };
  router.post("/private-agent/threads/:id/messages", append);
  router.post("/private-agent/threads/:id/transcripts", append);
  router.post("/private-agent/threads/:id/realtime", express.text({ type: "application/sdp", limit: "128kb" }), async (req, res) => {
    const thread = await owned(req.params.id, req.auth.user.id);
    if (!thread || thread.status === "closed") throw fail(404, text(req, "没有找到可使用的私人对话。", "Private conversation unavailable.", "La conversación privada no está disponible."));
    if (typeof req.body !== "string" || !req.body.includes("v=0")) throw fail(400, "Invalid audio connection.");
    res.type("application/sdp").send(await mediator.createRealtimeSession({ sdp: req.body, language: thread.language, safetyIdentifier: digest(req.auth.user.id) }));
  });
  const previewFor = (thread, body) => ({ version: thread.version, title: clean(body?.title ?? thread.draft.title, 160), summary: clean(body?.summary ?? thread.draft.shareableSummary, 1600), date: clean(body?.date ?? thread.draft.date, 10), intentType: thread.intentType });
  router.post("/private-agent/threads/:id/share-preview", async (req, res) => {
    const thread = await owned(req.params.id, req.auth.user.id); if (!thread) throw fail(404, "Private conversation not found.");
    const preview = previewFor(thread, req.body); res.json({ preview, digest: digest(preview) });
  });
  const share = (intentType) => async (req, res) => {
    const context = await activePair(req); const userId = req.auth.user.id;
    const result = await store.transaction(`relationship:${context.relationship.id}`, async (tx) => {
      await activePair(req, tx);
      const thread = await owned(req.params.id, userId, tx);
      if (!thread || thread.intentType !== intentType || thread.status === "closed") throw fail(404, "Private conversation unavailable.");
      if (thread.sharedObjectId) return { thread, [intentType === "decision" ? "issue" : "milestone"]: await tx.getRelationshipRecordForUser(intentType === "decision" ? "issues" : "milestones", thread.sharedObjectId, userId), repeated: true };
      const preview = previewFor(thread, req.body);
      if (req.body?.confirm !== true || Number(req.body?.version) !== thread.version || req.body?.digest !== digest(preview)) throw fail(409, text(req, "请先预览并确认当前版本的分享内容。", "Preview and confirm the current version before sharing.", "Revisa y confirma la versión actual antes de compartir."));
      if (!preview.title || !preview.summary) throw fail(400, text(req, "分享需要标题和你确认的摘要。", "Sharing needs a title and your confirmed summary.", "Para compartir se necesita un título y tu resumen confirmado."));
      let object;
      if (intentType === "decision") {
        object = thread.issueId ? await tx.getRelationshipRecordForUser("issues", thread.issueId, userId) : null;
        if (thread.issueId && !object) throw fail(404, "Shared topic unavailable.");
        if (!object) {
          object = createRelationshipRecord({ relationshipId: context.relationship.id, userId, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "collecting_perspectives", title: preview.title, category: clean(thread.draft.category, 50) || "custom", sharedContext: "" });
          await tx.createRelationshipRecord("issues", object);
        }
        const snapshot = await tx.relationshipSnapshotForUser(userId);
        if (snapshot.summaries.some((summary) => summary.issueId === object.id && summary.ownerUserId === userId && summary.status === "confirmed")) throw fail(409, "A shared summary already exists. Withdraw it before replacing it.");
        const perspective = createRelationshipRecord({ relationshipId: object.relationshipId, userId, visibility: "private", aiAccessScope: "private", status: "submitted", issueId: object.id, goal: clean(thread.draft.goal, 1200) || preview.summary, sourceThreadId: thread.id });
        await tx.createRelationshipRecord("perspectives", perspective);
        const summary = createRelationshipRecord({ relationshipId: object.relationshipId, userId, visibility: "shareable_summary", aiAccessScope: "joint", status: "confirmed", issueId: object.id, text: preview.summary, confirmedAt: new Date().toISOString(), source: "owner_confirmed_text" });
        await tx.createRelationshipRecord("summaries", summary);
      } else {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(preview.date) || Number.isNaN(Date.parse(`${preview.date}T12:00:00Z`)) || new Date(`${preview.date}T12:00:00Z`).toISOString().slice(0, 10) !== preview.date) throw fail(400, text(req, "请确认有效的计划日期。", "Confirm a valid plan date.", "Confirma una fecha válida."));
        object = createRelationshipRecord({ relationshipId: context.relationship.id, userId, visibility: "shared", aiAccessScope: "none", approvalPolicy: "both", status: "active", type: "custom", title: preview.title, date: preview.date, timezone: clean(req.body?.timezone, 64) || "UTC", recurringRule: thread.draft.recurringRule === "yearly" ? "yearly" : "once", jointlyConfirmed: false, notes: preview.summary });
        await tx.createRelationshipRecord("milestones", object);
      }
      const updated = await tx.updateRelationshipRecordForUser("privateAgentThreads", thread.id, userId, (record) => { record.status = "shared"; record.sharedObjectId = object.id; record.sharedAt = new Date().toISOString(); record.version += 1; });
      await audit(tx, updated, userId, "private_agent_thread.shared");
      for (const member of context.members.filter((member) => member.userId !== userId)) await tx.createRelationshipRecord("notifications", createRelationshipRecord({ relationshipId: context.relationship.id, userId, ownerUserId: member.userId, visibility: "private", aiAccessScope: "none", type: intentType === "decision" ? "decision_shared" : "plan_shared", message: text(req, "有一项你可以查看的共同事项。", "A shared item is ready for you.", "Hay un asunto compartido para ti."), targetUrl: `/?view=${intentType === "decision" ? "decide" : "plans"}&${intentType === "decision" ? "issue" : "milestone"}=${object.id}` }));
      return { thread: updated, [intentType === "decision" ? "issue" : "milestone"]: object };
    });
    const object = result.issue || result.milestone;
    if (!result.repeated) { emit(object, intentType === "decision" ? "issue.updated" : "milestone.updated"); emit(result.thread, "private_agent_thread.updated", userId); }
    res.status(result.repeated ? 200 : 201).json(result);
  };
  router.post("/private-agent/threads/:id/share-decision", share("decision"));
  router.post("/private-agent/threads/:id/apply-plan", share("plan"));
  router.delete("/private-agent/threads/:id", async (req, res) => {
    const thread = await owned(req.params.id, req.auth.user.id); if (!thread) throw fail(404, "Private conversation not found.");
    if (Number(req.body?.version) !== thread.version || req.body?.confirm !== true) throw fail(409, "Confirm deletion of the current version.");
    await store.transaction(`user:${req.auth.user.id}`, async (tx) => { const current = await owned(thread.id, req.auth.user.id, tx); if (!current || current.version !== Number(req.body.version)) throw fail(409, "Conversation changed. Confirm deletion again."); await tx.deleteRelationshipRecordForUser("privateAgentThreads", thread.id, req.auth.user.id); await audit(tx, thread, req.auth.user.id, "private_agent_thread.deleted"); });
    emit(thread, "private_agent_thread.deleted", req.auth.user.id); res.sendStatus(204);
  });
  return router;
}
