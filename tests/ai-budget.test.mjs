import { mockModeration, withModeration } from "./helpers/moderation.mjs";
import { AI_NOTICE_VERSION } from "../server/ai-permission.mjs";
import { setAiConsent } from "../server/privacy-router.mjs";
import { installAiLedger } from "../server/ai-ledger.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApiApp } from "../server/app.mjs";
import { createFileStore } from "../server/store.mjs";
import { createMediator } from "../server/mediator.mjs";
import { AI_CAPS, AI_LIMIT, AI_UNCHANGED, ANONYMOUS_DAILY_CAP, aiUsageReport, asAiUser, guardMediator, usesCheaperModel } from "../server/ai-budget.mjs";
// The cost ledger and cost controls are tested with the call counting (kept in their own file, run in this one so the
// test:app list stays unchanged and merges cleanly with other branches).
import "./ai-ledger.test.mjs";

// Cost guard (founder, 11-04): count every model call, cap it per day, keep background work cheap and never repeated.
let directory, store, counter = 0;
before(async () => {
  await mkdir(join(process.cwd(), "work"), { recursive: true });
  directory = await mkdtemp(join(process.cwd(), "work", "ai-budget-"));
  store = await createFileStore(join(directory, "state.json"));
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

async function user(name) {
  const id = randomUUID(), now = new Date().toISOString();
  return store.createUser({ id, email: `budget-${++counter}@example.com`, name, passwordHash: "x", createdAt: now });
}
async function couple() {
  const a = await user("Alex"), b = await user("Blair"), now = new Date();
  const relationship = { id: randomUUID(), status: "pending", createdAt: now.toISOString(), updatedAt: now.toISOString() };
  const code = randomUUID().slice(0, 8);
  await store.createInvitation({ relationship, membership: { relationshipId: relationship.id, userId: a.id, role: "A", joinedAt: now.toISOString() }, invitation: { code, relationshipId: relationship.id, createdByUserId: a.id, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), acceptedAt: null, acceptedByUserId: null } });
  await store.acceptInvitation(code, b.id, now.toISOString());
  return { a, b, relationshipId: relationship.id };
}
/** A stand-in model that counts what really reached it. */
function fakeModel({ fail = () => false } = {}) {
  const calls = [];
  const run = (method) => async (...args) => { calls.push({ method, args }); if (fail(method, args)) throw new Error("model down"); return method === "structured" ? { ok: true } : { reply: "ok" }; };
  return { calls, mediator: { structured: run("structured"), planAssistantTurn: run("planAssistantTurn"), answerScreenshot: run("answerScreenshot"), continueTogether: run("continueTogether"), lookup: run("lookup") } };
}
const small = {
  free: { person: 2, couple: 3, background: 2, chatImport: 2, features: { composer_suggestions: 1 } },
  paid: { person: 4, couple: 6, background: 5, chatImport: 5, features: { composer_suggestions: 3 } },
};
const rejectsLimit = async (work, scope) => {
  const error = await work().then(() => null, (failure) => failure);
  assert.ok(error, "expected today's limit");
  assert.equal(error.code, AI_LIMIT); assert.equal(error.statusCode, 429); if (scope) assert.equal(error.scope, scope);
  return error;
};

test("every model call is counted per person, per couple and per feature, in the store", async () => {
  const { a, b, relationshipId } = await couple(), single = await user("Sam");
  const { mediator, calls } = fakeModel(), guarded = guardMediator(mediator, { store });
  await asAiUser({ userId: a.id }, async () => { await guarded.planAssistantTurn({}); await guarded.continueTogether({}); await guarded.planAssistantTurn({ again: true }); });
  await asAiUser({ userId: b.id }, () => guarded.structured({ name: "daily_question", input: "{}" }));
  await asAiUser({ userId: single.id }, () => guarded.lookup("coffee"));
  assert.equal(calls.length, 5);
  const rows = await aiUsageReport(store, { days: 1 });
  const ours = rows.find((row) => row.relationshipId === relationshipId);
  assert.equal(ours.total, 4);
  assert.deepEqual(ours.features, { assistant_turn: 2, together_turn: 1, daily_question: 1 });
  assert.deepEqual(Object.fromEntries(ours.people.map((person) => [person.userId, person.total])), { [a.id]: 3, [b.id]: 1 });
  const alone = rows.find((row) => row.people.some((person) => person.userId === single.id));
  assert.equal(alone.relationshipId, null); assert.deepEqual(alone.features, { web_lookup: 1 });
  // Counters are metering, never part of anyone's home payload.
  assert.equal((await store.relationshipSnapshotForUser(a.id)).aiUsage, undefined);
});

test("free caps stop one person, then the couple, with a localized 'today's limit' error and no model call", async () => {
  const { a, b } = await couple();
  const { mediator, calls } = fakeModel(), guarded = guardMediator(mediator, { store, caps: small });
  await asAiUser({ userId: a.id, language: "en" }, async () => {
    await guarded.planAssistantTurn({}); await guarded.planAssistantTurn({});
    const error = await rejectsLimit(() => guarded.continueTogether({}), "person");
    assert.match(error.message, /today's free allowance/); assert.equal(error.upgrade, true, "free couples are told about membership"); assert.equal(error.background, false);
  });
  await asAiUser({ userId: b.id, language: "es" }, async () => {
    await guarded.planAssistantTurn({});
    const error = await rejectsLimit(() => guarded.planAssistantTurn({}), "couple");
    assert.match(error.message, /asignación gratuita de hoy/);
  });
  assert.equal(calls.length, 3);
});

test("read-only screenshot advice uses the same per-person allowance as private replies", async () => {
  const owner = await user("Screenshot owner");
  const { mediator, calls } = fakeModel(), guarded = guardMediator(mediator, { store, caps: small });
  await asAiUser({ userId: owner.id }, async () => {
    await guarded.planAssistantTurn({ question: "read this screenshot" });
    await guarded.answerScreenshot({ question: "who is right?", transcript: "fictional exchange" });
    await rejectsLimit(() => guarded.answerScreenshot({ question: "one more" }), "person");
  });
  assert.deepEqual(calls.map((call) => call.method), ["planAssistantTurn", "answerScreenshot"]);
  const row = (await aiUsageReport(store, { days: 1 })).find((entry) => entry.people.some((person) => person.userId === owner.id));
  assert.equal(row.features.assistant_turn, 2);
});

test("paid users get the paid caps, and a paid member lifts the couple's caps", async () => {
  const { a, b } = await couple(), previous = process.env.AI_PAID_USERS;
  process.env.AI_PAID_USERS = ` ${a.email.toUpperCase()} , someone-else `;
  try {
    const { mediator, calls } = fakeModel(), guarded = guardMediator(mediator, { store, caps: small });
    await asAiUser({ userId: a.id }, async () => { for (let i = 0; i < small.paid.person; i += 1) await guarded.planAssistantTurn({ i }); await rejectsLimit(() => guarded.planAssistantTurn({}), "person"); });
    // Blair is on the free plan as a person, but the couple's allowance is the paid one.
    await asAiUser({ userId: b.id }, async () => { await guarded.planAssistantTurn({}); await guarded.planAssistantTurn({}); await rejectsLimit(() => guarded.planAssistantTurn({}), "person"); });
    assert.equal(calls.length, 6);
  } finally { if (previous === undefined) delete process.env.AI_PAID_USERS; else process.env.AI_PAID_USERS = previous; }
  const { a: c } = await couple(), { mediator } = fakeModel(), guarded = guardMediator(mediator, { store, caps: small });
  process.env.AI_PAID_USERS = c.id;
  try { await asAiUser({ userId: c.id }, async () => { for (let i = 0; i < small.paid.person; i += 1) await guarded.lookup(`q${i}`); }); }
  finally { if (previous === undefined) delete process.env.AI_PAID_USERS; else process.env.AI_PAID_USERS = previous; }
});

test("background work has its own pool and feature caps, so it never eats the interactive allowance", async () => {
  const { a, b } = await couple();
  const { mediator, calls } = fakeModel(), guarded = guardMediator(mediator, { store, caps: small });
  await asAiUser({ userId: a.id }, async () => {
    await guarded.structured({ name: "composer_suggestions", input: "1" });
    await rejectsLimit(() => guarded.structured({ name: "composer_suggestions", input: "2" }), "composer_suggestions");
    await guarded.structured({ name: "couple_promises", input: "1" });
  });
  const error = await asAiUser({ userId: b.id }, () => rejectsLimit(() => guarded.structured({ name: "daily_question", input: "1" }), "background"));
  assert.equal(error.background, true);
  // The interactive allowance is untouched.
  await asAiUser({ userId: a.id }, async () => { await guarded.planAssistantTurn({}); await guarded.planAssistantTurn({}); });
  // Chat-history import has its own per-person pool.
  await asAiUser({ userId: b.id }, async () => { await guarded.structured({ name: "chat_history_part", input: "1" }); await guarded.structured({ name: "chat_history_report", input: "1" }); await rejectsLimit(() => guarded.structured({ name: "chat_history_part", input: "2" }), "chat_import"); });
  assert.equal(calls.length, 6);
});

test("background calls skip the model when their input has not changed since the last successful run", async () => {
  const { a, b } = await couple();
  let down = true;
  const { mediator, calls } = fakeModel({ fail: () => down }), guarded = guardMediator(mediator, { store });
  const ask = (input) => guarded.structured({ name: "daily_question", instructions: "same", input });
  await asAiUser({ userId: a.id }, async () => {
    // A failed run is not remembered: the same input is tried again once the model is back.
    await assert.rejects(() => ask("material-1"), /model down/);
    down = false;
    await ask("material-1");
    await assert.rejects(() => ask("material-1"), (error) => error.code === AI_UNCHANGED);
    await ask("material-2");
    await assert.rejects(() => ask("material-1"), (error) => error.code === AI_UNCHANGED);
    // Interactive turns are never deduplicated: the person asked again.
    await guarded.planAssistantTurn({ same: true }); await guarded.planAssistantTurn({ same: true });
  });
  assert.equal(calls.filter((call) => call.method === "structured").length, 3);
  assert.equal(calls.filter((call) => call.method === "planAssistantTurn").length, 2);
  // Skipped calls are not counted; each person keeps their own record of inputs, which no partner can read.
  const row = (await aiUsageReport(store, { days: 1 })).find((item) => item.people.some((person) => person.userId === a.id));
  assert.equal(row.features.daily_question, 3);
  assert.equal(await store.getRelationshipRecordForUser("aiUsage", `ai-inputs:${a.id}`, b.id), null);
});

test("signed-out calls share one allowance per server per day", async () => {
  const { mediator, calls } = fakeModel(), guarded = guardMediator(mediator, { store });
  for (let i = 0; i < ANONYMOUS_DAILY_CAP; i += 1) await guarded.lookup(`q${i}`);
  await rejectsLimit(() => guarded.lookup("one more"), "anonymous");
  assert.equal(calls.length, ANONYMOUS_DAILY_CAP);
  // Without a configured model nothing costs anything, so nothing is wrapped.
  const idle = { aiReady: false, structured: async () => ({}) };
  assert.equal(guardMediator(idle, { store }), idle);
});

test("background work and chat import run on the cheaper model; what the person waits for keeps the main one", async () => {
  assert.deepEqual(["couple_promises", "daily_question", "daily_reaction", "composer_suggestions", "couple_recap", "feedback_triage", "chat_history_part", "chat_history_report", "chat_screenshots"].filter((feature) => !usesCheaperModel(feature)), []);
  assert.deepEqual(["together_turn", "assistant_turn", "web_lookup", "private_agent", "perspective_summary", "decision_options", "together_mediation", "some_new_feature"].filter(usesCheaperModel), []);
  const keys = ["AI_PROVIDER", "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BACKGROUND_MODEL", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "ANTHROPIC_BACKGROUND_MODEL"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]])), realFetch = globalThis.fetch, seen = [];
  const modelUser = await user("Provider");
  await setAiConsent(store, modelUser.id, true);
  installAiLedger({ store });
  // No network: every provider request is answered here and only its chosen model is recorded.
  globalThis.fetch = withModeration(async (url, init) => {
    const host = new URL(String(url?.url || url)).host, body = JSON.parse(init.body);
    seen.push({ host, model: body.model });
    const text = JSON.stringify({ question: "q" });
    const payload = host === "api.openai.com" ? { id: "r", object: "response", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] }
      : host === "api.anthropic.com" ? { id: "m", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }
        : null;
    if (!payload) throw new Error(`unexpected request to ${host}`);
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  });
  try {
    for (const key of keys) delete process.env[key];
    process.env.AI_PROVIDER = "openai"; process.env.OPENAI_API_KEY = "test-key";
    let mediator = createMediator();
    await asAiUser({ userId: modelUser.id }, () => mediator.structured({ name: "couple_promises", schema: {}, instructions: "x", input: "{}" }));
    await asAiUser({ userId: modelUser.id }, () => mediator.summarizePerspective({ goal: "g" }, "en"));
    assert.equal(mediator.backgroundModel, "gpt-5.4-mini");
    process.env.AI_PROVIDER = "anthropic"; process.env.ANTHROPIC_API_KEY = "test-key";
    mediator = createMediator();
    await asAiUser({ userId: modelUser.id }, () => mediator.structured({ name: "daily_question", schema: {}, instructions: "x", input: "{}" }));
    await asAiUser({ userId: modelUser.id }, () => mediator.summarizePerspective({ goal: "g" }, "en"));
    assert.deepEqual(seen, [
      { host: "api.openai.com", model: "gpt-5.4-mini" }, { host: "api.openai.com", model: "gpt-6.2-sol" },
      { host: "api.anthropic.com", model: "claude-haiku-5-5" }, { host: "api.anthropic.com", model: "claude-opus-5-5" },
    ]);
  } finally {
    globalThis.fetch = realFetch;
    for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
});

