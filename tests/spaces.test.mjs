import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createReminderService } from "../server/reminder-service.mjs";
import { createAssistantRouter } from "../server/assistant-router.mjs";
import { createSpaceRouter } from "../server/space-router.mjs";
import { createTogetherRouter } from "../server/together-router.mjs";

const fields = (patch = {}) => ({ title: null, text: null, localDateTime: null, timezone: null, frequency: null, date: null, mood: null, layout: null, spaceId: null, done: null, ...patch });
const action = (kind, operation, patch = {}) => ({ kind, operation, targetId: null, expectedVersion: null, fields: fields(), query: null, queryPeriod: "all", occurrence: null, ...patch });
const together = (patch = {}) => ({ kind: "space", operation: "create", targetId: null, spaceId: null, title: null, text: null, date: null, layout: null, done: null, recurringRule: "once", remindDaysBefore: null, ...patch });

async function fixture(t, { planner = () => ({ reply: "", actions: [] }), shared = () => ({ reply: "ok", draftAgreement: null, actions: [] }) } = {}) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "spaces-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const id of ids) await store.createUser({ id, email: `${id}@example.invalid`, name: "Synthetic person", passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  const mediator = { planAssistantTurn: async (...args) => planner(...args), continueTogether: async (...args) => shared(...args), createRealtimeSession: async () => "v=0\r\n" };
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createAssistantRouter({ store, mediator, reminderService: createReminderService({ store }) }));
  app.use("/api", createTogetherRouter({ store, mediator }));
  app.use("/api", createSpaceRouter({ store }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); assert.ok(resolve(directory).startsWith(base)); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, method = "GET", body, userId = ids[0]) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  const session = (await request("/assistant/sessions", "POST", { language: "en", timezone: "UTC" })).body.session;
  return { ids, request, session, turn: (text) => request(`/assistant/sessions/${session.id}/messages`, "POST", { text, itemId: randomUUID() }) };
}

test("a private space and its items stay with their owner", async (t) => {
  const f = await fixture(t, { planner: () => ({ reply: "Started your list.", actions: [action("space", "create", { fields: fields({ title: "Gift ideas", layout: "list" }) }), action("space_item", "create", { fields: fields({ title: "Handwritten letter" }) })] }) });
  const response = await f.turn("Start a gift ideas list with a handwritten letter");
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.session.messages.at(-1).text, "Started your list.");
  const mine = (await f.request("/spaces")).body.spaces;
  assert.deepEqual(mine.map((space) => [space.visibility, space.title, space.items.map((item) => item.title)]), [["private", "Gift ideas", ["Handwritten letter"]]]);
  assert.deepEqual((await f.request("/spaces", "GET", null, f.ids[1])).body.spaces, []);
  assert.equal((await f.request(`/space-items/${mine[0].items[0].id}`, "PATCH", { done: true }, f.ids[1])).status, 404);
});

test("the shared Agent's spaces reach both partners, and private additions wait for the owner's confirmation", async (t) => {
  let spaceId = null;
  const f = await fixture(t, {
    shared: () => ({ reply: "Made your packing list.", draftAgreement: null, actions: [together({ title: "Beach packing", layout: "checklist" }), together({ kind: "space_item", title: "Sunscreen" })] }),
    planner: (context) => ({ reply: "", actions: [action("space_item", "create", { fields: fields({ title: "Passport", spaceId: context.spaces.find((space) => space.shared)?.id || null }) })] }),
  });
  const sent = await f.request("/together/messages", "POST", { text: "Pinky, make us a beach packing list with sunscreen", itemId: randomUUID(), language: "en" });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.reply.refs[0].type, "space");
  const partnerView = (await f.request("/spaces", "GET", null, f.ids[1])).body.spaces;
  assert.deepEqual(partnerView.map((space) => [space.visibility, space.title, space.items.map((item) => item.title)]), [["shared", "Beach packing", ["Sunscreen"]]]);
  spaceId = partnerView[0].id;
  assert.equal((await f.request(`/space-items/${partnerView[0].items[0].id}`, "PATCH", { done: true }, f.ids[1])).status, 200);

  const prepared = await f.turn("Add my passport to our beach list");
  const card = prepared.body.session.messages.at(-1).cards.find((item) => item.kind === "space_share");
  assert.equal(card.status, "draft");
  assert.deepEqual((await f.request("/spaces", "GET", null, f.ids[1])).body.spaces[0].items.map((item) => item.title), ["Sunscreen"]);
  assert.equal((await f.request(`/assistant/sessions/${f.session.id}/space-confirm`, "POST", { cardId: card.id, digest: "0".repeat(64) })).status, 409);
  const confirmed = await f.request(`/assistant/sessions/${f.session.id}/space-confirm`, "POST", { cardId: card.id, digest: card.digest });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  const items = (await f.request("/spaces", "GET", null, f.ids[1])).body.spaces.find((space) => space.id === spaceId).items;
  assert.deepEqual(items.map((item) => [item.title, item.done]), [["Sunscreen", true], ["Passport", false]]);
});

test("a shared action that cannot be applied leaves nothing behind and the Agent says so", async (t) => {
  const f = await fixture(t, { shared: () => ({ reply: "Added it.", draftAgreement: null, actions: [together({ kind: "space_item", spaceId: randomUUID(), title: "Ghost" })] }) });
  const sent = await f.request("/together/messages", "POST", { text: "Pinky, add a ghost", itemId: randomUUID(), language: "en" });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.match(sent.body.reply.text, /couldn't do that/);
  assert.deepEqual((await f.request("/spaces")).body.spaces, []);
});
