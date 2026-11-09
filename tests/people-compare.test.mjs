import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { createPeopleRouter, personFor, personSubject } from "../server/people.mjs";
import { chatNumbers, createPeopleComparer } from "../server/people-compare.mjs";

// Founder 11-09: "我要的是一整个功能界面……真实的情况是很复杂的" (chose B+C). 我的 TA 们 is read by Pinky by itself.
async function setup(t, mediator) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "board-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const store = await createFileStore(join(directory, "store.json"));
  const users = [{ id: randomUUID(), name: "Alex" }, { id: randomUUID(), name: "Blair" }];
  for (const user of users) await store.createUser({ ...user, email: `${user.id}@example.invalid`, passwordHash: "test", createdAt: new Date().toISOString() });
  const comparer = createPeopleComparer({ store, mediator });
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { const user = users.find((item) => item.id === req.headers["x-user"]); if (user) req.auth = { user }; next(); });
  app.use("/api", createPeopleRouter({ store, comparer }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const call = async (path, { method = "GET", body, userId = users[0].id } = {}) => (await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })).json();
  const add = (name) => store.transaction(`user:${users[0].id}`, (tx) => personFor(tx, users[0].id, name));
  const note = (person, text, category = "likes") => store.createRelationshipRecord("memories", createRelationshipRecord({ relationshipId: null, userId: users[0].id, ownerUserId: users[0].id, visibility: "private", aiAccessScope: "private", status: "active", kind: "profile", subjectUserId: personSubject(person.id), category, text }));
  return { store, users, comparer, call, add, note };
}

const level = (value) => ({ level: value, label: value === "high" ? "很主动" : "未知" });
const reading = (people, { stages = {}, wants = false } = {}) => ({
  overview: "阿杰 主动、坦诚；Lily 才见两次。", leaning: people[1].id, decision: "按你想要的，阿杰最符合。", ask: wants ? "" : "你想要认真的关系吗？",
  todos: [{ id: people[1].id, when: "13 天内", text: "给阿杰一个答案" }, { id: "someone-else", when: "今天", text: "x" }],
  suggestedWants: wants ? [] : [{ kind: "must", text: "认真想长期" }],
  people: people.map((person) => ({ id: person.id, stage: stages[person.name] || "warming", summary: `${person.name} 现在`, view: `${person.name} 的看法`, going: "顺利", watch: "", next: "约下一次", feeling: "", traits: [{ text: "说话直接", tone: "good" }], unknowns: ["想在哪座城市生活？"],
    signals: { initiative: level("high"), reliability: level("unknown"), honesty: level("high"), fit: level("unknown"), feeling: level("unknown") },
    fit: [{ want: "认真想长期", verdict: "yes", evidence: "我们现在算什么" }] })),
});

