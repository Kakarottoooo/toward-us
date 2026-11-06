import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { canViewRecord, createRelationshipRecord } from "./relationship-domain.mjs";

// Photo bytes live on local disk next to the data file during dogfooding; each photo has a graph record that decides who may
// see it. Hosted production needs object storage instead (an open, priced decision for the founder).
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
// A connected phone album adds a few photos per memory over years of photos.
const MAX_BYTES = 8 * 1024 * 1024, PHOTO_LIMIT = 6000;
const mediaDirectory = () => process.env.TOWARD_US_DATA_FILE ? `${process.env.TOWARD_US_DATA_FILE}.media` : join(tmpdir(), "pinky-media");
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const fileFor = (record) => join(mediaDirectory(), `${record.fileId}.${TYPES[record.mime]}`);
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

export function createPhotoRouter({ store }) {
  const router = express.Router();
  router.use("/photos", (req, res, next) => req.auth ? next() : res.status(401).json({ error: "Please sign in." }));
  // Upload: private by default; "shared" only inside an active couple, because sending to Us is itself the share.
  router.post("/photos", express.raw({ type: Object.keys(TYPES), limit: MAX_BYTES }), async (req, res) => {
    const userId = req.auth.user.id, mime = String(req.headers["content-type"] || "").split(";")[0];
    if (!TYPES[mime] || !Buffer.isBuffer(req.body) || !req.body.length) throw fail(400, "Send a JPEG, PNG or WebP image.");
    const context = await store.getRelationshipContext(userId);
    const shared = req.query.scope === "shared";
    if (shared && !(context?.relationship.status === "active" && context.members.length === 2)) throw fail(409, "Invite your partner before sharing photos.");
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
    const bytes = await readFile(fileFor(record)).catch(() => null);
    if (!bytes) throw fail(404, "Photo not found.");
    res.set({ "content-type": record.mime, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" }).send(bytes);
  });
  router.use((error, _req, res, next) => error.statusCode ? res.status(error.statusCode).json({ error: error.message }) : error.type === "entity.too.large" ? res.status(413).json({ error: "This photo is too large." }) : next(error));
  return router;
}
