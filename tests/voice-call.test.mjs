import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createReminderService } from "../server/reminder-service.mjs";
import { createAssistantRouter } from "../server/assistant-router.mjs";
import { createTogetherRouter } from "../server/together-router.mjs";
import { createVoiceCallRouter, historyInput } from "../server/voice-call.mjs";

const SDP = "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n";

async function fixture(t, { configured = true, planner = () => ({ reply: "Saved it.", actions: [] }), shared = () => ({ reply: "I added it.", draftAgreement: null, actions: [] }) } = {}) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "voice-"));
  const store = await createFileStore(join(directory, "store.json"));
  const people = [{ id: randomUUID(), name: "Alex" }, { id: randomUUID(), name: "Blair" }, { id: randomUUID(), name: "Solo" }];
  for (const person of people) await store.createUser({ ...person, email: `${person.id}@example.invalid`, passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: people[0].id, role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: people[0].id, expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, people[1].id, new Date().toISOString());
  const provider = { configured, started: [], hungUp: [], async start(input) { this.started.push(input); return { providerId: `live_${this.started.length}`, sdp: "v=0\r\nanswer" }; }, async hangup(id) { this.hungUp.push(id); } };
  const mediator = { planAssistantTurn: async (context) => planner(context), continueTogether: async (context) => shared(context) };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { const person = people.find((item) => item.id === req.headers["x-user"]); if (person) req.auth = { user: person }; next(); });
  const assistant = createAssistantRouter({ store, mediator, reminderService: createReminderService({ store }) });
  app.use("/api", assistant);
  app.use("/api", createTogetherRouter({ store, mediator }));
  app.use("/api", createVoiceCallRouter({ store, mediator, assistant: assistant.assistant, provider }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); assert.ok(resolve(directory).startsWith(base)); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, method = "GET", body, userId = people[0].id) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const session = (await request("/assistant/sessions", "POST", { language: "en", timezone: "UTC" })).body.session;
  const start = (body, userId) => request("/voice/start", "POST", { sdp: SDP, requestId: randomUUID().replace(/-/g, ""), language: "en", ...body }, userId);
  return { people, provider, request, session, start };
}

test("a private call starts with the member's recent conversation, runs delegated requests like typed ones and keeps its captions privately", async (t) => {
  const f = await fixture(t);
  await f.request(`/assistant/sessions/${f.session.id}/messages`, "POST", { text: "I keep thinking about our fight", itemId: randomUUID() });
  const started = await f.start({ channel: "me", sessionId: f.session.id });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.sdp, "v=0\r\nanswer");
  assert.match(f.provider.started[0].instructions, /private relationship assistant/);
  assert.deepEqual(f.provider.started[0].input.map((item) => item.role), ["user", "assistant"]);
  const turn = await f.request("/voice/turn", "POST", { id: started.body.id, turnId: "d1", text: "Remember that I want to apologize first" });
  assert.equal(turn.status, 200, JSON.stringify(turn.body));
  assert.equal(turn.body.spoken, "这轮没有新增记录。");
  assert.equal((await f.request("/voice/turn", "POST", { id: started.body.id, turnId: "d1", text: "Remember that I want to apologize first" })).body.spoken, "这轮没有新增记录。", "a repeated delegation is answered once");
  assert.equal((await f.request("/voice/turn", "POST", { id: started.body.id, turnId: "d2", text: "x" }, f.people[1].id)).status, 404, "nobody else can act inside this call");
  assert.equal((await f.request("/voice/close", "POST", { id: started.body.id })).status, 200);
  assert.deepEqual(f.provider.hungUp, ["live_1"]);
  assert.equal((await f.request("/voice/transcript", "POST", { id: started.body.id, rows: [{ role: "user", text: "I want to apologize" }, { role: "agent", text: "That sounds brave." }] })).status, 200);
  const messages = (await f.request(`/assistant/sessions/${f.session.id}`)).body.session.messages;
  assert.deepEqual(messages.at(-1).call.rows.map((row) => row.text), ["I want to apologize", "That sounds brave."]);
  assert.equal((await f.request("/voice/turn", "POST", { id: started.body.id, turnId: "d3", text: "more" })).status, 409, "a closed call takes no more requests");
});

test("a call in Us mediates for everyone in the room, and its captions are saved where both partners can read them", async (t) => {
  const f = await fixture(t);
  const started = await f.start({ channel: "us" });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const instructions = f.provider.started[0].instructions;
  assert.match(instructions, /Alex and Blair/); assert.match(instructions, /ask each person to say their name/); assert.match(instructions, /never decide who is right/);
  assert.equal((await f.start({ channel: "us" }, f.people[1].id)).status, 409, "one call at a time per couple");
  const turn = await f.request("/voice/turn", "POST", { id: started.body.id, turnId: "d1", text: "add sunscreen to our packing list" });
  assert.equal(turn.body.spoken, "I added it.");
  await f.request("/voice/close", "POST", { id: started.body.id });
  await f.request("/voice/transcript", "POST", { id: started.body.id, rows: [{ role: "user", text: "I'm Alex" }, { role: "user", text: "I'm Blair" }, { role: "agent", text: "Thank you both." }] });
  const us = (await f.request("/together?language=en", "GET", null, f.people[1].id)).body.conversation.messages;
  const record = us.find((message) => message.kind === "call");
  assert.ok(record, "the partner sees the call");
  assert.equal(record.i18n.en, "Call with Pinky · 1 min");
  assert.deepEqual(record.call.rows.map((row) => row.text), ["I'm Alex", "I'm Blair", "Thank you both."]);
});

test("calls need a configured voice service, a valid offer, a couple for Us, and stay within the daily time", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("/voice/status")).body.configured, true);
  assert.equal((await f.request("/voice/start", "POST", { sdp: "nonsense", requestId: "r1", channel: "me", sessionId: f.session.id })).status, 400);
  assert.equal((await f.start({ channel: "us" }, f.people[2].id)).status, 409, "an unpaired member cannot call in Us");
  assert.equal((await f.start({ channel: "me", sessionId: f.session.id }, f.people[1].id)).status, 404, "a call cannot be started on someone else's private conversation");
  const off = await fixture(t, { configured: false });
  off.provider.start = async () => { throw Object.assign(new Error("voice_not_configured"), { statusCode: 503 }); };
  assert.equal((await off.request("/voice/status")).body.configured, false);
  assert.equal((await off.start({ channel: "me", sessionId: off.session.id })).status, 503);
});

test("the call starts from at most 20 recent messages within a size budget, speakers named", () => {
  const input = historyInput([...Array.from({ length: 25 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", text: `m${index}` })), { role: "member", text: "hi", from: "Blair" }]);
  assert.equal(input.length, 20);
  assert.deepEqual(input.at(-1), { type: "message", role: "user", content: [{ type: "input_text", text: "Blair: hi" }] });
  assert.equal(historyInput([{ role: "user", text: "x".repeat(2000) }, ...Array.from({ length: 6 }, () => ({ role: "user", text: "y".repeat(2000) }))]).length, 5);
});
