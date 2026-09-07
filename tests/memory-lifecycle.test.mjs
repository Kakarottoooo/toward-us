import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createFileStore } from "../server/store.mjs";
import { createMemoryRouter } from "../server/memory-router.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { buildMemoryContext } from "../server/memory-domain.mjs";

test("AI memory context uses only current consent and preserves verifiable references", () => {
  const base = { id: "m1", text: "Ask before making plans", relationshipId: "r1", ownerUserId: "a", visibility: "jointly_confirmed", aiAccessScope: "joint", status: "active", version: 2, memberUserIds: ["a", "b"], approvals: [{ userId: "a", version: 2 }, { userId: "b", version: 2 }], provenance: { source: "owner_confirmed_text" } };
  const records = [base, { ...base, id: "private", text: "PRIVATE_SECRET", visibility: "private", aiAccessScope: "private" }, { ...base, id: "old", approvals: [{ userId: "a", version: 1 }, { userId: "b", version: 1 }] }, { ...base, id: "withdrawn", withdrawnAt: new Date().toISOString() }, { ...base, id: "expired", expiresAt: "2020-01-01T00:00:00.000Z" }, { ...base, id: "other", relationshipId: "r2" }];
  const joint = buildMemoryContext(records, { userId: "a", relationshipId: "r1", scope: "joint" });
  assert.deepEqual(joint.memories.map((record) => record.id), ["m1"]);
  assert.equal(joint.references[0].version, 2);
  assert.equal(JSON.stringify(joint).includes("PRIVATE_SECRET"), false);
  assert.equal(buildMemoryContext(records, { userId: "outsider", relationshipId: "r1", scope: "joint" }).memories.length, 0);
  const own = buildMemoryContext([{ ...records[1], relationshipId: null }], { userId: "a", relationshipId: null, scope: "private" });
  assert.equal(own.memories[0].id, "private");
  assert.equal(buildMemoryContext(records, { userId: "b", relationshipId: "r1", scope: "private" }).memories.some((record) => record.id === "private"), false);
});

async function fixture(t) {
  const work = resolve("work"); await mkdir(work, { recursive: true });
  const directory = await mkdtemp(join(work, "memory-test-"));
  const store = await createFileStore(join(directory, "store.json"));
  for (const id of ["a", "b", "c", "d", "solo"]) await store.createUser({ id, name: id, email: `${id}@example.test` });
  for (const [id, a, b] of [["r1", "a", "b"], ["r2", "c", "d"]]) {
    await store.createInvitation({ relationship: { id, status: "pending" }, membership: { relationshipId: id, userId: a, role: "A" }, invitation: { code: id, relationshipId: id, createdByUserId: a, expiresAt: "2099-01-01T00:00:00.000Z" } });
    await store.acceptInvitation(id, b, new Date().toISOString());
  }
  const events = [];
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { const id = req.get("x-test-user"); if (id) req.auth = { user: { id, name: id } }; next(); });
  app.use("/api", createMemoryRouter({ store, emit: (...args) => events.push(args) }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  async function request(path, userId, method = "GET", body, expected = 200) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "content-type": "application/json", ...(userId ? { "x-test-user": userId } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const payload = response.status === 204 ? {} : await response.json();
    assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), `Expected ${expected}, received ${response.status}: ${JSON.stringify(payload)}`); return payload;
  }
  return { store, request, events };
}

test("unpaired memory is useful privately and another user cannot discover or mutate it", async (t) => {
  const { request, events } = await fixture(t);
  await request("/memories", null, "GET", null, 401);
  const { memory } = await request("/memories", "solo", "POST", { text: "I need quiet after work", allowPrivateAI: true }, 201);
  assert.equal(memory.relationshipId, null);
  assert.equal(memory.aiAccessScope, "private");
  assert.equal((await request("/memories", "solo")).memories[0].id, memory.id);
  assert.deepEqual((await request("/memories", "a")).memories, []);
  await request(`/memories/${memory.id}`, "a", "PATCH", { text: "overwrite", expectedVersion: 1 }, 404);
  await request(`/memories/${memory.id}/share-preview`, "solo", "POST", { text: "A sentence for us" }, 409);
  assert.equal(events.every((event) => event[2] === "solo"), true);
  await request(`/memories/${memory.id}`, "solo", "DELETE", { expectedVersion: 1 }, 204);
  assert.deepEqual((await request("/memories", "solo")).memories, []);
});

