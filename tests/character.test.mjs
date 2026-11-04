import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createCharacterRouter } from "../server/character.mjs";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([8, 0, 0, 0]), Buffer.from("WEBPVP8L")]);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function couple(store, ids) {
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  return relationshipId;
}

/** Two couples and one person on their own; the picture steps are a stand-in the test advances one at a time. */
async function fixture(t) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "character-"));
  process.env.TOWARD_US_DATA_FILE = join(directory, "store.json");
  const store = await createFileStore(join(directory, "store.json"));
  const [a, b, c, d, e] = Array.from({ length: 5 }, () => randomUUID());
  for (const id of [a, b, c, d, e]) await store.createUser({ id, email: `${id}@example.invalid`, name: "Synthetic person", passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = await couple(store, [a, b]);
  await couple(store, [c, d]);
  const plan = { available: true, cut: "ok", motion: true };
  const steps = [];
  const maker = {
    available: () => plan.available,
    cutOut: (_photo, folder) => new Promise((done) => steps.push(async () => { if (plan.cut === "ok") await writeFile(join(folder, "still.png"), PNG); done(plan.cut); })),
    animate: (_still, folder) => new Promise((done, failed) => steps.push(async () => { if (plan.motion) { await writeFile(join(folder, "motion.webp"), WEBP); done(); } else failed(new Error("no motion")); })),
  };
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  const events = [];
  app.use("/api", createCharacterRouter({ store, maker, emit: (record, eventType) => events.push({ eventType, relationshipId: record.relationshipId, state: record.making?.state }) }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); assert.ok(resolve(directory).startsWith(base)); await rm(directory, { recursive: true, force: true }); });
  const url = (path) => `http://127.0.0.1:${server.address().port}${path}`;
  const headers = (userId) => userId ? { "x-user": userId } : {};
  const upload = async (userId, body = PNG, type = "image/png") => { const response = await fetch(url("/api/character"), { method: "POST", headers: { ...headers(userId), "content-type": type }, body }); return { status: response.status, body: await response.json() }; };
  const character = async (userId) => (await (await fetch(url("/api/character"), { headers: headers(userId) })).json()).character;
  const file = async (path, userId) => { const response = await fetch(url(path), { headers: headers(userId) }); return { status: response.status, type: response.headers.get("content-type") }; };
  const display = async (userId, visible) => (await (await fetch(url("/api/character/display"), { method: "POST", headers: { ...headers(userId), "content-type": "application/json" }, body: JSON.stringify({ visible }) })).json()).character;
  /** Runs the next picture step, then waits until the member sees the making move on. */
  const advance = async (userId, settled) => {
    for (let i = 0; !steps.length && i < 200; i += 1) await sleep(5);
    await steps.shift()();
    for (let i = 0; i < 200; i += 1) { const seen = await character(userId); if (settled(seen)) return seen; await sleep(10); }
    throw new Error("The making did not move on.");
  };
  return { store, plan, relationshipId, ids: { a, b, c, d, e }, directory, upload, character, file, display, advance, events };
}

test("the couple's character is made in the background and shown only to its two members", async (t) => {
  const { store, relationshipId, ids: { a, b, c, e }, directory, upload, character, file, advance } = await fixture(t);
  const started = await upload(a);
  assert.equal(started.status, 202);
  assert.deepEqual(started.body.character, { image: null, making: { state: "cutting", error: null }, uploadedByMe: true, visible: true });
  assert.deepEqual(await character(b), { image: null, making: { state: "cutting", error: null }, uploadedByMe: false, visible: true }, "the partner sees the same making");
  assert.equal((await upload(b)).status, 409, "one making at a time per couple");

  const still = await advance(a, (seen) => seen.making?.state === "moving");
  assert.match(still.image.still, /^\/api\/character\/files\/[0-9a-f-]{36}\/still\.png$/);
  assert.equal(still.image.motion, null, "the still shows while the motion is made");
  assert.deepEqual(await file(still.image.still, b), { status: 200, type: "image/png" });
  assert.equal((await file(still.image.still, c)).status, 404, "another couple cannot read it");
  assert.equal((await file(still.image.still, e)).status, 404, "someone without a partner cannot read it");
  assert.equal((await file(still.image.still)).status, 401);
  assert.equal(await character(c), null);

  const ready = await advance(b, (seen) => seen.making === null);
  assert.match(ready.image.motion, /motion\.webp$/);
  assert.deepEqual(await file(ready.image.motion, a), { status: 200, type: "image/webp" });
  assert.equal((await file(ready.image.motion, c)).status, 404);

  const record = await store.getRelationshipRecordForUser("characters", `character:${relationshipId}`, b);
  assert.equal(record.visibility, "shared");
  assert.equal(record.uploadedByUserId, a);
  assert.equal(record.ownerUserId, a);
  assert.equal(record.provenance.source, "member_upload");
  const fileId = ready.image.still.split("/")[4];
  assert.deepEqual((await readdir(join(`${join(directory, "store.json")}.media`, "characters", fileId))).sort(), ["motion.webp", "still.png"], "the original photo is not kept");
});

