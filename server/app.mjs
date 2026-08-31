import { randomInt, randomUUID } from "node:crypto";
import express from "express";
import helmet from "helmet";
import {
  clearSessionCookie,
  createUser,
  hashPassword,
  issueSession,
  normalizeEmail,
  publicUser,
  readSessionToken,
  sessionId,
  setSessionCookie,
  validEmail,
  validPassword,
  verifyPassword,
} from "./auth.mjs";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const PERSONALITIES = new Set(["friend", "counselor", "direct"]);
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const loginAttempts = new Map();

export function createApiApp({ store, mediator, production = false }) {
  const app = express();
  const eventClients = new Map();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use((req, res, next) => {
    if (production && req.headers["x-forwarded-proto"] !== "https") return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
    next();
  });

  app.get("/api/health", async (_req, res) => {
    try {
      await store.ping();
      res.json({ ok: true, aiReady: mediator.aiReady, model: mediator.model, audioPersistence: "none", storage: store.kind });
    } catch {
      res.status(503).json({ ok: false, error: "storage_unavailable" });
    }
  });

  app.post("/api/rooms/:code/audio", express.raw({ type: () => true, limit: "24mb" }), async (req, res) => {
    try {
      if (!sameOriginRequest(req)) return res.status(403).json({ error: "请求来源未通过安全检查。" });
      const viewer = await authenticateRequest(store, req);
      if (!viewer) return res.status(401).json({ error: "请先登录。" });
      const code = normalizeCode(req.params.code);
      const room = await store.getRoomForUser(code, viewer.user.id);
      if (!room) return res.status(404).json({ error: "没有找到这个调解房间。" });
      if (room.status !== "active") return res.status(409).json({ error: "这次调解已经归档。" });
      if (!room.participants.some((participant) => participant.userId === viewer.user.id)) return res.status(403).json({ error: "请先加入这个房间。" });
      if (!Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ error: "没有收到有效录音。" });

      const transcript = await mediator.transcribe(req.body, req.headers["content-type"] || "audio/webm");
      const additions = mapTranscriptToMessages(room, viewer.user.id, transcript.segments, transcript.text);
      await store.updateRoomForUser(code, viewer.user.id, (draft) => {
        draft.messages.push(...additions);
        draft.safety = mergeSafety(draft.safety, additions.map((message) => message.text).join(" "));
      });
      broadcastRoom(code);
      res.json({ messagesAdded: additions.length, transcriptDeleted: true, room: publicRoom(await store.getRoomForUser(code, viewer.user.id), viewer.user.id) });
    } catch (error) {
      res.status(error?.statusCode || 500).json({ error: error?.message || "语音转录失败。" });
    }
  });

  app.use(express.json({ limit: "256kb" }));
  app.use((req, res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method) || !req.path.startsWith("/api/")) return next();
    return sameOriginRequest(req) ? next() : res.status(403).json({ error: "请求来源未通过安全检查。" });
  });
  app.use(async (req, _res, next) => {
    try { req.auth = await authenticateRequest(store, req); next(); }
    catch (error) { next(error); }
  });

  app.post("/api/auth/register", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const name = cleanName(req.body?.name, "我");
    const password = req.body?.password;
    if (!validEmail(email)) return res.status(400).json({ error: "请输入有效邮箱。" });
    if (!validPassword(password)) return res.status(400).json({ error: "密码需要 10–128 个字符。" });
    const user = createUser({ email, name, passwordHash: await hashPassword(password) });
    const created = await store.createUser(user);
    if (!created) return res.status(409).json({ error: "这个邮箱已经注册。" });
    const { token } = await issueSession(store, created.id);
    setSessionCookie(res, token, production);
    res.status(201).json(await appState(store, created));
  });

  app.post("/api/auth/login", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const key = `${req.ip}:${email}`;
    if (isRateLimited(key)) return res.status(429).json({ error: "尝试次数过多，请稍后再试。" });
    const user = await store.getUserByEmail(email);
    const valid = await verifyPassword(String(req.body?.password || ""), user?.passwordHash || "scrypt$16384$YQ$YQ");
    if (!user || !valid) { recordFailedAttempt(key); return res.status(401).json({ error: "邮箱或密码不正确。" }); }
    loginAttempts.delete(key);
    const { token } = await issueSession(store, user.id);
    setSessionCookie(res, token, production);
    res.json(await appState(store, user));
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.auth) return res.json({ user: null, pairing: null });
    res.json(await appState(store, req.auth.user));
  });

  app.post("/api/auth/logout", async (req, res) => {
    if (req.auth) await store.deleteSession(req.auth.session.id);
    clearSessionCookie(res, production);
    res.status(204).end();
  });

  app.post("/api/partner/invitations", requireAuth, async (req, res) => {
    const existing = await store.getRelationshipContext(req.auth.user.id);
    if (existing) return res.json({ pairing: publicPairing(existing, req.auth.user.id) });
    const now = new Date();
    const relationship = { id: randomUUID(), status: "pending", createdAt: now.toISOString(), updatedAt: now.toISOString() };
    const membership = { relationshipId: relationship.id, userId: req.auth.user.id, role: "A", joinedAt: now.toISOString() };
    const invitation = {
      code: await createUniqueCode(store, 8, "invitation"), relationshipId: relationship.id, createdByUserId: req.auth.user.id,
      createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(), acceptedAt: null, acceptedByUserId: null,
    };
    const context = await store.createInvitation({ relationship, membership, invitation });
    if (!context) return res.status(409).json({ error: "当前账号已经属于一个共同空间。" });
    res.status(201).json({ pairing: publicPairing(context, req.auth.user.id) });
  });

  app.post("/api/partner/accept", requireAuth, async (req, res) => {
    const code = normalizeLongCode(req.body?.code);
    const context = await store.acceptInvitation(code, req.auth.user.id, new Date().toISOString());
    if (!context) return res.status(409).json({ error: "邀请无效、已过期，或当前账号已经绑定伴侣。" });
    res.json({ pairing: publicPairing(context, req.auth.user.id) });
  });

  app.get("/api/rooms", requireAuth, async (req, res) => {
    const active = await store.listRoomsForUser(req.auth.user.id, "active");
    res.json({ rooms: active.map((room) => roomSummary(room, req.auth.user.id)) });
  });

  app.post("/api/rooms", requireAuth, async (req, res) => {
    const pairing = await store.getRelationshipContext(req.auth.user.id);
    if (!pairing || pairing.relationship.status !== "active" || pairing.members.length !== 2) return res.status(409).json({ error: "需要先由双方账号加入共同空间。" });
    const mode = req.body?.mode === "shared" ? "shared" : "remote";
    const language = req.body?.language === "en" ? "en" : "zh";
    const personality = PERSONALITIES.has(req.body?.personality) ? req.body.personality : "friend";
    const code = await createUniqueCode(store, 6, "room");
    const participants = pairing.members
      .filter((member) => mode === "shared" || member.userId === req.auth.user.id)
      .map((member) => createParticipant(member.user, member.role));
    const now = new Date().toISOString();
    const room = {
      code, relationshipId: pairing.relationship.id, creatorUserId: req.auth.user.id, mode, language, personality, participants,
      messages: [], analysis: null, analyzing: false, status: "active", archivedAt: null,
      archiveConfirmation: { userIds: [], requestedAt: null, completedAt: null },
      safety: { level: 0, message: language === "en" ? "Conversation is within the mediation boundary." : "对话仍在可调解边界内。" },
      createdAt: now, updatedAt: now,
    };
    await store.createRoom(room);
    res.status(201).json({ room: publicRoom(room, req.auth.user.id) });
  });

  app.post("/api/rooms/:code/join", requireAuth, async (req, res) => {
    const code = normalizeCode(req.params.code);
    const pairing = await store.getRelationshipContext(req.auth.user.id);
    const room = await store.getRoomForUser(code, req.auth.user.id);
    if (!room || !pairing) return res.status(404).json({ error: "这个房间不属于你们的共同空间。" });
    if (room.status !== "active") return res.status(409).json({ error: "这次调解已经归档。" });
    if (room.mode !== "remote") return res.status(409).json({ error: "同设备房间不需要加入。" });
    const member = pairing.members.find((candidate) => candidate.userId === req.auth.user.id);
    await store.updateRoomForUser(code, req.auth.user.id, (draft) => {
      if (!draft.participants.some((participant) => participant.userId === req.auth.user.id)) draft.participants.push(createParticipant(member.user, member.role));
    });
    broadcastRoom(code);
    res.json({ room: publicRoom(await store.getRoomForUser(code, req.auth.user.id), req.auth.user.id) });
  });

  app.get("/api/rooms/:code", requireAuth, async (req, res) => {
    const room = await store.getRoomForUser(normalizeCode(req.params.code), req.auth.user.id);
    if (!room) return res.status(404).json({ error: "这个房间不属于你们的共同空间。" });
    res.json({ room: publicRoom(room, req.auth.user.id) });
  });

  app.get("/api/rooms/:code/events", requireAuth, async (req, res) => {
    const code = normalizeCode(req.params.code);
    const room = await store.getRoomForUser(code, req.auth.user.id);
    if (!room) return res.status(404).end();
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    registerClient(code, { res, userId: req.auth.user.id });
    sendEvent(res, publicRoom(room, req.auth.user.id));
    const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 20_000);
    req.on("close", () => { clearInterval(keepAlive); unregisterClient(code, res); });
  });

  app.post("/api/rooms/:code/messages", requireAuth, async (req, res) => {
    const code = normalizeCode(req.params.code);
    const room = await store.getRoomForUser(code, req.auth.user.id);
    if (!room) return res.status(404).json({ error: "这个房间不属于你们的共同空间。" });
    if (room.status !== "active") return res.status(409).json({ error: "这次调解已经归档。" });
    const text = cleanText(req.body?.text);
    if (!text) return res.status(400).json({ error: "请输入想说的话。" });
    const speaker = resolveSpeaker(room, req.auth.user.id, req.body?.speakerId);
    if (!speaker) return res.status(403).json({ error: "当前账号不能代表这位参与者发言。" });
    await store.updateRoomForUser(code, req.auth.user.id, (draft) => {
      draft.messages.push(createMessage(speaker.id, text, "text"));
      draft.safety = mergeSafety(draft.safety, text);
    });
    broadcastRoom(code);
    res.status(201).json({ room: publicRoom(await store.getRoomForUser(code, req.auth.user.id), req.auth.user.id) });
  });

  app.post("/api/rooms/:code/personality", requireAuth, async (req, res) => {
    const code = normalizeCode(req.params.code);
    const room = await store.getRoomForUser(code, req.auth.user.id);
    if (!room) return res.status(404).json({ error: "这个房间不属于你们的共同空间。" });
    if (!PERSONALITIES.has(req.body?.personality)) return res.status(400).json({ error: "未知的调解风格。" });
    await store.updateRoomForUser(code, req.auth.user.id, (draft) => { draft.personality = req.body.personality; });
    broadcastRoom(code);
    res.json({ room: publicRoom(await store.getRoomForUser(code, req.auth.user.id), req.auth.user.id) });
  });

  app.post("/api/rooms/:code/analyze", requireAuth, async (req, res) => {
    const code = normalizeCode(req.params.code);
    const room = await store.getRoomForUser(code, req.auth.user.id);
    if (!room) return res.status(404).json({ error: "这个房间不属于你们的共同空间。" });
    if (room.status !== "active") return res.status(409).json({ error: "这次调解已经归档。" });
    if (room.messages.length < 2) return res.status(400).json({ error: "至少需要两段表达，AI 才能提供有依据的视角。" });
    if (room.analyzing) return res.status(409).json({ error: "AI 已经在整理这次对话。" });
    await store.updateRoomForUser(code, req.auth.user.id, (draft) => { draft.analyzing = true; });
    broadcastRoom(code);
    try {
      const analysis = await mediator.analyze(await store.getRoomForUser(code, req.auth.user.id));
      await store.updateRoomForUser(code, req.auth.user.id, (draft) => {
        draft.analysis = analysis;
        draft.analyzing = false;
        if (analysis.safety?.level > draft.safety.level) draft.safety = analysis.safety;
      });
      broadcastRoom(code);
      res.json({ room: publicRoom(await store.getRoomForUser(code, req.auth.user.id), req.auth.user.id) });
    } catch (error) {
      await store.updateRoomForUser(code, req.auth.user.id, (draft) => { draft.analyzing = false; });
      broadcastRoom(code);
      res.status(500).json({ error: error?.message || "AI 暂时无法完成分析。" });
    }
  });

  app.post("/api/rooms/:code/confirm-archive", requireAuth, async (req, res) => {
    const code = normalizeCode(req.params.code);
    const room = await store.getRoomForUser(code, req.auth.user.id);
    const pairing = await store.getRelationshipContext(req.auth.user.id);
    if (!room || !pairing) return res.status(404).json({ error: "这个房间不属于你们的共同空间。" });
    if (!room.analysis) return res.status(409).json({ error: "先完成一次共同反馈，才能归档复盘。" });
    if (room.status === "archived") return res.json({ room: publicRoom(room, req.auth.user.id) });
    const requiredIds = pairing.members.map((member) => member.userId);
    await store.updateRoomForUser(code, req.auth.user.id, (draft) => {
      if (!draft.archiveConfirmation.userIds.includes(req.auth.user.id)) draft.archiveConfirmation.userIds.push(req.auth.user.id);
      draft.archiveConfirmation.requestedAt ||= new Date().toISOString();
      if (requiredIds.every((id) => draft.archiveConfirmation.userIds.includes(id))) {
        draft.status = "archived";
        draft.archivedAt = new Date().toISOString();
        draft.archiveConfirmation.completedAt = draft.archivedAt;
      }
    });
    broadcastRoom(code);
    res.json({ room: publicRoom(await store.getRoomForUser(code, req.auth.user.id), req.auth.user.id) });
  });

  app.get("/api/history", requireAuth, async (req, res) => {
    const rooms = await store.listRoomsForUser(req.auth.user.id, "archived");
    res.json({ items: rooms.map(historySummary) });
  });

  app.get("/api/history/:code", requireAuth, async (req, res) => {
    const room = await store.getRoomForUser(normalizeCode(req.params.code), req.auth.user.id);
    if (!room || room.status !== "archived") return res.status(404).json({ error: "没有找到这份复盘。" });
    res.json({ item: historyDetail(room) });
  });

  function broadcastRoom(code) {
    for (const client of eventClients.get(code) || []) {
      Promise.resolve(store.getRoomForUser(code, client.userId)).then((room) => { if (room) sendEvent(client.res, publicRoom(room, client.userId)); }).catch(() => {});
    }
  }
  function registerClient(code, client) { if (!eventClients.has(code)) eventClients.set(code, new Set()); eventClients.get(code).add(client); }
  function unregisterClient(code, response) {
    const clients = eventClients.get(code); if (!clients) return;
    for (const client of clients) if (client.res === response) clients.delete(client);
    if (!clients.size) eventClients.delete(code);
  }

  return app;
}

