import express from "express";
import { answerAgreementPoint, approveAgreement, phrasePoint, clean, decisionError, rejectAgreement, requestAgreementChange } from "./agreement-actions.mjs";
import { projectRecord } from "./relationship-domain.mjs";
import { decisionErrorHandler } from "./relationship-router.mjs";
import { recordUsage } from "./usage.mjs";
import { cachedPurchases, membershipFor } from "./membership.mjs";
import { answerWatchCheck } from "./watched.mjs";
import { visiblePhoto } from "./photo-store.mjs";
import { planToCalendar } from "./plan-to-calendar.mjs";
import { memberTimezone } from "./reminder-service.mjs";
import { celebrationOn, composeStory, lastWeek, occasionLabel } from "./story.mjs";
import { answerDailyQuestion, askDailyQuestion } from "./daily-question.mjs";
import { answerGame, GAME_TYPES, startGame } from "./games.mjs";
import { careNoteFor } from "./cycle.mjs";
import { petIt, syncPet } from "./pet.mjs";
import { announceAgreement, appendTogetherMessage, buildTogetherContext, togetherI18n, continueTogetherTurn, draftAgreementFromTogether, ensureTogetherConversation, olderTogetherMessages, recallOnThisDay } from "./together-domain.mjs";
import { followThroughAgreement } from "./agreement-followup.mjs";
import { createSharedTranslator } from "./shared-translate.mjs";

