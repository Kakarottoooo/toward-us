import express from "express";
import { approveAgreement, clean, decisionError, rejectAgreement, requestAgreementChange } from "./agreement-actions.mjs";
import { projectRecord } from "./relationship-domain.mjs";
import { decisionErrorHandler } from "./relationship-router.mjs";
import { recordUsage } from "./usage.mjs";
import { announceAgreement, appendTogetherMessage, buildTogetherContext, draftAgreementFromTogether, ensureTogetherConversation, shouldAgentSpeak } from "./together-domain.mjs";

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
    if (!text) throw decisionError(400, "message_required");
    // Save the member's turn before calling the model so a slow or failed reply never loses what they said.
    const saved = await transaction(req, async (tx, _context, relationshipId) => {
      const { conversation } = await ensureTogetherConversation(tx, { relationshipId, userId });
      const result = await appendTogetherMessage(tx, { relationshipId, actorUserId: userId, source: "app", kind: "text", text, handle: itemId ? `app:${userId}:${itemId}` : null, replyTo: clean(req.body?.replyTo, 80) || null });
      return { ...result, relationshipId, agentLastMessageId: conversation.agentLastMessageId };
    });
    if (saved.duplicate) return res.json({ conversation: projectRecord(saved.conversation, userId), message: saved.message, reply: null });
    emit(saved.conversation, "together.updated");
    void recordUsage(store, { userId, relationshipId: saved.relationshipId, action: "together_message" });
    if (!shouldAgentSpeak(saved.message, { agentLastMessageId: saved.agentLastMessageId })) return res.status(201).json({ conversation: projectRecord(saved.conversation, userId), message: saved.message, reply: null });
    const context = buildTogetherContext(await store.relationshipSnapshotForUser(userId), saved.relationshipId, { userId, query: text });
    const turn = await mediator.continueTogether(context, language(req));
    const replied = await transaction(req, async (tx, _context, relationshipId) => {
      const result = await appendTogetherMessage(tx, { relationshipId, actorUserId: null, userId, source: "app", kind: "text", text: turn.reply, refs: context.authorizedMemories.map(({ id, version }) => ({ type: "memory", id, version })), replyTo: saved.message.id });
      if (!turn.draftAgreement) return result;
      const conversation = await tx.updateRelationshipRecordForUser("togetherConversations", result.conversation.id, userId, (draft) => { draft.draftAgreement = { ...turn.draftAgreement, messageId: result.message.id, source: turn.source, createdAt: new Date().toISOString() }; draft.version += 1; });
      return { ...result, conversation };
    });
    emit(replied.conversation, "together.updated");
    res.status(201).json({ conversation: projectRecord(replied.conversation, userId), message: saved.message, reply: replied.message });
  });

  router.post("/together/agreements/draft", async (req, res) => {
    const userId = req.auth.user.id;
    const result = await transaction(req, async (tx, _context, relationshipId) => {
      const agreement = await draftAgreementFromTogether(tx, { relationshipId, userId, values: req.body?.title ? req.body : null, language: hint(req) });
      const { conversation } = await ensureTogetherConversation(tx, { relationshipId, userId });
      return { agreement, conversation };
    });
    emit(result.agreement, "agreement.updated"); emit(result.conversation, "together.updated");
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
    emit(result.agreement, event); if (conversation) emit(conversation, "together.updated");
    if (usage) void recordUsage(store, { userId, relationshipId: result.agreement.relationshipId, action: usage });
    res.json(result);
  };
  router.post("/together/agreements/:id/approve", decide(approveAgreement, "agreement.updated", (agreement) => agreement.status === "active", "agreement_approved"));
  router.post("/together/agreements/:id/reject", decide(rejectAgreement, "agreement.rejected"));
  router.post("/together/agreements/:id/request-change", decide(requestAgreementChange, "agreement.change_requested", () => true));

  router.use(decisionErrorHandler);
  return router;
}
