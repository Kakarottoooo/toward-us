import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { mediaPersistence } from "./media-dir.mjs";
import express from "express";
import helmet from "helmet";
import {
  clearSessionCookie,
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
import { createRelationshipRouter } from "./relationship-router.mjs";
import { createPrivateAgentRouter } from "./private-agent-router.mjs";
import { createMemoryRouter } from "./memory-router.mjs";
import { buildMemoryContext } from "./memory-domain.mjs";
import { createPhoneRouter } from "./phone-identity.mjs";
import { createReminderRouter } from "./reminder-router.mjs";
import { createUsageRouter } from "./usage.mjs";
import { createReminderService } from "./reminder-service.mjs";
import { createCoupleRituals } from "./couple-rituals.mjs";
import { deliverLetters } from "./letters.mjs";
import { createPushDelivery } from "./push-delivery.mjs";
import { createNativePush } from "./native-push.mjs";
import { createPrivacyRouter, runPrivateRetention } from "./privacy-router.mjs";
import { createAssistantRouter } from "./assistant-router.mjs";
import { createTogetherRouter } from "./together-router.mjs";
import { createMatchRouter } from "./match-router.mjs";
import { createAgentActivity, createAgentActivityRouter } from "./agent-activity.mjs";
import { createSpaceRouter } from "./space-router.mjs";
import { createPhotoRouter } from "./photo-store.mjs";
import { createPhotoMemoryRouter } from "./photo-memories.mjs";
import { createHandoffRouter } from "./handoff.mjs";
import { createChatImportRouter } from "./chat-import.mjs";
import { createVoiceCallRouter } from "./voice-call.mjs";
import { sendHeadsUps } from "./heads-up.mjs";
import { createSuggestionsRouter } from "./suggestions-router.mjs";
import { createPromiseKeeper, createPromisesRouter } from "./promises.mjs";
import { createProfileKeeper, createProfileRouter } from "./profile.mjs";
import { createPeopleRouter } from "./people.mjs";
import { createPeopleComparer } from "./people-compare.mjs";
import { createCycleRouter } from "./cycle.mjs";
import { createDiscoverRouter } from "./discover.mjs";
import { createFeedbackRouter } from "./feedback-router.mjs";
import { createWidgetRouter } from "./widget-router.mjs";
import { createCharacterRouter } from "./character.mjs";
import { createMembershipRouter } from "./membership.mjs";
import { createBetaRouter } from "./beta.mjs";
import { createIMessageChannel } from "./channels/imessage.mjs";
import { sendblue } from "./sendblue.mjs";
import { AI_LIMIT, aiUserMiddleware, guardMediator } from "./ai-budget.mjs";
import { installAiLedger, meterMediator, runAiLedgerMaintenance } from "./ai-ledger.mjs";
import { createAiCostRouter } from "./ai-cost-router.mjs";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const LANGUAGES = new Set(["zh", "en", "es"]);
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const loginAttempts = new Map();
const DEMO_CREATE_WINDOW_MS = 10 * 60 * 1000;
const DEMO_JOIN_WINDOW_MS = 15 * 60 * 1000;
const DEMO_ROOM_MS = 60 * 60 * 1000;
const demoCreates = new Map();

export function createApiApp({ store, mediator: rawMediator, production = false, memoryContext = buildMemoryContext, reminderService, email }) {
  const app = express();
  // Every model call below is counted and capped per person and couple per day (server/ai-budget.mjs).
  // Every model call is also costed in the AI ledger, and admitted by the cost controls first (server/ai-ledger.mjs).
  installAiLedger({ store });
  const mediator = meterMediator(guardMediator(rawMediator, { store }));
  const eventClients = new Map();
  // The scheduler tick announces in the shared conversation; the realtime emitter only exists once the routers are built below.
  let emitTogether = () => {};
  // The iMessage channel (couple group creation and mirroring) is also built below; pairing and phone linking call into it.
  let imessage = null;
  const nativePush = reminderService ? null : createNativePush();
  const reminders = reminderService || createReminderService({ store, ...createPushDelivery(), internalSecret: process.env.REMINDER_RUN_SECRET, onAnnounce: (...args) => emitTogether(...args), sendIMessage: sendblue.live() || process.env.SENDBLUE_DRYRUN_FILE ? (phone, text) => sendblue.send(phone, text) : null, sendNative: nativePush?.configured ? nativePush.send : null, groupsEnabled: () => sendblue.groupsEnabled() });

  // Daily question and celebration cards at a sensible local hour, so they reach both partners by push (not with an injected
  // test service: those tests drive delivery themselves).
  const rituals = reminderService ? null : createCoupleRituals({ store, mediator, reachable: (userId) => reminders.reachable(userId), emit: (conversation) => emitTogether(conversation, "together.updated") });
  const runDue = reminders.runDue.bind(reminders);
  reminders.runDue = async () => { const result = await runDue(); await runPrivateRetention(store); await runAiLedgerMaintenance(store).catch((error) => console.error("AI ledger maintenance will retry on the next tick:", error?.code || error?.name || "error")); await rituals?.().catch(() => console.error("Couple rituals will retry on the next tick.")); await deliverLetters({ store, postNote: (...args) => assistantRouter.assistant.postNote(...args), notify: (userId, message) => reminders.notifyMember?.(userId, message) }).catch(() => console.error("Letters will retry on the next tick.")); await sendHeadsUps({ store, postNote: (...args) => assistantRouter.assistant.postNote(...args), notify: (userId, message) => reminders.notifyMember?.(userId, message) }).catch(() => console.error("Heads-ups will retry on the next tick.")); return result; };
  app.locals.runMaintenance = reminders.runDue;

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
    res.setHeader("Permissions-Policy", "microphone=(self), camera=()");
    if (production && req.headers["x-forwarded-proto"] !== "https") return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
    next();
  });

  app.get("/api/health", async (_req, res) => {
    try {
      await store.ping();
      res.json({ ok: true, aiReady: mediator.aiReady, model: mediator.model, audioPersistence: "none", storage: store.kind, media: mediaPersistence(), commit: process.env.RENDER_GIT_COMMIT || process.env.BUILD_COMMIT || null });
    } catch {
      res.status(503).json({ ok: false, error: "storage_unavailable" });
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
        draft.safety = mergeSafety(draft.safety, additions.map((message) => message.text).join(" "), draft.language);
      });
      broadcastDemoRoom(code);
      const updated = await store.getDemoRoom(code);
      res.json({ messagesAdded: additions.length, transcriptDeleted: true, room: publicDemoRoom(updated, actor.participant.id, null) });
    } catch (error) {
      res.status(error?.statusCode || 500).json({ error: error?.message || "语音转录失败。" });
    }
  });

  // Payment webhooks verify their own signatures over the raw body and come from Stripe/Apple, not from the app's origin.
  const membership = createMembershipRouter({ store, production, onOutfit: (conversation) => emitTogether(conversation, "together.updated") });
  app.use(membership.webhooks);
  // A connected photo album sends the times and places of every photo it holds (thousands; no pictures) in one plan.
  app.use("/api/photo-memories/plan", express.json({ limit: "8mb" }));
  app.use(express.json({ limit: "256kb" }));
  app.use((req, res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method) || !(req.path.startsWith("/api/") || req.path.startsWith("/m/"))) return next();
    // This single server-to-server endpoint has its own constant-time Bearer gate.
    if (req.method === "POST" && req.path === "/api/internal/reminders/run") return next();
    return sameOriginRequest(req) ? next() : res.status(403).json({ error: "请求来源未通过安全检查。" });
  });
  app.use(async (req, _res, next) => {
    try { req.auth = await authenticateRequest(store, req); next(); }
    catch (error) { next(error); }
  });
  app.use(aiUserMiddleware);

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
    const candidate = await store.getUserByEmail(email);
    const authenticated = candidate && await store.transaction(`user:${candidate.id}`, async (tx) => {
      const user = await tx.getUserForUpdate(candidate.id);
      if (!user || user.email !== email || !await verifyPassword(String(req.body?.password || ""), user.passwordHash)) return null;
      return { user, ...(await issueSession(tx, user.id)) };
    });
    if (!authenticated) { recordFailedAttempt(key); return res.status(401).json({ error: "邮箱或密码不正确。" }); }
    loginAttempts.delete(key);
    const { token, user } = authenticated;
    setSessionCookie(res, token, production);
    res.json(await appState(store, user));
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.auth) return res.json({ user: null, pairing: null });
    res.json(await appState(store, req.auth.user));
  });

  app.post("/api/auth/logout", async (req, res) => {
    if (req.auth) { await store.deleteSession(req.auth.session.id); closeConnections([req.auth.user.id]); }
    clearSessionCookie(res, production);
    res.status(204).end();
  });

  // The interface language the member last chose, so copy the Agent posts on their behalf matches what they read.
  app.post("/api/me/language", requireAuth, async (req, res) => {
    if (!LANGUAGES.has(req.body?.language)) return res.status(400).json({ error: "language_required" });
    await store.updateUserLanguage(req.auth.user.id, req.body.language);
    res.json({ language: req.body.language });
  });

  app.post("/api/demo/rooms", async (req, res) => {
    await store.deleteExpiredDemoRooms(new Date().toISOString());
    if (isDemoCreateLimited(req.ip)) return res.status(429).json({ error: "这台设备创建临时房间过于频繁，请稍后再试。" });
    const mode = req.body?.mode === "shared" ? "shared" : "remote";
    const language = normalizeLanguage(req.body?.language);
    const nameA = cleanName(req.body?.nameA, localText(language, "我", "Me", "Yo"));
    const nameB = mode === "shared" ? cleanName(req.body?.nameB, localText(language, "TA", "Partner", "Pareja")) : null;
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
      safety: { level: 0, message: safetyBoundaryMessage(language) },
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
        joinedParticipant = createDemoParticipant(cleanName(req.body?.name, localText(draft.language, "TA", "Partner", "Pareja")), "B", accessHash, now);
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
      draft.safety = mergeSafety(draft.safety, text, draft.language);
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
      draft.safety = mergeSafety(draft.safety, text, draft.language);
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
    void imessage?.ensureCoupleGroup(req.auth.user.id);
    broadcastDemoRoom(code);
    res.json({ saved: true, room: publicDemoRoom(updated, actor.participant.id, req.auth.user.id), account: await appState(store, req.auth.user), historyCode: regularCode });
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
    void imessage?.ensureCoupleGroup(req.auth.user.id);
    res.json({ pairing: publicPairing(context, req.auth.user.id) });
  });

  app.use(createPhoneRouter({ store, onBound: (userId) => void imessage?.ensureCoupleGroup(userId) }));
  app.use(createUsageRouter({ store, internalSecret: () => reminders.internalSecret }));
  app.use(createAiCostRouter({ store, internalSecret: () => reminders.internalSecret }));
  // The home-screen widget reads with its own Bearer token (no cookie), so it is mounted before any router that turns away
  // requests without a session.
  app.use("/api", createWidgetRouter({ store }));
  // Every published "我们俩" change is mirrored to the couple's iMessage group and, without one, nudges the other member's phone.
  const relationshipRouter = createRelationshipRouter({ store, mediator, onTogether: (conversation, actorUserId) => {
    imessage?.mirror(conversation);
    void Promise.resolve().then(() => reminders.notifyTogether?.(conversation, actorUserId)).catch(() => console.error("together native push failed"));
  } });
  const emit = (...args) => relationshipRouter.emitRecord?.(...args);
  emitTogether = emit;
  // Pinky's live step while it answers; the event only tells open Apps in that couple (or that member) to look again.
  const activity = createAgentActivity({ notify: ({ relationshipId, ownerUserId }) => { if (relationshipId) emit({ id: "agent-activity", relationshipId, version: Date.now() }, "agent.activity", ownerUserId); } });
  app.use("/api", createAgentActivityRouter({ store, activity }));
  const closeConnections = (userIds) => {
    relationshipRouter.closeUserConnections?.(userIds);
  };
  // Chat-history import reports back into the member's private conversation when its background analysis finishes.
  // Mounted first: its Mac helper script and upload are reached without a session (a one-time token stands in).
  const chatImportRouter = createChatImportRouter({ store, mediator, appendAssistantMessage: (...args) => assistantRouter.assistant.postNote(...args) });
  chatImportRouter.emitTogether = (conversation, actorUserId = null) => emit(conversation, "together.updated", null, actorUserId);
  app.use("/api", chatImportRouter);
  const photoMemoryRouter = createPhotoMemoryRouter({ store, mediator, emit });
  photoMemoryRouter.emitTogether = (conversation) => emit(conversation, "together.updated", null, null);
  app.use("/api", photoMemoryRouter);
  app.use("/api", createPrivateAgentRouter({ store, mediator, memoryContext, emit }));
  // "还欠着什么": promises noticed in either conversation, in the background (11-03).
  const promiseKeeper = createPromiseKeeper({ store, mediator, emit });
  const profileKeeper = createProfileKeeper({ store, mediator, emit });
  const assistantRouter = createAssistantRouter({ store, mediator, reminderService: reminders, emit, chatImports: chatImportRouter, activity, promises: promiseKeeper, profile: profileKeeper });
  app.use("/api", assistantRouter);
  app.use("/api", createVoiceCallRouter({ store, mediator, assistant: assistantRouter.assistant, emit, activity }));
  imessage = createIMessageChannel({ store, assistant: assistantRouter.assistant, mediator, emit, activity });
  app.use(imessage.router);
  app.use("/api", createPrivacyRouter({ store, production, closeConnections, ...(email ? { email } : {}) }));
  app.use("/api", createReminderRouter({ service: reminders }));
  app.use("/api", createMemoryRouter({ store, emit }));
  app.use("/api", createTogetherRouter({ store, mediator, emit, activity, promises: promiseKeeper, profile: profileKeeper }));
  app.use("/api", createMatchRouter({ store, mediator, emit, notify: (userId, message) => reminders.notifyMember?.(userId, message), online: (userId) => relationshipRouter.isOnline?.(userId) }));
  app.use("/api", createProfileRouter({ store, emit }));
  app.use("/api", createPeopleRouter({ store, emit, comparer: createPeopleComparer({ store, mediator }) }));
  app.use("/api", createCycleRouter({ store, emit }));
  app.use("/api", createDiscoverRouter({ store }));
  app.use("/api", createPromisesRouter({ store, keeper: promiseKeeper, emit }));
  app.use("/api", createSpaceRouter({ store, emit }));
  app.use("/api", createPhotoRouter({ store }));
  app.use("/api", createHandoffRouter());
  app.use("/api", createSuggestionsRouter({ store, mediator }));
  app.use("/api", createFeedbackRouter({ store, mediator }));
  app.use("/api", createCharacterRouter({ store, emit }));
  app.use("/api", membership.router);
  app.use("/api", createBetaRouter({ store, grant: membership.grant }).router);
  app.use("/api", relationshipRouter);

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

  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    res.status(error?.statusCode || 500).json({ error: error?.statusCode ? error.message : "服务器暂时无法完成这个请求。", ...(error?.code === AI_LIMIT ? { code: AI_LIMIT } : {}) });
  });

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
  return user && user.passwordHash !== "deleted" ? { user, session } : null;
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

