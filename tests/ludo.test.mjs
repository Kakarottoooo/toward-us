import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createMatchRouter } from "../server/match-router.mjs";
import { BOARD, ENTRY, FLIGHT, FLIGHT_FROM, HANGAR, HEARTS, HOME, JUMP, LAST, LOOP, PET_LINES, PLANES, TASKS, colourOf, dice, isHeart, landing, ludo, petChoice, squareOf, stepTo } from "../server/matches/ludo.mjs";
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
const A = "a", B = "b";
const fresh = () => ludo.act(ludo.start({ players: [A, B], inviterUserId: A, matchId: "m" }), { userId: HOST, action: { type: "tasks", tasks: [{ zh: "任务一", en: "Task one", es: "Tarea uno" }, { zh: "任务二", en: "Task two", es: "Tarea dos" }], source: "model" } });
const play = (state, userId, action) => ludo.act(state, { userId, action });
const roll = (state, userId) => play(state, userId, { type: "roll", value: 6 });
const H = HANGAR;
/** A fresh game with these planes. */
const at = (mine, theirs = [H, H, H, H], current = A) => ({ ...fresh(), current, planes: { [A]: mine, [B]: theirs } });

test("飞行棋: the die is the server's alone", (t) => {
  rig(t, [2]);
  const state = roll(fresh(), A);
  assert.equal(state.die.value, 2, "the 6 the client sent is ignored");
  assert.equal(state.die.by, A);
  assert.equal(state.board, BOARD);
  assert.equal(code(() => roll(state, A)), "not_your_turn");
  assert.equal(code(() => play(state, "stranger", { type: "roll" })), "not_your_turn");
  assert.equal(code(() => play(state, B, { type: "jump" })), "invalid_action");
});

test("飞行棋: the board — 4 planes each, a 52-square loop, each one's colour, flight and hearts never overlapping", () => {
  const state = fresh();
  assert.deepEqual(state.planes[A], [H, H, H, H]); assert.equal(PLANES, 4);
  assert.deepEqual(ENTRY.map((square) => colourOf(square)), [0, 1], "each take-off square is its player's colour");
  for (const [index, id] of [A, B].entries()) {
    for (let progress = 0; progress <= LAST; progress += 1) assert.equal(colourOf(squareOf(state, id, progress)) === index, progress % 4 === 0, "your colour every 4th square from your take-off");
    assert.equal(colourOf(squareOf(state, id, FLIGHT_FROM)), null); assert.equal(colourOf(squareOf(state, id, FLIGHT_FROM + FLIGHT)), null);
  }
  const special = [...ENTRY, ...[A, B].flatMap((id) => [squareOf(state, id, FLIGHT_FROM), squareOf(state, id, FLIGHT_FROM + FLIGHT)])];
  assert.equal(HEARTS.length, 8);
  assert.ok(HEARTS.every((square) => colourOf(square) === null && !special.includes(square)));
  assert.equal(new Set(special).size, special.length);
  // Both players' journeys are the same shape, half a loop apart.
  assert.deepEqual([A, B].map((id) => squareOf(state, id, FLIGHT_FROM) - squareOf(state, id, 0)).map((d) => (d + LOOP) % LOOP), [31, 31]);
});

test("飞行棋: a 6 takes off and rolls again; three tries without a 6 take off anyway", (t) => {
  rig(t, [3, 6, 5]);
  let state = roll(fresh(), A);
  assert.deepEqual(state.planes[A], [H, H, H, H]); assert.equal(state.tries[A], 1); assert.equal(ludo.turn(state), B, "no 6: the turn passes");
  state = roll(state, B);
  assert.deepEqual(state.planes[B], [0, H, H, H], "the 6 launches a plane onto its take-off square");
  assert.equal(ludo.turn(state), B, "and gives another roll");
  state = roll(state, B);
  assert.deepEqual(state.planes[B], [5, H, H, H], "one plane can move: it moves by itself");
  assert.equal(ludo.turn(state), A);

  rig(t, [1, 2, 2, 1, 5]);
  state = roll(state, A); assert.equal(state.tries[A], 2);
  state = roll(state, B); // 5 -> 7
  state = roll(state, A);
  assert.deepEqual(state.planes[A], [0, H, H, H], "the third failed try launches one anyway");
  assert.equal(state.tries[A], 0); assert.equal(state.log.at(-1).kind, "forced");
  assert.equal(ludo.turn(state), B, "without a 6, no extra roll");
  state = roll(state, B);
  assert.deepEqual(state.planes[B], [12, H, H, H], "7 + 1 = 8, its own colour: on to 12");
});

