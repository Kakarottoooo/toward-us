import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createMatchRouter } from "../server/match-router.mjs";
import { HOME, HANGAR, TASKS, PET_LINES, dice, isHeart, ludo, petChoice } from "../server/matches/ludo.mjs";
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

test("飞行棋: the die is the server's alone", (t) => {
  rig(t, [2]);
  const state = roll(fresh(), A);
  assert.equal(state.die.value, 2, "the 6 the client sent is ignored");
  assert.equal(state.die.by, A);
  assert.equal(code(() => roll(state, A)), "not_your_turn");
  assert.equal(code(() => play(state, "stranger", { type: "roll" })), "not_your_turn");
  assert.equal(code(() => play(state, B, { type: "jump" })), "invalid_action");
});

test("飞行棋: a 6 takes off and rolls again; three tries without a 6 take off anyway", (t) => {
  rig(t, [3, 6, 4]);
  let state = roll(fresh(), A);
  assert.deepEqual(state.planes[A], [HANGAR, HANGAR]); assert.equal(state.tries[A], 1); assert.equal(ludo.turn(state), B, "no 6: the turn passes");
  state = roll(state, B);
  assert.deepEqual(state.planes[B], [0, HANGAR], "the 6 launches a plane onto its take-off square");
  assert.equal(ludo.turn(state), B, "and gives another roll");
  state = roll(state, B);
  assert.deepEqual(state.planes[B], [4, HANGAR], "one plane can move: it moves by itself");
  assert.equal(ludo.turn(state), A);

  rig(t, [1, 2, 2, 2, 5]);
  state = roll(state, A); assert.equal(state.tries[A], 2);
  state = roll(state, B); // B's plane: 4 -> 5
  state = roll(state, A);
  assert.deepEqual(state.planes[B], [6, HANGAR]);
  assert.deepEqual(state.planes[A], [0, HANGAR], "the third failed try launches one anyway");
  assert.equal(state.tries[A], 0); assert.equal(state.log.at(-1).kind, "forced");
  assert.equal(ludo.turn(state), B, "without a 6, no extra roll");
  state = roll(state, B);
  assert.deepEqual(state.planes[B], [8, HANGAR]);
  // With a plane on the loop, a roll that can't launch is no "try".
  rig(t, [6, 1]);
  state = roll(state, A);
  assert.equal(state.phase, "move", "a 6 with a plane out and one in the hangar: the player chooses");
  assert.equal(ludo.turn(state), A);
  assert.equal(code(() => roll(state, A)), "choose_plane");
  assert.equal(code(() => play(state, A, { type: "move", plane: 2 })), "invalid_action");
  state = play(state, A, { type: "move", plane: 1 });
  assert.deepEqual(state.planes[A], [0, 0]);
  assert.equal(ludo.turn(state), A, "a 6 rolls again after the move too");
  assert.equal(state.phase, "roll");
});

test("飞行棋: a plane that can't move can't be chosen", (t) => {
  rig(t, [3]);
  const base = fresh();
  let state = { ...base, planes: { ...base.planes, [A]: [28, 5] } };
  state = roll(state, A);
  // 28 + 3 overshoots home: only plane 1 can move, so it moves.
  assert.deepEqual(state.planes[A], [28, 8]);
  rig(t, [1]);
  state = { ...base, planes: { ...base.planes, [A]: [28, 5] } };
  state = roll(state, A);
  assert.equal(state.phase, "move");
  assert.equal(code(() => play(state, A, { type: "move", plane: 0.5 })), "invalid_action");
  rig(t, [4]);
  state = roll({ ...base, planes: { ...base.planes, [A]: [27, HANGAR] } }, A);
  assert.equal(state.phase, "roll"); assert.equal(ludo.turn(state), B, "nothing can move: the turn passes");
  assert.deepEqual(state.planes[A], [27, HANGAR]);
  assert.equal(state.tries[A], 0, "not stuck: a plane is out");
});

test("飞行棋: landing exactly on the other's plane sends it home to its hangar", (t) => {
  const base = fresh();
  // A's progress 13 is square 13; B's progress 28 is square (15 + 28) % 30 = 13.
  let state = { ...base, planes: { [A]: [10, HANGAR], [B]: [28, 3] } };
  rig(t, [3]);
  state = roll(state, A);
  assert.deepEqual(state.planes[A], [13, HANGAR]);
  assert.deepEqual(state.planes[B], [HANGAR, 3], "captured");
  assert.equal(state.log.at(-1).kind, "capture");
  // Passing over it is not landing on it.
  state = { ...base, planes: { [A]: [10, HANGAR], [B]: [28, 3] } };
  rig(t, [4]);
  state = roll(state, A);
  assert.deepEqual(state.planes[B], [28, 3]);
  // Both of theirs on one square both go back.
  state = { ...base, planes: { [A]: [9, HANGAR], [B]: [28, 28] } };
  rig(t, [4]);
  assert.deepEqual(roll(state, A).planes[B], [HANGAR, HANGAR]);
});

