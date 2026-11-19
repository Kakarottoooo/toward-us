import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createReminderService } from "../server/reminder-service.mjs";
import { createAssistantRouter } from "../server/assistant-router.mjs";
import { createPrivacyRouter } from "../server/privacy-router.mjs";
import { createSuggestionsRouter } from "../server/suggestions-router.mjs";
import { createUsageRouter } from "../server/usage.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";

// Founder 11-07, "save time, not kill time": undo what Pinky made in one tap, say why it suggests something, show in one
// place what Pinky can see, let an agreement start in Just me, and count whether pushes are opened.
const fields = (patch = {}) => ({ title: null, text: null, localDateTime: null, timezone: null, frequency: null, date: null, mood: null, ...patch });
const action = (kind, operation, patch = {}) => ({ kind, operation, targetId: null, expectedVersion: null, fields: fields(), query: null, queryPeriod: "all", occurrence: null, ...patch });

async function fixture(t, { planner = () => ({ reply: "ok", actions: [] }), structured = null, paired = false } = {}) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "trust-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const [index, id] of ids.entries()) await store.createUser({ id, email: `${id}@example.invalid`, name: index ? "Mia" : "Ziwei", passwordHash: "test", createdAt: new Date().toISOString() });
  if (paired) {
    const relationshipId = randomUUID();
    await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: new Date(Date.now() + 86400000).toISOString() } });
    await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  }
  const reminderService = createReminderService({ store, now: () => new Date("2026-09-08T10:00:00Z") });
  const mediator = { planAssistantTurn: async (...args) => planner(...args), createRealtimeSession: async () => "v=0\r\n", ...(structured ? { structured } : {}) };
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use(createUsageRouter({ store }));
  app.use("/api", createAssistantRouter({ store, mediator, reminderService }));
  app.use("/api", createPrivacyRouter({ store }));
  app.use("/api", createSuggestionsRouter({ store, mediator }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  const request = async (path, method = "GET", body, userId = ids[0]) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path.startsWith("/api") ? "" : "/api"}${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  const session = (await request("/assistant/sessions", "POST", { language: "en", timezone: "UTC" })).body.session;
  const turn = (text) => request(`/assistant/sessions/${session.id}/messages`, "POST", { text, itemId: randomUUID() });
  return { store, ids, request, session, turn, reminderService };
}

test("one tap undoes a private record Pinky made: it is archived, the card says so, and only Pinky's own cards qualify", async (t) => {
  const f = await fixture(t, { planner: () => ({ reply: "", actions: [action("reminder", "create", { fields: fields({ title: "Call mom", localDateTime: "2026-09-11T20:00", timezone: "UTC", frequency: "once" }) })] }) });
  const card = (await f.turn("Remind me to call mom Friday at eight")).body.session.messages.at(-1).cards[0];
  assert.equal(card.kind, "reminder");
  assert.equal((await f.request(`/assistant/sessions/${f.session.id}/undo`, "POST", { cardId: card.id, kind: "agreement" })).status, 400, "only private kinds");
  assert.equal((await f.request(`/assistant/sessions/${f.session.id}/undo`, "POST", { cardId: randomUUID(), kind: "reminder" })).status, 404, "only cards Pinky made here");
  const undone = await f.request(`/assistant/sessions/${f.session.id}/undo`, "POST", { cardId: card.id, kind: "reminder" });
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  const shown = undone.body.session.messages.at(-1).cards[0];
  assert.equal(shown.status, "undone"); assert.match(shown.title, /Undone: Call mom/);
  assert.equal((await f.reminderService.listReminders(f.ids[0])).filter((item) => !item.archivedAt).length, 0, "the reminder is archived");
  assert.equal((await f.request(`/assistant/sessions/${f.session.id}/undo`, "POST", { cardId: card.id, kind: "reminder" })).status, 200, "a second tap is harmless");
});

test("an agreement can start in Just me: a card first, and only the member's confirmation drafts it in Us for both to approve", async (t) => {
  const f = await fixture(t, { paired: true, planner: () => ({ reply: "", actions: [action("agreement", "create", { fields: fields({ title: "Late? Say so first", text: "Text 15 minutes ahead；No shouting on the spot" }) })] }) });
  const card = (await f.turn("From now on if she's late she texts 15 minutes ahead and I don't shout on the spot")).body.session.messages.at(-1).cards[0];
  assert.equal(card.kind, "space_share"); assert.equal(card.shareKind, "agreement"); assert.equal(card.status, "draft");
  assert.equal((await f.store.listRelationshipRecordsForUser("agreements", f.ids[1])).length, 0, "nothing reaches the partner before the tap");
  const confirmed = await f.request(`/assistant/sessions/${f.session.id}/space-confirm`, "POST", { cardId: card.id, digest: card.digest });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.session.messages.at(-1).cards[0].status, "shared");
  const [agreement] = await f.store.listRelationshipRecordsForUser("agreements", f.ids[1]);
  assert.equal(agreement.status, "awaiting_approvals"); assert.deepEqual(agreement.terms, ["Text 15 minutes ahead", "No shouting on the spot"]);
  assert.deepEqual(agreement.approvedBy, [], "proposing is not agreeing: both still approve");
});

