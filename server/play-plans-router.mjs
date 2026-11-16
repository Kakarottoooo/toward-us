import { createHash } from "node:crypto";
import express from "express";
import { audit, decisionError } from "./agreement-actions.mjs";
import { conversationDay, readableConversation } from "./conversation-recall.mjs";
import { createRelationshipRecord } from "./relationship-domain.mjs";
import { localDateTimeToInstant } from "./reminder-service.mjs";
import { appendTogetherMessage, togetherI18n } from "./together-domain.mjs";

const ROUND = "play_date_round";
const VOTE = "play_date_picks";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CALENDAR = "/?view=upcoming";
const supported = new Set(["zh", "en", "es"]);
const key = (kind, ...parts) => kind + "-" + createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
const labels = (zh, en, es) => ({ zh, en, es });
const titleFor = (idea, language) => idea.title[language] || idea.title.zh;
const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const IDEAS = [
  { id: "walk", cue: /散步|走走|公园|海边|遛弯|\bwalk|\bpark|\bbeach|pase[oa]|parque|playa/i,
    title: labels("走一段陌生的小路", "Take a walk somewhere new", "Paseen por un sitio nuevo"),
    detail: labels("各找一处想让对方看看风景的地方。", "Each pick one spot worth showing the other.", "Elijan un rincón cada uno para enseñárselo al otro.") },
  { id: "food", cue: /吃|做饭|晚餐|甜品|小吃|咖啡|\bfood|\bcook|\beat\b|\bmeal|\bcoffee|comer|coci[nñ]|comida|café/i,
    title: labels("各挑一道想让 TA 尝的东西", "Pick something for each other to taste", "Elijan algo para que pruebe el otro"),
    detail: labels("在家做或买来分着吃，猜猜对方为什么选它。", "Make it or bring it home, then guess why they picked it.", "Prepárenlo o llévenlo a casa y adivinen por qué lo eligió el otro.") },
  { id: "music", cue: /音乐|唱歌|听歌|歌单|\bmusic|\bsong|\bplaylist|música|canci[oó]n/i,
    title: labels("交换两首今天的歌", "Swap two songs for today", "Intercambien dos canciones de hoy"),
    detail: labels("一人选一首，一起听完再说为什么。", "Pick one each, listen together, then tell each other why.", "Elijan una cada uno, escúchenlas juntos y cuéntense por qué.") },
  { id: "movie", cue: /电影|看剧|影院|电视剧|\bmovie|\bfilm|\bshow|pel[ií]cula|serie/i,
    title: labels("给彼此挑一集或一段电影", "Pick an episode or a film scene for each other", "Elijan un capítulo o una escena para el otro"),
    detail: labels("都愿意试的那一个，就约个时间一起看。", "Set aside time for whichever one you both want to watch.", "Aparten un rato para ver lo que les apetezca a ambos.") },
  { id: "play", cue: /游戏|拼图|桌游|\bgame|\bpuzzle|\bplay\b|juego|rompecabezas/i,
    title: labels("玩一局十分钟的小挑战", "Try a ten-minute challenge together", "Prueben un reto de diez minutos"),
    detail: labels("一人选个小游戏，玩完交换选游戏的人。", "One person picks a quick game. Switch who picks next time.", "Una persona elige un juego rápido. La próxima vez le toca a la otra.") },
  { id: "photos", cue: /照片|拍照|摄影|\bphoto|\bpicture|fotogra|foto/i,
    title: labels("用三张照片交换今天", "Trade a three-photo story of your day", "Intercambien su día en tres fotos"),
    detail: labels("可以远程一起做，各挑一张照片讲个小故事。", "Works at a distance too. Choose one photo each to tell the story behind.", "También a distancia. Elijan una foto cada uno y cuenten su historia.") },
];

function ideasFor(question, members, customTitle) {
  const answers = members.map(({ userId }) => String(question.answers[userId]?.text || "").slice(0, 600));
  const both = IDEAS.find((idea) => answers.every((answer) => idea.cue.test(answer)));
  const fromOne = (text) => IDEAS.find((idea) => idea.cue.test(text));
  const result = [...new Set([both, ...answers.map(fromOne), IDEAS[0], IDEAS[1], IDEAS[2]].filter(Boolean))].slice(0, 3);
  return [
    ...result.map((idea) => ({ ...idea, fromBoth: idea === both })),
    ...(customTitle ? [{ id: "custom", title: labels(customTitle, customTitle, customTitle), detail: labels("", "", ""), fromBoth: false }] : []),
  ];
}

const activePair = (context) => context?.relationship.status === "active" && context.members.length === 2;
const roundId = (relationshipId, questionId) => key(ROUND, relationshipId, questionId);
const voteId = (relationshipId, questionId, userId) => key(VOTE, relationshipId, questionId, userId);

