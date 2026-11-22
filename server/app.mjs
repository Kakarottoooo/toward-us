import { screenText } from "./ai-screening.mjs";
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
  signupLanguage,
  acceptedLanguage,
  readDemoToken,
  readDeviceToken,
  renewedSessionExpiry,
  setDeviceCookie,
  readSessionToken,
  sessionId,
  setSessionCookie,
  setDemoCookie,
  validEmail,
  validPassword,
  verifyPassword,
} from "./auth.mjs";
import { createRelationshipRouter } from "./relationship-router.mjs";
import { createOAuthRouter } from "./oauth-router.mjs";
import { createOAuthProviders } from "./oauth-providers.mjs";
import { createPrivateAgentRouter } from "./private-agent-router.mjs";
import { createMemoryRouter } from "./memory-router.mjs";
import { buildMemoryContext } from "./memory-domain.mjs";
import { createPhoneRouter } from "./phone-identity.mjs";
import { createReminderRouter, internalBearerStatus } from "./reminder-router.mjs";
import { createUsageRouter } from "./usage.mjs";
import { createReminderService } from "./reminder-service.mjs";
import { createCoupleRituals } from "./couple-rituals.mjs";
import { deliverLetters } from "./letters.mjs";
import { createPushDelivery } from "./push-delivery.mjs";
import { createNativePush } from "./native-push.mjs";
import { aiConsentAt, createPrivacyRouter, runPrivateRetention } from "./privacy-router.mjs";
import { AI_NOTICE_VERSION, asDemoAi, demoHasPermission } from "./ai-permission.mjs";
import { createAssistantRouter } from "./assistant-router.mjs";
import { createTogetherRouter } from "./together-router.mjs";
import { createPlayWeekRouter } from "./play-week-router.mjs";
import { createPlayDistanceRouter } from "./play-distance-router.mjs";
import { createPlayPlansRouter } from "./play-plans-router.mjs";
import { createMatchRouter } from "./match-router.mjs";
import { createAgentActivity, createAgentActivityRouter } from "./agent-activity.mjs";
import { createSpaceRouter } from "./space-router.mjs";
import { createPhotoRouter } from "./photo-store.mjs";
import { createPhotoMemoryRouter } from "./photo-memories.mjs";
import { createHandoffRouter } from "./handoff.mjs";
import { createChatImportRouter } from "./chat-import.mjs";
import { createVoiceCallRouter } from "./voice-call.mjs";
import { sendHeadsUps } from "./heads-up.mjs";
import { screenDeferredMessages } from "./together-domain.mjs";
import { createSuggestionsRouter } from "./suggestions-router.mjs";
import { createPromiseKeeper, createPromisesRouter } from "./promises.mjs";
import { createProfileKeeper, createProfileRouter } from "./profile.mjs";
import { createPeopleRouter } from "./people.mjs";
import { createCycleRouter } from "./cycle.mjs";
import { createDiscoverRouter } from "./discover.mjs";
import { createFeedbackRouter } from "./feedback-router.mjs";
import { createLegalRouter } from "./legal-router.mjs";
import { attachReferral, recordPartnerSignup, referralPage, referralPreview, referralReport, rememberReferralInstall } from "./referrals.mjs";
import { currentInvitation, invitationStatus, inviteProblem, partnerCode } from "./partner-invites.mjs";
import { refreshKnowYou } from "./know-you.mjs";
import { REWARD_LOCK } from "./reward-ledger.mjs";
import { createAppMetricsRouter } from "./app-metrics.mjs";
import { createWidgetRouter } from "./widget-router.mjs";
import { createCharacterRouter } from "./character.mjs";
import { remainingInteractiveCalls } from "./ai-budget.mjs";
import { createMembershipRouter } from "./membership.mjs";
import { createBetaRouter } from "./beta.mjs";
import { createIMessageChannel } from "./channels/imessage.mjs";
import { sendblue } from "./sendblue.mjs";
import { AI_LIMIT, aiUserMiddleware, guardMediator } from "./ai-budget.mjs";
import { installAiLedger, meterMediator, runAiLedgerMaintenance } from "./ai-ledger.mjs";
import { createAiCostRouter } from "./ai-cost-router.mjs";
import { requestLanguage } from "./request-language.mjs";
import { createAuthLimits, deviceTrusted, SHARED_ADDRESS_LIMITS, tooManyTries, trustDevice, trustProxySetting } from "./auth-limits.mjs";
import { createEmailSender, signinCodeMessage } from "./email.mjs";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const LANGUAGES = new Set(["zh", "en", "es"]);
const DEMO_CREATE_WINDOW_MS = 10 * 60 * 1000;
const DEMO_JOIN_WINDOW_MS = 15 * 60 * 1000;
const DEMO_ROOM_MS = 60 * 60 * 1000;
const demoCreates = new Map();
// Compared against when a sign-in names an address with no account (same scrypt cost as a real hash).
const DUMMY_PASSWORD_HASH = await hashPassword("no account has this password");

