import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { featuresUsed, notTriedYet } from "../server/discover.mjs";

test("主动展示功能: what each member has tried is read from what they did; the rest is offered, never 经期", async (t) => {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "discover-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const [index, id] of ids.entries()) await store.createUser({ id, email: `${id}@example.invalid`, name: ["Ziwei", "Mia"][index], passwordHash: "test", createdAt: new Date().toISOString() });
  const solo = await notTriedYet(store, ids[0], "me");
  assert.ok(solo.every((item) => ["letter", "profile", "photos", "reminder", "hard_words"].includes(item.feature)), "unpaired: only what works alone");
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());

  assert.deepEqual([...(await featuresUsed(store, ids[0])).used], [], "a new couple has tried nothing");
  const offered = await notTriedYet(store, ids[0], "us");
  assert.ok(offered.length > 0 && offered.every((item) => item.what && item.feature !== "cycle"));

  // Ziwei sends 想你了 and a game round happens in Us; Mia did not send the heart.
  await store.transaction(`relationship:${relationshipId}`, async (tx) => {
    await tx.createRelationshipRecord("togetherConversations", { id: `together:${relationshipId}`, relationshipId, ownerUserId: ids[0], createdByUserId: ids[0], visibility: "shared", status: "active", version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [
      { id: randomUUID(), role: "member", actorUserId: ids[0], kind: "nudge", text: "💗", createdAt: new Date().toISOString() },
      { id: randomUUID(), role: "agent", actorUserId: null, kind: "game", text: "?", createdAt: new Date().toISOString() },
    ] });
    await tx.createRelationshipRecord("checkins", createRelationshipRecord({ relationshipId: null, userId: ids[1], visibility: "private", aiAccessScope: "private", kind: "cycle", start: "2026-11-01", end: null }));
  });
  assert.deepEqual([...(await featuresUsed(store, ids[0])).used].sort(), ["games", "miss_you"]);
  assert.deepEqual([...(await featuresUsed(store, ids[1])).used].sort(), ["cycle", "games"], "each member's own: the heart was Ziwei's, the cycle Mia's");
  assert.ok(!(await notTriedYet(store, ids[0], "us")).some((item) => item.feature === "games"), "a game already played is not offered again");
});
