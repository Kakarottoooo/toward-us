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
import { profileContext } from "../server/profile.mjs";

// Founder 11-07, after looking at Known: Pinky asks each member privately how a date went (one tap, kept in About us), and a
// few-minute private voice interview lets Pinky get to know a member from day one.
const SDP = "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n";
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function fixture(t, { structured = null, planner = () => ({ reply: "ok", actions: [] }) } = {}) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "known-"));
  const store = await createFileStore(join(directory, "store.json"));
  const people = [{ id: randomUUID(), name: "Ziwei" }, { id: randomUUID(), name: "Mia" }, { id: randomUUID(), name: "Solo" }];
  for (const person of people) await store.createUser({ ...person, email: `${person.id}@example.invalid`, passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: people[0].id, role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: people[0].id, expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, people[1].id, new Date().toISOString());
  const provider = { configured: true, started: [], async start(input) { this.started.push(input); return { providerId: `live_${this.started.length}`, sdp: "v=0\r\nanswer" }; }, async hangup() {} };
  const mediator = { planAssistantTurn: async (context) => planner(context), ...(structured ? { structured } : {}) };
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
  const sessionFor = async (userId, language = "en", { greeted = true } = {}) => {
    const created = (await request("/assistant/sessions", "POST", { language, timezone: "UTC" }, userId)).body.session;
    if (!greeted) return created;
    // As if Pinky's opening question was asked (and answered) on an earlier day, so today's own question can come.
    await store.transaction("x", (tx) => tx.updateRelationshipRecordForUser("privateAgentThreads", created.id, userId, (draft) => { draft.messages = []; draft.knowYouAt = "2000-01-01T00:00:00.000Z"; }));
    return { ...created, messages: [] };
  };
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

test("the phone button is the interview: while Pinky barely knows a member their private call opens with questions, and every private call is remembered", async (t) => {
  let seen = null, calls = 0;
  const structured = async ({ name, input, instructions }) => {
    assert.equal(name, "couple_profile");
    calls += 1;
    seen = JSON.parse(input);
    if (calls === 2) { assert.match(instructions, /captions of a private voice call/); return { facts: [] }; }
    assert.match(instructions, /getting-to-know-you voice interview/);
    const answer = seen.messages.find((line) => line.from === "A" && /comfort/.test(line.text));
    const question = seen.messages.find((line) => line.from === "Pinky");
    return { facts: [
      { messageId: answer.id, quote: "a hug and some quiet", subject: "A", category: "traits", fact: "wants a hug and some quiet when upset", replaces: "" },
      { messageId: answer.id, quote: "Mia loves night markets", subject: "B", category: "likes", fact: "loves night markets", replaces: "" },
      { messageId: question.id, quote: "how do you like to be comforted", subject: "A", category: "traits", fact: "made up from the question", replaces: "" },
    ] };
  };
  let planned = null;
  const f = await fixture(t, { structured, planner: (context) => { planned = context; return { reply: "Hi!", actions: [] }; } });
  const session = await f.sessionFor(f.people[0].id);
  const start = (userId, sessionId) => f.request("/voice/start", "POST", { sdp: SDP, requestId: randomUUID().replace(/-/g, ""), language: "en", channel: "me", sessionId }, userId);

  // In Just me, Pinky is told it barely knows them, so it offers the questions in the chat itself.
  await f.request(`/assistant/sessions/${session.id}/messages`, "POST", { text: "I'm new", itemId: randomUUID() });
  assert.equal(planned.gettingToKnow, true);

  // Someone not connected yet gets an ordinary private call (notes are kept per couple).
  const solo = await f.sessionFor(f.people[2].id);
  const soloCall = await start(f.people[2].id, solo.id);
  assert.equal(soloCall.status, 200); assert.equal(soloCall.body.interview, undefined);
  assert.doesNotMatch(f.provider.started.at(-1).instructions, /get to know/);

  const started = await start(f.people[0].id, session.id);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.interview, true, "the app is told, to show a one-line hint");
  const live = f.provider.started.at(-1);
  assert.match(live.instructions, /get to know Ziwei/); assert.match(live.instructions, /about five minutes/); assert.match(live.instructions, /share with Mia/);
  assert.match(live.instructions, /help with that first, and offer the questions only afterwards/);
  await f.request("/voice/close", "POST", { id: started.body.id });
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

  // Once interviewed, the next call is an ordinary one, still remembered; nothing new means no extra line.
  await f.request(`/assistant/sessions/${session.id}/messages`, "POST", { text: "hello again", itemId: randomUUID() });
  assert.equal(planned.gettingToKnow, false, "no more offers");
  const next = await start(f.people[0].id, session.id);
  assert.equal(next.body.interview, undefined);
  assert.doesNotMatch(f.provider.started.at(-1).instructions, /get to know/);
  await f.request("/voice/close", "POST", { id: next.body.id });
  await f.request("/voice/transcript", "POST", { id: next.body.id, rows: [{ role: "user", text: "Just wanted to say hi" }] });
  for (let attempt = 0; attempt < 40 && calls < 2; attempt += 1) await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls, 2, "the ordinary call was read too");
  await new Promise((r) => setTimeout(r, 100));
  const after = (await f.request(`/assistant/sessions/${session.id}`)).body.session.messages;
  assert.ok(after.at(-1).call, "no noted line when nothing new was kept");
});