async function revealedQuestion(store, context, questionId, userId) {
  if (typeof questionId !== "string" || !UUID.test(questionId)) throw decisionError(404, "not_found");
  const conversation = await readableConversation(store, userId, "us", "together:" + context.relationship.id);
  const find = (record) => record.messages?.find((item) => item.id === questionId);
  let message = find(conversation);
  for (let seq = conversation.archived?.chunks || 0; !message && seq > 0; seq -= 1) {
    const part = await store.getRelationshipRecordForUser("togetherArchives", conversation.id + ":archive:" + seq, userId);
    if (part?.relationshipId === context.relationship.id && part.visibility === "shared" && !part.archivedAt) message = find(part);
  }
  if (!message || (message.kind !== "daily_question" && !(message.kind === "game" && message.game?.deckId)) ||
      !context.members.every(({ userId: memberId }) => message.answers?.[memberId])) throw decisionError(404, "not_found");
  return message;
}

async function readState(store, context, questionId, userId) {
  const { relationship, members } = context;
  const question = await revealedQuestion(store, context, questionId, userId);
  const [round, ...votes] = await Promise.all([
    store.getRelationshipRecordForUser("proposals", roundId(relationship.id, questionId), userId),
    ...members.map(({ userId: memberId }) => store.getRelationshipRecordForUser("proposals", voteId(relationship.id, questionId, memberId), memberId)),
  ]);
  const milestone = round?.offer?.status === "confirmed"
    ? await store.getRelationshipRecordForUser("milestones", round.offer.milestoneId, userId)
    : null;
  const removed = round?.offer?.status === "confirmed" && (!milestone || milestone.archivedAt || milestone.withdrawnAt);
  return {
    question, round: removed ? { ...round, offer: { ...round.offer, status: "removed" } } : round,
    votes: votes.filter(Boolean), ideas: ideasFor(question, members, round?.customTitle),
  };
}

const matchIds = ({ votes, ideas }) => votes.length === 2
  ? ideas.filter((idea) => votes.every((vote) => vote.ideaIds.includes(idea.id))).map((idea) => idea.id)
  : [];

function view(state, userId, language) {
  const mine = state.votes.find((vote) => vote.ownerUserId === userId);
  return {
    questionId: state.question.id,
    questionTitle: state.question.i18n?.[language] || state.question.translations?.[language]?.text || state.question.text,
    version: state.round?.version || 0,
    ideas: state.ideas.map(({ id, title, detail, fromBoth }) => ({ id, title: title[language], detail: detail[language], fromBoth })),
    mine: mine?.ideaIds || [],
    saved: Boolean(mine),
    partnerReady: state.votes.some((vote) => vote.ownerUserId !== userId),
    matches: matchIds(state),
    offer: state.round?.offer || null,
  };
}

async function persistRound(store, context, questionId, userId, state, change) {
  if (!state.round) {
    const record = createRelationshipRecord({ relationshipId: context.relationship.id, userId, visibility: "shared", aiAccessScope: "none", approvalPolicy: "both", kind: ROUND, questionId, provenanceSource: "play_card" });
    record.id = roundId(context.relationship.id, questionId);
    change(record);
    await store.createRelationshipRecord("proposals", record);
    return record;
  }
  return store.updateRelationshipRecordForUser("proposals", state.round.id, userId, (record) => {
    change(record);
    record.version++;
  });
}

async function persistVote(store, context, questionId, userId, previous, ideaIds) {
  if (!previous) {
    const record = createRelationshipRecord({ relationshipId: context.relationship.id, userId, visibility: "private", aiAccessScope: "none", approvalPolicy: "owner", kind: VOTE, questionId, ideaIds, provenanceSource: "play_card" });
    record.id = voteId(context.relationship.id, questionId, userId);
    await store.createRelationshipRecord("proposals", record);
    return record;
  }
  return store.updateRelationshipRecordForUser("proposals", previous.id, userId, (draft) => {
    draft.ideaIds = ideaIds;
    draft.version++;
  });
}

function validSchedule(input) {
  const { date, time = "", timezone } = input;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || conversationDay(date + "T12:00:00Z") !== date ||
      typeof timezone !== "string" || !timezone || timezone.length > 64 || (time && (typeof time !== "string" || !/^\d{2}:\d{2}$/.test(time)))) throw decisionError(400, "invalid_date");
  const today = conversationDay(Date.now(), timezone);
  if (!today) throw decisionError(400, "invalid_date");
  if (date < today) throw decisionError(409, "date_passed");
  let dueAt = null;
  if (time) {
    try { dueAt = localDateTimeToInstant(date + "T" + time, timezone); }
    catch { throw decisionError(400, "invalid_time"); }
    if (Date.parse(dueAt) <= Date.now()) throw decisionError(409, "date_passed");
  }
  return { date, time, timezone, dueAt };
}

