import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createMatchRouter } from "../server/match-router.mjs";
import { cleanPuzzle, factsIn, keywordAnswer, PUZZLES, shorten, soup } from "../server/matches/soup.mjs";

async function couple(t, { mediator = null, languages = [] } = {}) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "soup-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const [index, id] of ids.entries()) await store.createUser({ id, email: `${id}@example.invalid`, name: ["Ziwei", "Mia"][index], passwordHash: "test", createdAt: new Date().toISOString() });
  for (const [index, language] of languages.entries()) await store.updateUserLanguage(ids[index], language);
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createMatchRouter({ store, mediator, petDelay: 0 }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, method = "GET", body, userId = ids[0]) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const raw = (matchId) => store.getRelationshipRecordForUser("matches", matchId, ids[0]);
  const look = async (matchId, userId = ids[0]) => (await request(`/matches/${matchId}`, "GET", null, userId)).body.match;
  return { store, ids, request, raw, look };
}
const until = async (check) => { for (let index = 0; index < 150; index += 1) { const value = await check(); if (value) return value; await new Promise((r) => setTimeout(r, 20)); } throw new Error("timed out"); };
const HAN = /\p{Script=Han}/u;

// A model that writes a three-fact puzzle in whichever languages it is asked for, answers "yes" (uncovering fact 0) to a
// question with "key" in it and "no" otherwise, and calls a proposal right when it says "right".
function fakeModel({ hold = null } = {}) {
  const calls = [];
  const words = { zh: ["电梯", "汤面", "汤底", "关键"], en: ["The lift", "A strange surface", "The whole truth", "A key fact"], es: ["El ascensor", "Una superficie rara", "Toda la verdad", "Un hecho clave"] };
  const each = (languages, slot, suffix = "") => Object.fromEntries(languages.map((language) => [language, `${words[language][slot]}${suffix}`]));
  const mediator = { structured: async ({ name, schema, input }) => {
    const data = JSON.parse(input);
    if (name === "soup_puzzle") {
      const languages = Object.keys(schema.properties.title.properties);
      calls.push({ name, languages });
      if (hold) await hold;
      return { title: each(languages, 0), surface: each(languages, 1), truth: each(languages, 2), facts: [0, 1, 2].map((index) => ({ text: each(languages, 3, ` ${index + 1}`), keywords: [`k${index}`] })) };
    }
    if (name === "soup_answer" && schema.properties.answer) {
      const languages = Object.keys(schema.properties.note.properties);
      calls.push({ name, kind: "ask", languages, question: data.question, hasTruth: Boolean(data.truth) });
      const hit = data.question.includes("key");
      return { answer: hit ? "yes" : "no", found: hit ? [0, 7] : [], note: each(languages, 3, hit ? "!" : "") };
    }
    if (name === "soup_answer" && schema.properties.solved) {
      const languages = Object.keys(schema.properties.note.properties);
      calls.push({ name, kind: "solve", languages });
      const solved = data.proposal.includes("right");
      return { solved, found: [], note: each(languages, 3, " close"), cheer: each(languages, 0, " yay") };
    }
    throw new Error(name);
  } };
  return { mediator, calls };
}

test("海龟汤: Pinky writes the puzzle in each player's language and keeps the 汤底 to itself", async (t) => {
  let release; const hold = new Promise((r) => { release = r; });
  const model = fakeModel({ hold });
  const { ids, request, raw, look } = await couple(t, { mediator: model.mediator, languages: ["zh", "en"] });
  const started = await request("/matches", "POST", { game: "soup", language: "zh" });
  assert.equal(started.status, 201);
  const id = started.body.match.id;
  assert.equal(started.body.match.turn, "both", "either of them may act");
  assert.equal(started.body.match.state.puzzle, null, "the puzzle is still being written");
  const early = await request(`/matches/${id}/actions`, "POST", { type: "ask", text: "Is it a key?", language: "en" }, ids[1]);
  assert.equal(early.status, 409); assert.equal(early.body.code, "soup_not_ready"); assert.match(early.body.error, /Pinky is still writing/);
  release();
  const match = await until(async () => { const seen = await look(id, ids[1]); return seen.state.puzzle ? seen : null; });
  assert.deepEqual(model.calls[0], { name: "soup_puzzle", languages: ["zh", "en"] }, "written in both players' languages");
  const puzzle = match.state.puzzle;
  assert.deepEqual(Object.keys(puzzle.surface).sort(), ["en", "zh"]);
  assert.equal(puzzle.surface.en, "A strange surface"); assert.equal(puzzle.surface.zh, "汤面");
  assert.equal(puzzle.factCount, 3);
  assert.equal(puzzle.truth, undefined, "no 汤底 before the end");
  assert.equal(puzzle.facts, undefined, "no key facts before the end");
  assert.ok(!JSON.stringify(match).includes("The whole truth") && !JSON.stringify(match).includes("A key fact") && !JSON.stringify(match).includes("k0"), "nothing hidden leaks through the view");
  const stored = await raw(id);
  assert.equal(stored.state.puzzle.truth.en, "The whole truth", "the server keeps it");
});

