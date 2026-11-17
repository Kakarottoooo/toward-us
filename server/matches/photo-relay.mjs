import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { mediaDirectory } from "../media-dir.mjs";
import { photoFile } from "../photo-store.mjs";
import { canViewRecord, createRelationshipRecord } from "../relationship-domain.mjs";
import { BOTH, matchError } from "./errors.mjs";

const prompt = (zh, en, es) => ({ zh, en, es });
const prompts = [
  prompt("拍下你眼前的一点蓝色。", "Find something blue where you are.", "Fotografía algo azul que tengas cerca."),
  prompt("拍下一道有趣的影子。", "Find a shadow with an interesting shape.", "Busca una sombra con una forma interesante."),
  prompt("拍下今天让你停下来多看一眼的东西。", "Capture something that made you look twice today.", "Fotografía algo que hoy te haya hecho mirar dos veces."),
  prompt("拍下一个从上往下看很有意思的东西。", "Take a photo straight down at something interesting.", "Fotografía desde arriba algo que te llame la atención."),
  prompt("拍下你附近最舒服的一角。", "Find the coziest corner near you.", "Fotografía el rincón más acogedor que tengas cerca."),
  prompt("拍下一处倒影。", "Find a reflection.", "Fotografía un reflejo."),
  prompt("拍下一个圆圆的东西。", "Find something round.", "Fotografía algo redondo."),
  prompt("拍下今天你喝的第一杯东西。", "Capture the first thing you drank today.", "Fotografía lo primero que bebiste hoy."),
  prompt("拍下一点窗外的天空。", "Capture a piece of sky from where you are.", "Fotografía un pedacito de cielo desde donde estás."),
  prompt("拍下一个你想送给 TA 的颜色。", "Find a color you'd give to your partner.", "Fotografía un color que le regalarías a tu pareja."),
  prompt("拍下一个让你想起 TA 的小东西。", "Find a little thing that reminds you of your partner.", "Fotografía algo pequeño que te recuerde a tu pareja."),
  prompt("拍下你今天看到最可爱的东西。", "Capture the cutest thing you saw today.", "Fotografía lo más tierno que viste hoy."),
  prompt("拍下一组正在重复的形状。", "Find a pattern that repeats.", "Fotografía un patrón que se repita."),
  prompt("拍下一样很旧但还在用的东西。", "Find something old that's still useful.", "Fotografía algo viejo que todavía uses."),
  prompt("拍下一道光落在东西上。", "Catch the light falling on something.", "Atrapa un rayo de luz que caiga sobre algo."),
  prompt("拍下只有靠近了才发现的细节。", "Find a detail you only notice up close.", "Fotografía un detalle que solo se vea de cerca."),
];

const MAX_JPEG_BYTES = 6 * 1024 * 1024;
const parts = new Set(["self", "pair"]);
const notFound = () => matchError(404, "not_found");

