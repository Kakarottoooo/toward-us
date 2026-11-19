import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createPeopleRouter, personFor } from "../server/people.mjs";
import { togetherWith } from "../server/people-stages.mjs";

// Founder 11-09: "A 吧，一个 Pinky，三个阶段" — getting to know several people, settling on one, being together. The stage
// follows facts; the member only confirms the moment that matters, and nothing about the others is ever deleted.
async function setup(t) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "stages-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const store = await createFileStore(join(directory, "store.json"));
  const users = [{ id: randomUUID(), name: "Alex" }, { id: randomUUID(), name: "阿杰" }];
  for (const user of users) await store.createUser({ ...user, email: `${user.id}@example.invalid`, passwordHash: "test", createdAt: new Date().toISOString() });
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { const user = users.find((item) => item.id === req.headers["x-user"]); if (user) req.auth = { user }; next(); });
  app.use("/api", createPeopleRouter({ store }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const call = async (path, body) => (await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: body ? "POST" : "GET", headers: { "x-user": users[0].id, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })).json();
  const add = (name) => store.transaction(`user:${users[0].id}`, (tx) => personFor(tx, users[0].id, name));
  const pair = async () => {
    const relationshipId = randomUUID();
    await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: users[0].id, role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: users[0].id, expiresAt: "2099-01-01T00:00:00.000Z" } });
    await store.acceptInvitation(relationshipId, users[1].id, new Date().toISOString());
  };
  return { store, users, call, add, pair };
}

test("saying they are together with one named person is asked about once, never when unclear or already a couple", async (t) => {
  const { store, users, add, pair } = await setup(t);
  const jie = await add("阿杰（可删）"); await add("Lily");
  assert.equal(await togetherWith(store, users[0].id, "今天天气不错"), null);
  assert.equal(await togetherWith(store, users[0].id, "我们在一起了"), null, "no name: Pinky does not guess who");
  assert.equal(await togetherWith(store, users[0].id, "阿杰和 Lily 都说想在一起了"), null, "two names: not this moment");
  assert.equal((await togetherWith(store, users[0].id, "我和阿杰在一起了！"))?.id, jie.id);
  await store.transaction(`user:${users[0].id}`, async (tx) => (await import("../server/people-stages.mjs")).markAsked(tx, users[0].id, jie.id));
  assert.equal(await togetherWith(store, users[0].id, "我和阿杰确定关系了"), null, "asked once; not again for a while");
  await pair();
  assert.equal(await togetherWith(store, users[0].id, "我和 Lily 在一起了"), null, "a couple is past this moment");
});

test("choosing someone puts the others away, pairing makes it a couple, and leaving brings the others back", async (t) => {
  const { store, users, call, add, pair } = await setup(t);
  const jie = await add("阿杰"), lily = await add("Lily"), rain = await add("小雨");
  await store.transaction(`user:${users[0].id}`, (tx) => tx.updateRelationshipRecordForUser("memories", rain.id, users[0].id, (draft) => { draft.archivedAt = new Date().toISOString(); draft.version += 1; }));
  assert.equal((await call("/people")).stage, "dating");

  const chosen = await call(`/people/${jie.id}/choose`, { chosen: true });
  assert.equal(chosen.stage, "chosen"); assert.equal(chosen.chosen.id, jie.id);
  const listed = await call("/people");
  assert.deepEqual(listed.people.map((person) => person.name), ["阿杰"], "the others are put away");
  assert.equal(listed.stage, "chosen");
  const archived = await call("/people?archived=1");
  assert.deepEqual(archived.people.map((person) => person.name).sort(), ["Lily", "小雨", "阿杰"].sort(), "nothing is deleted");

  await pair();
  assert.equal((await call("/people")).stage, "together");
  await store.leaveRelationship(users[0].id);
  const back = await call("/people");
  assert.equal(back.stage, "dating");
  assert.deepEqual(back.people.map((person) => person.name).sort(), ["Lily", "阿杰"].sort(), "Lily comes back; 小雨 was put away before and stays so");
  assert.ok(!back.people.some((person) => person.id === lily.id && person.archived));
});

test("还没有 only stops the asking, and changing one's mind brings everyone back", async (t) => {
  const { store, users, call, add } = await setup(t);
  const jie = await add("阿杰"); await add("Lily");
  const notYet = await call(`/people/${jie.id}/choose`, { chosen: false });
  assert.equal(notYet.stage, "dating");
  assert.equal((await call("/people")).people.length, 2);
  assert.equal(await togetherWith(store, users[0].id, "我和阿杰在一起了"), null);
  await call(`/people/${jie.id}/choose`, { chosen: true });
  assert.equal((await call("/people")).people.length, 1);
  assert.equal((await call("/people/unchoose", {})).stage, "dating");
  assert.equal((await call("/people")).people.length, 2);
});

test("telling Pinky they are together with one person gets Pinky's one question in the chat, once", async (t) => {
  const { createAssistantRouter } = await import("../server/assistant-router.mjs");
  const { createReminderService } = await import("../server/reminder-service.mjs");
  const { store, users, add } = await setup(t);
  const jie = await add("阿杰"); await add("Lily");
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.auth = { user: { id: users[0].id } }; next(); });
  app.use("/api", createAssistantRouter({ store, mediator: { planAssistantTurn: async () => ({ reply: "恭喜你们！", actions: [] }) }, reminderService: createReminderService({ store }) }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const post = async (path, body) => (await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const session = (await post("/assistant/sessions", { language: "zh", timezone: "UTC" })).session;
  const first = (await post(`/assistant/sessions/${session.id}/messages`, { text: "我和阿杰在一起了！", itemId: randomUUID() })).session.messages;
  assert.equal(first.at(-2).text, "恭喜你们！", "Pinky's own reply comes first");
  assert.deepEqual([first.at(-1).kind, first.at(-1).personId, first.at(-1).text], ["together_ask", jie.id, "听起来你和阿杰确定了？"]);
  const again = (await post(`/assistant/sessions/${session.id}/messages`, { text: "我和阿杰在一起了", itemId: randomUUID() })).session.messages;
  assert.equal(again.filter((message) => message.kind === "together_ask").length, 1, "asked once");
});
