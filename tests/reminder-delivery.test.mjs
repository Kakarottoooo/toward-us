import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { validatePushSubscription } from "../server/push-delivery.mjs";
import { createReminderService, localDateTimeToInstant, nextWeeklyOccurrence } from "../server/reminder-service.mjs";
import { createReminderRouter } from "../server/reminder-router.mjs";

const subscription = (endpoint = "https://fcm.googleapis.com/fcm/send/test") => ({ endpoint, keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url") } });

test("push subscriptions accept known HTTPS push providers and reject SSRF targets", () => {
  assert.equal(validatePushSubscription(subscription()).endpoint, subscription().endpoint);
  for (const endpoint of ["http://fcm.googleapis.com/send/a", "https://127.0.0.1/a", "https://fcm.googleapis.com.evil.test/a", "https://user:secret@fcm.googleapis.com/a", "https://fcm.googleapis.com:8443/a", "https://example.com/a", "https://web.push.apple.com/a#fragment"]) {
    assert.throws(() => validatePushSubscription(subscription(endpoint)), /subscription/i);
  }
});

async function fixture(t, sendPush = async () => ({ statusCode: 201 })) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "reminders-"));
  t.after(async () => { assert.ok(resolve(directory).startsWith(`${base}\\`) || resolve(directory).startsWith(`${base}/`)); await rm(directory, { recursive: true, force: true }); });
  const store = await createFileStore(join(directory, "store.json"));
  const userId = randomUUID(); await store.createUser({ id: userId, email: `${userId}@example.invalid`, name: "Private person", createdAt: new Date().toISOString() });
  let time = new Date("2026-09-07T12:00:00Z");
  const sent = [];
  const service = createReminderService({ store, enabled: true, publicKey: "test-public", now: () => new Date(time), sendPush: async (...args) => { sent.push(args); return sendPush(...args); } });
  await service.updateSettings(userId, { enabled: true, timezone: "UTC", language: "en" });
  await service.subscribe(userId, subscription());
  const reminder = await service.createReminder(userId, { title: "PRIVATE birthday plan with Alice", localDateTime: "2026-09-07T12:01", timezone: "UTC", frequency: "once" });
  return { store, service, userId, reminder, sent, storePath: join(directory, "store.json"), advance: (value) => { time = new Date(value); } };
}

test("durable scheduler accepts each due occurrence once across repeated and concurrent runs", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.service.runDue()).claimed, 0);
  f.advance("2026-09-07T12:02Z");
  const results = await Promise.all([f.service.runDue(), f.service.runDue()]);
  assert.equal(results.reduce((sum, result) => sum + result.accepted, 0), 1);
  assert.equal((await f.service.runDue()).claimed, 0);
  assert.equal(f.sent.length, 1);
  assert.ok(!JSON.stringify(f.sent[0][1]).includes("PRIVATE"));
  assert.ok(!JSON.stringify(f.sent[0][1]).includes("Alice"));
  assert.equal(f.sent[0][1].url, `/?view=reminders&reminder=${f.reminder.id}`);
  const jobs = await f.store.listRecordsForJob("deliveryJobs");
  assert.equal(jobs[0].status, "accepted");
  assert.equal(jobs[0].attempts, 1);
  assert.ok(jobs[0].acceptedAt);
  const restartedStore = await createFileStore(f.storePath);
  const restarted = createReminderService({ store: restartedStore, enabled: true, now: () => new Date("2026-09-07T12:03Z"), sendPush: async () => assert.fail("restart must not send again") });
  assert.equal((await restarted.runDue()).claimed, 0);
});

test("a transient provider failure persists and retries without exposing provider data", async (t) => {
  let attempts = 0;
  const f = await fixture(t, async () => { attempts += 1; if (attempts === 1) throw Object.assign(new Error("PRIVATE provider URL or secret"), { statusCode: 503 }); return { statusCode: 201 }; });
  f.advance("2026-09-07T12:02Z");
  assert.equal((await f.service.runDue()).failed, 1);
  assert.equal((await f.service.runDue()).claimed, 0);
  const pending = await f.service.listReminders(f.userId);
  assert.equal(pending[0].deliveries[0].status, "retry");
  assert.equal(pending[0].deliveries[0].lastErrorCode, "provider_unavailable");
  assert.ok(!JSON.stringify(pending[0].deliveries).includes("PRIVATE"));
  f.advance("2026-09-07T12:05Z");
  assert.equal((await f.service.runDue()).accepted, 1);
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[0][1].tag, f.sent[1][1].tag, "stable tag coalesces retry notifications");
});

