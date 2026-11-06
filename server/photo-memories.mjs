import express from "express";
import { appendTogetherMessage, togetherI18n } from "./together-domain.mjs";
import { addSpaceItem, ensureMomentSpaces } from "./space-domain.mjs";
import { visiblePhoto } from "./photo-store.mjs";
import { asAiUser } from "./ai-budget.mjs";

// Photo memories (founder 11-05): the iPhone App reads an album the member picks (a shared couple album, thousands of photos)
// and Pinky turns it into the couple's memories, one per day and place, with a few warm words. The founder chose that these
// go straight into the shared album; the partner is told once in Us that the album is connected. Only small copies of a few
// photos per memory leave the phone, and only for memories not made yet.
const PER_EVENT = 4, PER_PLAN = 12, NEAR_KM = 25;
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;
const clean = (value, limit) => typeof value === "string" ? value.trim().replace(/\0/g, "").slice(0, limit) : "";
const isDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const coord = (value, limit) => Number.isFinite(value) && Math.abs(value) <= limit ? value : null;

function km(a, b) {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** Groups photos into memories: one per local day, split by places more than NEAR_KM apart. Photos without a location join
 * that day's biggest place. The key stays the same on every run, so a memory is never made twice. */
export function groupPhotoEvents(assets) {
  const byDay = new Map();
  for (const asset of [...assets].sort((a, b) => a.takenAt.localeCompare(b.takenAt))) {
    if (!byDay.has(asset.day)) byDay.set(asset.day, []);
    byDay.get(asset.day).push(asset);
  }
  const events = [];
  for (const [day, photos] of byDay) {
    const places = [];
    for (const photo of photos.filter((item) => item.lat !== null && item.lon !== null)) {
      const place = places.find((candidate) => km(candidate.center, photo) <= NEAR_KM);
      if (place) place.photos.push(photo); else places.push({ center: { lat: photo.lat, lon: photo.lon }, photos: [photo] });
    }
    const unplaced = photos.filter((item) => item.lat === null || item.lon === null);
    if (unplaced.length) { if (places.length) places.sort((a, b) => b.photos.length - a.photos.length)[0].photos.push(...unplaced); else places.push({ center: null, photos: unplaced }); }
    for (const place of places) {
      const key = `${day}|${place.center ? `${place.center.lat.toFixed(1)},${place.center.lon.toFixed(1)}` : "-"}`;
      const sorted = place.photos.sort((a, b) => a.takenAt.localeCompare(b.takenAt));
      // A few photos spread across the day or outing, not the first burst.
      const step = sorted.length / Math.min(PER_EVENT, sorted.length);
      const picks = Array.from({ length: Math.min(PER_EVENT, sorted.length) }, (_, index) => sorted[Math.floor(index * step)]);
      events.push({ key, day, lat: place.center?.lat ?? null, lon: place.center?.lon ?? null, count: sorted.length, assets: picks.map((photo) => photo.id) });
    }
  }
  return events;
}

const memorySchema = { type: "object", additionalProperties: false, required: ["title", "text"], properties: { title: { type: "string" }, text: { type: "string" } } };
// 11-05: the first words read like a template ("kept in 19 photos… May these pictures…"). One short line, as a friend would say it.
const memoryInstructions = (language) => `You write the caption for one memory in a couple's shared photo album. You know only the date, the place and how many photos they took that day; you cannot see the photos.
Title: just the place or the occasion, as they would call it (for example "Magic Kingdom", "旧金山", "Puerto Rico"), never "A day in…" or a date.
Text: one short, warm sentence to the couple (at most 30 Chinese characters or 20 words), about being there together. Vary how you start. Never mention the date, the number of photos, "these photos/pictures", "kept here", or wishes such as "May…". Never invent what happened, the weather, food or anyone's feelings beyond two people enjoying that place together. Speak about the two of them, never as if you were there or part of it. A day with many photos may sound a little fuller; that is all the count tells you.
Write in ${language === "en" ? "English" : language === "es" ? "Spanish" : "Simplified Chinese"}, addressing them as 你们 / you two / ustedes. No exclamation marks, no emoji.`;

export function createPhotoMemoryRouter({ store, mediator, emit = () => {} }) {
  const router = express.Router();
  router.use("/photo-memories", (req, res, next) => req.auth ? next() : res.status(401).json({ error: "Please sign in." }));

  const pair = async (userId) => {
    const context = await store.getRelationshipContext(userId);
    if (!(context?.relationship.status === "active" && context.members.length === 2)) throw fail(409, "Invite your partner first.");
    await ensureMomentSpaces(store, userId);
    const album = (await store.listRelationshipRecordsForUser("spaces", userId)).find((space) => space.system === "moments" && space.visibility === "shared" && space.relationshipId === context.relationship.id && !space.archivedAt);
    if (!album) throw fail(409, "The shared album is not ready.");
    return { context, album };
  };
  const madeKeys = async (userId, album) => new Set((await store.listRelationshipRecordsForUser("spaceItems", userId)).filter((item) => item.spaceId === album.id && item.photoEvent && !item.archivedAt).map((item) => item.photoEvent));

  // The phone sends what the album holds (ids, times, places; no pictures) and gets back the next memories to make, newest
  // first, with the few photos each needs. It repeats until nothing is left.
  router.post("/photo-memories/plan", async (req, res) => {
    const userId = req.auth.user.id, { album } = await pair(userId);
    const assets = (Array.isArray(req.body?.assets) ? req.body.assets : []).slice(0, 20000).map((asset) => ({
      id: clean(asset?.id, 200), takenAt: clean(asset?.takenAt, 40), day: clean(asset?.day, 10), lat: coord(asset?.lat, 90), lon: coord(asset?.lon, 180),
    })).filter((asset) => asset.id && asset.takenAt && isDay(asset.day));
    const made = await madeKeys(userId, album);
    const pending = groupPhotoEvents(assets).filter((event) => !made.has(event.key)).sort((a, b) => b.day.localeCompare(a.day));
    res.json({ events: pending.slice(0, PER_PLAN), remaining: pending.length, made: made.size });
  });

  // One memory: the uploaded shared photos (already in Us's photo store), the place name the phone looked up, and the key.
  router.post("/photo-memories/events", async (req, res) => {
    const user = req.auth.user, userId = user.id, { context, album } = await pair(userId);
    const key = clean(req.body?.key, 80), day = clean(req.body?.day, 10), place = clean(req.body?.place, 80), language = ["zh", "en", "es"].includes(req.body?.language) ? req.body.language : "zh";
    if (!key || !isDay(day) || !key.startsWith(`${day}|`)) throw fail(400, "Bad memory.");
    const photoIds = (Array.isArray(req.body?.photoIds) ? req.body.photoIds : []).map((id) => clean(id, 80)).filter(Boolean).slice(0, PER_EVENT);
    if (!photoIds.length) throw fail(400, "Send the photos first.");
    if ((await madeKeys(userId, album)).has(key)) return res.json({ duplicate: true });
    let words = { title: place || day, text: "" };
    try {
      const made = await asAiUser({ userId, relationshipId: context.relationship.id, language }, () => mediator.structured({ name: "photo_memory", schema: memorySchema, instructions: memoryInstructions(language), input: JSON.stringify({ date: day, place: place || null, photos: Number(req.body?.count) || photoIds.length }), maxOutputTokens: 300 }));
      words = { title: clean(made?.title, 60) || words.title, text: clean(made?.text, 400) };
    } catch (error) { console.error("Photo memory words failed:", error?.message || error); /* The memory is kept with the place as its title. */ }
    const items = await store.transaction(`relationship:${context.relationship.id}`, async (tx) => {
      // Checked again here: two requests for the same memory can both pass the early check while the words are written.
      const inAlbum = (await tx.listRelationshipRecordsForUser("spaceItems", userId)).filter((item) => item.spaceId === album.id && item.photoEvent && !item.archivedAt);
      if (inAlbum.some((item) => item.photoEvent === key)) return null;
      const first = !inAlbum.length;
      const created = [];
      for (const id of photoIds) {
        const photo = await visiblePhoto(tx, id, userId);
        if (photo.ownerUserId !== userId || photo.visibility !== "shared" || photo.relationshipId !== context.relationship.id) throw fail(400, "That photo cannot go here.");
        created.push(await addSpaceItem(tx, { userId, space: album, title: words.title, text: created.length ? "" : words.text, date: day, photoId: photo.id, photoEvent: key, source: "photo_album" }));
      }
      // The first memory from a connected album tells the partner, once, where these come from.
      if (first) {
        const name = user.name || "TA";
        const line = (lang) => say(lang, `${name} 连接了 iPhone 相册，Pinky 会把里面的照片整理成你们的回忆。`, `${name} connected an iPhone album; Pinky is turning its photos into your memories.`, `${name} conectó un álbum del iPhone; Pinky está convirtiendo sus fotos en sus recuerdos.`);
        const sent = await appendTogetherMessage(tx, { relationshipId: context.relationship.id, userId, source: "app", handle: `photo-album:${context.relationship.id}`, i18n: togetherI18n(line), text: line(language) });
        if (!sent.duplicate) router.emitTogether?.(sent.conversation, null);
      }
      return created;
    });
    if (!items) return res.json({ duplicate: true });
    for (const item of items) emit(item, "space.updated");
    res.status(201).json({ title: words.title, items: items.length });
  });
  return router;
}
