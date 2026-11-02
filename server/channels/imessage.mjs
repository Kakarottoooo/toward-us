import { createHash, timingSafeEqual } from "node:crypto";
import express from "express";
import { createPhoneLink, normalizePhone } from "../phone-identity.mjs";
import { approveAgreement } from "../agreement-actions.mjs";
import { announceAgreement, continueTogetherTurn, draftAgreementFromTogether, ensureTogetherConversation, memberLanguage } from "../together-domain.mjs";
import { sendblue as defaultSendblue } from "../sendblue.mjs";
import { recordUsage } from "../usage.mjs";

// The private iMessage entry point: a thin adapter over the member's own private assistant. Every rule (records, drafts,
// share-confirm, usage) runs in assistant-router's domain functions; this file only maps a phone to a member and text to text.
// The couple's three-person group is a second view of the shared "together" conversation: group turns go through
// together-domain like App turns, and App/Agent messages are mirrored out. Private 1:1 content never reaches the group.
// Only iMessage is trusted: an SMS caller ID can be forged, so SMS gets one fixed line a day and nothing else.
const CONFIRM_WINDOW_MS = 30 * 60 * 1000;
const LINK_INTERVAL_MS = 10 * 60 * 1000;
const SEEN_MS = 24 * 60 * 60 * 1000;
// Sendblue's webhook secret header; when a sender cannot set it, the secret goes in the URL path instead.
const SIGNATURE_HEADER = "sb-signing-secret";
const LANGUAGES = ["zh", "en", "es"];
const CONFIRM_WORD = { zh: "发送", en: "send", es: "enviar" };
// Any member may approve in any of the three languages; the reply still uses their own.
const APPROVE_WORDS = new Set(["同意", "agree", "de acuerdo"]);
const TEXT = {
  zh: {
    hello: "你好，这里是 Pinky。点下面的链接登录一次，把这个号码绑到你的账号，之后直接在这里跟我说话（30 分钟内有效）。",
    sms: "Pinky 只在 iMessage 里回复。请用 iPhone 的「信息」App 给这个号码发 iMessage。",
    hint: "回复\"发送\"就交给 TA，回复别的我再改", shared: "已交给 TA。TA 会在「我们俩」里看到整理后的版本，不会看到你的原话。", alreadyShared: "这段话已经交给 TA 了。",
    failed: "这次没能完成，没有做任何改动。换个说法再试一次。",
    busy: "我现在暂时答不上来，这次什么都没改。过一会儿再发一次就好。", changed: "刚才同时有别的改动，这次什么都没改。请把刚才的话再发一次。",
    limit: "私人对话已经到上限了。请在 App 的隐私设置里整理一下私人记录，再回来找我。", unpaired: "要先在 App 里邀请另一半加入，才能把话交给 TA。我们仍然可以继续私下聊。",
    shareChanged: "这段话刚改过。请看我最新发的版本，确认后回复\"发送\"。",
    groupHello: "你们好，这是你们俩和 Pinky 的群。这里说的话会和 App 里的「我们俩」同步；需要我的时候就叫 Pinky。我贴出约定后，回复\"同意\"就是批准。",
    stale: (version) => `约定刚改过，最新是 v${version}，请看上面的新版本。`, relay: (name) => `Pinky 转达 ${name} 确认分享的话：`,
  },
  en: {
    hello: "Hi, this is Pinky. Open the link below and sign in once to link this number to your account, then just talk to me here (valid for 30 minutes).",
    sms: "Pinky only answers over iMessage. Please text this number from the Messages app on an iPhone.",
    hint: "Reply \"send\" to share it, or tell me what to change.", shared: "Shared. Your partner will see the polished version in Us, never your own words.", alreadyShared: "This message was already shared.",
    failed: "That didn't work, and nothing was changed. Try saying it another way.",
    busy: "I can't answer right now, and nothing was changed. Text me again in a minute.", changed: "Something else changed at the same moment, so nothing was done. Please send that again.",
    limit: "You've reached the limit for private conversations. Tidy up your private records in Privacy in the app, then text me again.", unpaired: "Invite your partner in the app before sharing. We can keep talking privately.",
    shareChanged: "That message just changed. Check the latest version I sent, then reply \"send\".",
    groupHello: "Hi both, this is your group with Pinky. Everything here stays in sync with Us in the app; mention Pinky whenever you want me. When I post an agreement, reply \"agree\" to approve it.",
    stale: (version) => `The agreement just changed; the latest is v${version}. Please check the new version above.`, relay: (name) => `Shared by ${name} through Pinky: `,
  },
  es: {
    hello: "Hola, somos Pinky. Abre el enlace de abajo e inicia sesión una vez para vincular este número a tu cuenta; después háblame aquí directamente (válido durante 30 minutos).",
    sms: "Pinky solo responde por iMessage. Escribe a este número desde la app Mensajes de un iPhone.",
    hint: "Responde \"enviar\" para compartirlo, o dime qué cambiar.", shared: "Compartido. Tu pareja verá la versión cuidada en Nosotros, nunca tus palabras originales.", alreadyShared: "Este mensaje ya se compartió.",
    failed: "No se pudo completar y no se cambió nada. Intenta decirlo de otra forma.",
    busy: "Ahora mismo no puedo responder y no se cambió nada. Escríbeme de nuevo en un minuto.", changed: "Algo más cambió al mismo tiempo, así que no se hizo nada. Envíalo de nuevo, por favor.",
    limit: "Llegaste al límite de conversaciones privadas. Ordena tus registros privados en Privacidad, dentro de la app, y vuelve a escribirme.", unpaired: "Invita a tu pareja desde la app antes de compartir. Podemos seguir hablando en privado.",
    shareChanged: "Ese mensaje acaba de cambiar. Revisa la última versión que te envié y responde \"enviar\".",
    groupHello: "Hola a los dos, este es su grupo con Pinky. Todo lo que escriban aquí se sincroniza con Nosotros en la app; mencionen a Pinky cuando me necesiten. Cuando publique un acuerdo, respondan \"de acuerdo\" para aprobarlo.",
    stale: (version) => `El acuerdo acaba de cambiar; la versión más reciente es la v${version}. Revisen la nueva versión arriba.`, relay: (name) => `${name} compartió a través de Pinky: `,
  },
};
// A stranger's language is not known yet, so the first contact speaks all three.
const everyLanguage = (key) => LANGUAGES.map((language) => TEXT[language][key]).join("\n\n");
const sameSecret = (given, secret) => timingSafeEqual(createHash("sha256").update(String(given)).digest(), createHash("sha256").update(String(secret)).digest());
// iPhone capitalizes and may add a period; anything beyond that is a revision, not the confirm word.
const plainWord = (text) => text.trim().replace(/^["'“”「」]+|["'“”「」.!。！]+$/g, "").toLocaleLowerCase();
const isConfirmWord = (text, language) => plainWord(text) === CONFIRM_WORD[language];
const activeCouple = (context) => context?.relationship.status === "active" && context.members.length === 2;
// The approval request the group last saw for an agreement: its "awaiting approvals" card.
const approvalCard = (conversation, agreementId) => conversation.messages.findLast((item) => item.kind === "agreement_card" && item.handle?.startsWith(`agreement:${agreementId}:v`) && item.handle.endsWith(":awaiting_approvals"));

export function createIMessageChannel({ store, assistant, mediator, sendblue = defaultSendblue, emit = () => {} }) {
  // Handles, SMS days and link sends are remembered in memory; private turns are also deduplicated durably by their itemId.
  const seen = new Map();
  const claim = (key, ttl) => {
    const now = Date.now();
    if (seen.size > 5000) for (const [old, expires] of seen) if (expires <= now) seen.delete(old);
    if ((seen.get(key) || 0) > now) return false;
    seen.set(key, now + ttl); return true;
  };
  // One turn at a time per phone, so two quick texts never race on the same session version.
  const queues = new Map();
  const serial = (phone, work) => {
    const next = (queues.get(phone) || Promise.resolve()).then(work, work);
    queues.set(phone, next);
    return next.finally(() => { if (queues.get(phone) === next) queues.delete(phone); });
  };
  const deliver = async (phone, text) => {
    try { await sendblue.send(phone, text); } catch (error) { console.error("imessage_send_failed", error?.code || error?.name || "error"); }
  };
  const groupSend = async (groupId, text) => {
    try { await sendblue.sendGroup({ groupId }, text); } catch (error) { console.error("imessage_group_send_failed", error?.code || error?.name || "error"); }
  };
  // Group sends for one couple leave in order on their own queue.
  const deliverGroup = (relationshipId, groupId, text) => serial(`send:${relationshipId}`, () => groupSend(groupId, text));
  const boundPhones = (context) => Promise.all(context.members.map((member) => store.getPhoneForUser(member.userId)));
  // The couple's group, only while both are still together in this relationship and both numbers are still linked.
  const coupleGroup = async (userId, relationshipId = null) => {
    const context = await store.getRelationshipContext(userId);
    if (!activeCouple(context) || !context.relationship.imessageGroupId || (relationshipId && context.relationship.id !== relationshipId)) return null;
    return (await boundPhones(context)).every(Boolean) ? context : null;
  };
  // A service lookup is remembered for a day, so the backfill check costs no network on every message.
  const services = new Map();
  const isIMessage = async (phone) => {
    const known = services.get(phone); if (known && known.expires > Date.now()) return known.answer;
    const answer = await sendblue.isIMessage(phone); services.set(phone, { answer, expires: Date.now() + SEEN_MS }); return answer;
  };

  async function memberTimezone(userId, threads) {
    const preference = (await store.listRelationshipRecordsForUser("deliveryPreferences", userId)).find((item) => item.ownerUserId === userId && !item.archivedAt && item.timezone);
    return preference?.timezone || threads.filter((item) => item.intentType === "assistant" && item.timezone).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.timezone || "UTC";
  }
  // The member's running iMessage session in their current language; a full one is left behind and a new one started.
  async function imessageSession(userId, language) {
    const threads = (await store.listRelationshipRecordsForUser("privateAgentThreads", userId)).filter((item) => item.ownerUserId === userId && !item.archivedAt);
    const current = threads.filter((item) => item.intentType === "assistant" && item.channel === "imessage" && item.status === "active" && item.language === language && item.messages.length < 200).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return current || assistant.createSession(userId, { language, timezone: await memberTimezone(userId, threads), channel: "imessage" });
  }
  function render(message, language) {
    const colon = language === "zh" ? "：" : ": ";
    const lines = [], partner = [];
    for (const card of message.cards || []) {
      if (card.kind === "partner_message") { if (card.status === "draft") partner.push(card.text, TEXT[language].hint); continue; }
      if (card.status === "unavailable" || message.text.includes(card.title)) continue;
      const text = card.text && card.text !== card.title ? `${colon}${card.text.slice(0, 200)}` : "";
      lines.push(`· ${[card.title, card.localDateTime?.replace("T", " ")].filter(Boolean).join(" ")}${text}`);
    }
    return [message.text, lines.join("\n"), ...partner].filter(Boolean).join("\n\n");
  }

  async function privateTurn(phone, handle, content) {
    const userId = await store.getUserIdByPhone(phone);
    if (!userId) {
      if (!claim(`link:${phone}`, LINK_INTERVAL_MS)) return "link_limited";
      const { url } = await createPhoneLink(store, phone);
      await deliver(phone, `${everyLanguage("hello")}\n\n${url}`);
      return "link";
    }
    void ensureCoupleGroup(userId);
    const text = String(content || "").trim();
    if (!text) return "empty";
    // Always the member's stored language: the channel itself carries none.
    const language = await memberLanguage(store, userId);
    let session;
    try { session = await imessageSession(userId, language); }
    catch (error) { await deliver(phone, TEXT[language][error?.statusCode === 409 ? "limit" : "failed"]); return "failed"; }
    const draft = session.partnerMessage;
    if (draft && Date.now() - Date.parse(draft.createdAt) <= CONFIRM_WINDOW_MS && isConfirmWord(text, language)) {
      try {
        const result = await assistant.confirmShare(userId, session.id, { confirm: true, cardId: draft.cardId, digest: draft.digest }, { channel: "imessage" });
        await deliver(phone, TEXT[language][result.duplicate ? "alreadyShared" : "shared"]);
        return "shared";
      } catch (error) {
        // App copy talks about forms and refreshing; iMessage gets its own words for the two 409 cases of a share.
        const key = error?.statusCode !== 409 ? "failed" : activeCouple(await store.getRelationshipContext(userId)) ? "shareChanged" : "unpaired";
        await deliver(phone, TEXT[language][key]); return "failed";
      }
    }
    try {
      const { session: updated, duplicate } = await assistant.appendTurn(userId, session.id, { text, itemId: `imessage:${handle}` }, { channel: "imessage" });
      if (duplicate) return "duplicate";
      await deliver(phone, render((await assistant.output(updated)).messages.at(-1), language));
      return "answered";
    } catch (error) {
      console.error("imessage_turn_failed", error?.statusCode || error?.code || error?.name || "error");
      await deliver(phone, TEXT[language][error?.statusCode === 503 ? "busy" : error?.statusCode === 409 ? "changed" : "failed"]);
      return "failed";
    }
  }

  // A member's group turn: saved to the shared conversation like an App turn (the Agent answers only when called, and its
  // reply reaches the group through the mirror), then an exact approval word approves the agreement the group was shown.
  async function groupTurn(phone, handle, message) {
    const userId = await store.getUserIdByPhone(phone);
    const context = userId && await coupleGroup(userId);
    // Unknown numbers, a former couple's group and any other group are ignored without a reply.
    if (!context || context.relationship.imessageGroupId !== String(message.group_id)) return "group_ignored";
    const text = String(message.content || "").trim();
    if (!text) return "empty";
    const relationshipId = context.relationship.id, language = await memberLanguage(store, userId);
    try {
      const turn = await continueTogetherTurn({ store, mediator, relationshipId, actorUserId: userId, text, source: "imessage", handle: `imessage:${handle}`, language, emit: (conversation) => emit(conversation, "together.updated") });
      if (!turn.duplicate) void recordUsage(store, { userId, relationshipId, action: "together_message", channel: "imessage" });
      // The group has no "send for approval" button: a draft the member just asked for is posted as the card both approve.
      if (turn.reply && turn.conversation.draftAgreement?.messageId === turn.reply.id) {
        const posted = await store.transaction(`relationship:${relationshipId}`, async (tx) => {
          const current = await tx.getRelationshipContext(userId);
          if (!activeCouple(current) || current.relationship.id !== relationshipId) return null;
          const agreement = await draftAgreementFromTogether(tx, { relationshipId, userId, source: "imessage", language });
          return { agreement, conversation: (await ensureTogetherConversation(tx, { relationshipId, userId })).conversation };
        });
        if (posted) { emit(posted.agreement, "agreement.updated"); emit(posted.conversation, "together.updated", null, userId); void recordUsage(store, { userId, relationshipId, action: "agreement_drafted", channel: "imessage" }); }
        return "drafted";
      }
      if (!APPROVE_WORDS.has(plainWord(text))) return "together";
      const result = await store.transaction(`relationship:${relationshipId}`, async (tx) => {
        const current = await tx.getRelationshipContext(userId);
        if (!activeCouple(current) || current.relationship.id !== relationshipId) return null;
        const { conversation } = await ensureTogetherConversation(tx, { relationshipId, userId });
        const open = (await tx.listRelationshipRecordsForUser("agreements", userId)).filter((item) => item.relationshipId === relationshipId && !item.archivedAt && !item.withdrawnAt && ["awaiting_approvals", "draft"].includes(item.status) && approvalCard(conversation, item.id));
        // One pending agreement per couple; a change-requested draft the group was asked about only counts when none is pending.
        const awaiting = open.filter((item) => item.status === "awaiting_approvals"), drafts = open.filter((item) => item.status === "draft");
        const agreement = awaiting.length ? (awaiting.length === 1 ? awaiting[0] : null) : drafts.length === 1 ? drafts[0] : null;
        if (!agreement) return null;
        const version = approvalCard(conversation, agreement.id).refs?.find((ref) => ref.type === "agreement" && ref.id === agreement.id)?.version;
        if (agreement.status !== "awaiting_approvals" || version !== agreement.version) return { stale: agreement.version };
        const done = await approveAgreement(tx, { agreementId: agreement.id, version, userId, context: current });
        const announced = done.agreement.status === "active" ? await announceAgreement(tx, { agreement: done.agreement, userId, language, source: "imessage" }) : null;
        return { agreement: done.agreement, conversation: announced && !announced.duplicate ? announced.conversation : null };
      });
      if (!result) return "together";
      if (result.stale) { await deliverGroup(relationshipId, context.relationship.imessageGroupId, TEXT[language].stale(result.stale)); return "stale"; }
      emit(result.agreement, "agreement.updated"); if (result.conversation) emit(result.conversation, "together.updated", null, userId);
      void recordUsage(store, { userId, relationshipId, action: "agreement_approved", channel: "imessage" });
      return "approved";
    } catch (error) {
      // An ended relationship or a raced version stays silent: the group simply sees nothing happen.
      console.error("imessage_group_turn_failed", error?.code || error?.statusCode || error?.name || "error");
      return "failed";
    }
  }

  // App member messages, every Agent message and owner-confirmed relays (decision #13) go out to the couple's group; messages
  // that came from the group are never echoed back. A relay carries only the exact text its owner confirmed. Each emitted
  // conversation is diffed against what this process already mirrored, so an out-of-order emit never sends twice and nothing
  // older than this process or the group goes out.
  const mirrored = new Map();
  const startedAt = new Date().toISOString();
  function mirror(conversation) {
    if (!conversation?.relationshipId || conversation.id !== `together:${conversation.relationshipId}` || conversation.visibility !== "shared" || !Array.isArray(conversation.messages)) return;
    const cursor = mirrored.get(conversation.id) || { since: startedAt, ids: new Set() };
    const fresh = conversation.messages.filter((item) => item.createdAt > cursor.since || (item.createdAt === cursor.since && !cursor.ids.has(item.id)));
    if (!fresh.length) return;
    const since = fresh.reduce((latest, item) => item.createdAt > latest ? item.createdAt : latest, cursor.since);
    mirrored.set(conversation.id, { since, ids: new Set([...(since === cursor.since ? cursor.ids : []), ...fresh.filter((item) => item.createdAt === since).map((item) => item.id)]) });
    const outgoing = fresh.filter((item) => item.role === "agent" || (item.role === "member" && ["app", "relay"].includes(item.source)));
    if (!sendblue.groupsEnabled()) return;
    // Queued in emit order, so a member's line always goes out before the Agent's answer to it.
    serial(`send:${conversation.relationshipId}`, async () => {
      const context = await coupleGroup(conversation.createdByUserId, conversation.relationshipId);
      // Activity from a couple without a group (paired before groups were enabled, or after a number changed) may create one.
      if (!context) { void ensureCoupleGroup(conversation.createdByUserId); return; }
      for (const item of outgoing) {
        const author = item.role === "member" ? context.members.find((member) => member.userId === item.actorUserId) : null;
        if (item.role === "member" && !author) continue;
        const authorLanguage = author ? await memberLanguage(store, author.userId) : null;
        const text = !author ? item.text : item.source === "relay" ? `${TEXT[authorLanguage].relay(author.user.name)}${item.text}` : `${author.user.name}${authorLanguage === "zh" ? "：" : ": "}${item.text}`;
        await groupSend(context.relationship.imessageGroupId, text);
      }
    }).catch((error) => console.error("imessage_mirror_failed", error?.code || error?.name || "error"));
  }

  // Creates the couple's group once both members have linked iMessage numbers. `actorUserId` completed the last step (linking
  // a phone or pairing), so the one opening message is in their language. Any non-iMessage member means no group at all.
  const creating = new Set(), dryRunGroups = new Set();
  async function ensureCoupleGroup(actorUserId) {
    try {
      if (!sendblue.groupsEnabled()) return null;
      const context = await store.getRelationshipContext(actorUserId);
      if (!activeCouple(context) || context.relationship.imessageGroupId || creating.has(context.relationship.id)) return null;
      const relationshipId = context.relationship.id;
      creating.add(relationshipId);
      try {
        const numbers = await boundPhones(context);
        if (numbers.some((phone) => !phone)) return null;
        for (const phone of numbers) if (!(await isIMessage(phone))) return null;
        // A dry-run group id is never stored (a later live hookup must create a real group) unless a local probe asks for it.
        const persist = sendblue.live() || process.env.SENDBLUE_DRYRUN_PERSIST_GROUPS === "1";
        if (!persist && dryRunGroups.has(numbers.join(","))) return null;
        const { groupId } = await sendblue.sendGroup({ numbers }, TEXT[await memberLanguage(store, actorUserId)].groupHello);
        if (!groupId) return null;
        if (!persist) { dryRunGroups.add(numbers.join(",")); console.log("imessage: dry-run couple group not stored"); return null; }
        // Earlier conversation stays in the App; the group starts from here.
        mirrored.set(`together:${relationshipId}`, { since: new Date().toISOString(), ids: new Set() });
        if (!(await store.bindRelationshipGroup(relationshipId, groupId))) return null;
        console.log("imessage: couple group created");
        return groupId;
      } finally { creating.delete(relationshipId); }
    } catch (error) { console.error("imessage_group_create_failed", error?.code || error?.name || "error"); return null; }
  }

  // One Sendblue message, answered at most once. The handle is claimed before any await, so a concurrent retry is a no-op.
  async function handleInbound(message) {
    const handle = String(message?.message_handle || "");
    if (!handle || !claim(`handle:${handle}`, SEEN_MS)) return "seen";
    if (message.is_outbound) return "outbound";
    const phone = normalizePhone(String(message.from_number || message.number || ""));
    if (!phone) return "invalid";
    // Only messages addressed to our own line count, and never our own line talking.
    const line = normalizePhone(String(process.env.SENDBLUE_FROM_NUMBER || ""));
    const addressed = [message.sendblue_number, message.to_number].filter(Boolean).map((value) => normalizePhone(String(value)));
    if (line && (phone === line || (addressed.length && !addressed.includes(line)))) return "foreign";
    if (message.service !== "iMessage") {
      if (claim(`sms:${phone}:${new Date().toISOString().slice(0, 10)}`, SEEN_MS)) await deliver(phone, everyLanguage("sms"));
      return "sms";
    }
    if (message.group_id) return serial(`group:${message.group_id}`, () => groupTurn(phone, handle, message));
    return serial(phone, () => privateTurn(phone, handle, message.content));
  }

  const router = express.Router();
  router.post(["/api/channels/sendblue/webhook", "/api/channels/sendblue/webhook/:secret"], (req, res) => {
    const secret = process.env.SENDBLUE_WEBHOOK_SECRET || "";
    if (!secret) return res.status(503).json({ error: "iMessage intake is not configured." });
    if (!sameSecret(req.params.secret || req.get(SIGNATURE_HEADER) || "", secret)) return res.status(401).json({ error: "Unauthorized." });
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return res.status(400).json({ error: "Invalid payload." });
    // Answer Sendblue at once; the turn (a model call) continues after the 200.
    const work = handleInbound(req.body);
    res.json({ ok: true });
    work.catch((error) => console.error("imessage_inbound_failed", error?.code || error?.name || "error"));
  });
  return { router, handleInbound, mirror, ensureCoupleGroup };
}