test("what Pinky can see: counts in one place, nothing of the content, and never the partner's private things", async (t) => {
  const f = await fixture(t, { paired: true });
  const context = await f.store.getRelationshipContext(f.ids[0]);
  const note = (userId, data) => createRelationshipRecord({ relationshipId: context.relationship.id, userId, visibility: "private", ...data });
  await f.store.createRelationshipRecord("memories", note(f.ids[0], { aiAccessScope: "private", status: "active", kind: "memory", text: "likes hotpot" }));
  await f.store.createRelationshipRecord("memories", note(f.ids[0], { aiAccessScope: "none", status: "active", kind: "memory", text: "off limits" }));
  await f.store.createRelationshipRecord("memories", note(f.ids[1], { aiAccessScope: "private", status: "active", kind: "memory", text: "Mia's secret" }));
  const access = await f.request("/privacy/ai-access");
  assert.equal(access.status, 200, JSON.stringify(access.body));
  assert.deepEqual(access.body.facts, { used: 1, off: 1, together: 0 }, "Mia's private memory is not counted for Ziwei");
  assert.equal(access.body.paired, true);
  assert.ok(!JSON.stringify(access.body).includes("hotpot"), "counts only");
});

test("pushes link back with from=push, and opening one is counted without content", async (t) => {
  const f = await fixture(t, { paired: true });
  const sent = [];
  const service = createReminderService({ store: f.store, sendNative: async (_token, payload) => { sent.push(payload); } });
  await service.registerNativeDevice(f.ids[1], { token: "fcm-token-mia-00001", platform: "ios" });
  await service.notifyMember(f.ids[1], { body: { zh: "轮到你了", en: "Your turn", es: "Te toca" }, url: "/?view=games", tag: "game:1" });
  assert.equal(sent[0].url, "/?view=games&from=push");
  assert.equal((await f.request("/api/usage/push-opened", "POST", undefined, f.ids[1])).status, 204);
  await new Promise((done) => setTimeout(done, 50));
  const events = (await f.store.listRelationshipRecordsForUser("productEvents", f.ids[1])).map((item) => item.action).sort();
  assert.deepEqual(events, ["push_opened", "push_sent"]);
});

test("each suggestion says in a few words why it was suggested", async (t) => {
  const f = await fixture(t, { structured: async () => ({ suggestions: [{ text: "Plan our anniversary", why: "Anniversary in 5 days" }, { text: "Note today's mood", why: "Just for you" }, { text: "Gift ideas", why: "Her birthday is close" }] }) });
  const first = await f.request("/suggestions?channel=me&language=en");
  assert.deepEqual(first.body.reasons, [], "the fixed set has no reasons");
  await new Promise((done) => setTimeout(done, 50));
  const next = await f.request("/suggestions?channel=me&language=en");
  assert.deepEqual(next.body.suggestions, ["Plan our anniversary", "Note today's mood", "Gift ideas"]);
  assert.deepEqual(next.body.reasons, ["Anniversary in 5 days", "Just for you", "Her birthday is close"]);
});

// App Store screenshots (11-12): English suggestions came with Chinese reasons under them. Whatever the model writes, an
// English or Spanish screen never shows Chinese: a reason in the wrong script is dropped, a suggestion in it is not used.
test("suggestions and their reasons never come in another script than the interface", async (t) => {
  const f = await fixture(t, { structured: async () => ({ suggestions: [{ text: "Plan our anniversary", why: "你们刚聊到周六的饭局" }, { text: "Note today's mood", why: "Just for you" }, { text: "Gift ideas", why: "生日快到了" }] }) });
  await f.request("/suggestions?channel=me&language=en");
  await new Promise((done) => setTimeout(done, 50));
  const next = await f.request("/suggestions?channel=me&language=en");
  assert.deepEqual(next.body.suggestions, ["Plan our anniversary", "Note today's mood", "Gift ideas"]);
  assert.deepEqual(next.body.reasons, ["", "Just for you", ""]);
  const g = await fixture(t, { structured: async () => ({ suggestions: [{ text: "帮我想个约会", why: "随便聊聊" }, { text: "Anota cómo me siento hoy", why: "Solo una idea" }, { text: "Ideas de regalo", why: "Cumpleaños pronto" }] }) });
  const fixed = await g.request("/suggestions?channel=me&language=es");
  await new Promise((done) => setTimeout(done, 50));
  const after = await g.request("/suggestions?channel=me&language=es");
  assert.deepEqual(after.body, fixed.body, "a set with a Chinese suggestion is not kept; the fixed Spanish set stays");
  assert.ok(!/[㐀-鿿]/.test(JSON.stringify(after.body)));
});
