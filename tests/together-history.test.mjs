import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createTogetherRouter } from "../server/together-router.mjs";
import { appendTogetherMessage, olderTogetherMessages, previousDailyQuestions } from "../server/together-domain.mjs";
import { askDailyQuestion } from "../server/daily-question.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { searchMemoryResults } from "../server/memory-search.mjs";

// Us keeps a working set of 200 messages on the conversation; what came before is archived, never dropped.
async function fixture(t) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "history-"));
  const store = await createFileStore(join(directory, "store.json"));
  const [a, b] = [randomUUID(), randomUUID()];
  for (const id of [a, b]) await store.createUser({ id, email: `${id}@example.invalid`, name: id === a ? "Alex" : "Blair", passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: a, role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: a, expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, b, new Date().toISOString());
  const mediator = { continueTogether: async () => ({ reply: "ok", draftAgreement: null, actions: [] }) };
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createTogetherRouter({ store, mediator }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); assert.ok(resolve(directory).startsWith(base)); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, method = "GET", body, userId = a) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  const conversation = (userId = a) => store.getRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, userId);
  // Lines said without the App's turn loop (say, through the iMessage group) still go through the same append.
  const say = async (userId, text) => (await store.transaction(`relationship:${relationshipId}`, (tx) => appendTogetherMessage(tx, { relationshipId, actorUserId: userId, source: "app", text }))).message;
  return { store, a, b, relationshipId, request, conversation, say };
}

test("messages beyond the working set are archived in order, stay readable page by page, and keep unrevealed answers hidden", async (t) => {
  const f = await fixture(t);
  // Day 1: Pinky's question; Alex answers, Blair does not. Then a long stretch of talk pushes it out of the working set.
  assert.equal(await askDailyQuestion({ store: f.store, mediator: { structured: async () => ({ question: "What made you smile today?" }) }, relationshipId: f.relationshipId, userId: f.a, language: "en", today: "2026-11-05" }), true);
  const question = (await f.conversation()).messages.at(-1);
  assert.equal((await f.request(`/together/daily/${question.id}/answer`, "POST", { text: "ALEX_ANSWER", language: "en" })).status, 200);
  const ids = [question.id];
  for (let index = 0; index < 260; index += 1) ids.push((await f.say(index % 2 ? f.b : f.a, `line ${index}`)).id);
  const conversation = await f.conversation();
  assert.ok(conversation.messages.length <= 200 && conversation.messages.length >= 150, `the working set stays small: ${conversation.messages.length}`);
  assert.equal(conversation.archived.messages + conversation.messages.length, ids.length, "nothing is lost");
  assert.deepEqual(conversation.messages.map((item) => item.id), ids.slice(-conversation.messages.length), "the working set is the newest stretch");
  assert.equal((await f.store.relationshipSnapshotForUser(f.a)).togetherArchives, undefined, "the archive never rides along with every snapshot");
  assert.ok(!JSON.stringify((await f.request("/together?language=en")).body).includes("line 0"), "nor with the conversation the App loads");
  // The App reads backwards from the oldest message it holds, page after page, down to the very first one.
  const seen = []; let before = conversation.messages[0].id, more = true;
  while (more) {
    const page = (await f.request(`/together/history?before=${encodeURIComponent(before)}&limit=40`, "GET", null, f.b)).body;
    assert.ok(page.messages.length > 0 && page.messages.length <= 40);
    seen.unshift(...page.messages); before = page.messages[0].id; more = page.more;
  }
  assert.deepEqual(seen.map((item) => item.id), ids.slice(0, ids.length - conversation.messages.length), "every archived message, in order, once");
  assert.deepEqual(seen.find((item) => item.id === question.id).answers, {}, "Blair never answered, so Alex's answer stays hidden in the archive too");
  const located = (await f.request(`/together/locate?messageId=${question.id}`, "GET", null, f.b)).body;
  assert.deepEqual(located.messages.find((item) => item.id === question.id).answers, {}, "direct navigation uses the same unrevealed-answer projection");
  assert.deepEqual((await f.conversation()).messages.find((item) => item.id === question.id)?.answers, undefined);
  assert.equal(JSON.stringify((await olderTogetherMessages(f.store, { relationshipId: f.relationshipId, userId: f.a, before: question.id })).messages), "[]", "nothing before the first message");
  assert.deepEqual(await olderTogetherMessages(f.store, { relationshipId: f.relationshipId, userId: f.a, before: "no-such-message" }), { messages: [], more: false });
});