export function createApiApp({ store, mediator: rawMediator, production = false, memoryContext = buildMemoryContext, reminderService, email, oauthProviders = createOAuthProviders(), requestTiming, authLimits = {}, trustProxy = process.env.TRUST_PROXY ?? (process.env.RENDER ? "1" : undefined) }) {
  const app = express();
  // Without a configured proxy every client may share one address, so per-network caps are raised (QA round 6, finding 11).
  const sharedAddress = trustProxySetting(trustProxy) === false;
  const limits = createAuthLimits({ ...(sharedAddress ? SHARED_ADDRESS_LIMITS : {}), ...authLimits }, { sharedAddress });
  const rateLimited = (req, res, seconds, reset = false) => res.status(429).set("Retry-After", String(seconds)).json({ code: "rate_limited", retryAfterSeconds: seconds, ...(reset ? { reset: true } : {}), error: tooManyTries(languageOf(req), seconds, { reset }) });
  const mailer = email || createEmailSender();
  // First, so the time measured covers every middleware and route a request passes through (server/timing.mjs).
  if (requestTiming) app.use(requestTiming);
  // Every model call below is counted and capped per person and couple per day (server/ai-budget.mjs).
  // Every model call is also costed in the AI ledger, and admitted by the cost controls first (server/ai-ledger.mjs).
  installAiLedger({ store });
  const mediator = meterMediator(guardMediator(rawMediator, { store }));
  const eventClients = new Map();
  // The scheduler tick announces in the shared conversation; the realtime emitter only exists once the routers are built below.
  let emitTogether = () => {};
  let pairingChanged = async () => {};
  // The iMessage channel (couple group creation and mirroring) is also built below; pairing and phone linking call into it.
  let imessage = null;
  const nativePush = reminderService ? null : createNativePush();
  const reminders = reminderService || createReminderService({ store, ...createPushDelivery(), internalSecret: process.env.REMINDER_RUN_SECRET, onAnnounce: (...args) => emitTogether(...args), sendIMessage: sendblue.live() || process.env.SENDBLUE_DRYRUN_FILE ? (phone, text) => sendblue.send(phone, text) : null, sendNative: nativePush?.configured ? nativePush.send : null, nativeProviders: nativePush?.providers, groupsEnabled: () => sendblue.groupsEnabled(), onUndelivered: async (reminder) => {
    // No phone, browser or iMessage to reach: the due reminder is said in Just me instead, so it still shows (QA round 6).
    const language = normalizeLanguage((await store.getUserById(reminder.ownerUserId))?.language);
    const title = String(reminder.title || "").slice(0, 120);
    await assistantRouter.assistant.postNote(reminder.ownerUserId, { language, text: localText(language, `到点提醒：「${title}」`, `Reminder: "${title}"`, `Recordatorio: «${title}»`) });
  } });

  // Daily question and celebration cards at a sensible local hour, so they reach both partners by push (not with an injected
  // test service: those tests drive delivery themselves).
  const rituals = reminderService ? null : createCoupleRituals({ store, mediator, reachable: (userId) => reminders.reachable(userId), emit: (conversation) => emitTogether(conversation, "together.updated") });
  const runDue = reminders.runDue.bind(reminders);
  reminders.runDue = async () => { const result = await runDue(); await runPrivateRetention(store); await runAiLedgerMaintenance(store).catch((error) => console.error("AI ledger maintenance will retry on the next tick:", error?.code || error?.name || "error")); await rituals?.().catch(() => console.error("Couple rituals will retry on the next tick.")); await deliverLetters({ store, postNote: (...args) => assistantRouter.assistant.postNote(...args), notify: (userId, message) => reminders.notifyMember?.(userId, message) }).catch(() => console.error("Letters will retry on the next tick.")); await sendHeadsUps({ store, postNote: (...args) => assistantRouter.assistant.postNote(...args), notify: (userId, message) => reminders.notifyMember?.(userId, message) }).catch(() => console.error("Heads-ups will retry on the next tick.")); await screenDeferredMessages({ store, emit: (conversation) => emitTogether(conversation, "together.updated"), postNote: (...args) => assistantRouter.assistant.postNote(...args), notify: (userId, message) => reminders.notifyMember?.(userId, message) }).catch(() => console.error("Deferred Us screening will retry on the next tick.")); return result; };
  app.locals.runMaintenance = reminders.runDue;

  app.disable("x-powered-by");
  // Only a proxy we run behind may set the client address: TRUST_PROXY, or one hop when Render (which sets RENDER) is in
  // front; otherwise X-Forwarded-For is ignored. Without this every Render request shares the proxy address and one
  // per-IP limit (QA 11-22).
  app.set("trust proxy", trustProxySetting(trustProxy));
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
    res.setHeader("Permissions-Policy", "microphone=(self), camera=()");
    if (production && req.headers["x-forwarded-proto"] !== "https") return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
    next();
  });

  // Only partner invitations belong to the installed app. All other links keep their web behavior.
  app.get("/.well-known/apple-app-site-association", (_req, res) => res.json({
    applinks: { details: [{ appIDs: ["693NJRHRV5.us.toward.app"], components: [{ "/": "/", "?": { invite: "????????" } }] }] },
  }));

  // /healthz is the conventional probe path; it answers exactly like /api/health instead of falling through to the web app.
  app.get(["/api/health", "/healthz"], async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      await store.ping();
      res.json({ ok: true, aiReady: mediator.aiReady, model: mediator.model, audioPersistence: "none", storage: store.kind, media: mediaPersistence(), commit: process.env.RENDER_GIT_COMMIT || process.env.BUILD_COMMIT || null });
    } catch {
      res.status(503).json({ ok: false, error: "storage_unavailable" });
    }
  });

  app.post("/api/demo/rooms/:code/realtime", express.text({ type: "application/sdp", limit: "128kb" }), async (req, res) => {
    try {
      if (!sameOriginRequest(req)) return res.status(403).json({ error: localText(languageOf(req), "请求来源未通过安全检查。", "This request did not pass the security check.", "Esta solicitud no superó la comprobación de seguridad.") });
      const code = normalizeLongCode(req.params.code);
      const room = await store.getDemoRoom(code);
      const actor = demoActor(room, readDemoToken(req));
      if (!room || !actor) return res.status(404).json({ error: localText(languageOf(req), "临时房间不存在、已过期，或你没有访问权限。", "This temporary room does not exist, has expired, or you do not have access.", "Esta sala temporal no existe, ha caducado o no tienes acceso.") });
      if (!allDemoParticipantsConsented(room)) return res.status(409).json({ error: localText(room.language, "双方同意录音与转录后才能开始表达。", "Both of you need to agree to recording and transcription before you start.", "Los dos deben aceptar la grabación y la transcripción antes de empezar.") });
      if (typeof req.body !== "string" || !req.body.includes("v=0")) return res.status(400).json({ error: localText(room.language, "没有收到有效的实时语音连接信息。", "No valid live voice connection details were received.", "No se recibieron datos válidos de la conexión de voz en vivo.") });
      const answer = await asDemoAi(code, async () => mediator.createRealtimeSession({ sdp: req.body, language: room.language, safetyIdentifier: sessionId(actor.participant.id) }));
      res.type("application/sdp").send(answer);
    } catch (error) {
      res.status(error?.statusCode || 500).json({ error: error?.message || localText(languageOf(req), "实时语音暂时不可用。", "Live voice is unavailable right now.", "La voz en vivo no está disponible ahora.") });
    }
  });

  app.post("/api/demo/rooms/:code/audio", express.raw({ type: () => true, limit: "12mb" }), async (req, res) => {
    try {
      if (!sameOriginRequest(req)) return res.status(403).json({ error: localText(languageOf(req), "请求来源未通过安全检查。", "This request did not pass the security check.", "Esta solicitud no superó la comprobación de seguridad.") });
      const code = normalizeLongCode(req.params.code);
      await store.deleteExpiredDemoRooms(new Date().toISOString());
      const room = await store.getDemoRoom(code);
      const actor = demoActor(room, readDemoToken(req));
      if (!room || !actor) return res.status(404).json({ error: localText(languageOf(req), "临时房间不存在、已过期，或你没有访问权限。", "This temporary room does not exist, has expired, or you do not have access.", "Esta sala temporal no existe, ha caducado o no tienes acceso.") });
      if (room.status !== "active") return res.status(409).json({ error: localText(room.language, "这个临时体验已经结束。", "This quick session has ended.", "Esta sesión rápida ha terminado.") });
      if (!allDemoParticipantsConsented(room)) return res.status(409).json({ error: localText(room.language, "双方同意录音后才能开始表达。", "Both of you need to agree to recording before you start.", "Los dos deben aceptar la grabación antes de empezar.") });
      if (!Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ error: localText(room.language, "没有收到有效录音。", "No valid recording was received.", "No se recibió una grabación válida.") });
      if (room.messages.length >= 30) return res.status(429).json({ error: localText(room.language, "本次快速体验已达到表达上限。", "This quick session has reached its message limit.", "Esta sesión rápida alcanzó su límite de mensajes.") });

      const transcript = await asDemoAi(code, async () => mediator.transcribe(req.body, req.headers["content-type"] || "audio/webm", room.language));
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
      res.status(error?.statusCode || 500).json({ error: error?.message || localText(languageOf(req), "语音转录失败。", "Transcription failed.", "La transcripción falló.") });
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
    // Sign in with Apple posts to this exact return endpoint. Its single-use state and browser cookie bind the request.
    if (req.method === "POST" && req.path === "/api/auth/oauth/apple/callback" && req.is("application/x-www-form-urlencoded")) return next();
    return sameOriginRequest(req) ? next() : res.status(403).json({ error: localText(languageOf(req), "请求来源未通过安全检查。", "This request did not pass the security check.", "Esta solicitud no superó la comprobación de seguridad.") });
  });
  app.use(async (req, res, next) => {
    try {
      req.auth = await authenticateRequest(store, req);
      // Sliding sessions: a member who keeps using the app stays signed in (QA round 6, finding 2).
      const renewed = req.auth && renewedSessionExpiry(req.auth.session);
      if (renewed && await store.extendSession(req.auth.session.id, renewed)) {
        req.auth.session = { ...req.auth.session, expiresAt: renewed };
        setSessionCookie(res, readSessionToken(req), production, (Date.parse(renewed) - Date.now()) / 1000);
      }
      next();
    }
    catch (error) { next(error); }
  });
  app.use(aiUserMiddleware);

  app.get("/api/membership/allowance", requireAuth, async (req, res) => {
    res.set("Cache-Control", "no-store").json({ remaining: await remainingInteractiveCalls(store, req.auth.user.id) });
  });
  app.get("/api/referrals/me", requireAuth, async (req, res) => {
    res.json(await referralPage(store, req.auth.user.id, { installId: req.get("x-install-id") }));
  });
  const previewRequests = new Map();
  let previewWindowEnd = 0;
  app.get("/api/referrals/preview", async (req, res) => {
    const now = Date.now();
    if (now >= previewWindowEnd) { previewRequests.clear(); previewWindowEnd = now + 60_000; }
    const hits = previewRequests.get(req.ip) || 0;
    if (hits >= 60 || (!hits && previewRequests.size >= 10_000)) return res.set("Retry-After", "60").sendStatus(429);
    previewRequests.set(req.ip, hits + 1);
    const preview = await referralPreview(store, req.query.code, { installId: req.get("x-install-id") });
    if (!preview) return res.status(404).json({ code: "referral_not_found" });
    res.json(preview);
  });
  app.get("/api/internal/referrals", async (req, res) => {
    const status = internalBearerStatus(req, process.env.PINKY_METRICS_ADMIN_TOKEN);
    if (status !== 200) return res.status(status).json({ error: status === 503 ? "metrics_admin_not_configured" : "unauthorized" });
    res.json(await referralReport(store, { from: req.query.from, to: req.query.to }));
  });

  async function registerWithInvitation(tx, user, { referralCode, installId, partnerInviteCode, actor }) {
    if (referralCode && actor && (await tx.getReferralByCode(referralCode))?.ownerUserId === actor) {
      throw Object.assign(new Error("referral_ineligible"), { code: "referral_ineligible", status: 422 });
    }
    const account = await tx.createUser(user);
    if (!account) return null;
    if (referralCode) {
      if (!(await attachReferral(tx, account.id, { code: referralCode, installId })).accepted) {
        throw Object.assign(new Error("referral_ineligible"), { code: "referral_ineligible", status: 422 });
      }
    } else if (installId || partnerCode(partnerInviteCode)) {
      await rememberReferralInstall(tx, account.id, { installId });
    }
    if (partnerCode(partnerInviteCode)) {
      const invite = await tx.getInvitation(partnerCode(partnerInviteCode));
      if (invitationStatus(invite) === "open" && invite.createdByUserId !== actor &&
          currentInvitation(await tx.getRelationshipContext(invite.createdByUserId), invite.code)) {
        await recordPartnerSignup(tx, account);
      }
    }
    return account;
  }
  app.use("/api/auth/oauth", createOAuthRouter({ store, production, register: registerWithInvitation, providers: oauthProviders, ...(email ? { email } : {}) }));
  app.post("/api/auth/register", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const name = cleanName(req.body?.name, "");
    const password = req.body?.password;
    if (!validEmail(email)) return res.status(400).json({ code: "invalid_email", error: "请输入有效邮箱。" });
    if (!validPassword(password)) return res.status(400).json({ code: "invalid_password_length", error: "密码需要 10–128 个字符。" });
    if (req.body?.adultConfirmed !== true) return res.status(400).json({ code: "adult_confirmation_required", error: "Ourever requires confirmation that you are 18 or older." });
    // Counted before the work, so a burst can't slip past; "already registered" counts too (it reveals an account).
    const registerWait = limits.register(req.ip);
    if (registerWait) return rateLimited(req, res, registerWait);
    // An empty name stays a placeholder the first-run screen asks to replace (QA round 5), and the sign-up's interface
    // language is saved at once so both partners' holidays show before either opens Settings.
    const user = createUser({ email, name, nameSource: name ? "user" : "fallback", language: signupLanguage(req), passwordHash: await hashPassword(password) });
    const { referralCode, partnerInviteCode, installId = req.get("x-install-id") } = req.body || {};
    let created;
    if (referralCode || installId || partnerCode(partnerInviteCode)) {
      try {
        created = await store.transaction(REWARD_LOCK, (tx) => registerWithInvitation(tx, user, { referralCode, partnerInviteCode, installId, actor: req.auth?.user?.id }));
      } catch (error) {
        if (error.code === "referral_ineligible") return res.status(422).json({ code: error.code });
        throw error;
      }
    } else {
      created = await store.createUser(user);
    }
    if (!created) return res.status(409).json({ code: "email_registered", error: localText(languageOf(req), "这个邮箱已经注册，请直接登录，或用“忘记密码”重设密码。", "This email is already registered. Sign in, or reset your password.", "Este correo ya está registrado. Inicia sesión o restablece tu contraseña.") });

    const { token } = await issueSession(store, created.id);
    setSessionCookie(res, token, production);
    // The browser that created the account is trusted for it, so a later attack never asks it for an email code.
    setDeviceCookie(res, trustDevice(readDeviceToken(req), created), production);
    res.status(201).json(await appState(store, created));
  });

  app.post("/api/auth/login", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const language = languageOf(req);
    // Counted before the password is compared and before anything awaits, so parallel tries can't exceed the caps (QA
    // round 7). Only this network's own tries can refuse here; a correct password is never refused account-wide.
    const ticket = limits.reserveLogin(req.ip, email);
    if (ticket.wait) return rateLimited(req, res, ticket.wait, true);
    const candidate = await store.getUserByEmail(email);
    // An address with no account still pays for one password compare, so timing doesn't tell whether it exists.
    if (!candidate) await verifyPassword(String(req.body?.password || ""), DUMMY_PASSWORD_HASH);
    const checked = candidate && await store.transaction(`user:${candidate.id}`, async (tx) => {
      const user = await tx.getUserForUpdate(candidate.id);
      if (!user || user.email !== email || !await verifyPassword(String(req.body?.password || ""), user.passwordHash)) return null;
      const trusted = deviceTrusted(readDeviceToken(req), user);
      // Someone has been guessing at this account: a device it doesn't know also proves the mailbox.
      if (mailer.configured && limits.stepUpNeeded(ticket, { trusted })) {
        const code = req.body?.emailCode;
        if (!code) return { user, stepUp: "send" };
        if (!limits.checkEmailCode(user.id, code)) return { user, stepUp: "wrong" };
      }
      return { user, ...(await issueSession(tx, user.id)) };
    });
    if (!checked) {
      const hold = limits.loginFailed(ticket);
      if (hold) await new Promise((resolve) => setTimeout(resolve, hold));
      return res.status(401).json({ code: "invalid_credentials", error: localText(language, "邮箱或密码不正确。", "The email or password is incorrect.", "El correo o la contraseña son incorrectos.") });
    }
    if (checked.stepUp === "wrong") return res.status(401).json({ code: "invalid_email_code", error: localText(language, "验证码不正确或已过期。请重试，或重新登录以获取新的验证码。", "That code is wrong or has expired. Try again, or sign in again for a new code.", "El código no es correcto o caducó. Inténtalo de nuevo o vuelve a iniciar sesión para recibir otro.") });
    if (checked.stepUp === "send") {
      const code = limits.issueEmailCode(checked.user.id);
      const mailLanguage = ["zh", "en", "es"].includes(req.body?.language) ? req.body.language : checked.user.language || language;
      if (code) void Promise.resolve().then(() => mailer.send({ to: checked.user.email, ...signinCodeMessage(mailLanguage, code) })).catch(() => console.error("[email] sign-in code delivery failed"));
      return res.status(202).json({ code: "verify_email", error: localText(language, "为了确认是你本人，我们向这个邮箱发了一个 6 位验证码，10 分钟内有效。输入验证码即可登录。", "To make sure it's you, we emailed a 6-digit code to this address. It expires in 10 minutes. Enter it to sign in.", "Para comprobar que eres tú, enviamos un código de 6 dígitos a este correo. Caduca en 10 minutos. Escríbelo para iniciar sesión.") });
    }
    limits.loginSucceeded(ticket);
    const { token, user } = checked;
    setSessionCookie(res, token, production);
    setDeviceCookie(res, trustDevice(readDeviceToken(req), user), production);
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
    if (isDemoCreateLimited(req.ip)) return res.status(429).json({ error: localText(languageOf(req), "这台设备创建临时房间过于频繁，请稍后再试。", "This device has created too many temporary rooms. Try again later.", "Este dispositivo ha creado demasiadas salas temporales. Inténtalo más tarde.") });
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
    if (!room || room.status !== "active") return res.status(404).json({ error: localText(languageOf(req), "这个临时房间不存在或已经结束。", "This temporary room does not exist or has ended.", "Esta sala temporal no existe o ya terminó.") });
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
        if (draft.status !== "active" || draft.mode !== "remote" || draft.participants.length >= 2 || draft.joinExpiresAt <= now) throw httpError(409, localText(draft.language, "房间已满、已过期，或不接受第二台设备加入。", "This room is full, has expired, or does not accept a second device.", "Esta sala está llena, ha caducado o no admite un segundo dispositivo."));
        joinedParticipant = createDemoParticipant(cleanName(req.body?.name, localText(draft.language, "TA", "Partner", "Pareja")), "B", accessHash, now);
        draft.participants.push(joinedParticipant);
      });
      if (!updated) return res.status(404).json({ error: localText(languageOf(req), "这个临时房间不存在或已经过期。", "This temporary room does not exist or has expired.", "Esta sala temporal no existe o ha caducado.") });
      setDemoCookie(res, token, production);
      broadcastDemoRoom(code);
      res.json({ room: publicDemoRoom(updated, joinedParticipant.id, req.auth?.user?.id || null) });
    } catch (error) {
      res.status(error?.statusCode || 500).json({ error: error?.message || localText(languageOf(req), "暂时无法加入房间。", "Could not join the room right now.", "No se pudo entrar en la sala ahora.") });
    }
  });

  app.get("/api/demo/rooms/:code", async (req, res) => {
    await store.deleteExpiredDemoRooms(new Date().toISOString());
    const room = await store.getDemoRoom(normalizeLongCode(req.params.code));
    const actor = demoActor(room, readDemoToken(req));
    if (!room || !actor) return res.status(404).json({ error: localText(languageOf(req), "临时房间不存在、已过期，或你没有访问权限。", "This temporary room does not exist, has expired, or you do not have access.", "Esta sala temporal no existe, ha caducado o no tienes acceso.") });
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

  app.post("/api/demo/rooms/:code/report", async (req, res) => {
    const room = await store.getDemoRoom(normalizeLongCode(req.params.code)), actor = demoActor(room, readDemoToken(req));
    if (!actor || room.expiresAt <= new Date().toISOString()) return res.status(404).json({ error: "room_not_found" });
    const id = req.body?.messageId;
    let reply = room.aiConversation?.find((entry) => entry.id === id && entry.role === "assistant")?.text;
    if (room.analysis && id === `shared:${room.analysis.id}`) reply = room.analysis.shared;
    if (room.mode !== "shared" && room.analysis && id === `private:${room.analysis.id}`) reply = room.analysis.private?.[actor.participant.id];
    if (!reply) return res.status(404).json({ error: "reply_not_found" });
    // The invitation code and participant token stay in the room. A report persists after its room expires.
    await store.createDemoReplyReport({ id: sessionId(JSON.stringify([actor.participant.id, id])), createdAt: new Date().toISOString(), kind: "report", severity: "high", status: "new",
      summary: "Reported Ourever demo reply", context: { view: "demo", report: "pinky", messageId: id }, text: (typeof reply === "string" ? reply : JSON.stringify(reply)).slice(0, 4000) });
    res.json({ reported: true });
  });

  app.post("/api/demo/rooms/:code/consent", async (req, res) => {
    const code = normalizeLongCode(req.params.code);
    const room = await store.getDemoRoom(code);
    const actor = demoActor(room, readDemoToken(req));
    if (!room || !actor) return res.status(404).json({ error: localText(languageOf(req), "临时房间不存在、已过期，或你没有访问权限。", "This temporary room does not exist, has expired, or you do not have access.", "Esta sala temporal no existe, ha caducado o no tienes acceso.") });
    const participantId = String(req.body?.participantId || actor.participant.id);
    if (!actor.canControlAll && participantId !== actor.participant.id) return res.status(403).json({ error: localText(room.language, "每个人只能确认自己的录音同意。", "Each person can only confirm their own recording consent.", "Cada persona solo puede confirmar su propio consentimiento de grabación.") });
    const updated = await store.updateDemoRoom(code, (draft) => {
      const participant = draft.participants.find((candidate) => candidate.id === participantId);
      if (!participant) throw httpError(404, localText(draft.language, "没有找到这位参与者。", "This participant was not found.", "No se encontró a este participante."));
      if (req.body?.noticeVersion !== AI_NOTICE_VERSION) throw httpError(409, localText(room.language, "请重新确认 AI 和录音授权。", "Review the AI and recording notice first.", "Revisa el aviso de IA y grabación."));
      participant.consentAt = new Date().toISOString();
      participant.aiNoticeVersion = AI_NOTICE_VERSION;
    });
    broadcastDemoRoom(code);
    res.json({ room: publicDemoRoom(updated, actor.participant.id, req.auth?.user?.id || null) });
  });

  app.post("/api/demo/rooms/:code/messages", async (req, res) => {
    const code = normalizeLongCode(req.params.code);
    const room = await store.getDemoRoom(code);
    const actor = demoActor(room, readDemoToken(req));
    if (!room || !actor) return res.status(404).json({ error: localText(languageOf(req), "临时房间不存在、已过期，或你没有访问权限。", "This temporary room does not exist, has expired, or you do not have access.", "Esta sala temporal no existe, ha caducado o no tienes acceso.") });
    if (room.status !== "active") return res.status(409).json({ error: localText(room.language, "这个临时体验已经结束。", "This quick session has ended.", "Esta sesión rápida ha terminado.") });
    if (!allDemoParticipantsConsented(room)) return res.status(409).json({ error: localText(room.language, "双方同意录音与转录后才能开始表达。", "Both of you need to agree to recording and transcription before you start.", "Los dos deben aceptar la grabación y la transcripción antes de empezar.") });
    if (room.messages.length >= 30) return res.status(429).json({ error: localText(room.language, "本次快速体验已达到表达上限。", "This quick session has reached its message limit.", "Esta sesión rápida alcanzó su límite de mensajes.") });
    const text = cleanText(req.body?.text);
    if (!text) return res.status(400).json({ error: localText(room.language, "请输入想说的话。", "Type what you want to say.", "Escribe lo que quieres decir.") });
    const speaker = resolveDemoSpeaker(room, actor, req.body?.speakerId);
    if (!speaker) return res.status(403).json({ error: localText(room.language, "当前设备不能代表这位参与者发言。", "This device cannot speak for this participant.", "Este dispositivo no puede hablar por este participante.") });
    await asDemoAi(code, () => screenText(text));
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
    if (!room || !actor) return res.status(404).json({ error: localText(languageOf(req), "临时房间不存在、已过期，或你没有访问权限。", "This temporary room does not exist, has expired, or you do not have access.", "Esta sala temporal no existe, ha caducado o no tienes acceso.") });
    if (!allDemoParticipantsConsented(room)) return res.status(409).json({ error: localText(room.language, "双方同意录音与转录后才能开始表达。", "Both of you need to agree to recording and transcription before you start.", "Los dos deben aceptar la grabación y la transcripción antes de empezar.") });
    const text = cleanText(req.body?.text);
    const itemId = cleanRealtimeItemId(req.body?.itemId);
    if (!text || !itemId) return res.status(400).json({ error: localText(room.language, "实时转录缺少完整内容或语音片段标识。", "The live transcript is missing its text or segment ID.", "A la transcripción en vivo le falta el texto o el identificador del fragmento.") });
    const speaker = resolveDemoSpeaker(room, actor, req.body?.speakerId);
    if (!speaker) return res.status(403).json({ error: localText(room.language, "当前设备不能代表这位参与者发言。", "This device cannot speak for this participant.", "Este dispositivo no puede hablar por este participante.") });
    let created = false;
    await asDemoAi(code, () => screenText(text));
    const updated = await store.updateDemoRoom(code, (draft) => {
      if (draft.messages.some((message) => message.realtimeItemId === itemId)) return;
      if (draft.messages.length >= 30) throw httpError(429, localText(draft.language, "本次快速体验已达到表达上限。", "This quick session has reached its message limit.", "Esta sesión rápida alcanzó su límite de mensajes."));
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
    if (!room || !actor) return res.status(404).json({ error: localText(languageOf(req), "临时房间不存在、已过期，或你没有访问权限。", "This temporary room does not exist, has expired, or you do not have access.", "Esta sala temporal no existe, ha caducado o no tienes acceso.") });
    if (!allDemoParticipantsConsented(room) || room.participants.length !== 2) return res.status(409).json({ error: localText(room.language, "双方加入并确认同意后才能请 AI 加入。", "Both of you need to join and consent before inviting the AI.", "Los dos deben unirse y dar su consentimiento antes de invitar a la IA.") });
    if (room.messages.length < 2) return res.status(400).json({ error: localText(room.language, "至少需要两段表达，AI 才能提供有依据的视角。", "The AI needs at least two messages to offer a grounded view.", "La IA necesita al menos dos mensajes para ofrecer una perspectiva fundamentada.") });
    if (room.analysis) return res.json({ room: publicDemoRoom(room, actor.participant.id, req.auth?.user?.id || null) });
    if (room.analyzing) return res.status(409).json({ error: localText(room.language, "AI 已经在整理这次对话。", "The AI is already working on this conversation.", "La IA ya está trabajando en esta conversación.") });
    if (room.analysisCount >= 1) return res.status(429).json({ error: localText(room.language, "每个快速体验房间可以生成一次 AI 调解。", "Each quick session room can get one AI mediation.", "Cada sala de sesión rápida puede recibir una mediación de IA.") });
    await store.updateDemoRoom(code, (draft) => { draft.analyzing = true; });
    broadcastDemoRoom(code);
    try {
      const analysis = await asDemoAi(code, async () => { const value = await mediator.analyze(await store.getDemoRoom(code)); await screenText(JSON.stringify({ shared: value.shared, private: value.private }), "output"); return value; });
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
      res.status(500).json({ error: error?.message || localText(languageOf(req), "AI 暂时无法完成分析。", "The AI could not finish the analysis right now.", "La IA no pudo terminar el análisis ahora.") });
    }
  });

  app.post("/api/demo/rooms/:code/ask-ai", async (req, res) => {
    const code = normalizeLongCode(req.params.code);
    const room = await store.getDemoRoom(code);
    const actor = demoActor(room, readDemoToken(req));
    if (!room || !actor) return res.status(404).json({ error: localText(languageOf(req), "临时房间不存在、已过期，或你没有访问权限。", "This temporary room does not exist, has expired, or you do not have access.", "Esta sala temporal no existe, ha caducado o no tienes acceso.") });
    if (!room.analysis) return res.status(409).json({ error: localText(room.language, "请先邀请 AI 完成第一轮分析。", "Ask the AI for the first analysis first.", "Pide primero a la IA el primer análisis.") });
    const question = cleanText(req.body?.question);
    if (!question) return res.status(400).json({ error: localText(room.language, "请输入想继续问 AI 的问题。", "Type what you want to ask the AI next.", "Escribe lo que quieres preguntar a la IA.") });
    if ((room.aiConversation || []).filter((entry) => entry.role === "user").length >= 6) return res.status(429).json({ error: localText(room.language, "本次快速体验的 AI 追问已达到上限。", "This quick session has reached its limit of AI questions.", "Esta sesión rápida alcanzó su límite de preguntas a la IA.") });
    const answer = await asDemoAi(code, async () => { await screenText(question); const value = await mediator.answer(room, question); await screenText(value, "output"); return value; });
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
    if (!room || !actor) return res.status(404).json({ error: localText(languageOf(req), "临时房间不存在、已过期，或你没有访问权限。", "This temporary room does not exist, has expired, or you do not have access.", "Esta sala temporal no existe, ha caducado o no tienes acceso.") });
    if (!room.analysis) return res.status(409).json({ error: localText(room.language, "完成 AI 共同反馈后才能保存。", "Finish the AI's shared feedback before saving.", "Termina la respuesta compartida de la IA antes de guardar.") });
    if (await store.getRelationshipContext(req.auth.user.id)) return res.status(409).json({ error: localText(room.language, "这个账号已经属于另一个共同空间，不能再保存新的伴侣关系。", "This account already belongs to another shared space, so it cannot save a new partnership.", "Esta cuenta ya pertenece a otro espacio compartido, así que no puede guardar una nueva relación.") });
    if (Object.values(room.claims).some((userId) => userId === req.auth.user.id && room.claims[actor.participant.id] !== userId)) return res.status(409).json({ error: localText(room.language, "同一个账号不能代表两位参与者。", "One account cannot stand for both participants.", "Una misma cuenta no puede representar a los dos participantes.") });
    let updated = await store.updateDemoRoom(code, (draft) => { draft.claims[actor.participant.id] = req.auth.user.id; });
    if (Object.keys(updated.claims).length < 2) {
      broadcastDemoRoom(code);
      return res.json({ saved: false, room: publicDemoRoom(updated, actor.participant.id, req.auth.user.id), account: await appState(store, req.auth.user) });
    }

    const participants = updated.participants.slice(0, 2);
    const users = await Promise.all(participants.map((participant) => store.getUserById(updated.claims[participant.id])));
    if (users.some((user) => !user)) return res.status(409).json({ error: localText(room.language, "双方账号状态不完整，请重新登录后再保存。", "One of the accounts is incomplete. Sign in again, then save.", "Una de las cuentas está incompleta. Vuelve a iniciar sesión y guarda.") });
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
    if (!finalized) return res.status(409).json({ error: localText(room.language, "双方账号已发生变化，暂时无法保存这次体验。", "The accounts changed, so this session cannot be saved right now.", "Las cuentas cambiaron, así que esta sesión no se puede guardar ahora.") });
    updated = finalized.demoRoom;
    void imessage?.ensureCoupleGroup(req.auth.user.id);
    broadcastDemoRoom(code);
    res.json({ saved: true, room: publicDemoRoom(updated, actor.participant.id, req.auth.user.id), account: await appState(store, req.auth.user), historyCode: regularCode });
  });

  app.post("/api/partner/invitations", requireAuth, async (req, res) => {
    const userId = req.auth.user.id;
    const { context, created } = await store.transaction(`user:${userId}`, async (tx) => {
      await tx.getUserForUpdate(userId);
      const existing = await tx.getRelationshipContext(userId);
      if (existing && (existing.relationship.status !== "pending" || invitationStatus(existing.invitation) === "open")) {
        return { context: existing, created: false };
      }
      const now = new Date(), at = now.toISOString();
      const relationship = existing?.relationship || { id: randomUUID(), status: "pending", createdAt: at, updatedAt: at };
      const invitation = {
        code: await createUniqueCode(tx, 8, "invitation"), relationshipId: relationship.id, createdByUserId: userId,
        createdAt: at, prepared: req.body?.prepare === true, expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(), acceptedAt: null, acceptedByUserId: null,
      };
      const membership = { relationshipId: relationship.id, userId, role: "A", joinedAt: at };
      const context = existing ? await tx.renewInvitation(invitation) : await tx.createInvitation({ relationship, membership, invitation });
      return { context, created: true };
    });
    if (!context) return res.status(409).json(inviteProblem("already_paired", languageOf(req)));
    res.status(created ? 201 : 200).json({ pairing: publicPairing(context, userId) });
  });

  const updateOwnedInvite = (action) => async (req, res) => {
    const userId = req.auth.user.id, code = partnerCode(req.params.code);
    const result = await store.transaction(`user:${userId}`, async (tx) => {
      await tx.getUserForUpdate(userId);
      const invite = await tx.getInvitation(code);
      if (!invite || invite.createdByUserId !== userId) return { problem: "invite_invalid" };
      const context = await tx.getRelationshipContext(userId);
      const status = invitationStatus(invite);
      // A recipient can join between sharing and the OS returning control to the app.
      const lateReceipt = action === "sent" && status === "used";
      if (!lateReceipt && !currentInvitation(context, code)) return { problem: status === "open" ? "invite_cancelled" : `invite_${status}` };
      if (action === "cancel" && status === "cancelled") return { context };
      if (status !== "open" && !lateReceipt) return { problem: `invite_${status}` };
      await tx.markInvitationAction(code, action, new Date().toISOString());
      return { context: await tx.getRelationshipContext(userId) };
    });
    if (result.problem) return res.status(result.problem === "invite_invalid" ? 404 : 409).json(inviteProblem(result.problem, languageOf(req)));
    res.json({ pairing: publicPairing(result.context, userId) });
  };
  app.post("/api/partner/invitations/:code/sent", requireAuth, updateOwnedInvite("sent"));
  app.delete("/api/partner/invitations/:code", requireAuth, updateOwnedInvite("cancel"));

  // What an invite link opens to, signed in or not: who sent it and whether it still works. Nothing else about the inviter.
  // The first open by anyone but the inviter is recorded, for the inviter's waiting card and the partner-join report.
  app.get("/api/partner/invitations/:code", async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const invitation = await store.getInvitation(partnerCode(req.params.code));
    if (!invitation) return res.status(404).json(inviteProblem("invite_invalid", languageOf(req)));
    const now = new Date().toISOString();
    let status = invitationStatus(invitation, now);
    if (status === "open" && !currentInvitation(await store.getRelationshipContext(invitation.createdByUserId), invitation.code)) status = "cancelled";
    if (status === "open" && req.auth?.user?.id !== invitation.createdByUserId) await store.markInvitationOpened(invitation.code, now);
    const inviter = await store.getUserById(invitation.createdByUserId);
    res.json({ invitation: { inviterName: status === "open" && inviter && inviter.passwordHash !== "deleted" ? inviter.name.trim().split(/\s+/u)[0] : "", status, expiresAt: invitation.expiresAt } });
  });

  app.post("/api/partner/accept", requireAuth, async (req, res) => {
    const code = partnerCode(req.body?.code);
    const context = await store.acceptInvitation(code, req.auth.user.id, new Date().toISOString());
    if (!context) {
      const own = await store.getRelationshipContext(req.auth.user.id), invite = await store.getInvitation(code);
      const status = invitationStatus(invite);
      const reason = own?.relationship.status === "active" ? "already_paired" : invite?.createdByUserId === req.auth.user.id ? "invite_self"
        : status === "open" ? "invite_cancelled" : `invite_${status}`;
      return res.status(409).json(inviteProblem(reason, languageOf(req)));
    }
    void imessage?.ensureCoupleGroup(req.auth.user.id);
    await pairingChanged(context.members.map((member) => member.userId), context.relationship.id, "active");
    res.json({ pairing: publicPairing(context, req.auth.user.id) });
  });

  // The invitee says no from the invite page, signed in or not (the preview above is public too). The code stops working
  // (the preview then reports status "declined"), and the inviter hears it at once: "pairing.updated" on their open App
  // and a push. Limited per address like the referral preview, so codes cannot be swept.
  const declineRequests = new Map();
  let declineWindowEnd = 0;
  app.post("/api/partner/invitations/:code/decline", async (req, res) => {
    const now = Date.now();
    if (now >= declineWindowEnd) { declineRequests.clear(); declineWindowEnd = now + 60_000; }
    const hits = declineRequests.get(req.ip) || 0;
    if (hits >= 20 || (!hits && declineRequests.size >= 10_000)) return res.set("Retry-After", "60").sendStatus(429);
    declineRequests.set(req.ip, hits + 1);
    const code = partnerCode(req.params.code), found = code ? await store.getInvitation(code) : null;
    if (!found) return res.status(404).json(inviteProblem("invite_invalid", languageOf(req)));
    if (req.auth?.user?.id === found.createdByUserId) return res.status(409).json(inviteProblem("invite_self", languageOf(req)));
    const result = await store.transaction(`relationship:${found.relationshipId}`, async (tx) => {
      const invite = await tx.getInvitation(code);
      let status = invitationStatus(invite);
      if (status === "declined") return { status, fresh: false };
      if (status === "open" && !currentInvitation(await tx.getRelationshipContext(invite.createdByUserId), code)) status = "cancelled";
      if (status !== "open") return { problem: `invite_${status}` };
      await tx.markInvitationAction(code, "decline", new Date().toISOString());
      return { status: "declined", fresh: true };
    });
    if (result.problem) return res.status(409).json(inviteProblem(result.problem, languageOf(req)));
    if (result.fresh) {
      await pairingChanged([found.createdByUserId], found.relationshipId, "declined", { refresh: false });
      void Promise.resolve().then(() => reminders.notifyMember?.(found.createdByUserId, {
        body: { zh: "对方婉拒了这次伴侣邀请。想再试的话，可以随时发一个新链接。", en: "Your partner invitation was declined. You can send a new link anytime.", es: "Tu invitación de pareja fue rechazada. Puedes enviar un enlace nuevo cuando quieras." },
        url: "/", tag: `pinky-invite-${code}`,
      })).catch(() => console.error("invite decline push failed"));
    }
    res.json({ invitation: { status: "declined" } });
  });

  app.use(createPhoneRouter({ store, onBound: (userId) => void imessage?.ensureCoupleGroup(userId) }));
  app.use(createUsageRouter({ store, internalSecret: () => reminders.internalSecret }));
  app.use(createAiCostRouter({ store, internalSecret: () => reminders.internalSecret }));
  // The home-screen widget reads with its own Bearer token (no cookie), so it is mounted before any router that turns away
  // requests without a session.
  app.use("/api", createAppMetricsRouter({ store }));
  app.use("/api", createFeedbackRouter({ store, mediator, notify: (userId, message) => reminders.notifyMember?.(userId, message) }));
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
  // Pairing accepted, declined or ended: the members' open Apps hear it at once ("pairing.updated", see
  // relationship-router emitToUsers), and the Just me greeting is rewritten so it never names someone who is no longer
  // their partner (know-you.mjs refreshKnowYou).
  pairingChanged = async (userIds, relationshipId, status, { refresh = true } = {}) => {
    relationshipRouter.emitToUsers?.(userIds, { eventType: "pairing.updated", objectId: relationshipId, version: Date.now(), status });
    if (refresh) for (const userId of userIds) await refreshKnowYou(store, userId).catch(() => console.error("Just me greeting refresh failed"));
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
  const voiceCalls = createVoiceCallRouter({ store, mediator, assistant: assistantRouter.assistant, emit, activity });
  app.use("/api", voiceCalls);
  imessage = createIMessageChannel({ store, assistant: assistantRouter.assistant, mediator, emit, activity });
  app.use(imessage.router);
  app.use("/api", createPrivacyRouter({ store, production, closeConnections, authLimits: limits, onPairingEnded: (userIds, relationshipId) => pairingChanged(userIds, relationshipId, "ended"), onAiWithdrawal: voiceCalls.withdrawPermission, oauthProviders, ...(email ? { email } : {}) }));
  app.use("/api", createReminderRouter({ service: reminders }));
  app.use("/api", createMemoryRouter({ store, emit }));
  app.use("/api", createTogetherRouter({ store, mediator, emit, activity, promises: promiseKeeper, profile: profileKeeper }));
  app.use("/api", createPlayWeekRouter({ store }));
  app.use("/api", createPlayDistanceRouter({ store, emit, notify: (userId, message) => reminders.notifyMember?.(userId, message), online: (userId) => relationshipRouter.isOnline?.(userId) }));
  app.use("/api", createPlayPlansRouter({ store, emit, notify: (userId, message) => reminders.notifyMember?.(userId, message) }));
  app.use("/api", createMatchRouter({ store, mediator, emit, notify: (userId, message) => reminders.notifyMember?.(userId, message), online: (userId) => relationshipRouter.isOnline?.(userId) }));
  app.use("/api", createProfileRouter({ store, emit }));
  app.use("/api", createPeopleRouter({ store, emit }));
  app.use("/api", createCycleRouter({ store, emit }));
  app.use("/api", createDiscoverRouter({ store }));
  app.use("/api", createPromisesRouter({ store, keeper: promiseKeeper, emit }));
  app.use("/api", createSpaceRouter({ store, emit }));
  app.use("/api", createPhotoRouter({ store }));
  app.use("/api", createHandoffRouter());
  app.use("/api", createSuggestionsRouter({ store, mediator }));
  app.use(createLegalRouter());
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

  app.use((error, req, res, _next) => {
    if (res.headersSent) return;
    res.status(error?.statusCode || 500).json({ error: error?.statusCode ? error.message : localText(languageOf(req), "服务器暂时无法完成这个请求。", "The server could not complete this request right now.", "El servidor no pudo completar esta solicitud ahora."), ...(error?.code === AI_LIMIT ? { code: AI_LIMIT, upgrade: error.upgrade === true, background: error.background === true } : {}) });
  });

  return app;
}

// Signed out there is no saved language: an explicit one, else the browser's Accept-Language (QA round 7).
function requireAuth(req, res, next) { return req.auth ? next() : res.status(401).json({ error: localText(requestLanguage(req), "请先登录。", "Please sign in first.", "Inicia sesión primero.") }); }

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
  return { user: { ...publicUser(user), passwordless: user.passwordHash === "federated", aiConsentAt: await aiConsentAt(store, user.id) }, pairing: publicPairing(pairing, user.id) };
}

function publicPairing(context, viewerId) {
  if (!context) return null;
  return {
    id: context.relationship.id,
    status: context.relationship.status,
    role: context.membership.role,
    members: context.members.map((member) => ({ id: member.user.id, name: member.user.name, role: member.role, joinedAt: member.joinedAt })),
    invitation: context.relationship.status === "pending" && context.invitation?.createdByUserId === viewerId ? { code: context.invitation.code, createdAt: context.invitation.createdAt, expiresAt: context.invitation.expiresAt, openedAt: context.invitation.openedAt || null, prepared: context.invitation.prepared === true, sentAt: context.invitation.sentAt || null, cancelledAt: context.invitation.cancelledAt || null, declinedAt: context.invitation.declinedAt || null } : null,
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
    consents: room.participants.map((participant) => ({ participantId: participant.id, consented: Boolean(participant.consentAt && participant.aiNoticeVersion === AI_NOTICE_VERSION) })),
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

function allDemoParticipantsConsented(room) { return demoHasPermission(room); }

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
// The reader's language for an error: what the request says, else the member's saved interface language, else the browser's.
function languageOf(req) {
  const hint = [req.body?.language, req.query?.language, req.auth?.user?.language].find((value) => LANGUAGES.has(value));
  return hint || acceptedLanguage(req.headers?.["accept-language"]) || "en";
}
function localText(language, zh, en, es) { return language === "zh" ? zh : language === "es" ? es : en; }
function safetyBoundaryMessage(language) { return localText(language, "对话仍在可调解边界内。", "Conversation is within the mediation boundary.", "La conversación se mantiene dentro de los límites de la mediación."); }