test("海龟汤: both of them ask; Pinky answers each one in both languages and counts the key facts found", async (t) => {
  const model = fakeModel();
  const { ids, request, look } = await couple(t, { mediator: model.mediator, languages: ["zh", "es"] });
  const id = (await request("/matches", "POST", { game: "soup", language: "zh" })).body.match.id;
  await until(async () => (await look(id)).state.puzzle);
  const ask = (text, userId) => request(`/matches/${id}/actions`, "POST", { type: "ask", text, language: "zh" }, userId);
  assert.equal((await ask("Is it a key?", ids[0])).status, 200);
  assert.equal((await ask("¿Es de noche?", ids[1])).status, 200, "the other one may ask at the same time");
  assert.equal((await ask("   ", ids[1])).body.code, "question_required");
  const match = await until(async () => { const seen = await look(id, ids[1]); return seen.state.log.length === 2 && seen.state.log.every((entry) => entry.answer) ? seen : null; });
  const [first, second] = match.state.log;
  assert.deepEqual([first.by, first.text, first.answer, first.found], [ids[0], "Is it a key?", "yes", [0]], "who asked, and an out-of-range fact is dropped");
  assert.deepEqual([second.by, second.answer, second.found], [ids[1], "no", []]);
  assert.deepEqual(first.note, { zh: "关键!", es: "Un hecho clave!" }, "the nudge comes in each player's language");
  assert.deepEqual(match.state.found, [0]);
  assert.equal(match.status, "active"); assert.equal(match.turn, "both");
  const asked = model.calls.filter((call) => call.kind === "ask");
  assert.ok(asked.every((call) => call.hasTruth && call.languages.join() === "zh,es"), "Pinky judges against the hidden story");
});

test("海龟汤: a wrong answer keeps it going; the right one ends it solved, with the 汤底 and a cheer", async (t) => {
  const model = fakeModel();
  const { ids, request, look } = await couple(t, { mediator: model.mediator, languages: ["en", "en"] });
  const id = (await request("/matches", "POST", { game: "soup", language: "en" })).body.match.id;
  await until(async () => (await look(id)).state.puzzle);
  const solve = (text, userId) => request(`/matches/${id}/actions`, "POST", { type: "solve", text, language: "en" }, userId);
  await solve("It was a dream", ids[1]);
  const wrong = await until(async () => { const seen = await look(id); return seen.state.log[0]?.answer ? seen : null; });
  assert.equal(wrong.status, "active"); assert.equal(wrong.state.log[0].kind, "solve"); assert.equal(wrong.state.log[0].solved, false);
  assert.deepEqual(wrong.state.log[0].note, { en: "A key fact close" });
  assert.equal(wrong.state.puzzle.truth, undefined);
  await solve("He was right all along", ids[0]);
  const done = await until(async () => { const seen = await look(id, ids[1]); return seen.status === "finished" ? seen : null; });
  assert.equal(done.state.outcome, "solved"); assert.equal(done.state.endedBy, ids[0]); assert.equal(done.turn, null);
  assert.equal(done.state.puzzle.truth.en, "The whole truth", "the 汤底 is shown to both at the end");
  assert.equal(done.state.puzzle.facts.length, 3);
  assert.deepEqual(done.state.cheer, { en: "The lift yay" });
  assert.equal((await request(`/matches/${id}/actions`, "POST", { type: "ask", text: "More?" }, ids[1])).status, 409, "over is over");
  const hall = (await request("/matches")).body;
  assert.deepEqual(hall.stats.soup, { solved: 1, played: 1 });
});

test("海龟汤: either of them may give up and see the 汤底", async (t) => {
  const model = fakeModel();
  const { ids, request, look } = await couple(t, { mediator: model.mediator });
  const id = (await request("/matches", "POST", { game: "soup" })).body.match.id;
  await until(async () => (await look(id)).state.puzzle);
  const gaveUp = await request(`/matches/${id}/actions`, "POST", { type: "reveal" }, ids[1]);
  assert.equal(gaveUp.body.match.status, "finished");
  assert.equal(gaveUp.body.match.state.outcome, "revealed"); assert.equal(gaveUp.body.match.state.endedBy, ids[1]);
  assert.equal(gaveUp.body.match.state.puzzle.truth.zh, "汤底");
  assert.deepEqual(gaveUp.body.match.state.found, [], "nothing was found");
});

