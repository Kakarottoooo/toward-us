import assert from "node:assert/strict";
// The moments albums every member and couple get automatically are left out: these tests are about spaces Pinky builds.
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
import { createPhotoRouter } from "../server/photo-store.mjs";

const fields = (patch = {}) => ({ title: null, text: null, localDateTime: null, timezone: null, frequency: null, date: null, mood: null, layout: null, spaceId: null, done: null, photoId: null, ...patch });
const action = (kind, operation, patch = {}) => ({ kind, operation, targetId: null, expectedVersion: null, fields: fields(), query: null, queryPeriod: "all", occurrence: null, ...patch });
const together = (patch = {}) => ({ kind: "space", operation: "create", targetId: null, spaceId: null, title: null, text: null, date: null, layout: null, done: null, recurringRule: "once", remindDaysBefore: null, photoId: null, ...patch });

async function fixture(t, { planner = () => ({ reply: "", actions: [] }), shared = () => ({ reply: "ok", draftAgreement: null, actions: [] }), mediate = null } = {}) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "spaces-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const id of ids) await store.createUser({ id, email: `${id}@example.invalid`, name: "Synthetic person", passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  const mediator = { planAssistantTurn: async (...args) => planner(...args), continueTogether: async (...args) => shared(...args), ...(mediate ? { mediateTogether: async (...args) => mediate(...args) } : {}), createRealtimeSession: async () => "v=0\r\n" };
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createAssistantRouter({ store, mediator, reminderService: createReminderService({ store }) }));
  app.use("/api", createTogetherRouter({ store, mediator }));
  app.use("/api", createSpaceRouter({ store }));
  app.use("/api", createPhotoRouter({ store }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); assert.ok(resolve(directory).startsWith(base)); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, method = "GET", body, userId = ids[0]) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  const session = (await request("/assistant/sessions", "POST", { language: "en", timezone: "UTC" })).body.session;
  const upload = async (scope, userId = ids[0]) => (await fetch(`http://127.0.0.1:${server.address().port}/api/photos?scope=${scope}`, { method: "POST", headers: { "x-user": userId, "content-type": "image/jpeg" }, body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) })).json();
  const photo = async (id, userId = ids[0]) => (await fetch(`http://127.0.0.1:${server.address().port}/api/photos/${id}`, { headers: { "x-user": userId } })).status;
  return { ids, request, session, upload, photo, turn: (text) => request(`/assistant/sessions/${session.id}/messages`, "POST", { text, itemId: randomUUID() }) };
}

test("a private space and its items stay with their owner", async (t) => {
  const f = await fixture(t, { planner: () => ({ reply: "Started your list.", actions: [action("space", "create", { fields: fields({ title: "Gift ideas", layout: "list" }) }), action("space_item", "create", { fields: fields({ title: "Handwritten letter" }) })] }) });
  const response = await f.turn("Start a gift ideas list with a handwritten letter");
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.session.messages.at(-1).text, "Started your list.");
  const mine = (await f.request("/spaces")).body.spaces.filter((space) => !space.system);
  assert.deepEqual(mine.map((space) => [space.visibility, space.title, space.items.map((item) => item.title)]), [["private", "Gift ideas", ["Handwritten letter"]]]);
  assert.deepEqual((await f.request("/spaces", "GET", null, f.ids[1])).body.spaces.filter((space) => !space.system), []);
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
  const partnerView = (await f.request("/spaces", "GET", null, f.ids[1])).body.spaces.filter((space) => !space.system);
  assert.deepEqual(partnerView.map((space) => [space.visibility, space.title, space.items.map((item) => item.title)]), [["shared", "Beach packing", ["Sunscreen"]]]);
  spaceId = partnerView[0].id;
  assert.equal((await f.request(`/space-items/${partnerView[0].items[0].id}`, "PATCH", { done: true }, f.ids[1])).status, 200);

  const prepared = await f.turn("Add my passport to our beach list");
  const card = prepared.body.session.messages.at(-1).cards.find((item) => item.kind === "space_share");
  assert.equal(card.status, "draft");
  assert.deepEqual((await f.request("/spaces", "GET", null, f.ids[1])).body.spaces.filter((space) => !space.system)[0].items.map((item) => item.title), ["Sunscreen"]);
  assert.equal((await f.request(`/assistant/sessions/${f.session.id}/space-confirm`, "POST", { cardId: card.id, digest: "0".repeat(64) })).status, 409);
  const confirmed = await f.request(`/assistant/sessions/${f.session.id}/space-confirm`, "POST", { cardId: card.id, digest: card.digest });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  const items = (await f.request("/spaces", "GET", null, f.ids[1])).body.spaces.filter((space) => !space.system).find((space) => space.id === spaceId).items;
  assert.deepEqual(items.map((item) => [item.title, item.done]), [["Sunscreen", true], ["Passport", false]]);
});

