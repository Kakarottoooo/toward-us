import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { tidyMemory, batchFor, BATCH_MAX, BATCH_NEW } from "../server/memory-tidy.mjs";
import { refreshPortraits, CHUNK } from "../server/portraits.mjs";

// Memory at scale (founder 11-09: "同意压测规模"): after years of notes no single model call grows with them.
async function setup(t) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "scale-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const store = await createFileStore(join(directory, "store.json"));
  const user = { id: randomUUID(), name: "Alex" };
  await store.createUser({ ...user, email: `${user.id}@example.invalid`, passwordHash: "test", createdAt: new Date().toISOString() });
  const day = (n) => new Date(Date.UTC(2024, 0, 1) + n * 86400000).toISOString();
  const notes = async (count, from = 0, text = (index) => `喜欢第${index}种东西`) => store.transaction(`user:${user.id}`, async (tx) => {
    const made = [];
    for (let index = 0; index < count; index += 1) { const record = createRelationshipRecord({ relationshipId: null, userId: user.id, ownerUserId: user.id, visibility: "private", aiAccessScope: "private", status: "active", kind: "profile", subjectUserId: user.id, category: "likes", text: text(from + index), evidence: { saidAt: day(from + index) }, createdAt: day(from + index), updatedAt: day(from + index) }); await tx.createRelationshipRecord("memories", record); made.push(record); }
    return made;
  });
  return { store, user, notes };
}

test("a tidy looks at the newest changes and the older notes most like them, never all of years of notes", async (t) => {
  const { store, user, notes } = await setup(t);
  const old = await notes(400);
  const coffee = (await notes(1, 400, () => "很爱喝咖啡"))[0];
  const twin = old[3];
  await store.transaction(`user:${user.id}`, (tx) => tx.updateRelationshipRecordForUser("memories", twin.id, user.id, (draft) => { draft.text = "爱喝咖啡"; draft.version += 1; }));
  const all = (await store.listRelationshipRecordsForUser("memories", user.id)).filter((item) => item.kind === "profile");
  const batch = batchFor(all, new Date(Date.UTC(2025, 0, 1, 12)).toISOString());
  assert.ok(batch.length <= BATCH_MAX);
  assert.equal(batch[0].id, coffee.id, "the newest change leads");
  assert.ok(batch.some((item) => item.id === twin.id), "an old note saying the same thing comes along");

  const inputs = [];
  const mediator = { structured: async ({ input }) => { inputs.push(JSON.parse(input)); return { merges: [], outdated: [] }; } };
  await tidyMemory({ store, mediator, userId: user.id, force: true });
  assert.equal(inputs.length, 1);
  assert.ok(inputs[0].notes.length <= BATCH_MAX && inputs[0].notes.length >= BATCH_NEW);
});

test("portraits: years of notes are drawn in bounded chunks, later only what changed, and start over when one is removed", async (t) => {
  const { store, user, notes } = await setup(t);
  const first = await notes(CHUNK * 2 + 20);
  const calls = [];
  const mediator = { structured: async ({ input }) => { const parsed = JSON.parse(input); calls.push(parsed); return { portrait: `画像${calls.length}`, timeline: [] }; } };
  await refreshPortraits({ store, mediator, userId: user.id });
  assert.equal(calls.length, 3, "three chunks, oldest first");
  assert.ok(calls.every((call) => call.facts.length <= CHUNK));
  assert.equal(calls[0].previous, undefined);
  assert.equal(calls[1].previous.portrait, "画像1", "each chunk builds on the one before");

  // A few new notes: one call with the previous portrait and only those notes.
  calls.length = 0;
  await notes(5, 1000);
  await refreshPortraits({ store, mediator, userId: user.id });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].previous.portrait, "画像3");
  assert.deepEqual(calls[0].facts.map((fact) => fact.text), [1000, 1001, 1002, 1003, 1004].map((index) => `喜欢第${index}种东西`));

  // The member removes a note the portrait was drawn from: it is redrawn from scratch, without it.
  calls.length = 0;
  await store.transaction(`user:${user.id}`, (tx) => tx.updateRelationshipRecordForUser("memories", first[0].id, user.id, (draft) => { draft.status = "archived"; draft.archivedAt = new Date().toISOString(); draft.version += 1; }));
  await store.transaction(`user:${user.id}`, async (tx) => { for (const item of (await tx.listRelationshipRecordsForUser("memories", user.id)).filter((entry) => entry.kind === "portrait")) await tx.updateRelationshipRecordForUser("memories", item.id, user.id, (draft) => { draft.builtAt = new Date(Date.now() - 4 * 86400000).toISOString(); draft.version += 1; }); });
  await refreshPortraits({ store, mediator, userId: user.id });
  assert.equal(calls[0].previous, undefined, "starts over");
  assert.ok(!calls.some((call) => call.facts.some((fact) => fact.text === "喜欢第0种东西")), "the removed note is gone");
  assert.ok(calls.every((call) => call.facts.length <= CHUNK));
});

test("a note folded away by a tidy does not make the portrait start over", async (t) => {
  const { store, user, notes } = await setup(t);
  const kept = await notes(10);
  const calls = [];
  const mediator = { structured: async ({ input }) => { calls.push(JSON.parse(input)); return { portrait: "画像", timeline: [] }; } };
  await refreshPortraits({ store, mediator, userId: user.id });
  calls.length = 0;
  await store.transaction(`user:${user.id}`, (tx) => tx.updateRelationshipRecordForUser("memories", kept[0].id, user.id, (draft) => { draft.status = "archived"; draft.archivedAt = new Date().toISOString(); draft.mergedInto = kept[1].id; draft.version += 1; }));
  await notes(5, 500);
  await refreshPortraits({ store, mediator, userId: user.id });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].previous.portrait, "画像");
});
