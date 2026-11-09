import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { createPeopleRouter, personFor, personSubject } from "../server/people.mjs";
import { createPeopleComparer } from "../server/people-compare.mjs";

// Founder 11-09: "它自动会识别这些暧昧对象，然后自动对比，不要我来点击它和它对比". The comparison is made by itself.
async function setup(t, mediator) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "compare-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const store = await createFileStore(join(directory, "store.json"));
  const users = [{ id: randomUUID(), name: "Alex" }, { id: randomUUID(), name: "Blair" }];
  for (const user of users) await store.createUser({ ...user, email: `${user.id}@example.invalid`, passwordHash: "test", createdAt: new Date().toISOString() });
  const comparer = createPeopleComparer({ store, mediator });
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { const user = users.find((item) => item.id === req.headers["x-user"]); if (user) req.auth = { user }; next(); });
  app.use("/api", createPeopleRouter({ store, comparer }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const get = async (path, userId = users[0].id) => (await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { headers: { "x-user": userId } })).json();
  const add = (name) => store.transaction(`user:${users[0].id}`, (tx) => personFor(tx, users[0].id, name));
  const note = (person, text, category = "likes") => store.createRelationshipRecord("memories", createRelationshipRecord({ relationshipId: null, userId: users[0].id, ownerUserId: users[0].id, visibility: "private", aiAccessScope: "private", status: "active", kind: "profile", subjectUserId: personSubject(person.id), category, text }));
  return { store, users, comparer, get, add, note };
}

const answer = (people, extra = {}) => ({ overview: "Lily 主动约你、说到做到；阿杰 在等你的答案。", leaning: people[0].id, ask: "", people: people.map((person, index) => ({ id: person.id, stage: index ? "close" : "warming", going: `${person.name} 很主动`, watch: "", next: "约下一次" })), ...extra });

test("with two or more people the comparison is made by itself, kept, and remade only when their notes change", async (t) => {
  const calls = [];
  let people = [];
  const mediator = { structured: async (args) => { calls.push(JSON.parse(args.input)); return answer(people); } };
  const { comparer, users, get, add, note } = await setup(t, mediator);
  const lily = await add("Lily");
  assert.equal((await get("/people/compare")).status, "few", "one person is nothing to compare");
  const jie = await add("阿杰");
  people = [lily, jie];
  await note(lily, "不太能吃辣");
  await note(jie, "2026-11-08 问我们现在算什么", "history");

  // Listing the people starts it; nobody picks anyone.
  await get("/people");
  await comparer.settle(users[0].id);
  const ready = await get("/people/compare?language=zh");
  assert.equal(ready.status, "ready");
  assert.equal(ready.stale, false);
  assert.deepEqual(ready.comparison.people.map((row) => [row.name, row.stage]).sort(), [["Lily", "warming"], ["阿杰", "close"]].sort());
  assert.equal(ready.comparison.leaning, lily.id);
  assert.equal(calls.length, 1);
  const lilyInput = calls[0].people.find((person) => person.name === "Lily");
  assert.deepEqual(lilyInput.facts, ["不太能吃辣"], "each person carries only their own notes");
  assert.deepEqual(calls[0].people.find((person) => person.name === "阿杰").history, ["2026-11-08 问我们现在算什么"]);

  await get("/people/compare?language=zh");
  assert.equal(calls.length, 1, "unchanged notes reuse the comparison");

  await note(lily, "最喜欢黑白摄影");
  const stale = await get("/people/compare?language=zh");
  assert.equal(stale.status, "ready"); assert.equal(stale.stale, true, "the last one shows while a new one is made");
  await comparer.settle(users[0].id);
  assert.equal(calls.length, 2);
  assert.equal((await get("/people/compare?language=zh")).stale, false);

  assert.equal((await get("/people/compare", users[1].id)).status, "few", "another member never sees these people");
});

test("a comparison naming unknown people or missing its overview is not shown, and a failure is not retried at once", async (t) => {
  let calls = 0, people = [];
  const mediator = { structured: async () => { calls += 1; return answer([...people, { id: "someone-else", name: "X" }], { overview: "" }); } };
  const { comparer, users, get, add } = await setup(t, mediator);
  people = [await add("Lily"), await add("阿杰")];
  await get("/people/compare");
  await comparer.settle(users[0].id);
  assert.equal((await get("/people/compare")).status, "failed");
  await comparer.settle(users[0].id);
  assert.equal(calls, 1);
});
