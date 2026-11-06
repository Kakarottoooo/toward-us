import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createTogetherRouter } from "../server/together-router.mjs";
import { buildTogetherContext } from "../server/together-domain.mjs";

const usAction = (patch) => ({ kind: "game", operation: "create", targetId: null, spaceId: null, title: null, text: null, date: null, layout: null, done: null, recurringRule: null, remindDaysBefore: null, photoId: null, localDateTime: null, idea: null, amount: null, currency: null, paidBy: null, split: null, ...patch });

test("小游戏: a card in Us, answers hidden until both answered, then revealed with the 默契值", async (t) => {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "games-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const [index, id] of ids.entries()) await store.createUser({ id, email: `${id}@example.invalid`, name: ["Ziwei", "Mia"][index], passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  let round = { prompt: "周末更想", options: ["在家看电影", "去海边"], about: "none" };
  const asked = [];
  const mediator = {
    continueTogether: async () => ({ reply: "来！", draftAgreement: null, actions: [usAction({ title: "choice" })] }),
    structured: async ({ name, input, instructions }) => { assert.equal(name, "couple_game"); asked.push({ input: JSON.parse(input), instructions }); return round; },
  };
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createTogetherRouter({ store, mediator }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, method = "GET", body, userId = ids[0]) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const us = async (userId) => (await request("/together?language=zh&timezone=UTC", "GET", null, userId)).body.conversation;
  const games = async (userId) => (await us(userId)).messages.filter((message) => message.kind === "game");
  const until = async (check) => { for (let index = 0; index < 100; index += 1) { const value = await check(); if (value) return value; await new Promise((r) => setTimeout(r, 20)); } throw new Error("timed out"); };

  // Asked in Us: Pinky replies, then the card follows.
  await request("/together/messages", "POST", { text: "Pinky，来玩个游戏", itemId: randomUUID(), language: "zh" });
  const [card] = await until(async () => { const list = await games(ids[0]); return list.length ? list : null; });
  assert.equal(card.text, "周末更想");
  assert.deepEqual(card.game, { type: "choice", options: ["在家看电影", "去海边"], aboutUserId: null });

  // Ziwei answers; Mia cannot see it, nor can the shared Pinky.
  await request(`/together/games/${card.id}/answer`, "POST", { choice: 1 });
  assert.deepEqual(Object.keys((await games(ids[0]))[0].answers), [ids[0]]);
  assert.deepEqual((await games(ids[1]))[0].answers, {}, "hidden from Mia until she answers");
  const context = buildTogetherContext(await store.relationshipSnapshotForUser(ids[1]), relationshipId, { userId: ids[1] });
  assert.equal(context.messages.find((message) => message.id === card.id).answers, undefined, "the model never sees a lone answer");
  assert.equal((await request(`/together/games/${card.id}/answer`, "POST", { choice: 7 }, ids[1])).status, 400, "an option that does not exist");

  // Mia answers the same: both see both, and they matched.
  await request(`/together/games/${card.id}/answer`, "POST", { choice: 1 }, ids[1]);
  const revealed = (await games(ids[0]))[0];
  assert.deepEqual(Object.values(revealed.answers).map((answer) => answer.text), ["去海边", "去海边"]);
  assert.deepEqual(revealed.game.result, { match: true, matched: 1, played: 1 });
  assert.equal((await request(`/together/games/${card.id}/answer`, "POST", { choice: 0 })).status, 409, "final once revealed");

  // "再来一局" as 默契问答 about Mia: she answers about herself, Ziwei guesses wrong; the tally keeps counting.
  round = { prompt: "我最想要的礼物是", options: ["旅行", "衣服", "大餐"], about: "B" };
  assert.equal((await request("/together/games", "POST", { type: "guess" })).status, 201);
  assert.ok(asked.at(-1).input.previous.includes("周末更想"), "the model knows what was played");
  const guess = (await games(ids[0])).at(-1);
  assert.equal(guess.game.aboutUserId, ids[1]);
  await request(`/together/games/${guess.id}/answer`, "POST", { choice: 0 }, ids[1]);
  await request(`/together/games/${guess.id}/answer`, "POST", { choice: 2 });
  assert.deepEqual((await games(ids[1])).at(-1).game.result, { match: false, matched: 1, played: 2 });

  // 真心话: words, no options; a model that repeats itself or fails falls back to a fresh fixed question.
  round = { prompt: "周末更想", options: [], about: "none" };
  await request("/together/games", "POST", { type: "truth" });
  const truth = (await games(ids[0])).at(-1);
  assert.equal(truth.game.type, "truth");
  assert.notEqual(truth.text, "周末更想", "never the same question twice");
  assert.equal((await request(`/together/games/${truth.id}/answer`, "POST", { text: "  " })).status, 400);
  await request(`/together/games/${truth.id}/answer`, "POST", { text: "你笑起来很好看" });
  await request(`/together/games/${truth.id}/answer`, "POST", { text: "觉得你很安静" }, ids[1]);
  const opened = (await games(ids[1])).at(-1);
  assert.deepEqual(Object.values(opened.answers).map((answer) => answer.text).sort(), ["你笑起来很好看", "觉得你很安静"].sort());
  assert.equal(opened.game.result, undefined, "真心话 has no score");
});
