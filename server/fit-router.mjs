import { createHash } from "node:crypto";
import express from "express";
import { createRelationshipRecord } from "./relationship-domain.mjs";
import { fitQuestions, localizedFitModules, mbtiTypes, zodiacNames } from "./fit-questions.mjs";
import { coupleFitReport, fitOverviewComplete, personalFitReport } from "./fit-report.mjs";

const KIND = "relationship_guide";
const collection = "checkins";
const supported = new Set(["zh", "en", "es"]);
const ownId = (userId) => `fit-profile:${userId}`;
const activePair = (context) => context?.relationship.status === "active" && context.members.length === 2;
const languageOf = (req) => supported.has(req.body?.language || req.query?.language) ? req.body?.language || req.query.language : "zh";
const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;
const fail = (statusCode, code) => Object.assign(new Error(code), { statusCode, code });
const questionById = new Map(fitQuestions.map((question) => [question.id, question]));
const validVersion = (value) => Number.isSafeInteger(value) && value >= 0;
const emptyProfile = () => ({ version: 0, answers: {}, mbti: null, zodiac: null });
const sharedIn = (profile, context) => activePair(context) && profile?.sharingRelationshipId === context.relationship.id && profile.sharedVersion === profile.version;

async function readOwn(db, userId) {
  const profile = await db.getRelationshipRecordForUser(collection, ownId(userId), userId);
  return profile?.kind === KIND && profile.ownerUserId === userId && profile.visibility === "private" ? profile : null;
}

async function view(db, userId, language) {
  const context = await db.getRelationshipContext(userId);
  const own = await readOwn(db, userId) || emptyProfile();
  const sharing = sharedIn(own, context);
  const partner = activePair(context) ? context.members.find((member) => member.userId !== userId) : null;
  const partnerName = partner?.user?.name || "";
  let couple = {
    status: partner ? sharing ? "waiting" : "need-your-share" : "unpaired",
    partnerName,
    summary: say(language, "各自看完说明书，确认分享后，再一起看你们的解析。", "Read your own guide first, then both agree to share before exploring your relationship insights.", "Lean primero su propia guía y acepten compartir para explorar el análisis de ambos."),
    sections: [],
  };
  if (partner && sharing) {
    // Server-side access is used only after the current viewer has opted in. A peer's
    // content is exposed exclusively while that peer's exact current version is shared.
    const theirs = await readOwn(db, partner.userId);
    if (sharedIn(theirs, context) && fitOverviewComplete(own) && fitOverviewComplete(theirs)) {
      couple = coupleFitReport(own, theirs, partnerName, language);
    }
  }
  return {
    modules: localizedFitModules(language),
    profile: {
      version: own.version, answers: own.answers || {}, mbti: own.mbti || null, zodiac: own.zodiac || null,
      sharing, answeredCount: Object.keys(own.answers || {}).length, totalQuestions: fitQuestions.length,
    },
    personal: personalFitReport(own, language), couple,
  };
}

const errors = {
  signed_out: ["请先登录。", "Please sign in first.", "Inicia sesión primero."],
  invalid_input: ["内容无法保存，请检查选项后重试。", "Check your choices and try saving again.", "Revisa tus elecciones e intenta guardarlas de nuevo."],
  stale_version: ["你的说明书刚更新过，请刷新后再保存。", "Your guide changed. Refresh it before saving again.", "Tu guía cambió. Actualízala antes de volver a guardar."],
  pairing_required: ["先邀请 TA 加入，再确认分享。", "Invite your partner to join before sharing.", "Invita a tu pareja antes de compartir."],
  overview_required: ["先回答每个方面的第一道情景题，再确认分享。", "Answer the first situation in each area before sharing.", "Responde la primera situación de cada área antes de compartir."],
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
      if (!questionById.has(id) || answer !== null && !questionById.get(id).options.some((choice) => choice.id === answer)) throw fail(400, "invalid_input");
    }
    values = Object.fromEntries(entries);
  } else if (action === "profile") {
    const { mbti, zodiac } = req.body || {};
    if (mbti !== null && !mbtiTypes.has(mbti) || zodiac !== null && !Object.hasOwn(zodiacNames, zodiac)) throw fail(400, "invalid_input");
    values = { mbti, zodiac };
  } else if (action === "sharing") {
    if (typeof req.body?.on !== "boolean") throw fail(400, "invalid_input");
    values = { on: req.body.on };
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
  if (action === "sharing" && values.on && !fitOverviewComplete(profile)) throw fail(409, "overview_required");
  const next = { ...profile, answers: { ...(profile.answers || {}) } };
  if (action === "answers") {
    for (const [id, answer] of Object.entries(values)) {
      if (answer === null) delete next.answers[id];
      else next.answers[id] = answer;
    }
  } else if (action === "profile") Object.assign(next, values);
  if (action === "delete") {
    next.answers = {};
    next.mbti = null;
    next.zodiac = null;
  }
  const sameAnswers = JSON.stringify(next.answers) === JSON.stringify(profile.answers || {});
  const contentChanged = !sameAnswers || (next.mbti || null) !== (profile.mbti || null) || (next.zodiac || null) !== (profile.zodiac || null);
  const sameSharing = action !== "sharing" || sharedIn(profile, context) === values.on;
  if (!contentChanged && sameSharing && action !== "delete") return false;
  next.version = profile.version + 1;
  next.sharingRelationshipId = null;
  next.sharedVersion = null;
  if (action === "sharing" && values.on) {
    next.sharingRelationshipId = relationshipId;
    next.sharedVersion = next.version;
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

export function createFitRouter({ store, emit = () => {} }) {
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
        return { payload: await view(tx, userId, language), publicChanged, relationshipId: context?.relationship.id };
      });
      if (result.publicChanged && result.relationshipId) emit({ id: "fit", relationshipId: result.relationshipId }, "fit.updated", null, userId);
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
