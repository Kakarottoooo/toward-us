import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { createPostgresStore } from "../server/postgres-store.mjs";
import { createApiApp } from "../server/app.mjs";
import { createReminderService } from "../server/reminder-service.mjs";
import { buildMemoryContext } from "../server/memory-domain.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";

// Explicit opt-in uses a local PostgreSQL server, never DATABASE_URL or production.
// Every fixture creates and drops its own randomly named database.
const configured = Boolean(process.env.POSTGRES_TEST_URL || process.env.POSTGRES_TEST_CONFIG);
const pgTest = configured ? test : test.skip;
async function connection() {
  if (process.env.POSTGRES_TEST_URL) return new URL(process.env.POSTGRES_TEST_URL);
  const config = JSON.parse((await readFile(process.env.POSTGRES_TEST_CONFIG, "utf8")).replace(/^\uFEFF/, ""));
  const url = new URL(`postgresql://localhost:${config.port}/${config.database || "postgres"}`);
  url.hostname = config.host; url.username = config.user; url.password = config.password; return url;
}

async function fixture(t, provider = async () => ({ statusCode: 201 })) {
  const base = await connection();
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname), "PostgreSQL tests only operate on a local temporary server");
  const admin = new Pool({ connectionString: base.href, ssl: false, connectionTimeoutMillis: 5000 });
  const database = `toward_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create database "${database}" template template0`);
  const databaseUrl = new URL(base); databaseUrl.hostname = "localhost"; databaseUrl.pathname = `/${database}`;
  let store;
  let server;
  t.after(async () => {
    try {
      if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
      await store?.close();
      // pg-pool can resolve end() before its clients finish their socket shutdown.
      // Wait for PostgreSQL to observe disconnection; FORCE would terminate those clients.
      const deadline = Date.now() + 5000;
      let remaining;
      do {
        remaining = (await admin.query("select count(*)::int as count from pg_stat_activity where datname=$1", [database])).rows[0].count;
        if (remaining === 0) break;
        await delay(20);
      } while (Date.now() < deadline);
      assert.equal(remaining, 0, "Temporary PostgreSQL database still has connections after pool shutdown");
      assert.match(database, /^toward_test_[a-f0-9]{32}$/);
      await admin.query(`drop database "${database}"`);
    } finally { await admin.end(); }
  });
  store = await createPostgresStore(databaseUrl.href);
  let clock = new Date("2026-09-07T12:00:00.000Z"); const sent = [];
  const reminderService = createReminderService({ store, enabled: true, publicKey: "synthetic-key", now: () => new Date(clock), sendPush: async (...args) => { sent.push(args); return provider(...args); } });
  const mediator = { aiReady: false, model: "contract-test", continuePrivateAgentThread: async ({ messages }) => ({ reply: "A private draft", readyToShare: true, source: "contract-test", draft: { title: "A small decision", shareableSummary: messages.at(-1).text, goal: "A private goal" } }) };
  const app = createApiApp({ store, mediator, reminderService });
  server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { actor, method = "GET", body, status = 200 } = {}) => {
    const response = await fetch(`${origin}/api${path}`, { method, headers: { ...(actor ? { cookie: actor.cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const result = response.status === 204 ? {} : await response.json();
    // Do not print bodies: recovery codes, cookies and provider subscriptions are sensitive.
    assert.ok((Array.isArray(status) ? status : [status]).includes(response.status), `${method} ${path}: expected HTTP ${status}, received ${response.status}`);
    return { ...result, responseStatus: response.status, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  };
  const register = async (name) => {
    const password = randomBytes(24).toString("base64url");
    const email = `${name}-${randomUUID()}@example.invalid`;
    const actor = await request("/auth/register", { method: "POST", body: { name, email, password }, status: 201 });
    return { ...actor, password, email };
  };
  const pair = async (a, b) => {
    const result = await request("/partner/invitations", { actor: a, method: "POST", body: {}, status: 201 });
    await request("/partner/accept", { actor: b, method: "POST", body: { code: result.pairing.invitation.code } });
    return result.pairing.id;
  };
  return { store, request, register, pair, reminderService, mediator, sent, setClock: (at) => { clock = new Date(at); } };
}

pgTest("PostgreSQL keeps unpaired records private and rolls back/serializes lifecycle transactions", async (t) => {
  const f = await fixture(t); const a = await f.register("solo-a"); const b = await f.register("solo-b");
  const { thread } = await f.request("/private-agent/threads", { actor: a, method: "POST", body: { intentType: "decision" }, status: 201 });
  assert.equal(thread.relationshipId, null);
  await f.request(`/private-agent/threads/${thread.id}/messages`, { actor: a, method: "POST", body: { text: "PRIVATE_UNPAIRED_THOUGHT" } });
  await f.request(`/private-agent/threads/${thread.id}`, { actor: b, status: 404 });
  assert.equal((await f.request("/private-agent/threads", { actor: b })).threads.length, 0);
  await f.store.updateRelationshipRecordForUser("privateAgentThreads", thread.id, a.user.id, (record) => { record.count = 0; });
  await assert.rejects(() => f.store.transaction(`user:${a.user.id}`, async (tx) => {
    await tx.updateRelationshipRecordForUser("privateAgentThreads", thread.id, a.user.id, (record) => { record.count = 99; });
    await tx.createRelationshipRecord("memories", createRelationshipRecord({ relationshipId: null, userId: a.user.id, visibility: "private", text: "ROLLED_BACK_MEMORY" }));
    throw new Error("rollback requested");
  }), /rollback requested/);
  assert.equal((await f.store.getRelationshipRecordForUser("privateAgentThreads", thread.id, a.user.id)).count, 0);
  assert.equal((await f.store.listRelationshipRecordsForUser("memories", a.user.id)).length, 0);
  await Promise.all(Array.from({ length: 8 }, () => f.store.transaction(`user:${a.user.id}`, async (tx) => {
    const previous = await tx.getRelationshipRecordForUser("privateAgentThreads", thread.id, a.user.id);
    await tx.updateRelationshipRecordForUser("privateAgentThreads", thread.id, a.user.id, (record) => { record.count = previous.count + 1; });
  })));
  assert.equal((await f.store.getRelationshipRecordForUser("privateAgentThreads", thread.id, a.user.id)).count, 8);
  assert.equal(await f.store.deleteRelationshipRecordForUser("privateAgentThreads", thread.id, b.user.id), false);
  await f.pair(a, b);
  await f.request(`/private-agent/threads/${thread.id}`, { actor: b, status: 404 });
  assert.equal(JSON.stringify(await f.request("/relationship/home", { actor: b })).includes("PRIVATE_UNPAIRED_THOUGHT"), false);
});

pgTest("PostgreSQL enforces explicit sharing, joint memory consent, relationship exit and private/account deletion", async (t) => {
  const f = await fixture(t); const a = await f.register("alice"); const b = await f.register("bob"); const c = await f.register("casey");
  const { thread } = await f.request("/private-agent/threads", { actor: a, method: "POST", body: { intentType: "decision" }, status: 201 });
  await f.request(`/private-agent/threads/${thread.id}/messages`, { actor: a, method: "POST", body: { text: "RAW_A_PRIVATE" } });
  await f.request(`/private-agent/threads/${thread.id}/share-decision`, { actor: a, method: "POST", body: {}, status: 409 });
  const relationshipId = await f.pair(a, b);
  const preview = await f.request(`/private-agent/threads/${thread.id}/share-preview`, { actor: a, method: "POST", body: { summary: "A reviewed sentence" } });
  const shared = await Promise.all([0, 1].map(() => f.request(`/private-agent/threads/${thread.id}/share-decision`, { actor: a, method: "POST", body: { ...preview.preview, digest: preview.digest, confirm: true }, status: [200, 201] })));
  assert.equal(shared[0].issue.id, shared[1].issue.id);
  const partnerHome = await f.request("/relationship/home", { actor: b });
  assert.equal(partnerHome.graph.issues.length, 1); assert.equal(JSON.stringify(partnerHome).includes("RAW_A_PRIVATE"), false);
  const { memory: privateMemory } = await f.request("/memories", { actor: a, method: "POST", body: { text: "PRIVATE_MEMORY_A", allowPrivateAI: true }, status: 201 });
  await f.request("/memories", { actor: b, method: "POST", body: { text: "PRIVATE_MEMORY_B" }, status: 201 });
  const memoryPreview = await f.request(`/memories/${privateMemory.id}/share-preview`, { actor: a, method: "POST", body: { text: "Ask before adding evening plans" } });
  const { memory } = await f.request(`/memories/${privateMemory.id}/share`, { actor: a, method: "POST", body: { ...memoryPreview.preview, confirm: true }, status: 201 });
  await f.request(`/memories/${memory.id}/approve`, { actor: c, method: "POST", body: { expectedVersion: 1, allowJointAI: true }, status: 404 });
  await Promise.all([a, b].map((actor) => f.request(`/memories/${memory.id}/approve`, { actor, method: "POST", body: { expectedVersion: 1, allowJointAI: true } })));
  const context = () => f.store.listRelationshipRecordsForUser("memories", a.user.id).then((records) => buildMemoryContext(records, { userId: a.user.id, relationshipId, scope: "joint" }));
  assert.equal((await context()).memories[0].text, "Ask before adding evening plans");
  await f.request(`/memories/${memory.id}`, { actor: b, method: "PATCH", body: { expectedVersion: 1, text: "Ask before adding any plans" } });
  assert.equal((await context()).memories.length, 0);
  await f.request(`/memories/${memory.id}/approve`, { actor: a, method: "POST", body: { expectedVersion: 1, allowJointAI: true }, status: 409 });
  await Promise.all([a, b].map((actor) => f.request(`/memories/${memory.id}/approve`, { actor, method: "POST", body: { expectedVersion: 2, allowJointAI: true } })));
  await f.request(`/memories/${memory.id}/withdraw`, { actor: b, method: "POST", body: { expectedVersion: 2 } });
  assert.equal((await context()).memories.length, 0);
  const { checkin } = await f.request("/checkins", { actor: a, method: "POST", body: { text: "PRIVATE_LOW_MOOD", mood: "low", kind: "checkin" }, status: 201 });
  assert.equal((await f.request("/checkins", { actor: b })).checkins.length, 0);
  const checkinPreview = await f.request(`/checkins/${checkin.id}/share-preview`, { actor: a, method: "POST", body: { text: "Thank you for listening" } });
  await f.request(`/checkins/${checkin.id}/share`, { actor: a, method: "POST", body: { ...checkinPreview.preview, confirm: true }, status: 201 });
  const partnerCheckins = await f.request("/checkins", { actor: b });
  assert.equal(partnerCheckins.checkins[0].text, "Thank you for listening");
  for (const secret of ["PRIVATE_LOW_MOOD", checkin.id, '"mood"']) assert.equal(JSON.stringify(partnerCheckins).includes(secret), false);
  const exported = await f.request("/privacy/export", { actor: a, method: "POST", body: { password: a.password } });
  assert.equal(JSON.stringify(exported).includes("PRIVATE_MEMORY_A"), true); assert.equal(JSON.stringify(exported).includes("PRIVATE_MEMORY_B"), false);
  await f.request("/privacy/leave", { actor: a, method: "POST", body: { password: a.password, confirm: true } });
  assert.equal((await f.request("/auth/me", { actor: b })).pairing, null);
  await f.request(`/issues/${shared[0].issue.id}`, { actor: a, status: 404 });
  await f.pair(a, c);
  assert.equal(JSON.stringify(await f.request("/relationship/home", { actor: c })).includes("A reviewed sentence"), false);
  await f.request("/privacy/delete-private", { actor: a, method: "POST", body: { password: a.password, confirm: true } });
  const retained = await f.request("/privacy/export", { actor: a, method: "POST", body: { password: a.password } });
  assert.equal(JSON.stringify(retained).includes("PRIVATE_MEMORY_A"), false); assert.equal(JSON.stringify(retained).includes("A reviewed sentence"), true);
  await f.request("/privacy/account", { actor: a, method: "DELETE", body: { password: a.password, confirm: true }, status: 204 });
  assert.equal((await f.request("/auth/me", { actor: a })).user, null);
  assert.equal((await f.request("/auth/me", { actor: c })).pairing, null);
  assert.equal(await f.store.getUserByEmail(a.email), null);
  assert.equal((await f.store.listRelationshipRecordsForUser("memories", b.user.id)).some((record) => record.text === "PRIVATE_MEMORY_B"), true);
});

pgTest("PostgreSQL reminders persist retries and prevent duplicate, revoked or post-exit delivery", async (t) => {
  let providerFails = true;
  const f = await fixture(t, async () => { if (providerFails) throw Object.assign(new Error("provider failure"), { statusCode: 503 }); return { statusCode: 201 }; });
  const a = await f.register("reminder-a"); const b = await f.register("reminder-b");
  await f.request("/reminder-settings", { actor: a, method: "PATCH", body: { enabled: true, timezone: "UTC" } });
  const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/synthetic-pg-test", keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: randomBytes(16).toString("base64url") } };
  await f.request("/push-subscriptions", { actor: a, method: "POST", body: subscription, status: 201 });
  const { reminder } = await f.request("/reminders", { actor: a, method: "POST", body: { title: "PRIVATE_REMINDER_TEXT", localDateTime: "2026-09-07T12:01", timezone: "UTC" }, status: 201 });
  assert.equal((await f.request("/reminders", { actor: b })).reminders.length, 0);
  f.setClock("2026-09-07T12:02Z");
  const runs = await Promise.all([f.reminderService.runDue(), f.reminderService.runDue()]);
  assert.equal(runs.reduce((count, result) => count + result.claimed, 0), 1);
  assert.equal((await f.request("/reminders", { actor: a })).reminders[0].deliveries[0].status, "retry");
  providerFails = false;
  await f.request(`/reminders/${reminder.id}/retry`, { actor: a, method: "POST", body: {} });
  assert.equal((await f.reminderService.runDue()).accepted, 1);
  assert.equal((await f.reminderService.runDue()).claimed, 0);
  assert.equal(JSON.stringify(f.sent.map((entry) => entry[1])).includes("PRIVATE_REMINDER_TEXT"), false);
  const relation = await f.pair(a, b);
  const issue = createRelationshipRecord({ relationshipId: relation, userId: a.user.id, title: "Synthetic follow-up" }); await f.store.createRelationshipRecord("issues", issue);
  await f.request("/reminders", { actor: a, method: "POST", body: { title: "Follow up", localDateTime: "2026-09-07T12:03", timezone: "UTC", target: { kind: "issue", id: issue.id } }, status: 201 });
  await f.request("/privacy/leave", { actor: a, method: "POST", body: { password: a.password, confirm: true } });
  f.setClock("2026-09-07T12:04Z");
  assert.equal((await f.reminderService.runDue()).accepted, 0);
  await f.request("/privacy/account", { actor: a, method: "DELETE", body: { password: a.password, confirm: true }, status: 204 });
  assert.equal((await f.store.listRecordsForJob("pushSubscriptions")).filter((record) => record.ownerUserId === a.user.id).length, 0);
  assert.equal((await f.reminderService.runDue()).accepted, 0);
});

pgTest("PostgreSQL account recovery consumes one code atomically and invalidates old sessions", async (t) => {
  const f = await fixture(t); const a = await f.register("recovery");
  const recovery = await f.request("/privacy/recovery-code", { actor: a, method: "POST", body: { password: a.password } });
  const newPassword = randomBytes(24).toString("base64url");
  const results = await Promise.all([0, 1].map(() => f.request("/auth/recover", { method: "POST", body: { email: a.email, recoveryCode: recovery.recoveryCode, password: newPassword }, status: [204, 401] })));
  assert.deepEqual(results.map((result) => result.responseStatus).sort(), [204, 401]);
  assert.equal((await f.request("/auth/me", { actor: a })).user, null);
  const login = await f.request("/auth/login", { method: "POST", body: { email: a.email, password: newPassword } });
  assert.equal(login.user.id, a.user.id);
  const exported = await f.request("/privacy/export", { actor: { ...a, cookie: login.cookie }, method: "POST", body: { password: newPassword } });
  assert.equal(JSON.stringify(exported).includes(recovery.recoveryCode), false); assert.equal(JSON.stringify(exported).includes("recoveryCodeHash"), false);
});


pgTest("PostgreSQL rejects an invitation whose relationship ended after the request started", async (t) => {
  const { store, register, request } = await fixture(t);
  const a = await register("late-invite-a"), b = await register("late-invite-b");
  const created = await request("/partner/invitations", { actor: a, method: "POST", body: {}, status: 201 });
  const startedAt = new Date(Date.now() - 1000).toISOString();
  await store.leaveRelationship(a.user.id);
  assert.equal(await store.acceptInvitation(created.pairing.invitation.code, b.user.id, startedAt), null);
  assert.equal(await store.getRelationshipContext(b.user.id), null);
});

pgTest("PostgreSQL commits an assistant turn once and rolls back the whole turn when a later action is unauthorized", async (t) => {
  const f = await fixture(t);
  const a = await f.register("voice-owner"), b = await f.register("voice-other");
  const fields = { title: null, text: null, localDateTime: null, timezone: null, frequency: null, date: null, mood: null };
  const action = (operation, kind, overrides = {}) => ({ operation, kind, targetId: null, expectedVersion: null, fields, query: null, queryPeriod: "all", occurrence: null, ...overrides });
  f.mediator.planAssistantTurn = async () => ({ reply: "", actions: [action("create", "reminder", { fields: { ...fields, title: "Synthetic voice reminder", localDateTime: "2026-09-11T20:00", timezone: "UTC", frequency: "weekly" } })] });
  const { session } = await f.request("/assistant/sessions", { actor: a, method: "POST", body: { language: "en", timezone: "UTC" }, status: 201 });
  const send = (body, status = 200) => f.request(`/assistant/sessions/${session.id}/messages`, { actor: a, method: "POST", body, status });
  const results = await Promise.all(Array.from({ length: 3 }, () => send({ text: "Create the synthetic reminder", itemId: "same-spoken-turn" })));
  assert.equal(new Set(results.map(result => result.session.messages.at(-1).cards[0].id)).size, 1);
  const { reminders } = await f.request("/reminders", { actor: a });
  assert.equal(reminders.length, 1);
  await f.request(`/assistant/sessions/${session.id}`, { actor: b, status: 404 });
  const other = await f.request("/memories", { actor: b, method: "POST", body: { text: "OTHER_OWNER_ONLY" }, status: 201 });
  f.mediator.planAssistantTurn = async () => ({ reply: "", actions: [
    action("update", "reminder", { targetId: reminders[0].id, expectedVersion: reminders[0].version, fields: { ...fields, title: "MUST_ROLL_BACK" } }),
    action("update", "memory", { targetId: other.memory.id, expectedVersion: other.memory.version, fields: { ...fields, text: "NOT_AUTHORIZED" } }),
  ] });
  await send({ text: "A two-step synthetic request", itemId: "rollback-turn" }, [403, 404]);
  const current = (await f.request("/reminders", { actor: a })).reminders[0];
  assert.equal(current.title, reminders[0].title);
  assert.equal(current.version, reminders[0].version);
  assert.equal((await f.request(`/assistant/sessions/${session.id}`, { actor: a })).session.messages.length, 2);
});
