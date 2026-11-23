import express from "express";
import { randomUUID } from "node:crypto";
import { clean } from "./agreement-actions.mjs";
import { sharePhotoCopy, visiblePhoto } from "./photo-store.mjs";
import { markShowedUp } from "./streak.mjs";
import { ensureTogetherConversation } from "./together-domain.mjs";
import { readPlayDrawing } from "./play-drawing.mjs";

const PATH = "/play-distance";
const CARD_LIMIT = 20;
const DELIVERY_LIMIT = 60;
// One minute to touch back (founder 11-22): the partner is told at once, so the window only has to cover picking up the phone.
const TOUCH_MS = 60_000;
const TOUCH_RESULT_MS = 20_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const writable = (context) => context?.relationship.status === "active" && context.members.length === 2;
const err = (status, code) => Object.assign(new Error(code), { distanceCode: code, status });
const copy = {
  sign_in: ["请先登录。", "Please sign in first.", "Inicia sesión primero."],
  pairing_required: ["和 TA 配对后就能使用。", "Link with your partner to use this.", "Vincúlate con tu pareja para usarlo."],
  relationship_changed: ["共同空间已更新，请刷新。", "Your shared space changed. Refresh to continue.", "El espacio compartido cambió. Actualiza para continuar."],
  invalid_card: ["这张卡没能发送，请检查内容。", "Couldn’t send this card. Check its content.", "No se pudo enviar esta tarjeta. Revisa su contenido."],
  cards_waiting: ["还有很多小卡等 TA 收下。等 TA 看过几张再送新的。", "Your partner has several cards waiting. Send another after they open some.", "Tu pareja tiene varias tarjetas pendientes. Envía otra cuando abra algunas."],
  invalid_photo: ["这张照片没能读取，请重新挑一张。", "Couldn’t open this photo. Pick it again.", "No se pudo abrir esta foto. Elígela de nuevo."],
  invalid_touch: ["没能一起碰一下，请重试。", "Couldn’t tap together. Try again.", "No se pudo tocar juntos. Inténtalo de nuevo."],
};

function activeTouch(touch, now) {
  return touch && touch.expiresAt > now ? touch : null;
}

function recentAndWaiting(cards) {
  return cards.filter((card, index) => card.showOnOpen || index >= cards.length - CARD_LIMIT);
}

function publicCard({ showOnOpen, ...card }) {
  return card;
}

function partnerName(context) {
  return context.members.find((member) => member.userId !== context.viewerId)?.user?.name || "";
}

function memberName(context, userId) {
  return String(context.members.find((member) => member.userId === userId)?.user?.name || "").slice(0, 40);
}

function deliveries(conversation, context) {
  const cards = (conversation?.playDistance?.cards || []).filter((card) => card.showOnOpen && card.userId !== context.viewerId);
  return { cards: cards.slice(0, CARD_LIMIT).map(publicCard), remaining: cards.length, partner: partnerName(context) };
}

function view(conversation, context, now = Date.now(), partnerOnline = false) {
  const distance = conversation?.playDistance;
  const touch = activeTouch(distance?.touch, now);
  return {
    version: conversation?.version || 0,
    now,
    cards: (distance?.cards || []).slice(-CARD_LIMIT).map(publicCard),
    touch: touch?.matched ? { id: touch.id, expiresAt: touch.expiresAt, matched: true, joinId: touch.joins[context.viewerId] } :
      touch ? { id: touch.id, userId: touch.userId, expiresAt: touch.expiresAt, matched: false } : null,
    partner: partnerName(context),
    partnerOnline,
    readOnly: !writable(context),
  };
}

/** A bounded shared corner of the existing relationship conversation. Drafts never reach push; a touch tells the partner
 * (in the app through the live event, otherwise by push) so it can be returned within the minute. */