async function normalizePhoto(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_JPEG_BYTES) throw matchError(400, "photo_relay_unreadable");
  try {
    const { default: sharp } = await import("sharp");
    const source = sharp(bytes, { limitInputPixels: 20_000_000 });
    if ((await source.metadata()).format !== "jpeg") throw new Error("Expected JPEG.");
    return await source.rotate().resize({ width: 1050, height: 1050, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#fffaf1" }).jpeg({ quality: 84 }).toBuffer();
  } catch {
    throw matchError(400, "photo_relay_unreadable");
  }
}

async function savePhoto(tx, { match, userId, bytes }) {
  const photo = await normalizePhoto(bytes);
  const record = createRelationshipRecord({
    relationshipId: null, userId, visibility: "private", aiAccessScope: "none",
    mime: "image/jpeg", bytes: photo.length, fileId: randomUUID(),
    relayMatchId: match.id, relayRelationshipId: match.relationshipId, provenanceSource: "photo_relay",
  });
  await mkdir(mediaDirectory(), { recursive: true });
  const file = photoFile(record);
  await writeFile(file, photo, { flag: "wx" });
  try { await tx.createRelationshipRecord("photos", record); }
  catch (error) { await unlink(file).catch(() => {}); throw error; }
  return record.id;
}

async function readSubmittedPhoto(store, match, index) {
  const id = match.state.photos[index], owner = match.state.players[index];
  if (!id || !owner) throw notFound();
  const record = await store.getRelationshipRecordForUser("photos", id, owner);
  if (!record || record.visibility !== "private" || record.aiAccessScope !== "none" ||
      record.relationshipId !== null || record.relayMatchId !== match.id ||
      record.relayRelationshipId !== match.relationshipId || !canViewRecord(record, owner)) throw notFound();
  return await readFile(photoFile(record)).catch(() => { throw notFound(); });
}

export async function readPhotoRelayMedia({ store, matchId, userId, part }) {
  if (!parts.has(part)) throw notFound();
  const [context, match] = await Promise.all([
    store.getRelationshipContext(userId),
    store.getRelationshipRecordForUser("matches", matchId, userId),
  ]);
  if (context?.relationship.status !== "active" || context.members.length !== 2 || match?.game !== "photo-relay" ||
      match.relationshipId !== context.relationship.id || match.archivedAt || !["active", "finished"].includes(match.status) ||
      !match.players.includes(userId) || !match.state.players.includes(userId) ||
      !match.players.every((id) => context.members.some((member) => member.userId === id))) throw notFound();
  if (part === "self") return readSubmittedPhoto(store, match, match.state.players.indexOf(userId));
  if (match.status !== "finished" || !match.state.photos.every(Boolean)) throw notFound();

  const { default: sharp } = await import("sharp");
  const frame = "#fff4e9", size = 560, margin = 24, gap = 12;
  const tiles = await Promise.all(match.state.players.map(async (_player, index) => {
    const bytes = await readSubmittedPhoto(store, match, index);
    return sharp(bytes).resize({ width: size, height: size, fit: "contain", background: frame }).jpeg({ quality: 90 }).toBuffer();
  }));
  return sharp({ create: { width: 2 * (size + margin) + gap, height: size + 2 * margin, channels: 3, background: frame } })
    .composite(tiles.map((input, index) => ({ input, top: margin, left: margin + index * (size + gap) })))
    .jpeg({ quality: 87 }).toBuffer();
}

export const photoRelay = {
  id: "photo-relay",
  category: "casual",
  start({ players, inviterUserId, previous }) {
    const orderedPlayers = [inviterUserId, ...players.filter((id) => id !== inviterUserId)];
    const promptIndex = ((previous[0]?.state.promptIndex ?? -1) + 1) % prompts.length;
    return { players: orderedPlayers, promptIndex, photos: [null, null] };
  },
  async prepareAction({ tx, match, userId, action }) {
    if (action?.type !== "submit") return action;
    const position = match.state.players.indexOf(userId);
    if (position < 0) throw notFound();
    const photoId = match.state.photos[position] || await savePhoto(tx, { match, userId, bytes: action.bytes });
    return { type: "submit", photoId };
  },
  act(state, { userId, action }) {
    const position = state.players.indexOf(userId);
    if (position < 0 || action?.type !== "submit" || typeof action.photoId !== "string") throw matchError(400, "invalid_action");
    if (state.photos[position]) return state;
    const photos = [...state.photos];
    photos[position] = action.photoId;
    return { ...state, photos };
  },
  turn(state) {
    const waiting = state.players.filter((_, index) => !state.photos[index]);
    return waiting.length === 2 ? BOTH : waiting[0] || null;
  },
  finished(state) { return state.photos.every(Boolean); },
  view(state, userId) {
    const position = state.players.indexOf(userId);
    return {
      prompt: prompts[state.promptIndex],
      submitted: Boolean(state.photos[position]),
      partnerSubmitted: Boolean(state.photos[1 - position]),
      revealed: state.photos.every(Boolean),
    };
  },
  stats(matches) { return { played: matches.filter((match) => match.state.photos.every(Boolean)).length }; },
  announce() {
    return prompt("你们的拍照接力拼成了一张合照。点开那局看看。", "Your Photo Relay collage is ready. Open the round to see it.", "Su collage del Reto de fotos está listo. Abran la partida para verlo.");
  },
};
