import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createMatchRouter } from "../server/match-router.mjs";
import { createTogetherRouter } from "../server/together-router.mjs";
import { fiveFrom } from "../server/matches/gomoku.mjs";
import { drawGuess, sameWord, WORDS } from "../server/matches/draw-guess.mjs";
import { projectGraph } from "../server/relationship-domain.mjs";

async function couple(t, { online = () => false } = {}) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "matches-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const [index, id] of ids.entries()) await store.createUser({ id, email: `${id}@example.invalid`, name: ["Ziwei", "Mia"][index], passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  const notices = [], events = [];
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createMatchRouter({ store, emit: (record, type) => events.push(type), notify: async (userId, message) => { notices.push({ userId, ...message }); }, online }));
  app.use("/api", createTogetherRouter({ store, mediator: {} }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, method = "GET", body, userId = ids[0]) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  return { store, ids, relationshipId, request, notices, events };
}

test("五子棋: five in a row in any direction, and nothing shorter", () => {
  // Black (even moves) on a diagonal; white elsewhere.
  const moves = [[2, 2], [0, 9], [3, 3], [1, 9], [4, 4], [2, 9], [5, 5], [3, 9], [6, 6]];
  assert.deepEqual(fiveFrom(moves, 6, 6), [[2, 2], [3, 3], [4, 4], [5, 5], [6, 6]]);
  assert.equal(fiveFrom(moves.slice(0, 7), 5, 5), null, "four is not five");
  const anti = [[4, 0], [9, 9], [3, 1], [9, 8], [2, 2], [9, 7], [1, 3], [9, 6], [0, 4]];
  assert.equal(fiveFrom(anti, 0, 4).length, 5);
});

test("五子棋: the hall starts one game, announces it in Us, takes turns, and ends with a winner", async (t) => {
  const { ids, request, notices, events } = await couple(t);
  const started = await request("/matches", "POST", { game: "gomoku" });
  assert.equal(started.status, 201);
  const match = started.body.match;
  assert.equal(match.state.black, ids[0], "whoever starts plays black and moves first");
  assert.equal(match.turn, ids[0]);
  const again = await request("/matches", "POST", { game: "gomoku" }, ids[1]);
  assert.equal(again.status, 200); assert.equal(again.body.match.id, match.id, "one open game of each kind");

  const us = (await request("/together?language=zh", "GET", null, ids[1])).body.conversation;
  const invite = us.messages.find((message) => message.kind === "match_invite");
  assert.deepEqual(invite.match, { id: match.id, game: "gomoku", invitedBy: ids[0] });
  assert.equal(invite.i18n.en, "Ziwei started a game of Gomoku");

  const move = (x, y, userId) => request(`/matches/${match.id}/actions`, "POST", { type: "move", x, y }, userId);
  assert.equal((await move(7, 7, ids[1])).status, 409, "not Mia's turn yet");
  assert.equal((await move(7, 7, ids[0])).status, 200);
  assert.equal(notices.at(-1).userId, ids[1]); assert.match(notices.at(-1).body.zh, /轮到你了/);
  assert.equal(notices.at(-1).url, `/?channel=us&game=${match.id}`);
  assert.equal((await move(7, 7, ids[1])).body.code, "occupied");
  assert.equal((await move(15, 0, ids[1])).status, 400, "off the board");
  for (let index = 0; index < 4; index += 1) { await move(index, 0, ids[1]); if (index < 3) await move(8 + index, 7, ids[0]); }
  // Black: (7,7) (8,7) (9,7) (10,7); white has four on row 0 and it is black's move: (11,7) wins.
  const won = await move(11, 7, ids[0]);
  assert.equal(won.body.match.status, "finished");
  assert.equal(won.body.match.state.winner, ids[0]);
  assert.equal(won.body.match.state.line.length, 5);
  assert.match(notices.at(-1).body.zh, /结束了这局五子棋/);
  assert.equal((await move(12, 7, ids[1])).status, 409, "over is over");
  assert.ok(events.includes("match.updated") && events.includes("together.updated"));

  const hall = (await request("/matches", "GET", null, ids[1])).body;
  assert.deepEqual(hall.stats.gomoku, { wins: { [ids[0]]: 1 }, draws: 0, played: 1 });
  // The next game: Mia plays black this time.
  const rematch = (await request("/matches", "POST", { game: "gomoku" }, ids[0])).body.match;
  assert.notEqual(rematch.id, match.id); assert.equal(rematch.state.black, ids[1]);
  assert.equal((await request(`/matches/${rematch.id}/actions`, "POST", { type: "resign" }, ids[0])).body.match.state.winner, ids[1], "resigning hands the game over");
});

test("五子棋: nobody is pushed while they have the App open", async (t) => {
  const { ids, request, notices } = await couple(t, { online: () => true });
  const { match } = (await request("/matches", "POST", { game: "gomoku" })).body;
  await request(`/matches/${match.id}/actions`, "POST", { type: "move", x: 0, y: 0 });
  assert.equal(notices.length, 0);
  assert.equal((await request(`/matches/${match.id}`, "GET", null, ids[1])).body.match.turn, ids[1]);
});