test("飞行棋: your own colour jumps 4, your flight square flies 12 — once per move", (t) => {
  rig(t, [3]);
  let state = roll(at([1, H, H, H]), A);
  assert.deepEqual(state.planes[A], [8, H, H, H], "1 + 3 = 4, my colour: on to 8");
  assert.deepEqual(state.log.slice(-2).map((entry) => entry.kind), ["move", "jump"]);
  rig(t, [2]);
  state = roll(at([2, H, H, H]), A);
  assert.deepEqual(state.planes[A], [8, H, H, H], "2 + 2 = 4, jumps to 8");
  rig(t, [5]);
  state = roll(at([26, H, H, H]), A);
  assert.deepEqual(state.planes[A], [FLIGHT_FROM + FLIGHT, H, H, H], "31 is my flight square: on to 43");
  assert.equal(state.log.at(-1).kind, "flight");
  assert.equal(landing(26, 5).via, "flight"); assert.equal(landing(FLIGHT_FROM - 4, 4).via, "flight");
  // The other player's colour does nothing for me, and the jump that would leave the loop doesn't happen.
  assert.deepEqual(landing(1, 1), { to: 2, via: null });
  assert.deepEqual(landing(46, 2), { to: 48, via: null }, "48 + 4 would pass the end of my loop");
  assert.deepEqual(landing(44, 2), { to: 46, via: null });
  assert.deepEqual(landing(H, 6), { to: 0, via: null }, "taking off is never a jump");
  assert.equal(landing(H, 5).to, null);
});

test("飞行棋: landing on the other's plane — after a jump or a flight too — sends it back; the runway is safe", (t) => {
  // A's progress p is square 1 + p; B's progress q is square (27 + q) % 52.
  const sameSquare = (p) => (1 + p - 27 + LOOP) % LOOP;
  rig(t, [3]);
  let state = roll(at([10, H, H, H], [sameSquare(13), 3, H, H]), A);
  assert.deepEqual(state.planes[A], [13, H, H, H]);
  assert.deepEqual(state.planes[B], [H, 3, H, H], "captured");
  assert.equal(state.log.at(-1).kind, "capture");
  rig(t, [4]);
  state = roll(at([10, H, H, H], [sameSquare(13), 3, H, H]), A);
  assert.deepEqual(state.planes[B], [sameSquare(13), 3, H, H], "passing over it is not landing on it");
  rig(t, [3]);
  state = roll(at([1, H, H, H], [sameSquare(8), sameSquare(8), H, H]), A);
  assert.deepEqual(state.planes[A][0], 8); assert.deepEqual(state.planes[B], [H, H, H, H], "the jump's square counts, both of theirs go back");
  rig(t, [5]);
  state = roll(at([26, H, H, H], [sameSquare(43), H, H, H]), A);
  assert.deepEqual(state.planes[B], [H, H, H, H], "so does the flight's");
  // B at runway progress 52 can't be caught: runway squares are no loop squares.
  rig(t, [6]);
  state = roll(at([45, H, H, H], [52, H, H, H]), A);
  assert.deepEqual(state.planes[B], [52, H, H, H]);
});

test("飞行棋: past the centre bounces back; all 4 planes home wins", (t) => {
  assert.equal(stepTo(54, 4), 54, "54 + 4 = 58: two too far, back to 54");
  assert.equal(stepTo(50, 6), HOME);
  assert.equal(stepTo(HOME, 1), null);
  let state = at([53, HOME, HOME, HOME]);
  rig(t, [5, 1, 2]);
  state = roll(state, A);
  assert.deepEqual(state.planes[A], [54, HOME, HOME, HOME], "53 + 5 = 58: back to 54");
  state = roll(state, B);
  state = roll(state, A);
  assert.deepEqual(state.planes[A], [HOME, HOME, HOME, HOME], "54 + 2: exactly home");
  assert.equal(state.winner, A); assert.ok(ludo.finished(state)); assert.equal(ludo.turn(state), null);
  assert.equal(code(() => roll(state, B)), "match_over");
  assert.deepEqual(ludo.stats([{ state }]), { wins: { [A]: 1 }, played: 1, tasks: 0 });
});