test("a reviewed share becomes a joint fact only after both approve the same version; correction and withdrawal invalidate AI use", async (t) => {
  const { store, request } = await fixture(t);
  const { memory: privateMemory } = await request("/memories", "a", "POST", { text: "PRIVATE_ORIGINAL: I am exhausted", allowPrivateAI: true }, 201);
  const sharedText = "Please ask before adding plans";
  const { preview } = await request(`/memories/${privateMemory.id}/share-preview`, "a", "POST", { text: sharedText });
  assert.deepEqual((await request("/memories", "b")).memories, []);
  await request(`/memories/${privateMemory.id}/share`, "a", "POST", { ...preview, text: "Changed after preview", confirm: true }, 409);
  const { memory } = await request(`/memories/${privateMemory.id}/share`, "a", "POST", { ...preview, confirm: true }, 201);
  assert.equal(memory.aiAccessScope, "none");
  const partnerList = await request("/memories", "b");
  assert.equal(partnerList.memories.length, 1);
  assert.equal(JSON.stringify(partnerList).includes("PRIVATE_ORIGINAL"), false);
  assert.equal(JSON.stringify(partnerList).includes(privateMemory.id), false);
  assert.equal((await request(`/memories/${privateMemory.id}/share`, "a", "POST", { ...preview, confirm: true }, 201)).memory.id, memory.id);
  await request(`/memories/${memory.id}/approve`, "c", "POST", { expectedVersion: 1, allowJointAI: true }, 404);
  await request(`/memories/${memory.id}/approve`, "a", "POST", { expectedVersion: 1, allowJointAI: true });
  let snapshot = await store.listRelationshipRecordsForUser("memories", "a");
  assert.equal(buildMemoryContext(snapshot, { userId: "a", relationshipId: "r1", scope: "joint" }).memories.length, 0);
  const approved = await request(`/memories/${memory.id}/approve`, "b", "POST", { expectedVersion: 1, allowJointAI: true });
  assert.equal(approved.memory.visibility, "jointly_confirmed");
  snapshot = await store.listRelationshipRecordsForUser("memories", "a");
  assert.equal(buildMemoryContext(snapshot, { userId: "a", relationshipId: "r1", scope: "joint" }).memories[0].text, sharedText);
  const corrected = await request(`/memories/${memory.id}`, "b", "PATCH", { expectedVersion: 1, text: "Ask before adding evening plans" });
  assert.equal(corrected.memory.version, 2); assert.equal(corrected.memory.approvals.length, 0); assert.equal(corrected.memory.aiAccessScope, "none");
  await request(`/memories/${memory.id}/approve`, "a", "POST", { expectedVersion: 1, allowJointAI: true }, 409);
  await Promise.all(["a", "b"].map((userId) => request(`/memories/${memory.id}/approve`, userId, "POST", { expectedVersion: 2, allowJointAI: true })));
  const withdrawn = await request(`/memories/${memory.id}/withdraw`, "b", "POST", { expectedVersion: 2 });
  assert.equal(withdrawn.memory.status, "withdrawn");
  snapshot = await store.listRelationshipRecordsForUser("memories", "a");
  assert.equal(buildMemoryContext(snapshot, { userId: "a", relationshipId: "r1", scope: "joint" }).memories.length, 0);
  assert.equal((await request("/memories", "a")).memories.some((item) => item.id === memory.id), true);
});