test("你画我猜: the word stays with the drawer, three guesses, then roles swap", async (t) => {
  const { store, ids, request, notices } = await couple(t);
  const { match } = (await request("/matches", "POST", { game: "draw" })).body;
  const round = () => request(`/matches/${match.id}`, "GET", null, ids[1]).then((result) => result.body.match.state.rounds.at(-1));
  const mine = (await request(`/matches/${match.id}`)).body.match.state.rounds.at(-1);
  assert.equal(mine.drawer, ids[0]); assert.ok(mine.word.zh && mine.word.en && mine.word.es, "the drawer sees the word in every language");
  assert.equal((await round()).word, null, "Mia only gets the hint");
  assert.ok((await round()).hint.length.zh >= 1);
  // Nor can she read it anywhere else: games are not part of the shared home graph.
  assert.deepEqual(projectGraph(await store.relationshipSnapshotForUser(ids[1]), ids[1]).matches, []);

  const act = (body, userId) => request(`/matches/${match.id}/actions`, "POST", body, userId);
  assert.equal((await act({ type: "guess", text: "猫" }, ids[1])).status, 409, "nothing to guess yet");
  assert.equal((await act({ type: "draw", strokes: [] }, ids[0])).body.code, "drawing_required");
  assert.equal((await act({ type: "draw", strokes: [{ c: 0, w: 1, p: [0, 0, 2000, 5] }] }, ids[0])).status, 400, "points stay on the canvas");
  const swapped = (await act({ type: "swap" }, ids[0])).body.match.state.rounds.at(-1);
  assert.notDeepEqual(swapped.word, mine.word, "another word before drawing");
  await act({ type: "draw", strokes: [{ c: 1, w: 1, p: [10, 10, 500, 500, 900, 120] }] }, ids[0]);
  assert.match(notices.at(-1).body.zh, /画好了/);
  assert.equal((await act({ type: "guess", text: "x" }, ids[0])).status, 409, "the drawer doesn't guess");
  await act({ type: "guess", text: "不是这个" }, ids[1]);
  await act({ type: "guess", text: "也不是" }, ids[1]);
  const after = (await act({ type: "guess", text: swapped.word.en.toUpperCase() }, ids[1])).body.match.state;
  const [solved, next] = after.rounds.slice(-2);
  assert.equal(solved.outcome, "guessed"); assert.equal(solved.guesses.length, 3);
  assert.deepEqual(solved.word, swapped.word, "both see the word once it is over");
  assert.equal(next.drawer, ids[1], "the guesser draws next");
  assert.equal(after.guessed, 1); assert.equal(after.played, 1);
  assert.equal((await request(`/matches/${match.id}`)).body.match.turn, ids[1]);

  // Three misses: missed, and it still swaps.
  await act({ type: "draw", strokes: [{ c: 0, w: 0, p: [1, 1, 2, 2] }] }, ids[1]);
  for (const text of ["a", "b", "c"]) await act({ type: "guess", text }, ids[0]);
  const missed = (await request(`/matches/${match.id}`)).body.match.state;
  assert.equal(missed.rounds.at(-2).outcome, "missed"); assert.equal(missed.rounds.at(-1).drawer, ids[0]);
  assert.deepEqual((await request("/matches")).body.stats.draw, { guessed: 1, played: 2 });
  assert.equal((await act({ type: "end" }, ids[1])).body.match.status, "finished");
});

test("你画我猜: a guess counts in any of the three languages, forgivingly", () => {
  const entry = (zh) => { const [category, , en, es] = WORDS.find((item) => item[1] === zh); return { category, zh, en, es }; };
  assert.ok(sameWord("猫", entry("猫")));
  assert.ok(sameWord(" Cats! ", entry("猫")));
  assert.ok(sameWord("el gato", entry("猫")));
  assert.ok(sameWord("an apple", entry("苹果")));
  assert.ok(sameWord("Ice-cream", entry("冰淇淋")));
  assert.ok(sameWord("pinguino", entry("企鹅")), "accents don't matter");
  assert.ok(!sameWord("狗", entry("猫")));
  assert.ok(!sameWord("", entry("猫")));
  const state = drawGuess.start({ players: ["a", "b"], inviterUserId: "a", matchId: "m" });
  assert.equal(drawGuess.turn(state), "a");
});

test("游戏: only the couple's own games, and unknown games are refused", async (t) => {
  const { request } = await couple(t);
  assert.equal((await request("/matches", "POST", { game: "chess" })).body.code, "unknown_game");
  assert.equal((await request(`/matches/${randomUUID()}`)).status, 404);
  const stranger = await request("/matches", "GET", null, randomUUID());
  assert.equal(stranger.status, 409);
});
