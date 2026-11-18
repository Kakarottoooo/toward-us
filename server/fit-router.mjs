import { createHash } from "node:crypto";
import express from "express";
import { createRelationshipRecord } from "./relationship-domain.mjs";
import { appendTogetherMessage } from "./together-domain.mjs";
import { mbtiTypes, zodiacNames } from "./fit-questions.mjs";
import { personalFitReport } from "./fit-report.mjs";
import { fitQuestions } from "./fit-questions.mjs";
import { inventoryQuestions } from "./fit-inventory.mjs";
import { inventoryReport } from "./fit-inventory-report.mjs";
import { pairQuestions } from "./fit-pair-pattern.mjs";
import { portableQuestions, portableSupportChapter } from "./fit-portable.mjs";
import { loveQuestions } from "./fit-love-questions.mjs";
import { loveStyleReport } from "./fit-love-style.mjs";
import { fourQuestions } from "./fit-four-questions.mjs";
import { fourReport, fourPreview } from "./fit-four-style.mjs";
import { fourPairReport } from "./fit-four-pair.mjs";

const currentMode = "four-v5";
const old32 = [...inventoryQuestions, ...portableQuestions];
const old44 = [...old32, ...loveQuestions];
const complete = (answers, questions) => questions.every(q => !!answers?.[q.id]);
const previousByText = new Map([...fitQuestions, ...pairQuestions, ...old44].map(q => [q.text.zh, q]));
const carried = fourQuestions.flatMap(q => {
  const old = previousByText.get(q.text.zh);
  if (!old || !Object.keys(q.text).every(lang => q.text[lang] === old.text[lang]) || old.options.length !== q.options.length) return [];
  const remap = new Map();
  for (const option of q.options) {
    const before = old.options.find(o => Object.keys(option.text).every(lang => o.text[lang] === option.text[lang]));
    if (!before) return [];
    remap.set(before.id, option.id);
  }
  remap.set("skip", "skip");
  return [{ id: q.id, oldId: old.id, remap }];
});
function currentAnswers(profile) {
  if (profile.fourAnswers) return profile.fourAnswers;
  const answers = {};
  for (const { id, oldId, remap } of carried) {
    const answer = remap.get(profile.answers?.[oldId]);
    if (answer) answers[id] = answer;
  }
  return answers;
}
function previousPortrait(profile, language) {
  if (complete(profile.answers, old44)) return loveStyleReport(profile, language);
  const inventory = inventoryReport(profile, language);
  if (inventory) {
    const support = complete(profile.answers, old32) && portableSupportChapter(profile, language);
    return { ...inventory, chapters: [...(inventory.chapters || []), ...(support ? [support] : [])] };
  }
  return personalFitReport(profile, language);
}

const KIND = "relationship_guide";
const collection = "checkins";
const supported = new Set(["zh", "en", "es"]);
const ownId = (userId) => `fit-profile:${userId}`;
const activePair = (context) => context?.relationship.status === "active" && context.members.length === 2;
const languageOf = (req) => supported.has(req.body?.language || req.query?.language) ? req.body?.language || req.query.language : "zh";
const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;
const fail = (statusCode, code) => Object.assign(new Error(code), { statusCode, code });
const questionById = new Map(fourQuestions.map(question => [question.id, question]));
function shareMode(profile) {
  if (!profile) return "none";
  const answers = currentAnswers(profile);
  return complete(answers, fourQuestions) && fourQuestions.some(q => q.options.some(o => o.id === answers[q.id])) ? currentMode : "none";
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
  const relationshipId = activePair(context) ? context.relationship.id : null;
  const own = { ...stored, answers: currentAnswers(stored) };
  const sharing = sharedIn(stored, context);
  const partner = activePair(context) ? context.members.find(member => member.userId !== userId) : null;
  const partnerName = partner?.user?.name || "";
  const mode = shareMode(stored);
  const submitted = complete(own.answers, fourQuestions);
  const oldData = Object.keys(stored.answers || {}).length > 0;
  const questions = submitted ? [] : fourQuestions.map(q => {
    const options = q.options.map(o => ({ id: o.id, text: o.text[language] }));
    // Order is uniformly keyed to this user and item, stable across sessions and languages.
    if (createHash("sha256").update(JSON.stringify([currentMode, userId, q.id])).digest()[0] & 1) options.reverse();
    return { id: q.id, text: q.text[language], options };
  });
  const inventory = {
    relationshipId, submitted, previousLocked: oldData, questions, pairQuestions: [],
    report: submitted ? fourReport(own, language) : null,
    previousPortrait: oldData ? previousPortrait(stored, language) : null,
    preview: mode === currentMode ? fourPreview(own, language) : [], revisitIds: [],
  };
  let couple = {
    status: partner ? sharing ? "waiting" : "need-your-share" : "unpaired",
    partnerName,
    summary: say(language, "各自完成同一套问卷并同意分享后，就能看到你们在哪些地方合拍，哪些事值得提前商量。", "Complete the same questionnaire and share your portraits to see where you click and what to talk through.", "Completen el mismo cuestionario y compartan sus perfiles para ver en qué coinciden y qué conviene conversar."),
    sections: [],
  };
  if (partner && sharing) {
    // Server-side access is used only after the current viewer has opted in. A peer's
    // content is exposed exclusively while that peer's exact current version is shared.
    const theirs = await readOwn(db, partner.userId);
    if (sharedIn(theirs, context)) {
      couple = fourPairReport(own, { ...theirs, answers: currentAnswers(theirs) }, partnerName, language);
    }
  }
  return {
    inventory, modules: [], previousAnswers: [], supportSharePreview: [], personal: null, couple,
    profile: {
      version: stored.version, answers: submitted ? {} : own.answers, mbti: stored.mbti || null, zodiac: stored.zodiac || null,
      sharing, shareMode: mode, canShare: mode === currentMode, supportReview: null,
      answeredCount: Object.keys(own.answers).length, totalQuestions: fourQuestions.length,
    },
  };
}

