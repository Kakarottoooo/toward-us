import { createHash } from "node:crypto";
import express from "express";
import { createRelationshipRecord } from "./relationship-domain.mjs";
import { appendTogetherMessage } from "./together-domain.mjs";
import { fitModules, fitQuestions, localizedFitModules, mbtiTypes, zodiacNames } from "./fit-questions.mjs";
import { coupleFitReport, coupleSupportReport, fitOverviewComplete, personalFitReport, supportReady, supportSharingPreview } from "./fit-report.mjs";
import { reviewedWording } from "./fit-support.mjs";
import { previousFitQuestions } from "./fit-previous-questions.mjs";
import { inventoryQuestions } from "./fit-inventory.mjs";
import { inventoryReady, inventoryReport, inventoryPairReport } from "./fit-inventory-report.mjs";

import { pairQuestions, pairReport } from "./fit-pair-pattern.mjs";

import { portableQuestions, portablePreview, portablePairReport, portablePersonalSections } from "./fit-portable.mjs";

// Each new item follows three familiar situations; returning users resume at their first missing item.
const portraitQuestions = inventoryQuestions.flatMap((question, index) =>
  (index + 1) % 3 === 0 ? [question, portableQuestions[(index + 1) / 3 - 1]] : [question]);
function portraitReady(profile) {
  const answers = profile.answers || {};
  return portraitQuestions.every(q => answers[q.id]) && portraitQuestions.some(q => q.options.some(o => o.id === answers[q.id]));
}

const KIND = "relationship_guide";
const collection = "checkins";
const supported = new Set(["zh", "en", "es"]);
const ownId = (userId) => `fit-profile:${userId}`;
const activePair = (context) => context?.relationship.status === "active" && context.members.length === 2;
const languageOf = (req) => supported.has(req.body?.language || req.query?.language) ? req.body?.language || req.query.language : "zh";
const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;
const fail = (statusCode, code) => Object.assign(new Error(code), { statusCode, code });
const questionById = new Map([...fitQuestions, ...portraitQuestions, ...pairQuestions].map((question) => [question.id, question]));
const supportIds = new Set(fitModules.find(module => module.id === "support").questions.map(q => q.id));
const pairIds = new Set(pairQuestions.map(q => q.id));
function shareMode(profile, relationshipId) {
  if (!profile) return "none";
  if (portableQuestions.some(q => profile.answers?.[q.id])) return portraitReady(profile) ? "portrait-v3" : "none";
  if (relationshipId && profile.pairRelationshipId === relationshipId && pairQuestions.some(q => profile.answers?.[q.id])) {
    const finished = pairQuestions.every(q => profile.answers[q.id]);
    const concrete = pairQuestions.some(q => q.options.some(o => o.id === profile.answers[q.id]));
    const personalDone = inventoryQuestions.every(q => profile.answers[q.id]) && inventoryQuestions.some(q => q.options.some(o => o.id === profile.answers[q.id]));
    return finished && concrete && personalDone ? "pattern-v2" : "none";
  }
  if (inventoryQuestions.some(q => profile.answers?.[q.id])) return inventoryReady(profile) ? "inventory" : "none";
  if (Object.keys(profile.answers || {}).some(id => supportIds.has(id))) {
    return profile.supportReview && supportReady(profile) ? "support" : "none";
  }
  return fitOverviewComplete(profile) ? "legacy" : "none";
}
const validVersion = (value) => Number.isSafeInteger(value) && value >= 0;
const emptyProfile = () => ({ version: 0, answers: {}, mbti: null, zodiac: null });
const sharedIn = (profile, context) => activePair(context) && profile?.sharingRelationshipId === context.relationship.id && profile.sharedVersion === profile.version
  && shareMode(profile, context.relationship.id) !== "none" && (profile.sharedMode || "legacy") === shareMode(profile, context.relationship.id);

async function readOwn(db, userId) {
  const profile = await db.getRelationshipRecordForUser(collection, ownId(userId), userId);
  return profile?.kind === KIND && profile.ownerUserId === userId && profile.visibility === "private" ? profile : null;
}

