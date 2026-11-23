import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createPlayDistanceRouter } from "../server/play-distance-router.mjs";

test("碰一碰: a touch tells the partner, lasts a minute, and a touch back meets", async (t) => {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "touch-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const [index, id] of ids.entries()) await store.createUser({ id, email: `${id}@example.invalid`, name: ["百福", "Mia"][index], passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  const pushes = [], events = [];
  let onlineNow = new Set();
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createPlayDistanceRouter({ store, emit: (_c, type) => events.push(type), notify: async (userId, message) => { pushes.push({ userId, message }); }, online: (userId) => onlineNow.has(userId) }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, method = "GET", body, userId = ids[0]) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const settle = () => new Promise((r) => setTimeout(r, 20));

  // Mia is away: 百福's touch reaches her by push, with her name and a link that opens the touch panel.
  const first = await request("/play-distance/touch", "POST", { action: "join", id: randomUUID(), language: "zh" });
  assert.equal(first.status, 200);
  assert.equal(first.body.partnerOnline, false);
  const window = first.body.touch.expiresAt - first.body.now;
  assert.ok(window > 55_000 && window <= 60_000, "a touch waits about a minute");
  await settle();
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].userId, ids[1]);
  assert.match(pushes[0].message.body.zh, /^百福碰了你一下/);
  assert.equal(pushes[0].message.url, "/?channel=us&distance=touch");
  assert.ok(events.includes("play-distance.updated"), "an open app hears it live");

  // Mia opens the app and touches back: they meet, and 百福 (away now) hears it by push.
  const seen = await request("/play-distance", "GET", null, ids[1]);
  assert.equal(seen.body.touch.matched, false);
  assert.equal(seen.body.touch.userId, ids[0]);
  const back = await request("/play-distance/touch", "POST", { action: "join", id: randomUUID(), language: "en" }, ids[1]);
  assert.equal(back.body.touch.matched, true);
  await settle();
  assert.equal(pushes.length, 2);
  assert.equal(pushes[1].userId, ids[0]);
  assert.match(pushes[1].message.body.en, /^Mia touched back/);

  // When the partner is in the app, the live event is enough: no push, and the panel says they are online.
  onlineNow = new Set([ids[1]]);
  const later = await request("/play-distance/touch", "POST", { action: "join", id: randomUUID(), language: "zh" });
  assert.equal(later.body.partnerOnline, true);
  await settle();
  assert.equal(pushes.length, 2);
});
