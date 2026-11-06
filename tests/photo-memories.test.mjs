import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createPhotoRouter } from "../server/photo-store.mjs";
import { createSpaceRouter } from "../server/space-router.mjs";
import { createPhotoMemoryRouter, groupPhotoEvents } from "../server/photo-memories.mjs";

const photo = (id, day, time, lat = null, lon = null) => ({ id, day, takenAt: `${day}T${time}:00Z`, lat, lon });

test("photos become one memory per day and place, with a few spread across it", () => {
  const events = groupPhotoEvents([
    ...Array.from({ length: 10 }, (_, index) => photo(`beach-${index}`, "2025-06-01", `1${index}:00`, 34.01, -118.49)),
    photo("far", "2025-06-01", "20:00", 34.95, -118.49), // ~100 km away the same day: another memory
    photo("nowhere", "2025-06-01", "21:00"), // no location: joins the day's biggest place
    photo("alone", "2025-06-03", "09:00"),
  ]);
  assert.equal(events.length, 3);
  const beach = events.find((event) => event.assets.includes("beach-0"));
  assert.equal(beach.count, 11, "the unlocated photo joined the beach");
  assert.equal(beach.assets.length, 4, "at most four photos per memory");
  assert.ok(beach.key.startsWith("2025-06-01|34.0,-118.5"));
  assert.equal(groupPhotoEvents([...events.flatMap(() => [])]).length, 0);
  assert.deepEqual(groupPhotoEvents([photo("alone", "2025-06-03", "09:00")])[0].key, "2025-06-03|-", "the same photos give the same key every run");
});

test("the phone gets the next memories to make; each is made once, in the shared album, and the partner is told once", async (t) => {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "photo-memories-"));
  process.env.TOWARD_US_DATA_FILE = join(directory, "store.json");
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const id of ids) await store.createUser({ id, email: `${id}@example.invalid`, name: "Synthetic person", passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  const mediator = { structured: async () => ({ title: "Santa Monica", text: "A slow day by the sea, you two." }) };
  const app = express(); app.use(express.json({ limit: "5mb" })); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"], name: "Ana" } }; next(); });
  const memories = createPhotoMemoryRouter({ store, mediator });
  const told = []; memories.emitTogether = (conversation) => told.push(conversation.messages.at(-1));
  app.use("/api", createPhotoRouter({ store })); app.use("/api", createSpaceRouter({ store })); app.use("/api", memories);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); delete process.env.TOWARD_US_DATA_FILE; await rm(directory, { recursive: true, force: true }); });
  const url = (path) => `http://127.0.0.1:${server.address().port}/api${path}`;
  const post = async (path, body, userId = ids[0]) => { const response = await fetch(url(path), { method: "POST", headers: { "x-user": userId, "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  const upload = async (scope) => (await (await fetch(url(`/photos?scope=${scope}`), { method: "POST", headers: { "x-user": ids[0], "content-type": "image/jpeg" }, body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) })).json()).photo.id;

  const assets = [photo("a", "2025-06-01", "10:00", 34.01, -118.49), photo("b", "2025-06-01", "11:00", 34.01, -118.49), photo("c", "2024-02-14", "19:00")];
  const plan = (await post("/photo-memories/plan", { assets })).body;
  assert.equal(plan.remaining, 2); assert.equal(plan.events[0].day, "2025-06-01", "newest first");
  const event = plan.events[0];
  assert.equal((await post("/photo-memories/events", { key: event.key, day: event.day, place: "Santa Monica", photoIds: [await upload("private")] })).status, 400, "a private photo cannot go to the shared album");
  const made = await post("/photo-memories/events", { key: event.key, day: event.day, place: "Santa Monica", photoIds: [await upload("shared"), await upload("shared")], count: 2, language: "en" });
  assert.equal(made.status, 201); assert.equal(made.body.title, "Santa Monica");
  assert.equal((await post("/photo-memories/events", { key: event.key, day: event.day, place: "Santa Monica", photoIds: [await upload("shared")] })).body.duplicate, true);
  const album = (await (await fetch(url("/spaces"), { headers: { "x-user": ids[1] } })).json()).spaces.find((space) => space.system === "moments" && space.visibility === "shared");
  assert.equal(album.items.length, 2, "the partner sees the memory, one item per photo");
  assert.equal(album.items[0].text, "A slow day by the sea, you two.");
  assert.equal((await post("/photo-memories/plan", { assets })).body.remaining, 1, "a made memory is not asked for again");
  const next = (await post("/photo-memories/plan", { assets })).body.events[0];
  await post("/photo-memories/events", { key: next.key, day: next.day, place: "", photoIds: [await upload("shared")], language: "en" });
  assert.equal(told.length, 1, "the partner is told about the album once");
  assert.match(told[0].text, /connected an iPhone album/);
});
