import express from "express";
import { createHash } from "node:crypto";
import { readableConversation, conversationMessages } from "./conversation-recall.mjs";
import { createRelationshipRecord, hideUnrevealedAnswers, projectRecord } from "./relationship-domain.mjs";
import { feedbackContext } from "./feedback-context.mjs";
import { feedbackVoiceRoute } from "./feedback-voice.mjs";
import { feedbackError, feedbackParts, limitFeedbackUploads, readMultipart, removeFeedbackFiles, saveFeedbackImages } from "./feedback-images.mjs";
import { consumeFeedbackQuota, internalFeedbackRoutes, opaque, ownedFeedback, sendAttachment, statusFor, userView } from "./feedback-lifecycle.mjs";

export const KINDS = ["bug", "friction", "design", "idea", "praise", "suggestion", "other"];
export const SEVERITIES = ["high", "medium", "low"];
export const REPORT_ABOUT = ["partner", "pinky", "other"];
const clean = (value, limit) => String(value ?? "").trim().slice(0, limit);

export function createFeedbackRouter({ store, mediator, notify, now = () => new Date(), adminToken = () => process.env.PINKY_METRICS_ADMIN_TOKEN }) {
  const router = express.Router();
  internalFeedbackRoutes(router, { store, notify, now, adminToken });
  router.use("/feedback", (req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    return req.auth ? next() : res.status(401).json({ error: "Please sign in." });
  });
  feedbackVoiceRoute(router, { store, mediator, now });
  router.post("/feedback/reply", async (req, res) => {
    const userId = req.auth.user.id, { channel, conversationId, messageId } = req.body || {};
    if (![conversationId, messageId].every((id) => typeof id === "string" && id.length > 0 && id.length <= 160)) return res.status(400).json({ error: "invalid_reply" });
    // Legacy clients submit safety reports without an intent.
    const { intent = "report" } = req.body;
    if (intent !== "report" && intent !== "unhelpful") return res.status(400).json({ error: "invalid_feedback_intent" });
    const isReport = intent === "report";
    let messages;
    if (channel === "private-workspace" || channel === "decision") {
      const record = projectRecord(await store.getRelationshipRecordForUser(channel === "decision" ? "issues" : "privateAgentThreads", conversationId, userId), userId);
      if (channel === "decision") {
        const pairing = await store.getRelationshipContext(userId);
        if (record && record.relationshipId === pairing?.relationship.id && record.visibility === "shared") messages = record.discussion;
      } else if (record?.ownerUserId === userId && record.visibility === "private" && ["decision", "plan"].includes(record.intentType)) messages = record.messages;
    } else {
      const record = await readableConversation(store, userId, channel, conversationId);
      const current = record.messages?.find((m) => m.id === messageId);
      messages = current ? hideUnrevealedAnswers({ messages: [structuredClone(current)] }, userId).messages : await conversationMessages(store, userId, channel, record);
    }
    const reply = messages?.find((m) => m.id === messageId && ["assistant", "agent"].includes(m.role));
    if (!reply) return res.status(404).json({ error: "reply_not_found" });
    const lang = ["en", "es"].includes(req.body.language) ? req.body.language : "zh";
    const text = reply.i18n?.[lang] || reply.translations?.[lang]?.text || reply.text || (reply.call?.rows || []).filter((r) => r.role === "agent").map((r) => r.text).join("\n") || reply.kind || "Ourever reply";
    const qualityLabel = { zh: "这条回复没帮到我", en: "This reply wasn’t helpful", es: "Esta respuesta no me ayudó" }[lang];
    const id = (isReport ? "report:" : "unhelpful:") + createHash("sha256").update(JSON.stringify([userId, conversationId, messageId])).digest("hex");
    await store.transaction(`user:${userId}`, async (tx) => {
      if (await tx.getRelationshipRecordForUser("feedback", id, userId)) return;
      await consumeFeedbackQuota(tx, userId, now);
      const feedback = createRelationshipRecord({
        relationshipId: null, userId, visibility: "private", aiAccessScope: "none", status: "new",
        text: isReport ? clean(text, 4000) : qualityLabel, photoIds: [],
        context: { view: "conversation-" + channel, channel, conversationId, messageId, language: lang,
          ...(isReport ? { report: "pinky" } : { replyFeedback: "unhelpful" }) },
        kind: isReport ? "report" : "friction", severity: isReport ? "high" : "low",
        summary: isReport ? "Reported Ourever reply" : qualityLabel,
      });
      feedback.id = id;
      await tx.createRelationshipRecord("feedback", feedback);
    });
    res.json(isReport ? { reported: true } : { recorded: true });
  });
  router.post("/feedback", limitFeedbackUploads, readMultipart, async (req, res) => {
    const written = [];
    let committed = false;
    try {
      const userId = req.auth.user.id;
      const { body, files } = await feedbackParts(req);
      if (!body || typeof body.text !== "string" || !body.text.trim() || body.text.length > 4000) throw feedbackError(400, "invalid_feedback_text");
      if (body.owner_ref !== undefined && body.owner_ref !== userId) throw feedbackError(409, "feedback_account_changed");
      if (req.is("multipart/form-data") && (!body.owner_ref || !body.client_id)) throw feedbackError(400, "feedback_owner_and_id_required");
      if (body.client_id !== undefined && (typeof body.client_id !== "string" || !/^[a-z\d_-]{8,100}$/i.test(body.client_id))) throw feedbackError(400, "invalid_client_id");
      if (body.kind !== undefined && !["bug", "suggestion", "other"].includes(body.kind)) throw feedbackError(400, "invalid_feedback_kind");
      const photoIds = body.photoIds ?? [];
      if (!Array.isArray(photoIds) || photoIds.length + files.length > 4 || photoIds.some((id) => typeof id !== "string")) throw feedbackError(400, "invalid_attachment_count");
      const report = REPORT_ABOUT.includes(body.report) ? body.report : null;
      const context = feedbackContext(body.context, body.language);
      if (report) context.report = report;
      const id = body.client_id && opaque("ourever-feedback", userId, body.client_id);
      const result = await store.transaction(`user:${userId}`, async (tx) => {
        // Recheck the principal under the account deletion lock before persisting any files.
        const owner = await tx.getUserForUpdate(userId);
        if (!owner || owner.passwordHash === "deleted") throw feedbackError(401, "sign_in_required");
        const existing = id && await tx.getRelationshipRecordForUser("feedback", id, userId);
        if (existing) return { row: existing, created: false };
        await consumeFeedbackQuota(tx, userId, now);
        await saveFeedbackImages(tx, userId, files, photoIds, written);
        const row = createRelationshipRecord({ ...(id ? { id } : {}), relationshipId: null, userId, visibility: "private", aiAccessScope: "none",
          status: "received", text: body.text.trim(), kind: report ? "report" : body.kind ?? null,
          severity: report ? "high" : null, summary: "", context, includeActivity: body.include_activity === true,
          activity: body.include_activity === true && typeof body.activity === "string" ? clean(body.activity, 4000) : null,
          attachmentIds: written, photoIds: [], unread: false });
        await tx.createRelationshipRecord("feedback", row);
        return { row, created: true };
      });
      committed = true;
      // Legacy JSON submitters also read feedback.kind from this response.
      res.status(result.created ? 201 : 200).json(req.is("multipart/form-data") ? { id: result.row.id } : { id: result.row.id, feedback: userView(result.row) });
    } finally {
      res.locals.releaseFeedbackUpload?.();
      if (!committed && written.length) await removeFeedbackFiles(written);
    }
  });

  router.get(["/feedback", "/feedback/mine"], async (req, res) => {
    const userId = req.auth.user.id;
    if (req.query.unread === "count") return res.json({ unread: await store.countUnreadFeedback(userId) });
    const rows = (await store.listRelationshipRecordsForUser("feedback", userId)).filter((row) => row.ownerUserId === userId && row.visibility === "private");
    res.json({ feedback: rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(userView) });
  });
  router.get("/feedback/:id", async (req, res) => res.json({ feedback: userView(await ownedFeedback(store, req.auth.user.id, req.params.id)) }));
  router.get("/feedback/:id/attachments/:n", async (req, res) => {
    await sendAttachment(store, await ownedFeedback(store, req.auth.user.id, req.params.id), req.params.n, res);
  });
  router.post("/feedback/:id/read", async (req, res) => {
    const userId = req.auth.user.id;
    const row = await store.transaction(`user:${userId}`, async (tx) => {
      const before = await ownedFeedback(tx, userId, req.params.id);
      if (!before.unread || req.body?.updatedAt !== (before.feedbackUpdatedAt || before.updatedAt)) return before;
      return tx.updateRelationshipRecordForUser("feedback", before.id, userId, (draft) => { draft.unread = false; });
    });
    res.json({ feedback: userView(row) });
  });
  router.post("/feedback/:id/reopen", async (req, res) => {
    const userId = req.auth.user.id;
    const row = await store.transaction(`user:${userId}`, async (tx) => {
      const before = await ownedFeedback(tx, userId, req.params.id);
      if (statusFor(before) === "reopened") return before;
      if (statusFor(before) !== "shipped") throw feedbackError(409, "feedback_not_shipped");
      return tx.updateRelationshipRecordForUser("feedback", before.id, userId, (draft) => {
        draft.status = "reopened"; draft.publicNote = ""; draft.fixCommit = null; draft.duplicateOf = null; draft.unread = false;
        draft.feedbackUpdatedAt = now().toISOString(); draft.version++;
      });
    });
    res.json({ feedback: userView(row) });
  });
  router.delete("/feedback/:id", async (req, res) => {
    const userId = req.auth.user.id;
    const ids = await store.transaction(`user:${userId}`, async (tx) => {
      const row = await ownedFeedback(tx, userId, req.params.id);
      await tx.deleteRelationshipRecordForUser("feedback", row.id, userId);
      return row.attachmentIds || [];
    });
    await removeFeedbackFiles(ids);
    res.status(204).end();
  });
  router.use((error, _req, res, next) => {
    res.locals.releaseFeedbackUpload?.();
    if (error.retryAfter) res.set("Retry-After", String(error.retryAfter));
    if (error.type === "entity.too.large") return res.status(413).json({ error: "feedback_upload_too_large" });
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  });
  return router;
}
