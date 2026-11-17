import { createHash } from "node:crypto";
import express from "express";
import { createRelationshipRecord } from "./relationship-domain.mjs";
import { appendTogetherMessage } from "./together-domain.mjs";
import { fitModules, fitQuestions, localizedFitModules, mbtiTypes, zodiacNames } from "./fit-questions.mjs";
import { coupleFitReport, coupleSupportReport, fitOverviewComplete, personalFitReport, supportReady, supportSharingPreview } from "./fit-report.mjs";

import { previousFitQuestions } from "./fit-previous-questions.mjs";

const KIND = "relationship_guide";
const collection = "checkins";
const supported = new Set(["zh", "en", "es"]);
const ownId = (userId) => `fit-profile:${userId}`;
const activePair = (context) => context?.relationship.status === "active" && context.members.length === 2;
const languageOf = (req) => supported.has(req.body?.language || req.query?.language) ? req.body?.language || req.query.language : "zh";
const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;
const fail = (statusCode, code) => Object.assign(new Error(code), { statusCode, code });
const questionById = new Map(fitQuestions.map((question) => [question.id, question]));
const supportIds = new Set(fitModules.find(module => module.id === "support").questions.map(q => q.id));
function shareMode(profile) {
  if (!profile) return "none";
  if (Object.keys(profile.answers || {}).some(id => supportIds.has(id))) {
    return profile.supportReview && supportReady(profile) ? "support" : "none";
  }
  return fitOverviewComplete(profile) ? "legacy" : "none";
}
const validVersion = (value) => Number.isSafeInteger(value) && value >= 0;
const emptyProfile = () => ({ version: 0, answers: {}, mbti: null, zodiac: null });
const sharedIn = (profile, context) => activePair(context) && profile?.sharingRelationshipId === context.relationship.id && profile.sharedVersion === profile.version
  && shareMode(profile) !== "none" && (profile.sharedMode || "legacy") === shareMode(profile);

async function readOwn(db, userId) {
  const profile = await db.getRelationshipRecordForUser(collection, ownId(userId), userId);
  return profile?.kind === KIND && profile.ownerUserId === userId && profile.visibility === "private" ? profile : null;
}

async function view(db, userId, language) {
  const context = await db.getRelationshipContext(userId);
  const stored = await readOwn(db, userId) || emptyProfile();
  const own = { ...stored, answers: Object.fromEntries(Object.entries(stored.answers || {}).filter(([id]) => questionById.has(id))) };
  const previousAnswers = previousFitQuestions.flatMap((q) => {
    const option = q.options[stored.answers?.[q.id]];
    return option ? [{ question: q.text[language], answer: option[language] }] : [];
  });
  const sharing = sharedIn(own, context);
  const partner = activePair(context) ? context.members.find((member) => member.userId !== userId) : null;
  const partnerName = partner?.user?.name || "";
  let couple = {
    status: partner ? sharing ? "waiting" : "need-your-share" : "unpaired",
    partnerName,
    summary: say(language, "各自确认愿意分享的内容后，来看看你难过时想要的陪伴，和 TA 习惯给出的回应。", "Once you both choose what to share, explore the support you want and how your partner responds.", "Cuando ambos decidan qué compartir, podrán ver qué apoyo buscan y cómo suele responder su pareja."),
    sections: [],
  };
  if (partner && sharing) {
    // Server-side access is used only after the current viewer has opted in. A peer's
    // content is exposed exclusively while that peer's exact current version is shared.
    const theirs = await readOwn(db, partner.userId);
    if (sharedIn(theirs, context)) {
      const mode = shareMode(own);
      if (mode === shareMode(theirs)) {
        couple = mode === "support" ? coupleSupportReport(own, theirs, partnerName, language) : coupleFitReport(own, theirs, partnerName, language);
      } else {
        couple.status = "different-guides";
        couple.summary = say(language, "你们分享了不同主题。两人都确认「心情不好时」的发现后，就能看看彼此想要和习惯给出的陪伴。", "You shared different guides. When both of you confirm your support discoveries, you can compare what helps and what each of you tends to do.", "Compartieron guías distintas. Cuando ambos confirmen su reflexión sobre el apoyo, podrán comparar qué ayuda y qué suele hacer cada uno.");
      }
    }
  }
  return {
    modules: localizedFitModules(language),
    profile: {
      version: own.version, answers: own.answers || {}, mbti: own.mbti || null, zodiac: own.zodiac || null,
      sharing, shareMode: shareMode(own), canShare: shareMode(own) !== "none", supportReview: own.supportReview || null,
      answeredCount: Object.values(own.answers || {}).filter(value => value !== "skip").length, totalQuestions: fitQuestions.length,
    },
    supportSharePreview: shareMode(own) === "support" ? supportSharingPreview(own, language) : [],
    previousAnswers, personal: personalFitReport(own, language), couple,
  };
}