// The App's thin HTTP entry to the shared "together" conversation. iMessage will call the same domain functions.
export function createTogetherRouter({ store, mediator, emit = () => {}, activity = null, promises = null, profile = null }) {
  const router = express.Router();
  router.use("/together", (req, res, next) => req.auth ? next() : res.status(401).json({ error: "请先登录。" }));
  const hint = (req) => ["zh", "en", "es"].includes(req.body?.language || req.query?.language) ? req.body?.language || req.query?.language : null;
  const language = (req) => hint(req) || "zh";
  const pairing = async (req) => { const context = await store.getRelationshipContext(req.auth.user.id); if (!context) throw decisionError(409, "pairing_required"); return context; };
  const writable = (context) => context.relationship.status === "active" && context.members.length === 2;
  // Pinky's lines in Us are shown in each member's own interface language (founder 11-06); see shared-translate.mjs.
  const translator = createSharedTranslator({ store, mediator, emit: (conversation) => emit(conversation, "together.updated") });
  const validZone = (zone) => { if (typeof zone !== "string" || !zone || zone.length > 64) return false; try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; } catch { return false; } };
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
    let pet = null;
    if (writable(context)) {
      const ensured = await transaction(req, (tx) => ensureTogetherConversation(tx, { relationshipId, userId })); if (ensured.created) emit(ensured.conversation, "together.updated");
      // The member's own calendar day decides what "today" is.
      const timezone = clean(String(req.query?.timezone || ""), 64) || "UTC"; let today = "";
      try { today = new Date().toLocaleDateString("en-CA", { timeZone: timezone }); } catch { today = new Date().toISOString().slice(0, 10); }
      // 异地 (founder 11-06): each member's own time zone is kept on the shared conversation, so the other one sees "TA 那边 14:05".
      if (validZone(timezone) && timezone !== "UTC") await transaction(req, async (tx) => {
        const current = await tx.getRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, userId);
        if (current && current.zones?.[userId] !== timezone) await tx.updateRelationshipRecordForUser("togetherConversations", current.id, userId, (draft) => { draft.zones = { ...(draft.zones || {}), [userId]: timezone }; });
      }).catch(() => {});
      // 一起养的小家伙: brought up to date with what they did since (and a new level announced once).
      const synced = await transaction(req, (tx) => syncPet(tx, { relationshipId, userId, zone: validZone(timezone) ? timezone : "UTC", language: language(req) })).catch(() => null);
      if (synced?.leveled) emit(synced.conversation, "together.updated");
      pet = synced?.view || null;
      // An outfit stays on only while the couple still owns it (a lapsed membership takes the members' outfits off).
      if (pet?.outfit) { const plan = await membershipFor(store, userId, { purchases: await cachedPurchases(store) }).catch(() => null); if (!plan?.outfits.includes(pet.outfit)) pet = { ...pet, outfit: null }; }
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
      promises?.noteTogether(relationshipId, userId); profile?.noteTogether(relationshipId, userId);
    }
    const snapshot = await store.relationshipSnapshotForUser(userId);
    const conversation = snapshot.togetherConversations.find((item) => item.relationshipId === relationshipId);
    if (!conversation) throw decisionError(409, "pairing_required");
    if (hint(req)) translator.ensure({ relationshipId, userId, language: hint(req), messages: conversation.messages });
    const { activeAgreements, openCommitments, pendingAgreement } = buildTogetherContext(snapshot, relationshipId);
    // The next time they meet (a "meetup" date Pinky kept), counted down in Us and on Coming up.
    const day = (() => { try { return new Date().toLocaleDateString("en-CA", { timeZone: validZone(req.query?.timezone) ? req.query.timezone : "UTC" }); } catch { return new Date().toISOString().slice(0, 10); } })();
    const meetup = (snapshot.milestones || []).filter((item) => item.relationshipId === relationshipId && item.type === "meetup" && !item.archivedAt && typeof item.date === "string" && item.date >= day).sort((a, b) => a.date.localeCompare(b.date))[0];
    res.json({ conversation: projectRecord(conversation, userId), pendingAgreement, activeAgreements, openCommitments, readOnly: !writable(context), nextMeeting: meetup ? { id: meetup.id, date: meetup.date, title: meetup.title } : null, care: await careNoteFor(store, userId, day).catch(() => null), pet, members: context.members.map((member) => ({ id: member.userId, name: member.user.name, role: member.role })) });
  });

  // "更早的消息": a page of what came before the message `before` (the oldest one the App holds), from the working set and
  // then the archive; readable after the relationship ended, like the conversation itself.
  router.get("/together/history", async (req, res) => {
    const userId = req.auth.user.id, context = await pairing(req);
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query?.limit || ""), 10) || 50));
    res.json(await olderTogetherMessages(store, { relationshipId: context.relationship.id, userId, before: clean(String(req.query?.before || ""), 80), limit }));
  });

  // 想你了: one tap that tells the partner they are being thought of. A second tap within 30 seconds is the same one.
  router.post("/together/nudge", async (req, res) => {
    const userId = req.auth.user.id;
    const result = await transaction(req, async (tx, _context, relationshipId) => {
      const { conversation } = await ensureTogetherConversation(tx, { relationshipId, userId });
      const last = [...conversation.messages].reverse().find((item) => item.kind === "nudge" && item.actorUserId === userId);
      if (last && Date.now() - Date.parse(last.createdAt) < 30_000) return { conversation, message: last, duplicate: true };
      return appendTogetherMessage(tx, { relationshipId, actorUserId: userId, source: "app", kind: "nudge", text: "💗" });
    });
    if (!result.duplicate) { emit(result.conversation, "together.updated", null, userId); void recordUsage(store, { userId, relationshipId: result.conversation.relationshipId, action: "together_nudge" }); }
    res.status(result.duplicate ? 200 : 201).json({ message: result.message, duplicate: Boolean(result.duplicate) });
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
    if (!result.duplicate) { void recordUsage(store, { userId, relationshipId, action: "together_message" }); promises?.noteTogether(relationshipId, userId); profile?.noteTogether(relationshipId, userId); }
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
  // A one-off plan written as an agreement goes onto the shared calendar instead (founder 11-06), counted from the day its
  // current version was written in this member's time zone.
  router.post("/together/agreements/:id/to-calendar", async (req, res) => {
    const userId = req.auth.user.id, zone = (await memberTimezone(store, userId).catch(() => null)) || "UTC";
    const result = await transaction(req, async (tx, context) => {
      const current = await tx.getRelationshipRecordForUser("agreements", req.params.id, userId);
      const from = new Date(current?.updatedAt || Date.now()).toLocaleDateString("en-CA", { timeZone: zone });
      const name = context.members.find((member) => member.userId === userId)?.user?.name || "";
      return planToCalendar(tx, { agreementId: req.params.id, version: req.body?.version, userId, from, name });
    });
    for (const milestone of result.milestones) emit(milestone, "milestone.updated");
    emit(result.agreement, "agreement.updated"); if (result.conversation) emit(result.conversation, "together.updated", null, userId);
    res.json({ agreement: result.agreement, milestones: result.milestones });
  });
  // A point still open, settled on the card: a new version both approve, and a line in Us so the other one sees what changed.
  router.post("/together/agreements/:id/answer", async (req, res) => {
    const userId = req.auth.user.id;
    // Worded by Pinky before the change is made; the transaction then checks the version and the point again.
    const current = await store.getRelationshipRecordForUser("agreements", req.params.id, userId);
    const point = Number.isInteger(req.body?.index) ? current?.unresolvedPoints?.[req.body.index] : null, answer = clean(req.body?.text, 300);
    const term = current?.version === req.body?.version && point && answer ? await phrasePoint({ mediator, terms: current.terms || [], point, answer }) : null;
    const result = await transaction(req, async (tx, context) => {
      const done = await answerAgreementPoint(tx, { agreementId: req.params.id, version: req.body?.version, userId, index: req.body?.index, text: req.body?.text, term });
      const me = context.members.find((member) => member.userId === userId)?.user?.name || "";
      const i18n = togetherI18n((language) => language === "en" ? `${me} settled "${done.point}": ${done.answer}. It's a new version now, so you both say yes again.` : language === "es" ? `${me} resolvió «${done.point}»: ${done.answer}. Ahora es una versión nueva: los dos tienen que aceptarla otra vez.` : `${me} 补上了「${done.point}」：${done.answer}。这样就是新的一版，你们俩再各点一次同意。`);
      const posted = await appendTogetherMessage(tx, { relationshipId: done.agreement.relationshipId, actorUserId: null, userId, source: "app", kind: "text", text: i18n.zh, i18n, handle: `agreement-answer:${done.agreement.id}:${done.agreement.version}` });
      // And the new version's card, which is the one to approve now.
      const card = await announceAgreement(tx, { agreement: done.agreement, userId, language: hint(req) });
      return { agreement: done.agreement, conversation: card?.conversation || (posted.duplicate ? null : posted.conversation) };
    });
    emit(result.agreement, "agreement.updated"); if (result.conversation) emit(result.conversation, "together.updated", null, userId);
    res.json({ agreement: result.agreement });
  });

  router.post("/together/daily/:id/answer", async (req, res) => {
    const userId = req.auth.user.id, initial = await pairing(req); if (!writable(initial)) throw decisionError(409, "pairing_required");
    const conversation = await answerDailyQuestion({ store, mediator, relationshipId: initial.relationship.id, userId, messageId: req.params.id, text: req.body?.text, language: language(req), emit: (updated) => emit(updated, "together.updated") });
    void recordUsage(store, { userId, relationshipId: initial.relationship.id, action: "daily_answered" });
    res.json({ conversation: projectRecord(conversation, userId) });
  });

  // 看完了吗: one tap answers Pinky's next-day question about a show they planned to watch together (watched.mjs).
  router.post("/together/watched/:id/answer", async (req, res) => {
    const userId = req.auth.user.id, initial = await pairing(req); if (!writable(initial)) throw decisionError(409, "pairing_required");
    const conversation = await answerWatchCheck({ store, relationshipId: initial.relationship.id, userId, messageId: req.params.id, finished: req.body?.finished, emit: (updated) => emit(updated, "together.updated") });
    void recordUsage(store, { userId, relationshipId: initial.relationship.id, action: "watch_answered" });
    res.json({ conversation: projectRecord(conversation, userId) });
  });

  // 小游戏: "再来一局" starts a round directly; answers follow the daily question's hidden-until-both rule.
  // 摸摸它: once a day each.
  router.post("/together/pet", async (req, res) => {
    const userId = req.auth.user.id, initial = await pairing(req); if (!writable(initial)) throw decisionError(409, "pairing_required");
    const zone = validZone(req.body?.timezone) ? req.body.timezone : "UTC";
    const result = await transaction(req, (tx, _context, relationshipId) => petIt(tx, { relationshipId, userId, zone, language: language(req) }));
    emit(result.conversation, "together.updated");
    res.json({ pet: result.view });
  });
  router.post("/together/games", async (req, res) => {
    const userId = req.auth.user.id, initial = await pairing(req); if (!writable(initial)) throw decisionError(409, "pairing_required");
    const message = await startGame({ store, mediator, relationshipId: initial.relationship.id, userId, type: GAME_TYPES.includes(req.body?.type) ? req.body.type : null, language: language(req), emit: (updated) => emit(updated, "together.updated") });
    if (message) void recordUsage(store, { userId, relationshipId: initial.relationship.id, action: "game_started" });
    res.status(message ? 201 : 202).json({ started: Boolean(message) });
  });
  router.post("/together/games/:id/answer", async (req, res) => {
    const userId = req.auth.user.id, initial = await pairing(req); if (!writable(initial)) throw decisionError(409, "pairing_required");
    const conversation = await answerGame({ store, relationshipId: initial.relationship.id, userId, messageId: req.params.id, choice: req.body?.choice, text: req.body?.text, emit: (updated) => emit(updated, "together.updated") });
    res.json({ conversation: projectRecord(conversation, userId) });
  });

  router.use(decisionErrorHandler);
  return router;
}
