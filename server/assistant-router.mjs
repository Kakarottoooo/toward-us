import { createHash, randomUUID } from "node:crypto";
import express from "express";
import { createRelationshipRecord, projectRecord, nextOccurrence } from "./relationship-domain.mjs";
import { validateAssistantTurn } from "./assistant-agent.mjs";
import { appendTogetherMessage } from "./together-domain.mjs";
import { recordUsage } from "./usage.mjs";

const collections = { reminder: "reminders", checkin: "checkins", memory: "memories", plan: "privateAgentThreads", milestone: "milestones", agreement: "agreements", commitment: "commitments" };
const clean = (value, limit) => typeof value === "string" ? value.trim().replace(/\0/g, "").slice(0, limit) : "";
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;
const unpaired = (language) => say(language, "先邀请另一半加入，再分享你确认的内容。私人对话仍可继续。", "Invite your partner before sharing. Your private conversation can continue.", "Invita a tu pareja antes de compartir. Puedes seguir hablando en privado.");
const activePair = (context) => context?.relationship.status === "active" && context.members.length === 2;
const privateRecord = (userId, data) => createRelationshipRecord({ relationshipId: null, userId, visibility: "private", aiAccessScope: "none", ...data });
const localTime = (value, timezone) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value)).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

export function createAssistantRouter({ store, mediator, reminderService, emit = () => {} }) {
  const router = express.Router();
  const liveUser = async (db, userId, lock = false) => {
    const user = await (lock ? db.getUserForUpdate(userId) : db.getUserById(userId));
    if (!user || user.passwordHash === "deleted" || user.disabledAt || user.deletedAt) throw fail(401, "Please sign in.");
  };
  router.use("/assistant", async (req, _res, next) => { if (!req.auth) throw fail(401, "Please sign in."); await liveUser(store, req.auth.user.id); next(); });
  const owned = async (db, id, userId) => {
    const thread = await db.getRelationshipRecordForUser("privateAgentThreads", id, userId);
    if (!thread || thread.intentType !== "assistant" || thread.ownerUserId !== userId || thread.visibility !== "private" || thread.archivedAt || thread.status !== "active") throw fail(404, "Private assistant session not found.");
    return thread;
  };
  const output = async (session) => {
    const records = await available(store, session.ownerUserId);
    return { id: session.id, language: session.language, timezone: session.timezone, version: session.version, messages: session.messages.map((message) => ({
      id: message.id, role: message.role, text: message.text, createdAt: message.createdAt, ...(message.itemId ? { itemId: message.itemId } : {}),
      ...(message.cards ? { cards: message.cards.map((reference) => {
        if (reference.kind === "partner_message") return { id: reference.id, kind: "partner_message", version: reference.version, title: say(session.language, "想对TA说的话", "Message for your partner", "Mensaje para tu pareja"), text: reference.text, digest: reference.digest, status: session.partnerMessage?.cardId !== reference.id ? "superseded" : session.partnerMessage.sharedAt ? "shared" : "draft" };
        const current = records.find(({ kind, record }) => kind === reference.kind && record.id === reference.id);
        return current ? card(current.kind, current.record, session.language) : { id: reference.id, kind: reference.kind, version: reference.version, status: "unavailable", title: say(session.language, "记录已归档或不可用", "Record archived or unavailable", "Registro archivado o no disponible") };
      }) } : {}),
    })) };
  };
  // `channel` marks a session owned by a channel adapter (iMessage keeps one running session per member and language).
  const createSession = async (userId, { language, timezone, channel = null }) => {
    try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { throw fail(400, "Invalid IANA time zone."); }
    const session = privateRecord(userId, { intentType: "assistant", language, timezone, messages: [], aiAccessScope: "private", ...(channel ? { channel } : {}) });
    await store.transaction("reminder-delivery", async (tx) => {
      await liveUser(tx, userId, true);
      const sessions = (await tx.listRelationshipRecordsForUser("privateAgentThreads", userId)).filter((record) => record.intentType === "assistant" && !record.archivedAt);
      if (sessions.length >= 50) throw fail(409, say(language, "已达到助手对话上限，请在隐私设置中管理私人记录。", "Assistant conversation limit reached. Manage private records in Privacy.", "Se alcanzó el límite de conversaciones. Gestiona tus registros privados en Privacidad."));
      await tx.createRelationshipRecord("privateAgentThreads", session);
    });
    return session;
  };
  router.post("/assistant/sessions", async (req, res) => {
    const language = ["zh", "en", "es"].includes(req.body?.language) ? req.body.language : "zh";
    const session = await createSession(req.auth.user.id, { language, timezone: clean(req.body?.timezone, 64) || "UTC" });
    res.status(201).json({ session: await output(session) });
  });
  router.get("/assistant/sessions/:id", async (req, res) => res.json({ session: await output(await owned(store, req.params.id, req.auth.user.id)) }));

  async function available(db, userId) {
    const context = await db.getRelationshipContext(userId);
    const relationshipId = context?.relationship.status === "active" ? context.relationship.id : null;
    const records = [];
    for (const [kind, collection] of Object.entries(collections)) {
      for (const raw of await db.listRelationshipRecordsForUser(collection, userId)) {
        const record = projectRecord(raw, userId);
        if (!record || record.withdrawnAt || record.status === "closed" || (record.expiresAt && Date.parse(record.expiresAt) <= Date.now())) continue;
        if (["agreement", "commitment", "milestone"].includes(kind)) { if (!relationshipId || record.relationshipId !== relationshipId || record.visibility === "private") continue; }
        else if (record.ownerUserId !== userId || record.visibility !== "private") continue;
        if (kind === "plan" && (record.intentType !== "plan" || record.sharedObjectId)) continue;
        records.push({ kind, record });
      }
    }
    return records.sort((a, b) => b.record.updatedAt.localeCompare(a.record.updatedAt));
  }
  const card = (kind, record, language) => ({
    id: record.id, kind, title: record.title || record.draft?.title || record.description || say(language, kind === "memory" ? "私人记忆" : "日常记录", kind === "memory" ? "Private memory" : "Daily check-in", kind === "memory" ? "Recuerdo privado" : "Registro diario"),
    text: record.text || record.draft?.shareableSummary || record.summary || null, status: record.status, version: record.version,
    url: kind === "reminder" ? `/?view=reminders&reminder=${encodeURIComponent(record.id)}` : ["agreement", "commitment"].includes(kind) ? `/?view=decide&issue=${encodeURIComponent(record.issueId || "")}` : kind === "milestone" ? `/?view=plans&milestone=${encodeURIComponent(record.id)}` : kind === "plan" ? `/?view=plans&thread=${encodeURIComponent(record.id)}` : `/?view=${kind === "memory" ? "memories" : "checkins"}`,
    ...(kind === "reminder" ? { localDateTime: localTime(record.dueAt, record.timezone), timezone: record.timezone, frequency: record.frequency, nextOccurrenceOnly: Boolean(record.occurrenceOriginalDueAt), weeklyTime: record.localTime } : {}),
    ...(kind === "plan" ? { date: record.draft?.date } : {}),
  });
  // One private turn, shared by the App routes and the iMessage adapter. Returns the raw session and whether `itemId` was already handled.
  const appendTurn = async (userId, sessionId, body, { channel = "app" } = {}) => {
    const session = await owned(store, sessionId, userId);
    const text = clean(body?.text, 2000); const itemId = clean(body?.itemId, 120);
    if (!text || !itemId) throw fail(400, "Text and a unique itemId are required.");
    if (session.messages.some((message) => message.itemId === itemId)) return { session, duplicate: true };
    if (session.messages.length >= 200) throw fail(409, say(session.language, "这段对话已满，请开始新对话。", "Start a new conversation to continue.", "Inicia una nueva conversación para continuar."));
    const records = await available(store, userId);
    const userMessage = { id: randomUUID(), role: "user", text, itemId, createdAt: new Date().toISOString() };
    const context = {
      now: new Date().toISOString(), timezone: session.timezone, localDateTime: localTime(new Date(), session.timezone),
      messages: [...session.messages.filter((m) => m.role === "user" || m.plannerQuestion).map(({ role, text }) => ({ role, text })), userMessage].slice(-30),
      records: records.slice(0, 200).map(({ kind, record }) => ({ id: record.id, kind, version: record.version, status: record.status, ...(kind === "reminder" ? { frequency: record.frequency } : {}) })),
      partnerDraft: session.partnerMessage && !session.partnerMessage.sharedAt ? { cardId: session.partnerMessage.cardId, text: session.partnerMessage.text } : null,
      recentCards: ([...session.messages].reverse().find((message) => message.cards?.length)?.cards || []).map(({ id, kind, version }) => ({ id, kind, version })),
    };
    let plan;
    try { plan = await mediator.planAssistantTurn(context, session.language); }
    catch { throw fail(503, say(session.language, "语音助手暂时不可用，没有执行任何操作。请稍后重试或使用原来的表单。", "The assistant is unavailable. Nothing was changed. Retry or use the existing forms.", "El asistente no está disponible. No se cambió nada. Reinténtalo o usa los formularios.")); }
    if (!validateAssistantTurn(plan)) throw fail(502, "The assistant could not prepare a valid action. Nothing was changed.");
    const changes = []; let partnerMessage = null; let raced = false;
    const updated = await store.transaction("reminder-delivery", async (tx) => {
      await liveUser(tx, userId, true);
      const latest = await owned(tx, session.id, userId);
      if (latest.messages.some((message) => message.itemId === itemId)) { raced = true; return latest; }
      if (latest.version !== session.version) throw fail(409, say(session.language, "已有新消息，请刷新后重试。", "A new message arrived. Refresh and retry.", "Hay un mensaje nuevo. Actualiza y vuelve a intentarlo."));
      const currentRecords = await available(tx, userId);
      const cards = []; const replies = [];
      for (const action of plan.actions) {
        if (action.kind === "partner_message") {
          // A draft only: it stays on this private session until the member confirms the exact digest via share-confirm.
          const text = clean(action.fields?.text, 2000); if (!text) throw fail(400, "Say what you would like your partner to hear.");
          partnerMessage = { cardId: randomUUID(), text, digest: createHash("sha256").update(text).digest("hex"), createdAt: new Date().toISOString(), sharedAt: null, messageId: null };
          cards.push({ id: partnerMessage.cardId, kind: "partner_message", version: 1, text, digest: partnerMessage.digest });
          replies.push(say(session.language, "已为你起草好想对 TA 说的话。你确认之前不会分享，也不会分享你的原话。", "I drafted what you would like your partner to hear. Nothing is shared, and your own words never are, until you confirm.", "Redacté lo que quieres que tu pareja escuche. No se comparte nada, ni tus palabras originales, hasta que lo confirmes.")); continue;
        }
        if (!Object.hasOwn(collections, action.kind) || !["create", "update", "archive", "query"].includes(action.operation)) throw fail(502, "Unsupported assistant operation. Nothing was changed.");
        if (action.operation === "query") {
          const query = clean(action.query, 120).toLocaleLowerCase();
          const today = context.localDateTime.slice(0, 10);
          const monday = new Date(`${today}T12:00Z`); monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
          const sunday = new Date(monday); sunday.setUTCDate(sunday.getUTCDate() + 6);
          const results = currentRecords.filter(({ kind, record }) => {
            if (kind !== action.kind || (action.targetId && record.id !== action.targetId) || (query && ![record.title, record.text, record.draft?.title, record.draft?.shareableSummary, record.summary, record.description].filter(Boolean).join(" ").toLocaleLowerCase().includes(query))) return false;
            if (action.queryPeriod === "all" && !action.fields.date) return true;
            if (["completed", "reviewed", "paused", "cancelled"].includes(record.status)) return false;
            const date = record.dueAt ? localTime(record.dueAt, session.timezone).slice(0, 10) : kind === "milestone" && record.recurringRule === "yearly" ? nextOccurrence(record.date, record.recurringRule)?.slice(0, 10) : record.draft?.date || record.date;
            if (!date || (action.fields.date && date !== action.fields.date)) return false;
            return action.queryPeriod === "upcoming" ? date >= today : action.queryPeriod === "this_week" ? date >= monday.toISOString().slice(0, 10) && date <= sunday.toISOString().slice(0, 10) : true;
          }).slice(0, 20);
          cards.push(...results.map(({ kind, record }) => card(kind, record, session.language)));
          replies.push(say(session.language, `找到 ${results.length} 条你可以查看的记录。`, `Found ${results.length} records you can view.`, `Se encontraron ${results.length} registros que puedes ver.`)); continue;
        }
        if (["agreement", "commitment", "milestone"].includes(action.kind)) throw fail(502, "Shared records require their existing confirmation flow. Nothing was changed.");
        const values = action.fields || {};
        const collection = collections[action.kind];
        const current = action.operation === "create" ? null : currentRecords.find(({ kind, record }) => kind === action.kind && record.id === action.targetId)?.record;
        if (action.operation !== "create") {
          if (!current) throw fail(404, "This private record is no longer available.");
          if (!Number.isSafeInteger(action.expectedVersion) || action.expectedVersion !== current.version) throw fail(409, "The record changed. Ask again with the current version.");
        }
        let record;
        if (action.kind === "reminder") {
          if (action.operation === "create") record = await reminderService.createReminder(userId, { title: values.title, localDateTime: values.localDateTime, timezone: values.timezone || session.timezone, frequency: values.frequency || "once" });
          else {
            const patch = { expectedVersion: action.expectedVersion };
            if (action.operation === "archive") patch.enabled = false;
            else {
              if (values.title !== null) patch.title = values.title;
              if (values.localDateTime !== null || values.timezone !== null || values.frequency !== null) {
                if (current.frequency === "weekly" && values.localDateTime !== null && action.occurrence === null) throw fail(400, say(session.language, "只改下一次，还是以后每周都改？", "Change only the next occurrence, or every week?", "¿Cambiar solo la próxima vez o todas las semanas?"));
                const anchor = action.occurrence === "series" ? current.occurrenceOriginalDueAt || current.dueAt : current.dueAt;
                Object.assign(patch, { localDateTime: /^\d{2}:\d{2}$/.test(values.localDateTime || "") ? `${localTime(anchor, current.timezone).slice(0, 10)}T${values.localDateTime}` : values.localDateTime || localTime(anchor, current.timezone), timezone: values.timezone || current.timezone, frequency: values.frequency || current.frequency, occurrence: action.occurrence });
              }
            }
            record = await reminderService.updateReminder(userId, current.id, patch);
          }
        } else {
          let patch;
          if (action.operation === "archive") patch = { status: "archived", archivedAt: new Date().toISOString(), aiAccessScope: "none", approvals: [] };
          else if (action.kind === "plan") {
            const draft = { ...(current?.draft || {}), ...(values.title !== null ? { title: clean(values.title, 160) } : {}), ...(values.text !== null ? { shareableSummary: clean(values.text, 1600) } : {}), ...(values.date !== null ? { date: clean(values.date, 10) } : {}) };
            if (!draft.title || !draft.shareableSummary || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !Number.isFinite(Date.parse(`${draft.date}T12:00Z`)) || new Date(`${draft.date}T12:00Z`).toISOString().slice(0, 10) !== draft.date) throw fail(400, "A private plan needs a title, description, and valid date.");
            patch = { intentType: "plan", draft: { ...draft, recurringRule: draft.recurringRule || "once" }, readyToShare: true, status: "draft_ready", language: session.language, source: "member", ...(current ? {} : { messages: [] }) };
          } else {
            const text = values.text === null ? current?.text : clean(values.text, 2000);
            if (!text) throw fail(400, "Say what you would like to save.");
            if (values.mood !== null && !["low", "mixed", "okay", "good"].includes(values.mood)) throw fail(400, "Invalid check-in mood.");
            patch = { text, kind: action.kind, aiAccessScope: "none", approvals: [], ...(action.kind === "checkin" ? { mood: values.mood ?? current?.mood ?? null } : {}) };
          }
          if (current) record = await tx.updateRelationshipRecordForUser(collection, current.id, userId, (draft) => {
            if (draft.version !== action.expectedVersion || draft.visibility !== "private" || draft.ownerUserId !== userId || draft.archivedAt || draft.status === "closed") throw fail(409, "The record changed. Ask again with the current version.");
            Object.assign(draft, patch); draft.version += 1;
            draft.provenance = { ...draft.provenance, correctedByUserId: userId, correctedAt: new Date().toISOString() };
          });
          else { record = privateRecord(userId, patch); await tx.createRelationshipRecord(collection, record); }
        }
        await tx.createRelationshipRecord("consentEvents", privateRecord(userId, { status: "recorded", objectId: record.id, objectType: action.kind, eventType: `assistant.${action.kind}.${action.operation}`, sourceVersion: record.version }));
        cards.push(card(action.kind, record, session.language)); changes.push({ kind: action.kind, record });
        if (action.kind === "reminder") {
          const at = `${localTime(record.dueAt, record.timezone).replace("T", " ")} (${record.timezone})`;
          replies.push(action.operation === "archive" ? say(session.language, "已暂停这条个人提醒。", "This personal reminder is paused.", "Este recordatorio personal está pausado.") : record.occurrenceOriginalDueAt ? say(session.language, `已保存个人提醒：${record.title}。仅下次为 ${at}，后续仍按原来的每周安排。`, `Saved personal reminder: ${record.title}. Only the next occurrence is ${at}; later reminders keep the original weekly schedule.`, `Recordatorio personal guardado: ${record.title}. Solo la próxima vez será ${at}; las siguientes mantienen el horario semanal original.`) : say(session.language, `已保存个人提醒：${record.title}，${at}${record.frequency === "weekly" ? "，每周重复" : ""}。`, `Saved personal reminder: ${record.title}, ${at}${record.frequency === "weekly" ? ", every week" : ""}.`, `Recordatorio personal guardado: ${record.title}, ${at}${record.frequency === "weekly" ? ", cada semana" : ""}.`));
        } else replies.push(action.operation === "archive" ? say(session.language, "已归档这条私人记录。", "This private record is archived.", "Este registro privado está archivado.") : action.kind === "plan" ? say(session.language, "已保存私人计划草稿，尚未分享。", "Saved a private plan draft. It has not been shared.", "Se guardó un borrador de plan privado. No se ha compartido.") : say(session.language, "已保存私人记录，未授权 AI 在其他对话中使用。", "Saved privately, without permission for AI use in other conversations.", "Se guardó en privado, sin autorizar el uso de la IA en otras conversaciones."));
      }
      const reply = replies.join("\n") || clean(plan.reply, 1200) || say(session.language, "你想创建、查找还是修改什么？", "What would you like to create, find, or change?", "¿Qué quieres crear, buscar o cambiar?");
      const saved = await tx.updateRelationshipRecordForUser("privateAgentThreads", latest.id, userId, (draft) => { if (draft.version !== session.version) throw fail(409, "The conversation changed."); draft.messages.push(userMessage, { id: randomUUID(), role: "assistant", text: reply, cards: cards.map(({ id, kind, version, text, digest }) => ({ id, kind, version, ...(kind === "partner_message" ? { text, digest } : {}) })), plannerQuestion: !plan.actions.length, createdAt: new Date().toISOString() }); if (partnerMessage) draft.partnerMessage = partnerMessage; draft.version += 1; });
      if (!saved) throw fail(409, "The conversation was removed. Nothing was changed.");
      return saved;
    });
    for (const { kind, record } of changes) emit(record, `${kind === "plan" ? "private_agent_thread" : kind}.updated`, userId);
    void recordUsage(store, { userId, action: "private_message", channel });
    return { session: updated, duplicate: raced };
  };
  const append = async (req, res) => res.json({ session: await output((await appendTurn(req.auth.user.id, req.params.id, req.body)).session) });
  // Only an explicit confirm of the current card's digest moves the polished text (never the member's raw words) into the shared conversation.
  const confirmShare = async (userId, sessionId, body, { channel = "app" } = {}) => {
    const session = await owned(store, sessionId, userId);
    if (body?.confirm !== true) throw fail(400, say(session.language, "请明确确认要分享这段话。", "Confirm explicitly that you want to share this message.", "Confirma explícitamente que quieres compartir este mensaje."));
    const cardId = clean(body?.cardId, 80); const digest = clean(body?.digest, 64);
    const initial = await store.getRelationshipContext(userId);
    if (!activePair(initial)) throw fail(409, unpaired(session.language));
    const result = await store.transaction(`relationship:${initial.relationship.id}`, async (tx) => {
      await liveUser(tx, userId, true);
      const context = await tx.getRelationshipContext(userId);
      if (!activePair(context) || context.relationship.id !== initial.relationship.id) throw fail(409, unpaired(session.language));
      const latest = await owned(tx, session.id, userId); const draft = latest.partnerMessage;
      if (!draft || draft.cardId !== cardId || draft.digest !== digest || createHash("sha256").update(draft.text).digest("hex") !== digest) throw fail(409, say(session.language, "这段话已经修改，请确认最新的版本。", "This message changed. Review and confirm the latest version.", "Este mensaje cambió. Revisa y confirma la última versión."));
      // Already shared: answer from the durable stamp instead of the handle, which only dedupes within the last 200 messages.
      if (draft.sharedAt) return { duplicate: true, message: { id: draft.messageId, text: draft.text, createdAt: draft.sharedAt }, session: latest };
      const sent = await appendTogetherMessage(tx, { relationshipId: initial.relationship.id, actorUserId: userId, source: "relay", kind: "relay", text: draft.text, handle: `partner_message:${draft.cardId}`, refs: [{ type: "partner_message", id: draft.cardId }] });
      if (sent.duplicate) return { ...sent, session: latest };
      await tx.createRelationshipRecord("consentEvents", privateRecord(userId, { relationshipId: initial.relationship.id, approvalPolicy: "owner", status: "recorded", objectId: draft.cardId, objectType: "partner_message", eventType: "partner_message.shared", sourceVersion: latest.version }));
      const saved = await tx.updateRelationshipRecordForUser("privateAgentThreads", latest.id, userId, (record) => { record.partnerMessage = { ...record.partnerMessage, sharedAt: new Date().toISOString(), messageId: sent.message.id }; record.version += 1; });
      return { ...sent, session: saved };
    });
    if (!result.duplicate) { emit(result.conversation, "together.updated"); void recordUsage(store, { userId, relationshipId: initial.relationship.id, action: "partner_message_shared", channel }); }
    return result;
  };
  router.post("/assistant/sessions/:id/share-confirm", async (req, res) => {
    const result = await confirmShare(req.auth.user.id, req.params.id, req.body);
    res.json({ session: await output(result.session), message: { id: result.message.id, text: result.message.text, createdAt: result.message.createdAt }, duplicate: result.duplicate });
  });
  router.post("/assistant/sessions/:id/messages", append);
  router.post("/assistant/sessions/:id/transcripts", append);
  router.post("/assistant/sessions/:id/realtime", express.text({ type: "application/sdp", limit: "128kb" }), async (req, res) => {
    const session = await owned(store, req.params.id, req.auth.user.id);
    if (typeof req.body !== "string" || !req.body.includes("v=0")) throw fail(400, "Invalid audio connection.");
    res.type("application/sdp").send(await mediator.createRealtimeSession({ sdp: req.body, language: session.language, safetyIdentifier: createHash("sha256").update(req.auth.user.id).digest("hex") }));
  });
  // Channel adapters (iMessage) call the same domain code as the HTTP routes above.
  router.assistant = { createSession, appendTurn, confirmShare, output };
  return router;
}
