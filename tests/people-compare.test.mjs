import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { createPeopleRouter, personFor, personSubject } from "../server/people.mjs";
import { chatNumbers, createPeopleComparer } from "../server/people-compare.mjs";

// Founder 11-09 (third mockup): 在了解的人 shows who is chasing whom, the member's own patterns, and for each person a mirror
// of the two of them. Pinky reads it by itself; the numbers are counted from the chats, never estimated.
async function setup(t, mediator) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "reading-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const media = join(directory, "media"); await mkdir(media, { recursive: true });
  const before = process.env.TOWARD_US_MEDIA_DIR; process.env.TOWARD_US_MEDIA_DIR = media;
  t.after(() => { if (before === undefined) delete process.env.TOWARD_US_MEDIA_DIR; else process.env.TOWARD_US_MEDIA_DIR = before; });
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
  const call = async (path, { userId = users[0].id } = {}) => (await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { headers: { "x-user": userId } })).json();
  const add = (name) => store.transaction(`user:${users[0].id}`, (tx) => personFor(tx, users[0].id, name));
  const note = (person, text, category = "likes", quote = null) => store.createRelationshipRecord("memories", createRelationshipRecord({ relationshipId: null, userId: users[0].id, ownerUserId: users[0].id, visibility: "private", aiAccessScope: "private", status: "active", kind: "profile", subjectUserId: personSubject(person.id), category, text, evidence: quote ? { quote } : null }));
  // A chat with someone, as an import keeps it: the messages on disk, who is who on the record.
  const chat = async (person, lines, stats = null) => {
    const fileId = randomUUID();
    await writeFile(join(media, `${fileId}.chat.json`), JSON.stringify({ conversation: { messages: lines.map(([sender, text, at = null]) => ({ sender, text, at })) } }));
    await store.createRelationshipRecord("chatImports", createRelationshipRecord({ relationshipId: null, userId: users[0].id, ownerUserId: users[0].id, visibility: "private", aiAccessScope: "private", status: "ready", fileId, personId: person.id, people: [{ name: "Alex", role: "me" }, { name: person.name, role: "partner" }], stats }));
  };
  return { users, comparer, call, add, note, chat, store };
}

const reading = (people, chase = {}) => ({
  insights: [{ headline: "你和主动的人在一起最放松。", evidence: "阿杰先开口更多" }, { headline: "", evidence: "dropped" }],
  people: [...people.map((person) => ({ id: person.id, kind: person.name === "Lily" && chase.Lily === "you_much" ? "you_chase" : "mutual", chase: chase[person.name] || "even", depth: "deep", shares: "even",
    view: `${person.name} 的看法`, self: "你更松弛", quote: { text: "我想知道我们现在算什么", who: "them", date: "11-08" },
    traits: [{ text: "直接", evidence: "“我想知道我们现在算什么”" }], turns: [{ date: "11-09", up: true, title: "你坦白还在和别人聊", quote: "谢谢你跟我说实话", note: "" }] })),
    { id: "someone-else", kind: "mutual", chase: "even", depth: "deep", shares: "even", view: "x", self: "", quote: { text: "", who: "me", date: "" }, traits: [], turns: [] }],
});

