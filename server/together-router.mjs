import express from "express";
import { approveAgreement, clean, decisionError, rejectAgreement, requestAgreementChange } from "./agreement-actions.mjs";
import { projectRecord } from "./relationship-domain.mjs";
import { decisionErrorHandler } from "./relationship-router.mjs";
import { recordUsage } from "./usage.mjs";
import { visiblePhoto } from "./photo-store.mjs";
import { announceAgreement, buildTogetherContext, continueTogetherTurn, draftAgreementFromTogether, ensureTogetherConversation } from "./together-domain.mjs";

// The App's thin HTTP entry to the shared "together" conversation. iMessage will call the same domain functions.
export function createTogetherRouter({ store, mediator, emit = () => {} }) {
  const router = express.Router();
  router.use("/together", (req, res, next) => req.auth ? next() : res.status(401).json({ error: "请先登录。" }));
  const hint = (req) => ["zh", "en", "es"].includes(req.body?.language || req.query?.language) ? req.body?.language || req.query?.language : null;
  const language = (req) => hint(req) || "zh";
  const pairing = async (req) => { const context = await store.getRelationshipContext(req.auth.user.id); if (!context) throw decisionError(409, "pairing_required"); return context; };
  const writable = (context) => context.relationship.status === "active" && context.members.length === 2;
  // Every write re-checks membership inside the relationship lock; an ended relationship is read-only.
  const transaction = async (req, action) => {
    const initial = await pairing(req); if (!writable(initial)) throw decisionError(409, "pairing_required");
    return store.transaction(`relationship:${initial.relationship.id}`, async (tx) => {
      const context = await tx.getRelationshipContext(req.auth.user.id);
      if (!context || context.relationship.id !== initial.relationship.id || !writable(context)) throw decisionError(409, "relationship_changed");
      return action(tx, context, context.relationship.id);
    });
  };

  router.get("/together", async (req, res) => {
    const userId = req.auth.user.id, context = await pairing(req), relationshipId = context.relationship.id;
    if (writable(context)) { const ensured = await transaction(req, (tx) => ensureTogetherConversation(tx, { relationshipId, userId })); if (ensured.created) emit(ensured.conversation, "together.updated"); }
    const snapshot = await store.relationshipSnapshotForUser(userId);
    const conversation = snapshot.togetherConversations.find((item) => item.relationshipId === relationshipId);
    if (!conversation) throw decisionError(409, "pairing_required");
    const { activeAgreements, openCommitments, pendingAgreement } = buildTogetherContext(snapshot, relationshipId);
    res.json({ conversation: projectRecord(conversation, userId), pendingAgreement, activeAgreements, openCommitments, readOnly: !writable(context), members: context.members.map((member) => ({ id: member.userId, name: member.user.name, role: member.role })) });
  });

  router.post("/together/messages", async (req, res) => {
    const userId = req.auth.user.id, text = clean(req.body?.text, 2000), itemId = clean(req.body?.itemId, 120);
    const photoIds = Array.isArray(req.body?.photoIds) ? [...new Set(req.body.photoIds.map((id) => clean(id, 80)).filter(Boolean))].slice(0, 6) : [];
    if (!text && !photoIds.length) throw decisionError(400, "message_required");
    const initial = await pairing(req); if (!writable(initial)) throw decisionError(409, "pairing_required");
    const relationshipId = initial.relationship.id;
    for (const id of photoIds) { const photo = await visiblePhoto(store, id, userId).catch(() => null); if (!photo || photo.visibility !== "shared" || photo.relationshipId !== relationshipId) throw decisionError(400, "message_required"); }
    const timezone = clean(req.body?.timezone, 64) || "UTC";
    // Shared-device voice: both partners sit at one phone and pick who is speaking; the line is theirs, recorded on this phone.
    const partner = req.body?.speaker === "partner" ? initial.members.find((member) => member.userId !== userId) : null;
    if (req.body?.speaker === "partner" && !partner) throw decisionError(409, "pairing_required");
    const result = await continueTogetherTurn({ store, mediator, relationshipId, actorUserId: partner?.userId || userId, recordedByUserId: partner ? userId : null, text, photoIds, timezone, source: partner ? "voice" : "app", handle: itemId ? `app:${userId}:${itemId}` : null, replyTo: clean(req.body?.replyTo, 80) || null, language: language(req), emit: (conversation) => emit(conversation, "together.updated"), notifyPrivate: (session) => emit(session, "assistant.updated", session.ownerUserId) });
    if (!result.duplicate) void recordUsage(store, { userId, relationshipId, action: "together_message" });
    res.status(result.duplicate ? 200 : 201).json({ conversation: projectRecord(result.conversation, userId), message: result.message, reply: result.reply });
  });

  router.post("/together/agreements/draft", async (req, res) => {
    const userId = req.auth.user.id;
    const result = await transaction(req, async (tx, _context, relationshipId) => {
      const agreement = await draftAgreementFromTogether(tx, { relationshipId, userId, values: req.body?.title ? req.body : null, language: hint(req) });
      const { conversation } = await ensureTogetherConversation(tx, { relationshipId, userId });
      return { agreement, conversation };
    });
    emit(result.agreement, "agreement.updated"); emit(result.conversation, "together.updated", null, userId);
    void recordUsage(store, { userId, relationshipId: result.agreement.relationshipId, action: "agreement_drafted" });
    res.status(201).json({ agreement: result.agreement, conversation: projectRecord(result.conversation, userId) });
  });

  // `announce` decides which outcomes the Agent posts as a card: the agreement becoming active, or a change request (new version).
  const decide = (action, event, announce = () => false, usage = null) => async (req, res) => {
    const userId = req.auth.user.id;
    const { conversation, ...result } = await transaction(req, async (tx, context) => {
      const done = await action(tx, { agreementId: req.params.id, version: req.body?.version, userId, reason: req.body?.reason, context });
      return announce(done.agreement) ? { ...done, conversation: (await announceAgreement(tx, { agreement: done.agreement, userId, language: hint(req) })).conversation } : done;
    });
    emit(result.agreement, event); if (conversation) emit(conversation, "together.updated", null, userId);
    if (usage) void recordUsage(store, { userId, relationshipId: result.agreement.relationshipId, action: usage });
    res.json(result);
  };
  router.post("/together/agreements/:id/approve", decide(approveAgreement, "agreement.updated", (agreement) => agreement.status === "active", "agreement_approved"));
  router.post("/together/agreements/:id/reject", decide(rejectAgreement, "agreement.rejected"));
  router.post("/together/agreements/:id/request-change", decide(requestAgreementChange, "agreement.change_requested", () => true));

  router.use(decisionErrorHandler);
  return router;
}
