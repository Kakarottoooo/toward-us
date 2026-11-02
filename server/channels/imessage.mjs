import { createHash, timingSafeEqual } from "node:crypto";
import express from "express";
import { createPhoneLink, normalizePhone } from "../phone-identity.mjs";
import { memberLanguage } from "../together-domain.mjs";
import { sendblue as defaultSendblue } from "../sendblue.mjs";

// The private iMessage entry point: a thin adapter over the member's own private assistant. Every rule (records, drafts,
// share-confirm, usage) runs in assistant-router's domain functions; this file only maps a phone to a member and text to text.
// Only iMessage is trusted: an SMS caller ID can be forged, so SMS gets one fixed line a day and nothing else.
const CONFIRM_WINDOW_MS = 30 * 60 * 1000;
const LINK_INTERVAL_MS = 10 * 60 * 1000;
const SEEN_MS = 24 * 60 * 60 * 1000;
// Sendblue's webhook secret header; when a sender cannot set it, the secret goes in the URL path instead.
const SIGNATURE_HEADER = "sb-signing-secret";
const LANGUAGES = ["zh", "en", "es"];
const CONFIRM_WORD = { zh: "发送", en: "send", es: "enviar" };
const TEXT = {
  zh: {
    hello: "你好，这里是彼此。点下面的链接登录一次，把这个号码绑到你的账号，之后直接在这里跟我说话（30 分钟内有效）。",
    sms: "彼此只在 iMessage 里回复。请用 iPhone 的「信息」App 给这个号码发 iMessage。",
    hint: "回复\"发送\"就交给 TA，回复别的我再改", shared: "已交给 TA。TA 会在「我们俩」里看到整理后的版本，不会看到你的原话。", alreadyShared: "这段话已经交给 TA 了。",
    failed: "这次没能完成，没有做任何改动。换个说法再试一次。",
  },
  en: {
    hello: "Hi, this is Toward Us. Open the link below and sign in once to link this number to your account, then just talk to me here (valid for 30 minutes).",
    sms: "Toward Us only answers over iMessage. Please text this number from the Messages app on an iPhone.",
    hint: "Reply \"send\" to share it, or tell me what to change.", shared: "Shared. Your partner will see the polished version in Us, never your own words.", alreadyShared: "This message was already shared.",
    failed: "That didn't work, and nothing was changed. Try saying it another way.",
  },
  es: {
    hello: "Hola, somos Toward Us. Abre el enlace de abajo e inicia sesión una vez para vincular este número a tu cuenta; después háblame aquí directamente (válido durante 30 minutos).",
    sms: "Toward Us solo responde por iMessage. Escribe a este número desde la app Mensajes de un iPhone.",
    hint: "Responde \"enviar\" para compartirlo, o dime qué cambiar.", shared: "Compartido. Tu pareja verá la versión cuidada en Nosotros, nunca tus palabras originales.", alreadyShared: "Este mensaje ya se compartió.",
    failed: "No se pudo completar y no se cambió nada. Intenta decirlo de otra forma.",
  },
};
// A stranger's language is not known yet, so the first contact speaks all three.
const everyLanguage = (key) => LANGUAGES.map((language) => TEXT[language][key]).join("\n\n");
const sameSecret = (given, secret) => timingSafeEqual(createHash("sha256").update(String(given)).digest(), createHash("sha256").update(String(secret)).digest());
// iPhone capitalizes and may add a period; anything beyond that is a revision, not the confirm word.
const isConfirmWord = (text, language) => text.trim().replace(/^["'“”「」]+|["'“”「」.!。！]+$/g, "").toLocaleLowerCase() === CONFIRM_WORD[language];

// Task 9 replaces this: a group_id maps to one couple's together conversation.
export async function handleGroupMessage() { console.log("imessage: group message received; group chat is not enabled yet"); return "group"; }

export function createIMessageChannel({ store, assistant, sendblue = defaultSendblue, group = handleGroupMessage }) {
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
    const text = String(content || "").trim();
    if (!text) return "empty";
    // Always the member's stored language: the channel itself carries none.
    const language = await memberLanguage(store, userId);
    let session;
    try { session = await imessageSession(userId, language); }
    catch (error) { await deliver(phone, error?.statusCode === 409 ? error.message : TEXT[language].failed); return "failed"; }
    const draft = session.partnerMessage;
    if (draft && Date.now() - Date.parse(draft.createdAt) <= CONFIRM_WINDOW_MS && isConfirmWord(text, language)) {
      try {
        const result = await assistant.confirmShare(userId, session.id, { confirm: true, cardId: draft.cardId, digest: draft.digest }, { channel: "imessage" });
        await deliver(phone, TEXT[language][result.duplicate ? "alreadyShared" : "shared"]);
        return "shared";
      } catch (error) { await deliver(phone, error?.statusCode === 409 ? error.message : TEXT[language].failed); return "failed"; }
    }
    try {
      const { session: updated, duplicate } = await assistant.appendTurn(userId, session.id, { text, itemId: `imessage:${handle}` }, { channel: "imessage" });
      if (duplicate) return "duplicate";
      await deliver(phone, render((await assistant.output(updated)).messages.at(-1), language));
      return "answered";
    } catch (error) {
      console.error("imessage_turn_failed", error?.statusCode || error?.code || error?.name || "error");
      await deliver(phone, error?.statusCode === 503 ? error.message : TEXT[language].failed);
      return "failed";
    }
  }

  // One Sendblue message, answered at most once. The handle is claimed before any await, so a concurrent retry is a no-op.
  async function handleInbound(message) {
    const handle = String(message?.message_handle || "");
    if (!handle || !claim(`handle:${handle}`, SEEN_MS)) return "seen";
    if (message.is_outbound) return "outbound";
    const phone = normalizePhone(String(message.from_number || message.number || ""));
    if (!phone) return "invalid";
    if (message.service !== "iMessage") {
      if (claim(`sms:${phone}:${new Date().toISOString().slice(0, 10)}`, SEEN_MS)) await deliver(phone, everyLanguage("sms"));
      return "sms";
    }
    if (message.group_id) return group(message);
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
  return { router, handleInbound };
}