test("a low-mood checkin stays private; a voluntary share reveals only the reviewed sentence", async (t) => {
  const { request, events } = await fixture(t);
  const { checkin } = await request("/checkins", "a", "POST", { text: "PRIVATE_FEELING: Today was awful", mood: "low", kind: "checkin" }, 201);
  assert.equal(checkin.aiAccessScope, "none");
  assert.deepEqual((await request("/checkins", "b")).checkins, []);
  assert.equal(events.every((event) => event[2] === "a"), true);
  await request(`/checkins/${checkin.id}/share-preview`, "b", "POST", { text: "Tell me everything" }, 404);
  const { preview } = await request(`/checkins/${checkin.id}/share-preview`, "a", "POST", { text: "Thank you for making tea" });
  const shared = await request(`/checkins/${checkin.id}/share`, "a", "POST", { ...preview, confirm: true }, 201);
  const payload = await request("/checkins", "b");
  assert.equal(payload.checkins.length, 1); assert.equal(payload.checkins[0].text, preview.text);
  for (const secret of [checkin.id, "PRIVATE_FEELING", '"mood"', '"low"']) assert.equal(JSON.stringify(payload).includes(secret), false);
  assert.equal(shared.checkin.aiAccessScope, "none");
  await request(`/checkins/${checkin.id}`, "a", "DELETE", { expectedVersion: 1 }, 204);
  assert.equal((await request("/checkins", "b")).checkins.length, 1);
  assert.deepEqual((await request("/checkins", "c")).checkins, []);
});

test("review memories are explicitly selected from one's own actual response and private archival ends AI use", async (t) => {
  const { request, store } = await fixture(t);
  const response = createRelationshipRecord({ relationshipId: "r1", userId: "a", visibility: "private", aiAccessScope: "private", status: "submitted", outcomeId: "outcome-1", effective: "Fewer evening plans helped", ineffective: "Trying every day was exhausting", improvement: "worse" });
  await store.createRelationshipRecord("outcomeResponses", response);
  assert.deepEqual((await request("/memories/sources", "b")).sources, []);
  const sources = (await request("/memories/sources", "a")).sources;
  assert.equal(sources[0].id, response.id);
  await request("/memories", "b", "POST", { text: "Invent a positive result", source: sources[0] }, 404);
  await request("/memories", "a", "POST", { text: "stale", source: { ...sources[0], version: 9 } }, 404);
  const { memory } = await request("/memories", "a", "POST", { text: "A slower pace worked better for me", source: sources[0], allowPrivateAI: true }, 201);
  assert.equal(memory.provenance.sourceId, response.id);
  assert.equal(memory.provenance.sourceVersion, response.version);
  assert.equal((await request("/memories?q=slower", "a")).memories.length, 1);
  const archived = await request(`/memories/${memory.id}/archive`, "a", "POST", { expectedVersion: 1 });
  assert.equal(archived.memory.aiAccessScope, "none");
  assert.equal(buildMemoryContext(await store.listRelationshipRecordsForUser("memories", "a"), { userId: "a", relationshipId: "r1", scope: "private" }).memories.length, 0);
});

test("a concurrent correction cannot inherit approval of the previous text", async (t) => {
  const { request, store } = await fixture(t);
  const { memory: original } = await request("/memories", "a", "POST", { text: "Private original" }, 201);
  const { preview } = await request(`/memories/${original.id}/share-preview`, "a", "POST", { text: "One evening a week" });
  const { memory } = await request(`/memories/${original.id}/share`, "a", "POST", { ...preview, confirm: true }, 201);
  await request(`/memories/${memory.id}/approve`, "a", "POST", { expectedVersion: 1, allowJointAI: true });
  await Promise.all([
    request(`/memories/${memory.id}/approve`, "b", "POST", { expectedVersion: 1, allowJointAI: true }, [200, 409]),
    request(`/memories/${memory.id}`, "a", "PATCH", { expectedVersion: 1, text: "One evening a month" }),
  ]);
  const records = await store.listRelationshipRecordsForUser("memories", "a");
  const current = records.find((record) => record.id === memory.id);
  assert.equal(current.version, 2); assert.equal(current.aiAccessScope, "none"); assert.deepEqual(current.approvals, []);
  assert.equal(buildMemoryContext(records, { userId: "a", relationshipId: "r1", scope: "joint" }).memories.length, 0);
});