function matchesInput(offer, body) {
  return offer?.ideaId === body.ideaId && offer.date === body.date && offer.time === (body.time || "") && offer.timezone === body.timezone;
}

async function mutate(store, context, state, userId, body, language) {
  const questionId = state.question.id, offer = state.round?.offer;
  const pending = offer?.status === "pending", confirmed = offer?.status === "confirmed";

  if (body.action === "save_picks") {
    if (pending || confirmed) throw decisionError(409, "plan_locked");
    if (!Array.isArray(body.ideaIds) || body.ideaIds.length > state.ideas.length || body.ideaIds.some((id) => !state.ideas.some((idea) => idea.id === id))) throw decisionError(400, "invalid_picks");
    const picks = [...new Set(body.ideaIds)].sort();
    const own = state.votes.find((vote) => vote.ownerUserId === userId);
    if (own && sameList(own.ideaIds, picks)) return { state };
    const updated = await persistVote(store, context, questionId, userId, own, picks);
    return { state: { ...state, votes: [...state.votes.filter((vote) => vote.ownerUserId !== userId), updated] }, changed: true };
  }

  if (body.action === "add_idea") {
    const title = typeof body.title === "string" ? body.title.replace(/[\p{C}\s]+/gu, " ").trim() : "";
    if (!title || title.length > 80) throw decisionError(400, "invalid_idea");
    if (state.round?.customTitle === title) return { state };
    if (state.round?.customTitle || pending || confirmed) throw decisionError(409, "plan_locked");
    const round = await persistRound(store, context, questionId, userId, state, (record) => { record.customTitle = title; });
    return { state: { ...state, round, ideas: ideasFor(state.question, context.members, title) }, changed: true };
  }

  if (body.action === "propose") {
    if (pending && offer.proposedBy === userId && matchesInput(offer, body)) return { state };
    if (pending || confirmed || body.version !== (state.round?.version || 0)) throw decisionError(409, "stale_version");
    const idea = state.ideas.find((option) => option.id === body.ideaId && matchIds(state).includes(option.id));
    if (!idea) throw decisionError(409, "pick_together");
    const times = validSchedule(body);
    const next = { ...times, ideaId: idea.id, title: titleFor(idea, language), status: "pending", proposedBy: userId };
    const round = await persistRound(store, context, questionId, userId, state, (record) => { record.offer = next; });
    return { state: { ...state, round }, changed: true, invited: true };
  }

  if (body.action === "accept" && confirmed && offer.acceptedBy === userId && body.version === state.round.version - 1) return { state };
  if (body.action === "decline" && offer?.status === "declined" && offer.settledBy === userId && body.version === state.round.version - 1) return { state };
  if (body.action === "cancel" && offer?.status === "cancelled" && offer.settledBy === userId && body.version === state.round.version - 1) return { state };
  if (!pending || body.version !== state.round.version) throw decisionError(409, "stale_version");
  if (body.action === "cancel" && offer.proposedBy === userId || body.action === "decline" && offer.proposedBy !== userId) {
    const status = body.action === "cancel" ? "cancelled" : "declined";
    const round = await persistRound(store, context, questionId, userId, state, (record) => {
      record.offer = { ...offer, status, settledBy: userId };
    });
    return { state: { ...state, round }, changed: true };
  }
  if (body.action !== "accept" || offer.proposedBy === userId) throw decisionError(403, "not_allowed");
  const schedule = validSchedule(offer);
  const milestone = createRelationshipRecord({
    relationshipId: context.relationship.id, userId: offer.proposedBy, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both",
    type: "custom", title: offer.title, date: schedule.date, timezone: schedule.timezone,
    localDateTime: schedule.time ? schedule.date + "T" + schedule.time : null, dueAt: schedule.dueAt,
    recurringRule: "once", jointlyConfirmed: true, confirmedBy: [offer.proposedBy, userId],
    sourceQuestionId: questionId, sourcePlayPlanId: state.round.id, provenanceSource: "play_card",
  });
  await store.createRelationshipRecord("milestones", milestone);
  const round = await persistRound(store, context, questionId, userId, state, (record) => {
    record.offer = { ...offer, status: "confirmed", acceptedBy: userId, milestoneId: milestone.id, calendarUrl: CALENDAR };
  });
  await audit(store, milestone, offer.proposedBy, "milestone.play_proposed");
  await audit(store, milestone, userId, "milestone.play_accepted");
  const i18n = togetherI18n((locale) => labels(
    "你们确认的计划已经放进共同日历。",
    "The plan you both confirmed is on your shared calendar.",
    "El plan que confirmaron ya está en su calendario compartido.",
  )[locale]);
  const { conversation } = await appendTogetherMessage(store, {
    relationshipId: context.relationship.id, userId, actorUserId: null, source: "app", kind: "text", text: i18n.zh, i18n,
    refs: [{ type: "milestone", id: milestone.id, version: milestone.version, title: milestone.title }],
    handle: "play-calendar:" + milestone.id,
  });
  return { state: { ...state, round }, changed: true, conversation };
}

