import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createTogetherRouter } from "../server/together-router.mjs";
import { needsTranslation } from "../server/shared-translate.mjs";

const usAction = (patch) => ({ kind: "game", operation: "create", targetId: null, spaceId: null, title: null, text: null, date: null, layout: null, done: null, recurringRule: null, remindDaysBefore: null, photoId: null, localDateTime: null, idea: null, ...patch });

test("各看各的语言: Pinky's lines in Us show in each member's own language; members' words and same-language viewers are left alone", async (t) => {
  assert.deepEqual([needsTranslation("周末更想做什么？", "en"), needsTranslation("周末更想做什么？", "zh"), needsTranslation("What would you rather do this weekend?", "zh"), needsTranslation("What would you rather do?", "es"), needsTranslation("ok", "zh"), needsTranslation("来！", "en"), needsTranslation("子薇, how was your day today?", "en"), needsTranslation("好的，Pinky 记下了", "en")], [true, false, true, false, false, true, false, true]);
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "translate-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const [index, id] of ids.entries()) await store.createUser({ id, email: `${id}@example.invalid`, name: ["Ziwei", "Mia"][index], passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z", status: "pending" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  const translated = [];
  const mediator = {
    continueTogether: async () => ({ reply: "来！玩一局吧", draftAgreement: null, actions: [usAction({ title: "choice" })] }),
    structured: async ({ name, input, instructions }) => {
      if (name === "couple_game") return { prompt: "周末更想", options: ["在家看电影", "去海边"], about: "none" };
      if (name === "shared_translation") { const { text, options } = JSON.parse(input); translated.push({ text, instructions }); return { text: text === "来！玩一局吧" ? "Let's play a round!" : "This weekend you'd rather", options: options.length ? ["Movies at home", "The beach"] : [] }; }
      return { question: "", reply: "" };
    },
  };
  const events = [];
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createTogetherRouter({ store, mediator, emit: (_conversation, type) => events.push(type) }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, method = "GET", body, userId = ids[0]) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const us = async (userId, language) => (await request(`/together?language=${language}&timezone=UTC`, "GET", null, userId)).body.conversation.messages;
  const until = async (check) => { for (let index = 0; index < 100; index += 1) { const value = await check(); if (value) return value; await new Promise((r) => setTimeout(r, 20)); } throw new Error("timed out"); };

  // Mia's phone is in Chinese: Pinky answers her in Chinese and a game card follows.
  await request("/together/messages", "POST", { text: "Pinky，来玩个游戏", itemId: randomUUID(), language: "zh" }, ids[1]);
  await until(async () => (await us(ids[1], "zh")).some((message) => message.kind === "game"));
  assert.equal(translated.length, 0, "a viewer in the language Pinky wrote in costs nothing");

  // Ziwei's phone is in English: his first look starts the translations, and they arrive with a refresh.
  const seen = await until(async () => { const messages = await us(ids[0], "en"); const game = messages.find((message) => message.kind === "game"); return game?.translations?.en ? messages : null; });
  const reply = seen.find((message) => message.role === "agent" && message.kind === "text" && message.text === "来！玩一局吧");
  assert.deepEqual(reply.translations.en, { text: "Let's play a round!" });
  const game = seen.find((message) => message.kind === "game");
  assert.deepEqual(game.translations.en, { text: "This weekend you'd rather", options: ["Movies at home", "The beach"] });
  assert.equal(game.text, "周末更想", "the original stays as written for the Chinese side");
  assert.ok(seen.filter((message) => message.role === "member").every((message) => !message.translations), "members' own words are never translated");
  assert.match(translated[0].instructions, /into English/);
  assert.ok(events.includes("together.updated"));
  // Once kept, opening again translates nothing more.
  const calls = translated.length;
  await us(ids[0], "en"); await new Promise((r) => setTimeout(r, 60));
  assert.equal(translated.length, calls);
  // Answering still works by option number on the translated card.
  assert.equal((await request(`/together/games/${game.id}/answer`, "POST", { choice: 1, language: "en" }, ids[0])).status, 200);
});
