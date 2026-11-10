import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFile, mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { keepMessages } from "../server/thread-pages.mjs";

// The local file store (dogfood runs on it). Founder 11-10 approved removing its per-turn cost that grew with all data
// ("把这三个章目一起完成"): a transaction copies only what it changes and appends only its changes; nothing else about
// it may change — all or nothing, survives a crash mid-write, and the file on disk is whole after a restart.
async function setup(t, options) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "file-store-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const path = join(directory, "store.json");
  const store = await createFileStore(path, options);
  const user = { id: randomUUID(), name: "Alex" };
  await store.createUser({ ...user, email: `${user.id}@example.invalid`, passwordHash: "test", createdAt: new Date().toISOString() });
  const note = (text) => createRelationshipRecord({ relationshipId: null, userId: user.id, ownerUserId: user.id, visibility: "private", aiAccessScope: "private", status: "active", kind: "profile", subjectUserId: user.id, category: "likes", text });
  return { path, store, user, note };
}
const said = (index) => ({ id: randomUUID(), role: "user", text: `第 ${index} 条`, createdAt: new Date(Date.UTC(2025, 0, 1) + index * 60000).toISOString() });

test("a transaction that throws leaves nothing behind, in memory or on disk", async (t) => {
  const { path, store, user, note } = await setup(t);
  const kept = note("喜欢喝咖啡");
  await store.createRelationshipRecord("memories", kept);
  await assert.rejects(store.transaction(`user:${user.id}`, async (tx) => {
    await tx.createRelationshipRecord("memories", note("不该留下"));
    await tx.updateRelationshipRecordForUser("memories", kept.id, user.id, (draft) => { draft.text = "改了一半"; draft.version += 1; });
    await tx.updateUserLanguage(user.id, "en");
    throw new Error("boom");
  }), /boom/);
  const texts = async (db) => (await db.listRelationshipRecordsForUser("memories", user.id)).map((record) => record.text);
  assert.deepEqual(await texts(store), ["喜欢喝咖啡"]);
  assert.equal((await store.getUserById(user.id)).language, undefined);
  const reopened = await createFileStore(path);
  assert.deepEqual(await texts(reopened), ["喜欢喝咖啡"]);
  assert.equal((await reopened.getUserById(user.id)).language, undefined);
});

test("what a caller gets back is a copy: changing it never changes the store", async (t) => {
  const { store, user, note } = await setup(t);
  const record = note("喜欢猫");
  await store.createRelationshipRecord("memories", record);
  const read = await store.getRelationshipRecordForUser("memories", record.id, user.id);
  read.text = "被调用方改了";
  (await store.getUserById(user.id)).name = "别人";
  assert.equal((await store.getRelationshipRecordForUser("memories", record.id, user.id)).text, "喜欢猫");
  assert.equal((await store.getUserById(user.id)).name, "Alex");
});

test("every change survives a restart, older conversation pages included and in order", async (t) => {
  const { path, store, user } = await setup(t);
  const thread = createRelationshipRecord({ relationshipId: null, userId: user.id, visibility: "private", aiAccessScope: "private", intentType: "assistant", language: "zh", timezone: "UTC", messages: [] });
  await store.createRelationshipRecord("privateAgentThreads", thread);
  for (let round = 0; round < 5; round += 1) {
    await store.transaction(`user:${user.id}`, (tx) => tx.updateRelationshipRecordForUser("privateAgentThreads", thread.id, user.id, (draft) => {
      keepMessages(draft, [...draft.messages, ...Array.from({ length: 80 }, (_, index) => said(round * 80 + index))]); draft.version += 1;
    }));
  }
  const before = await store.getRelationshipRecordForUser("privateAgentThreads", thread.id, user.id);
  assert.ok(before.earlier.length >= 2);
  await store.updateUserPassword(user.id, "changed");
  const reopened = await createFileStore(path);
  const after = await reopened.getRelationshipRecordForUser("privateAgentThreads", thread.id, user.id);
  assert.deepEqual(after.earlier.map((page) => page.messages.map((message) => message.text)), before.earlier.map((page) => page.messages.map((message) => message.text)));
  assert.deepEqual(after.messages.map((message) => message.text), before.messages.map((message) => message.text));
  assert.equal((await reopened.getUserById(user.id)).passwordHash, "changed");
  // After a restart the file on disk is whole by itself, for backups and tools that read it directly.
  const whole = JSON.parse(await readFile(path, "utf8"));
  assert.equal(whole.relationshipGraph.privateAgentThreads[thread.id].earlier.length, before.earlier.length);
});

test("a write cut off by a crash loses only that write; the store still opens", async (t) => {
  const { path, store, user, note } = await setup(t);
  await store.createRelationshipRecord("memories", note("第一条"));
  await store.createRelationshipRecord("memories", note("第二条"));
  // The store starts every write on a new line, so a cut-off one stands alone.
  const { journalGeneration } = JSON.parse(await readFile(path, "utf8"));
  await appendFile(`${path}.journal`, `\n{"g":${journalGeneration},"c":[["graph.memories","x",{"id":"x","te`);
  const reopened = await createFileStore(path);
  assert.deepEqual((await reopened.listRelationshipRecordsForUser("memories", user.id)).map((record) => record.text).sort(), ["第一条", "第二条"]);
});

test("the change log folds into the file once it grows, and a fold cut off halfway is not applied twice", async (t) => {
  const { path, store, user, note } = await setup(t, { foldBytes: 2000 });
  for (let index = 0; index < 30; index += 1) await store.createRelationshipRecord("memories", note(`第 ${index} 件`));
  assert.ok((await stat(`${path}.journal`).catch(() => ({ size: 0 }))).size < 4000, "the log was folded in");
  const whole = JSON.parse(await readFile(path, "utf8"));
  // A crash right after the new file landed but before the old log was cleared: its lines belong to an older fold.
  await appendFile(`${path}.journal`, `\n${JSON.stringify({ g: whole.journalGeneration - 1, c: [["users", user.id]] })}`);
  const reopened = await createFileStore(path);
  assert.equal((await reopened.listRelationshipRecordsForUser("memories", user.id)).length, 30);
  assert.ok(await reopened.getUserById(user.id), "an old fold's lines are ignored");
});

test("a file written before the change log opens as it is and keeps working", async (t) => {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "file-store-legacy-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const path = join(directory, "store.json");
  const userId = randomUUID();
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, JSON.stringify({ version: 4, users: { [userId]: { id: userId, email: "old@example.invalid", name: "Old", passwordHash: "x", createdAt: "2025-01-01T00:00:00Z" } }, userByEmail: { "old@example.invalid": userId }, relationshipGraph: {} }, null, 2));
  const store = await createFileStore(path);
  assert.equal((await store.getUserById(userId)).name, "Old");
  await store.updateUserLanguage(userId, "en");
  assert.equal((await (await createFileStore(path)).getUserById(userId)).language, "en");
});