async function view(db, userId, language) {
  const context = await db.getRelationshipContext(userId);
  const stored = await readOwn(db, userId) || emptyProfile();
  const relationshipId = activePair(context) ? context.relationship.id : null;
  const own = { ...stored, answers: Object.fromEntries(Object.entries(stored.answers || {}).filter(([id]) => questionById.has(id) && (!pairIds.has(id) || (relationshipId && stored.pairRelationshipId === relationshipId)))) };
  const previousAnswers = previousFitQuestions.flatMap((q) => {
    const option = q.options[stored.answers?.[q.id]];
    return option ? [{ question: q.text[language], answer: option[language] }] : [];
  });
  const sharing = sharedIn(own, context);
  const partner = activePair(context) ? context.members.find((member) => member.userId !== userId) : null;
  const partnerName = partner?.user?.name || "";
  const inventoryPersonal = inventoryReport(own, language);
  const mode = shareMode(own, relationshipId);
  const localQuestions = questions => questions.map(q => ({
    id: q.id, text: q.text[language], options: q.options.map(o => ({ id: o.id, text: o.text[language] })),
  }));
  const ready = portraitReady(own);
  const extraSections = ready ? portablePersonalSections(own, language) : [];
  const report = ready ? {
    ...(inventoryPersonal || {
      title: say(language, "我的相处线索", "My relationship clues", "Mis pistas de relación"),
      summary: say(language, "已记录你的选择；三个个人风格维度还需要更多具体经历。", "Your choices are saved. More examples are needed to describe your personal style.", "Tus respuestas están guardadas. Faltan ejemplos para describir tu estilo personal."),
    }),
    sections: [...(inventoryPersonal?.sections || []), ...extraSections],
    coverage: say(language, "依据你在这份问卷里回忆的经历与选择。", "Based on the experiences and choices you recalled.", "Basado en las experiencias y decisiones que recuerdas."),
  } : null;
  const inventory = {
    relationshipId, questions: localQuestions(portraitQuestions), pairQuestions: [],
    report, previousPortrait: report ? null : inventoryPersonal,
    preview: mode === "portrait-v3" ? portablePreview(own, language) : [],
    revisitIds: portraitQuestions.filter(q => own.answers[q.id] === "skip").map(q => q.id),
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
      if (mode === shareMode(theirs, relationshipId)) {
        const reportFor = { "portrait-v3": portablePairReport, "pattern-v2": pairReport, inventory: inventoryPairReport, support: coupleSupportReport, legacy: coupleFitReport };
        couple = reportFor[mode](own, theirs, partnerName, language);
      } else {
        couple.status = "different-guides";
        couple.summary = say(language, "你们分享的是不同版本的问卷。双方完成并分享同一套相处画像后，这里会出现双人解析。", "You shared different questionnaires. Complete and share the same relationship portrait to see your joint report.", "Compartieron cuestionarios distintos. Completen y compartan el mismo perfil para ver su lectura en pareja.");
      }
    }
  }
  return {
    inventory, modules: localizedFitModules(language),
    profile: {
      version: own.version, answers: own.answers || {}, mbti: own.mbti || null, zodiac: own.zodiac || null,
      sharing, shareMode: mode, canShare: mode !== "none", supportReview: own.supportReview ? { kind: own.supportReview.kind, text: own.supportReview.text } : null,
      answeredCount: fitQuestions.filter(q => own.answers[q.id] && own.answers[q.id] !== "skip").length, totalQuestions: fitQuestions.length,
    },
    supportSharePreview: mode === "support" ? supportSharingPreview(own, language) : [],
    previousAnswers: [...previousAnswers, ...pairQuestions.flatMap(q => {
      const option = q.options.find(o => o.id === own.answers[q.id]);
      return option ? [{ question: q.text[language], answer: option.text[language] }] : [];
    })], personal: personalFitReport(own, language), couple,
  };
}

const errors = {
  signed_out: ["请先登录。", "Please sign in first.", "Inicia sesión primero."],
  invalid_input: ["内容无法保存，请检查选项后重试。", "Check your choices and try saving again.", "Revisa tus elecciones e intenta guardarlas de nuevo."],
  stale_version: ["你的说明书刚更新过，请刷新后再保存。", "Your guide changed. Refresh it before saving again.", "Tu guía cambió. Actualízala antes de volver a guardar."],
  pairing_required: ["先邀请 TA 加入，再确认分享。", "Invite your partner to join before sharing.", "Invita a tu pareja antes de compartir."],
  overview_required: ["请先完成问卷，再预览要分享的内容。", "Finish your questionnaire to preview what you can share.", "Termina el cuestionario para revisar lo que compartirás."],
  unavailable: ["说明书暂时无法打开，请稍后重试。", "Couldn't open your guide. Try again in a moment.", "No se pudo abrir tu guía. Inténtalo de nuevo en un momento."],
};