test("files that are not pictures, members without a partner and a server that cannot make pictures are refused", async (t) => {
  const { plan, ids: { a, e }, upload, character } = await fixture(t);
  assert.deepEqual(await upload(a, Buffer.from("hello there, not a picture"), "text/plain"), { status: 400, body: { error: "unreadable" } });
  assert.deepEqual(await upload(a, Buffer.from("not really a png at all"), "image/png"), { status: 400, body: { error: "unreadable" } });
  assert.deepEqual(await upload(a, PNG, "image/jpeg"), { status: 400, body: { error: "unreadable" } }, "the bytes must match the type");
  assert.deepEqual(await upload(e), { status: 409, body: { error: "pair_first" } });
  assert.equal((await upload(undefined)).status, 401);
  plan.available = false;
  assert.deepEqual(await upload(a), { status: 503, body: { error: "unavailable" } });
  assert.equal(await character(a), null, "nothing was recorded");
});

test("a failed motion keeps the still, and a photo cut off at its edge keeps the character already there", async (t) => {
  const { plan, ids: { a, b }, upload, file, advance } = await fixture(t);
  plan.motion = false;
  await upload(a);
  await advance(a, (seen) => seen.making?.state === "moving");
  const stillOnly = await advance(a, (seen) => seen.making?.state === "failed");
  assert.equal(stillOnly.making.error, "motion_failed");
  assert.equal(stillOnly.image.motion, null);
  assert.equal((await file(stillOnly.image.still, b)).status, 200);

  plan.cut = "cut_off";
  assert.equal((await upload(b)).status, 202, "a new photo may follow a finished making");
  const cutOff = await advance(b, (seen) => seen.making?.state === "failed");
  assert.deepEqual(cutOff.making, { state: "failed", error: "cut_off" });
  assert.equal(cutOff.image.still, stillOnly.image.still, "the earlier character stays");
  assert.equal((await file(cutOff.image.still, a)).status, 200);

  plan.cut = "no_subject";
  await upload(a);
  assert.deepEqual((await advance(a, (seen) => seen.making?.state === "failed")).making, { state: "failed", error: "no_subject" });
});

test("hiding the character is each member's own choice", async (t) => {
  const { ids: { a, b, e }, upload, character, display } = await fixture(t);
  await upload(a);
  assert.equal((await display(a, false)).visible, false);
  assert.equal((await character(a)).visible, false);
  assert.equal((await character(b)).visible, true, "the partner still sees it");
  assert.equal((await display(a, true)).visible, true);
  assert.equal(await display(e, false), undefined, "someone without a partner has no character to hide");
});

test("each step of the making tells the couple's open Apps, so the partner sees the character without reloading", async (t) => {
  const { relationshipId, ids: { a }, upload, advance, events } = await fixture(t);
  await upload(a);
  assert.deepEqual(events, [{ eventType: "character.updated", relationshipId, state: "cutting" }]);
  await advance(a, (seen) => seen.making?.state === "moving");
  await advance(a, (seen) => seen.making === null);
  assert.deepEqual(events.map((event) => event.state), ["cutting", "moving", "done"]);
  assert.ok(events.every((event) => event.eventType === "character.updated" && event.relationshipId === relationshipId), "only this couple is told");
});
