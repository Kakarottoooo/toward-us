import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createReminderService } from "../server/reminder-service.mjs";
import { createAssistantRouter } from "../server/assistant-router.mjs";
import { createPrivateAgentRouter } from "../server/private-agent-router.mjs";
import { createMemoryRouter } from "../server/memory-router.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";

const fields = (patch = {}) => ({ title: null, text: null, localDateTime: null, timezone: null, frequency: null, date: null, mood: null, ...patch });
const action = (kind, operation, patch = {}) => ({ kind, operation, targetId: null, expectedVersion: null, fields: fields(), query: null, queryPeriod: "all", occurrence: null, ...patch });

async function fixture(t, planner) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "assistant-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const id of ids) await store.createUser({ id, email: `${id}@example.invalid`, name: "Synthetic person", passwordHash: "test", createdAt: new Date().toISOString() });
  const reminderService = createReminderService({ store, now: () => new Date("2026-09-08T10:00:00Z") });
  const calls = [];
  const mediator = { planAssistantTurn: async (...args) => { calls.push(args); return planner(...args); }, createRealtimeSession: async () => "v=0\r\n" };
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createAssistantRouter({ store, mediator, reminderService }));
  app.use("/api", createPrivateAgentRouter({ store, mediator }));
  app.use("/api", createMemoryRouter({ store }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); assert.ok(resolve(directory).startsWith(base)); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, method = "GET", body, userId = ids[0]) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { ...(userId ? { "x-user": userId } : {}), "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  const create = await request("/assistant/sessions", "POST", { language: "en", timezone: "UTC" });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  return { store, reminderService, ids, request, calls, session: create.body.session, storePath: join(directory, "store.json"), turn: (text, itemId = randomUUID()) => request(`/assistant/sessions/${create.body.session.id}/messages`, "POST", { text, itemId }) };
}

test("spoken reminder creation, continuation and cancellation update one durable private reminder", async (t) => {
  const f = await fixture(t, (context) => {
    const target = context.records.find((r) => r.kind === "reminder");
    const text = context.messages.at(-1).text;
    return { reply: "", actions: [text === "cancel it" ? action("reminder", "archive", { targetId: target.id, expectedVersion: target.version }) : text === "nine every week instead" ? action("reminder", "update", { targetId: target.id, expectedVersion: target.version, occurrence: "series", fields: fields({ localDateTime: "2026-09-11T21:00" }) }) : action("reminder", "create", { fields: fields({ title: "Weekly reflection", localDateTime: "2026-09-11T20:00", timezone: "UTC", frequency: "weekly" }) })] };
  });
  let response = await f.turn("Remind me Friday at eight every week", "speech-1"); assert.equal(response.status, 200);
  let cards = response.body.session.messages.at(-1).cards;
  assert.equal(cards[0].localDateTime, "2026-09-11T20:00"); assert.match(response.body.session.messages.at(-1).text, /2026-09-11.*20:00.*UTC/);
  response = await f.turn("nine every week instead"); assert.equal(response.status, 200); assert.equal(response.body.session.messages.at(-1).cards[0].localDateTime, "2026-09-11T21:00");
  response = await f.turn("cancel it"); assert.equal(response.status, 200); assert.equal(response.body.session.messages.at(-1).cards[0].status, "paused");
  const saved = await f.reminderService.listReminders(f.ids[0]); assert.equal(saved.length, 1); assert.equal(saved[0].status, "paused");
  const restarted = await createFileStore(f.storePath); assert.equal((await restarted.getRelationshipRecordForUser("privateAgentThreads", f.session.id, f.ids[0])).messages.length, 6);
});

