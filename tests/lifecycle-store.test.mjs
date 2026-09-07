import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";

test("personal records stay owner-only before and after pairing; transactions roll back and serialize", async () => {
  const base = resolve(process.env.TEMP || "work");
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(resolve(base, "toward-store-"));
  const store = await createFileStore(resolve(directory, "store.json"));
  try {
    await store.createUser({ id: "a", email: "a@example.test", name: "A", passwordHash: "unused", createdAt: new Date().toISOString() });
    await store.createUser({ id: "b", email: "b@example.test", name: "B", passwordHash: "unused", createdAt: new Date().toISOString() });
    const thread = createRelationshipRecord({ relationshipId: null, userId: "a", visibility: "private", aiAccessScope: "private", messages: [], count: 0 });
    await store.createRelationshipRecord("privateAgentThreads", thread);
    assert.equal((await store.getRelationshipRecordForUser("privateAgentThreads", thread.id, "a")).id, thread.id);
    assert.equal(await store.getRelationshipRecordForUser("privateAgentThreads", thread.id, "b"), null);
    assert.equal((await store.listRelationshipRecordsForUser("privateAgentThreads", "b")).length, 0);
    await assert.rejects(store.transaction("user:a", async (tx) => {
      await tx.updateRelationshipRecordForUser("privateAgentThreads", thread.id, "a", (record) => { record.count = 99; });
      throw new Error("rollback requested");
    }), /rollback requested/);
    assert.equal((await store.getRelationshipRecordForUser("privateAgentThreads", thread.id, "a")).count, 0);
    await Promise.all(Array.from({ length: 8 }, () => store.transaction("user:a", async (tx) => {
      const previous = await tx.getRelationshipRecordForUser("privateAgentThreads", thread.id, "a");
      await tx.updateRelationshipRecordForUser("privateAgentThreads", thread.id, "a", (record) => { record.count = previous.count + 1; });
    })));
    assert.equal((await store.getRelationshipRecordForUser("privateAgentThreads", thread.id, "a")).count, 8);
    await assert.rejects(store.createRelationshipRecord("privateAgentThreads", thread), (error) => error.code === "23505");
    assert.equal(await store.deleteRelationshipRecordForUser("privateAgentThreads", thread.id, "b"), false);
    assert.equal(await store.deleteRelationshipRecordForUser("privateAgentThreads", thread.id, "a"), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