function requireAuth(req, res, next) { return req.auth ? next() : res.status(401).json({ error: "请先登录。" }); }

function sameOriginRequest(req) {
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

async function authenticateRequest(store, req) {
  const token = readSessionToken(req);
  if (!token) return null;
  const session = await store.getSession(sessionId(token));
  if (!session) return null;
  const user = await store.getUserById(session.userId);
  return user ? { user, session } : null;
}

async function appState(store, user) {
  const pairing = await store.getRelationshipContext(user.id);
  return { user: publicUser(user), pairing: publicPairing(pairing, user.id) };
}

function publicPairing(context, viewerId) {
  if (!context) return null;
  return {
    id: context.relationship.id,
    status: context.relationship.status,
    role: context.membership.role,
    members: context.members.map((member) => ({ id: member.user.id, name: member.user.name, role: member.role, joinedAt: member.joinedAt })),
    invitation: context.invitation?.createdByUserId === viewerId ? { code: context.invitation.code, expiresAt: context.invitation.expiresAt } : null,
  };
}

function sendEvent(res, room) { res.write(`event: room\ndata: ${JSON.stringify(room)}\n\n`); }

function publicRoom(room, viewerUserId) {
  const viewer = room.participants.find((participant) => participant.userId === viewerUserId) || null;
  const privateFeedback = room.analysis && viewer ? { [viewer.id]: room.analysis.private?.[viewer.id] } : null;
  return {
    code: room.code, mode: room.mode, language: room.language, personality: room.personality, status: room.status,
    participants: room.participants.map(({ userId: _userId, ...participant }) => participant), messages: room.messages,
    analyzing: room.analyzing, safety: room.safety, sharedAnalysis: room.analysis?.shared || null, privateFeedback,
    analysisMeta: room.analysis ? { id: room.analysis.id, source: room.analysis.source, model: room.analysis.model, generatedAt: room.analysis.generatedAt, notice: room.analysis.notice } : null,
    currentParticipantId: viewer?.id || null,
    canControlAllSpeakers: room.mode === "shared" && room.creatorUserId === viewerUserId,
    confirmation: {
      confirmedByCurrent: room.archiveConfirmation.userIds.includes(viewerUserId),
      confirmedCount: room.archiveConfirmation.userIds.length,
      requiredCount: 2,
      complete: room.status === "archived",
    },
    createdAt: room.createdAt, updatedAt: room.updatedAt, archivedAt: room.archivedAt,
  };
}

function roomSummary(room, viewerUserId) {
  return { code: room.code, mode: room.mode, status: room.status, participantCount: room.participants.length, title: room.analysis?.shared?.title || "尚未生成共同反馈", updatedAt: room.updatedAt, joined: room.participants.some((participant) => participant.userId === viewerUserId) };
}
function historySummary(room) { return { code: room.code, title: room.analysis?.shared?.title || "一次共同复盘", category: room.analysis?.shared?.category || "communication", overview: room.analysis?.shared?.overview || "", archivedAt: room.archivedAt, commonGroundCount: room.analysis?.shared?.commonGround?.length || 0, differenceCount: room.analysis?.shared?.differences?.length || 0 }; }
function historyDetail(room) { return { ...historySummary(room), participants: room.participants.map(({ userId: _userId, ...participant }) => participant), messages: room.messages, sharedAnalysis: room.analysis?.shared || null, analysisMeta: room.analysis ? { source: room.analysis.source, model: room.analysis.model, generatedAt: room.analysis.generatedAt, notice: room.analysis.notice } : null }; }

function resolveSpeaker(room, viewerUserId, requestedId) {
  const viewer = room.participants.find((participant) => participant.userId === viewerUserId);
  if (!viewer) return null;
  if (room.mode === "shared" && room.creatorUserId === viewerUserId) return room.participants.find((participant) => participant.id === requestedId) || viewer;
  return viewer;
}

function mapTranscriptToMessages(room, viewerUserId, segments, fullText) {
  const viewer = room.participants.find((participant) => participant.userId === viewerUserId);
  const usableSegments = segments.filter((segment) => cleanText(segment.text));
  if (!usableSegments.length && cleanText(fullText)) return [createMessage(viewer.id, cleanText(fullText), "voice")];
  const labels = [...new Set(usableSegments.map((segment) => segment.speaker))];
  return usableSegments.map((segment) => {
    let participantId = viewer.id;
    if (room.mode === "shared" || labels.length > 1) participantId = room.participants[Math.max(0, labels.indexOf(segment.speaker))]?.id || viewer.id;
    return createMessage(participantId, cleanText(segment.text), "voice", { start: segment.start, end: segment.end, speakerLabel: segment.speaker });
  });
}

function createMessage(participantId, text, source, timing = null) { return { id: randomUUID(), participantId, text, source, timing, createdAt: new Date().toISOString() }; }
function createParticipant(user, role) { return { id: user.id, userId: user.id, name: user.name, role, joinedAt: new Date().toISOString() }; }

async function createUniqueCode(store, length, kind) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    let code = "";
    for (let index = 0; index < length; index += 1) code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
    const exists = kind === "room" ? await store.getRoomByCode(code) : await store.getInvitation(code);
    if (!exists) return code;
  }
  throw new Error("暂时无法生成安全邀请码，请重试。");
}

