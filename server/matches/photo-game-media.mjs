import { readFile } from "node:fs/promises";
import { photoFile } from "../photo-store.mjs";
import { canViewRecord } from "../relationship-domain.mjs";
import { MOMENTS } from "../space-domain.mjs";
import { matchError } from "./errors.mjs";

const sharedActive = (record, relationshipId, userId) => Boolean(record &&
  record.relationshipId === relationshipId && record.visibility === "shared" && canViewRecord(record, userId));
const unavailable = () => matchError(404, "game_photo_unavailable");

async function albumItems(store, userId, relationshipId) {
  const album = (await store.listRelationshipRecordsForUser("spaces", userId))
    .find((space) => space.system === MOMENTS && sharedActive(space, relationshipId, userId));
  if (!album) return [];
  return (await store.listRelationshipRecordsForUser("spaceItems", userId))
    .filter((item) => item.spaceId === album.id && item.photoId && sharedActive(item, relationshipId, userId));
}

export async function listGamePhotos(store, { userId, relationshipId, after }) {
  const [items, photos] = await Promise.all([albumItems(store, userId, relationshipId), store.listRelationshipRecordsForUser("photos", userId)]);
  const visible = new Set(photos.filter((record) => sharedActive(record, relationshipId, userId)).map((record) => record.id));
  const unique = new Map();
  for (const item of items.sort((a, b) => (b.date || b.createdAt).localeCompare(a.date || a.createdAt) || a.id.localeCompare(b.id))) {
    if (visible.has(item.photoId) && !unique.has(item.photoId)) unique.set(item.photoId, { id: item.photoId, title: item.title });
  }
  const options = [...unique.values()];
  const index = after ? options.findIndex((item) => item.id === after) : -1;
  const start = index + 1;
  const photosPage = options.slice(start, start + 24);
  return { photos: photosPage, next: start + photosPage.length < options.length ? photosPage.at(-1).id : null };
}

export async function requireGamePhoto(store, { userId, relationshipId, photoId }) {
  if (typeof photoId !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(photoId)) throw unavailable();
  const [record, items] = await Promise.all([
    store.getRelationshipRecordForUser("photos", photoId, userId),
    albumItems(store, userId, relationshipId),
  ]);
  if (!sharedActive(record, relationshipId, userId) || !items.some((item) => item.photoId === photoId)) throw unavailable();
  return record;
}

export async function readGamePhoto(record, { full = false, crop = 0 } = {}) {
  try {
    const { default: sharp } = await import("sharp");
    const input = await readFile(photoFile(record));
    if (full) return await sharp(input).rotate().resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    const square = await sharp(input).rotate().resize(720, 720, { fit: "cover" }).toBuffer();
    return await sharp(square).extract({ left: (crop % 3) * 240, top: Math.floor(crop / 3) * 240, width: 240, height: 240 })
      .jpeg({ quality: 80 }).toBuffer();
  } catch { throw unavailable(); }
}
