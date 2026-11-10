import { keepMessages, summarizeEarlier } from "./thread-pages.mjs";
import { gettingToKnow, profileContext } from "./profile.mjs";
import { markAsked, togetherWith } from "./people-stages.mjs";
import { prefetchRecall, recallLookup, searchMemoryResults } from "./memory-search.mjs";
import { citedReply, locateConversation, readableConversation, conversationMessages } from "./conversation-recall.mjs";
import { listPeople, livePerson } from "./people.mjs";
import { cycleContext, isCycleRecord, logPeriod } from "./cycle.mjs";
import { notTriedYet } from "./discover.mjs";
import { createHash, randomUUID } from "node:crypto";
import { openingDay } from "./letters.mjs";
import express from "express";
import { canViewRecord, createRelationshipRecord, projectRecord, nextOccurrence } from "./relationship-domain.mjs";
import { normalizeAssistantTurn, validateAssistantTurn } from "./assistant-agent.mjs";
import { addSpaceItem, archiveSpaceRecord, createSpace, ensureMomentSpaces, listSpaces, spaceContext, updateSpace, updateSpaceItem, visibleSpace } from "./space-domain.mjs";
import { sharePhotoCopy, visiblePhoto } from "./photo-store.mjs";
import { handoffUrl, isCalendar } from "./handoff.mjs";
import { prepareHandoff } from "./handoffs.mjs";
import { appendTogetherMessage, memberLanguage } from "./together-domain.mjs";
import { recordUsage } from "./usage.mjs";
import { importContext } from "./chat-import.mjs";
import { draftAgreementFromTogether } from "./together-domain.mjs";
import { askAboutPromise, openPromises } from "./promise-checks.mjs";
import { answerDateCheck, askAfterDate } from "./date-checks.mjs";
import { askToKnow } from "./know-you.mjs";
import { isAiLimit } from "./ai-budget.mjs";

const collections = { reminder: "reminders", checkin: "checkins", memory: "memories", plan: "privateAgentThreads", milestone: "milestones", agreement: "agreements", commitment: "commitments", space: "spaces", space_item: "spaceItems" };
const shareDigest = (share) => createHash("sha256").update(JSON.stringify([share.spaceId, share.title, share.text, share.date, share.photoId || null])).digest("hex");
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