test("海龟汤: only Pinky answers, and it can't be flooded", () => {
  const state = { ...soup.start({ players: ["a", "b"], matchId: "m" }), puzzle: { source: "builtin", ...PUZZLES[0] } };
  assert.throws(() => soup.act(state, { userId: "a", action: { type: "answer", id: "q1", answer: "yes" } }), { matchCode: "invalid_action" });
  assert.throws(() => soup.act(state, { userId: "a", action: { type: "puzzle", puzzle: PUZZLES[1] } }), { matchCode: "invalid_action" });
  assert.throws(() => soup.act(state, { userId: "pet", action: { type: "ask", text: "hi" } }), { matchCode: "not_your_turn" });
  assert.throws(() => soup.act(state, { userId: "stranger", action: { type: "ask", text: "hi" } }), { matchCode: "not_your_turn" });
  let next = state;
  for (let index = 0; index < 3; index += 1) next = soup.act(next, { userId: index % 2 ? "b" : "a", action: { type: "ask", text: `q ${index}` } });
  assert.throws(() => soup.act(next, { userId: "a", action: { type: "ask", text: "one more" } }), { matchCode: "soup_busy" }, "three waiting is enough");
  assert.equal(soup.act(state, { userId: "a", action: { type: "ask", text: "x".repeat(500) } }).log[0].text.length, 120);
  assert.ok(soup.hostPending(next)); assert.ok(soup.hostPending(soup.start({ players: ["a", "b"], matchId: "m" })), "no puzzle yet");
});

test("海龟汤 alone: with: pet, Pinky hosts, 小家伙 never asks, and it is always my turn", async (t) => {
  const model = fakeModel();
  const { ids, request, look } = await couple(t, { mediator: model.mediator, languages: ["es"] });
  const started = await request("/matches", "POST", { game: "soup", with: "pet", language: "es" });
  assert.equal(started.status, 201);
  const id = started.body.match.id;
  assert.deepEqual(started.body.match.players, [ids[0], "pet"]);
  assert.equal(started.body.match.turn, ids[0]);
  const match = await until(async () => { const seen = await look(id); return seen.state.puzzle ? seen : null; });
  assert.equal(match.state.puzzle.surface.es, "Una superficie rara");
  assert.ok(!match.state.puzzle.surface.zh, "only the one playing's language");
  await request(`/matches/${id}/actions`, "POST", { type: "ask", text: "¿Es una key?", language: "es" });
  const answered = await until(async () => { const seen = await look(id); return seen.state.log[0]?.answer ? seen : null; });
  assert.equal(answered.state.log[0].answer, "yes"); assert.equal(answered.turn, ids[0]);
  assert.deepEqual(await soup.petActions({ state: answered.state }), []);
  assert.equal((await request(`/matches/${id}`, "GET", null, ids[1])).status, 404, "a game alone is only mine");
});

test("海龟汤 without a model: a classic gentle puzzle in all three languages, answered by its key facts", async (t) => {
  const { ids, request, raw, look } = await couple(t, { mediator: null });
  const id = (await request("/matches", "POST", { game: "soup" })).body.match.id;
  const match = await until(async () => { const seen = await look(id); return seen.state.puzzle ? seen : null; });
  const stored = (await raw(id)).state.puzzle, classic = PUZZLES.find((item) => item.id === stored.id);
  assert.equal(stored.source, "builtin"); assert.ok(classic);
  assert.deepEqual(match.state.puzzle.surface, classic.surface);
  assert.ok(!HAN.test(match.state.puzzle.surface.en) && !HAN.test(match.state.puzzle.surface.es), "no Chinese in English or Spanish");
  assert.equal(match.state.puzzle.factCount, classic.facts.length); assert.equal(match.state.puzzle.truth, undefined);
  const ask = (text, userId = ids[0]) => request(`/matches/${id}/actions`, "POST", { type: "ask", text }, userId);
  await ask(`和${classic.facts[0].keywords[0]}有关吗？`);
  await ask("Is it about the weather on Mars?", ids[1]);
  const answered = await until(async () => { const seen = await look(id); return seen.state.log.every((entry) => entry.answer) && seen.state.log.length === 2 ? seen : null; });
  assert.deepEqual(answered.state.log.map((entry) => entry.answer), ["yes", "irrelevant"], "a key fact is 是, anything else 不重要");
  assert.deepEqual(answered.state.found, [0]);
  // A proposal touching one fact isn't enough when there are three or more; one touching all of them solves it.
  await request(`/matches/${id}/actions`, "POST", { type: "solve", text: `Something with ${classic.facts[1].keywords[0]}` }, ids[1]);
  const close = await until(async () => { const seen = await look(id); return seen.state.log[2]?.answer ? seen : null; });
  assert.equal(close.status, "active"); assert.equal(close.state.log[2].solved, false); assert.ok(close.state.log[2].note.zh);
  await request(`/matches/${id}/actions`, "POST", { type: "solve", text: classic.facts.map((item) => item.keywords[0]).join(" ") }, ids[1]);
  const done = await until(async () => { const seen = await look(id); return seen.status === "finished" ? seen : null; });
  assert.equal(done.state.outcome, "solved"); assert.deepEqual(done.state.puzzle.truth, classic.truth); assert.ok(done.state.cheer.zh, "in the players' language");
});

