import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createMatchRouter } from "../server/match-router.mjs";
import { createTogetherRouter } from "../server/together-router.mjs";
import { bestMove, inCheck, legalMoves, PLY_LIMIT, START, xiangqi } from "../server/matches/xiangqi.mjs";

async function couple(t, { online = () => false, mediator = null } = {}) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "xiangqi-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const [index, id] of ids.entries()) await store.createUser({ id, email: `${id}@example.invalid`, name: ["Ziwei", "Mia"][index], passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  const notices = [];
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createMatchRouter({ store, mediator, petDelay: 0, emit: () => {}, notify: async (userId, message) => { notices.push({ userId, ...message }); }, online }));
  app.use("/api", createTogetherRouter({ store, mediator: {} }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, method = "GET", body, userId = ids[0]) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  return { store, ids, request, notices };
}

const sq = (x, y) => y * 9 + x;
/** A board with only these pieces: { "x,y": piece }. Both generals are placed unless given. */
function board(pieces) {
  const cells = Array(90).fill(".");
  for (const [key, piece] of Object.entries({ "3,0": "k", "5,9": "K", ...pieces })) { const [x, y] = key.split(",").map(Number); cells[sq(x, y)] = piece; }
  return cells.join("");
}
/** Where the piece on x,y may legally go, as "x,y" strings. */
const from = (b, x, y) => {
  const color = b[sq(x, y)] === b[sq(x, y)].toUpperCase() ? "red" : "black";
  return legalMoves(b, color).filter(([f]) => f === sq(x, y)).map(([, to]) => `${to % 9},${Math.floor(to / 9)}`).sort();
};
const state = (b, turn = "red", extra = {}) => ({ red: "r", black: "b", board: b, moves: turn === "red" ? [] : [[0, 0]], check: false, winner: null, draw: false, ending: null, resignedBy: null, ...extra });

test("象棋: the opening position has the 44 standard moves for red", () => {
  assert.equal(legalMoves(START, "red").length, 44);
  assert.equal(legalMoves(START, "black").length, 44);
  assert.equal(inCheck(START, "red"), false);
});

test("象棋: the general and advisors stay in the palace", () => {
  const b = board({ "3,0": "k", "5,9": "K", "3,9": "A", "4,1": "a" });
  assert.deepEqual(from(b, 5, 9), ["4,9", "5,8"]);
  assert.deepEqual(from(b, 3, 9), ["4,8"], "an advisor only steps diagonally inside the palace");
  assert.deepEqual(from(b, 4, 1), ["3,2", "5,0", "5,2"], "and not onto its own general");
});

test("象棋: the elephant is blocked by its eye and never crosses the river", () => {
  const free = board({ "4,5": "E" });
  assert.deepEqual(from(free, 4, 5), ["2,7", "6,7"], "never over the river from the river bank");
  const blocked = board({ "2,9": "E", "3,8": "P" });
  assert.deepEqual(from(blocked, 2, 9), ["0,7"], "the piece on its eye blocks that way");
  assert.deepEqual(from(board({ "2,0": "e" }), 2, 0), ["0,2", "4,2"]);
  assert.deepEqual(from(board({ "2,4": "e" }), 2, 4), ["0,2", "4,2"], "a black elephant stays on its side too");
});

test("象棋: the horse is blocked by its leg", () => {
  assert.deepEqual(from(board({ "4,5": "H" }), 4, 5), ["2,4", "2,6", "3,3", "3,7", "5,3", "5,7", "6,4", "6,6"]);
  const hobbled = board({ "4,5": "H", "4,4": "p", "3,5": "P" });
  assert.deepEqual(from(hobbled, 4, 5), ["3,7", "5,7", "6,4", "6,6"], "a piece above blocks both upward jumps, one to the left both leftward ones");
  assert.ok(!from(board({ "1,9": "H", "1,8": "P" }), 1, 9).includes("0,7"));
});

test("象棋: the chariot slides; the cannon slides but captures only over exactly one screen", () => {
  assert.deepEqual(from(board({ "0,9": "R", "0,6": "p", "1,9": "H" }), 0, 9), ["0,6", "0,7", "0,8"]);
  const b = board({ "1,7": "C", "1,4": "P", "1,2": "p", "1,0": "h" });
  const moves = from(b, 1, 7);
  assert.ok(moves.includes("1,2"), "captures over its one screen");
  assert.ok(!moves.includes("1,4") && !moves.includes("1,0"), "never takes the screen, never jumps two");
  assert.ok(moves.includes("1,5") && moves.includes("1,6") && moves.includes("1,8"), "moves freely up to the screen");
  assert.ok(!from(board({ "1,7": "C", "1,2": "p" }), 1, 7).includes("1,2"), "no capture without a screen");
});