test("a capped Us turn keeps the member's words and answers with the localized limit; the ops report shows the counts", async (t) => {
  mockModeration(t);
  const previous = process.env.REMINDER_RUN_SECRET;
  process.env.REMINDER_RUN_SECRET = "budget-test-secret-0123456789abcdef";
  const turns = [];
  const server = createApiApp({ store, mediator: { aiReady: true, model: "fake", continueTogether: async () => { turns.push(1); return { reply: "Sure.", draftAgreement: null, actions: [] }; } } }).listen(0, "127.0.0.1");
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (path, who, body, init = {}) => {
      const response = await fetch(`${base}/api${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(who ? { cookie: who.cookie } : {}), ...init.headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const register = async (name) => {
      const response = await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, adultConfirmed: true, email: `budget-http-${++counter}@example.com`, password: "correct horse battery" }) });
      return { ...(await response.json()), cookie: response.headers.get("set-cookie").split(";")[0] };
    };
    const a = await register("Alex"), b = await register("Blair");
    for (const person of [a, b]) assert.equal((await call("/privacy/ai-consent", person, { agree: true, noticeVersion: AI_NOTICE_VERSION })).status, 200);
    const invitation = await call("/partner/invitations", a, {});
    await call("/partner/accept", b, { code: invitation.body.pairing.invitation.code });
    const say = (text) => call("/together/messages", a, { text, itemId: randomUUID(), language: "en" });
    // Temporary measurement-friendly free defaults (11-04) until the founder tunes them from the ops report.
    assert.deepEqual(AI_CAPS.free, { person: 60, couple: 100, background: 80, chatImport: 65, features: { composer_suggestions: 15, photo_memory: 24 } });
    // A big album (one call per memory) once used 70 of the couple's 80 background calls in a day, so games fell back to
    // canned questions and translations failed. Even with both members syncing, album captions leave most of the pool.
    for (const plan of [AI_CAPS.free, AI_CAPS.paid]) assert.ok(plan.features.photo_memory * 2 <= plan.background * 0.6);
    for (let i = 0; i < AI_CAPS.free.person; i += 1) assert.equal((await say(`@Ourever idea ${i}?`)).status, 201);
    const capped = await say("@Ourever one more idea?");
    assert.equal(capped.status, 429);
    assert.equal(capped.body.code, AI_LIMIT);
    assert.match(capped.body.error, /today's free allowance/);
    assert.equal(turns.length, AI_CAPS.free.person);
    // The member's own words still reach their partner, and talking without Pinky is untouched.
    const relationshipId = (await store.getRelationshipContext(a.user.id)).relationship.id;
    const messages = (await store.getRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, a.user.id)).messages;
    assert.ok(messages.some((message) => message.text === "@Ourever one more idea?"));
    assert.equal((await say("see you at 7")).status, 201);
    // Read-only ops view, behind the same Bearer gate as the other internal reports.
    assert.equal((await call("/internal/ai-usage", null)).status, 401);
    const report = await call("/internal/ai-usage?days=1", null, undefined, { headers: { authorization: "Bearer budget-test-secret-0123456789abcdef" } });
    assert.equal(report.status, 200);
    assert.deepEqual(report.body.caps, AI_CAPS);
    assert.deepEqual(report.body.rows.find((row) => row.relationshipId === relationshipId).features, { together_turn: AI_CAPS.free.person });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.REMINDER_RUN_SECRET; else process.env.REMINDER_RUN_SECRET = previous;
  }
});

// Founder 11-22: while safety screening is unavailable, a partner's own words to the other partner are still delivered, and
// screened once it is back. Pinky never answers unscreened words, and every other caller stays fail-closed.
async function deferredScreeningCouple(t) {
  let moderation = "down";
  const realFetch = globalThis.fetch, previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "local-moderation-fixture";
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === "127.0.0.1") return realFetch(input, init);
    assert.equal(url.href, "https://api.openai.com/v1/moderations");
    if (moderation === "down") return new Response("unavailable", { status: 503 });
    const count = JSON.parse(init.body).input.length;
    return Response.json({ results: Array.from({ length: count }, () => moderation === "flag" ? { flagged: true, categories: { harassment: true } } : { flagged: false }) });
  });
  const turns = [];
  const server = createApiApp({ store, mediator: { aiReady: true, model: "fake", continueTogether: async () => { turns.push(1); return { reply: "Sure.", draftAgreement: null, actions: [] }; } } }).listen(0, "127.0.0.1");
  t.after(async () => {
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, who, body) => {
    const response = await realFetch(`${base}/api${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", cookie: who.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const register = async (name) => {
    const response = await realFetch(`${base}/api/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, adultConfirmed: true, email: `deferred-${++counter}@example.com`, password: "correct horse battery" }) });
    return { ...(await response.json()), cookie: response.headers.get("set-cookie").split(";")[0] };
  };
  const a = await register("Alex"), b = await register("Blair");
  for (const person of [a, b]) assert.equal((await call("/privacy/ai-consent", person, { agree: true, noticeVersion: AI_NOTICE_VERSION })).status, 200);
  const invitation = await call("/partner/invitations", a, {});
  await call("/partner/accept", b, { code: invitation.body.pairing.invitation.code });
  const relationshipId = (await store.getRelationshipContext(a.user.id)).relationship.id;
  const conversation = () => store.getRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, a.user.id);
  const say = (text) => call("/together/messages", a, { text, itemId: randomUUID(), language: "en" });
  return { a, b, call, say, conversation, turns, set: (value) => { moderation = value; } };
}

test("screening down: a partner's message is delivered and queued, Pinky stays quiet, and the queue clears once screening is back", async (t) => {
  const { screenDeferredMessages } = await import("../server/together-domain.mjs");
  const { screenText } = await import("../server/ai-screening.mjs");
  const f = await deferredScreeningCouple(t);
  const sent = await f.say("see you at 7");
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.screeningDeferred, true);
  const asked = await f.say("@Ourever plan our weekend?");
  assert.equal(asked.status, 201);
  assert.equal(asked.body.reply, null, "unscreened words never reach the model");
  assert.equal(f.turns.length, 0);
  const seen = (await f.call("/together?language=en", f.b)).body.conversation.messages.map((item) => item.text);
  assert.ok(seen.includes("see you at 7") && seen.includes("@Ourever plan our weekend?"), "the partner sees both");
  assert.deepEqual((await f.conversation()).screeningQueue.map((entry) => entry.messageId), [sent.body.message.id, asked.body.message.id]);
  // Every other caller keeps the fail-closed default.
  await assert.rejects(asAiUser({ userId: f.a.user.id }, () => screenText("hello")), { code: "ai_screening_unavailable" });
  // Still down: nothing settles, nothing is lost.
  await screenDeferredMessages({ store });
  assert.equal((await f.conversation()).screeningQueue.length, 2);
  // Back: each queued message is screened once and leaves the queue; passing messages stay as they were.
  f.set("ok");
  const notes = [];
  assert.deepEqual(await screenDeferredMessages({ store, postNote: async (...args) => notes.push(args) }), { screened: 2, removed: 0 });
  const after = await f.conversation();
  assert.deepEqual(after.screeningQueue, []);
  assert.ok(after.messages.some((item) => item.id === sent.body.message.id && item.text === "see you at 7" && !item.removedAt));
  assert.deepEqual(notes, []);
  assert.deepEqual(await screenDeferredMessages({ store }), { screened: 0, removed: 0 }, "idempotent");
});

test("screening down past the queue cap: the couple's chat keeps delivering and the oldest entries leave the queue (QA3 R3)", async (t) => {
  const { setScreeningQueueLimitForTests } = await import("../server/together-domain.mjs");
  const previous = setScreeningQueueLimitForTests(3);
  t.after(() => setScreeningQueueLimitForTests(previous));
  const logged = [];
  t.mock.method(console, "error", (...args) => logged.push(args.join(" ")));
  const f = await deferredScreeningCouple(t);
  const ids = [];
  for (let index = 0; index < 5; index += 1) {
    const sent = await f.say(`while down ${index}`);
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.equal(sent.body.screeningDeferred, true);
    ids.push(sent.body.message.id);
  }
  const seen = (await f.call("/together?language=en", f.b)).body.conversation.messages.map((item) => item.text);
  for (let index = 0; index < 5; index += 1) assert.ok(seen.includes(`while down ${index}`), "every message reaches the partner");
  assert.deepEqual((await f.conversation()).screeningQueue.map((entry) => entry.messageId), ids.slice(2), "the newest stay queued, capped");
  assert.equal(logged.filter((line) => /screening queue over 3/.test(line)).length, 2);
  // Back up: the capped queue drains as usual (and leaves the shared store clean for the next test).
  f.set("ok");
  const { screenDeferredMessages } = await import("../server/together-domain.mjs");
  assert.deepEqual(await screenDeferredMessages({ store }), { screened: 3, removed: 0 });
});

test("a deferred message that fails screening afterwards is removed for both partners and its author is told", async (t) => {
  const { screenDeferredMessages } = await import("../server/together-domain.mjs");
  const f = await deferredScreeningCouple(t);
  const sent = await f.say("deferred words that will not pass");
  assert.equal(sent.status, 201);
  f.set("flag");
  // The synchronous path refuses the same content outright.
  assert.equal((await f.say("words that will not pass")).status, 422);
  const notes = [], pushes = [], emitted = [];
  assert.deepEqual(await screenDeferredMessages({ store, emit: (record) => emitted.push(record), postNote: async (...args) => notes.push(args), notify: async (...args) => pushes.push(args) }), { screened: 1, removed: 1 });
  const line = (await f.conversation()).messages.find((item) => item.id === sent.body.message.id);
  assert.equal(line.text, "");
  assert.equal(line.removedReason, "screening");
  assert.ok(line.removedAt);
  assert.deepEqual((await f.conversation()).screeningQueue, []);
  assert.ok(!JSON.stringify((await f.call("/together?language=en", f.b)).body).includes("will not pass"), "the partner no longer sees it");
  assert.equal(emitted.length, 1);
  assert.deepEqual(notes.map(([userId, note]) => [userId, note.language]), [[f.a.user.id, "en"]]);
  assert.match(notes[0][1].text, /did not pass safety screening/);
  assert.deepEqual(pushes.map(([userId]) => userId), [f.a.user.id]);
});