test("disabled reminders and revoked browser subscriptions stop delivery", async (t) => {
  const f = await fixture(t);
  await f.service.updateReminder(f.userId, f.reminder.id, { enabled: false });
  f.advance("2026-09-07T12:02Z");
  assert.equal((await f.service.runDue()).accepted, 0);
  await f.service.updateReminder(f.userId, f.reminder.id, { enabled: true });
  const [device] = (await f.service.getSettings(f.userId)).devices;
  await f.service.unsubscribe(f.userId, device.id);
  assert.equal((await f.service.runDue()).accepted, 0);
  assert.equal(f.sent.length, 0);
});

test("expired provider subscriptions fail honestly and need browser reconnection", async (t) => {
  let expired = true;
  const f = await fixture(t, async () => { if (expired) throw Object.assign(new Error("gone"), { statusCode: 410 }); return { statusCode: 201 }; });
  f.advance("2026-09-07T12:02Z");
  assert.equal((await f.service.runDue()).failed, 1);
  assert.equal((await f.service.getSettings(f.userId)).devices.length, 0);
  assert.equal((await f.service.listReminders(f.userId))[0].deliveries[0].status, "failed");
  await assert.rejects(() => f.service.retryReminder(f.userId, f.reminder.id), /Reconnect/);
  expired = false;
  await f.service.subscribe(f.userId, subscription("https://fcm.googleapis.com/fcm/send/reconnected"));
  assert.equal((await f.service.retryReminder(f.userId, f.reminder.id)).queued, 1);
  assert.equal((await f.service.runDue()).accepted, 1);
});

test("a live lease prevents another worker from sending and expired leases recover", async (t) => {
  let gate;
  const waiting = new Promise((resolve) => { gate = resolve; });
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  const f = await fixture(t, async () => { started(); await waiting; return { statusCode: 201 }; });
  f.advance("2026-09-07T12:02Z");
  const running = f.service.runDue(); await startedPromise;
  assert.equal((await f.service.runDue()).claimed, 0, "the lease is persisted before a slow provider request");
  gate(); await running;
  const [job] = await f.store.listRecordsForJob("deliveryJobs");
  await f.store.updateRelationshipRecordForUser("deliveryJobs", job.id, f.userId, (record) => { record.status = "processing"; record.leaseUntil = "2026-09-07T12:01:00Z"; record.leaseToken = "worker-that-crashed"; record.attempts = 1; record.acceptedAt = null; });
  assert.equal((await f.service.runDue()).accepted, 1, "abandoned processing recovers after its lease");
  assert.equal(f.sent[0][1].tag, f.sent[1][1].tag, "crash recovery uses a stable notification tag");
});

test("turning notifications off during a request does not falsely claim a provider receipt was cancelled", async (t) => {
  let release; const gate = new Promise((resolve) => { release = resolve; });
  let started; const start = new Promise((resolve) => { started = resolve; });
  const f = await fixture(t, async () => { started(); await gate; return { statusCode: 201 }; });
  f.advance("2026-09-07T12:02Z");
  const run = f.service.runDue(); await start;
  await f.service.updateSettings(f.userId, { enabled: false });
  release(); await run;
  assert.equal((await f.service.listReminders(f.userId))[0].deliveries[0].status, "accepted");
  assert.equal((await f.service.runDue()).accepted, 0);
});

test("an empty or non-success provider receipt never counts as accepted delivery", async (t) => {
  const f = await fixture(t, async () => ({}));
  f.advance("2026-09-07T12:02Z");
  const result = await f.service.runDue();
  assert.equal(result.accepted, 0);
  assert.equal(result.failed, 1);
});

