import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createTogetherRouter } from "../server/together-router.mjs";
import { grow, levelFor } from "../server/pet.mjs";

test("growth: each event counts once, daily caps hold, both petting the same day earns a bonus", () => {
  assert.deepEqual([0, 49, 50, 149, 150, 300].map(levelFor), [1, 1, 2, 2, 3, 4]);
  const day = "2026-11-06";
  const found = [
    ...Array.from({ length: 5 }, (_, index) => ({ key: `nudge:${index}`, type: "nudge", day })),
    { key: "daily:q1", type: "daily", day }, { key: `pet:${day}:a`, type: "pet", day }, { key: `pet:${day}:b`, type: "pet", day }, { key: `both:${day}`, type: "both", day },
  ];
  const first = grow(null, found, day);
  assert.equal(first.pet.points, 3 * 2 + 10 + 1 + 1 + 3, "only three 想你了 a day count");
  assert.equal(grow(first.pet, found, day).pet.points, first.pet.points, "nothing counts twice");
  const more = grow(first.pet, Array.from({ length: 7 }, (_, index) => ({ key: `letter:${index}`, type: "letter", day })), day);
  assert.equal(more.leveled, 3, "a new level is reported once");
  assert.equal(grow(more.pet, [{ key: "game:x", type: "game", day }], day).leveled, null);
});

test("一起养: petting in Us, what they do together feeds it, and a new level is announced once", async (t) => {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "pet-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const [index, id] of ids.entries()) await store.createUser({ id, email: `${id}@example.invalid`, name: ["Ziwei", "Mia"][index], passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createTogetherRouter({ store, mediator: {} }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, method = "GET", body, userId = ids[0]) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const open = async (userId = ids[0]) => (await request("/together?language=zh&timezone=UTC", "GET", null, userId)).body;

  let pet = (await open()).pet;
  assert.deepEqual([pet.level, pet.points, pet.pettedByMe], [1, 0, false]);
  pet = (await request("/together/pet", "POST", { timezone: "UTC" })).body.pet;
  assert.deepEqual([pet.points, pet.pettedByMe, pet.pettedByPartner], [1, true, false]);
  pet = (await request("/together/pet", "POST", { timezone: "UTC" })).body.pet;
  assert.equal(pet.points, 1, "once a day each");
  pet = (await request("/together/pet", "POST", { timezone: "UTC" }, ids[1])).body.pet;
  assert.deepEqual([pet.points, pet.pettedByMe, pet.pettedByPartner], [5, true, true], "both today: +1 +1 +3");

  // Ten game rounds both answered: +50 → Lv.2, announced in Us once, however often Us is opened.
  const conversationId = `together:${relationshipId}`;
  await store.transaction(`relationship:${relationshipId}`, (tx) => tx.updateRelationshipRecordForUser("togetherConversations", conversationId, ids[0], (draft) => {
    for (let index = 0; index < 10; index += 1) draft.messages.push({ id: randomUUID(), role: "agent", actorUserId: null, kind: "game", text: `round ${index}`, game: { type: "choice", options: ["a", "b"], aboutUserId: null }, answers: { [ids[0]]: { choice: 0, text: "a" }, [ids[1]]: { choice: 1, text: "b" } }, refs: [], createdAt: new Date().toISOString() });
  }));
  const after = await open(ids[1]);
  assert.deepEqual([after.pet.level, after.pet.points], [2, 55]);
  await open(); await open(ids[1]);
  const announcements = (await open()).conversation.messages.filter((message) => /Lv\.2/.test(message.text || ""));
  assert.equal(announcements.length, 1);
  assert.equal((await open()).pet.mood, "happy");
});