test("飞行棋: home needs the exact roll; both planes home wins", (t) => {
  const base = fresh();
  let state = { ...base, planes: { ...base.planes, [A]: [27, HOME] } };
  rig(t, [4, 1, 3]);
  state = roll(state, A);
  assert.deepEqual(state.planes[A], [27, HOME], "4 overshoots");
  state = roll(state, B);
  state = roll(state, A);
  assert.deepEqual(state.planes[A], [HOME, HOME]);
  assert.equal(state.winner, A); assert.ok(ludo.finished(state)); assert.equal(ludo.turn(state), null);
  assert.equal(code(() => roll(state, B)), "match_over");
  assert.deepEqual(ludo.stats([{ state }]), { wins: { [A]: 1 }, played: 1, tasks: 0 });
});

test("飞行棋: a heart's task holds the turn until it is done or skipped", (t) => {
  const base = fresh();
  let state = { ...base, planes: { ...base.planes, [A]: [0, HANGAR] } };
  rig(t, [2]);
  state = roll(state, A);
  assert.ok(isHeart(2)); assert.equal(state.phase, "task");
  assert.deepEqual(state.task, { by: A, text: { zh: "任务一", en: "Task one", es: "Tarea uno" }, extra: false }, "Pinky's tasks, in order");
  assert.equal(ludo.turn(state), A);
  assert.equal(code(() => roll(state, A)), "task_pending");
  assert.equal(code(() => play(state, A, { type: "move", plane: 0 })), "task_pending");
  assert.equal(code(() => play(state, B, { type: "task", done: true })), "not_your_turn");
  assert.equal(code(() => play(state, A, { type: "task", done: "yes" })), "invalid_action");
  state = play(state, A, { type: "task", done: true });
  assert.equal(ludo.turn(state), B); assert.equal(state.task, null); assert.equal(state.done[A], 1);
  assert.equal(code(() => play(state, B, { type: "task", done: true })), "roll_first");

  // A 6 onto a heart: the task first, then the extra roll.
  state = { ...base, planes: { ...base.planes, [A]: [1, HOME] } };
  rig(t, [6]);
  state = roll(state, A);
  assert.equal(state.phase, "task"); assert.equal(state.task.extra, true);
  state = play(state, A, { type: "task", done: false });
  assert.equal(ludo.turn(state), A); assert.equal(state.phase, "roll");
  assert.equal(state.skipped[A], 1); assert.equal(state.done[A], 0);
  assert.equal(state.log.at(-1).kind, "task"); assert.equal(state.log.at(-1).done, false);
});

test("飞行棋: 小家伙 picks a capture, then home, then its furthest plane, and does its tasks itself", (t) => {
  const pet = ludo.act(ludo.start({ players: [A, PET], inviterUserId: A, matchId: "p" }), { userId: HOST, action: { type: "tasks", tasks: [{ zh: "x" }] } });
  const at = (mine, theirs) => ({ ...pet, current: PET, planes: { [A]: theirs, [PET]: mine } });
  // PET's progress p is square (15 + p) % 30; A's progress 20 is square 20 = PET's progress 5.
  assert.equal(petChoice(at([2, 26], [20, HANGAR]), PET, 3), 0, "capture first");
  assert.equal(petChoice(at([2, 26], [HANGAR, HANGAR]), PET, 4), 1, "then home");
  assert.equal(petChoice(at([2, 12], [HANGAR, HANGAR]), PET, 1), 1, "then the furthest");
  rig(t, [5]);
  const state = ludo.act(at([2, 12], [HANGAR, HANGAR]), { userId: PET, action: { type: "roll" } });
  // 12 + 5 = 17, square 2: a heart. No tap needed.
  assert.deepEqual(state.planes[PET], [2, 17]);
  assert.equal(state.phase, "roll"); assert.equal(ludo.turn(state), A);
  const line = state.log.at(-1);
  assert.equal(line.kind, "task"); assert.equal(line.by, PET); assert.ok(PET_LINES[line.line]);
  assert.equal(state.done[PET], 1);
});

test("飞行棋: nothing is hidden between them but the tasks still to come", (t) => {
  rig(t, [6, 2]);
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
  // Launch, then 2 steps: square 2, a heart.
  rig(t, [6, 2]);
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
  rig(t, [6, 2]);
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
    const body = phase === "task" ? { type: "task", done: step % 3 !== 0 } : phase === "move" ? { type: "move", plane: planes[me].findIndex((p) => (p === HANGAR ? die.value === 6 : p >= 0 && p < HOME && p + die.value <= HOME)) } : { type: "roll" };
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