test("象棋: soldiers go forward, and sideways only after crossing the river", () => {
  assert.deepEqual(from(board({ "2,6": "P" }), 2, 6), ["2,5"]);
  assert.deepEqual(from(board({ "2,4": "P" }), 2, 4), ["1,4", "2,3", "3,4"]);
  assert.deepEqual(from(board({ "0,0": "P", "5,9": "K", "3,0": "k" }), 0, 0), ["1,0"], "at the far edge only sideways");
  assert.deepEqual(from(board({ "6,5": "p" }), 6, 5), ["5,5", "6,6", "7,5"], "black's go down the board");
});

test("象棋: the two generals may never face each other on an open file", () => {
  const b = board({ "4,0": "k", "3,0": ".", "4,9": "K", "5,9": ".", "4,5": "R" });
  assert.ok(!from(b, 4, 5).some((to) => !to.startsWith("4,")), "the chariot between them may not step aside");
  assert.equal(inCheck(board({ "4,0": "k", "3,0": ".", "4,9": "K", "5,9": "." }), "red"), true, "facing counts as check");
  const king = board({ "4,0": "k", "3,0": ".", "3,9": "K", "5,9": "." });
  assert.ok(!from(king, 3, 9).includes("4,9"), "a general may not step onto the open file");
});

test("象棋: check by chariot, cannon, horse and soldier, and a move into check is not allowed", () => {
  assert.equal(inCheck(board({ "3,5": "R" }), "black"), true);
  assert.equal(inCheck(board({ "3,5": "C" }), "black"), false, "a cannon needs a screen");
  assert.equal(inCheck(board({ "3,5": "C", "3,3": "p" }), "black"), true);
  assert.equal(inCheck(board({ "4,2": "H" }), "black"), true);
  assert.equal(inCheck(board({ "4,2": "H", "4,1": "a" }), "black"), false, "a hobbled horse gives no check");
  assert.equal(inCheck(board({ "3,1": "P" }), "black"), true);
  assert.equal(inCheck(board({ "2,0": "P" }), "black"), true, "sideways once over the river");
  // Black's chariot is pinned in front of its general: it may only move along the file.
  const pinned = board({ "3,4": "r", "3,8": "R" });
  assert.ok(from(pinned, 3, 4).every((to) => to.startsWith("3,")));
  assert.throws(() => xiangqi.act(state(pinned, "black"), { userId: "b", action: { type: "move", from: sq(3, 4), to: sq(4, 4) } }), { matchCode: "invalid_action" });
});

test("象棋: checkmate and stalemate end the game; 300 plies is a draw", () => {
  // Two chariots: one gives check on the back rank, the other guards the second rank.
  const mate = xiangqi.act(state(board({ "3,0": "k", "8,1": "R", "7,5": "R" })), { userId: "r", action: { type: "move", from: sq(7, 5), to: sq(7, 0) } });
  assert.equal(mate.check, true); assert.equal(mate.winner, "r"); assert.equal(mate.ending, "checkmate");
  assert.equal(xiangqi.finished(mate), true); assert.equal(xiangqi.turn(mate), null);
  // Black's general alone, every step covered, not in check: no legal move is a loss too.
  const stale = xiangqi.act(state(board({ "4,0": "k", "3,0": ".", "3,5": "R", "4,2": "P", "5,9": "K", "6,6": "R" })), { userId: "r", action: { type: "move", from: sq(6, 6), to: sq(5, 6) } });
  assert.equal(stale.check, false); assert.equal(stale.winner, "r"); assert.equal(stale.ending, "stalemate");
  const long = state(START, "black", { moves: Array.from({ length: PLY_LIMIT - 1 }, () => [0, 0]) });
  const drawn = xiangqi.act(long, { userId: "b", action: { type: "move", from: sq(0, 0), to: sq(0, 1) } });
  assert.equal(drawn.draw, true); assert.equal(drawn.ending, "limit"); assert.equal(xiangqi.turn(drawn), null);
});

const i = sq;
// A short cooperative game: black walks its centre soldier away, red's cannons stack on the centre file (double-cannon mate).
const GAME = [
  [i(0, 9), i(0, 8)], [i(4, 3), i(4, 4)], [i(0, 8), i(0, 9)], [i(4, 4), i(4, 5)], [i(0, 9), i(0, 8)], [i(4, 5), i(4, 6)],
  [i(7, 7), i(4, 7)], [i(4, 6), i(3, 6)], [i(4, 7), i(4, 4)], [i(3, 6), i(2, 6)], [i(1, 7), i(4, 7)],
];