test("飞行棋: a plane that can't move can't be chosen; nothing to move passes", (t) => {
  rig(t, [3]);
  let state = roll(at([HOME, 5, H, H]), A);
  assert.deepEqual(state.planes[A], [HOME, 8 + JUMP, H, H], "only plane 2 can move: 5 + 3 = 8, a jump to 12");
  rig(t, [6]);
  state = roll(at([10, 20, H, H]), A);
  assert.equal(state.phase, "move");
  assert.equal(code(() => play(state, A, { type: "move", plane: 0.5 })), "invalid_action");
  assert.equal(code(() => play(state, A, { type: "move", plane: 4 })), "invalid_action");
  assert.equal(code(() => roll(state, A)), "choose_plane");
  state = play(state, A, { type: "move", plane: 2 });
  assert.deepEqual(state.planes[A], [10, 20, 0, H]);
  assert.equal(ludo.turn(state), A, "a 6 rolls again after the move too");
  rig(t, [4]);
  state = roll(at([HOME, HOME, HOME, H]), A);
  assert.equal(ludo.turn(state), B); assert.equal(state.tries[A], 1, "only a hangar left: a try");
});

test("飞行棋: a heart's task holds the turn until it is done or skipped", (t) => {
  // A's progress 3 is square 4: a heart.
  let state = at([0, H, H, H]);
  rig(t, [3]);
  state = roll(state, A);
  assert.ok(isHeart(4)); assert.equal(state.phase, "task");
  assert.deepEqual(state.task, { by: A, text: { zh: "任务一", en: "Task one", es: "Tarea uno" }, extra: false }, "Pinky's tasks, in order");
  assert.equal(ludo.turn(state), A);
  assert.equal(code(() => roll(state, A)), "task_pending");
  assert.equal(code(() => play(state, A, { type: "move", plane: 0 })), "task_pending");
  assert.equal(code(() => play(state, B, { type: "task", done: true })), "not_your_turn");
  assert.equal(code(() => play(state, A, { type: "task", done: "yes" })), "invalid_action");
  state = play(state, A, { type: "task", done: true });
  assert.equal(ludo.turn(state), B); assert.equal(state.task, null); assert.equal(state.done[A], 1);
  assert.equal(code(() => play(state, B, { type: "task", done: true })), "roll_first");

  // A 6 onto a heart (3 + 6 = 9, square 10): the task first, then the extra roll.
  state = at([3, HOME, HOME, HOME]);
  rig(t, [6]);
  state = roll(state, A);
  assert.equal(state.phase, "task"); assert.equal(state.task.extra, true);
  state = play(state, A, { type: "task", done: false });
  assert.equal(ludo.turn(state), A); assert.equal(state.phase, "roll");
  assert.equal(state.skipped[A], 1); assert.equal(state.done[A], 0);
  assert.equal(state.log.at(-1).kind, "task"); assert.equal(state.log.at(-1).done, false);
});

test("飞行棋: 小家伙 picks a capture, then home, then the biggest leap, then its furthest plane; it does its tasks itself", (t) => {
  const pet = ludo.act(ludo.start({ players: [A, PET], inviterUserId: A, matchId: "p" }), { userId: HOST, action: { type: "tasks", tasks: [{ zh: "x" }] } });
  const board = (mine, theirs) => ({ ...pet, current: PET, planes: { [A]: theirs, [PET]: mine } });
  // PET's progress q is square (27 + q) % 52; A's progress 29 is square 30 = PET's progress 3.
  assert.equal(petChoice(board([1, 40, H, H], [29, H, H, H]), PET, 2), 0, "capture first");
  assert.equal(petChoice(board([2, 52, H, H], [H, H, H, H]), PET, 4), 1, "then home");
  assert.equal(petChoice(board([26, 33, H, H], [H, H, H, H]), PET, 5), 0, "then the flight");
  assert.equal(petChoice(board([5, 21, H, H], [H, H, H, H]), PET, 2), 1, "then the furthest");
  // 小家伙 lands on a heart: square 30 is its progress 3. No tap needed.
  rig(t, [1]);
  const state = ludo.act(board([2, H, H, H], [H, H, H, H]), { userId: PET, action: { type: "roll" } });
  assert.deepEqual(state.planes[PET], [3, H, H, H]);
  assert.equal(state.phase, "roll"); assert.equal(ludo.turn(state), A);
  const line = state.log.at(-1);
  assert.equal(line.kind, "task"); assert.equal(line.by, PET); assert.ok(PET_LINES[line.line]);
  assert.equal(state.done[PET], 1);
});

