import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiApp } from "../server/app.mjs";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord, HOME_RECENT_LIMIT } from "../server/relationship-domain.mjs";

// QA 11-22 finding 14: a couple with 501 consent events and 701 memories got ~1 MB on every shared-home load, because
// the home graph carried every record. Home now carries the newest few of what it never renders; the full lists stay
// on their own endpoints, for the owner only.
test("the shared home stays small with years of records; the full lists stay on their own endpoints, owner only", async () => {
  const directory = await mkdtemp(join(tmpdir(), "toward-home-payload-"));
  const store = await createFileStore(join(directory, "state.json"));
  const server = createApiApp({ store, mediator: { aiReady: false, model: "test" } }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = "GET", body, cookie } = {}) => {
    const response = await fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    return { status: response.status, bytes: Buffer.byteLength(text), body: text ? JSON.parse(text) : null, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  };
  try {
    const register = async (name) => (await request("/api/auth/register", { method: "POST", body: { name, adultConfirmed: true, email: `${name}-${Date.now()}@example.test`, password: "synthetic-test-password-26" } })).cookie;
    const a = await register("home-a"), b = await register("home-b");
    const invite = await request("/api/partner/invitations", { method: "POST", body: {}, cookie: a });
    assert.equal((await request("/api/partner/accept", { method: "POST", body: { code: invite.body.pairing.invitation.code }, cookie: b })).status, 200);
    const userId = (await request("/api/auth/me", { cookie: a })).body.user.id;
    const relationshipId = (await request("/api/relationship/home", { cookie: a })).body.relationship.id;
    const MEMORIES = 300, EVENTS = 250;
    const at = (index) => new Date(Date.UTC(2025, 0, 1) + index * 60000).toISOString();
    await store.transaction(`relationship:${relationshipId}`, async (tx) => {
      for (let index = 0; index < MEMORIES; index += 1) await tx.createRelationshipRecord("memories", { ...createRelationshipRecord({ relationshipId, userId, visibility: "private", aiAccessScope: "private", status: "active", kind: "moment", text: `A_PRIVATE_MEMORY_${index} we walked by the river and talked about the weekend.` }), createdAt: at(index), updatedAt: at(index) });
      for (let index = 0; index < EVENTS; index += 1) await tx.createRelationshipRecord("consentEvents", { ...createRelationshipRecord({ relationshipId, userId, visibility: "private", aiAccessScope: "none", status: "recorded", objectId: `A_PRIVATE_OBJECT_${index}`, objectType: "moment", eventType: "memory.created", sourceVersion: 1 }), createdAt: at(index), updatedAt: at(index) });
    });

    const homeA = await request("/api/relationship/home", { cookie: a });
    assert.equal(homeA.status, 200);
    assert.ok(homeA.bytes < 60_000, `home stays small, got ${homeA.bytes} bytes`);
    assert.equal(homeA.body.graph.memories.length, HOME_RECENT_LIMIT);
    assert.equal(homeA.body.graph.consentEvents.length, HOME_RECENT_LIMIT);
    assert.deepEqual([homeA.body.graphTotals.memories, homeA.body.graphTotals.consentEvents], [MEMORIES, EVENTS], "home still says how many there are");
    assert.ok(homeA.body.graph.memories.some((item) => item.text.startsWith(`A_PRIVATE_MEMORY_${MEMORIES - 1} `)), "the newest is kept");
    assert.ok(!homeA.body.graph.memories.some((item) => item.text.startsWith("A_PRIVATE_MEMORY_0 ")), "the oldest is left to /api/memories");
    for (const collection of ["milestones", "issues", "agreements", "commitments", "approvals", "outcomes", "outcomeResponses", "privateAgentThreads", "reminders", "notifications"]) assert.ok(Array.isArray(homeA.body.graph[collection]), `${collection} still present`);

    // On demand, the owner gets everything; the partner gets none of it, from home or from the lists.
    const listA = (await request("/api/memories", { cookie: a })).body.memories.filter((item) => item.text.startsWith("A_PRIVATE_MEMORY_"));
    assert.equal(listA.length, MEMORIES);
    const privacyA = (await request("/api/privacy", { cookie: a })).body.consentHistory.filter((item) => item.objectId.startsWith("A_PRIVATE_OBJECT_"));
    assert.equal(privacyA.length, 50); assert.equal(privacyA[0].objectId, `A_PRIVATE_OBJECT_${EVENTS - 1}`);
    const homeB = await request("/api/relationship/home", { cookie: b });
    assert.deepEqual([homeB.body.graphTotals.memories, homeB.body.graphTotals.consentEvents], [0, 0], "the partner's totals never count A's private records");
    for (const seen of [homeB.body, (await request("/api/memories", { cookie: b })).body, (await request("/api/privacy", { cookie: b })).body]) {
      assert.equal(JSON.stringify(seen).includes("A_PRIVATE_"), false);
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
