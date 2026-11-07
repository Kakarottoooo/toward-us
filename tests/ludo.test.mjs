import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createMatchRouter } from "../server/match-router.mjs";
import { createTogetherRouter } from "../server/together-router.mjs";
import { BOARD, BRIDGE_PAY, CALM_AT, CARDS, CARDS_AT, COINS_AT, FLIGHT, FLIGHT_FROM, HANGAR, HOME, INNER, LOOP, PET_LINES, PLACES, PLANES, PROMISES, QUARTER, START, START_COINS, TASKS, cardAt, cellOf, colourOf, dice, ludo, petChoice, rentOf, stepTo } from "../server/matches/ludo.mjs";
import { HOST, PET } from "../server/matches/errors.mjs";

async function couple(t, { mediator = null, languages = [null, null] } = {}) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "ludo-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const [index, id] of ids.entries()) await store.createUser({ id, email: `${id}@example.invalid`, name: ["Ziwei", "Mia"][index], passwordHash: "test", createdAt: new Date().toISOString(), ...(languages[index] ? { language: languages[index] } : {}) });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createMatchRouter({ store, mediator, petDelay: 0 }));
  app.use("/api", createTogetherRouter({ store, mediator: {} }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  const request = async (path, method = "GET", body, userId = ids[0]) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  return { store, ids, request };
}

const until = async (check) => { for (let index = 0; index < 200; index += 1) { const value = await check(); if (value) return value; await new Promise((r) => setTimeout(r, 10)); } throw new Error("timed out"); };
/** Makes the server's die come up with `values` in order (then 1s), for this test only. */
function rig(t, values) { const real = dice.roll, queue = [...values]; dice.roll = () => queue.length ? queue.shift() : 1; t.after(() => { dice.roll = real; }); return queue; }
const code = (fn) => { try { fn(); } catch (error) { return error.matchCode; } return null; };
const A = "a", B = "b", H = HANGAR;
const fresh = () => ludo.act(ludo.start({ players: [A, B], inviterUserId: A, matchId: "m" }), { userId: HOST, action: { type: "tasks", tasks: [{ zh: "任务一", en: "Task one", es: "Tarea uno" }, { zh: "任务二", en: "Task two", es: "Tarea dos" }], source: "model" } });
const play = (state, userId, action) => ludo.act(state, { userId, action });
const roll = (state, userId) => play(state, userId, { type: "roll", value: 6 });
const pl = (p, inner = -1) => ({ p, inner });
/** A game with these planes (progress numbers, or planes), A to move unless said otherwise. */
const at = (mine, theirs = [H, H], extra = {}) => ({ ...fresh(), current: A, ...extra, planes: { [A]: mine.map((p) => typeof p === "number" ? pl(p) : p), [B]: theirs.map((p) => typeof p === "number" ? pl(p) : p) } });
/** B's progress that stands on A's progress `p` (outer ring). */
const bAt = (p) => (p - START[1] + LOOP) % LOOP;
const countFor = (seed, card) => { for (let count = 0; count < 500; count += 1) if (cardAt(seed, count) === card) return count; throw new Error(card); };

test("飞行棋: the die is the server's alone", (t) => {
  rig(t, [2]);
  const state = roll(fresh(), A);
  assert.equal(state.die.value, 2, "the 6 the client sent is ignored");
  assert.equal(state.board, BOARD);
  assert.equal(code(() => roll(state, A)), "not_your_turn");
  assert.equal(code(() => play(state, "stranger", { type: "roll" })), "not_your_turn");
  assert.equal(code(() => play(state, B, { type: "jump" })), "invalid_action");
});

test("飞行棋: the board — two rings, every special square in one place only", () => {
  const state = fresh();
  assert.equal(PLANES, 2); assert.deepEqual(state.planes[A], [pl(H), pl(H)]); assert.equal(state.coins[A], START_COINS);
  assert.ok(START.every((square) => square % QUARTER === 0), "both start on a bridge");
  const specials = [...START, ...PLACES.map((place) => place.square), ...CARDS_AT, ...COINS_AT, ...CALM_AT, ...START.map((start) => (start + FLIGHT_FROM) % LOOP), ...[12, 36]];
  assert.equal(new Set(specials).size, specials.length, "no square does two things");
  assert.ok(specials.every((square) => colourOf(square) === null));
  // Half a turn apart: whatever is at square s for one is at s + 24 for the other.
  for (const list of [PLACES.map((place) => place.square), CARDS_AT, COINS_AT, CALM_AT]) assert.deepEqual(list.map((square) => (square + 24) % LOOP).sort((a, b) => a - b), [...list].sort((a, b) => a - b));
  // A quarter on the inner ring: the grass by the bridge, nine inner squares, the next bridge's grass; the same 12 steps.
  const inner = Array.from({ length: QUARTER - 1 }, (_, step) => cellOf(state, A, pl(13 + step - 1 + 1, 1)));
  assert.deepEqual(inner, ["g1", "i8", "i9", "i10", "i11", "i12", "i13", "i14", "i15", "i16", "g2"]);
  assert.equal(cellOf(state, A, pl(24, 1)), "o24", "back on the outer ring at the next bridge");
  assert.equal(cellOf(state, B, pl(39, 3)), "i9", "the other one, in its own last quarter, walks the same inner squares");
  assert.equal(INNER, 32);
});

test("飞行棋: a 6 takes off and rolls again; three tries without a 6 take off anyway", (t) => {
  rig(t, [3, 6, 5]);
  let state = roll(fresh(), A);
  assert.equal(state.tries[A], 1); assert.equal(ludo.turn(state), B, "no 6: the turn passes");
  state = roll(state, B);
  assert.deepEqual(state.planes[B][0], pl(0), "the 6 launches a plane onto its owner's start");
  assert.equal(ludo.turn(state), B, "and gives another roll");
  state = roll(state, B);
  assert.equal(state.planes[B][0].p, 5); assert.equal(ludo.turn(state), A);
  rig(t, [1, 2, 2]);
  state = roll(state, A); state = roll(state, B); state = roll(state, A);
  assert.deepEqual(state.planes[A][0], pl(0), "the third failed try launches one anyway");
  assert.equal(state.log.at(-1).kind, "forced"); assert.equal(ludo.turn(state), B);
});

test("飞行棋: 30 coins for each bridge passed; your colour hops 4; your flight square flies 12", (t) => {
  rig(t, [3]);
  let state = roll(at([10, H]), A);
  // 10 + 3 = 13 (past the bridge at 12), my colour: on to 17.
  assert.equal(state.planes[A][0].p, 17); assert.equal(state.coins[A], START_COINS + BRIDGE_PAY);
  assert.deepEqual(state.log.slice(-2).map((entry) => entry.kind), ["move", "jump"]);
  rig(t, [3]);
  state = roll(at([25, H]), A);
  assert.equal(state.planes[A][0].p, FLIGHT_FROM + FLIGHT, "28 is my flight square: on to 40");
  assert.equal(state.log.at(-1).kind, "flight"); assert.equal(state.coins[A], START_COINS + BRIDGE_PAY, "the bridge at 36 pays on the way");
  rig(t, [2]);
  state = roll(at([5, H]), A);
  assert.equal(state.planes[A][0].p, 7, "7 is the other one's colour: no hop for me");
});

test("飞行棋: stop on a bridge to take the inner ring — hearts and 60-coin squares, no rent — back out at the next bridge", (t) => {
  rig(t, [1]);
  let state = roll(at([11, HOME]), A);
  assert.equal(state.phase, "decide"); assert.deepEqual(state.pending, { kind: "bridge", by: A, plane: 0 });
  assert.equal(code(() => roll(state, A)), "decide_first");
  assert.equal(code(() => play(state, A, { type: "decide", choice: "buy" })), "invalid_action");
  state = play(state, A, { type: "decide", choice: "inner" });
  assert.deepEqual(state.planes[A][0], pl(12, 1)); assert.equal(ludo.turn(state), B);
  // 12 + 6 = 18: inner square 12, a coin square; and a 6 rolls again.
  rig(t, [6]);
  let inner = roll({ ...state, current: A }, A);
  assert.equal(cellOf(inner, A, inner.planes[A][0]), "i12"); assert.equal(inner.coins[A], START_COINS + BRIDGE_PAY + 60); assert.equal(ludo.turn(inner), A);
  // 12 + 4 = 16: inner square 10, a heart.
  rig(t, [4]);
  inner = roll({ ...state, current: A }, A);
  assert.equal(inner.phase, "task"); assert.deepEqual(inner.task.text, { zh: "任务一", en: "Task one", es: "Tarea uno" });
  // On past the next bridge (24): outer again, with its coins. 22 + 4 = 26, a coin square.
  rig(t, [4]);
  const out = roll(at([pl(22, 1), H]), A);
  assert.deepEqual(out.planes[A][0], pl(26)); assert.equal(out.coins[A], START_COINS + BRIDGE_PAY + 30);
  // Choosing the outer ring keeps it there.
  rig(t, [1]);
  const stay = play(roll(at([11, H]), A), A, { type: "decide", choice: "outer" });
  assert.deepEqual(stay.planes[A][0], pl(12));
});

test("飞行棋: buy a place, upgrade it, and the other one pays rent — in coins, or with a little promise", (t) => {
  rig(t, [2]);
  let state = roll(at([1, H]), A);
  const cafe = PLACES.find((place) => place.square === 3);
  assert.deepEqual(state.pending, { kind: "buy", by: A, square: 3, price: cafe.price });
  state = play(state, A, { type: "decide", choice: "buy" });
  assert.deepEqual(state.owned[3], { owner: A, level: 1 }); assert.equal(state.coins[A], START_COINS - cafe.price);
  // Mia lands on it: rent.
  rig(t, [2]);
  let rent = roll({ ...state, current: B, planes: { ...state.planes, [B]: [pl(bAt(1)), pl(H)] } }, B);
  assert.deepEqual(rent.pending, { kind: "rent", by: B, to: A, square: 3, rent: rentOf(cafe, 1) });
  const paid = play(rent, B, { type: "decide", choice: "coins" });
  assert.equal(paid.coins[B], START_COINS - rentOf(cafe, 1)); assert.equal(paid.coins[A], START_COINS - cafe.price + rentOf(cafe, 1));
  const promised = play(rent, B, { type: "decide", choice: "promise" });
  assert.equal(promised.coins[B], START_COINS, "no coins when paid with a promise");
  assert.equal(promised.promises.length, 1); assert.equal(promised.promises[0].from, B); assert.equal(promised.promises[0].to, A);
  assert.ok(PROMISES.some(([zh]) => zh === promised.promises[0].text.zh));
  const lines = ludo.said(rent, promised, { name: (id) => (id === A ? "Ziwei" : "Mia") });
  assert.equal(lines.length, 1); assert.match(lines[0].zh, /^Mia 在Ziwei的咖啡馆欠下一个小承诺：/); assert.match(lines[0].en, /^Mia owes Ziwei a little promise from the Café: /);
  // Back on my own place with 100 coins: upgrade, and the rent more than doubles.
  rig(t, [2]);
  let mine = roll({ ...state, current: A, coins: { ...state.coins, [A]: 150 }, planes: { ...state.planes, [A]: [pl(1), pl(H)] } }, A);
  assert.equal(mine.pending.kind, "upgrade");
  mine = play(mine, A, { type: "decide", choice: "upgrade" });
  assert.deepEqual(mine.owned[3], { owner: A, level: 2 }); assert.ok(rentOf(cafe, 2) > 2 * rentOf(cafe, 1));
  // Not enough coins to buy: no question.
  rig(t, [2]);
  assert.equal(roll(at([1, H], [H, H], { coins: { [A]: 20, [B]: 200 } }), A).phase, "roll");
});

test("飞行棋: 心动卡 do what they say", (t) => {
  const card = (id, base = at([4, H])) => { rig(t, [1]); return roll({ ...base, cardCount: countFor(base.seed, id) }, A); };
  assert.equal(card("ahead3").planes[A][0].p, 8);
  assert.equal(card("back2").planes[A][0].p, 3, "back to the café, where it may be bought");
  assert.equal(card("gift50").coins[A], START_COINS + 50); assert.equal(card("gift50").coins[B], START_COINS - 50);
  assert.equal(card("bonus80").coins[A], START_COINS + 80);
  assert.equal(card("charm").charm[A], 1);
  assert.equal(card("calm").calm[A], true);
  const photo = card("photo");
  assert.equal(photo.phase, "task"); assert.equal(photo.task.pay, 30);
  assert.equal(play(photo, A, { type: "task", done: true }).coins[A], START_COINS + 30, "a card's task pays when it's done");
  assert.equal(play(photo, A, { type: "task", done: false }).coins[A], START_COINS);
  assert.equal(card("question").phase, "task");
  assert.deepEqual(card("upgrade", { ...at([4, H]), owned: { 8: { owner: A, level: 1 } } }).owned[8], { owner: A, level: 2 });
  const swapped = card("swap", at([4, H], [bAt(30), H]));
  assert.equal(swapped.planes[A][0].p, 30); assert.equal(swapped.planes[B][0].p, bAt(5));
  assert.equal(CARDS.length, 10);
});

test("飞行棋: landing on the other one sends it back, unless a 护身符 saves it", (t) => {
  rig(t, [3]);
  let state = roll(at([10, H], [bAt(17), 5]), A);
  assert.deepEqual(state.planes[B], [pl(H), pl(5)], "captured where the hop ends");
  assert.equal(state.log.some((entry) => entry.kind === "capture"), true);
  rig(t, [3]);
  state = roll(at([10, H], [bAt(17), 5], { charm: { [A]: 0, [B]: 1 } }), A);
  assert.equal(state.planes[B][0].p, bAt(17)); assert.equal(state.charm[B], 0, "the charm is used up");
  // On the inner ring too: the same square for both.
  rig(t, [1]);
  state = roll(at([pl(14, 1), H], [pl(39, 3), H]), A);
  assert.equal(state.planes[B][0].p, H);
});

test("飞行棋: the 冷静角 holds a turn; a 6 or the other one's kind words get you out", (t) => {
  rig(t, [2]);
  let state = roll(at([20, HOME]), A);
  assert.equal(state.calm[A], true); assert.equal(ludo.turn(state), B);
  rig(t, [3]);
  const held = roll({ ...state, current: A }, A);
  assert.equal(held.planes[A][0].p, 22); assert.equal(held.calm[A], false); assert.equal(held.log.at(-1).kind, "calmed"); assert.equal(ludo.turn(held), B);
  rig(t, [6]);
  const out = roll({ ...state, current: A }, A);
  assert.equal(out.planes[A][0].p, 28 + FLIGHT, "a 6 plays on (22 + 6 = 28: the flight)");
  const bailed = play(state, B, { type: "bail" });
  assert.equal(bailed.calm[A], false); assert.equal(bailed.log.at(-1).kind, "bail");
  assert.equal(code(() => play(bailed, B, { type: "bail" })), "invalid_action", "only someone in the 冷静角 can be bailed out");
});

test("飞行棋: past home bounces back; both planes home wins", (t) => {
  assert.equal(stepTo(45, 6), 45); assert.equal(stepTo(42, 6), HOME); assert.equal(stepTo(HOME, 1), null);
  rig(t, [6, 3]);
  let state = roll(at([45, HOME]), A);
  assert.equal(state.planes[A][0].p, 45, "45 + 6 = 51: back to 45"); assert.equal(ludo.turn(state), A, "a 6 still rolls again");
  state = roll(state, A);
  assert.equal(state.winner, A); assert.ok(ludo.finished(state)); assert.equal(ludo.turn(state), null);
  assert.equal(code(() => roll(state, B)), "match_over");
  assert.deepEqual(ludo.stats([{ state }]), { wins: { [A]: 1 }, played: 1, tasks: 0 });
});

test("飞行棋: 小家伙 decides by itself — buys with coins to spare, pays rent in coins, can't be paid with a promise", (t) => {
  const pet = ludo.act(ludo.start({ players: [A, PET], inviterUserId: A, matchId: "p" }), { userId: HOST, action: { type: "tasks", tasks: [{ zh: "x" }] } });
  const board = (mine, theirs, extra = {}) => ({ ...pet, current: PET, ...extra, planes: { [A]: theirs.map((p) => pl(p)), [PET]: mine.map((p) => pl(p)) } });
  // 小家伙's progress 3 is square 27, the bookshop.
  rig(t, [2]);
  let state = ludo.act(board([1, H], [H, H]), { userId: PET, action: { type: "roll" } });
  assert.deepEqual(state.owned[27], { owner: PET, level: 1 }); assert.equal(ludo.turn(state), A);
  rig(t, [2]);
  state = ludo.act(board([1, H], [H, H], { owned: { 27: { owner: A, level: 1 } } }), { userId: PET, action: { type: "roll" } });
  assert.equal(state.coins[A], START_COINS + 40); assert.equal(ludo.turn(state), A);
  // My rent to 小家伙: coins only.
  rig(t, [2]);
  const mine = ludo.act({ ...board([H, H], [25, H], { owned: { 27: { owner: PET, level: 1 } } }), current: A }, { userId: A, action: { type: "roll" } });
  assert.equal(mine.pending.kind, "rent");
  assert.equal(code(() => ludo.act(mine, { userId: A, action: { type: "decide", choice: "promise" } })), "invalid_action");
  // On the inner ring 小家伙's progress 16 is inner square 26, a heart: it does the task by itself, no tap needed.
  rig(t, [3]);
  const heart = ludo.act({ ...board([H, H], [H, H]), planes: { [A]: [pl(H), pl(H)], [PET]: [pl(13, 1), pl(H)] } }, { userId: PET, action: { type: "roll" } });
  assert.equal(cellOf(heart, PET, heart.planes[PET][0]), "i26");
  assert.equal(heart.phase, "roll"); assert.equal(ludo.turn(heart), A);
  const line = heart.log.at(-1);
  assert.equal(line.kind, "task"); assert.equal(line.by, PET); assert.ok(PET_LINES[line.line]); assert.equal(heart.done[PET], 1);
  assert.equal(petChoice(board([5, 20], [H, H]), PET, 2), 1, "the plane furthest along");
});

test("飞行棋: a game on an older board can only be ended, with no winner", () => {
  const old = { board: 2, players: [A, B], seed: 1, planes: { [A]: [3, -1, -1, -1], [B]: [-1, -1, -1, -1] }, current: A, phase: "roll", die: null, rolls: 0, tries: { [A]: 0, [B]: 0 }, task: null, tasks: [{ zh: "x" }], taskSource: "builtin", taskCount: 0, done: { [A]: 0, [B]: 0 }, skipped: { [A]: 0, [B]: 0 }, log: [], winner: null, resignedBy: null };
  assert.equal(ludo.turn(old), null); assert.equal(ludo.hostPending(old), false);
  assert.equal(code(() => roll(old, A)), "old_board");
  const ended = play(old, B, { type: "resign" });
  assert.ok(ludo.finished(ended)); assert.equal(ended.winner, null);
});

test("飞行棋: nothing is hidden between them but the tasks still to come", () => {
  const state = fresh();
  const forA = ludo.view(state, A), forB = ludo.view(state, B);
  assert.deepEqual(forA, forB, "both see the same board");
  assert.equal(forA.seed, undefined); assert.equal(forA.tasks, null); assert.equal(forA.tasksReady, true);
  const other = ludo.start({ players: [A, B], inviterUserId: B, matchId: "m" });
  assert.equal(ludo.turn(other), B, "whoever starts the game rolls first");
  assert.equal(code(() => play(other, A, { type: "tasks", tasks: [{ en: "hi" }] })), "invalid_action", "only Pinky writes the tasks");
});

test("飞行棋: Pinky writes the tasks at the start, in each player's language; without a model the built-in ones", async (t) => {
  const calls = [];
  const mediator = { structured: async ({ name, schema, input }) => {
    calls.push({ name, languages: Object.keys(schema.properties.tasks.items.properties), input: JSON.parse(input) });
    return { tasks: Array.from({ length: 12 }, (_, index) => ({ en: `Tell your partner thing ${index + 1}`, es: `Dile a tu pareja la cosa ${index + 1}`, zh: "should be dropped" })) };
  } };
  const { request } = await couple(t, { mediator, languages: ["en", "es"] });
  const { match } = (await request("/matches", "POST", { game: "ludo", language: "en" })).body;
  const ready = await until(async () => { const state = (await request(`/matches/${match.id}`)).body.match.state; return state.tasksReady ? state : null; });
  assert.equal(calls.length, 1); assert.equal(calls[0].name, "ludo_tasks");
  assert.deepEqual(calls[0].languages.sort(), ["en", "es"]);
  assert.equal(ready.tasks, null, "the list stays a surprise");
  const empty = await ludo.hostActions({ state: ludo.start({ players: [A, B], inviterUserId: A, matchId: "x" }), mediator: { structured: async () => ({ tasks: [] }) }, languages: ["zh"] });
  assert.equal(empty[0].source, "builtin"); assert.equal(empty[0].tasks.length, 12);
  assert.ok(TASKS.length >= 30 && TASKS.every((task) => task.length === 3 && task.every((text) => text.length > 0)));
});

/** Plays my side through the router until the game ends: roll, the first plane that can move, buy what I can, take the
 * inner ring every other time, pay rent with a promise, do the tasks. */
async function playOut(request, matchId, me, act = (body) => request(`/matches/${matchId}/actions`, "POST", body, me)) {
  for (let step = 0; step < 20000; step += 1) {
    const match = (await request(`/matches/${matchId}`, "GET", null, me)).body.match;
    if (match.status !== "active") return { match, step };
    const { phase, planes, die, pending, task } = match.state;
    const mine = match.turn === me || (phase === "decide" && pending?.by === me) || (phase === "task" && task?.by === me);
    if (!mine) { await new Promise((r) => setTimeout(r, 5)); continue; }
    const body = phase === "task" ? { type: "task", done: step % 3 !== 0 }
      : phase === "decide" ? { type: "decide", choice: { buy: "buy", upgrade: "upgrade", rent: pending.to === PET ? "coins" : "promise", bridge: step % 2 ? "inner" : "outer" }[pending.kind] }
      : phase === "move" ? { type: "move", plane: planes[me].findIndex((plane) => stepTo(plane.p, die.value) !== null) } : { type: "roll" };
    const reply = await act(body);
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
  }
  throw new Error("the game never ended");
}

test("飞行棋: 小家伙 plays a whole game to the end, its turns coming back with mine", async (t) => {
  const { ids, request } = await couple(t, { mediator: null });
  const { match } = (await request("/matches", "POST", { game: "ludo", with: "pet" })).body;
  await until(async () => (await request(`/matches/${match.id}`)).body.match.state.tasksReady);
  let waited = 0;
  const { match: over } = await playOut(request, match.id, ids[0], async (body) => {
    const reply = await request(`/matches/${match.id}/actions`, "POST", body);
    if (reply.body.match?.status === "active" && reply.body.match.turn !== ids[0]) waited += 1;
    return reply;
  });
  assert.equal(over.status, "finished");
  assert.ok(over.state.planes[over.state.winner].every((plane) => plane.p === HOME));
  assert.equal(waited, 0, "小家伙 never keeps me waiting");
  const us = (await request("/together?language=zh")).body.conversation;
  assert.ok(!us?.messages?.some((message) => message.text?.includes("小承诺")), "a game with 小家伙 says nothing in Us");
});

test("飞行棋: the two of them play a whole game; a rent paid with a promise is written down in Us", async (t) => {
  const { ids, request } = await couple(t, { mediator: null });
  const { match } = (await request("/matches", "POST", { game: "ludo" })).body;
  const [first, second] = await Promise.all([playOut(request, match.id, ids[0]), playOut(request, match.id, ids[1])]);
  assert.equal(first.match.status, "finished"); assert.equal(second.match.state.winner, first.match.state.winner);
  const promises = first.match.state.promises;
  const us = (await request("/together?language=zh")).body.conversation;
  const lines = us.messages.filter((message) => message.text?.includes("小承诺"));
  assert.equal(lines.length, promises.length, "one line in Us for each promise");
  assert.equal((await request("/matches")).body.stats.ludo.played, 1);
});

test("飞行棋: 小家伙 on a long run of 6s keeps rolling and the reply still comes back", async (t) => {
  const { request } = await couple(t, { mediator: null });
  const { match } = (await request("/matches", "POST", { game: "ludo", with: "pet" })).body;
  await until(async () => (await request(`/matches/${match.id}`)).body.match.state.tasksReady);
  const real = dice.roll; let rolls = 0; dice.roll = () => (rolls++ === 0 ? 1 : 6); t.after(() => { dice.roll = real; });
  const reply = await request(`/matches/${match.id}/actions`, "POST", { type: "roll" });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  assert.ok(rolls > 9, "it played past its first round of moves");
});
