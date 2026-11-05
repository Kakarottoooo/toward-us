import express from "express";
import { approveAgreement, clean, decisionError, rejectAgreement, requestAgreementChange } from "./agreement-actions.mjs";
import { projectRecord } from "./relationship-domain.mjs";
import { decisionErrorHandler } from "./relationship-router.mjs";
import { recordUsage } from "./usage.mjs";
import { visiblePhoto } from "./photo-store.mjs";
import { celebrationOn, composeStory, lastWeek, occasionLabel } from "./story.mjs";
import { answerDailyQuestion, askDailyQuestion } from "./daily-question.mjs";
import { announceAgreement, buildTogetherContext, continueTogetherTurn, draftAgreementFromTogether, ensureTogetherConversation, olderTogetherMessages, recallOnThisDay } from "./together-domain.mjs";
import { followThroughAgreement } from "./agreement-followup.mjs";

// The App's thin HTTP entry to the shared "together" conversation. iMessage will call the same domain functions.
export function createTogetherRouter({ store, mediator, emit = () => {}, activity = null, promises = null }) {
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
    if (writable(context)) {
      const ensured = await transaction(req, (tx) => ensureTogetherConversation(tx, { relationshipId, userId })); if (ensured.created) emit(ensured.conversation, "together.updated");
      // The member's own calendar day decides what "today" is.
      const timezone = clean(String(req.query?.timezone || ""), 64) || "UTC"; let today = "";
      try { today = new Date().toLocaleDateString("en-CA", { timeZone: timezone }); } catch { today = new Date().toISOString().slice(0, 10); }
      const recalled = await recallOnThisDay(store, { relationshipId, userId, today }).catch(() => null);
      if (recalled) emit(recalled, "together.updated", null, userId);
      // On a day worth celebrating, the first one to open Us starts the recap card; it arrives a little later.
      const since = (await store.listRelationshipRecordsForUser("milestones", userId)).find((item) => item.relationshipId === relationshipId && item.type === "relationship_started" && !item.archivedAt)?.date;
      const occasion = celebrationOn(since, today), lang = language(req);
      if (occasion) void composeStory({ store, mediator, relationshipId, userId, language: lang, key: occasion.key, occasion: occasionLabel(occasion, lang), emit: (conversation) => emit(conversation, "together.updated", null, userId) });
      // Once a week: the first one to open Us after a week ends starts that week's recap, if the two of them did anything in it.
      const week = !occasion && lastWeek(today);
      if (week) void composeStory({ store, mediator, relationshipId, userId, language: lang, key: week.key, week, occasion: lang === "en" ? `their week of ${week.from} to ${week.to}` : lang === "es" ? `su semana del ${week.from} al ${week.to}` : `${week.from} 到 ${week.to} 这一周`, emit: (conversation) => emit(conversation, "together.updated", null, userId) });
      // Every day: the first one to open Us gets today's question for both of them. The opener is looking at it, so only the
      // partner is pushed about it.
      void askDailyQuestion({ store, mediator, relationshipId, userId, language: lang, today, emit: (conversation) => emit(conversation, "together.updated", null, userId) });
      // Promises said in Us through iMessage or a call are noticed here, a little after Us is opened.
      promises?.noteTogether(relationshipId, userId);
    }
    const snapshot = await store.relationshipSnapshotForUser(userId);
    const conversation = snapshot.togetherConversations.find((item) => item.relationshipId === relationshipId);
    if (!conversation) throw decisionError(409, "pairing_required");
    const { activeAgreements, openCommitments, pendingAgreement } = buildTogetherContext(snapshot, relationshipId);
    res.json({ conversation: projectRecord(conversation, userId), pendingAgreement, activeAgreements, openCommitments, readOnly: !writable(context), members: context.members.map((member) => ({ id: member.userId, name: member.user.name, role: member.role })) });
  });

  // "更早的消息": a page of what came before the message `before` (the oldest one the App holds), from the working set and
  // then the archive; readable after the relationship ended, like the conversation itself.
  router.get("/together/history", async (req, res) => {
    const userId = req.auth.user.id, context = await pairing(req);
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query?.limit || ""), 10) || 50));
    res.json(await olderTogetherMessages(store, { relationshipId: context.relationship.id, userId, before: clean(String(req.query?.before || ""), 80), limit }));
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
    // Both of them see Pinky's current step while it answers in Us; it ends with the reply, or with the failure.
    const progress = activity ? activity.forCouple(relationshipId) : () => {};
    const result = await continueTogetherTurn({ store, mediator, relationshipId, actorUserId: partner?.userId || userId, recordedByUserId: partner ? userId : null, text, photoIds, timezone, source: partner ? "voice" : "app", handle: itemId ? `app:${userId}:${itemId}` : null, replyTo: clean(req.body?.replyTo, 80) || null, language: language(req), emit: (conversation) => emit(conversation, "together.updated"), notifyPrivate: (session) => emit(session, "assistant.updated", session.ownerUserId), progress }).finally(() => progress(null));
    if (!result.duplicate) { void recordUsage(store, { userId, relationshipId, action: "together_message" }); promises?.noteTogether(relationshipId, userId); }
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
  // `followUp`: an agreement both approved gets its commitments, reminders and check-in before the reply, so the page the
  // member lands on already shows them; a failure there is logged and never undoes the approval.
  const decide = (action, event, announce = () => false, usage = null, followUp = false) => async (req, res) => {
    const userId = req.auth.user.id;
    const { conversation, ...result } = await transaction(req, async (tx, context) => {
      const done = await action(tx, { agreementId: req.params.id, version: req.body?.version, userId, reason: req.body?.reason, context });
      return announce(done.agreement) ? { ...done, conversation: (await announceAgreement(tx, { agreement: done.agreement, userId, language: hint(req) })).conversation } : done;
    });
    emit(result.agreement, event); if (conversation) emit(conversation, "together.updated", null, userId);
    if (usage) void recordUsage(store, { userId, relationshipId: result.agreement.relationshipId, action: usage });
    if (followUp && result.agreement.status === "active") await followThroughAgreement({ store, mediator, agreementId: result.agreement.id, userId, language: hint(req), emit }).catch((error) => console.error("agreement_followup_failed", error?.code || error?.message || "error"));
    res.json(result);
  };
  router.post("/together/agreements/:id/approve", decide(approveAgreement, "agreement.updated", (agreement) => agreement.status === "active", "agreement_approved", true));
  router.post("/together/agreements/:id/reject", decide(rejectAgreement, "agreement.rejected"));
  router.post("/together/agreements/:id/request-change", decide(requestAgreementChange, "agreement.change_requested", () => true));

  router.post("/together/daily/:id/answer", async (req, res) => {
    const userId = req.auth.user.id, initial = await pairing(req); if (!writable(initial)) throw decisionError(409, "pairing_required");
    const conversation = await answerDailyQuestion({ store, mediator, relationshipId: initial.relationship.id, userId, messageId: req.params.id, text: req.body?.text, language: language(req), emit: (updated) => emit(updated, "together.updated") });
    void recordUsage(store, { userId, relationshipId: initial.relationship.id, action: "daily_answered" });
    res.json({ conversation: projectRecord(conversation, userId) });
  });

  router.use(decisionErrorHandler);
  return router;
}