test("在了解的人 is read by itself with counted numbers, keeps who is chasing whom, and shows who moved", async (t) => {
  const inputs = [];
  let people = [], chase = {};
  const mediator = { structured: async (args) => { inputs.push(JSON.parse(args.input)); return reading(people, chase); } };
  const { comparer, users, call, add, note, chat } = await setup(t, mediator);
  const lily = await add("Lily");
  assert.equal((await call("/people/board")).status, "few", "one person is nothing to compare");
  const jie = await add("阿杰");
  people = [lily, jie];
  await note(jie, "2026-11-08 问我们现在算什么", "history", "我想知道我们现在算什么");
  // Screenshots: no times, so only what text shows is counted.
  await chat(jie, [["阿杰", "今天跟你看完电影走回来那段路，我一直在想一件事"], ["Alex", "什么事？"], ["阿杰", "我想知道我们现在算什么"], ["阿杰", "你身边是不是还有别人在聊？"]]);

  await call("/people"); // listing them starts the reading; nobody picks anyone
  await new Promise((r) => setTimeout(r, 300));
  await comparer.settle(users[0].id);
  assert.equal(inputs.length, 1, "the listing alone started it");
  const board = await call("/people/board?language=zh");
  assert.equal(board.status, "ready"); assert.equal(board.stale, false);
  assert.deepEqual(board.reading.people.map((row) => row.name).sort(), ["Lily", "阿杰"], "a person the notes do not have is dropped");
  assert.deepEqual(board.reading.insights.map((item) => item.headline), ["你和主动的人在一起最放松。"]);
  assert.deepEqual(board.numbers[jie.id].me, { messages: 1, questions: 1, chars: 4 });
  assert.equal(board.numbers[jie.id].them.questions, 1);
  assert.equal(board.numbers[jie.id].starts, null, "who starts needs times");
  assert.equal(board.numbers[lily.id], null);
  const sent = inputs[0].people.find((person) => person.name === "阿杰");
  assert.deepEqual(sent.history, [{ text: "2026-11-08 问我们现在算什么", quote: "我想知道我们现在算什么" }], "the reading sees the exact words");
  assert.deepEqual(sent.numbers.questions, { me: 1, them: 1 });
  assert.equal(inputs[0].people.find((person) => person.name === "Lily").numbers, null);
  await call("/people/board?language=zh");
  assert.equal(inputs.length, 1, "unchanged notes reuse the reading");

  // Lily drifts to the member chasing her: who moved is kept on her record, with when.
  chase = { Lily: "you_much" };
  await note(lily, "2026-11-10 又是你先开口", "history");
  assert.equal((await call("/people/board?language=zh")).stale, true, "the last reading shows while a new one is made");
  await comparer.settle(users[0].id);
  const moved = (await call("/people")).people.find((person) => person.id === lily.id);
  assert.deepEqual([moved.previousChase, moved.chase, moved.stage], ["even", "you_much", "you_chase"]);
  assert.ok(moved.chaseAt);

  const card = await call(`/people/${jie.id}?language=zh`);
  assert.equal(card.read.view, "阿杰 的看法", "a person's page carries Pinky's read of them");
  assert.equal(card.read.turns[0].title, "你坦白还在和别人聊");
  assert.equal(card.numbers.them.messages, 3);
  const other = await call("/people/board", { userId: users[1].id });
  assert.equal(other.status, "few"); assert.deepEqual(other.people, [], "another member sees none of it");
});

test("someone newly risky puts a dot on the menu until the page is opened", async (t) => {
  let people = [];
  const mediator = { structured: async () => ({ ...reading(people), people: reading(people).people.map((row) => row.id === people[0]?.id ? { ...row, kind: "risk" } : row) }) };
  const { comparer, users, call, add } = await setup(t, mediator);
  people = [await add("Mia"), await add("阿杰")];
  await call("/people/board");
  await comparer.settle(users[0].id);
  assert.equal((await call("/people")).alerts, 1);
  await call("/people/board?seen=1");
  assert.equal((await call("/people")).alerts, 0);
});

test("a reading naming too few known people is not shown, and a failure is not retried at once", async (t) => {
  let calls = 0, people = [];
  const mediator = { structured: async () => { calls += 1; return { insights: [], people: [{ ...reading(people).people[0] }] }; } };
  const { comparer, users, call, add } = await setup(t, mediator);
  people = [await add("Lily"), await add("阿杰")];
  await call("/people/board");
  await comparer.settle(users[0].id);
  assert.equal((await call("/people/board")).status, "failed");
  await comparer.settle(users[0].id);
  assert.equal(calls, 1);
});

test("time-based numbers come only from chats with times", () => {
  const timed = chatNumbers([{ record: { stats: { perPerson: { me: { messages: 2, initiations: 1, replyMinutesMedian: 25, lateNight: 40 }, partner: { messages: 3, initiations: 3, replyMinutesMedian: 4, lateNight: 38 } }, silences: [{ days: 3 }] } },
    messages: [{ role: "me", text: "早", at: "2026-10-01T08:00:00Z" }, { role: "them", text: "早呀？", at: "2026-11-02T08:01:00Z" }] }]);
  assert.deepEqual(timed.starts, { me: 1, them: 3 });
  assert.deepEqual(timed.replyMinutes, { me: 25, them: 4 });
  assert.deepEqual(timed.lateNight, { me: 40, them: 38 });
  assert.equal(timed.longestSilence, 3);
  assert.deepEqual([timed.first, timed.last], ["2026-10-01", "2026-11-02"]);
  assert.equal(chatNumbers([{ record: {}, messages: [] }]), null);
});

test("a restart does not pay for the same reading again (cost pass 11-10)", async (t) => {
  let calls = 0, people = [];
  const mediator = { structured: async () => { calls += 1; return reading(people, {}); } };
  const { comparer, users, add, store } = await setup(t, mediator);
  people = [await add("Lily"), await add("阿杰")];
  await comparer.current(users[0].id, "zh"); await comparer.settle(users[0].id);
  assert.equal(calls, 1);
  const restarted = createPeopleComparer({ store, mediator });
  const again = await restarted.current(users[0].id, "zh");
  assert.equal(again.status, "ready"); assert.equal(again.stale, false);
  await restarted.settle(users[0].id);
  assert.equal(calls, 1, "nothing it reads changed, so no new call");
});