test("飞行棋: a game on the old 30-square board can only be ended, with no winner", () => {
  const old = { players: [A, B], seed: 1, planes: { [A]: [3, -1], [B]: [-1, -1] }, current: A, phase: "roll", die: null, rolls: 0, tries: { [A]: 0, [B]: 0 }, task: null, tasks: [{ zh: "x" }], taskSource: "builtin", taskCount: 0, done: { [A]: 0, [B]: 0 }, skipped: { [A]: 0, [B]: 0 }, log: [], winner: null, resignedBy: null };
  assert.equal(ludo.turn(old), null);
  assert.equal(code(() => roll(old, A)), "old_board");
  const ended = play(old, B, { type: "resign" });
  assert.ok(ludo.finished(ended)); assert.equal(ended.winner, null);
  assert.deepEqual(ludo.stats([{ state: ended }]).wins, {});
});

test("飞行棋: nothing is hidden between them but the tasks still to come", (t) => {
  rig(t, [6, 3]);
  let state = roll(roll(fresh(), A), A);
  const forA = ludo.view(state, A), forB = ludo.view(state, B);
  assert.deepEqual(forA, forB, "both see the same board");
  assert.equal(forA.seed, undefined); assert.equal(forA.tasks, null); assert.equal(forA.tasksReady, true);
  assert.deepEqual(forA.task.text, { zh: "任务一", en: "Task one", es: "Tarea uno" }, "the task in play is shown to both");
  assert.deepEqual(forA.planes, state.planes);
  state = ludo.start({ players: [A, B], inviterUserId: B, matchId: "m" });
  assert.equal(ludo.turn(state), B, "whoever starts the game rolls first");
  assert.equal(ludo.view(state, A).tasksReady, false);
  assert.equal(code(() => play(state, A, { type: "tasks", tasks: [{ en: "hi" }] })), "invalid_action", "only Pinky writes the tasks");
  assert.equal(code(() => play(state, HOST, { type: "tasks", tasks: [{ fr: "salut" }] })), "invalid_action");
});

test("飞行棋: Pinky writes the tasks at the start, in each player's language", async (t) => {
  const calls = [];
  const mediator = { structured: async ({ name, schema, input }) => {
    calls.push({ name, languages: Object.keys(schema.properties.tasks.items.properties), input: JSON.parse(input) });
    return { tasks: Array.from({ length: 12 }, (_, index) => ({ en: `Tell your partner thing ${index + 1}`, es: `Dile a tu pareja la cosa ${index + 1}`, zh: "should be dropped" })) };
  } };
  const { ids, request } = await couple(t, { mediator, languages: ["en", "es"] });
  const { match } = (await request("/matches", "POST", { game: "ludo", language: "en" })).body;
  const ready = await until(async () => { const state = (await request(`/matches/${match.id}`)).body.match.state; return state.tasksReady ? state : null; });
  assert.equal(calls.length, 1); assert.equal(calls[0].name, "ludo_tasks");
  assert.equal(typeof calls[0].input.game, "number", "each game's request differs, so the budget's repeat guard lets it through");
  assert.deepEqual(calls[0].languages.sort(), ["en", "es"], "written in Ziwei's English and Mia's Spanish");
  assert.equal(ready.tasks, null, "the list stays a surprise");
  // Launch, then 3 steps: square 4, a heart.
  rig(t, [6, 3]);
  await request(`/matches/${match.id}/actions`, "POST", { type: "roll" });
  const landed = (await request(`/matches/${match.id}/actions`, "POST", { type: "roll" })).body.match;
  assert.equal(landed.state.phase, "task");
  assert.deepEqual(landed.state.task.text, { en: "Tell your partner thing 1", es: "Dile a tu pareja la cosa 1" });
  const seen = (await request(`/matches/${match.id}`, "GET", null, ids[1])).body.match.state.task;
  assert.deepEqual(seen.text, landed.state.task.text, "Mia reads it too");
  assert.equal((await request(`/matches/${match.id}/actions`, "POST", { type: "task", done: true }, ids[1])).status, 409);
  const done = (await request(`/matches/${match.id}/actions`, "POST", { type: "task", done: true })).body.match;
  assert.equal(done.turn, ids[1]);
  assert.equal(calls.length, 1, "written once");
});