const errors = {
  signed_out: ["请先登录。", "Please sign in first.", "Inicia sesión primero."],
  invalid_input: ["内容无法保存，请检查选项后重试。", "Check your choices and try saving again.", "Revisa tus elecciones e intenta guardarlas de nuevo."],
  stale_version: ["你的说明书刚更新过，请刷新后再保存。", "Your guide changed. Refresh it before saving again.", "Tu guía cambió. Actualízala antes de volver a guardar."],
  pairing_required: ["先邀请 TA 加入，再确认分享。", "Invite your partner to join before sharing.", "Invita a tu pareja antes de compartir."],
  overview_required: ["请先完成主题并确认你的发现，然后预览分享内容。", "Finish the topic and confirm your discovery to preview sharing.", "Completa el tema y confirma tu reflexión para revisar lo que compartirás."],
  unavailable: ["说明书暂时无法打开，请稍后重试。", "Couldn't open your guide. Try again in a moment.", "No se pudo abrir tu guía. Inténtalo de nuevo en un momento."],
};

function readMutation(req, action) {
  const version = action === "delete" ? Number(req.query.version) : req.body?.version;
  if (!validVersion(version) || (action === "delete" && req.query.version === undefined)) throw fail(400, "invalid_input");
  let values;
  if (action === "answers") {
    const answers = req.body?.answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers) || !Object.keys(answers).length || Object.keys(answers).length > fitQuestions.length) throw fail(400, "invalid_input");
    const entries = Object.entries(answers).sort(([a], [b]) => a.localeCompare(b));
    for (const [id, answer] of entries) {
      if (!questionById.has(id) || answer !== null && answer !== "skip" && !questionById.get(id).options.some((choice) => choice.id === answer)) throw fail(400, "invalid_input");
    }
    values = Object.fromEntries(entries);
  } else if (action === "support-review") {
    const { kind, text = "" } = req.body || {};
    if (!["fits", "sometimes", "edit"].includes(kind) || typeof text !== "string" || text.length > 400 || (kind === "edit" && !text.trim())) throw fail(400, "invalid_input");
    values = { kind, text: kind === "edit" ? text.trim() : "" };
  } else if (action === "profile") {
    const { mbti, zodiac } = req.body || {};
    if (mbti !== null && !mbtiTypes.has(mbti) || zodiac !== null && !Object.hasOwn(zodiacNames, zodiac)) throw fail(400, "invalid_input");
    values = { mbti, zodiac };
  } else if (action === "sharing") {
    if (typeof req.body?.on !== "boolean") throw fail(400, "invalid_input");
    const mode = req.body.mode ?? "legacy";
    if (req.body.on && mode !== "support" && mode !== "legacy") throw fail(400, "invalid_input");
    values = req.body.on ? { on: true, mode } : { on: false };
  } else values = {};
  return { action, version, values };
}

async function change(db, userId, context, mutation) {
  const { action, version, values } = mutation;
  const current = await readOwn(db, userId);
  const profile = current || emptyProfile();
  const relationshipId = activePair(context) ? context.relationship.id : null;
  // Fingerprints retain no answer text and make a retry of the immediately previous
  // write safe. An older screen can never replay a grant into a new relationship.
  const signature = createHash("sha256").update(JSON.stringify({ action, values, relationshipId })).digest("hex");
  if (profile.version !== version) {
    if (current?.lastMutation?.from === version && current.lastMutation.signature === signature) return false;
    throw fail(409, "stale_version");
  }
  if (action === "sharing" && values.on && !relationshipId) throw fail(409, "pairing_required");
  if (action === "sharing" && values.on && shareMode(profile) === "none") throw fail(409, "overview_required");
  if (action === "sharing" && values.on && values.mode !== shareMode(profile)) throw fail(409, "stale_version");
  const next = { ...profile, answers: { ...(profile.answers || {}) } };
  if (action === "answers") {
    for (const [id, answer] of Object.entries(values)) {
      if (supportIds.has(id) && (next.answers[id] ?? null) !== answer) next.supportReview = null;
      if (answer === null) delete next.answers[id];
      else next.answers[id] = answer;
    }
  } else if (action === "support-review") {
    if (!supportReady(profile)) throw fail(400, "overview_required");
    next.supportReview = values;
  } else if (action === "profile") Object.assign(next, values);
  if (action === "delete") {
    next.answers = {};
    next.supportReview = null;
    next.mbti = null;
    next.zodiac = null;
  }
  const sameAnswers = JSON.stringify(next.answers) === JSON.stringify(profile.answers || {});
  const contentChanged = !sameAnswers || (profile.supportReview?.kind || null) !== (next.supportReview?.kind || null)
    || (profile.supportReview?.text || "") !== (next.supportReview?.text || "") || (next.mbti || null) !== (profile.mbti || null) || (next.zodiac || null) !== (profile.zodiac || null);
  const sameSharing = action !== "sharing" || sharedIn(profile, context) === values.on;
  if (!contentChanged && sameSharing && action !== "delete") return false;
  next.version = profile.version + 1;
  next.sharingRelationshipId = null;
  next.sharedVersion = null;
  next.sharedMode = null;
  if (action === "sharing" && values.on) {
    next.sharingRelationshipId = relationshipId;
    next.sharedVersion = next.version;
    next.sharedMode = shareMode(profile);
  }
  next.lastMutation = { from: version, signature };
  if (!current) {
    const record = createRelationshipRecord({ relationshipId: null, userId, visibility: "private", aiAccessScope: "none", kind: KIND, ...next });
    record.id = ownId(userId);
    await db.createRelationshipRecord(collection, record);
  } else {
    await db.updateRelationshipRecordForUser(collection, current.id, userId, (record) => {
      if (record.version !== version) throw fail(409, "stale_version");
      Object.assign(record, next);
    });
  }
  // Only the owner can view these receipts. Raw responses are never copied into an
  // event or the shared chat. The emptied profile keeps a version after deletion.
  if (action === "sharing" || action === "delete" || sharedIn(profile, context)) {
    await db.createRelationshipRecord("consentEvents", createRelationshipRecord({
      relationshipId, userId, visibility: "private", aiAccessScope: "none", status: "recorded", objectType: KIND,
      eventType: action === "delete" ? "fit.deleted" : next.sharedVersion ? "fit.shared" : "fit.withdrawn", sourceVersion: next.version,
    }));
  }
  return true;
}