test("reminder HTTP routes enforce owner identity and independent scheduler bearer authorization", async (t) => {
  const f = await fixture(t);
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { if (req.headers["x-test-user"]) req.auth = { user: { id: req.headers["x-test-user"] } }; next(); });
  f.service.internalSecret = "a-test-only-runner-token-at-least-32-characters";
  app.use("/api", createReminderRouter({ service: f.service }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  assert.equal((await fetch(`${base}/reminders`)).status, 401);
  assert.equal((await fetch(`${base}/reminders/${f.reminder.id}`, { method: "PATCH", headers: { "content-type": "application/json", "x-test-user": randomUUID() }, body: '{"enabled":false}' })).status, 404);
  assert.equal((await fetch(`${base}/internal/reminders/run`, { method: "POST" })).status, 401);
  assert.equal((await fetch(`${base}/internal/reminders/run`, { method: "POST", headers: { authorization: "Bearer wrong" } })).status, 401);
  const response = await fetch(`${base}/internal/reminders/run`, { method: "POST", headers: { authorization: `Bearer ${f.service.internalSecret}` } });
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(await response.json()).sort(), ["accepted", "cancelled", "claimed", "configured", "failed"]);
  const invalid = await fetch(`${base}/push-subscriptions`, { method: "POST", headers: { "content-type": "application/json", "x-test-user": f.userId }, body: JSON.stringify(subscription("https://127.0.0.1/private")) });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, "invalid_subscription");
});

test("personal reminders are owner-only and relation targets stop after relationship exit", async (t) => {
  const f = await fixture(t);
  const otherId = randomUUID(); await f.store.createUser({ id: otherId, email: `${otherId}@example.invalid`, name: "Other", createdAt: new Date().toISOString() });
  assert.deepEqual(await f.service.listReminders(otherId), []);
  await assert.rejects(() => f.service.updateReminder(otherId, f.reminder.id, { enabled: false }), /not found/);
  const relationshipId = randomUUID(); const code = "REMIND88";
  await f.store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { userId: f.userId, relationshipId, role: "A" }, invitation: { code, relationshipId, createdByUserId: f.userId, expiresAt: "2027-01-01T00:00:00Z" } });
  await f.store.acceptInvitation(code, otherId, "2026-09-07T12:00:00Z");
  const issue = createRelationshipRecord({ userId: f.userId, relationshipId, title: "PRIVATE issue" });
  await f.store.createRelationshipRecord("issues", issue);
  await f.service.createReminder(f.userId, { title: "PRIVATE follow-up", localDateTime: "2026-09-07T12:01", timezone: "UTC", target: { kind: "issue", id: issue.id } });
  await f.store.leaveRelationship(f.userId);
  f.advance("2026-09-07T12:02Z");
  await f.service.runDue();
  assert.equal(f.sent.length, 1, "only the independent personal reminder remains eligible");
  assert.equal(f.sent[0][1].url, `/?view=reminders&reminder=${f.reminder.id}`);
});

test("reminders preserve chosen local weekly time and define DST gaps and overlaps", () => {
  assert.equal(localDateTimeToInstant("2026-09-11T09:00", "America/Los_Angeles"), "2026-09-11T16:00:00.000Z");
  assert.equal(localDateTimeToInstant("2026-11-01T01:30", "America/Los_Angeles"), "2026-11-01T08:30:00.000Z", "first occurrence of ambiguous time");
  assert.throws(() => localDateTimeToInstant("2026-03-08T02:30", "America/Los_Angeles"), /does not exist/);
  assert.equal(nextWeeklyOccurrence("2026-03-01T10:30:00.000Z", "America/Los_Angeles", new Date("2026-03-01T10:30Z"), "02:30"), "2026-03-08T10:30:00.000Z", "weekly spring gap moves forward by the gap");
  assert.equal(nextWeeklyOccurrence("2026-10-25T16:00:00.000Z", "America/Los_Angeles", new Date("2026-10-25T16:00Z"), "09:00"), "2026-11-01T17:00:00.000Z");
  assert.throws(() => localDateTimeToInstant("2026-02-30T09:00", "UTC"), /date/);
  assert.throws(() => localDateTimeToInstant("2026-09-11T09:00", "Not/AZone"), /zone/);
});
