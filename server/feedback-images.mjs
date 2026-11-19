import express from "express";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import sharp from "sharp";
import { mediaDirectory } from "./media-dir.mjs";
import { visiblePhoto, photoFile } from "./photo-store.mjs";

const MAX_BYTES = 5 * 1024 * 1024, MAX_PIXELS = 24_000_000;
const formats = { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp", "image/heic": "heic" };
export const feedbackError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const invalid = () => feedbackError(400, "invalid_feedback_image");
export const feedbackFile = (fileId) => {
  if (!/^[0-9a-f-]{36}$/.test(fileId)) throw invalid();
  return join(mediaDirectory(), "feedback", fileId + ".webp");
};

// Bound memory even when several accounts upload their full four-image allowance simultaneously.
let active = 0;
export function limitFeedbackUploads(req, res, next) {
  if (!req.is("multipart/form-data") || (req.get("content-length") && Number(req.get("content-length")) < 128 * 1024)) return next();
  if (active >= 2) return res.status(503).set("Retry-After", "5").json({ error: "feedback_upload_busy" });
  active++;
  // Keep the slot until image processing finishes, including after a disconnected client.
  res.locals.releaseFeedbackUpload = () => { if (res.locals.releaseFeedbackUpload) { active--; delete res.locals.releaseFeedbackUpload; } };
  next();
}

export const readMultipart = express.raw({ type: "multipart/form-data", inflate: false, limit: MAX_BYTES * 4 + 128 * 1024 });

export async function feedbackParts(req) {
  if (!req.is("multipart/form-data")) return { body: req.body, files: [] };
  let form, body;
  try {
    form = await new Response(req.body, { headers: { "content-type": req.get("content-type") } }).formData();
    if (form.getAll("payload").length !== 1 || typeof form.get("payload") !== "string" || form.get("payload").length > 32_768) throw new Error();
    body = JSON.parse(form.get("payload"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    for (const key of form.keys()) if (key !== "images" && key !== "payload") throw new Error();
  } catch { throw feedbackError(400, "invalid_feedback_form"); }
  const files = form.getAll("images");
  if (files.length > 4 || body.photoIds?.length) throw feedbackError(400, "invalid_attachment_count");
  for (const file of files) {
    if (typeof file === "string" || !Object.hasOwn(formats, file.type)) throw invalid();
    if (file.size > MAX_BYTES) throw feedbackError(413, "feedback_image_too_large");
  }
  return { body, files };
}

function decodeHeic(bytes) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./feedback-heic-worker.mjs", import.meta.url), {
      workerData: { bytes, pixels: MAX_PIXELS }, stdout: true, stderr: true, resourceLimits: { maxOldGenerationSizeMb: 96 },
    });
    worker.stdout.resume(); worker.stderr.resume();
    const timer = setTimeout(() => { reject(invalid()); void worker.terminate(); }, 15_000);
    worker.once("message", (result) => { clearTimeout(timer); if (result?.length) resolve(Buffer.from(result)); else reject(invalid()); void worker.terminate(); });
    worker.once("error", () => { clearTimeout(timer); reject(invalid()); });
    worker.once("exit", () => { clearTimeout(timer); reject(invalid()); });
  });
}

async function reencode(bytes, mime) {
  if (bytes.length > MAX_BYTES) throw feedbackError(413, "feedback_image_too_large");
  try {
    if (!Object.hasOwn(formats, mime)) throw invalid();
    if (mime === "image/heic") {
      // ISO BMFF alone also describes AVIF/video. Require a HEIC compatible brand within ftyp.
      const length = bytes.readUInt32BE(0);
      if (bytes.toString("ascii", 4, 8) !== "ftyp" || length < 16 || length > Math.min(4096, bytes.length)) throw invalid();
      const brands = [bytes.toString("ascii", 8, 12)];
      for (let i = 16; i + 4 <= length; i += 4) brands.push(bytes.toString("ascii", i, i + 4));
      if (!brands.some((brand) => ["heic", "heix", "hevc", "hevx"].includes(brand)) || brands.includes("avif") || brands.includes("avis")) throw invalid();
      return await decodeHeic(bytes);
    }
    const image = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "warning" });
    if ((await image.metadata()).format !== formats[mime]) throw invalid();
    return await image.rotate().resize({ width: 3000, height: 3000, fit: "inside", withoutEnlargement: true }).webp({ quality: 86 }).toBuffer();
  } catch { throw invalid(); }
}

async function legacyBytes(store, userId, id) {
  const photo = await visiblePhoto(store, id, userId).catch(() => null);
  if (!photo || photo.ownerUserId !== userId || photo.visibility !== "private") throw invalid();
  if (photo.bytes > MAX_BYTES) throw feedbackError(413, "feedback_image_too_large");
  const bytes = await readFile(photoFile(photo)).catch(() => { throw invalid(); });
  return reencode(bytes, photo.mime);
}

let decoding = 0;
export async function saveFeedbackImages(store, userId, files, photoIds, written) {
  if (!files.length && !photoIds.length) return;
  if (decoding >= 2) throw Object.assign(feedbackError(503, "feedback_upload_busy"), { retryAfter: 5 });
  decoding++;
  try {
    await mkdir(join(mediaDirectory(), "feedback"), { recursive: true });
    for (const file of [...files, ...photoIds]) {
      const bytes = typeof file === "string" ? await legacyBytes(store, userId, file) : await reencode(Buffer.from(await file.arrayBuffer()), file.type);
      const id = randomUUID();
      written.push(id);
      await writeFile(feedbackFile(id), bytes, { flag: "wx", mode: 0o600 });
    }
  } finally { decoding--; }
}

export async function attachmentBytes(store, record, index) {
  if (!/^(0|[1-9]\d?)$/.test(index)) throw feedbackError(404, "attachment_not_found");
  const file = record.attachmentIds?.[Number(index)];
  if (file) return readFile(feedbackFile(file)).catch(() => { throw feedbackError(404, "attachment_not_found"); });
  // Legacy reports referenced private library photos. Send only a fresh metadata-free encoding, never original bytes.
  const photoId = record.photoIds?.[Number(index)];
  if (!record.attachmentIds && photoId) return legacyBytes(store, record.ownerUserId, photoId);
  throw feedbackError(404, "attachment_not_found");
}

export async function removeFeedbackFiles(ids) {
  await Promise.all(ids.map((id) => rm(feedbackFile(id), { force: true })));
}
