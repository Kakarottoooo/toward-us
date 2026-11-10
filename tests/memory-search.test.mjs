import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { createAssistantRouter } from "../server/assistant-router.mjs";
import { createReminderService } from "../server/reminder-service.mjs";
import { personFor, personSubject } from "../server/people.mjs";
import { searchMemory, terms } from "../server/memory-search.mjs";

// 按需检索 (memory plan, founder 11-09: "做按需检索"): a specific old detail is found in the member's own past
// conversations (older pages too) and notes, with the day it was said; never in anyone else's.
async function setup(t) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "search-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const store = await createFileStore(join(directory, "store.json"));
  const users = [{ id: randomUUID(), name: "Alex" }, { id: randomUUID(), name: "Blair" }];
  for (const user of users) await store.createUser({ ...user, email: `${user.id}@example.invalid`, passwordHash: "test", createdAt: new Date().toISOString() });
  const thread = async (userId, { personId = null, messages = [], earlier = [] } = {}) => {
    const record = createRelationshipRecord({ relationshipId: null, userId, visibility: "private", aiAccessScope: "private", intentType: "assistant", language: "zh", timezone: "UTC", messages, earlier, ...(personId ? { personId } : {}) });
    await store.createRelationshipRecord("privateAgentThreads", record);
    return record;
  };
  const said = (text, at, role = "user") => ({ id: randomUUID(), role, text, createdAt: at });
  return { store, users, thread, said };
}

test("query words: Latin words whole, Chinese as pairs of characters", () => {
  assert.deepEqual(terms("Lin 道歉"), ["lin", "道歉"]);
  assert.deepEqual(terms("提前订餐厅"), ["提前", "前订", "订餐", "餐厅"]);
});

test("an old detail is found in older pages and notes, with its day, scoped to a person's own conversation when asked there", async (t) => {
  const { store, users, thread, said } = await setup(t);
  const jie = await store.transaction(`user:${users[0].id}`, (tx) => personFor(tx, users[0].id, "阿杰"));
  await thread(users[0].id, { earlier: [{ messages: [said("阿明道歉说以后每年都提前一周订好餐厅", "2025-03-12T10:00:00.000Z"), said("今天天气不错", "2025-03-13T10:00:00.000Z")] }], messages: [said("最近好忙", "2026-11-01T10:00:00.000Z")] });
  await thread(users[0].id, { personId: jie.id, messages: [said("阿杰说他小时候在大连长大", "2025-06-01T10:00:00.000Z")] });
  await store.createRelationshipRecord("memories", createRelationshipRecord({ relationshipId: null, userId: users[0].id, ownerUserId: users[0].id, visibility: "private", aiAccessScope: "private", status: "active", kind: "profile", subjectUserId: personSubject(jie.id), category: "dislikes", text: "最怕狗", evidence: { saidAt: "2025-06-02T10:00:00.000Z" } }));
  await thread(users[1].id, { messages: [said("我也想提前一周订餐厅", "2025-03-12T11:00:00.000Z")] });

  const found = await searchMemory({ store, userId: users[0].id, query: "提前一周订餐厅" });
  assert.match(found, /^\[2025-03-12 · 和 Pinky 的对话 · 你说\] 阿明道歉说以后每年都提前一周订好餐厅/);
  assert.doesNotMatch(found, /我也想/, "another member's conversation is never searched");
  assert.match(await searchMemory({ store, userId: users[0].id, query: "怕狗" }), /\[2025-06-02 · 记忆卡 · 关于阿杰\] 最怕狗/);
  assert.match(await searchMemory({ store, userId: users[0].id, date: "2025-03-13" }), /今天天气不错/);
  assert.doesNotMatch(await searchMemory({ store, userId: users[0].id, date: "2025-03-13" }), /订好餐厅/);
  // Inside 阿杰's own conversation only 阿杰 is searched.
  assert.match(await searchMemory({ store, userId: users[0].id, query: "大连", personId: jie.id }), /只聊阿杰/);
  assert.match(await searchMemory({ store, userId: users[0].id, query: "订餐厅", personId: jie.id }), /No matching record/);
});

test("Pinky searches when it needs an old detail and answers with what it found", async (t) => {
  const { store, users, thread, said } = await setup(t);
  await thread(users[0].id, { earlier: [{ messages: [said("阿明道歉说以后每年都提前一周订好餐厅", "2025-03-12T10:00:00.000Z")] }] });
  const contexts = [];
  const mediator = { planAssistantTurn: async (context) => { contexts.push(context); return contexts.length === 1
    ? { reply: "我找找。", actions: [{ kind: "memory_search", operation: "query", targetId: null, expectedVersion: null, query: "道歉 订餐厅", queryPeriod: "all", occurrence: null, fields: { title: null, text: null, localDateTime: null, timezone: null, frequency: null, date: null, mood: null, layout: null, spaceId: null, done: null, photoId: null, handoff: null } }] }
    : { reply: "2025 年 3 月 12 日你说过：他道歉说以后每年都提前一周订好餐厅。", actions: [] }; } };
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.auth = { user: { id: users[0].id } }; next(); });
  app.use("/api", createAssistantRouter({ store, mediator, reminderService: createReminderService({ store }) }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const post = async (path, body) => (await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const session = (await post("/assistant/sessions", { language: "zh", timezone: "UTC" })).session;
  const reply = (await post(`/assistant/sessions/${session.id}/messages`, { text: "阿明当时道歉具体说了什么？", itemId: randomUUID() })).session.messages.at(-1);
  assert.equal(contexts.length, 2);
  assert.match(contexts[1].lookups[0].findings, /2025-03-12.*提前一周订好餐厅/);
  assert.match(reply.text, /2025 年 3 月 12 日/);
});

test("a day asked for finds everything said that day, whatever words come with it", async (t) => {
  const { store, users, thread, said } = await setup(t);
  await thread(users[0].id, { earlier: [{ messages: [said("今天去面试了一家新公司", "2026-06-13T05:00:00.000Z"), said("今天天气不错", "2026-06-14T05:00:00.000Z")] }] });
  const found = await searchMemory({ store, userId: users[0].id, query: "那天 聊了什么", date: "2026-06-13" });
  assert.match(found, /面试了一家新公司/);
  assert.doesNotMatch(found, /天气不错/);
});