test("Pinky knows by itself whether it knows someone: it speaks first to a member it barely knows, once, and never to one it knows", async (t) => {
  const f = await fixture(t);
  // A brand-new connected member: opening Just me creates the conversation, and Pinky's first question is already in it.
  const typed = (await f.request("/assistant/sessions", "POST", { language: "zh", timezone: "UTC" })).body.session;
  assert.equal(typed.messages.length, 0, "a conversation made because they started typing does not open with Pinky's question");
  await f.store.transaction("x", (tx) => tx.updateRelationshipRecordForUser("privateAgentThreads", typed.id, f.people[0].id, (draft) => { draft.archivedAt = new Date().toISOString(); }));
  const fresh = (await f.request("/assistant/sessions", "POST", { language: "zh", timezone: "UTC", opened: true })).body.session;
  assert.equal(fresh.messages.length, 1);
  assert.match(fresh.messages[0].text, /^嗨，我是 Pinky。我还不太了解你/);
  assert.match(fresh.messages[0].text, /第一个：你不开心的时候，最希望 Mia 怎么对你？/);
  assert.doesNotMatch(fresh.messages[0].text, /新用户/, "it never asks them to say they are new");
  assert.equal((await f.request(`/assistant/sessions/${fresh.id}?opened=1`)).body.session.messages.length, 1, "asked once");
  assert.equal((await f.request("/assistant/sessions/latest")).body.session.messages.length, 1);
  const another = (await f.request("/assistant/sessions", "POST", { language: "zh", timezone: "UTC", opened: true })).body.session;
  assert.equal(another.messages.length, 0, "once per member, not per conversation");

  // Mia has talked with Pinky before but it has kept little about her: she is not greeted as if she had just arrived.
  const hers = (await f.request("/assistant/sessions", "POST", { language: "en", timezone: "UTC", opened: true }, f.people[1].id)).body.session;
  assert.match(hers.messages[0].text, /^Hi, I'm Pinky/);
  const store = f.store;
  await store.transaction("x", (tx) => tx.updateRelationshipRecordForUser("privateAgentThreads", hers.id, f.people[1].id, (draft) => { draft.knowYouAt = null; draft.messages = [{ id: randomUUID(), role: "user", text: "hi", createdAt: new Date().toISOString() }]; }));
  const again = (await f.request(`/assistant/sessions/${hers.id}?opened=1`, "GET", undefined, f.people[1].id)).body.session;
  assert.match(again.messages.at(-1).text, /^I realize I don't know you very well yet/);

  // Not connected: no couple notes to keep, so no questions.
  const solo = (await f.request("/assistant/sessions", "POST", { language: "zh", timezone: "UTC", opened: true }, f.people[2].id)).body.session;
  assert.equal(solo.messages.length, 0);
});

test("someone Pinky already knows is not interviewed", async (t) => {
  const f = await fixture(t);
  await f.store.transaction(`relationship:${f.relationshipId}`, async (tx) => {
    for (const text of ["a", "b", "c", "d", "e"]) await tx.createRelationshipRecord("memories", createRelationshipRecord({ relationshipId: f.relationshipId, userId: f.people[0].id, ownerUserId: f.people[0].id, visibility: "private", aiAccessScope: "private", status: "active", kind: "profile", subjectUserId: f.people[0].id, category: "likes", text, approvals: [] }));
  });
  const session = (await f.request("/assistant/sessions", "POST", { language: "zh", timezone: "UTC", opened: true })).body.session;
  assert.equal(session.messages.length, 0);
});