export function createPlayDistanceRouter({ store, emit = () => {}, notify = async () => {}, online = () => false }) {
  const router = express.Router();
  router.use(PATH, (req, res, next) => req.auth?.user?.id ? next() : sendError(req, res, err(401, "sign_in")));

  async function contextFor(userId, db = store) {
    const context = await db.getRelationshipContext(userId);
    if (!context || context.members.length !== 2 || !context.members.some((member) => member.userId === userId)) throw err(409, "pairing_required");
    return { ...context, viewerId: userId };
  }

  async function change(req, act) {
    const userId = req.auth.user.id, initial = await contextFor(userId);
    if (!writable(initial)) throw err(409, "pairing_required");
    const relationshipId = initial.relationship.id;
    const result = await store.transaction(`relationship:${relationshipId}`, async (tx) => {
      const context = await contextFor(userId, tx);
      if (context.relationship.id !== relationshipId || !writable(context)) throw err(409, "relationship_changed");
      const { conversation } = await ensureTogetherConversation(tx, { relationshipId, userId });
      const update = await act({ tx, context, userId, conversation, relationshipId, current: conversation.playDistance || {} });
      if (!update) return { conversation, context, changed: false };
      const updated = await tx.updateRelationshipRecordForUser("togetherConversations", conversation.id, userId, (draft) => {
        draft.playDistance = { ...draft.playDistance, ...update };
        draft.version += 1;
      });
      return { conversation: updated, context, changed: true };
    });
    if (result.changed) emit(result.conversation, "play-distance.updated");
    return result;
  }

  const partnerOf = (context, userId) => context.members.find((member) => member.userId !== userId)?.userId;
  const isOnline = (userId) => { try { return Boolean(userId && online(userId)); } catch { return false; } };

  router.get(PATH, async (req, res) => {
    const userId = req.auth.user.id, context = await contextFor(userId);
    const conversation = await store.getRelationshipRecordForUser("togetherConversations", `together:${context.relationship.id}`, userId);
    res.set("Cache-Control", "private, no-store").json(view(conversation, context, Date.now(), isOnline(partnerOf(context, userId))));
  });

  router.get(`${PATH}/deliveries`, async (req, res) => {
    const userId = req.auth.user.id, context = await contextFor(userId);
    if (!writable(context)) throw err(409, "pairing_required");
    const conversation = await store.getRelationshipRecordForUser("togetherConversations", `together:${context.relationship.id}`, userId);
    res.set("Cache-Control", "private, no-store").json(deliveries(conversation, context));
  });

  router.post(`${PATH}/deliveries/:id/open`, async (req, res) => {
    const { id } = req.params;
    if (!UUID.test(id)) throw err(400, "invalid_card");
    const result = await change(req, async ({ userId, current }) => {
      const cards = current.cards || [];
      const wanted = cards.findIndex((card) => card.id === id && card.showOnOpen && card.userId !== userId);
      if (wanted < 0) return null;
      return { cards: recentAndWaiting(cards.map((card, index) => index === wanted ? { ...card, showOnOpen: false } : card)) };
    });
    res.set("Cache-Control", "private, no-store").json(deliveries(result.conversation, result.context));
  });

  router.post(`${PATH}/cards`, async (req, res) => {
    const { id, kind, photoId, strokes } = req.body || {};
    const text = typeof req.body?.text === "string" ? clean(req.body.text, 180) : "";
    if (typeof id !== "string" || !UUID.test(id) || !["note", "doodle", "photo"].includes(kind) || (kind === "note" && !text)) throw err(400, "invalid_card");
    const shape = kind === "doodle" ? readPlayDrawing(strokes) : null;
    if (kind === "doodle" && !shape) throw err(400, "invalid_card");
    const result = await change(req, async ({ tx, userId, relationshipId, conversation, current }) => {
      if (current.cards?.some((card) => card.id === id && card.userId === userId)) return null;
      const cards = current.cards || [];
      if (cards.filter((card) => card.userId === userId && card.showOnOpen).length >= DELIVERY_LIMIT) throw err(409, "cards_waiting");
      const card = { id, userId, kind, at: new Date().toISOString(), showOnOpen: true };
      if (kind === "note") card.text = text;
      if (kind === "doodle") card.strokes = shape;
      if (kind === "photo") {
        const photo = await visiblePhoto(tx, photoId, userId).catch(() => null);
        if (!photo || photo.ownerUserId !== userId || (photo.relationshipId && photo.relationshipId !== relationshipId)) throw err(400, "invalid_photo");
        const shared = await sharePhotoCopy(tx, { photo, userId, relationshipId }).catch((error) => {
          if (error.code === "ENOENT") throw err(400, "invalid_photo");
          throw error;
        });
        card.photoId = shared.id;
      }
      await markShowedUp(tx, { relationshipId, userId, zone: conversation.zones?.[userId] });
      return { cards: recentAndWaiting([...cards, card]), lastSentAt: { ...current.lastSentAt, [userId]: card.at } };
    });
    if (result.changed) {
      const partner = result.context.members.find((member) => member.userId !== req.auth.user.id)?.userId;
      if (partner && !online(partner)) void Promise.resolve().then(() => notify(partner, {
        body: { zh: "TA 给你留了一张小卡，打开 Ourever 看看。", en: "Your partner left you a little card. Open Ourever to see it.", es: "Tu pareja te dejó una tarjetita. Abre Ourever para verla." },
        url: "/?channel=us",
        tag: "pinky-distance-card",
      })).catch(() => console.error("Distance card push failed."));
    }
    res.json(view(result.conversation, result.context));
  });

  router.post(`${PATH}/touch`, async (req, res) => {
    const { action, id } = req.body || {};
    if (!["join", "leave"].includes(action) || typeof id !== "string" || !UUID.test(id)) throw err(400, "invalid_touch");
    const result = await change(req, async ({ tx, context, userId, relationshipId, conversation, current }) => {
      const now = Date.now(), touch = activeTouch(current.touch, now);
      if (action === "leave") return touch && !touch.matched && touch.userId === userId && touch.id === id ? { touch: null } : null;
      if (touch?.matched || (touch?.userId === userId && touch.id === id)) return null;
      if (touch && touch.userId !== userId) {
        for (const member of context.members) await markShowedUp(tx, { relationshipId, userId: member.userId, zone: conversation.zones?.[member.userId] });
        return { touch: { id: randomUUID(), matched: true, joins: { [touch.userId]: touch.id, [userId]: id }, expiresAt: now + TOUCH_RESULT_MS } };
      }
      return { touch: { id, userId, matched: false, expiresAt: now + TOUCH_MS } };
    });
    const userId = req.auth.user.id, partner = partnerOf(result.context, userId), touch = result.conversation?.playDistance?.touch;
    if (result.changed && action === "join" && partner && !isOnline(partner)) {
      const name = memberName(result.context, userId);
      const message = touch?.matched ? {
        body: { zh: `${name || "TA"}回碰了你，你们碰到了 💗`, en: `${name || "Your partner"} touched back. Your touches met 💗`, es: `${name || "Tu pareja"} te devolvió el toque. Se encontraron 💗` },
        url: "/?channel=us", tag: "pinky-distance-touch-met",
      } : {
        body: { zh: `${name || "TA"}碰了你一下 💗 一分钟内回碰就能碰到彼此。`, en: `${name || "Your partner"} touched you 💗 Touch back within a minute to meet.`, es: `${name || "Tu pareja"} te tocó 💗 Devuélvele el toque en un minuto.` },
        url: "/?channel=us&distance=touch", tag: "pinky-distance-touch",
      };
      void Promise.resolve().then(() => notify(partner, message)).catch(() => console.error("Distance touch push failed."));
    }
    res.json(view(result.conversation, result.context, Date.now(), isOnline(partner)));
  });

  router.use((error, req, res, next) => error?.distanceCode ? sendError(req, res, error) : next(error));
  return router;
}

function sendError(req, res, error) {
  const language = req.body?.language || req.query?.language || req.auth?.user?.language;
  const text = copy[error.distanceCode][language === "en" ? 1 : language === "es" ? 2 : 0];
  res.status(error.status).json({ error: text, code: error.distanceCode });
}