export function createAssistantRouter({ store, mediator, reminderService, emit = () => {}, chatImports = null, activity = null, promises = null, profile = null }) {
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
    const validSources = new Map();
    for (const source of session.messages.flatMap((message) => message.sources || [])) {
      const key = `${source.channel}:${source.conversationId}`;
      if (!validSources.has(key)) validSources.set(key, await readableConversation(store, session.ownerUserId, source.channel, source.conversationId)
        .then((record) => conversationMessages(store, session.ownerUserId, source.channel, record)).then((messages) => new Set(messages.map((message) => message.id))).catch(() => new Set()));
    }
    return { id: session.id, language: session.language, timezone: session.timezone, version: session.version, ...(session.personId ? { personId: session.personId } : {}), earlierPages: session.earlier?.length || 0, messages: session.messages.map((message) => ({
      ...(message.sources?.length ? { sources: message.sources.filter((source) => validSources.get(`${source.channel}:${source.conversationId}`)?.has(source.messageId)) } : {}),
      id: message.id, role: message.role, text: message.text, createdAt: message.createdAt, ...(message.itemId ? { itemId: message.itemId } : {}), ...(["noted", "together_ask"].includes(message.kind) ? { kind: message.kind, ...(message.personId ? { personId: message.personId } : {}) } : {}), ...(message.call ? { call: message.call } : {}), ...(message.dateCheck ? { dateCheck: { title: message.dateCheck.title, date: message.dateCheck.date } } : {}), ...(message.dateAnswer ? { dateAnswer: { rating: message.dateAnswer.rating, told: Boolean(message.dateAnswer.toldAt) } } : {}), ...(message.photoIds?.length ? { photoIds: message.photoIds } : {}),
      ...(message.cards ? { cards: message.cards.map((reference) => {
        if (reference.kind === "link") return { id: reference.id, kind: "link", version: 1, title: reference.title, url: reference.url, status: "active" };
        if (reference.kind === "chat_import") return { id: reference.id, kind: "chat_import", version: 1, title: reference.title, status: "active", url: `/?view=import&import=${encodeURIComponent(reference.id)}` };
        if (reference.kind === "space_share") { const share = (session.pendingShares || []).find((item) => item.cardId === reference.id); return share ? { id: share.cardId, kind: "space_share", version: 1, title: share.spaceTitle, text: [share.title, share.text, share.date].filter(Boolean).join(" · "), photoId: share.photoId || null, digest: share.digest, status: share.sharedAt ? "shared" : "draft", url: share.kind === "date" ? "/?view=upcoming" : share.kind === "agreement" ? "/?channel=us" : share.album === "moments" ? "/?view=moments" : `/?view=space&space=${encodeURIComponent(share.spaceId)}`, ...(["date", "agreement"].includes(share.kind) ? { shareKind: share.kind } : {}) } : { id: reference.id, kind: "space_share", version: 1, status: "unavailable", title: "" }; }
        if (reference.kind === "partner_message") return { id: reference.id, kind: "partner_message", version: reference.version, title: say(session.language, "想对TA说的话", "Message for your partner", "Mensaje para tu pareja"), text: reference.text, digest: reference.digest, ...(reference.openOn ? { openOn: reference.openOn } : {}), status: session.partnerMessage?.cardId !== reference.id ? "superseded" : session.partnerMessage.sharedAt ? "shared" : "draft" };
        // Undone in one tap (founder 11-07, save time): the record is archived and the card says so.
        const undone = (session.undone || []).find((item) => item.id === reference.id);
        if (undone) return { id: reference.id, kind: reference.kind, version: reference.version, status: "undone", title: say(session.language, `已撤销：${undone.title}`, `Undone: ${undone.title}`, `Deshecho: ${undone.title}`) };
        const current = records.find(({ kind, record }) => kind === reference.kind && record.id === reference.id);
        if (!current && reference.title) return { id: reference.id, kind: reference.kind, version: reference.version, status: "unavailable", title: say(session.language, `已移走：${reference.title}`, `Removed: ${reference.title}`, `Quitado: ${reference.title}`) };
        return current ? card(current.kind, current.record, session.language) : { id: reference.id, kind: reference.kind, version: reference.version, status: "unavailable", title: say(session.language, "记录已归档或不可用", "Record archived or unavailable", "Registro archivado o no disponible") };
      }) } : {}),
    })) };
  };
  // `channel` marks a session owned by a channel adapter (iMessage keeps one running session per member and language).
  const createSession = async (userId, { language, timezone, channel = null, personId = null }) => {
    try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { throw fail(400, "Invalid IANA time zone."); }
    const session = privateRecord(userId, { intentType: "assistant", language, timezone, messages: [], aiAccessScope: "private", ...(channel ? { channel } : {}), ...(personId ? { personId } : {}) });
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
    // A person's own conversation: one per person, reopened rather than made twice. Only someone this member is getting to know.
    const personId = clean(req.body?.personId, 80);
    if (personId) {
      const userId = req.auth.user.id;
      const person = (await listPeople(store, userId)).find((item) => item.id === personId && livePerson(item, userId));
      if (!person) throw fail(404, "Not found.");
      const existing = (await store.listRelationshipRecordsForUser("privateAgentThreads", userId)).find((record) => record.intentType === "assistant" && record.ownerUserId === userId && record.personId === personId && !record.archivedAt && record.status === "active");
      return res.status(existing ? 200 : 201).json({ session: await output(existing || await createSession(userId, { language, timezone: clean(req.body?.timezone, 64) || "UTC", personId })) });
    }
    const session = await createSession(req.auth.user.id, { language, timezone: clean(req.body?.timezone, 64) || "UTC" });
    // Made because they opened Just me (not because they started typing): if Pinky barely knows them yet (judged from what it
    // has kept), it speaks first with its opening question.
    res.status(201).json({ session: await output((req.body?.opened === true && await askToKnow(store, { userId: req.auth.user.id, session }).catch(() => null)) || session) });
  });
  // The member's most recent App conversation, for a device that has not remembered one (it may hold a question from Us).
  router.get("/assistant/sessions/latest", async (req, res) => {
    const sessions = (await store.listRelationshipRecordsForUser("privateAgentThreads", req.auth.user.id)).filter((record) => record.intentType === "assistant" && record.ownerUserId === req.auth.user.id && record.visibility === "private" && !record.archivedAt && record.status === "active" && !record.personId && !record.channel);
    const latest = sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (!latest) throw fail(404, "No conversation yet.");
    res.json({ session: await output((await askToKnow(store, { userId: req.auth.user.id, session: latest }).catch(() => null)) || (await askAfterDate(store, { userId: req.auth.user.id, session: latest }).catch(() => null)) || (await askAboutPromise(store, { userId: req.auth.user.id, session: latest }).catch(() => null)) || latest) });
  });
  // The earlier pages of a long conversation (oldest first within a page); page 1 is the most recent page.
  router.get("/assistant/sessions/:id/earlier", async (req, res) => {
    const session = await owned(store, req.params.id, req.auth.user.id);
    const pages = session.earlier || [], page = Math.max(1, Math.min(pages.length, Number(req.query.page) || 1));
    if (!pages.length) return res.json({ messages: [], pages: 0 });
    const shown = await output({ ...session, earlier: [], messages: pages[pages.length - page].messages });
    res.json({ messages: shown.messages, page, pages: pages.length });
  });
  router.get("/assistant/sessions/:id/locate", async (req, res) => {
    const result = await locateConversation({ store, userId: req.auth.user.id, channel: "me", conversationId: req.params.id,
      messageId: clean(req.query.messageId, 80), date: clean(req.query.date, 10), timezone: clean(req.query.timezone, 64) || "UTC", direction: clean(req.query.direction, 10) });
    const shown = await output({ ...result.record, messages: result.messages });
    const { record, ...page } = result;
    res.json({ ...page, messages: shown.messages, ...(record.personId ? { personId: record.personId } : {}) });
  });
  router.get("/assistant/sessions/:id", async (req, res) => {
    const session = await owned(store, req.params.id, req.auth.user.id);
    res.json({ session: await output((req.query.opened === "1" && ((await askToKnow(store, { userId: req.auth.user.id, session }).catch(() => null)) || (await askAfterDate(store, { userId: req.auth.user.id, session }).catch(() => null)) || await askAboutPromise(store, { userId: req.auth.user.id, session }).catch(() => null))) || session) });
  });
  // Each promise's own latest answer, for the Agreements page; private to this member.
  router.get("/assistant/promises", async (req, res) => {
    const sessions = (await store.listRelationshipRecordsForUser("privateAgentThreads", req.auth.user.id)).filter((record) => record.intentType === "assistant" && record.ownerUserId === req.auth.user.id && !record.archivedAt);
    const answers = {};
    for (const entry of sessions.flatMap((session) => session.promiseLog || []).sort((a, b) => a.at.localeCompare(b.at))) answers[entry.commitmentId] = { done: entry.done, at: entry.at, note: entry.note || "" };
    res.json({ promises: answers });
  });

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
        if (kind === "checkin" && isCycleRecord(record)) continue; // 经期 records are kept by kind period only
        records.push({ kind, record });
      }
    }
    return records.sort((a, b) => b.record.updatedAt.localeCompare(a.record.updatedAt));
  }
  const card = (kind, record, language) => ({
    id: record.id, kind, title: record.title || record.draft?.title || (kind === "space" ? "" : record.description) || say(language, kind === "memory" ? "私人记忆" : "日常记录", kind === "memory" ? "Private memory" : "Daily check-in", kind === "memory" ? "Recuerdo privado" : "Registro diario"),
    text: record.text || record.draft?.shareableSummary || record.summary || (kind === "space" ? record.description : null) || null, status: record.status, version: record.version,
    // The memory albums open as Moments, under their own name in every language.
    ...(kind === "space" && record.system === "moments" ? { title: say(language, "回忆", "Moments", "Momentos") } : {}),
    ...(kind === "space" && record.system === "watched" ? { title: say(language, "一起看过的", "Watched together", "Vistos juntos") } : {}),
    url: record.system === "watched" || record.album === "watched" ? "/?view=moments&watched=1" : record.system === "moments" || record.album === "moments" ? "/?view=moments" : kind === "space" ? `/?view=space&space=${encodeURIComponent(record.id)}` : kind === "space_item" ? `/?view=space&space=${encodeURIComponent(record.spaceId)}` : kind === "reminder" ? `/?view=reminders&reminder=${encodeURIComponent(record.id)}` : ["agreement", "commitment"].includes(kind) ? `/?view=decide&issue=${encodeURIComponent(record.issueId || "")}` : kind === "milestone" ? `/?view=plans&milestone=${encodeURIComponent(record.id)}` : kind === "plan" ? `/?view=plans&thread=${encodeURIComponent(record.id)}` : `/?view=${kind === "memory" ? "memories" : "checkins"}`,
    ...(kind === "reminder" ? { localDateTime: localTime(record.dueAt, record.timezone), timezone: record.timezone, frequency: record.frequency, nextOccurrenceOnly: Boolean(record.occurrenceOriginalDueAt), weeklyTime: record.localTime } : {}),
    ...(kind === "plan" ? { date: record.draft?.date } : {}),
  });
  // One private turn, shared by the App routes and the iMessage adapter. Returns the raw session and whether `itemId` was already handled.
  // While a turn runs, this member alone can see which step Pinky is on (App, iMessage or call alike); it ends with the turn.
  const appendTurn = async (userId, sessionId, body, options = {}) => {
    const progress = activity ? activity.forMember(userId) : () => {};
    try {
      const result = await runTurn(userId, sessionId, body, { ...options, progress });
      // A promise said here stays this member's alone; it is noticed in the background once the chat goes quiet.
      if (!result.duplicate) { promises?.notePrivate(userId, sessionId); profile?.notePrivate(userId, sessionId); }
      if ((result.session.earlier?.length || 0) > (result.session.summarizedPages || 0)) void summarizeEarlier({ store, mediator, userId, sessionId }).catch((error) => console.error("Could not summarise the earlier conversation:", error?.message || error));
      // "我和阿杰在一起了": the one moment Pinky asks whether someone is the one (founder 11-09, three stages).
      if (!result.duplicate) {
        const person = await togetherWith(store, userId, body?.text).catch(() => null);
        if (person) {
          await store.transaction(`user:${userId}`, (tx) => markAsked(tx, userId, person.id));
          const name = person.name.replace(/[（(][^）)]*[）)]/g, "").trim() || person.name;
          const asked = await postNote(userId, { sessionId: result.session.id, language: result.session.language, kind: "together_ask", personId: person.id, text: say(result.session.language, `听起来你和${name}确定了？`, `Sounds like you and ${name} are together?`, `¿Parece que tú y ${name} están juntos?`) }).catch(() => null);
          if (asked) result.session = asked;
        }
      }
      return result;
    } finally { progress(null); }
  };
  const runTurn = async (userId, sessionId, body, { channel = "app", progress }) => {
    const session = await owned(store, sessionId, userId);
    const text = clean(body?.text, 2000); const itemId = clean(body?.itemId, 120);
    const photoIds = Array.isArray(body?.photoIds) ? [...new Set(body.photoIds.map((id) => clean(id, 80)).filter(Boolean))].slice(0, 6) : [];
    if ((!text && !photoIds.length) || !itemId) throw fail(400, "Text and a unique itemId are required.");
    for (const id of photoIds) { const photo = await visiblePhoto(store, id, userId); if (photo.ownerUserId !== userId || photo.visibility !== "private") throw fail(400, "Send photos from this conversation."); }
    if (session.messages.some((message) => message.itemId === itemId)) return { session, duplicate: true };
    const records = await available(store, userId);
    await ensureMomentSpaces(store, userId);
    const userMessage = { id: randomUUID(), role: "user", text, itemId, ...(photoIds.length ? { photoIds } : {}), createdAt: new Date().toISOString() };
    const context = {
      now: new Date().toISOString(), timezone: session.timezone, localDateTime: localTime(new Date(), session.timezone),
      // The whole recent exchange, so the model sees what it already did; only the last message is the new request.
      // A voice call appears as its captions, so the user can refer back to what was said on the call.
      messages: [...session.messages.map(({ role, text, call }) => ({ role, text: call ? `[Voice call] ${call.rows.map((row) => `${row.role === "agent" ? "Pinky" : "User"}: ${row.text}`).join("\n")}`.slice(-3000) : role === "assistant" ? String(text || "").slice(0, 600) : text })), userMessage].slice(-30),
      // Notes kept about people are already in context.profile with their ids; Pinky's own bookkeeping (people, portraits,
      // tidy state, what the member wants) is never a record to act on (scale test 11-09: after years these crowded out the rest).
      records: records.filter(({ kind, record }) => kind !== "memory" || !record.kind || record.kind === "memory").slice(0, 200).map(({ kind, record }) => ({ id: record.id, kind, version: record.version, status: record.status, ...(kind === "reminder" ? { frequency: record.frequency } : {}), ...(kind === "checkin" ? { date: localTime(record.createdAt, session.timezone).slice(0, 10) } : {}) })),
      partnerDraft: session.partnerMessage && !session.partnerMessage.sharedAt ? { cardId: session.partnerMessage.cardId, text: session.partnerMessage.text, openOn: session.partnerMessage.openOn || null } : null,
      recentCards: ([...session.messages].reverse().find((message) => message.cards?.length)?.cards || []).map(({ id, kind, version }) => ({ id, kind, version })),
      webSearch: Boolean(mediator.webSearch), attachedPhotos: photoIds,
      ...(session.earlierSummary ? { earlier: session.earlierSummary } : {}),
      openPromises: await openPromises(store, userId, session).catch(() => []),
      notTriedYet: await notTriedYet(store, userId, "me").catch(() => []),
      gettingToKnow: await gettingToKnow(store, userId).catch(() => false),
      cycle: await cycleContext(store, userId, localTime(new Date(), session.timezone).slice(0, 10)).catch(() => null),
      profile: await profileContext(store, userId).then((profile) => session.personId ? { ...profile, people: (profile.people || []).filter((person) => person.id === session.personId) } : profile).catch(() => ({ me: [], partner: [], us: [] })),
      // A person's own conversation (founder 11-09): everything here is about this one person.
      ...(session.personId ? { focus: await listPeople(store, userId, { archived: true }).then((people) => { const person = people.find((item) => item.id === session.personId); return person ? { personId: person.id, name: person.name } : null; }).catch(() => null) } : {}),
      chatImports: chatImports ? importContext((await store.listRelationshipRecordsForUser("chatImports", userId)).filter((record) => canViewRecord(record, userId))) : [],
      screenshotConversation: chatImports?.screenshotContext ? await chatImports.screenshotContext(userId, session.id) : null,
      spaces: await (async () => { const all = await listSpaces(store, userId); return [...spaceContext(all, { shared: false }).map((space) => ({ ...space, shared: false })), ...spaceContext(all, { shared: true }).map((space) => ({ ...space, shared: true }))]; })(),
    };
    // Pinky answers in the interface language this member picked, whatever language they type in (founder 11-06: one language everywhere, the one each member picked).
    const language = await memberLanguage(store, userId, body?.language);
    const unavailable = () => fail(503, say(language, "Pinky 暂时不可用，什么都没有改动。请稍后再试。", "Pinky is unavailable right now. Nothing was changed; please try again later.", "Pinky no está disponible ahora. No se cambió nada; inténtalo de nuevo más tarde."));
    let plan; const recallSources = [];
    const recalled = await prefetchRecall({ store, userId, personId: session.personId || null }, text).catch(() => null);
    if (recalled) { context.lookups = [recallLookup(recalled, text)]; recallSources.push(...recalled.sources); }
    progress("thinking");
    try { plan = await mediator.planAssistantTurn(context, language); }
    catch (error) { if (isAiLimit(error)) throw error; throw unavailable(); }
    plan = normalizeAssistantTurn(plan);
    // A plan with no words and no action was shown as the generic "你想创建、查找还是修改什么？" (use-case regression 11-09:
    // asked what to bring to meet her parents). The model is asked once more before that fallback can appear.
    if (validateAssistantTurn(plan) && !clean(plan.reply, 1200) && !plan.actions.length) {
      try { plan = normalizeAssistantTurn(await mediator.planAssistantTurn(context, language)); }
      catch (error) { if (isAiLimit(error)) throw error; throw unavailable(); }
    }
    // A malformed answer is asked for once more before the member sees an error (memory eval 11-09: an old question
    // after a long history came back as a 502 about one time in three).
    if (!validateAssistantTurn(plan)) {
      try { plan = normalizeAssistantTurn(await mediator.planAssistantTurn(context, language)); }
      catch (error) { if (isAiLimit(error)) throw error; throw unavailable(); }
    }
    // The shape only (keys, kinds, operations), never what anyone wrote: enough to find why a planner answer failed.
    if (!validateAssistantTurn(plan)) { console.error("Invalid planner turn:", JSON.stringify({ keys: Object.keys(plan || {}), actions: Array.isArray(plan?.actions) ? plan.actions.map((action) => ({ keys: Object.keys(action || {}), kind: action?.kind, operation: action?.operation, fields: Object.keys(action?.fields || {}) })) : typeof plan?.actions })); throw fail(502, "The assistant could not prepare a valid action. Nothing was changed."); }
    // A turn that needs the outside world: look it up, then plan once more with the findings. Searches never run twice.
    const searches = plan.actions.filter((action) => action.kind === "web_search" && mediator.lookup || action.kind === "chat_search" && chatImports || action.kind === "memory_search" && !recalled).slice(0, 3);
    if (searches.length) {
      const web = searches.find((action) => action.kind === "web_search");
      progress(web ? "searching_web" : "searching_chats", web?.query || null);
      // Chat searches read only imports this member can see; the shared copy of a couple's import is searchable by both.
      const lookups = await Promise.all(searches.map(async (action) => action.kind === "memory_search"
        ? await searchMemoryResults({ store, userId, query: action.query || "", date: action.fields?.date || "", personId: session.personId || null }).then((result) => { recallSources.push(...result.sources); return recallLookup(result, `${action.query || ""} ${action.fields?.date || ""}`.trim()); }).catch(() => ({ query: action.query, findings: "The search failed. Say the search failed, not that no record exists." }))
        : action.kind === "chat_search"
        ? { query: `chat history ${action.query || ""} ${action.fields?.date || ""}`.trim(), findings: await chatImports.search(userId, action.targetId, { query: action.query || "", date: action.fields?.date || "" }).catch(() => "This chat history is not available.") }
        : { query: action.query, findings: await mediator.lookup(action.query, language).catch(() => "No results: the search failed.") }));
      progress("writing");
      try { plan = normalizeAssistantTurn(await mediator.planAssistantTurn({ ...context, lookups }, language)); }
      catch (error) { if (isAiLimit(error)) throw error; throw unavailable(); }
      if (!validateAssistantTurn(plan)) throw fail(502, "The assistant could not prepare a valid action. Nothing was changed.");
    }
    // Screenshots to import are read in the background (minutes); the finished analysis is posted back here.
    if (chatImports && photoIds.length && plan.actions.some((action) => action.kind === "chat_import")) {
      // Its question is read with the screenshots, never again by the private profile scan (watch 11-09).
      userMessage.screenshots = true;
      void chatImports.importScreenshots({ id: userId, name: "" }, photoIds, { sessionId: session.id, language, messageId: userMessage.id, question: text })
        .catch((error) => postNote(userId, { sessionId: session.id, language: session.language, text: error.statusCode === 422 ? error.message : say(session.language, "这些截图没能读出来，可以再试一次，或者换成导出的文件。", "I couldn't read those screenshots. Try again, or send an exported file.", "No pude leer esas capturas. Inténtalo de nuevo o envía un archivo exportado.") }).catch(() => {}));
    }
    plan = { ...plan, actions: plan.actions.filter((action) => !["web_search", "chat_search", "memory_search", "chat_import"].includes(action.kind)) };
    if (plan.actions.length) progress(plan.actions.every((action) => action.operation === "query") ? "checking_records" : "acting");
    const changes = []; let partnerMessage = null; let raced = false; const pendingShares = []; const promiseAnswers = [];
    const updated = await store.transaction("reminder-delivery", async (tx) => {
      await liveUser(tx, userId, true);
      const latest = await owned(tx, session.id, userId);
      if (latest.messages.some((message) => message.itemId === itemId)) { raced = true; return latest; }
      if (latest.version !== session.version) throw fail(409, say(session.language, "已有新消息，请刷新后重试。", "A new message arrived. Refresh and retry.", "Hay un mensaje nuevo. Actualiza y vuelve a intentarlo."));
      const currentRecords = await available(tx, userId);
      const cards = []; const replies = []; let createdSpace = null; const handoffLines = []; let askBack = ""; const searched = [];
      for (const action of plan.actions) {
        if (action.kind === "promise") {
          if (!context.openPromises.some((promise) => promise.id === action.targetId)) throw fail(404, "This promise is no longer open.");
          promiseAnswers.push({ commitmentId: action.targetId, done: action.fields.done === true, note: clean(action.fields?.text, 300), at: new Date().toISOString() }); continue;
        }
        if (action.kind === "partner_message") {
          // A draft only: it stays on this private session until the member confirms the exact digest via share-confirm.
          const text = clean(action.fields?.text, 2000); if (!text) throw fail(400, "Say what you would like your partner to hear.");
          // With an opening day after today it is a letter (情书 / 时光胶囊): the writer confirms the words and the day together.
          const openOn = openingDay(action.fields?.date, session.timezone);
          partnerMessage = { cardId: randomUUID(), text, openOn, digest: createHash("sha256").update(openOn ? `${text}
${openOn}` : text).digest("hex"), createdAt: new Date().toISOString(), sharedAt: null, messageId: null };
          cards.push({ id: partnerMessage.cardId, kind: "partner_message", version: 1, text, digest: partnerMessage.digest, ...(openOn ? { openOn } : {}) });
          replies.push(say(session.language, "已为你起草好想对 TA 说的话。你确认之前不会分享，也不会分享你的原话。", "I drafted what you would like your partner to hear. Nothing is shared, and your own words never are, until you confirm.", "Redacté lo que quieres que tu pareja escuche. No se comparte nada, ni tus palabras originales, hasta que lo confirmes.")); continue;
        }
        if (action.kind === "handoff") {
          // Prepared, never completed (founder 11-06): links into the real services with everything filled in; the last tap is
          // the member's own. A missing date, time or party size is asked for, never guessed.
          const prepared = prepareHandoff(action.operation, action.fields.handoff, { language, today: context.localDateTime.slice(0, 10) });
          if (prepared.missing) { askBack = askBack || prepared.question; continue; }
          cards.push(...prepared.cards.map((link) => ({ id: randomUUID(), version: 1, ...link })));
          handoffLines.push(prepared.summary, prepared.script); continue;
        }
        if ((!Object.hasOwn(collections, action.kind) && action.kind !== "link" && action.kind !== "period") || !["create", "update", "archive", "query"].includes(action.operation)) throw fail(502, "Unsupported assistant operation. Nothing was changed.");
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
          searched.push(results.length);
          replies.push(say(session.language, `找到 ${results.length} 条你可以查看的记录。`, `Found ${results.length} records you can view.`, `Se encontraron ${results.length} registros que puedes ver.`)); continue;
        }
        // Just me is where everything can start (founder 11-06): a plan or date for the two of them prepares a card, and only the
        // member's confirmation puts it on their shared calendar (space-confirm), like a shared memory.
        if (action.kind === "milestone" && action.operation === "create") {
          const values = action.fields, title = clean(values.title, 120), date = /^\d{4}-\d{2}-\d{2}$/.test(values.date || "") ? values.date : null;
          if (!title || !date) throw fail(400, say(session.language, "要放进日历的是哪天、做什么？", "Which day, and what, goes on the calendar?", "¿Qué día y qué pongo en el calendario?"));
          const pair = await tx.getRelationshipContext(userId);
          if (!(pair?.relationship?.status === "active" && pair.members.length === 2)) { replies.push(say(session.language, "等 TA 加入后，才有你们俩的日历；我先记在你这里。", "Your shared calendar starts once your partner joins; I'll keep it here for you.", "Su calendario compartido empieza cuando tu pareja se una; lo guardo aquí para ti.")); continue; }
          const share = { cardId: randomUUID(), kind: "date", spaceId: null, spaceTitle: say(session.language, "你们俩的日历", "your shared calendar", "su calendario compartido"), title, text: "", date };
          share.digest = shareDigest(share); pendingShares.push(share);
          cards.push({ id: share.cardId, kind: "space_share", version: 1 });
          replies.push(say(session.language, "要放进你们俩的日历吗？点一下确认，前一天我会提醒你们俩。", "Put it on your shared calendar? Tap to confirm; I'll remind you both the day before.", "¿Lo pongo en su calendario compartido? Confírmalo y les aviso a los dos un día antes.")); continue;
        }
        // A lasting agreement can start in Just me too (founder 11-07): a card the member confirms, which then drafts it in Us
        // for both of them to approve. Nothing reaches the partner before that tap.
        if (action.kind === "agreement" && action.operation === "create") {
          const values = action.fields, title = clean(values.title, 120), text = clean(values.text, 1000);
          if (!title || !text) throw fail(400, say(session.language, "想和 TA 说好什么？说说具体怎么做。", "What do you want to agree on? Tell me how it would work.", "¿Qué quieren acordar? Cuéntame cómo sería."));
          const pair = await tx.getRelationshipContext(userId);
          if (!(pair?.relationship?.status === "active" && pair.members.length === 2)) { replies.push(say(session.language, "等 TA 加入后，你们才能一起定约定；我先记在你这里。", "Agreements start once your partner joins; I'll keep this here for you.", "Los acuerdos empiezan cuando tu pareja se una; lo guardo aquí.")); continue; }
          const share = { cardId: randomUUID(), kind: "agreement", spaceId: null, spaceTitle: say(session.language, "我们俩的约定", "an agreement in Us", "un acuerdo en Nosotros"), title, text, date: null };
          share.digest = shareDigest(share); pendingShares.push(share);
          cards.push({ id: share.cardId, kind: "space_share", version: 1 });
          replies.push(say(session.language, "要在“我们俩”里把它起草成约定吗？点一下确认，TA 也同意了才算数。", "Draft it as an agreement in Us? Tap to confirm; it counts once your partner agrees too.", "¿Lo redacto como acuerdo en Nosotros? Confírmalo; cuenta cuando tu pareja también acepte.")); continue;
        }
        if (["agreement", "commitment", "milestone"].includes(action.kind)) throw fail(502, "Shared records require their existing confirmation flow. Nothing was changed.");
        if (action.kind === "link") {
          const values = action.fields; const calendar = isCalendar(values.text, values.localDateTime);
          const url = handoffUrl({ url: calendar ? null : values.text, localDateTime: calendar ? values.localDateTime : null, title: clean(values.title, 120), location: calendar ? clean(values.text, 200) : "", timezone: session.timezone });
          if (url) cards.push({ id: randomUUID(), kind: "link", version: 1, title: clean(values.title, 60), url });
          continue;
        }
        if (action.kind === "period") {
          // 经期: the member's own private record; nothing reaches the partner or the shared Pinky.
          const day = action.fields.date && /^\d{4}-\d{2}-\d{2}$/.test(action.fields.date) ? action.fields.date : localTime(new Date(), session.timezone).slice(0, 10);
          const record = await logPeriod(tx, { userId, event: action.fields.title, date: day });
          changes.push({ kind: "checkin", record });
          replies.push(action.fields.title === "start" ? say(session.language, "记下了，只有你能看到。", "Noted, just for you.", "Anotado, solo para ti.") : say(session.language, "记下了这次结束的日子。", "Noted when it ended.", "Anotado cuándo terminó."));
          continue;
        }
        if (action.kind === "space" || action.kind === "space_item") {
          const values = action.fields; const sharedOnly = say(session.language, "共同空间里的东西请在“我们俩”里改。", "Change things in a shared space from Us.", "Cambia lo del espacio compartido desde Nosotros.");
          let record;
          if (action.kind === "space") {
            if (action.operation === "create") record = createdSpace = await createSpace(tx, { userId, title: values.title, layout: values.layout, description: values.text || "", source: "assistant" });
            else {
              const space = await visibleSpace(tx, action.targetId, userId); if (space.visibility !== "private") throw fail(403, sharedOnly);
              record = action.operation === "archive" ? await archiveSpaceRecord(tx, { userId, collection: "spaces", id: space.id }) : await updateSpace(tx, { userId, id: space.id, fields: { title: values.title ?? undefined, layout: values.layout ?? undefined, description: values.text ?? undefined } });
            }
          } else if (action.operation === "create") {
            const space = values.spaceId ? await visibleSpace(tx, values.spaceId, userId) : createdSpace;
            if (!space) throw fail(400, say(session.language, "要放进哪个空间？", "Which space should this go in?", "¿En qué espacio lo guardo?"));
            if (space.visibility !== "private") {
              // Nothing said here reaches a shared space until the member confirms this exact card.
              const share = { cardId: randomUUID(), spaceId: space.id, spaceTitle: space.system === "moments" ? say(session.language, "回忆", "memories", "recuerdos") : space.system === "watched" ? say(session.language, "你们一起看过的", "what you've watched together", "lo que han visto juntos") : space.title, ...(space.system ? { album: space.system } : {}), title: clean(values.title, 160), text: clean(values.text, 2000), date: values.date && /^\d{4}-\d{2}-\d{2}$/.test(values.date) ? values.date : null, photoId: values.photoId ? (await visiblePhoto(tx, values.photoId, userId)).id : null, createdAt: new Date().toISOString(), sharedAt: null };
              if (!share.title && !share.text && !share.photoId) throw fail(400, "Say what to add.");
              share.digest = shareDigest(share); pendingShares.push(share);
              cards.push({ id: share.cardId, kind: "space_share", version: 1 });
              replies.push(say(session.language, `确认后才会放进共同的“${space.title}”。`, `It goes into the shared "${space.title}" only after you confirm.`, `Se añade al espacio compartido «${space.title}» solo cuando lo confirmes.`)); continue;
            }
            const photo = values.photoId ? await visiblePhoto(tx, values.photoId, userId) : null;
            if (photo && (photo.ownerUserId !== userId || photo.visibility !== "private")) throw fail(400, "That photo cannot go here.");
            record = await addSpaceItem(tx, { userId, space, title: values.title || "", text: values.text || "", date: values.date, done: values.done === true, photoId: photo?.id || null, source: "assistant" });
          } else {
            const item = await tx.getRelationshipRecordForUser("spaceItems", clean(action.targetId, 80), userId);
            if (!item || !canViewRecord(item, userId)) throw fail(404, "This item is no longer available.");
            if (item.visibility !== "private") throw fail(403, sharedOnly);
            record = action.operation === "archive" ? await archiveSpaceRecord(tx, { userId, collection: "spaceItems", id: item.id }) : await updateSpaceItem(tx, { userId, id: item.id, fields: { title: values.title ?? undefined, text: values.text ?? undefined, date: values.date ?? undefined, done: values.done ?? undefined } });
          }
          cards.push(card(action.kind, record, session.language)); changes.push({ kind: action.kind, record });
          replies.push(action.operation === "archive" ? say(session.language, "已移走。", "Removed.", "Quitado.") : action.kind === "space" ? say(session.language, `已建好“${record.title}”，只有你能看到。`, `Created "${record.title}", visible only to you.`, `Creé «${record.title}», solo visible para ti.`) : say(session.language, "已放进去。", "Added.", "Añadido."));
          continue;
        }
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
                Object.assign(patch, { localDateTime: /^\d{2}:\d{2}$/.test(values.localDateTime || "") ? `${localTime(anchor, current.timezone).slice(0, 10)}T${values.localDateTime}` : values.localDateTime || localTime(anchor, current.timezone), timezone: values.timezone || current.timezone, frequency: values.frequency || current.frequency, occurrence: current.frequency === "weekly" ? action.occurrence : null });
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
            patch = { text, kind: current?.kind === "profile" ? "profile" : action.kind, aiAccessScope: current?.kind === "profile" ? current.aiAccessScope : "none", approvals: [], ...(action.kind === "checkin" ? { mood: values.mood ?? current?.mood ?? null } : {}) };
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
      // The model's own words lead; the server's receipts stand in when it gave none. A failed action never reaches here.
      // A prepared booking or purchase is summarized by the server from what it actually prepared, never by the model, which
      // tends to restate the details or call it booked.
      // A turn that only looked things up and found nothing says so plainly: the model's own line often promised results
      // ("我来找找…结果会直接显示给你"), which left the person waiting for nothing, or invited a made-up memory (founder 11-07).
      const foundNothing = searched.length && searched.length === plan.actions.length && searched.every((count) => count === 0);
      const own = foundNothing ? say(session.language, "我这里没有找到这件事的记录，不想凭印象乱说。你愿意的话，跟我讲讲当时发生了什么，我帮你记下来。", "I have no record of that, and I'd rather not guess. If you like, tell me what happened and I'll keep it.", "No tengo ningún registro de eso y prefiero no inventar. Si quieres, cuéntame qué pasó y lo guardo.")
        : handoffLines.length ? [...replies, ...handoffLines].filter(Boolean).join("\n") : clean(plan.reply, 1200) || replies.join("\n");
      const reply = (askBack && !cards.length ? askBack : [own, askBack].filter(Boolean).join("\n")) || say(session.language, "你想创建、查找还是修改什么？", "What would you like to create, find, or change?", "¿Qué quieres crear, buscar o cambiar?");
      const cited = citedReply(reply, recallSources);
      const saved = await tx.updateRelationshipRecordForUser("privateAgentThreads", latest.id, userId, (draft) => { if (draft.version !== session.version) throw fail(409, "The conversation changed."); draft.messages.push(userMessage, { id: randomUUID(), role: "assistant", text: cited.reply, ...(cited.sources.length ? { sources: cited.sources } : {}), cards: cards.map(({ id, kind, version, text, digest, title, url, openOn }) => ({ id, kind, version, ...(kind === "partner_message" ? { text, digest, ...(openOn ? { openOn } : {}) } : kind === "link" ? { title, url } : ["space", "space_item"].includes(kind) ? { title } : {}) })), plannerQuestion: !plan.actions.length || Boolean(askBack) && !cards.length, createdAt: new Date().toISOString() }); keepMessages(draft, draft.messages); if (partnerMessage) draft.partnerMessage = partnerMessage; if (pendingShares.length) draft.pendingShares = [...(draft.pendingShares || []).filter((item) => !item.sharedAt).slice(-9), ...pendingShares]; if (promiseAnswers.length) draft.promiseLog = [...(draft.promiseLog || []), ...promiseAnswers].slice(-200); draft.version += 1; });
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
      if (!draft || draft.cardId !== cardId || draft.digest !== digest || createHash("sha256").update(draft.openOn ? `${draft.text}
${draft.openOn}` : draft.text).digest("hex") !== digest) throw fail(409, say(session.language, "这段话已经修改，请确认最新的版本。", "This message changed. Review and confirm the latest version.", "Este mensaje cambió. Revisa y confirma la última versión."));
      // Already shared: answer from the durable stamp instead of the handle, which only dedupes within the last 200 messages.
      if (draft.sharedAt) return { duplicate: true, message: { id: draft.messageId, text: draft.text, createdAt: draft.sharedAt }, session: latest };
      // A letter is kept instead (founder 11-06): nothing goes to Us or the shared calendar; on its day Pinky reminds the writer
      // privately and hands it over to send themselves (letters.mjs).
      if (draft.openOn) {
        await tx.createRelationshipRecord("consentEvents", privateRecord(userId, { relationshipId: initial.relationship.id, approvalPolicy: "owner", status: "recorded", objectId: draft.cardId, objectType: "letter", eventType: "letter.kept", sourceVersion: latest.version }));
        const at = new Date().toISOString();
        const saved = await tx.updateRelationshipRecordForUser("privateAgentThreads", latest.id, userId, (record) => {
          record.partnerMessage = { ...record.partnerMessage, sharedAt: at, messageId: null };
          record.letters = [...(Array.isArray(record.letters) ? record.letters : []), { cardId: draft.cardId, text: draft.text, openOn: draft.openOn, relationshipId: initial.relationship.id, sealedAt: at, deliveredAt: null }];
          record.version += 1;
        });
        return { duplicate: false, kept: true, message: null, conversation: null, session: saved };
      }
      const sent = await appendTogetherMessage(tx, { relationshipId: initial.relationship.id, actorUserId: userId, source: "relay", kind: "relay", text: draft.text, handle: `partner_message:${draft.cardId}`, refs: [{ type: "partner_message", id: draft.cardId }] });
      if (sent.duplicate) return { ...sent, session: latest };
      await tx.createRelationshipRecord("consentEvents", privateRecord(userId, { relationshipId: initial.relationship.id, approvalPolicy: "owner", status: "recorded", objectId: draft.cardId, objectType: "partner_message", eventType: "partner_message.shared", sourceVersion: latest.version }));
      const saved = await tx.updateRelationshipRecordForUser("privateAgentThreads", latest.id, userId, (record) => { record.partnerMessage = { ...record.partnerMessage, sharedAt: new Date().toISOString(), messageId: sent.message.id }; record.version += 1; });
      return { ...sent, session: saved };
    });
    if (!result.duplicate && result.conversation) { emit(result.conversation, "together.updated"); void recordUsage(store, { userId, relationshipId: initial.relationship.id, action: "partner_message_shared", channel }); }
    if (result.kept) void recordUsage(store, { userId, relationshipId: initial.relationship.id, action: "letter_kept", channel });
    return result;
  };
  // A prepared item enters a shared space only when its owner confirms the exact card they saw.
  router.post("/assistant/sessions/:id/space-confirm", async (req, res) => {
    const userId = req.auth.user.id; const session = await owned(store, req.params.id, userId);
    const cardId = clean(req.body?.cardId, 80); const digest = clean(req.body?.digest, 64);
    const initial = await store.getRelationshipContext(userId);
    if (!activePair(initial)) throw fail(409, unpaired(session.language));
    const result = await store.transaction(`relationship:${initial.relationship.id}`, async (tx) => {
      await liveUser(tx, userId, true);
      const latest = await owned(tx, session.id, userId); const share = (latest.pendingShares || []).find((item) => item.cardId === cardId);
      if (!share || share.digest !== digest || shareDigest(share) !== digest) throw fail(409, say(session.language, "内容已经变了，请确认最新的版本。", "This changed. Review and confirm the latest version.", "Esto cambió. Revisa y confirma la última versión."));
      if (share.sharedAt) return { session: latest, item: null };
      if (share.kind === "agreement") {
        const terms = String(share.text || "").split(/[；;\n]+/).map((item) => item.trim()).filter(Boolean).slice(0, 8);
        let agreement;
        try { agreement = await draftAgreementFromTogether(tx, { relationshipId: initial.relationship.id, userId, values: { title: share.title, summary: share.text || share.title, terms: terms.length ? terms : [share.title] }, language: session.language }); }
        catch (error) { if (error?.code === "one_pending_agreement") throw fail(409, say(session.language, "“我们俩”里已经有一个约定在等你们点头，先处理完那个，再起草这个。", "There's already an agreement waiting for you both in Us. Settle that one first.", "Ya hay un acuerdo esperando a los dos en Nosotros. Resuelvan ese primero.")); throw error; }
        await tx.createRelationshipRecord("consentEvents", privateRecord(userId, { relationshipId: initial.relationship.id, approvalPolicy: "owner", status: "recorded", objectId: agreement.id, objectType: "agreement", eventType: "agreement.drafted_from_private", sourceVersion: latest.version }));
        const saved = await tx.updateRelationshipRecordForUser("privateAgentThreads", latest.id, userId, (record) => { record.pendingShares = record.pendingShares.map((item) => item.cardId === cardId ? { ...item, sharedAt: new Date().toISOString() } : item); record.version += 1; });
        return { session: saved, item: null, agreement };
      }
      if (share.kind === "date") {
        // On their shared calendar, with Pinky's reminder in Us the day before, and a line in Us so the other one knows.
        const milestone = privateRecord(userId, { relationshipId: initial.relationship.id, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "active", type: "custom", title: share.title, date: share.date, timezone: "UTC", recurringRule: "once", jointlyConfirmed: false, notes: "", provenanceSource: "member_confirmed" });
        await tx.createRelationshipRecord("milestones", milestone);
        await tx.createRelationshipRecord("reminders", privateRecord(userId, { relationshipId: initial.relationship.id, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "owner", status: "active", milestoneId: milestone.id, minutesBefore: 1440, channel: "in_app", provenanceSource: "member_confirmed" }));
        await tx.createRelationshipRecord("consentEvents", privateRecord(userId, { relationshipId: initial.relationship.id, approvalPolicy: "owner", status: "recorded", objectId: milestone.id, objectType: "milestone", eventType: "milestone.shared", sourceVersion: latest.version }));
        const me = (await tx.getRelationshipContext(userId))?.members.find((member) => member.userId === userId)?.user?.name || "";
        const day = (language) => new Date(`${share.date}T12:00:00Z`).toLocaleDateString(language === "zh" ? "zh-CN" : language, { month: "short", day: "numeric", weekday: "short", timeZone: "UTC" });
        const i18n = { zh: `${me} 把「${share.title}」放进了你们俩的日历：${day("zh")}。前一天我会提醒你们。`, en: `${me} put "${share.title}" on your calendar: ${day("en")}. I'll remind you both the day before.`, es: `${me} puso «${share.title}» en su calendario: ${day("es")}. Les aviso a los dos un día antes.` };
        const posted = await appendTogetherMessage(tx, { relationshipId: initial.relationship.id, actorUserId: null, userId, source: "app", kind: "text", text: i18n.zh, i18n, handle: `date-share:${share.cardId}` });
        const saved = await tx.updateRelationshipRecordForUser("privateAgentThreads", latest.id, userId, (record) => { record.pendingShares = record.pendingShares.map((item) => item.cardId === cardId ? { ...item, sharedAt: new Date().toISOString() } : item); record.version += 1; });
        return { session: saved, item: null, milestone, conversation: posted.duplicate ? null : posted.conversation };
      }
      const space = await visibleSpace(tx, share.spaceId, userId);
      if (space.visibility !== "shared" || space.relationshipId !== initial.relationship.id) throw fail(409, unpaired(session.language));
      // A private photo becomes a separate shared copy only now, when its owner confirmed this exact card.
      const photo = share.photoId ? await sharePhotoCopy(tx, { photo: await visiblePhoto(tx, share.photoId, userId), userId, relationshipId: initial.relationship.id }) : null;
      const item = await addSpaceItem(tx, { userId, space, title: share.title, text: share.text, date: share.date, photoId: photo?.id || null, source: "member_confirmed" });
      await tx.createRelationshipRecord("consentEvents", privateRecord(userId, { relationshipId: initial.relationship.id, approvalPolicy: "owner", status: "recorded", objectId: item.id, objectType: "space_item", eventType: "space_item.shared", sourceVersion: latest.version }));
      const saved = await tx.updateRelationshipRecordForUser("privateAgentThreads", latest.id, userId, (record) => { record.pendingShares = record.pendingShares.map((item) => item.cardId === cardId ? { ...item, sharedAt: new Date().toISOString() } : item); record.version += 1; });
      return { session: saved, item };
    });
    if (result.item) emit(result.item, "space.updated");
    if (result.agreement) {
      emit(result.agreement, "agreement.updated");
      let conversation = null; try { conversation = await store.getRelationshipRecordForUser("togetherConversations", `together:${result.agreement.relationshipId}`, userId); } catch { conversation = null; }
      if (conversation) emit(conversation, "together.updated", null, userId);
    }
    if (result.milestone) { emit(result.milestone, "milestone.updated"); void recordUsage(store, { userId, relationshipId: result.milestone.relationshipId, action: "plan_scheduled" }); }
    if (result.conversation) emit(result.conversation, "together.updated", null, req.auth.user.id);
    res.json({ session: await output(result.session) });
  });
  // One tap takes back a private record Pinky made in this conversation (founder 11-07): it is archived, never deleted
  // outright, and only the member's own private records can be undone this way. Shared ones keep their own flows.
  const UNDOABLE = new Set(["reminder", "checkin", "memory", "space_item"]);
  router.post("/assistant/sessions/:id/undo", async (req, res) => {
    const userId = req.auth.user.id, cardId = clean(req.body?.cardId, 80), kind = clean(req.body?.kind, 20);
    if (!UNDOABLE.has(kind)) throw fail(400, "This can't be undone here.");
    const saved = await store.transaction("reminder-delivery", async (tx) => {
      await liveUser(tx, userId, true);
      const session = await owned(tx, req.params.id, userId);
      const made = session.messages.some((message) => message.role === "assistant" && (message.cards || []).some((item) => item.id === cardId && item.kind === kind));
      if (!made) throw fail(404, say(session.language, "没有找到这条记录。", "That record wasn't found.", "No se encontró ese registro."));
      if ((session.undone || []).some((item) => item.id === cardId)) return session;
      const record = await tx.getRelationshipRecordForUser(collections[kind], cardId, userId);
      if (!record || record.ownerUserId !== userId || record.visibility !== "private") throw fail(409, say(session.language, "这条已经分享了，要在原来的地方改。", "This one is shared now; change it where it lives.", "Esto ya está compartido; cámbialo donde está."));
      const title = String(record.title || record.text || record.description || "").slice(0, 60);
      if (!record.archivedAt) await tx.updateRelationshipRecordForUser(collections[kind], record.id, userId, (draft) => { draft.status = "archived"; draft.archivedAt = new Date().toISOString(); draft.version += 1; });
      return tx.updateRelationshipRecordForUser("privateAgentThreads", session.id, userId, (draft) => { draft.undone = [...(draft.undone || []), { id: cardId, kind, title }].slice(-100); draft.version += 1; });
    });
    res.json({ session: await output(saved) });
  });
  // 约会之后问一句: the one-tap answer to "how was it?", kept as the member's own private note.
  router.post("/assistant/sessions/:id/date-check", async (req, res) => {
    const userId = req.auth.user.id;
    await owned(store, req.params.id, userId);
    const saved = await answerDateCheck(store, { userId, sessionId: req.params.id, messageId: clean(req.body?.messageId, 80), rating: clean(req.body?.rating, 10), told: req.body?.told === true });
    if (!req.body?.told) { const context = await store.getRelationshipContext(userId); if (context?.relationship) emit({ id: saved.id, relationshipId: context.relationship.id }, "profile.updated", userId); }
    res.json({ session: await output(saved) });
  });
  router.post("/assistant/sessions/:id/share-confirm", async (req, res) => {
    const result = await confirmShare(req.auth.user.id, req.params.id, req.body);
    res.json({ session: await output(result.session), message: result.message ? { id: result.message.id, text: result.message.text, createdAt: result.message.createdAt } : null, duplicate: result.duplicate });
  });
  router.post("/assistant/sessions/:id/messages", append);
  router.post("/assistant/sessions/:id/transcripts", append);
  router.post("/assistant/sessions/:id/realtime", express.text({ type: "application/sdp", limit: "128kb" }), async (req, res) => {
    const session = await owned(store, req.params.id, req.auth.user.id);
    if (typeof req.body !== "string" || !req.body.includes("v=0")) throw fail(400, "Invalid audio connection.");
    res.type("application/sdp").send(await mediator.createRealtimeSession({ sdp: req.body, language: session.language, safetyIdentifier: createHash("sha256").update(req.auth.user.id).digest("hex") }));
  });
  // Background work (a finished chat import) reports into the member's App conversation: the one it started from if it
  // still exists, else their latest, else a new one.
  async function postNote(userId, { sessionId = null, language = "zh", text, card = null, cards = null, call = null, kind = null, personId = null }) {
    let session = sessionId ? await owned(store, sessionId, userId).catch(() => null) : null;
    if (!session) session = (await store.listRelationshipRecordsForUser("privateAgentThreads", userId)).filter((record) => record.intentType === "assistant" && record.ownerUserId === userId && record.visibility === "private" && !record.archivedAt && record.status === "active" && !record.channel).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (!session) session = await createSession(userId, { language, timezone: "UTC" });
    const saved = await store.transaction("reminder-delivery", (tx) => tx.updateRelationshipRecordForUser("privateAgentThreads", session.id, userId, (draft) => {
      keepMessages(draft, [...draft.messages, { id: randomUUID(), role: "assistant", text: clean(text, 2000), ...(cards?.length ? { cards } : card ? { cards: [card] } : {}), ...(call ? { call } : {}), ...(kind ? { kind } : {}), ...(personId ? { personId } : {}), createdAt: new Date().toISOString() }]); draft.version += 1;
    }));
    // Private sessions carry no relationship id; route the event through the member's couple so their open app refreshes.
    const context = await store.getRelationshipContext(userId);
    if (saved && context?.relationship) emit({ ...saved, relationshipId: context.relationship.id }, "assistant.updated", userId);
    return saved;
  }
  // Channel adapters (iMessage) call the same domain code as the HTTP routes above.
  router.assistant = { createSession, appendTurn, confirmShare, output, postNote, session: (userId, id) => owned(store, id, userId) };
  return router;
}
