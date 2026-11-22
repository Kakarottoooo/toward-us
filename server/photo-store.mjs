import { signInText } from "./request-language.mjs";
import { screenImage } from "./ai-screening.mjs";
import { randomUUID } from "node:crypto";
import { mediaDirectory } from "./media-dir.mjs";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import express from "express";
import { canViewRecord, createRelationshipRecord } from "./relationship-domain.mjs";

// Photo bytes live on local disk next to the data file during dogfooding; each photo has a graph record that decides who may
// see it. Hosted production needs object storage instead (an open, priced decision for the founder).
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
// A connected phone album adds a few photos per memory over years of photos.
const MAX_BYTES = 8 * 1024 * 1024, PHOTO_LIMIT = 6000;
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const fileFor = (record) => join(mediaDirectory(), `${record.fileId}.${TYPES[record.mime]}`);
const THUMB_WIDTHS = new Set([240, 480]);
const thumbFor = (record, width) => join(mediaDirectory(), `${record.fileId}.w${width}.jpg`);
/** A small JPEG of a photo, made on first use and kept on disk. Falls back to the photo itself if it cannot be made. */
async function thumbnail(record, width) {
  const cached = await readFile(thumbFor(record, width)).catch(() => null);
  if (cached) return cached;
  const original = await readFile(fileFor(record)).catch(() => null);
  if (!original) return null;
  try {
    const { default: sharp } = await import("sharp");
    const small = await sharp(original).rotate().resize({ width, height: width, fit: "cover", withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
    await writeFile(thumbFor(record, width), small).catch(() => {});
    return small;
  } catch { return original; }
}
/** Where a photo's bytes are on disk, for server-side readers such as screenshot import. */
export const photoFile = fileFor;

/** A visible photo record, or a 404 that does not reveal whether the photo exists. */
export async function visiblePhoto(db, id, userId) {
  const record = typeof id === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(id) ? await db.getRelationshipRecordForUser("photos", id, userId) : null;
  if (!record || !canViewRecord(record, userId)) throw fail(404, "Photo not found.");
  return record;
}

/** The same picture as a shared photo of the couple, made only after its owner confirmed sharing it. */
export async function sharePhotoCopy(tx, { photo, userId, relationshipId }) {
  if (photo.ownerUserId !== userId) throw fail(403, "Only the owner can share this photo.");
  if (photo.visibility === "shared" && photo.relationshipId === relationshipId) return photo;
  const record = createRelationshipRecord({ relationshipId, userId, visibility: "shared", aiAccessScope: "joint", mime: photo.mime, bytes: photo.bytes, fileId: randomUUID(), sharedFromId: photo.id, provenanceSource: "member_confirmed" });
  await copyFile(fileFor(photo), fileFor(record));
  await tx.createRelationshipRecord("photos", record);
  return record;
}

// A shared photo is screened by Ourever's AI first. When that check can't run (AI declined or unavailable), say so in photo
// words with the way out, not the text-message copy (QA round 5).
function photoScreeningError(error, req) {
  if (!["ai_screening_unavailable", "ai_consent_required"].includes(error?.code)) return error;
  const language = [req.query?.language, req.auth?.user?.language].find((value) => ["zh", "en", "es"].includes(value)) || String(req.headers?.["accept-language"] || "").toLowerCase().match(/^\s*(zh|en|es)(?![a-z])/)?.[1] || "en";
  const off = error.code === "ai_consent_required";
  const text = language === "zh"
    ? off ? "发到“我们俩”的照片要先经过 Ourever 的 AI 安全检查，你关掉了 AI，所以这张照片暂时发不出去。可以先存为只有你能看的照片，或在设置里打开 AI。" : "发到“我们俩”的照片要先经过 Ourever 的 AI 安全检查，现在检查不了，所以这张照片暂时发不出去。可以先存为只有你能看的照片，稍后再发。"
    : language === "es"
      ? off ? "Las fotos que se comparten en Nosotros pasan primero por la revisión de seguridad con IA de Ourever. Tienes la IA desactivada, así que esta foto no se puede compartir por ahora. Guárdala en privado o activa la IA en Ajustes." : "Las fotos que se comparten en Nosotros pasan primero por la revisión de seguridad con IA de Ourever, que ahora no está disponible, así que esta foto no se puede compartir todavía. Guárdala en privado y compártela más tarde."
      : off ? "Photos shared in Us go through Ourever's AI safety check first. AI is off for you, so this photo can't be shared for now. Keep it private, or turn AI on in Settings." : "Photos shared in Us go through Ourever's AI safety check first, and it isn't available right now, so this photo can't be shared yet. Keep it private for now and share it later.";
  return Object.assign(new Error(text), { code: error.code, statusCode: error.statusCode || (off ? 403 : 503) });
}

export function createPhotoRouter({ store }) {
  const router = express.Router();
  router.use("/photos", (req, res, next) => req.auth ? next() : res.status(401).json({ error: signInText(req) }));
  // Upload: private by default; "shared" only inside an active couple, because sending to Us is itself the share.
  router.post("/photos", express.raw({ type: Object.keys(TYPES), limit: MAX_BYTES }), async (req, res) => {
    const userId = req.auth.user.id, mime = String(req.headers["content-type"] || "").split(";")[0];
    if (!TYPES[mime] || !Buffer.isBuffer(req.body) || !req.body.length) throw fail(400, "Send a JPEG, PNG or WebP image.");
    const context = await store.getRelationshipContext(userId);
    const shared = req.query.scope === "shared";
    if (shared && !(context?.relationship.status === "active" && context.members.length === 2)) throw fail(409, "Invite your partner before sharing photos.");
    if (shared) await screenImage(req.body, mime).catch((error) => { throw photoScreeningError(error, req); });
    const record = createRelationshipRecord({ relationshipId: shared ? context.relationship.id : null, userId, visibility: shared ? "shared" : "private", aiAccessScope: shared ? "joint" : "private", mime, bytes: req.body.length, fileId: randomUUID() });
    await store.transaction(shared ? `relationship:${context.relationship.id}` : `user:${userId}`, async (tx) => {
      const mine = (await tx.listRelationshipRecordsForUser("photos", userId)).filter((photo) => photo.ownerUserId === userId && !photo.archivedAt);
      if (mine.length >= PHOTO_LIMIT) throw fail(409, "Photo limit reached.");
      await mkdir(mediaDirectory(), { recursive: true });
      await writeFile(fileFor(record), req.body);
      await tx.createRelationshipRecord("photos", record);
    });
    res.status(201).json({ photo: { id: record.id, visibility: record.visibility } });
  });
  router.get("/photos/:id", async (req, res) => {
    const record = await visiblePhoto(store, req.params.id, req.auth.user.id);
    // ?w=240 or ?w=480: a small JPEG for bubbles and photo walls, made once and kept beside the photo. Showing hundreds of
    // full 1280px photos as 60-130px tiles made Memories stutter on the phone (11-06).
    const width = THUMB_WIDTHS.has(Number(req.query.w)) ? Number(req.query.w) : 0;
    const bytes = width ? await thumbnail(record, width) : await readFile(fileFor(record)).catch(() => null);
    if (!bytes) throw fail(404, "Photo not found.");
    res.set({ "content-type": width ? "image/jpeg" : record.mime, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" }).send(bytes);
  });
  router.use((error, _req, res, next) => error.statusCode ? res.status(error.statusCode).json({ error: error.message }) : error.type === "entity.too.large" ? res.status(413).json({ error: "This photo is too large." }) : next(error));
  return router;
}