test("我的 TA 们 is read by itself, keeps where each person stands, and shows who moved and who is new trouble", async (t) => {
  const inputs = [];
  let people = [], stages = {};
  const mediator = { structured: async (args) => { inputs.push(JSON.parse(args.input)); return reading(people, { stages, wants: JSON.parse(args.input).wants.length > 0 }); } };
  const { comparer, users, call, add, note } = await setup(t, mediator);
  const lily = await add("Lily");
  assert.equal((await call("/people/board")).status, "few", "one person is nothing to compare");
  const jie = await add("阿杰");
  people = [lily, jie];
  await note(lily, "不太能吃辣");
  await note(jie, "2026-11-09 问我们现在算什么", "history");
  await note(lily, "2026-11-08 一起吃了汽锅鸡", "history");

  await call("/people"); // listing them starts the reading; nobody picks anyone
  await comparer.settle(users[0].id);
  const board = await call("/people/board?language=zh");
  assert.equal(board.status, "ready"); assert.equal(board.stale, false);
  assert.equal(board.reading.leaning, jie.id);
  assert.deepEqual(board.reading.todos.map((todo) => todo.text), ["给阿杰一个答案"], "a to-do about nobody here is dropped");
  assert.deepEqual(board.reading.people.find((row) => row.id === jie.id).fit, [], "nothing is held against wants they never set");
  assert.equal(board.reading.ask, "你想要认真的关系吗？");
  assert.deepEqual(board.reading.suggestedWants.map((want) => want.text), ["认真想长期"]);
  assert.deepEqual(board.feed.map((line) => [line.name, line.text]), [["阿杰", "2026-11-09 问我们现在算什么"], ["Lily", "2026-11-08 一起吃了汽锅鸡"]]);
  assert.deepEqual(board.people.map((person) => person.stage).sort(), ["warming", "warming"]);
  assert.deepEqual(inputs[0].people.find((person) => person.name === "Lily").facts, ["不太能吃辣"], "each person carries only their own notes");
  await call("/people/board?language=zh");
  assert.equal(inputs.length, 1, "unchanged notes reuse the reading");

  // Lily turns risky: the stage change is kept and the menu shows a dot until the page is opened.
  stages = { Lily: "risk" };
  await note(lily, "2026-11-10 找你借两千", "history");
  assert.equal((await call("/people/board?language=zh")).stale, true, "the last reading shows while a new one is made");
  await comparer.settle(users[0].id);
  const moved = (await call("/people")).people.find((person) => person.id === lily.id);
  assert.deepEqual([moved.previousStage, moved.stage], ["warming", "risk"]);
  assert.equal((await call("/people")).alerts, 1);
  await call("/people/board?language=zh&seen=1");
  assert.equal((await call("/people")).alerts, 0, "opening the page clears the dot");

  // What they want: saved as set, read against, and never shown to anyone else.
  const saved = await call("/people/wants", { method: "PUT", body: { wants: [{ kind: "must", text: "认真想长期" }, { kind: "weird", text: "同城" }, { kind: "never", text: "" }] } });
  assert.deepEqual(saved.wants.map((want) => [want.kind, want.text]), [["must", "认真想长期"], ["nice", "同城"]]);
  await comparer.settle(users[0].id);
  assert.deepEqual(inputs.at(-1).wants, [{ kind: "must", text: "认真想长期" }, { kind: "nice", text: "同城" }]);
  const held = await call("/people/board?language=zh");
  assert.deepEqual(held.reading.people.find((row) => row.id === jie.id).fit.map((item) => item.verdict), ["yes"]);
  assert.equal(held.reading.ask, "");

  const card = await call(`/people/${jie.id}?language=zh`);
  assert.equal(card.read.view, "阿杰 的看法", "a person's page carries Pinky's read of them");
  const other = await call("/people/board", { userId: users[1].id });
  assert.equal(other.status, "few"); assert.deepEqual(other.wants, []); assert.deepEqual(other.feed, [], "another member sees none of it");
});

test("a reading naming unknown people or missing its overview is not shown, and a failure is not retried at once", async (t) => {
  let calls = 0, people = [];
  const mediator = { structured: async () => { calls += 1; return { ...reading([...people, { id: "someone-else", name: "X" }]), overview: "" }; } };
  const { comparer, users, call, add } = await setup(t, mediator);
  people = [await add("Lily"), await add("阿杰")];
  await call("/people/board");
  await comparer.settle(users[0].id);
  assert.equal((await call("/people/board")).status, "failed");
  await comparer.settle(users[0].id);
  assert.equal(calls, 1);
});

test("chat numbers come only from imports with times, and say who starts and how fast each replies", () => {
  assert.equal(chatNumbers([{ stats: { perPerson: { me: { messages: 5, initiations: 0 }, partner: { messages: 4, initiations: 0 } } } }]), null, "screenshots without times give no numbers");
  const numbers = chatNumbers([
    { stats: { perPerson: { me: { messages: 40, initiations: 3, replyMinutesMedian: 25 }, partner: { messages: 60, initiations: 5, replyMinutesMedian: 4 } }, monthly: [{ month: "2026-10", me: 20, partner: 30 }, { month: "2026-11", me: 20, partner: 30 }], silences: [{ days: 3 }] } },
    { stats: { perPerson: { me: { messages: 2, initiations: 1 }, partner: { messages: 1, initiations: 0 } }, monthly: [{ month: "2026-11", me: 2, partner: 1 }], silences: [] } },
  ]);
  assert.deepEqual(numbers.starts, { me: 4, them: 5 });
  assert.deepEqual(numbers.replyMinutes, { me: 25, them: 4 });
  assert.deepEqual(numbers.monthly, [{ month: "2026-10", me: 20, them: 30 }, { month: "2026-11", me: 22, them: 31 }]);
  assert.equal(numbers.longestSilence, 3);
});
