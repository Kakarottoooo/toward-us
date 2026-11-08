import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createReminderService } from "../server/reminder-service.mjs";
import { createAssistantRouter } from "../server/assistant-router.mjs";
import { createVoiceCallRouter } from "../server/voice-call.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { featuresUsed } from "../server/discover.mjs";
import { profileContext } from "../server/profile.mjs";

// Founder 11-07, after looking at Known: Pinky asks each member privately how a date went (one tap, kept in About us), and a
// few-minute private voice interview lets Pinky get to know a member from day one.
const SDP = "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n";
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function fixture(t, { structured = null } = {}) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "known-"));
  const store = await createFileStore(join(directory, "store.json"));
  const people = [{ id: randomUUID(), name: "Ziwei" }, { id: randomUUID(), name: "Mia" }, { id: randomUUID(), name: "Solo" }];
  for (const person of people) await store.createUser({ ...person, email: `${person.id}@example.invalid`, passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: people[0].id, role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: people[0].id, expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, people[1].id, new Date().toISOString());
  const provider = { configured: true, started: [], async start(input) { this.started.push(input); return { providerId: `live_${this.started.length}`, sdp: "v=0\r\nanswer" }; }, async hangup() {} };
  const mediator = { planAssistantTurn: async () => ({ reply: "ok", actions: [] }), ...(structured ? { structured } : {}) };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { const person = people.find((item) => item.id === req.headers["x-user"]); if (person) req.auth = { user: person }; next(); });
  const assistant = createAssistantRouter({ store, mediator, reminderService: createReminderService({ store }) });
  app.use("/api", assistant);
  app.use("/api", createVoiceCallRouter({ store, mediator, assistant: assistant.assistant, provider }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  const request = async (path, method = "GET", body, userId = people[0].id) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const sessionFor = async (userId, language = "en") => (await request("/assistant/sessions", "POST", { language, timezone: "UTC" }, userId)).body.session;
  const plan = (patch) => store.transaction(`relationship:${relationshipId}`, (tx) => tx.createRelationshipRecord("milestones", createRelationshipRecord({ relationshipId, userId: people[0].id, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "active", type: "custom", timezone: "UTC", recurringRule: "once", jointlyConfirmed: false, notes: "", provenanceSource: "member_confirmed", ...patch })));
  return { store, people, relationshipId, provider, request, sessionFor, plan };
}

test("the day after a date, each member is asked privately how it went; one tap keeps it as their own note", async (t) => {
  const f = await fixture(t);
  await f.plan({ title: "19:00 Hotpot at Haidilao", date: day(-1) });
  await f.plan({ title: "Watch Dune", date: day(-1), notes: "watch:Dune" });
  await f.plan({ title: "Anniversary", date: day(-1), recurringRule: "yearly" });
  await f.plan({ title: "Picnic", date: day(1) });
  const mine = await f.sessionFor(f.people[0].id);
  const opened = (await f.request(`/assistant/sessions/${mine.id}?opened=1`)).body.session;
  const question = opened.messages.at(-1);
  assert.deepEqual(question.dateCheck, { title: "Hotpot at Haidilao", date: day(-1) }, "only the one-off date, not the watch plan, the anniversary or tomorrow's picnic");
  assert.match(question.text, /How was "Hotpot at Haidilao" with Mia yesterday\?/);
  const again = (await f.request(`/assistant/sessions/${mine.id}?opened=1`)).body.session;
  assert.equal(again.messages.length, opened.messages.length, "asked once, and no second Pinky question the same day");

  // Mia is asked in her own conversation; Ziwei's question never shows there.
  const hers = await f.sessionFor(f.people[1].id, "zh");
  const herQuestion = (await f.request(`/assistant/sessions/${hers.id}?opened=1`, "GET", undefined, f.people[1].id)).body.session.messages.at(-1);
  assert.match(herQuestion.text, /昨天和 Ziwei 的「Hotpot at Haidilao」怎么样？/);

  assert.equal((await f.request(`/assistant/sessions/${mine.id}/date-check`, "POST", { messageId: question.id, rating: "wow" })).status, 400);
  assert.equal((await f.request(`/assistant/sessions/${mine.id}/date-check`, "POST", { messageId: question.id, told: true })).status, 409, "tell them only after a happy answer");
  const answered = await f.request(`/assistant/sessions/${mine.id}/date-check`, "POST", { messageId: question.id, rating: "great" });
  assert.equal(answered.status, 200, JSON.stringify(answered.body));
  const messages = answered.body.session.messages;
  assert.deepEqual(messages.find((item) => item.id === question.id).dateAnswer, { rating: "great", told: false });
  assert.equal(messages.at(-1).kind, "noted"); assert.match(messages.at(-1).text, /Kept in About us: Date "Hotpot at Haidilao": loved it/);
  const facts = (await f.store.listRelationshipRecordsForUser("memories", f.people[0].id)).filter((item) => item.kind === "profile");
  assert.equal(facts.length, 1); assert.equal(facts[0].visibility, "private"); assert.equal(facts[0].ownerUserId, f.people[0].id); assert.equal(facts[0].category, "likes");
  const hersKnown = await profileContext(f.store, f.people[1].id), mineKnown = await profileContext(f.store, f.people[0].id);
  assert.deepEqual([...hersKnown.me, ...hersKnown.partner, ...hersKnown.us], [], "Mia's Pinky never sees Ziwei's note");
  assert.deepEqual(mineKnown.us.map((item) => item.fact), ['Date "Hotpot at Haidilao": loved it'], "Ziwei's Pinky uses it for ideas");
  const twice = await f.request(`/assistant/sessions/${mine.id}/date-check`, "POST", { messageId: question.id, rating: "meh" });
  assert.equal(twice.body.session.messages.length, messages.length, "answered once");
  const told = await f.request(`/assistant/sessions/${mine.id}/date-check`, "POST", { messageId: question.id, told: true });
  assert.equal(told.body.session.messages.find((item) => item.id === question.id).dateAnswer.told, true);
  assert.equal((await f.request(`/assistant/sessions/${mine.id}/date-check`, "POST", { messageId: question.id, rating: "great" }, f.people[1].id)).status, 404, "nobody else answers in this conversation");
});

test("a private interview call: Pinky leads, needs a partner, and keeps what the member said as their own notes", async (t) => {
  let seen = null;
  const structured = async ({ name, input, instructions }) => {
    assert.equal(name, "couple_profile"); assert.match(instructions, /getting-to-know-you voice interview/);
    seen = JSON.parse(input);
    const answer = seen.messages.find((line) => line.from === "A" && /comfort/.test(line.text));
    const question = seen.messages.find((line) => line.from === "Pinky");
    return { facts: [
      { messageId: answer.id, quote: "a hug and some quiet", subject: "A", category: "traits", fact: "wants a hug and some quiet when upset", replaces: "" },
      { messageId: answer.id, quote: "Mia loves night markets", subject: "B", category: "likes", fact: "loves night markets", replaces: "" },
      { messageId: question.id, quote: "how do you like to be comforted", subject: "A", category: "traits", fact: "made up from the question", replaces: "" },
    ] };
  };
  const f = await fixture(t, { structured });
  const session = await f.sessionFor(f.people[0].id);
  const start = (userId, sessionId) => f.request("/voice/start", "POST", { sdp: SDP, requestId: randomUUID().replace(/-/g, ""), language: "en", channel: "me", sessionId, mode: "interview" }, userId);
  const solo = await f.sessionFor(f.people[2].id);
  assert.equal((await start(f.people[2].id, solo.id)).status, 409, "the interview needs a partner: notes are kept per couple");
  const started = await start(f.people[0].id, session.id);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const live = f.provider.started.at(-1);
  assert.match(live.instructions, /get to know Ziwei/); assert.match(live.instructions, /about five minutes/); assert.match(live.instructions, /share with Mia/);
  assert.deepEqual(live.input, [], "it starts fresh, without the chat's history");
  await f.request("/voice/close", "POST", { id: started.body.id });
  assert.equal((await featuresUsed(f.store, f.people[0].id)).used.has("interview"), false);
  const rows = [{ role: "agent", text: "Hi Ziwei! How do you like to be comforted?" }, { role: "user", text: "When I'm upset I need a hug and some quiet. Oh and Mia loves night markets. That helps comfort me too." }];
  assert.equal((await f.request("/voice/transcript", "POST", { id: started.body.id, rows })).status, 200);
  let messages = [];
  for (let attempt = 0; attempt < 40 && messages.at(-1)?.kind !== "noted"; attempt += 1) { await new Promise((r) => setTimeout(r, 50)); messages = (await f.request(`/assistant/sessions/${session.id}`)).body.session.messages; }
  assert.equal(messages.at(-2).call.interview, true);
  assert.equal(messages.at(-1).kind, "noted");
  assert.match(messages.at(-1).text, /you: wants a hug and some quiet when upset; Mia: loves night markets/);
  assert.match(messages.at(-1).text, /Only you see these; tap here to choose any to share with Mia/);
  assert.equal(seen.messages[0].isNew, false, "Pinky's question is context only");
  const facts = (await f.store.listRelationshipRecordsForUser("memories", f.people[0].id)).filter((item) => item.kind === "profile");
  assert.deepEqual(facts.map((item) => item.text).sort(), ["loves night markets", "wants a hug and some quiet when upset"], "a fact quoting Pinky's own question is dropped");
  assert.ok(facts.every((item) => item.visibility === "private" && item.ownerUserId === f.people[0].id));
  assert.equal((await featuresUsed(f.store, f.people[0].id)).used.has("interview"), true, "the card is not offered again");
});