test("a shared action that cannot be applied leaves nothing behind and the Agent says so", async (t) => {
  const f = await fixture(t, { shared: () => ({ reply: "Added it.", draftAgreement: null, actions: [together({ kind: "space_item", spaceId: randomUUID(), title: "Ghost" })] }) });
  const sent = await f.request("/together/messages", "POST", { text: "Pinky, add a ghost", itemId: randomUUID(), language: "en" });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.match(sent.body.reply.text, /couldn't do that/);
  assert.deepEqual((await f.request("/spaces")).body.spaces.filter((space) => !space.system), []);
});

test("asking privately puts the same question in each partner's own chat and nowhere else", async (t) => {
  const f = await fixture(t, { shared: () => ({ reply: "I asked each of you privately.", draftAgreement: null, actions: [together({ kind: "ask_privately", text: "Where would you like to spend New Year, and why?" })] }) });
  await f.turn("PRIVATE_A: I would rather stay home");
  const sent = await f.request("/together/messages", "POST", { text: "Pinky, help us decide where to spend New Year", itemId: randomUUID(), language: "en" });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  const mine = (await f.request(`/assistant/sessions/${f.session.id}`)).body.session.messages.at(-1);
  assert.deepEqual([mine.role, mine.text], ["assistant", "Where would you like to spend New Year, and why?"]);
  const theirs = (await f.request("/assistant/sessions/latest", "GET", null, f.ids[1])).body.session;
  assert.deepEqual(theirs.messages.map((message) => message.text), ["Where would you like to spend New Year, and why?"]);
  assert.ok(!JSON.stringify(theirs).includes("PRIVATE_A"));
  assert.ok(!JSON.stringify((await f.request("/together", "GET", null, f.ids[1])).body).includes("PRIVATE_A"));
});

test("a private photo stays private until its owner confirms putting it in a shared album", async (t) => {
  let album = null;
  const f = await fixture(t, {
    shared: () => ({ reply: "Album ready.", draftAgreement: null, actions: [together({ title: "Trip album", layout: "gallery" })] }),
    planner: (context) => ({ reply: "", actions: [action("space_item", "create", { fields: fields({ title: "Sunset", spaceId: album, photoId: context.attachedPhotos[0] }) })] }),
  });
  const mine = (await f.upload("private")).photo;
  assert.equal(await f.photo(mine.id), 200);
  assert.equal(await f.photo(mine.id, f.ids[1]), 404);
  await f.request("/together/messages", "POST", { text: "Pinky, start a trip album", itemId: randomUUID(), language: "en" });
  album = (await f.request("/spaces")).body.spaces.filter((space) => !space.system)[0].id;
  const turn = await f.request(`/assistant/sessions/${f.session.id}/messages`, "POST", { text: "Put this in our trip album", itemId: randomUUID(), photoIds: [mine.id] });
  assert.equal(turn.status, 200, JSON.stringify(turn.body));
  assert.deepEqual(turn.body.session.messages.at(-2).photoIds, [mine.id]);
  const card = turn.body.session.messages.at(-1).cards[0];
  assert.equal(card.kind, "space_share");
  assert.deepEqual((await f.request("/spaces", "GET", null, f.ids[1])).body.spaces.filter((space) => !space.system)[0].items, []);
  await f.request(`/assistant/sessions/${f.session.id}/space-confirm`, "POST", { cardId: card.id, digest: card.digest });
  const [item] = (await f.request("/spaces", "GET", null, f.ids[1])).body.spaces.filter((space) => !space.system)[0].items;
  assert.notEqual(item.photoId, mine.id);
  assert.equal(await f.photo(item.photoId, f.ids[1]), 200);
  assert.equal(await f.photo(mine.id, f.ids[1]), 404);
});

test("only a shared photo of this couple can be sent to Us", async (t) => {
  const f = await fixture(t);
  const mine = (await f.upload("private")).photo, ours = (await f.upload("shared")).photo;
  assert.equal((await f.request("/together/messages", "POST", { text: "look", itemId: randomUUID(), photoIds: [mine.id], language: "en" })).status, 400);
  const sent = await f.request("/together/messages", "POST", { text: "", itemId: randomUUID(), photoIds: [ours.id], language: "en" });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(await f.photo(ours.id, f.ids[1]), 200);
});

test("mediation posts one shared reflection and each person's feedback only to that person", async (t) => {
  let seen = null;
  const f = await fixture(t, {
    shared: () => ({ reply: "", draftAgreement: null, actions: [together({ kind: "mediate" })] }),
    mediate: (context, members) => { seen = context; return { shared: "You both want to feel heard.", feedback: [{ memberId: members[0].id, text: "FOR_A_ONLY" }, { memberId: members[1].id, text: "FOR_B_ONLY" }] }; },
  });
  await f.request("/together/messages", "POST", { text: "You never listen", itemId: randomUUID(), language: "en" }, f.ids[1]);
  const sent = await f.request("/together/messages", "POST", { text: "Pinky, help us with this", itemId: randomUUID(), language: "en" });
  assert.equal(sent.body.reply.text, "You both want to feel heard.");
  assert.ok(seen.messages.some((message) => message.text === "You never listen" && message.from));
  const mine = JSON.stringify((await f.request(`/assistant/sessions/${f.session.id}`)).body.session);
  const theirs = JSON.stringify((await f.request("/assistant/sessions/latest", "GET", null, f.ids[1])).body.session);
  assert.ok(mine.includes("FOR_A_ONLY") && !mine.includes("FOR_B_ONLY"));
  assert.ok(theirs.includes("FOR_B_ONLY") && !theirs.includes("FOR_A_ONLY"));
  assert.ok(!JSON.stringify((await f.request("/together")).body).includes("FOR_"));
});

test("on one shared phone a sentence can be attributed to the partner, marked as recorded on this phone", async (t) => {
  const f = await fixture(t);
  const sent = await f.request("/together/messages", "POST", { text: "I felt left out", itemId: randomUUID(), speaker: "partner", language: "en" });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  const line = (await f.request("/together", "GET", null, f.ids[1])).body.conversation.messages.find((message) => message.text === "I felt left out");
  assert.deepEqual([line.actorUserId, line.recordedByUserId, line.source], [f.ids[1], f.ids[0], "voice"]);
  const own = await f.request("/together/messages", "POST", { text: "Me too", itemId: randomUUID(), language: "en" });
  assert.equal(own.body.message.recordedByUserId, undefined);
});

test("every member has one private moments album and the couple one shared album, which cannot be archived", async (t) => {
  const f = await fixture(t);
  const [mine, theirs] = await Promise.all([f.request("/spaces"), f.request("/spaces", "GET", null, f.ids[1])]);
  const albums = (spaces) => spaces.filter((space) => space.system === "moments").map((space) => space.visibility).sort();
  assert.deepEqual(albums(mine.body.spaces), ["private", "shared"]);
  assert.deepEqual(albums(theirs.body.spaces), ["private", "shared"]);
  assert.deepEqual(albums((await f.request("/spaces")).body.spaces), ["private", "shared"], "asking again creates nothing new");
  const shared = mine.body.spaces.find((space) => space.system === "moments" && space.visibility === "shared");
  assert.equal(theirs.body.spaces.find((space) => space.system === "moments" && space.visibility === "shared").id, shared.id, "both partners share the same album");
  assert.equal((await f.request(`/spaces/${shared.id}/archive`, "POST", {})).status, 403);
});

test("on the day, Pinky recalls the couple's shared moments from earlier years in Us once, never private ones", async (t) => {
  const today = new Date().toISOString().slice(0, 10), lastYear = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  let album = null;
  const f = await fixture(t, { shared: () => ({ reply: "Kept it.", draftAgreement: null, actions: [together({ kind: "space_item", spaceId: album, title: "First trip to the sea", date: lastYear })] }) });
  album = (await f.request("/spaces")).body.spaces.find((space) => space.system === "moments" && space.visibility === "shared").id;
  await f.request("/together/messages", "POST", { text: "Pinky, keep our sea trip", itemId: randomUUID(), language: "en" });
  const open = async (userId) => (await f.request("/together?language=en&timezone=UTC", "GET", null, userId)).body.conversation.messages.filter((message) => message.handle?.startsWith("onthisday:"));
  const first = await open(f.ids[1]);
  assert.equal(first.length, 1);
  assert.equal(first[0].i18n.en, "1 year ago today: First trip to the sea");
  assert.equal((await open(f.ids[0])).length, 1, "posted once a day, whoever opens Us first");
});
