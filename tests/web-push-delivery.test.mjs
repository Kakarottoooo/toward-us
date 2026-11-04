import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createFileStore } from "../server/store.mjs";
import { createReminderService } from "../server/reminder-service.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { ensureTogetherConversation } from "../server/together-domain.mjs";
import { createCoupleRituals } from "../server/couple-rituals.mjs";
import { createApiApp } from "../server/app.mjs";
import { aiUsageReport, guardMediator } from "../server/ai-budget.mjs";

// Web push (installed web app, no App Store) next to App push: every together notification and every daily question,
// celebration, shared date and due promise reaches both partners once, at a sensible local hour. Senders are fakes.
const subscription = (n) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/test-${n}`, keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, n)]).toString("base64url"), auth: Buffer.alloc(16, n).toString("base64url") } });

async function couple(t, { clock, native = true }) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "web-push-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await createFileStore(join(directory, "store.json"));
  const [a, b] = [randomUUID(), randomUUID()];
  for (const id of [a, b]) await store.createUser({ id, email: `${id}@example.invalid`, name: id === a ? "Alex" : "Blair", passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: a, role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: a, expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, b, new Date().toISOString());
  await store.transaction(`relationship:${relationshipId}`, (tx) => ensureTogetherConversation(tx, { relationshipId, userId: a }));
  // Who got what: one entry per device push, [member, channel].
  const sent = [], pending = [];
  const owner = { "fcm-token-alex-0001": "A", "fcm-token-blair-0002": "B" };
  const endpoints = new Map();
  const service = createReminderService({
    store, now: () => clock.now, enabled: true, publicKey: "test-public-key",
    sendNative: native ? async (token, payload) => { sent.push([owner[token], "native", payload.url]); } : null,
    sendPush: async (device, payload) => { if (clock.gone?.has(device.endpoint)) throw Object.assign(new Error("gone"), { statusCode: 410 }); sent.push([endpoints.get(device.endpoint), "web", payload.url]); return { statusCode: 201 }; },
    onAnnounce: (conversation) => { pending.push(service.notifyTogether(conversation)); },
  });
  const settle = async () => { while (pending.length) await pending.shift(); };
  const connectBrowser = async (userId, n, label) => { endpoints.set(subscription(n).endpoint, label); await service.updateSettings(userId, { enabled: true, timezone: "Asia/Shanghai", language: "en" }); return service.subscribe(userId, subscription(n)); };
  return { store, service, a, b, relationshipId, sent, pending, settle, connectBrowser };
}

const conversationOf = (store, relationshipId, userId) => store.getRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, userId);

test("browser subscriptions are saved per member, re-saved idempotently, moved on account switch and removed", async (t) => {
  const clock = { now: new Date("2099-12-01T04:00:00Z") };
  const { service, a, b } = await couple(t, { clock });
  const first = await service.subscribe(a, subscription(1));
  assert.deepEqual((await service.subscribe(a, subscription(1))).id, first.id, "the same browser saved again is the same device");
  assert.deepEqual((await service.getSettings(a)).devices.map((device) => device.id), [first.id]);
  // The same browser signs in as the partner: it must stop receiving Alex's pushes.
  const moved = await service.subscribe(b, subscription(1));
  assert.deepEqual((await service.getSettings(a)).devices, []);
  assert.deepEqual((await service.getSettings(b)).devices.map((device) => device.id), [moved.id]);
  await service.unsubscribe(b, moved.id);
  assert.deepEqual((await service.getSettings(b)).devices, []);
  await assert.rejects(service.unsubscribe(a, moved.id), (error) => error.statusCode === 404, "a member cannot remove the partner's browser");
  await assert.rejects(service.subscribe(a, { endpoint: "https://evil.example/push", keys: subscription(2).keys }), (error) => error.code === "invalid_subscription");
});

test("news in Us reaches App phones and installed web apps alike, once per member, never the author", async (t) => {
  const clock = { now: new Date("2099-12-01T04:00:00Z") };
  const { store, service, a, b, relationshipId, sent, connectBrowser } = await couple(t, { clock });
  await service.registerNativeDevice(a, { token: "fcm-token-alex-0001", platform: "android" });
  await service.registerNativeDevice(b, { token: "fcm-token-blair-0002", platform: "ios" });
  await connectBrowser(b, 2, "B");
  const conversation = await conversationOf(store, relationshipId, a);
  const message = (fields) => ({ id: randomUUID(), createdAt: new Date(Date.now() + 1000).toISOString(), refs: [], ...fields });
  conversation.messages.push(message({ role: "member", actorUserId: a, kind: "text", text: "hi" }));
  await service.notifyTogether(conversation);
  assert.deepEqual(sent.sort(), [["B", "native", "/?channel=us"], ["B", "web", "/?channel=us"]], "the partner's phone and web app, not the author");
  sent.length = 0;
  conversation.messages.push(message({ role: "member", actorUserId: a, kind: "text", text: "again" }));
  await service.notifyTogether(conversation);
  assert.deepEqual(sent, [], "one nudge per member per 10 minutes, across both channels");
  // A browser the push service forgot is disconnected instead of retried.
  clock.now = new Date("2099-12-01T04:20:00Z"); clock.gone = new Set([subscription(2).endpoint]);
  conversation.messages.push(message({ role: "member", actorUserId: a, kind: "text", text: "later" }));
  await service.notifyTogether(conversation);
  assert.deepEqual(sent, [["B", "native", "/?channel=us"]]);
  assert.deepEqual((await service.getSettings(b)).devices, []);
  assert.equal(await service.reachable(b), true, "still reachable on the phone");
  // "Turn off all reminder notifications" stops browser pushes too.
  await service.updateSettings(b, { enabled: false, timezone: "Asia/Shanghai" });
  assert.equal(await service.reachable(b), false);
});

test("a browser alone (no App, no FCM configured) gets together news, and only after its member turned notifications on", async (t) => {
  const clock = { now: new Date("2099-12-01T04:00:00Z") };
  const { store, service, a, b, relationshipId, sent, connectBrowser } = await couple(t, { clock, native: false });
  await service.subscribe(b, subscription(3));
  assert.equal(await service.reachable(b), false, "a saved subscription without the opt-in is not used");
  await connectBrowser(b, 3, "B");
  assert.equal(await service.reachable(b), true);
  const conversation = await conversationOf(store, relationshipId, a);
  conversation.messages.push({ id: randomUUID(), createdAt: new Date(Date.now() + 1000).toISOString(), role: "member", actorUserId: a, kind: "text", text: "hi", refs: [] });
  assert.equal((await service.notifyTogether(conversation)).sent, 1);
  assert.deepEqual(sent, [["B", "web", "/?channel=us"]]);
});

test("a shared date is announced at 09:00 in the couple's time zone and pushed to both, once (old 12:00 UTC stamps count)", async (t) => {
  const clock = { now: new Date("2099-12-25T00:59:00Z") };
  const { store, service, a, b, relationshipId, sent, settle, connectBrowser } = await couple(t, { clock });
  await service.updateNotify(a, { messages: true, timezone: "Asia/Shanghai" });
  await service.registerNativeDevice(a, { token: "fcm-token-alex-0001", platform: "android" });
  await connectBrowser(b, 4, "B");
  const milestone = createRelationshipRecord({ relationshipId, userId: a, visibility: "shared", aiAccessScope: "joint", title: "Anniversary", date: "2099-12-25", recurringRule: "yearly" });
  await store.createRelationshipRecord("milestones", milestone);
  await store.createRelationshipRecord("reminders", createRelationshipRecord({ relationshipId, userId: a, visibility: "shared", aiAccessScope: "joint", status: "active", milestoneId: milestone.id, minutesBefore: 0, channel: "in_app" }));
  await service.runDue(); await settle();
  assert.deepEqual(sent, [], "08:59 in Shanghai: not yet");
  clock.now = new Date("2099-12-25T01:00:00Z");
  await service.runDue(); await settle();
  assert.deepEqual(sent.sort(), [["A", "native", "/?channel=us"], ["B", "web", "/?channel=us"]], "09:00 in Shanghai: both partners");
  clock.now = new Date("2099-12-25T12:30:00Z"); sent.length = 0;
  await service.runDue(); await settle();
  assert.deepEqual(sent, [], "never twice, including at the old 12:00 UTC time");
  const announced = (await conversationOf(store, relationshipId, a)).messages.filter((message) => message.kind === "reminder");
  assert.equal(announced.length, 1);

  // A reminder stamped under the old 12:00 UTC rule is not announced again at the new local time.
  const other = createRelationshipRecord({ relationshipId, userId: a, visibility: "shared", aiAccessScope: "joint", title: "Birthday", date: "2099-12-26", recurringRule: "yearly" });
  await store.createRelationshipRecord("milestones", other);
  await store.createRelationshipRecord("reminders", createRelationshipRecord({ relationshipId, userId: a, visibility: "shared", aiAccessScope: "joint", status: "active", milestoneId: other.id, minutesBefore: 0, channel: "in_app", announcedAt: { "2099-12-26T12:00:00.000Z": "2099-12-26T12:00:05.000Z" } }));
  clock.now = new Date("2099-12-27T03:00:00Z");
  await service.runDue(); await settle();
  assert.equal((await conversationOf(store, relationshipId, a)).messages.filter((message) => message.kind === "reminder").length, 1);
});

test("a promise that comes due is pushed to both partners once, and not to a partner who turned reminders off", async (t) => {
  const clock = { now: new Date("2099-12-01T09:59:00Z") };
  const { store, service, a, b, relationshipId, sent, settle, connectBrowser } = await couple(t, { clock });
  await service.registerNativeDevice(a, { token: "fcm-token-alex-0001", platform: "android" });
  await connectBrowser(b, 5, "B");
  const promise = (description, dueAt) => createRelationshipRecord({ relationshipId, userId: a, visibility: "shared", aiAccessScope: "joint", status: "active", ownerType: "member_b", description, dueAt });
  await store.createRelationshipRecord("commitments", promise("book dinner", "2099-12-01T10:00:00.000Z"));
  await service.runDue(); await settle();
  assert.deepEqual(sent, []);
  clock.now = new Date("2099-12-01T10:00:00Z");
  await service.runDue(); await settle();
  assert.deepEqual(sent.sort(), [["A", "native", "/?channel=us"], ["B", "web", "/?channel=us"]]);
  sent.length = 0; clock.now = new Date("2099-12-01T10:30:00Z");
  await service.runDue(); await settle();
  assert.deepEqual(sent, [], "announced and pushed once");
  await service.updateNotify(b, { reminders: false });
  await store.createRelationshipRecord("commitments", promise("call mom", "2099-12-01T10:40:00.000Z"));
  clock.now = new Date("2099-12-01T10:45:00Z");
  await service.runDue(); await settle();
  assert.deepEqual(sent, [["A", "native", "/?channel=us"]], "Blair keeps reminders off");
});

test("the daily question and a celebration card start at a sensible local hour and reach both partners once", async (t) => {
  const clock = { now: new Date("2099-12-01T11:30:00Z") }; // 19:30 in Shanghai
  const { store, service, a, b, relationshipId, sent, pending, settle, connectBrowser } = await couple(t, { clock });
  await service.updateNotify(a, { messages: true, timezone: "Asia/Shanghai" });
  await service.registerNativeDevice(a, { token: "fcm-token-alex-0001", platform: "android" });
  await connectBrowser(b, 6, "B");
  // Day 100 together is 2099-12-01 in Shanghai.
  await store.createRelationshipRecord("milestones", createRelationshipRecord({ relationshipId, userId: a, visibility: "shared", aiAccessScope: "joint", type: "relationship_started", title: "Us", date: "2099-08-24", recurringRule: "yearly" }));
  const calls = [];
  const mediator = { structured: async ({ name }) => { calls.push(name); return name === "couple_recap" ? { title: "100 days", subtitle: "", coverPhotoId: null, stats: [], chapters: [{ heading: "Hello", text: "You two.", date: null, photoId: null }], closing: "More to come." } : { question: "What made you smile today?" }; } };
  const rituals = createCoupleRituals({ store, mediator, reachable: (userId) => service.reachable(userId), emit: (conversation) => { pending.push(service.notifyTogether(conversation)); }, now: () => clock.now });
  const posted = async (kind) => (await conversationOf(store, relationshipId, a)).messages.filter((message) => message.kind === kind);

  clock.now = new Date("2099-12-01T00:30:00Z"); // 08:30: too early for anything
  assert.equal((await rituals()).started, 0);
  clock.now = new Date("2099-12-01T01:30:00Z"); // 09:30: the celebration card
  assert.equal((await rituals()).started, 1); await settle();
  assert.equal((await posted("story")).length, 1);
  assert.deepEqual(sent.sort(), [["A", "native", "/?channel=us"], ["B", "web", "/?channel=us"]]);
  sent.length = 0;
  assert.equal((await rituals()).started, 0, "one card per occasion");
  clock.now = new Date("2099-12-01T11:30:00Z"); // 19:30: no question yet
  assert.equal((await rituals()).started, 0);
  clock.now = new Date("2099-12-01T12:05:00Z"); // 20:05: today's question
  assert.equal((await rituals()).started, 1); await settle();
  assert.deepEqual((await posted("daily_question")).map((message) => message.text), ["What made you smile today?"]);
  assert.deepEqual(sent.sort(), [["A", "native", "/?channel=us"], ["B", "web", "/?channel=us"]]);
  sent.length = 0;
  assert.equal((await rituals()).started, 0); await settle();
  assert.deepEqual(sent, [], "never twice the same day");
  assert.equal(calls.filter((name) => name === "couple_recap").length, 1);

  // Nobody answered: the next evening's question waits until one of them opens Us (no push, no model call)...
  const yesterday = (await posted("daily_question"))[0];
  await store.transaction(`relationship:${relationshipId}`, (tx) => tx.updateRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, a, (draft) => { draft.messages = draft.messages.map((item) => item.id === yesterday.id ? { ...item, createdAt: new Date(Date.now() - 25 * 3_600_000).toISOString() } : item); }));
  clock.now = new Date("2099-12-02T12:05:00Z");
  assert.equal((await rituals()).started, 0);
  // ...but once someone answered, the evening question comes back.
  const fresh = createCoupleRituals({ store, mediator, reachable: (userId) => service.reachable(userId), emit: (conversation) => { pending.push(service.notifyTogether(conversation)); }, now: () => clock.now });
  await store.transaction(`relationship:${relationshipId}`, (tx) => tx.updateRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, a, (draft) => { draft.messages = draft.messages.map((item) => item.id === yesterday.id ? { ...item, answers: { [b]: { text: "you", at: new Date().toISOString() } } } : item); }));
  clock.now = new Date("2099-12-02T12:25:00Z");
  assert.equal((await fresh()).started, 1); await settle();
  await new Promise((done) => setTimeout(done, 50)); // tomorrow's question is prepared in the background
});

test("model calls made on the tick go through the cost guard and count in the couple's background pool", async (t) => {
  const clock = { now: new Date("2099-12-01T12:05:00Z") }; // 20:05 in Shanghai
  const { store, service, a, relationshipId, pending, settle } = await couple(t, { clock });
  await service.updateNotify(a, { messages: true, timezone: "Asia/Shanghai" });
  await service.registerNativeDevice(a, { token: "fcm-token-alex-0001", platform: "android" });
  const mediator = guardMediator({ aiReady: true, model: "test", structured: async () => ({ question: "What made you smile today?" }) }, { store, now: () => clock.now });
  const rituals = createCoupleRituals({ store, mediator, reachable: (userId) => service.reachable(userId), emit: (conversation) => { pending.push(service.notifyTogether(conversation)); }, now: () => clock.now });
  assert.equal((await rituals()).started, 1); await settle();
  await new Promise((done) => setTimeout(done, 100)); // tomorrow's question is prepared in the background, also guarded
  const [usage] = await aiUsageReport(store, { now: clock.now });
  assert.equal(usage.relationshipId, relationshipId, "counted for the couple, not the anonymous demo allowance");
  assert.equal(usage.features.daily_question, 2, "today's question and tomorrow's prepared one");
});

test("a couple nobody can be pushed to, or whose time zone is unknown, is left to whoever opens Us", async (t) => {
  const clock = { now: new Date("2099-12-01T12:05:00Z") };
  const { store, service, a, relationshipId } = await couple(t, { clock });
  const mediator = { structured: async () => { throw new Error("must not be called"); } };
  const rituals = createCoupleRituals({ store, mediator, reachable: (userId) => service.reachable(userId), now: () => clock.now });
  assert.equal((await rituals()).started, 0, "no device: nothing scheduled");
  await service.registerNativeDevice(a, { token: "fcm-token-alex-0001", platform: "android" });
  assert.equal((await rituals()).started, 0, "no known time zone: nothing scheduled");
  assert.equal((await conversationOf(store, relationshipId, a)).messages.length, 0);
});

test("opening Us posts the daily question and pushes only the partner, not the one who opened it", async (t) => {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "web-push-app-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await createFileStore(join(directory, "store.json"));
  const sent = [];
  const service = createReminderService({ store, enabled: true, publicKey: "test-public-key", sendNative: async (token) => { sent.push(["native", token]); }, sendPush: async (device) => { sent.push(["web", device.endpoint]); return { statusCode: 201 }; } });
  const server = createApiApp({ store, mediator: { aiReady: false, model: "test" }, reminderService: service }).listen(0, "127.0.0.1");
  await new Promise((done) => server.once("listening", done));
  t.after(() => new Promise((done) => { server.closeAllConnections(); server.close(done); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = "GET", body, cookie } = {}) => {
    const response = await fetch(origin + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: response.status === 204 ? null : await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
  };
  const register = async (name) => (await request("/api/auth/register", { method: "POST", body: { name, email: `${name}-${randomUUID()}@example.test`, password: "synthetic-test-password-26" } })).cookie;
  const a = await register("push-a"), b = await register("push-b");
  const invite = await request("/api/partner/invitations", { method: "POST", body: {}, cookie: a });
  await request("/api/partner/accept", { method: "POST", body: { code: invite.body.pairing.invitation.code }, cookie: b });
  // Each member connects this browser over HTTP: saved, listed, and removable.
  for (const [cookie, n] of [[a, 7], [b, 8]]) {
    assert.equal((await request("/api/reminder-settings", { method: "PATCH", body: { enabled: true, timezone: "Asia/Shanghai", language: "en" }, cookie })).status, 200);
    assert.equal((await request("/api/push-subscriptions", { method: "POST", body: subscription(n), cookie })).status, 201);
  }
  const removable = await request("/api/push-subscriptions", { method: "POST", body: subscription(9), cookie: a });
  assert.equal((await request("/api/reminder-settings", { cookie: a })).body.devices.length, 2);
  assert.equal((await request(`/api/push-subscriptions/${removable.body.id}`, { method: "DELETE", cookie: a })).status, 200);
  assert.equal((await request("/api/reminder-settings", { cookie: a })).body.devices.length, 1);

  assert.equal((await request("/api/together?timezone=Asia/Shanghai&language=en", { cookie: a })).status, 200);
  for (let i = 0; i < 100 && !sent.length; i += 1) await new Promise((done) => setTimeout(done, 20));
  await new Promise((done) => setTimeout(done, 50));
  assert.deepEqual(sent, [["web", subscription(8).endpoint]], "only the partner who did not open Us");
});