function resolveDemoSpeaker(room, actor, requestedId) {
  if (actor.canControlAll) return room.participants.find((participant) => participant.id === requestedId) || actor.participant;
  return actor.participant;
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

function mergeSafety(current, text, language = "zh") {
  const normalized = text.toLowerCase();
  if (/杀了你|弄死你|打死你|砍死|自杀|不想活|kill you|hurt you|suicide|end my life|matarte|hacerte daño|suicidio|no quiero vivir/.test(normalized)) return { level: 3, message: localText(language, "检测到可能的暴力或自伤风险。请立刻停止争论、拉开距离并优先联系可信任的人或当地紧急支持。AI 调解不适合继续处理当下风险。", "Possible violence or self-harm risk detected. Stop the argument, create distance, and contact someone you trust or local emergency support. AI mediation should not continue during an immediate risk.", "Se detectó un posible riesgo de violencia o autolesión. Detengan la discusión, tomen distancia y contacten a alguien de confianza o a los servicios de emergencia locales. La mediación con IA no debe continuar ante un riesgo inmediato.") };
  if (/废物|贱人|滚开|闭嘴|傻逼|操你|idiot|shut up|worthless|idiota|cállate|inútil/.test(normalized) && current.level < 2) return { level: 2, message: localText(language, "对话里出现了人身攻击。先暂停，不评价人格，只描述具体行为和感受。", "A personal attack appeared in the conversation. Pause, avoid judging character, and describe only the specific behavior and feeling.", "Apareció un ataque personal en la conversación. Pausen, eviten juzgar el carácter y describan solo la conducta y el sentimiento concretos.") };
  if (/你总是|你从不|随便你|懒得说|always|never listen|siempre haces|nunca escuchas/.test(normalized) && current.level < 1) return { level: 1, message: localText(language, "语气正在升级。建议一次只说一件事，并让对方完整说完。", "The tone is escalating. Address one issue at a time and let the other person finish.", "El tono está subiendo. Hablen de un tema a la vez y dejen que la otra persona termine.") };
  return current;
}

function normalizeLanguage(value) { return LANGUAGES.has(value) ? value : "zh"; }
function localText(language, zh, en, es) { return language === "zh" ? zh : language === "es" ? es : en; }
function safetyBoundaryMessage(language) { return localText(language, "对话仍在可调解边界内。", "Conversation is within the mediation boundary.", "La conversación se mantiene dentro de los límites de la mediación."); }