test("private check-ins, memories and plan drafts use canonical records without granting AI or sharing", async (t) => {
  const f = await fixture(t, (context) => {
    const text = context.messages.at(-1).text;
    const [kind, operation] = text.split(" "); const current = context.records.find((r) => r.kind === kind);
    return { reply: "", actions: [action(kind, operation, { targetId: current?.id || null, expectedVersion: current?.version || null, fields: fields(kind === "plan" ? { title: "Walk together", text: "A quiet private plan", date: "2026-09-12" } : { text: operation === "update" ? "Actually I feel tired" : "Today felt easier", mood: kind === "checkin" ? "good" : null }) })] };
  });
  for (const kind of ["checkin", "memory", "plan"]) {
    const result = await f.turn(`${kind} create`); assert.equal(result.status, 200, JSON.stringify(result.body));
    const item = result.body.session.messages.at(-1).cards[0];
    assert.equal(item.kind, kind);
    if (kind === "plan") {
      const draft = (await f.request(`/private-agent/threads/${item.id}`)).body.thread;
      assert.equal(draft.intentType, "plan"); assert.equal(draft.status, "draft_ready"); assert.equal(draft.readyToShare, true); assert.equal(draft.sharedObjectId, undefined);
      assert.equal(draft.draft.date, "2026-09-12");
    } else {
      const records = (await f.request(`/${kind === "memory" ? "memories" : "checkins"}`)).body[kind === "memory" ? "memories" : "checkins"];
      assert.equal(records[0].text, "Today felt easier"); assert.equal(records[0].visibility, "private"); assert.equal(records[0].aiAccessScope, "none");
    }
    assert.equal((await f.turn(`${kind} update`)).status, 200);
    assert.equal((await f.turn(`${kind} archive`)).status, 200);
  }
});

test("assistant sessions cannot be viewed, shared or mutated through another user or the legacy private-agent routes", async (t) => {
  const f = await fixture(t, () => ({ reply: "What shall I help with?", actions: [] }));
  for (const suffix of ["", "/messages", "/transcripts", "/share-preview", "/apply-plan", "/share-decision"]) {
    const result = await f.request(`/private-agent/threads/${f.session.id}${suffix}`, suffix ? "POST" : "GET", suffix ? { text: "secret", itemId: "x", confirm: true, version: 1 } : undefined);
    assert.equal(result.status, 404, suffix);
  }
  assert.deepEqual((await f.request("/private-agent/threads")).body.threads, []);
  assert.equal((await f.request(`/assistant/sessions/${f.session.id}`, "GET", undefined, f.ids[1])).status, 404);
  assert.equal((await f.request(`/assistant/sessions/${f.session.id}/messages`, "POST", { text: "change", itemId: "x" }, f.ids[1])).status, 404);
  assert.equal((await f.request(`/assistant/sessions/${f.session.id}`, "GET", undefined, null)).status, 401);
});

test("queries show owned content without sending it to the model or retaining deleted record content in session cards", async (t) => {
  const f = await fixture(t, () => ({ reply: "", actions: [action("memory", "query")] }));
  const secret = "PRIVATE_UNAPPROVED_MEMORY_934"; const partnerSecret = "PARTNER_SECRET_123";
  const own = createRelationshipRecord({ relationshipId: null, userId: f.ids[0], visibility: "private", aiAccessScope: "none", text: secret, kind: "memory" });
  await f.store.createRelationshipRecord("memories", own);
  await f.store.createRelationshipRecord("memories", createRelationshipRecord({ relationshipId: null, userId: f.ids[1], visibility: "private", aiAccessScope: "none", text: partnerSecret, kind: "memory" }));
  const response = await f.turn("Find my memories"); assert.equal(response.status, 200); assert.equal(response.body.session.messages.at(-1).cards[0].text, secret);
  await f.turn("Show them again"); assert.ok(!JSON.stringify(f.calls).includes(secret)); assert.ok(!JSON.stringify(f.calls).includes(partnerSecret));
  const rawSession = await f.store.getRelationshipRecordForUser("privateAgentThreads", f.session.id, f.ids[0]); assert.ok(!JSON.stringify(rawSession).includes(secret));
  await f.store.deleteRelationshipRecordForUser("memories", own.id, f.ids[0]);
  const reread = await f.request(`/assistant/sessions/${f.session.id}`); assert.ok(!JSON.stringify(reread.body).includes(secret));
});

