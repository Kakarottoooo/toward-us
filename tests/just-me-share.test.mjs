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
import { createRelationshipRouter } from "../server/relationship-router.mjs";

// Just me is where everything can start (founder 11-06): a plan for the two of them said privately becomes a card, and only
// its owner's confirmation puts it on the shared calendar.
const fields = (patch = {}) => ({ title: null, text: null, localDateTime: null, timezone: null, frequency: null, date: null, mood: null, layout: null, spaceId: null, done: null, photoId: null, ...patch });
const action = (patch = {}) => ({ kind: "milestone", operation: "create", targetId: null, expectedVersion: null, fields: fields(), query: null, queryPeriod: "all", occurrence: null, ...patch });

async function setup(t, { paired = true } = {}) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "justme-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const id of ids) await store.createUser({ id, email: `${id}@example.invalid`, name: id === ids[0] ? "Ziwei" : "Mia", passwordHash: "test", createdAt: new Date().toISOString() });
  if (paired) {
    const relationshipId = randomUUID();
    await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
    await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  }
  const mediator = { planAssistantTurn: async () => ({ reply: "", actions: [action({ fields: fields({ title: "13:00 去爸妈家吃饭", date: "2027-01-10" }) })] }), continueTogether: async () => ({ reply: "ok", draftAgreement: null, actions: [] }) };
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createAssistantRouter({ store, mediator, reminderService: createReminderService({ store }) }));
  app.use("/api", createTogetherRouter({ store, mediator }));
  app.use("/api", createRelationshipRouter({ store, mediator }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  const request = async (path, method = "GET", body, userId = ids[0]) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  const session = (await request("/assistant/sessions", "POST", { language: "zh", timezone: "UTC" })).body.session;
  const say = (text) => request(`/assistant/sessions/${session.id}/messages`, "POST", { text, itemId: randomUUID() });
  return { store, ids, request, session, say };
}

test("a plan for both, said in Just me, becomes a card; confirming puts it on their shared calendar with a reminder and a line in Us", async (t) => {
  const { ids, request, session, say } = await setup(t);
  const turn = await say("周日下午一点我们一起去爸妈家吃饭");
  assert.equal(turn.status, 200, JSON.stringify(turn.body));
  const reply = turn.body.session.messages.at(-1);
  const card = reply.cards.find((item) => item.kind === "space_share");
  assert.equal(card.shareKind, "date"); assert.equal(card.status, "draft"); assert.match(card.text, /13:00 去爸妈家吃饭 · 2027-01-10/);
  assert.match(reply.text, /要放进你们俩的日历吗/);
  const calendar = async (userId) => (await request("/relationship/home", "GET", null, userId)).body.graph.milestones.filter((item) => item.date === "2027-01-10");
  assert.deepEqual(await calendar(ids[1]), [], "nothing reaches Mia before Ziwei confirms");
  assert.equal((await request(`/assistant/sessions/${session.id}/space-confirm`, "POST", { cardId: card.id, digest: "wrong" })).status, 409);
  const confirmed = await request(`/assistant/sessions/${session.id}/space-confirm`, "POST", { cardId: card.id, digest: card.digest });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.session.messages.at(-1).cards.find((item) => item.id === card.id).status, "shared");
  const [date] = await calendar(ids[1]);
  assert.equal(date.title, "13:00 去爸妈家吃饭"); assert.equal(date.visibility, "shared"); assert.equal(date.recurringRule, "once");
  const us = (await request("/together?language=zh", "GET", null, ids[1])).body.conversation;
  assert.ok(us.messages.some((message) => /^Ziwei 把「13:00 去爸妈家吃饭」放进了你们俩的日历/.test(message.text)));
  assert.equal((await request(`/assistant/sessions/${session.id}/space-confirm`, "POST", { cardId: card.id, digest: card.digest })).status, 200, "a second tap changes nothing");
  assert.equal((await calendar(ids[0])).length, 1);
});

test("before the partner joins, a plan for both stays with the member, and nothing is shared", async (t) => {
  const { say } = await setup(t, { paired: false });
  const turn = await say("周日下午一点我们一起去爸妈家吃饭");
  assert.equal(turn.status, 200, JSON.stringify(turn.body));
  const reply = turn.body.session.messages.at(-1);
  assert.ok(!(reply.cards || []).some((item) => item.kind === "space_share"));
  assert.match(reply.text, /等 TA 加入后/);
});
