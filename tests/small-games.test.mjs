import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createMatchRouter } from "../server/match-router.mjs";
import { createTogetherRouter } from "../server/together-router.mjs";
import { fourFrom } from "../server/matches/connect-four.mjs";
import { legalMoves } from "../server/matches/reversi.mjs";

// 黑白棋, 四子棋, 两个真相一个谎言, 石头剪刀布 (founder 11-06, game batch 2).
async function couple(t) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "small-games-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const [index, id] of ids.entries()) await store.createUser({ id, email: `${id}@example.invalid`, name: ["Ziwei", "Mia"][index], passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createMatchRouter({ store, petDelay: 0 }));
  app.use("/api", createTogetherRouter({ store, mediator: {} }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, method = "GET", body, userId = ids[0]) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const move = (id, body, userId = ids[0]) => request(`/matches/${id}/actions`, "POST", body, userId);
  return { ids, request, move };
}

test("黑白棋: only flipping moves, flips the line, black first, resign hands it over", async (t) => {
  const { ids, request, move } = await couple(t);
  const { match } = (await request("/matches", "POST", { game: "reversi" })).body;
  assert.equal(match.state.black, ids[0]); assert.equal(match.state.legal.length, 4, "the four opening moves");
  assert.equal((await move(match.id, { type: "move", x: 0, y: 0 })).body.code, "invalid_action", "must flip something");
  assert.equal((await move(match.id, { type: "move", x: 2, y: 3 }, ids[1])).status, 409, "black first");
  const after = (await move(match.id, { type: "move", x: 2, y: 3 })).body.match.state;
  assert.deepEqual(after.counts, { b: 4, w: 1 }); assert.equal(after.next, "w");
  assert.equal(legalMoves("b".repeat(63) + ".", "w").length, 0, "no white disc, no white move");
  await move(match.id, { type: "resign" }, ids[1]);
  assert.equal((await request(`/matches/${match.id}`)).body.match.state.winner, ids[0]);
});

test("黑白棋: 小家伙 answers with a legal move in the same reply", async (t) => {
  const { request, move } = await couple(t);
  const { match } = (await request("/matches", "POST", { game: "reversi", with: "pet" })).body;
  const reply = (await move(match.id, { type: "move", x: 2, y: 3 })).body.match;
  assert.equal(reply.state.moves, 2); assert.equal(reply.state.next, "b");
});

test("四子棋: discs fall, four in a row wins; 小家伙 blocks a three", async (t) => {
  const { ids, request, move } = await couple(t);
  const { match } = (await request("/matches", "POST", { game: "connect4" })).body;
  assert.equal((await move(match.id, { type: "drop", column: 3 }, ids[1])).status, 409);
  for (let index = 0; index < 3; index += 1) { await move(match.id, { type: "drop", column: index }); await move(match.id, { type: "drop", column: index }, ids[1]); }
  const won = (await move(match.id, { type: "drop", column: 3 })).body.match;
  assert.equal(won.status, "finished"); assert.equal(won.state.winner, ids[0]); assert.equal(won.state.line.length, 4);
  assert.deepEqual(won.state.last, [3, 5], "dropped to the bottom");
  assert.equal(fourFrom(".".repeat(42), 0, 0, "r"), null);

  const pet = (await request("/matches", "POST", { game: "connect4", with: "pet" })).body.match;
  // Me in column 6, three times: it must cap the column before I get four.
  let state;
  for (let index = 0; index < 3; index += 1) state = (await move(pet.id, { type: "drop", column: 6 })).body.match.state;
  assert.equal(state.winner, null);
  assert.equal(state.grid[2 * 7 + 6], "y", "it blocked on top of my three");
});

