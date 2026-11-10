import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { personFor, personSubject } from "../server/people.mjs";
import { profileContext } from "../server/profile.mjs";
import { readPortraits, refreshPortraits } from "../server/portraits.mjs";

// 画像层 (memory plan, founder 11-09: "接着做画像层"): what is worth never forgetting stays in Pinky's context even after
// the notes it came from drop out of the newest-80 list.
async function setup(t) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "portraits-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const store = await createFileStore(join(directory, "store.json"));
  const users = [{ id: randomUUID(), name: "Alex" }, { id: randomUUID(), name: "Blair" }];
  for (const user of users) await store.createUser({ ...user, email: `${user.id}@example.invalid`, passwordHash: "test", createdAt: new Date().toISOString() });
  const note = (subjectUserId, text, category = "likes", userId = users[0].id) => store.createRelationshipRecord("memories", createRelationshipRecord({ relationshipId: null, userId, ownerUserId: userId, visibility: "private", aiAccessScope: "private", status: "active", kind: "profile", subjectUserId, category, text, evidence: { saidAt: "2025-03-01T10:00:00.000Z" } }));
  return { store, users, note };
}

test("a person with enough notes gets a standing portrait and timeline, in context for its owner only", async (t) => {
  const { store, users, note } = await setup(t);
  const lin = await store.transaction(`user:${users[0].id}`, (tx) => personFor(tx, users[0].id, "Lin"));
  await note(personSubject(lin.id), "对芒果过敏", "food");
  for (const thing of ["爬山", "黑白摄影", "猫", "爵士乐", "咖啡"]) await note(personSubject(lin.id), `喜欢${thing}`);
  await note(personSubject(lin.id), "2025-02-14 第一次见面，聊到店关门", "history");
  const inputs = [];
  const mediator = { structured: async ({ input, instructions }) => { inputs.push({ input: JSON.parse(input), instructions }); return { portrait: "Lin：对芒果过敏；爱爬山、黑白摄影、猫。", timeline: [{ period: "2025-02", text: "第一次见面，聊到店关门" }] }; } };
  await refreshPortraits({ store, mediator, userId: users[0].id });
  assert.equal(inputs.length, 1, "only subjects with enough notes are drawn");
  assert.match(inputs[0].instructions, /Lin/);
  assert.deepEqual(inputs[0].input.history, ["2025-02-14 第一次见面，聊到店关门"]);
  assert.ok(inputs[0].input.facts.some((fact) => fact.text === "对芒果过敏" && fact.saidOn === "2025-03-01"));

  const known = await profileContext(store, users[0].id);
  assert.match(known.people.find((person) => person.id === lin.id).portrait.portrait, /芒果过敏/);
  assert.deepEqual(known.people.find((person) => person.id === lin.id).portrait.timeline, [{ period: "2025-02", text: "第一次见面，聊到店关门" }]);
  assert.deepEqual(await readPortraits(store, users[1].id), {}, "another member never reads it");
  assert.equal((await profileContext(store, users[1].id)).people.length, 0);

  // Not redrawn for one new note, redrawn once enough is new.
  await note(personSubject(lin.id), "喜欢露营");
  await refreshPortraits({ store, mediator, userId: users[0].id });
  assert.equal(inputs.length, 1);
  for (const thing of ["日料", "跑步", "看展", "乐高"]) await note(personSubject(lin.id), `喜欢${thing}`);
  await refreshPortraits({ store, mediator, userId: users[0].id });
  assert.equal(inputs.length, 2);
});

test("the member's own portrait is in context as portraits.me, and a failed drawing keeps the old one", async (t) => {
  const { store, users, note } = await setup(t);
  for (const thing of ["不吃香菜", "怕冷", "爱看书", "喜欢猫", "想去冰岛", "讨厌迟到"]) await note(users[0].id, thing);
  let fail = false;
  const mediator = { structured: async () => fail ? { portrait: "", timeline: [] } : { portrait: "Alex 不吃香菜，讨厌迟到。", timeline: [] } };
  await refreshPortraits({ store, mediator, userId: users[0].id });
  assert.equal((await profileContext(store, users[0].id)).portraits.me.portrait, "Alex 不吃香菜，讨厌迟到。");
  fail = true;
  for (const thing of ["爱爬山", "喜欢咖啡", "怕高", "想养狗"]) await note(users[0].id, thing);
  await refreshPortraits({ store, mediator, userId: users[0].id });
  assert.equal((await profileContext(store, users[0].id)).portraits.me.portrait, "Alex 不吃香菜，讨厌迟到。");
});
