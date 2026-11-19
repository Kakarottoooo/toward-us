import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createAssistantRouter } from "../server/assistant-router.mjs";
import { createReminderService } from "../server/reminder-service.mjs";
import { personFor, personSubject } from "../server/people.mjs";
import { profileContext, scanPrivateProfile } from "../server/profile.mjs";

// Founder 11-09: "点击一个人，然后自动是一个会话，然后这一个会话全部都是只问和分析这个人相关的，然后还有一个主会话，就算大脑".
async function setup(t) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "threads-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const store = await createFileStore(join(directory, "store.json"));
  const id = randomUUID();
  await store.createUser({ id, email: `${id}@example.invalid`, name: "Alex", passwordHash: "test", createdAt: new Date().toISOString() });
  const plans = [];
  const mediator = { planAssistantTurn: async (context) => { plans.push(context); return { reply: "好的。", actions: [] }; } };
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.auth = { user: { id } }; next(); });
  app.use("/api", createAssistantRouter({ store, mediator, reminderService: createReminderService({ store }) }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const call = async (path, body) => { const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; };
  const add = (name) => store.transaction(`user:${id}`, (tx) => personFor(tx, id, name));
  return { store, id, plans, call, add };
}

test("each person has one conversation of their own, and the brain is never one of them", async (t) => {
  const { call, add, plans } = await setup(t);
  const jie = await add("阿杰"), lily = await add("Lily");
  const main = (await call("/assistant/sessions", { language: "zh", timezone: "UTC" })).body.session;
  const first = await call("/assistant/sessions", { language: "zh", timezone: "UTC", personId: jie.id });
  assert.equal(first.status, 201); assert.equal(first.body.session.personId, jie.id);
  const again = await call("/assistant/sessions", { language: "zh", timezone: "UTC", personId: jie.id });
  assert.equal(again.status, 200); assert.equal(again.body.session.id, first.body.session.id, "reopened, never made twice");
  assert.equal((await call("/assistant/sessions", { language: "zh", timezone: "UTC", personId: "nobody" })).status, 404);

  await call(`/assistant/sessions/${first.body.session.id}/messages`, { text: "他今天约我爬山", itemId: randomUUID() });
  assert.equal((await call("/assistant/sessions/latest")).body.session.id, main.id, "the brain stays the member's main conversation");

  // Inside 阿杰's conversation Pinky sees only 阿杰; in the brain it sees everyone.
  const focused = plans.at(-1);
  assert.deepEqual(focused.focus, { personId: jie.id, name: "阿杰" });
  assert.deepEqual((focused.profile.people || []).map((person) => person.name), ["阿杰"]);
  await call(`/assistant/sessions/${main.id}/messages`, { text: "她们俩谁更适合我？", itemId: randomUUID() });
  assert.equal(plans.at(-1).focus, undefined);
  assert.deepEqual((plans.at(-1).profile.people || []).map((person) => person.name).sort(), ["Lily", "阿杰"].sort());
  assert.ok(lily);
});

test("what the member says in a person's conversation is kept on that person even when it names nobody", async (t) => {
  const { store, id, call, add } = await setup(t);
  const jie = await add("阿杰"); await add("Lily");
  const thread = (await call("/assistant/sessions", { language: "zh", timezone: "UTC", personId: jie.id })).body.session;
  await store.updateRelationshipRecordForUser("privateAgentThreads", thread.id, id, (draft) => { draft.messages = [{ id: "u1", role: "user", text: "他不吃香菜，最怕别人迟到", createdAt: new Date().toISOString() }]; draft.version += 1; });
  const mediator = { structured: async ({ instructions }) => { assert.match(instructions, /阿杰/); return { facts: [
    { messageId: "u1", quote: "他不吃香菜", subject: "B", person: "", category: "food", fact: "不吃香菜", replaces: "" },
    { messageId: "u1", quote: "最怕别人迟到", subject: "B", person: "", category: "dislikes", fact: "最怕别人迟到", replaces: "" }] }; } };
  await scanPrivateProfile({ store, mediator, userId: id, sessionId: thread.id });
  const known = await profileContext(store, id);
  assert.deepEqual(known.people.find((person) => person.id === jie.id).facts.map((item) => item.fact).sort(), ["不吃香菜", "最怕别人迟到"].sort());
  assert.deepEqual(known.partner, [], "never the partner's");
  const kept = (await store.listRelationshipRecordsForUser("memories", id)).filter((record) => record.subjectUserId === personSubject(jie.id));
  assert.equal(kept.length, 2);
});