const errorLabels = {
  not_found: labels("这张卡还没揭晓或已无法查看。", "This card has not been revealed or is no longer available.", "Esta carta aún no se ha revelado o ya no está disponible."),
  pairing_required: labels("需要有效的伴侣配对。", "An active pairing is required.", "Se necesita una pareja activa."),
  stale_version: labels("计划刚刚有变化，刷新后再试。", "The plan just changed. Refresh and try again.", "El plan acaba de cambiar. Actualiza e inténtalo de nuevo."),
  invalid_date: labels("选一个有效的日期。", "Select a valid date.", "Elige una fecha válida."),
  invalid_time: labels("当地时间无效，请换个时间。", "Choose another time in your local time zone.", "Elige otra hora en tu zona horaria."),
  date_passed: labels("这个时间已过，请选新的时间。", "That time has passed. Choose a new one.", "Esa hora ya pasó. Elige otra."),
  pick_together: labels("先找到你们都想做的一件事。", "Find something you both want to do first.", "Primero encuentren algo que ambos quieran hacer."),
  plan_locked: labels("这轮选择已锁定。", "This round is locked.", "Esta ronda está cerrada."),
  invalid_idea: labels("写一个 80 字以内的点子。", "Enter an idea under 80 characters.", "Escribe una idea de hasta 80 caracteres."),
};

export function createPlayPlansRouter({ store, emit = () => {}, notify = () => {} }) {
  const router = express.Router();
  const handle = (action) => async (req, res) => {
    const preferred = req.body?.language || req.query?.language || req.auth?.user?.language;
    const language = supported.has(preferred) ? preferred : "zh";
    const userId = req.auth?.user?.id;
    res.set("Cache-Control", "private, no-store");
    if (!userId) return res.status(401).json({ error: labels("请先登录。", "Please sign in first.", "Inicia sesión primero.")[language] });
    try {
      const context = await store.getRelationshipContext(userId);
      if (!activePair(context)) throw decisionError(409, "pairing_required");
      res.json(await action(req, context, userId, language));
    } catch (error) {
      res.status(error.statusCode || 500).json({ code: error.decisionCode, error: (errorLabels[error.decisionCode] ||
        labels("计划暂时无法更新，请重试。", "Couldn't update the plan. Try again.", "No se pudo actualizar el plan. Inténtalo de nuevo."))[language] });
    }
  };
  router.get("/play-plans", handle(async (req, context, userId, language) => {
    const rounds = await store.listRelationshipRecordsForUser("proposals", userId);
    const pending = rounds.filter((record) => record.kind === ROUND && record.relationshipId === context.relationship.id && record.offer?.status === "pending")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const questionId = pending?.questionId || req.query.questionId;
    return { plan: questionId ? view(await readState(store, context, questionId, userId), userId, language) : null };
  }));
  router.get("/play-plans/:questionId", handle(async (req, context, userId, language) => ({
    plan: view(await readState(store, context, req.params.questionId, userId), userId, language),
  })));
  router.post("/play-plans/:questionId", handle(async (req, context, userId, language) => {
    const questionId = req.params.questionId;
    const result = await store.transaction("relationship:" + context.relationship.id, async (tx) => {
      const current = await tx.getRelationshipContext(userId);
      if (!activePair(current) || current.relationship.id !== context.relationship.id) throw decisionError(409, "pairing_required");
      return mutate(tx, current, await readState(tx, current, questionId, userId), userId, req.body || {}, language);
    });
    if (result.changed) {
      emit({ id: questionId, relationshipId: context.relationship.id, version: Date.now() }, "play.plans.updated");
      if (result.conversation) emit(result.conversation, "together.updated", null, userId);
      if (result.invited) {
        const partner = context.members.find((member) => member.userId !== userId);
        if (partner) void Promise.resolve().then(() => notify(partner.userId, {
          body: labels("你有一个时间可以确认。", "You have a proposed time to review.", "Tienes una hora propuesta para revisar."),
          url: "/?channel=us&play=today",
          tag: "play-plan-" + questionId,
        })).catch(() => {});
      }
    }
    return { plan: view(result.state, userId, language) };
  }));
  return router;
}