export function createFitRouter({ store, emit = () => {}, notify = () => {} }) {
  const router = express.Router();
  router.use("/fit", (req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    if (req.auth?.user?.id) return next();
    const language = languageOf(req);
    return res.status(401).json({ code: "signed_out", error: say(language, ...errors.signed_out) });
  });
  const handle = (action = null) => async (req, res) => {
    const userId = req.auth.user.id, language = languageOf(req);
    try {
      const mutation = action ? readMutation(req, action) : null;
      const initial = await store.getRelationshipContext(userId);
      const lock = initial?.relationship ? `relationship:${initial.relationship.id}` : `user:${userId}`;
      const result = await store.transaction(lock, async (tx) => {
        const context = await tx.getRelationshipContext(userId);
        // Membership changes require a new screen state before a sharing grant.
        if (mutation?.action === "sharing" && mutation.values.on && context?.relationship.id !== initial?.relationship.id) throw fail(409, "stale_version");
        const wasSharing = mutation && sharedIn(await readOwn(tx, userId), context);
        const changed = mutation ? await change(tx, userId, context, mutation) : false;
        const publicChanged = changed && (wasSharing || mutation?.action === "sharing");
        const payload = await view(tx, userId, language);
        let conversation;
        if (changed && mutation?.action === "sharing" && mutation.values.on) {
          const i18n = {
            zh: "我分享了自己的关系说明书，邀请你一起看看我们哪里合拍。",
            en: "I shared my relationship guide. Let's see how we connect.",
            es: "Compartí mi guía de relación. Veamos cómo conectamos.",
          };
          if (payload.profile.shareMode === "support") {
            i18n.zh = "我分享了「心情不好时」的发现。要一起看看怎样陪彼此吗？";
            i18n.en = "I shared what helps on a hard day. Want to see how we can support each other?";
            i18n.es = "Compartí lo que me ayuda en un día difícil. ¿Vemos cómo acompañarnos?";
          }
          ({ conversation } = await appendTogetherMessage(tx, {
            relationshipId: context.relationship.id, actorUserId: userId, source: "app", text: i18n[language],
            refs: [{ type: "fit", id: "fit" }], handle: "fit-invite:" + userId + ":" + payload.profile.version,
          }));
        }
        return { payload, publicChanged, relationshipId: context?.relationship.id, conversation,
          partnerId: context?.members.find((member) => member.userId !== userId)?.userId };
      });
      if (result.publicChanged && result.relationshipId) emit({ id: "fit", relationshipId: result.relationshipId }, "fit.updated", null, userId);
      if (result.conversation) {
        emit(result.conversation, "together.updated", null, userId);
        if (result.partnerId) void Promise.resolve().then(() => notify(result.partnerId, {
          body: { zh: "TA 邀请你一起看关系说明书。", en: "Your partner invited you to explore your relationship guides.", es: "Tu pareja te invitó a ver sus guías de relación." },
          url: "/?channel=us&fit=1", tag: "fit-invite",
        })).catch(() => {});
      }
      res.json(result.payload);
    } catch (error) {
      const code = Object.hasOwn(errors, error.code) ? error.code : "unavailable";
      res.status(error.statusCode || 500).json({ code, error: say(language, ...errors[code]) });
    }
  };
  router.get("/fit", handle());
  router.post("/fit/answers", handle("answers"));
  router.post("/fit/support-review", handle("support-review"));
  router.post("/fit/profile", handle("profile"));
  router.post("/fit/sharing", handle("sharing"));
  router.delete("/fit", handle("delete"));
  return router;
}
