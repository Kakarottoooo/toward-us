import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createTogetherRouter } from "../server/together-router.mjs";

test("想你了: one tap posts a nudge both see, a second tap within 30 seconds is the same one, and it needs a partner", async (t) => {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "nudge-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  for (const id of ids) await store.createUser({ id, email: `${id}@example.invalid`, name: "Synthetic person", passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  const emitted = [];
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createTogetherRouter({ store, mediator: {}, emit: (record, type) => emitted.push(type) }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true }); });
  const nudge = async (userId) => { const response = await fetch(`http://127.0.0.1:${server.address().port}/api/together/nudge`, { method: "POST", headers: { "x-user": userId, "content-type": "application/json" }, body: "{}" }); return { status: response.status, body: await response.json() }; };

  const first = await nudge(ids[0]);
  assert.equal(first.status, 201);
  assert.equal(first.body.message.kind, "nudge");
  assert.equal(first.body.message.actorUserId, ids[0]);
  assert.deepEqual(emitted, ["together.updated"], "the partner's phone is told (and pushed, by the usual Us path)");
  const again = await nudge(ids[0]);
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.message.id, first.body.message.id);
  assert.equal((await nudge(ids[1])).status, 201, "the partner can send one back");
  assert.equal((await nudge(ids[2])).status, 409, "someone without a partner cannot");
});
