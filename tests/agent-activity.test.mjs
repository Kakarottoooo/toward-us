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
import { createAgentActivity, createAgentActivityRouter } from "../server/agent-activity.mjs";

// Pinky's live step while it answers (the founder, 11-03): seen by the asker in Just me, by both partners in Us, never by anyone else.
const fields = (patch = {}) => ({ title: null, text: null, localDateTime: null, timezone: null, frequency: null, date: null, mood: null, layout: null, spaceId: null, done: null, photoId: null, ...patch });
const search = (query) => ({ kind: "web_search", operation: "query", targetId: null, expectedVersion: null, fields: fields(), query, queryPeriod: "all", occurrence: null });
const gate = () => { let open; const promise = new Promise((resolve) => { open = resolve; }); return { promise, open }; };

async function fixture(t, mediator) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "activity-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  for (const id of ids) await store.createUser({ id, email: `${id}@example.invalid`, name: "Synthetic person", passwordHash: "test", createdAt: new Date().toISOString() });
  // The first two are a couple; the third has no partner and must never see their activity.
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  const nudges = [];
  const activity = createAgentActivity({ notify: (audience) => nudges.push(audience) });
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createAssistantRouter({ store, mediator: { createRealtimeSession: async () => "v=0\r\n", ...mediator }, reminderService: createReminderService({ store }), activity }));
  app.use("/api", createTogetherRouter({ store, mediator, activity }));
  app.use("/api", createAgentActivityRouter({ store, activity }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); assert.ok(resolve(directory).startsWith(base)); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, method = "GET", body, userId = ids[0]) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { ...(userId ? { "x-user": userId } : {}), "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const seen = async (channel, userId) => (await request(`/agent/activity?channel=${channel}`, "GET", null, userId)).body.activity;
  // Waits until the server reports `step`, so each assertion looks at the step the turn is really on.
  const until = async (channel, userId, step) => { for (let i = 0; i < 200; i += 1) { if ((await seen(channel, userId))?.step === step) return; await new Promise((r) => setTimeout(r, 10)); } assert.fail(`never reached ${step}`); };
  return { ids, relationshipId, request, seen, until, nudges };
}

test("a private turn's steps are seen only by the member who asked, and end with the reply", async (t) => {
  const thinking = gate(), looking = gate(), writing = gate(); let calls = 0;
  const f = await fixture(t, {
    webSearch: true,
    planAssistantTurn: async () => { calls += 1; if (calls === 1) { await thinking.promise; return { reply: "", actions: [search("quiet ramen near the river")] }; } await writing.promise; return { reply: "Try Ramen Ito.", actions: [] }; },
    lookup: async () => { await looking.promise; return "Ramen Ito, open till ten."; },
  });
  const session = (await f.request("/assistant/sessions", "POST", { language: "en", timezone: "UTC" })).body.session;
  const turn = f.request(`/assistant/sessions/${session.id}/messages`, "POST", { text: "Find us a quiet ramen place", itemId: randomUUID() });
  await f.until("me", f.ids[0], "thinking");
  // Never the partner, never someone outside the couple, and never through Us.
  assert.equal(await f.seen("me", f.ids[1]), null);
  assert.equal(await f.seen("me", f.ids[2]), null);
  assert.equal(await f.seen("us", f.ids[1]), null);
  thinking.open();
  await f.until("me", f.ids[0], "searching_web");
  assert.equal((await f.seen("me", f.ids[0])).detail, "quiet ramen near the river");
  looking.open();
  await f.until("me", f.ids[0], "writing");
  writing.open();
  const done = await turn; assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.session.messages.at(-1).text, "Try Ramen Ito.");
  assert.equal(await f.seen("me", f.ids[0]), null);
  // A private turn sends no live nudge to the couple's open Apps.
  assert.ok(f.nudges.every((audience) => audience.ownerUserId === f.ids[0] && audience.relationshipId === null));
});

test("a failed private turn still clears its step", async (t) => {
  const f = await fixture(t, { planAssistantTurn: async () => { throw new Error("model down"); } });
  const session = (await f.request("/assistant/sessions", "POST", { language: "en", timezone: "UTC" })).body.session;
  const failed = await f.request(`/assistant/sessions/${session.id}/messages`, "POST", { text: "hello", itemId: randomUUID() });
  assert.equal(failed.status, 503);
  assert.equal(await f.seen("me", f.ids[0]), null);
});

test("in Us both partners see Pinky's steps, an outsider does not, and nothing shows when Pinky is not called", async (t) => {
  const thinking = gate(), mediating = gate();
  const f = await fixture(t, {
    continueTogether: async () => { await thinking.promise; return { reply: "Let me help.", draftAgreement: null, actions: [{ kind: "mediate" }] }; },
    mediateTogether: async () => { await mediating.promise; return { shared: "Here is what I hear from both of you.", feedback: [] }; },
  });
  const quiet = await f.request("/together/messages", "POST", { text: "see you at seven", itemId: randomUUID(), language: "en" });
  assert.equal(quiet.status, 201); assert.equal(await f.seen("us", f.ids[0]), null);
  const turn = f.request("/together/messages", "POST", { text: "Pinky, help us with this", itemId: randomUUID(), language: "en" });
  await f.until("us", f.ids[0], "thinking");
  assert.equal((await f.seen("us", f.ids[1])).step, "thinking");
  assert.equal(await f.seen("us", f.ids[2]), null);
  // Us is not the asker's private channel.
  assert.equal(await f.seen("me", f.ids[0]), null);
  thinking.open();
  await f.until("us", f.ids[1], "mediating");
  mediating.open();
  const done = await turn; assert.equal(done.status, 201, JSON.stringify(done.body));
  assert.equal(done.body.reply.text, "Here is what I hear from both of you.");
  assert.equal(await f.seen("us", f.ids[0]), null);
  assert.equal(await f.seen("us", f.ids[1]), null);
  // Every change nudged the couple's open Apps, for both members (no single owner).
  assert.ok(f.nudges.length >= 3 && f.nudges.every((audience) => audience.relationshipId === f.relationshipId && audience.ownerUserId === null));
});

test("activity keeps the newest of overlapping turns, ignores unknown steps and forgets abandoned ones", () => {
  let clock = 1_000;
  const activity = createAgentActivity({ now: () => clock, staleMs: 60_000 });
  const first = activity.forCouple("r1"), second = activity.forCouple("r1");
  first("thinking"); clock += 10; second("searching_web", "x".repeat(200));
  assert.equal(activity.couple("r1").step, "searching_web");
  assert.equal(activity.couple("r1").detail.length, 80);
  second(null);
  assert.equal(activity.couple("r1").step, "thinking");
  first("open_the_vault");
  assert.equal(activity.couple("r1").step, "thinking");
  assert.equal(activity.couple("r2"), null);
  assert.equal(activity.member("r1"), null);
  clock += 61_000;
  assert.equal(activity.couple("r1"), null);
  // A reporter that ended stays ended.
  second("thinking"); assert.equal(activity.couple("r1"), null);
});
