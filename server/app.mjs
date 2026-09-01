import { randomBytes, randomInt, randomUUID } from "node:crypto";
import express from "express";
import helmet from "helmet";
import {
  clearSessionCookie,
  clearDemoCookie,
  createUser,
  hashPassword,
  issueSession,
  normalizeEmail,
  publicUser,
  readDemoToken,
  readSessionToken,
  sessionId,
  setSessionCookie,
  setDemoCookie,
  validEmail,
  validPassword,
  verifyPassword,
} from "./auth.mjs";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const PERSONALITIES = new Set(["friend", "counselor", "direct"]);
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const loginAttempts = new Map();
const DEMO_CREATE_WINDOW_MS = 10 * 60 * 1000;
const DEMO_JOIN_WINDOW_MS = 15 * 60 * 1000;
const DEMO_ROOM_MS = 60 * 60 * 1000;
const demoCreates = new Map();

export function createApiApp({ store, mediator, production = false }) {
  const app = express();
  const eventClients = new Map();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use((req, res, next) => {
    res.setHeader("Permissions-Policy", "microphone=(self), camera=()");
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

  app.post("/api/rooms/:code/realtime", express.text({ type: "application/sdp", limit: "128kb" }), async (req, res) => {
    try {
      if (!sameOriginRequest(req)) return res.status(403).json({ error: "请求来源未通过安全检查。" });
      const viewer = await authenticateRequest(store, req);
      if (!viewer) return res.status(401).json({ error: "请先登录。" });
      const code = normalizeCode(req.params.code);
      const room = await store.getRoomForUser(code, viewer.user.id);
      if (!room) return res.status(404).json({ error: "没有找到这个调解房间。" });
      if (room.status !== "active") return res.status(409).json({ error: "这次调解已经归档。" });
      if (!room.participants.some((participant) => participant.userId === viewer.user.id)) return res.status(403).json({ error: "请先加入这个房间。" });
      if (typeof req.body !== "string" || !req.body.includes("v=0")) return res.status(400).json({ error: "没有收到有效的实时语音连接信息。" });
      const answer = await mediator.createRealtimeSession({ sdp: req.body, language: room.language, safetyIdentifier: sessionId(viewer.user.id) });
      res.type("application/sdp").send(answer);
    } catch (error) {
      res.status(error?.statusCode || 500).json({ error: error?.message || "实时语音暂时不可用。" });
    }
  });

  app.post("/api/demo/rooms/:code/realtime", express.text({ type: "application/sdp", limit: "128kb" }), async (req, res) => {
    try {
      if (!sameOriginRequest(req)) return res.status(403).json({ error: "请求来源未通过安全检查。" });
      const code = normalizeLongCode(req.params.code);
      const room = await store.getDemoRoom(code);
      const actor = demoActor(room, readDemoToken(req));
      if (!room || !actor) return res.status(404).json({ error: "临时房间不存在、已过期，或你没有访问权限。" });
      if (!allDemoParticipantsConsented(room)) return res.status(409).json({ error: "双方同意录音与转录后才能开始表达。" });
      if (typeof req.body !== "string" || !req.body.includes("v=0")) return res.status(400).json({ error: "没有收到有效的实时语音连接信息。" });
      const answer = await mediator.createRealtimeSession({ sdp: req.body, language: room.language, safetyIdentifier: sessionId(actor.participant.id) });
      res.type("application/sdp").send(answer);
    } catch (error) {
      res.status(error?.statusCode || 500).json({ error: error?.message || "实时语音暂时不可用。" });
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
      const requestedSpeakerId = String(req.headers["x-toward-us-speaker-id"] || "");
      const selectedSpeaker = resolveSpeaker(room, viewer.user.id, requestedSpeakerId);
      const additions = mapTranscriptToMessages(room, viewer.user.id, transcript.segments, transcript.text, selectedSpeaker?.id || null, Boolean(requestedSpeakerId));
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

  app.post("/api/demo/rooms/:code/audio", express.raw({ type: () => true, limit: "12mb" }), async (req, res) => {
    try {
      if (!sameOriginRequest(req)) return res.status(403).json({ error: "请求来源未通过安全检查。" });
      const code = normalizeLongCode(req.params.code);
      await store.deleteExpiredDemoRooms(new Date().toISOString());
      const room = await store.getDemoRoom(code);
      const actor = demoActor(room, readDemoToken(req));
      if (!room || !actor) return res.status(404).json({ error: "临时房间不存在、已过期，或你没有访问权限。" });
      if (room.status !== "active") return res.status(409).json({ error: "这个临时体验已经结束。" });
      if (!allDemoParticipantsConsented(room)) return res.status(409).json({ error: "双方同意录音后才能开始表达。" });
      if (!Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ error: "没有收到有效录音。" });
      if (room.messages.length >= 30) return res.status(429).json({ error: "本次快速体验已达到表达上限。" });

      const transcript = await mediator.transcribe(req.body, req.headers["content-type"] || "audio/webm");
      const requestedSpeakerId = String(req.headers["x-toward-us-speaker-id"] || "");
      const selectedSpeaker = resolveDemoSpeaker(room, actor, requestedSpeakerId);
      const additions = mapDemoTranscriptToMessages(room, actor.participant.id, transcript.segments, transcript.text, selectedSpeaker?.id || null, Boolean(requestedSpeakerId));
      await store.updateDemoRoom(code, (draft) => {
        draft.messages.push(...additions.slice(0, Math.max(0, 30 - draft.messages.length)));
        draft.safety = mergeSafety(draft.safety, additions.map((message) => message.text).join(" "));
      });
      broadcastDemoRoom(code);
      const updated = await store.getDemoRoom(code);
      res.json({ messagesAdded: additions.length, transcriptDeleted: true, room: publicDemoRoom(updated, actor.participant.id, null) });
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

  app.post("/api/demo/rooms", async (req, res) => {
    await store.deleteExpiredDemoRooms(new Date().toISOString());
    if (isDemoCreateLimited(req.ip)) return res.status(429).json({ error: "这台设备创建临时房间过于频繁，请稍后再试。" });
    const mode = req.body?.mode === "shared" ? "shared" : "remote";
    const language = req.body?.language === "en" ? "en" : "zh";
    const nameA = cleanName(req.body?.nameA, language === "en" ? "Me" : "我");
    const nameB = mode === "shared" ? cleanName(req.body?.nameB, language === "en" ? "Partner" : "TA") : null;
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const code = await createUniqueDemoCode(store);
    const host = createDemoParticipant(nameA, "A", sessionId(token), now.toISOString());
    const participants = [host];
    if (nameB) participants.push(createDemoParticipant(nameB, "B", null, now.toISOString()));
    const room = {
      kind: "demo", code, mode, language, personality: "friend", creatorParticipantId: host.id,
      participants, messages: [], analysis: null, aiConversation: [], analyzing: false, analysisCount: 0, status: "active",
      claims: {}, convertedAt: null, convertedRoomCode: null,
      safety: { level: 0, message: language === "en" ? "Conversation is within the mediation boundary." : "对话仍在可调解边界内。" },
      joinExpiresAt: new Date(now.getTime() + DEMO_JOIN_WINDOW_MS).toISOString(),
      expiresAt: new Date(now.getTime() + DEMO_ROOM_MS).toISOString(), createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    await store.createDemoRoom(room);
    recordDemoCreate(req.ip);
    setDemoCookie(res, token, production);
    res.status(201).json({ room: publicDemoRoom(room, host.id, req.auth?.user?.id || null) });
  });

  app.get("/api/demo/rooms/:code/preview", async (req, res) => {
    await store.deleteExpiredDemoRooms(new Date().toISOString());
    const room = await store.getDemoRoom(normalizeLongCode(req.params.code));
    if (!room || room.status !== "active") return res.status(404).json({ error: "这个临时房间不存在或已经结束。" });
    res.json({ room: { code: room.code, mode: room.mode, language: room.language, participantCount: room.participants.length, joinExpiresAt: room.joinExpiresAt, joinOpen: room.mode === "remote" && room.participants.length < 2 && room.joinExpiresAt > new Date().toISOString() } });
  });

  app.post("/api/demo/rooms/:code/join", async (req, res) => {
    await store.deleteExpiredDemoRooms(new Date().toISOString());
    const code = normalizeLongCode(req.params.code);
    const token = randomBytes(32).toString("base64url");
    const accessHash = sessionId(token);
    const now = new Date().toISOString();
    let joinedParticipant = null;
    try {
      const updated = await store.updateDemoRoom(code, (draft) => {
        if (draft.status !== "active" || draft.mode !== "remote" || draft.participants.length >= 2 || draft.joinExpiresAt <= now) throw httpError(409, "房间已满、已过期，或不接受第二台设备加入。");
        joinedParticipant = createDemoParticipant(cleanName(req.body?.name, draft.language === "en" ? "Partner" : "TA"), "B", accessHash, now);
        draft.participants.push(joinedParticipant);
      });
      if (!updated) return res.status(404).json({ error: "这个临时房间不存在或已经过期。" });
      setDemoCookie(res, token, production);
      broadcastDemoRoom(code);
      res.json({ room: publicDemoRoom(updated, joinedParticipant.id, req.auth?.user?.id || null) });
    } catch (error) {
      res.status(error?.statusCode || 500).json({ error: error?.message || "暂时无法加入房间。" });
    }
  });

  app.get("/api/demo/rooms/:code", async (req, res) => {
    await store.deleteExpiredDemoRooms(new Date().toISOString());
    const room = await store.getDemoRoom(normalizeLongCode(req.params.code));
    const actor = demoActor(room, readDemoToken(req));
    if (!room || !actor) return res.status(404).json({ error: "临时房间不存在、已过期，或你没有访问权限。" });
    res.json({ room: publicDemoRoom(room, actor.participant.id, req.auth?.user?.id || null) });
  });

  app.get("/api/demo/rooms/:code/events", async (req, res) => {
    const code = normalizeLongCode(req.params.code);
    const room = await store.getDemoRoom(code);
    const actor = demoActor(room, readDemoToken(req));
    if (!room || !actor) return res.status(404).end();
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    registerClient(`demo:${code}`, { res, participantId: actor.participant.id, demo: true });
    sendEvent(res, publicDemoRoom(room, actor.participant.id, req.auth?.user?.id || null));
    const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 20_000);
    req.on("close", () => { clearInterval(keepAlive); unregisterClient(`demo:${code}`, res); });
  });

  app.post("/api/demo/rooms/:code/consent", async (req, res) => {
    const code = normalizeLongCode(req.params.code);
    const room = await store.getDemoRoom(code);
    const actor = demoActor(room, readDemoToken(req));
    if (!room || !actor) return res.status(404).json({ error: "临时房间不存在、已过期，或你没有访问权限。" });
    const participantId = String(req.body?.participantId || actor.participant.id);
    if (!actor.canControlAll && participantId !== actor.participant.id) return res.status(403).json({ error: "每个人只能确认自己的录音同意。" });
    const updated = await store.updateDemoRoom(code, (draft) => {
      const participant = draft.participants.find((candidate) => candidate.id === participantId);
      if (!participant) throw httpError(404, "没有找到这位参与者。");
      participant.consentAt ||= new Date().toISOString();
    });
    broadcastDemoRoom(code);
    res.json({ room: publicDemoRoom(updated, actor.participant.id, req.auth?.user?.id || null) });
  });

  app.post("/api/demo/rooms/:code/messages", async (req, res) => {
    const code = normalizeLongCode(req.params.code);
    const room = await store.getDemoRoom(code);
    const actor = demoActor(room, readDemoToken(req));
    if (!room || !actor) return res.status(404).json({ error: "临时房间不存在、已过期，或你没有访问权限。" });
    if (room.status !== "active") return res.status(409).json({ error: "这个临时体验已经结束。" });
    if (!allDemoParticipantsConsented(room)) return res.status(409).json({ error: "双方同意录音与转录后才能开始表达。" });
    if (room.messages.length >= 30) return res.status(429).json({ error: "本次快速体验已达到表达上限。" });
    const text = cleanText(req.body?.text);
    if (!text) return res.status(400).json({ error: "请输入想说的话。" });
    const speaker = resolveDemoSpeaker(room, actor, req.body?.speakerId);
    if (!speaker) return res.status(403).json({ error: "当前设备不能代表这位参与者发言。" });
    const updated = await store.updateDemoRoom(code, (draft) => {
      draft.messages.push(createMessage(speaker.id, text, "text"));
      draft.safety = mergeSafety(draft.safety, text);
    });
    broadcastDemoRoom(code);
    res.status(201).json({ room: publicDemoRoom(updated, actor.participant.id, req.auth?.user?.id || null) });
  });

  app.post("/api/demo/rooms/:code/transcripts", async (req, res) => {
    const code = normalizeLongCode(req.params.code);
    const room = await store.getDemoRoom(code);
    const actor = demoActor(room, readDemoToken(req));
    if (!room || !actor) return res.status(404).json({ error: "临时房间不存在、已过期，或你没有访问权限。" });
    if (!allDemoParticipantsConsented(room)) return res.status(409).json({ error: "双方同意录音与转录后才能开始表达。" });
    const text = cleanText(req.body?.text);
    const itemId = cleanRealtimeItemId(req.body?.itemId);
    if (!text || !itemId) return res.status(400).json({ error: "实时转录缺少完整内容或语音片段标识。" });
    const speaker = resolveDemoSpeaker(room, actor, req.body?.speakerId);
    if (!speaker) return res.status(403).json({ error: "当前设备不能代表这位参与者发言。" });
    let created = false;
    const updated = await store.updateDemoRoom(code, (draft) => {
      if (draft.messages.some((message) => message.realtimeItemId === itemId)) return;
      if (draft.messages.length >= 30) throw httpError(429, "本次快速体验已达到表达上限。");
      draft.messages.push(createMessage(speaker.id, text, "voice", null, itemId));
      draft.safety = mergeSafety(draft.safety, text);
      created = true;
    });
    broadcastDemoRoom(code);
    res.status(created ? 201 : 200).json({ room: publicDemoRoom(updated, actor.participant.id, req.auth?.user?.id || null) });
  });

  app.post("/api/demo/rooms/:code/analyze", async (req, res) => {
    const code = normalizeLongCode(req.params.code);
    const room = await store.getDemoRoom(code);
    const actor = demoActor(room, readDemoToken(req));
    if (!room || !actor) return res.status(404).json({ error: "临时房间不存在、已过期，或你没有访问权限。" });
    if (!allDemoParticipantsConsented(room) || room.participants.length !== 2) return res.status(409).json({ error: "双方加入并确认同意后才能请 AI 加入。" });
    if (room.messages.length < 2) return res.status(400).json({ error: "至少需要两段表达，AI 才能提供有依据的视角。" });
    if (room.analysis) return res.json({ room: publicDemoRoom(room, actor.participant.id, req.auth?.user?.id || null) });
    if (room.analyzing) return res.status(409).json({ error: "AI 已经在整理这次对话。" });
    if (room.analysisCount >= 1) return res.status(429).json({ error: "每个快速体验房间可以生成一次 AI 调解。" });
    await store.updateDemoRoom(code, (draft) => { draft.analyzing = true; });
    broadcastDemoRoom(code);
    try {
      const analysis = await mediator.analyze(await store.getDemoRoom(code));
      const updated = await store.updateDemoRoom(code, (draft) => {
        draft.analysis = analysis;
        draft.analyzing = false;
        draft.analysisCount += 1;
        if (analysis.safety?.level > draft.safety.level) draft.safety = analysis.safety;
      });
      broadcastDemoRoom(code);
      res.json({ room: publicDemoRoom(updated, actor.participant.id, req.auth?.user?.id || null) });
    } catch (error) {
      await store.updateDemoRoom(code, (draft) => { draft.analyzing = false; });
      broadcastDemoRoom(code);
      res.status(500).json({ error: error?.message || "AI 暂时无法完成分析。" });
    }
  });

  app.post("/api/demo/rooms/:code/ask-ai", async (req, res) => {
    const code = normalizeLongCode(req.params.code);
    const room = await store.getDemoRoom(code);
    const actor = demoActor(room, readDemoToken(req));
    if (!room || !actor) return res.status(404).json({ error: "临时房间不存在、已过期，或你没有访问权限。" });
    if (!room.analysis) return res.status(409).json({ error: "请先邀请 AI 完成第一轮分析。" });
    const question = cleanText(req.body?.question);
    if (!question) return res.status(400).json({ error: "请输入想继续问 AI 的问题。" });
    if ((room.aiConversation || []).filter((entry) => entry.role === "user").length >= 6) return res.status(429).json({ error: "本次快速体验的 AI 追问已达到上限。" });
    const answer = await mediator.answer(room, question);
    const updated = await store.updateDemoRoom(code, (draft) => {
      draft.aiConversation ||= [];
      draft.aiConversation.push(
        { id: randomUUID(), role: "user", participantId: actor.participant.id, text: question, createdAt: new Date().toISOString() },
        { id: randomUUID(), role: "assistant", participantId: null, text: cleanText(answer), createdAt: new Date().toISOString() },
      );
    });
    broadcastDemoRoom(code);
    res.status(201).json({ room: publicDemoRoom(updated, actor.participant.id, req.auth?.user?.id || null) });
  });

  app.post("/api/demo/rooms/:code/claim", requireAuth, async (req, res) => {
    const code = normalizeLongCode(req.params.code);
    const room = await store.getDemoRoom(code);
    const actor = demoActor(room, readDemoToken(req));
    if (!room || !actor) return res.status(404).json({ error: "临时房间不存在、已过期，或你没有访问权限。" });
    if (!room.analysis) return res.status(409).json({ error: "完成 AI 共同反馈后才能保存。" });
    if (await store.getRelationshipContext(req.auth.user.id)) return res.status(409).json({ error: "这个账号已经属于另一个共同空间，不能再保存新的伴侣关系。" });
    if (Object.values(room.claims).some((userId) => userId === req.auth.user.id && room.claims[actor.participant.id] !== userId)) return res.status(409).json({ error: "同一个账号不能代表两位参与者。" });
    let updated = await store.updateDemoRoom(code, (draft) => { draft.claims[actor.participant.id] = req.auth.user.id; });
    if (Object.keys(updated.claims).length < 2) {
      broadcastDemoRoom(code);
      return res.json({ saved: false, room: publicDemoRoom(updated, actor.participant.id, req.auth.user.id), account: await appState(store, req.auth.user) });
    }

    const participants = updated.participants.slice(0, 2);
    const users = await Promise.all(participants.map((participant) => store.getUserById(updated.claims[participant.id])));
    if (users.some((user) => !user)) return res.status(409).json({ error: "双方账号状态不完整，请重新登录后再保存。" });
    const now = new Date().toISOString();
    const relationship = { id: randomUUID(), status: "active", createdAt: now, updatedAt: now };
    const memberships = participants.map((participant, index) => ({ relationshipId: relationship.id, userId: users[index].id, role: participant.role, joinedAt: now }));
    const regularCode = await createUniqueCode(store, 6, "room");
    const regularRoom = {
      code: regularCode, relationshipId: relationship.id, creatorUserId: users[0].id, mode: updated.mode, language: updated.language, personality: updated.personality,
      participants: participants.map((participant, index) => ({ id: participant.id, userId: users[index].id, name: participant.name, role: participant.role, joinedAt: participant.joinedAt })),
      messages: updated.messages, analysis: updated.analysis, aiConversation: updated.aiConversation || [], analyzing: false, status: "archived", archivedAt: now,
      archiveConfirmation: { userIds: users.map((user) => user.id), requestedAt: now, completedAt: now },
      safety: updated.safety, createdAt: updated.createdAt, updatedAt: now,
    };
    const finalized = await store.finalizeDemoRoom(code, { relationship, memberships, room: regularRoom, convertedAt: now });
    if (!finalized) return res.status(409).json({ error: "双方账号已发生变化，暂时无法保存这次体验。" });
    updated = finalized.demoRoom;
    broadcastDemoRoom(code);
    res.json({ saved: true, room: publicDemoRoom(updated, actor.participant.id, req.auth.user.id), account: await appState(store, req.auth.user), historyCode: regularCode });
  });

  app.post("/api/demo/logout", async (_req, res) => {
    clearDemoCookie(res, production);
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
      messages: [], analysis: null, aiConversation: [], analyzing: false, status: "active", archivedAt: null,
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

  app.post("/api/rooms/:code/transcripts", requireAuth, async (req, res) => {
    const code = normalizeCode(req.params.code);
    const room = await store.getRoomForUser(code, req.auth.user.id);
    if (!room) return res.status(404).json({ error: "这个房间不属于你们的共同空间。" });
    if (room.status !== "active") return res.status(409).json({ error: "这次调解已经归档。" });
    const text = cleanText(req.body?.text);
    const itemId = cleanRealtimeItemId(req.body?.itemId);
    if (!text || !itemId) return res.status(400).json({ error: "实时转录缺少完整内容或语音片段标识。" });
    const speaker = resolveSpeaker(room, req.auth.user.id, req.body?.speakerId);
    if (!speaker) return res.status(403).json({ error: "当前账号不能代表这位参与者发言。" });
    let created = false;
    await store.updateRoomForUser(code, req.auth.user.id, (draft) => {
      if (draft.messages.some((message) => message.realtimeItemId === itemId)) return;
      draft.messages.push(createMessage(speaker.id, text, "voice", null, itemId));
      draft.safety = mergeSafety(draft.safety, text);
      created = true;
    });
    broadcastRoom(code);
    res.status(created ? 201 : 200).json({ room: publicRoom(await store.getRoomForUser(code, req.auth.user.id), req.auth.user.id) });
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

  app.post("/api/rooms/:code/ask-ai", requireAuth, async (req, res) => {
    const code = normalizeCode(req.params.code);
    const room = await store.getRoomForUser(code, req.auth.user.id);
    if (!room) return res.status(404).json({ error: "这个房间不属于你们的共同空间。" });
    if (room.status !== "active") return res.status(409).json({ error: "这次调解已经归档。" });
    if (!room.analysis) return res.status(409).json({ error: "请先邀请 AI 完成第一轮分析。" });
    const question = cleanText(req.body?.question);
    if (!question) return res.status(400).json({ error: "请输入想继续问 AI 的问题。" });
    if ((room.aiConversation || []).filter((entry) => entry.role === "user").length >= 20) return res.status(429).json({ error: "本次调解的 AI 追问已达到上限。" });
    const answer = await mediator.answer(room, question);
    const now = new Date().toISOString();
    await store.updateRoomForUser(code, req.auth.user.id, (draft) => {
      draft.aiConversation ||= [];
      draft.aiConversation.push(
        { id: randomUUID(), role: "user", participantId: req.auth.user.id, text: question, createdAt: now },
        { id: randomUUID(), role: "assistant", participantId: null, text: cleanText(answer), createdAt: new Date().toISOString() },
      );
    });
    broadcastRoom(code);
    res.status(201).json({ room: publicRoom(await store.getRoomForUser(code, req.auth.user.id), req.auth.user.id) });
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
  function broadcastDemoRoom(code) {
    for (const client of eventClients.get(`demo:${code}`) || []) {
      Promise.resolve(store.getDemoRoom(code)).then((room) => {
        if (room) sendEvent(client.res, publicDemoRoom(room, client.participantId));
      }).catch(() => {});
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
    participants: room.participants.map(({ userId: _userId, ...participant }) => participant), messages: room.messages, aiConversation: room.aiConversation || [],
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

function publicDemoRoom(room, participantId) {
  const viewer = room.participants.find((participant) => participant.id === participantId) || null;
  const privateFeedback = room.analysis && viewer ? { [viewer.id]: room.analysis.private?.[viewer.id] } : null;
  return {
    demo: true,
    code: room.code, mode: room.mode, language: room.language, personality: room.personality, status: room.status,
    participants: room.participants.map(({ accessHash: _accessHash, ...participant }) => participant), messages: room.messages, aiConversation: room.aiConversation || [],
    analyzing: room.analyzing, safety: room.safety, sharedAnalysis: room.analysis?.shared || null, privateFeedback,
    analysisMeta: room.analysis ? { id: room.analysis.id, source: room.analysis.source, model: room.analysis.model, generatedAt: room.analysis.generatedAt, notice: room.analysis.notice } : null,
    currentParticipantId: viewer?.id || null,
    canControlAllSpeakers: room.mode === "shared" && room.creatorParticipantId === viewer?.id,
    consents: room.participants.map((participant) => ({ participantId: participant.id, consented: Boolean(participant.consentAt) })),
    allConsented: allDemoParticipantsConsented(room),
    joinOpen: room.status === "active" && room.mode === "remote" && room.participants.length < 2 && room.joinExpiresAt > new Date().toISOString(),
    joinExpiresAt: room.joinExpiresAt, expiresAt: room.expiresAt,
    claimCount: Object.keys(room.claims || {}).length,
    claimedByCurrent: Boolean(viewer && room.claims?.[viewer.id]),
    convertedRoomCode: room.convertedRoomCode || null,
    conversionAvailable: Boolean(room.analysis && room.participants.length === 2 && allDemoParticipantsConsented(room)),
    confirmation: { confirmedByCurrent: false, confirmedCount: 0, requiredCount: 2, complete: false },
    createdAt: room.createdAt, updatedAt: room.updatedAt, archivedAt: null,
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

function resolveDemoSpeaker(room, actor, requestedId) {
  if (actor.canControlAll) return room.participants.find((participant) => participant.id === requestedId) || actor.participant;
  return actor.participant;
}

function mapTranscriptToMessages(room, viewerUserId, segments, fullText, selectedSpeakerId = null, manualSelection = false) {
  const viewer = room.participants.find((participant) => participant.userId === viewerUserId);
  const usableSegments = segments.filter((segment) => cleanText(segment.text));
  if (!usableSegments.length && cleanText(fullText)) return [createMessage(selectedSpeakerId || viewer.id, cleanText(fullText), "voice")];
  const labels = [...new Set(usableSegments.map((segment) => segment.speaker))];
  return usableSegments.map((segment) => {
    let participantId = selectedSpeakerId || viewer.id;
    if (!manualSelection && (room.mode === "shared" || labels.length > 1)) participantId = room.participants[Math.max(0, labels.indexOf(segment.speaker))]?.id || viewer.id;
    return createMessage(participantId, cleanText(segment.text), "voice", { start: segment.start, end: segment.end, speakerLabel: segment.speaker });
  });
}

function mapDemoTranscriptToMessages(room, participantId, segments, fullText, selectedSpeakerId = null, manualSelection = false) {
  const usableSegments = segments.filter((segment) => cleanText(segment.text));
  if (!usableSegments.length && cleanText(fullText)) return [createMessage(selectedSpeakerId || participantId, cleanText(fullText), "voice")];
  const labels = [...new Set(usableSegments.map((segment) => segment.speaker))];
  return usableSegments.map((segment) => {
    let resolvedParticipantId = selectedSpeakerId || participantId;
    if (!manualSelection && (room.mode === "shared" || labels.length > 1)) resolvedParticipantId = room.participants[Math.max(0, labels.indexOf(segment.speaker))]?.id || participantId;
    return createMessage(resolvedParticipantId, cleanText(segment.text), "voice", { start: segment.start, end: segment.end, speakerLabel: segment.speaker });
  });
}

function createMessage(participantId, text, source, timing = null, realtimeItemId = null) { return { id: randomUUID(), participantId, text, source, timing, realtimeItemId, createdAt: new Date().toISOString() }; }
function createParticipant(user, role) { return { id: user.id, userId: user.id, name: user.name, role, joinedAt: new Date().toISOString() }; }
function createDemoParticipant(name, role, accessHash, joinedAt) { return { id: randomUUID(), name, role, accessHash, consentAt: null, joinedAt }; }

function demoActor(room, token) {
  if (!room || !token) return null;
  const hash = sessionId(token);
  const participant = room.participants.find((candidate) => candidate.accessHash === hash);
  return participant ? { participant, canControlAll: room.mode === "shared" && room.creatorParticipantId === participant.id } : null;
}

function allDemoParticipantsConsented(room) { return room.participants.length === 2 && room.participants.every((participant) => participant.consentAt); }

async function createUniqueCode(store, length, kind) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    let code = "";
    for (let index = 0; index < length; index += 1) code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
    const exists = kind === "room" ? await store.getRoomByCode(code) : await store.getInvitation(code);
    if (!exists) return code;
  }
  throw new Error("暂时无法生成安全邀请码，请重试。");
}

async function createUniqueDemoCode(store) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    let code = "";
    for (let index = 0; index < 8; index += 1) code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
    if (!await store.getDemoRoom(code)) return code;
  }
  throw new Error("暂时无法生成临时房间，请重试。");
}

function normalizeCode(value) { return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6); }
function normalizeLongCode(value) { return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8); }
function cleanName(value, fallback) { return String(value || "").trim().replace(/[<>]/g, "").slice(0, 24) || fallback; }
function cleanText(value) { return String(value || "").trim().replace(/\0/g, "").slice(0, 1200); }
function cleanRealtimeItemId(value) { return String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120); }

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


function isDemoCreateLimited(key) {
  const entry = demoCreates.get(key);
  if (!entry || Date.now() - entry.startedAt > DEMO_CREATE_WINDOW_MS) return false;
  return entry.count >= 5;
}
function recordDemoCreate(key) {
  const current = demoCreates.get(key);
  if (!current || Date.now() - current.startedAt > DEMO_CREATE_WINDOW_MS) demoCreates.set(key, { count: 1, startedAt: Date.now() });
  else current.count += 1;
}

function httpError(statusCode, message) { const error = new Error(message); error.statusCode = statusCode; return error; }

function mergeSafety(current, text) {
  const normalized = text.toLowerCase();
  if (/杀了你|弄死你|打死你|砍死|自杀|不想活|kill you|hurt you|suicide|end my life/.test(normalized)) return { level: 3, message: "检测到可能的暴力或自伤风险。请立刻停止争论、拉开距离并优先联系可信任的人或当地紧急支持。AI 调解不适合继续处理当下风险。" };
  if (/废物|贱人|滚开|闭嘴|傻逼|操你|idiot|shut up|worthless/.test(normalized) && current.level < 2) return { level: 2, message: "对话里出现了人身攻击。先暂停，不评价人格，只描述具体行为和感受。" };
  if (/你总是|你从不|随便你|懒得说|always|never listen/.test(normalized) && current.level < 1) return { level: 1, message: "语气正在升级。建议一次只说一件事，并让对方完整说完。" };
  return current;
}