test("两个真相一个谎言: the lie stays with the teller until the guess, then they swap", async (t) => {
  const { ids, request, move } = await couple(t);
  const { match } = (await request("/matches", "POST", { game: "truths" })).body;
  assert.equal((await move(match.id, { type: "tell", statements: ["a", "", "c"], lie: 1 })).body.code, "statements_required");
  await move(match.id, { type: "tell", statements: ["我会弹钢琴", "我怕猫", "我去过冰岛"], lie: 2 });
  assert.equal((await request(`/matches/${match.id}`, "GET", null, ids[1])).body.match.state.rounds.at(-1).lie, null, "hidden from Mia");
  assert.equal((await request(`/matches/${match.id}`)).body.match.state.rounds.at(-1).lie, 2);
  assert.equal((await move(match.id, { type: "guess", index: 2 })).status, 409, "the teller doesn't guess");
  const after = (await move(match.id, { type: "guess", index: 2 }, ids[1])).body.match.state;
  assert.equal(after.rounds.at(-2).outcome, "caught"); assert.equal(after.rounds.at(-1).teller, ids[1]);
  assert.deepEqual((await request("/matches")).body.stats.truths, { caught: { [ids[1]]: 1 }, played: 1 });
});

test("两个真相一个谎言: 小家伙 guesses mine, then tells its own three in every language", async (t) => {
  const { ids, request, move } = await couple(t);
  const { match } = (await request("/matches", "POST", { game: "truths", with: "pet" })).body;
  const state = (await move(match.id, { type: "tell", statements: ["一", "二", "三"], lie: 0 })).body.match.state;
  const [mine, its] = state.rounds.slice(-2);
  assert.ok(["caught", "fooled"].includes(mine.outcome));
  assert.equal(its.teller, "pet"); assert.equal(its.i18n.en.length, 3); assert.equal(its.lie, null, "its lie is hidden from me");
  assert.equal((await request(`/matches/${match.id}`)).body.match.turn, ids[0]);
});

test("石头剪刀布: hidden picks, ties replay, best of three, and the bet is said in Us", async (t) => {
  const { ids, request, move } = await couple(t);
  const { match } = (await request("/matches", "POST", { game: "rps" })).body;
  assert.equal(match.turn, "both");
  await move(match.id, { type: "stake", text: "输的人洗碗" }, ids[1]);
  await move(match.id, { type: "pick", choice: "rock" });
  assert.equal((await request(`/matches/${match.id}`, "GET", null, ids[1])).body.match.state.rounds.at(-1).picks[ids[0]], "picked", "hidden from Mia");
  assert.equal((await move(match.id, { type: "stake", text: "改一下" })).status, 409, "the bet is fixed once someone picked");
  await move(match.id, { type: "pick", choice: "rock" }, ids[1]);
  const tied = (await request(`/matches/${match.id}`)).body.match.state;
  assert.equal(tied.rounds.at(-2).winner, "tie"); assert.equal(tied.rounds.length, 2);
  await move(match.id, { type: "pick", choice: "paper" }); await move(match.id, { type: "pick", choice: "rock" }, ids[1]);
  await move(match.id, { type: "pick", choice: "scissors" });
  const last = (await move(match.id, { type: "pick", choice: "paper" }, ids[1])).body.match;
  assert.equal(last.status, "finished"); assert.equal(last.state.winner, ids[0]);
  const said = (await request("/together?language=zh", "GET", null, ids[1])).body.conversation.messages.find((message) => message.handle === `match-end:${match.id}`);
  assert.equal(said.text, "石头剪刀布：Ziwei 赢了！Mia 要兑现：输的人洗碗");
  assert.match(said.i18n.en, /Mia owes: 输的人洗碗/);
});

test("石头剪刀布: 小家伙 picks right after me, and nothing is said in Us", async (t) => {
  const { request, move } = await couple(t);
  const { match } = (await request("/matches", "POST", { game: "rps", with: "pet" })).body;
  assert.ok((await move(match.id, { type: "pick", choice: "rock" })).body.match.state.rounds[0].winner, "decided at once");
  for (let index = 0; index < 30 && !(await request(`/matches/${match.id}`)).body.match.state.winner; index += 1) await move(match.id, { type: "pick", choice: "paper" });
  assert.ok((await request(`/matches/${match.id}`)).body.match.state.winner);
  const said = (await request("/together?language=zh")).body.conversation.messages.filter((message) => String(message.handle || "").startsWith("match-end:"));
  assert.equal(said.length, 0);
});