test("the daily question never repeats one the conversation has moved past", async (t) => {
  const f = await fixture(t);
  // No model: the fixed pool in day order, so the same slot comes around a week later.
  const asked = async (today, material = null) => {
    const mediator = material ? { structured: async ({ name, input }) => { if (name === "daily_question") material.push(JSON.parse(input)); return { question: "" }; } } : null;
    assert.equal(await askDailyQuestion({ store: f.store, mediator, relationshipId: f.relationshipId, userId: f.a, language: "en", today }), true);
    return (await f.conversation()).messages.findLast((item) => item.kind === "daily_question").text;
  };
  const first = await asked("2026-11-05");
  for (let index = 0; index < 230; index += 1) await f.say(f.a, `line ${index}`);
  assert.ok(!(await f.conversation()).messages.some((item) => item.kind === "daily_question"), "the first question left the working set");
  assert.deepEqual(await previousDailyQuestions(f.store, { relationshipId: f.relationshipId, userId: f.b }), [first]);
  const material = [];
  const next = await asked("2026-11-12", material);
  assert.notEqual(next, first, "the same pool slot a week later still skips it");
  assert.deepEqual(material[0].previousQuestions, [first], "the model is told what was asked before");
});

test("shared recall and HTTP jump use the same membership boundary, including archived messages and unrevealed answers", async (t) => {
  const f = await fixture(t);
  const question = await f.say(f.a, "Pinky，蓝色风筝的约定是什么？");
  await f.store.transaction(`relationship:${f.relationshipId}`, (tx) => appendTogetherMessage(tx, { relationshipId: f.relationshipId, userId: f.a, actorUserId: null, source: "app", text: "蓝色风筝约定：每周一起散步。", replyTo: question.id }));
  const secret = createRelationshipRecord({ relationshipId: null, userId: f.a, visibility: "private", aiAccessScope: "private", intentType: "assistant", messages: [{ id: randomUUID(), role: "user", text: "蓝色风筝 PRIVATE_SECRET", createdAt: question.createdAt }] });
  await f.store.createRelationshipRecord("privateAgentThreads", secret);
  for (let index = 0; index < 210; index++) await f.say(f.b, `other ${index}`);
  for (const userId of [f.a, f.b]) {
    const found = await searchMemoryResults({ store: f.store, userId, channel: "us", query: "蓝色风筝" });
    assert.match(found.findings, /约定是什么.*\nPinky 当时答.*每周一起散步/);
    assert.doesNotMatch(found.findings, /PRIVATE_SECRET/);
    assert.equal(found.sources[0].messageId, question.id);
    const result = await f.request(`/together/locate?messageId=${question.id}`, "GET", null, userId);
    assert.equal(result.status, 200);
    assert.equal(result.body.messages[0].id, question.id);
    assert.ok(result.body.messages.length <= 50);
    assert.equal((await f.request(`/together/locate?conversationId=${secret.id}&messageId=${secret.messages[0].id}`, "GET", null, userId)).status, 404);
  }
  const outsider = randomUUID();
  await f.store.createUser({ id: outsider, email: `${outsider}@example.invalid`, name: "Outside", passwordHash: "test", createdAt: new Date().toISOString() });
  assert.equal((await f.request(`/together/locate?messageId=${question.id}`, "GET", null, outsider)).status, 409);
  assert.equal((await f.request(`/together/locate?messageId=${question.id}`, "GET", null, "")).status, 401);
  assert.equal((await f.request("/together/locate?messageId=missing")).status, 404);
});