test("象棋: a whole game through the hall, turn by turn, ending in checkmate; next game the colours swap", async (t) => {
  const { ids, request, notices } = await couple(t);
  const started = await request("/matches", "POST", { game: "xiangqi" });
  assert.equal(started.status, 201);
  const { match } = started.body;
  assert.equal(match.state.red, ids[0], "whoever starts plays red"); assert.equal(match.turn, ids[0]);
  assert.equal(Object.values(match.state.legal).flat().length, 44, "the player to move gets their legal moves");
  assert.equal((await request(`/matches/${match.id}`, "GET", null, ids[1])).body.match.state.legal, undefined, "the other one does not");
  const move = ([f, to], userId) => request(`/matches/${match.id}/actions`, "POST", { type: "move", from: f, to }, userId);
  assert.equal((await move([i(4, 3), i(4, 4)], ids[1])).status, 409, "not black's turn");
  assert.equal((await move([i(1, 9), i(1, 7)], ids[0])).body.code, "invalid_action", "a horse doesn't move like that");
  assert.equal((await move([i(1, 7), i(1, 2)], ids[0])).body.code, "invalid_action", "a cannon captures only over a screen");
  assert.equal((await move([95, 0], ids[0])).status, 400, "off the board");
  assert.equal((await move([i(0, 3), i(0, 4)], ids[0])).status, 400, "not your piece");
  let last;
  for (const [index, step] of GAME.entries()) {
    last = await move(step, ids[index % 2]);
    assert.equal(last.status, 200, `ply ${index + 1}`);
    if (index === 6) assert.equal(last.body.match.state.check, true, "the cannon gives check over the soldier");
  }
  const over = last.body.match;
  assert.equal(over.status, "finished"); assert.equal(over.state.winner, ids[0]); assert.equal(over.state.ending, "checkmate");
  assert.match(notices.at(-1).body.zh, /结束了这局象棋/);
  assert.equal((await move([i(0, 0), i(0, 1)], ids[1])).status, 409, "over is over");
  assert.deepEqual((await request("/matches")).body.stats.xiangqi, { wins: { [ids[0]]: 1 }, draws: 0, played: 1 });

  const rematch = (await request("/matches", "POST", { game: "xiangqi" }, ids[0])).body.match;
  assert.notEqual(rematch.id, match.id);
  assert.equal(rematch.state.red, ids[1], "Mia plays red this time"); assert.equal(rematch.turn, ids[1]);
  const resigned = (await request(`/matches/${rematch.id}/actions`, "POST", { type: "resign" }, ids[0])).body.match;
  assert.equal(resigned.state.winner, ids[1]); assert.equal(resigned.state.ending, "resign");
});

test("小家伙: answers with a legal move right away, outside the couple's stats, and plays red the next game", async (t) => {
  const { ids, request, notices } = await couple(t);
  const { match } = (await request("/matches", "POST", { game: "xiangqi", with: "pet" })).body;
  assert.deepEqual(match.players, [ids[0], "pet"]); assert.equal(match.state.red, ids[0]);
  const reply = (await request(`/matches/${match.id}/actions`, "POST", { type: "move", from: i(7, 7), to: i(4, 7) })).body.match;
  assert.equal(reply.state.moves.length, 2, "its move comes back with mine");
  assert.equal(reply.turn, ids[0]);
  const afterMine = START.split(""); afterMine[i(4, 7)] = "C"; afterMine[i(7, 7)] = ".";
  const [pf, pt] = reply.state.moves[1];
  assert.ok(legalMoves(afterMine.join(""), "black").some(([f, to]) => f === pf && to === pt), "a legal move");
  assert.equal(notices.length, 0, "nobody is pushed");
  assert.equal((await request(`/matches/${match.id}`, "GET", null, ids[1])).status, 404, "Mia doesn't see it");

  await request(`/matches/${match.id}/actions`, "POST", { type: "resign" });
  const hall = (await request("/matches")).body;
  assert.equal(hall.stats.xiangqi.played, 0); assert.equal(hall.petStats.xiangqi.wins.pet, 1);
  // Next game with 小家伙 it plays red, so its first move is already on the board.
  const next = (await request("/matches", "POST", { game: "xiangqi", with: "pet" })).body.match;
  assert.equal(next.state.red, "pet"); assert.equal(next.state.moves.length, 1); assert.equal(next.turn, ids[0]);
  assert.ok(next.state.legal, "and I get my legal moves");
});

test("小家伙: takes a free chariot, finishes the game when it can, and answers fast with legal moves only", () => {
  const free = state(board({ "3,0": "k", "0,2": "r", "0,6": "R", "8,9": "R" }), "black");
  assert.deepEqual(bestMove(free), [i(0, 2), i(0, 6)], "takes the chariot left hanging");
  // Several moves end it here (checkmate, or leaving the general no move); whichever it picks, red wins at once.
  const [f, to] = bestMove(state(board({ "3,0": "k", "8,1": "R", "7,5": "R" })));
  assert.equal(xiangqi.act(state(board({ "3,0": "k", "8,1": "R", "7,5": "R" })), { userId: "r", action: { type: "move", from: f, to } }).winner, "r");

  // A game against itself: every move goes through the referee, and each answer comes well within a second.
  let game = xiangqi.start({ players: ["a", "b"], inviterUserId: "a" }), slowest = 0;
  for (let ply = 0; ply < 40 && !xiangqi.finished(game); ply += 1) {
    const began = Date.now(), [from, target] = bestMove(game); slowest = Math.max(slowest, Date.now() - began);
    game = xiangqi.act(game, { userId: xiangqi.turn(game), action: { type: "move", from, to: target } });
  }
  assert.ok(slowest < 1000, `answered within a second (slowest ${slowest} ms)`);
});