function readMutation(req, action) {
  const version = action === "delete" ? Number(req.query.version) : req.body?.version;
  if (!validVersion(version) || (action === "delete" && req.query.version === undefined)) throw fail(400, "invalid_input");
  let values;
  if (action === "answers") {
    const answers = req.body?.answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers) || !Object.keys(answers).length || Object.keys(answers).length > questionById.size) throw fail(400, "invalid_input");
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
    if (req.body.on && !["portrait-v3", "pattern-v2", "inventory", "support", "legacy"].includes(mode)) throw fail(400, "invalid_input");
    values = req.body.on ? { on: true, mode } : { on: false };
    if (values.on && ["portrait-v3", "inventory", "pattern-v2"].includes(mode)) {
      if (typeof req.body.relationshipId !== "string" || !req.body.relationshipId) throw fail(400, "invalid_input");
      values.relationshipId = req.body.relationshipId;
    }
  } else values = {};
  const pairWrite = action === "answers" && Object.keys(values).some(id => pairIds.has(id));
  if (pairWrite && (typeof req.body.relationshipId !== "string" || !req.body.relationshipId)) throw fail(400, "invalid_input");
  return { action, version, values, pairRelationshipId: pairWrite ? req.body.relationshipId : null };
}

async function change(db, userId, context, mutation) {
  const { action, version, values } = mutation;
  const current = await readOwn(db, userId);
  const profile = current || emptyProfile();
  const relationshipId = activePair(context) ? context.relationship.id : null;
  // Fingerprints retain no answer text and make a retry of the immediately previous
  // write safe. An older screen can never replay a grant into a new relationship.
  if ((mutation.pairRelationshipId && mutation.pairRelationshipId !== relationshipId) || (values?.on && values.relationshipId && values.relationshipId !== relationshipId)) throw fail(409, "stale_version");
  const signature = createHash("sha256").update(JSON.stringify({ action, values, relationshipId })).digest("hex");
  if (profile.version !== version) {
    if (current?.lastMutation?.from === version && current.lastMutation.signature === signature) return false;
    throw fail(409, "stale_version");
  }
  if (action === "sharing" && values.on && !relationshipId) throw fail(409, "pairing_required");
  if (action === "sharing" && values.on && shareMode(profile, relationshipId) === "none") throw fail(409, "overview_required");
  if (action === "sharing" && values.on && values.mode !== shareMode(profile, relationshipId)) throw fail(409, "stale_version");
  const next = { ...profile, answers: { ...(profile.answers || {}) } };
  if (action === "answers") {
    if (mutation.pairRelationshipId && profile.pairRelationshipId !== relationshipId) {
      for (const id of pairIds) delete next.answers[id];
      next.pairRelationshipId = relationshipId;
    }
    for (const [id, answer] of Object.entries(values)) {
      if (supportIds.has(id) && (next.answers[id] ?? null) !== answer) next.supportReview = null;
      if (answer === null) delete next.answers[id];
      else next.answers[id] = answer;
    }
  } else if (action === "support-review") {
    if (!supportReady(profile)) throw fail(400, "overview_required");
    next.supportReview = { ...values };
    if (values.kind !== "edit") {
      next.supportReview.wording = Object.fromEntries([...supported].map(language => [language, reviewedWording(next, language)]));
    }
  } else if (action === "profile") Object.assign(next, values);
  if (action === "delete") {
    next.answers = {};
    next.pairRelationshipId = null;
    next.supportReview = null;
    next.mbti = null;
    next.zodiac = null;
  }
  const sameAnswers = JSON.stringify(next.answers) === JSON.stringify(profile.answers || {});
  const contentChanged = (profile.pairRelationshipId ?? null) !== (next.pairRelationshipId ?? null) || !sameAnswers || (profile.supportReview?.kind || null) !== (next.supportReview?.kind || null)
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
    next.sharedMode = shareMode(profile, relationshipId);
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