test("海龟汤 without a model: keyword answers in each language, a model that fails falls back, and a rematch gets a new puzzle", async () => {
  const elevator = { ...soup.start({ players: ["a", "b"], matchId: "m" }), puzzle: { source: "builtin", ...PUZZLES.find((item) => item.id === "elevator") } };
  const answer = (text, kind = "ask", state = elevator) => keywordAnswer(state, { id: "q1", kind, text }, ["zh", "en", "es"]);
  assert.deepEqual([answer("他是不是个子很矮？").answer, answer("Is he short?").answer, answer("¿Usa el paraguas?").answer], ["yes", "yes", "yes"]);
  assert.deepEqual(answer("¿Usa el paraguas para pulsar el botón?").found, [1, 2]);
  assert.equal(answer("他喜欢运动吗？").answer, "irrelevant");
  assert.equal(answer("Is it about shortcuts?").answer, "yes", "keywords match the start of a word");
  assert.equal(answer("Was she impressed?").answer, "irrelevant", "but not the middle of one");
  assert.equal(answer("He is short and uses his umbrella to reach the button", "solve").solved, true);
  assert.equal(answer("He likes exercise", "solve").solved, false);
  assert.deepEqual(factsIn("Was the DOG lost?", PUZZLES.find((item) => item.id === "dog").facts), [0, 1]);

  // A model that throws, or writes a puzzle that doesn't hold up, leaves a classic one.
  const broken = { structured: async () => { throw new Error("down"); } };
  const [written] = await soup.hostActions({ state: soup.start({ players: ["a", "b"], matchId: "x" }), mediator: broken, languages: ["en"] });
  assert.equal(written.puzzle.source, "builtin");
  const sloppy = { structured: async () => ({ title: { en: "Hi" }, surface: { en: "汤面" }, truth: { en: "x" }, facts: [] }) };
  assert.equal((await soup.hostActions({ state: soup.start({ players: ["a", "b"], matchId: "y" }), mediator: sloppy, languages: ["en"] }))[0].puzzle.source, "builtin");
  assert.equal(cleanPuzzle({ title: { en: "T" }, surface: { en: "S" }, truth: { en: "U" }, facts: [{ text: { en: "a" }, keywords: [] }, { text: { en: "b" }, keywords: [] }] }, ["en"]), null, "fewer than three key facts");
  const [failed] = await soup.hostActions({ state: soup.act(elevator, { userId: "a", action: { type: "ask", text: "Is he short?" } }), mediator: broken, languages: ["en"] });
  assert.equal(failed.answer, "yes", "a failing model still gets an answer from the key facts");

  // The last puzzle isn't served again right away.
  for (const matchId of ["r1", "r2", "r3", "r4", "r5"]) {
    const state = soup.start({ players: ["a", "b"], matchId, previous: [{ state: { puzzle: { source: "builtin", id: "elevator", title: PUZZLES[0].title } } }] });
    const [next] = await soup.hostActions({ state, mediator: null, languages: ["zh"] });
    assert.notEqual(next.puzzle.id, "elevator");
  }
});

test("海龟汤: Pinky's nudges stay a few words, cut at the end of a phrase", () => {
  assert.equal(shorten("Close!"), "Close!");
  assert.equal(shorten("That is a different direction from the truth. The grandma is not the sender, think again about who it is and why."), "That is a different direction from the truth. The grandma is not the sender…");
  assert.equal(shorten("你已经猜对了送东西的是快递员、里面是热豆浆，这很接近。但动机和老奶奶怎么认出是他这两点还不对。", 40), "你已经猜对了送东西的是快递员、里面是热豆浆，这很接近。");
  assert.ok(!shorten("word ".repeat(40)).match(/wor…$/), "never mid-word");
  for (const puzzle of PUZZLES) for (const field of ["title", "surface", "truth"]) {
    assert.ok(puzzle[field].zh && puzzle[field].en && puzzle[field].es, `${puzzle.id} ${field}`);
    assert.ok(!HAN.test(puzzle[field].en) && !HAN.test(puzzle[field].es), `${puzzle.id} ${field} has no Chinese in en/es`);
  }
  assert.ok(PUZZLES.every((puzzle) => puzzle.facts.length >= 3 && puzzle.facts.length <= 6 && puzzle.facts.every((item) => item.keywords.length && !HAN.test(item.text.en) && !HAN.test(item.text.es))));
});