const errors = {
  signed_out: ["请先登录。", "Please sign in first.", "Inicia sesión primero."],
  invalid_input: ["内容无法保存，请检查选项后重试。", "Check your choices and try saving again.", "Revisa tus elecciones e intenta guardarlas de nuevo."],
  stale_version: ["你的说明书刚更新过，请刷新后再保存。", "Your guide changed. Refresh it before saving again.", "Tu guía cambió. Actualízala antes de volver a guardar."],
  pairing_required: ["先邀请 TA 加入，再确认分享。", "Invite your partner to join before sharing.", "Invita a tu pareja antes de compartir."],
  portrait_closed: ["这份问卷已经完成，已保存你的画像。", "This questionnaire is complete. Your portrait is saved.", "El cuestionario está cerrado y tu retrato está guardado."],
  overview_required: ["请先完成问卷，再预览要分享的内容。", "Finish your questionnaire to preview what you can share.", "Termina el cuestionario para revisar lo que compartirás."],
  unavailable: ["说明书暂时无法打开，请稍后重试。", "Couldn't open your guide. Try again in a moment.", "No se pudo abrir tu guía. Inténtalo de nuevo en un momento."],
};

function readMutation(req, action) {
  const version = action === "delete" ? Number(req.query.version) : req.body?.version;
  if (!validVersion(version) || (action === "delete" && req.query.version === undefined)) throw fail(400, "invalid_input");
  let values;
  if (action === "answers") {
    if (req.body?.questionnaire !== currentMode) throw fail(409, "stale_version");
    const answers = req.body?.answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers) || !Object.keys(answers).length || Object.keys(answers).length > questionById.size) throw fail(400, "invalid_input");
    const entries = Object.entries(answers).sort(([a], [b]) => a.localeCompare(b));
    for (const [id, answer] of entries) {
      if (!questionById.has(id) || answer !== null && answer !== "skip" && !questionById.get(id).options.some((choice) => choice.id === answer)) throw fail(400, "invalid_input");
    }
    values = Object.fromEntries(entries);
  } else if (action === "profile") {
    const { mbti, zodiac } = req.body || {};
    if (mbti !== null && !mbtiTypes.has(mbti) || zodiac !== null && !Object.hasOwn(zodiacNames, zodiac)) throw fail(400, "invalid_input");
    values = { mbti, zodiac };
  } else if (action === "sharing") {
    if (typeof req.body?.on !== "boolean") throw fail(400, "invalid_input");
    const mode = req.body.mode ?? "legacy";
    if (req.body.on && mode !== currentMode) throw fail(400, "invalid_input");
    values = req.body.on ? { on: true, mode } : { on: false };
    if (values.on) {
      if (typeof req.body.relationshipId !== "string" || !req.body.relationshipId) throw fail(400, "invalid_input");
      values.relationshipId = req.body.relationshipId;
    }
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
  if (values?.on && values.relationshipId && values.relationshipId !== relationshipId) throw fail(409, "stale_version");
  const signature = createHash("sha256").update(JSON.stringify({ action, values, relationshipId })).digest("hex");
  if (profile.version !== version) {
    if (current?.lastMutation?.from === version && current.lastMutation.signature === signature) return false;
    throw fail(409, "stale_version");
  }
  if (action === "sharing" && values.on && !relationshipId) throw fail(409, "pairing_required");
  if (action === "sharing" && values.on && shareMode(profile) === "none") throw fail(409, "overview_required");
  if (action === "sharing" && values.on && values.mode !== shareMode(profile)) throw fail(409, "stale_version");
  const next = { ...profile };
  const answersBefore = currentAnswers(profile);
  if (action === "answers") {
    if (complete(answersBefore, fourQuestions)) throw fail(409, "portrait_closed");
    next.fourAnswers = { ...answersBefore };
    for (const [id, answer] of Object.entries(values)) {
      if (answer === null) delete next.fourAnswers[id];
      else next.fourAnswers[id] = answer;
    }
  } else if (action === "profile") Object.assign(next, values);
  if (action === "delete") {
    next.answers = {};
    next.fourAnswers = {};
    next.previousPortraitLocked = false;
    next.pairRelationshipId = null;
    next.supportReview = null;
    next.mbti = null;
    next.zodiac = null;
  }
  const contentChanged = JSON.stringify(currentAnswers(next)) !== JSON.stringify(answersBefore)
    || (next.mbti || null) !== (profile.mbti || null) || (next.zodiac || null) !== (profile.zodiac || null);
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

  router.post("/fit/profile", handle("profile"));
  router.post("/fit/sharing", handle("sharing"));
  router.delete("/fit", handle("delete"));
  return router;
}