test("飞行棋: without a model the built-in tasks are used", async (t) => {
  const { request } = await couple(t, { mediator: null });
  const { match } = (await request("/matches", "POST", { game: "ludo" })).body;
  await until(async () => (await request(`/matches/${match.id}`)).body.match.state.tasksReady);
  rig(t, [6, 3]);
  await request(`/matches/${match.id}/actions`, "POST", { type: "roll" });
  const task = (await request(`/matches/${match.id}/actions`, "POST", { type: "roll" })).body.match.state.task;
  assert.ok(TASKS.some(([zh, en, es]) => task.text.zh === zh && task.text.en === en && task.text.es === es), "a built-in task, in all three languages");
  // A model that fails or writes nothing usable falls back the same way.
  const empty = await ludo.hostActions({ state: ludo.start({ players: [A, B], inviterUserId: A, matchId: "x" }), mediator: { structured: async () => ({ tasks: [] }) }, languages: ["zh"] });
  assert.equal(empty[0].source, "builtin"); assert.equal(empty[0].tasks.length, 12);
  const broken = await ludo.hostActions({ state: ludo.start({ players: [A, B], inviterUserId: A, matchId: "x" }), mediator: { structured: async () => { throw new Error("down"); } }, languages: [] });
  assert.equal(broken[0].source, "builtin");
  assert.ok(TASKS.length >= 30 && TASKS.every((task) => task.length === 3 && task.every((text) => text.length > 0)));
});

/** Plays my side through the router until the game ends: roll, pick the first plane that can move, do every task. */
async function playOut(request, matchId, me, act = (body) => request(`/matches/${matchId}/actions`, "POST", body, me)) {
  for (let step = 0; step < 20000; step += 1) {
    const match = (await request(`/matches/${matchId}`, "GET", null, me)).body.match;
    if (match.status !== "active") return { match, step };
    if (match.turn !== me) { await new Promise((r) => setTimeout(r, 5)); continue; }
    const { phase, planes, die } = match.state;
    const body = phase === "task" ? { type: "task", done: step % 3 !== 0 } : phase === "move" ? { type: "move", plane: planes[me].findIndex((p) => landing(p, die.value).to !== null) } : { type: "roll" };
    const reply = await act(body);
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
  }
  throw new Error("the game never ended");
}

test("飞行棋: 小家伙 plays a whole game to the end, its turns coming back with mine", async (t) => {
  const { ids, request } = await couple(t, { mediator: null });
  const { match } = (await request("/matches", "POST", { game: "ludo", with: "pet" })).body;
  assert.deepEqual(match.players, [ids[0], PET]);
  await until(async () => (await request(`/matches/${match.id}`)).body.match.state.tasksReady);
  let waited = 0;
  const { match: over } = await playOut(request, match.id, ids[0], async (body) => {
    const reply = await request(`/matches/${match.id}/actions`, "POST", body);
    if (reply.body.match?.status === "active" && reply.body.match.turn !== ids[0]) waited += 1;
    return reply;
  });
  assert.equal(over.status, "finished");
  assert.ok([ids[0], PET].includes(over.state.winner));
  assert.ok(over.state.planes[over.state.winner].every((p) => p === HOME));
  assert.equal(waited, 0, "小家伙 never keeps me waiting");
  const hall = (await request("/matches")).body;
  assert.equal(hall.petStats.ludo.played, 1); assert.equal(hall.stats.ludo.played, 0);
  assert.equal((await request(`/matches/${match.id}`, "GET", null, ids[1])).status, 404, "Mia doesn't see it");
});

test("飞行棋: the two of them play a whole game through the router", async (t) => {
  const { ids, request } = await couple(t, { mediator: null });
  const { match } = (await request("/matches", "POST", { game: "ludo" })).body;
  assert.equal(match.turn, ids[0]);
  const [first, second] = await Promise.all([playOut(request, match.id, ids[0]), playOut(request, match.id, ids[1])]);
  assert.equal(first.match.status, "finished"); assert.equal(second.match.state.winner, first.match.state.winner);
  const stats = (await request("/matches")).body.stats.ludo;
  assert.equal(stats.played, 1); assert.equal(Object.values(stats.wins)[0], 1);
  assert.equal((await request("/matches", "POST", { game: "ludo" })).status, 201, "and play again");
});