function normalizeCode(value) { return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6); }
function normalizeLongCode(value) { return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8); }
function cleanName(value, fallback) { return String(value || "").trim().replace(/[<>]/g, "").slice(0, 24) || fallback; }
function cleanText(value) { return String(value || "").trim().replace(/\0/g, "").slice(0, 1200); }

function isRateLimited(key) {
  const entry = loginAttempts.get(key);
  if (!entry || Date.now() - entry.startedAt > LOGIN_WINDOW_MS) return false;
  return entry.count >= 10;
}
function recordFailedAttempt(key) {
  const current = loginAttempts.get(key);
  if (!current || Date.now() - current.startedAt > LOGIN_WINDOW_MS) loginAttempts.set(key, { count: 1, startedAt: Date.now() });
  else current.count += 1;
}

function mergeSafety(current, text) {
  const normalized = text.toLowerCase();
  if (/杀了你|弄死你|打死你|砍死|自杀|不想活|kill you|hurt you|suicide|end my life/.test(normalized)) return { level: 3, message: "检测到可能的暴力或自伤风险。请立刻停止争论、拉开距离并优先联系可信任的人或当地紧急支持。AI 调解不适合继续处理当下风险。" };
  if (/废物|贱人|滚开|闭嘴|傻逼|操你|idiot|shut up|worthless/.test(normalized) && current.level < 2) return { level: 2, message: "对话里出现了人身攻击。先暂停，不评价人格，只描述具体行为和感受。" };
  if (/你总是|你从不|随便你|懒得说|always|never listen/.test(normalized) && current.level < 1) return { level: 1, message: "语气正在升级。建议一次只说一件事，并让对方完整说完。" };
  return current;
}