test("changing only this weekly occurrence preserves the original weekday and time for later reminders", async (t) => {
  const f = await fixture(t, (context) => {
    const current = context.records.find((record) => record.kind === "reminder");
    return { reply: "", actions: [context.messages.at(-1).text === "Rename it weekly chat" ? action("reminder", "update", { targetId: current.id, expectedVersion: current.version, fields: fields({ title: "Weekly chat" }) }) : current ? action("reminder", "update", { targetId: current.id, expectedVersion: current.version, occurrence: "once", fields: fields({ localDateTime: "2026-09-12T21:00" }) }) : action("reminder", "create", { fields: fields({ title: "Reflection", localDateTime: "2026-09-11T20:00", frequency: "weekly" }) })] };
  });
  await f.turn("Every Friday at eight"); const changed = await f.turn("Only this time, Saturday at nine");
  assert.equal(changed.status, 200); assert.match(changed.body.session.messages.at(-1).text, /only the next occurrence/i);
  assert.equal(changed.body.session.messages.at(-1).cards[0].nextOccurrenceOnly, true);
  assert.equal(changed.body.session.messages.at(-1).cards[0].weeklyTime, "20:00");
  const renamed = await f.turn("Rename it weekly chat"); assert.equal(renamed.status, 200); assert.equal(renamed.body.session.messages.at(-1).cards[0].title, "Weekly chat");
  const delivery = createReminderService({ store: f.store, enabled: true, now: () => new Date("2026-09-12T22:00Z"), sendPush: async () => ({ statusCode: 201 }) });
  await delivery.updateSettings(f.ids[0], { enabled: true, timezone: "UTC", language: "en" });
  await delivery.subscribe(f.ids[0], { endpoint: "https://fcm.googleapis.com/fcm/send/assistant-test", keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url") } });
  assert.equal((await delivery.runDue()).accepted, 1);
  const [reminder] = await delivery.listReminders(f.ids[0]); assert.equal(reminder.dueAt, "2026-09-18T20:00:00.000Z"); assert.equal(reminder.frequency, "weekly");
});

test("duplicate and concurrent transcript itemIds commit exactly once; a different concurrent turn conflicts", async (t) => {
  let release; let seen = 0; const ready = new Promise((resolve) => { release = resolve; });
  const f = await fixture(t, async () => { seen += 1; if (seen === 2) release(); await ready; return { reply: "", actions: [action("memory", "create", { fields: fields({ text: "A single saved thought" }) })] }; });
  const repeated = await Promise.all([f.turn("Save this thought", "same-id"), f.turn("Save this thought", "same-id")]);
  assert.deepEqual(repeated.map((r) => r.status), [200, 200]); assert.equal((await f.request("/memories")).body.memories.length, 1);
  assert.equal((await f.turn("Save this thought", "same-id")).status, 200); assert.equal(f.calls.length, 2);
  const concurrent = await Promise.all([f.turn("Save thought A", "a"), f.turn("Save thought B", "b")]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await f.request("/memories")).body.memories.length, 2);
});

test("stale targets and forbidden shared writes roll back the whole turn without a success receipt", async (t) => {
  let mode = "forbidden";
  const f = await fixture(t, (context) => ({ reply: "Done!", actions: mode === "forbidden" ? [action("memory", "create", { fields: fields({ text: "Must roll back" }) }), action("agreement", "create", { fields: fields({ title: "I approve for both" }) })] : [action("memory", "update", { targetId: context.records.find((r) => r.kind === "memory").id, expectedVersion: 10, fields: fields({ text: "Stale overwrite" }) })] }));
  let response = await f.turn("Approve for both and save", "forbidden"); assert.equal(response.status, 502); assert.deepEqual((await f.request("/memories")).body.memories, []);
  assert.deepEqual((await f.request(`/assistant/sessions/${f.session.id}`)).body.session.messages, []);
  await f.store.createRelationshipRecord("memories", createRelationshipRecord({ relationshipId: null, userId: f.ids[0], visibility: "private", text: "Original", kind: "memory" }));
  mode = "stale"; response = await f.turn("Change it"); assert.equal(response.status, 409); assert.equal((await f.request("/memories")).body.memories[0].text, "Original");
  assert.deepEqual((await f.request(`/assistant/sessions/${f.session.id}`)).body.session.messages, []);
});

test("model failure and account deletion during planning never perform a pending operation", async (t) => {
  let deleting = false; let f;
  f = await fixture(t, async () => {
    if (deleting) { await f.store.deleteAccount(f.ids[0]); return { reply: "Done", actions: [action("memory", "create", { fields: fields({ text: "Ghost memory" }) })] }; }
    throw new Error("PRIVATE_PROVIDER_ERROR");
  });
  let response = await f.turn("Save this"); assert.equal(response.status, 503); assert.ok(!JSON.stringify(response.body).includes("PRIVATE_PROVIDER_ERROR"));
  assert.deepEqual((await f.request("/memories")).body.memories, []);
  deleting = true; response = await f.turn("Save this"); assert.equal(response.status, 401); assert.deepEqual(await f.store.listRecordsForJob("memories"), []);
  assert.equal((await f.request(`/assistant/sessions/${f.session.id}`)).status, 401);
});

test("shared calendar queries filter the local week and lose access after relationship exit", async (t) => {
  const f = await fixture(t, () => ({ reply: "", actions: [action("milestone", "query", { queryPeriod: "this_week" })] }));
  const relationshipId = randomUUID();
  await f.store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: f.ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: f.ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await f.store.acceptInvitation(relationshipId, f.ids[1], new Date().toISOString());
  const today = new Date().toISOString().slice(0, 10); const later = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10);
  for (const [title, date] of [["A walk this week", today], ["A walk later", later]]) await f.store.createRelationshipRecord("milestones", createRelationshipRecord({ relationshipId, userId: f.ids[1], visibility: "shared", title, date, privateNotes: "PARTNER_PRIVATE_NOTES" }));
  const result = await f.turn("Show our calendar this week"); assert.equal(result.status, 200); assert.equal(result.body.session.messages.at(-1).cards.length, 1); assert.equal(result.body.session.messages.at(-1).cards[0].title, "A walk this week");
  assert.ok(!JSON.stringify(result.body).includes("PARTNER_PRIVATE_NOTES")); assert.ok(!JSON.stringify(f.calls).includes("A walk this week"));
  await f.store.leaveRelationship(f.ids[1]);
  const reread = await f.request(`/assistant/sessions/${f.session.id}`); assert.equal(reread.status, 200); assert.ok(!JSON.stringify(reread.body).includes("A walk this week"));
  assert.equal((await f.turn("Show our calendar this week")).body.session.messages.at(-1).cards.length, 0);
});

test("renaming an already delivered reminder does not requeue its occurrence", async (t) => {
  const f = await fixture(t, () => ({ reply: "", actions: [] }));
  let time = new Date("2026-09-08T10:00Z");
  const delivery = createReminderService({ store: f.store, enabled: true, now: () => time, sendPush: async () => ({ statusCode: 201 }) });
  await delivery.updateSettings(f.ids[0], { enabled: true, timezone: "UTC", language: "en" });
  await delivery.subscribe(f.ids[0], { endpoint: "https://fcm.googleapis.com/fcm/send/assistant-rename", keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url") } });
  const reminder = await delivery.createReminder(f.ids[0], { title: "Check-in", localDateTime: "2026-09-08T10:01", timezone: "UTC", frequency: "once" });
  time = new Date("2026-09-08T10:02Z"); assert.equal((await delivery.runDue()).accepted, 1);
  await delivery.updateReminder(f.ids[0], reminder.id, { title: "Daily check-in" });
  assert.equal((await delivery.runDue()).accepted, 0);
});
