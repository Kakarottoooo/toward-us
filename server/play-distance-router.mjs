import express from "express";
import { randomUUID } from "node:crypto";
import { clean } from "./agreement-actions.mjs";
import { sharePhotoCopy, visiblePhoto } from "./photo-store.mjs";
import { markShowedUp } from "./streak.mjs";
import { ensureTogetherConversation } from "./together-domain.mjs";
import { readPlayDrawing } from "./play-drawing.mjs";

const PATH = "/play-distance";
const CARD_LIMIT = 20;
const TOUCH_MS = 10_000;
const TOUCH_RESULT_MS = 20_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const writable = (context) => context?.relationship.status === "active" && context.members.length === 2;
const err = (status, code) => Object.assign(new Error(code), { distanceCode: code, status });
const copy = {
  sign_in: ["请先登录。", "Please sign in first.", "Inicia sesión primero."],
  pairing_required: ["和 TA 配对后就能使用。", "Link with your partner to use this.", "Vincúlate con tu pareja para usarlo."],
  relationship_changed: ["共同空间已更新，请刷新。", "Your shared space changed. Refresh to continue.", "El espacio compartido cambió. Actualiza para continuar."],
  invalid_card: ["这张卡没能发送，请检查内容。", "Couldn’t send this card. Check its content.", "No se pudo enviar esta tarjeta. Revisa su contenido."],
  invalid_photo: ["这张照片没能读取，请重新挑一张。", "Couldn’t open this photo. Pick it again.", "No se pudo abrir esta foto. Elígela de nuevo."],
  invalid_touch: ["没能一起碰一下，请重试。", "Couldn’t tap together. Try again.", "No se pudo tocar juntos. Inténtalo de nuevo."],
};

function activeTouch(touch, now) {
  return touch && touch.expiresAt > now ? touch : null;
}

function view(conversation, context, now = Date.now()) {
  const distance = conversation?.playDistance;
  const touch = activeTouch(distance?.touch, now);
  return {
    version: conversation?.version || 0,
    now,
    cards: distance?.cards || [],
    touch: touch?.matched ? { id: touch.id, expiresAt: touch.expiresAt, matched: true, joinId: touch.joins[context.viewerId] } :
      touch ? { id: touch.id, userId: touch.userId, expiresAt: touch.expiresAt, matched: false } : null,
    partner: context.members.find((member) => member.userId !== context.viewerId)?.user?.name || "",
    readOnly: !writable(context),
  };
}

/** A bounded shared corner of the existing relationship conversation. Drafts and touch timers never reach push. */
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

  router.get(PATH, async (req, res) => {
    const userId = req.auth.user.id, context = await contextFor(userId);
    const conversation = await store.getRelationshipRecordForUser("togetherConversations", `together:${context.relationship.id}`, userId);
    res.set("Cache-Control", "private, no-store").json(view(conversation, context));
  });

  router.post(`${PATH}/cards`, async (req, res) => {
    const { id, kind, photoId, strokes } = req.body || {};
    const text = typeof req.body?.text === "string" ? clean(req.body.text, 180) : "";
    if (typeof id !== "string" || !UUID.test(id) || !["note", "doodle", "photo"].includes(kind) || (kind === "note" && !text)) throw err(400, "invalid_card");
    const shape = kind === "doodle" ? readPlayDrawing(strokes) : null;
    if (kind === "doodle" && !shape) throw err(400, "invalid_card");
    const result = await change(req, async ({ tx, userId, relationshipId, conversation, current }) => {
      if (current.cards?.some((card) => card.id === id && card.userId === userId)) return null;
      const card = { id, userId, kind, at: new Date().toISOString() };
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
      return { cards: [...(current.cards || []), card].slice(-CARD_LIMIT), lastSentAt: { ...current.lastSentAt, [userId]: card.at } };
    });
    if (result.changed) {
      const partner = result.context.members.find((member) => member.userId !== req.auth.user.id)?.userId;
      if (partner && !online(partner)) void Promise.resolve().then(() => notify(partner, {
        body: { zh: "TA 给你留了一张小卡，打开 Pinky 看看。", en: "Your partner left you a little card. Open Pinky to see it.", es: "Tu pareja te dejó una tarjetita. Abre Pinky para verla." },
        url: "/?channel=us&distance=1",
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
    res.json(view(result.conversation, result.context));
  });

  router.use((error, req, res, next) => error?.distanceCode ? sendError(req, res, error) : next(error));
  return router;
}

function sendError(req, res, error) {
  const language = req.body?.language || req.query?.language || req.auth?.user?.language;
  const text = copy[error.distanceCode][language === "en" ? 1 : language === "es" ? 2 : 0];
  res.status(error.status).json({ error: text, code: error.distanceCode });
}
