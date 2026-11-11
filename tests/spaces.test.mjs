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
import { archiveSpaceRecord } from "../server/space-domain.mjs";

const fields = (patch = {}) => ({ title: null, text: null, localDateTime: null, timezone: null, frequency: null, date: null, mood: null, layout: null, spaceId: null, done: null, photoId: null, ...patch });
const action = (kind, operation, patch = {}) => ({ kind, operation, targetId: null, expectedVersion: null, fields: fields(), query: null, queryPeriod: "all", occurrence: null, ...patch });
const together = (patch = {}) => ({ kind: "space", operation: "create", targetId: null, spaceId: null, title: null, text: null, date: null, layout: null, done: null, recurringRule: "once", remindDaysBefore: null, photoId: null, ...patch });

async function fixture(t, { planner = () => ({ reply: "", actions: [] }), shared = () => ({ reply: "ok", draftAgreement: null, actions: [] }), mediate = null, structured = null } = {}) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "spaces-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const id of ids) await store.createUser({ id, email: `${id}@example.invalid`, name: "Synthetic person", passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  const mediator = { planAssistantTurn: async (...args) => planner(...args), continueTogether: async (...args) => shared(...args), ...(mediate ? { mediateTogether: async (...args) => mediate(...args) } : {}), ...(structured ? { structured: async (...args) => structured(...args) } : {}), createRealtimeSession: async () => "v=0\r\n" };
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
  return { ids, store, request, session, upload, photo, turn: (text) => request(`/assistant/sessions/${session.id}/messages`, "POST", { text, itemId: randomUUID() }) };
}

test("a private space and its items stay with their owner", async (t) => {
  const f = await fixture(t, { planner: () => ({ reply: "Started your list.", actions: [action("space", "create", { fields: fields({ title: "Gift ideas", layout: "list" }) }), action("space_item", "create", { fields: fields({ title: "Handwritten letter" }) })] }) });
  const response = await f.turn("Start a gift ideas list with a handwritten letter");
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.match(response.body.session.messages.at(-1).text, /Created "Gift ideas", visible only to you\./);
  assert.match(response.body.session.messages.at(-1).text, /Added\./);
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
  assert.equal(theirs.messages[0].text, "Where would you like to spend New Year, and why?");
  assert.ok(theirs.messages.slice(1).every((message) => message.role === "assistant" && !/New Year/.test(message.text)), "only Pinky's own opening question may follow, for a member it barely knows");
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
  await assert.rejects(f.store.transaction("test", (tx) => archiveSpaceRecord(tx, { userId: f.ids[0], collection: "spaces", id: shared.id })), { statusCode: 403 });
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

test("a memory Pinky keeps for one of the 100 little things carries its number, so the list can tick it off", async (t) => {
  let album = null;
  const f = await fixture(t, { shared: () => ({ reply: "Kept it.", draftAgreement: null, actions: [together({ kind: "space_item", spaceId: album, title: "Sunset at the beach", idea: 1 }), together({ kind: "space_item", spaceId: album, title: "Not an idea", idea: 500 })] }) });
  album = (await f.request("/spaces")).body.spaces.find((space) => space.system === "moments" && space.visibility === "shared").id;
  await f.request("/together/messages", "POST", { text: "Pinky, we watched a sunset at the beach! (100 little things #1)", itemId: randomUUID(), language: "en" });
  const items = (await f.request("/spaces", "GET", null, f.ids[1])).body.spaces.find((space) => space.id === album).items;
  assert.equal(items.find((item) => item.title === "Sunset at the beach").idea, 1, "the partner sees it ticked too");
  assert.equal(items.find((item) => item.title === "Not an idea").idea, undefined, "only 1-100 counts");
});

test("recap cards: made on a day worth celebrating or on request, from shared moments only, once per occasion", async (t) => {
  const { celebrationOn, storyMaterial } = await import("../server/story.mjs");
  assert.deepEqual(celebrationOn("2025-05-20", "2025-08-27"), { key: "day-100", kind: "day", day: 100 });
  assert.deepEqual(celebrationOn("2025-05-20", "2026-05-20"), { key: "anniversary-1", kind: "anniversary", years: 1, day: 366 });
  assert.equal(celebrationOn("2025-05-20", "2025-08-28"), null);
  const today = new Date().toISOString().slice(0, 10), since = new Date(Date.parse(`${today}T00:00:00Z`) - 99 * 86_400_000).toISOString().slice(0, 10);
  let album = null, step = "since", seen = null;
  const f = await fixture(t, {
    shared: () => step === "since" ? { reply: "Noted.", draftAgreement: null, actions: [together({ kind: "milestone", title: "Together", date: since, recurringRule: "yearly", text: "together_since" })] }
      : step === "moment" ? { reply: "Kept.", draftAgreement: null, actions: [together({ kind: "space_item", spaceId: album, title: "Picnic", date: since, photoId: null })] }
      : { reply: "I'll make one now.", draftAgreement: null, actions: [together({ kind: "recap", title: "just because" })] },
    structured: ({ name, input }) => { if (name !== "couple_recap") return { question: "", reply: "" }; seen = JSON.parse(input); return { title: "100 days", subtitle: "So far", coverPhotoId: "not-a-shared-photo", stats: [{ label: "Days", value: "100" }], chapters: [{ heading: "A picnic", text: "You had a picnic.", date: since, photoId: "not-a-shared-photo" }], closing: "More to come." }; },
  });
  album = (await f.request("/spaces")).body.spaces.find((space) => space.system === "moments" && space.visibility === "shared").id;
  const say = (text) => f.request("/together/messages", "POST", { text, itemId: randomUUID(), language: "en" });
  await say("Pinky, we got together 99 days ago"); step = "moment"; await say("Pinky, keep our picnic");
  const privateAlbum = (await f.request("/spaces")).body.spaces.find((space) => space.system === "moments" && space.visibility === "private");
  const stories = async (userId = f.ids[0]) => (await f.request("/together?language=en&timezone=UTC", "GET", null, userId)).body.conversation.messages.filter((message) => message.kind === "story");
  await stories(f.ids[1]);
  for (let i = 0; i < 50 && !(await stories()).length; i += 1) await new Promise((r) => setTimeout(r, 40));
  const [story] = await stories();
  assert.equal(story.story.title, "100 days");
  assert.equal(story.story.coverPhotoId, null, "a photo id outside the shared album is dropped");
  assert.equal(story.story.chapters[0].photoId, null);
  assert.deepEqual(seen.moments.map((moment) => moment.title), ["Picnic"]);
  assert.ok(privateAlbum && !JSON.stringify(seen).includes(privateAlbum.id));
  await stories(f.ids[1]); await new Promise((r) => setTimeout(r, 200));
  assert.equal((await stories()).length, 1, "one card per occasion, whoever opens Us");
  step = "recap"; await say("Pinky, make us a recap");
  for (let i = 0; i < 50 && (await stories()).length < 2; i += 1) await new Promise((r) => setTimeout(r, 40));
  assert.equal((await stories()).length, 2, "asking for one makes another");
});

test("weekly recap: the first open after a week ends makes one card from that week only, and a quiet week makes none", async (t) => {
  const { lastWeek } = await import("../server/story.mjs");
  assert.deepEqual(lastWeek("2026-11-09"), { key: "week-2026-11-02", from: "2026-11-02", to: "2026-11-08" }, "Monday: the week that just ended");
  assert.deepEqual(lastWeek("2026-11-08"), { key: "week-2026-10-26", from: "2026-10-26", to: "2026-11-01" }, "Sunday: that week is not over yet");
  let seen = null, calls = 0;
  const f = await fixture(t, { structured: ({ name, input, instructions }) => { if (name !== "couple_recap") return { question: "", reply: "" }; calls += 1; seen = { material: JSON.parse(input), instructions }; return { title: "Your week", subtitle: "", coverPhotoId: null, stats: [], chapters: [{ heading: "Dinner", text: "You picked a place.", date: null, photoId: null }], closing: "See you next week." }; } });
  const stories = async (userId = f.ids[0]) => (await f.request("/together?language=en&timezone=UTC", "GET", null, userId)).body.conversation.messages.filter((message) => message.kind === "story");
  const say = (text) => f.request("/together/messages", "POST", { text, itemId: randomUUID(), language: "en" });
  await say("Pinky, where should we eat on Saturday?"); await say("this one is from today");
  await stories(); await new Promise((r) => setTimeout(r, 100));
  assert.equal(calls, 0, "nothing happened last week, so no card and no model call");
  // Move the first exchange into last week, as if it had been said then.
  const week = lastWeek(new Date().toISOString().slice(0, 10));
  const conversation = (await f.store.relationshipSnapshotForUser(f.ids[0])).togetherConversations[0];
  await f.store.updateRelationshipRecordForUser("togetherConversations", conversation.id, f.ids[0], (draft) => { for (const message of draft.messages.slice(0, 2)) message.createdAt = `${week.from}T12:00:00.000Z`; draft.version += 1; });
  await stories(f.ids[1]);
  for (let i = 0; i < 50 && !(await stories()).length; i += 1) await new Promise((r) => setTimeout(r, 40));
  assert.equal((await stories()).length, 1);
  assert.deepEqual(seen.material.week.conversation.map((message) => message.text), ["Pinky, where should we eat on Saturday?", "ok"]);
  assert.match(seen.instructions, /weekly recap/);
  await stories(f.ids[1]); await new Promise((r) => setTimeout(r, 200));
  assert.equal((await stories()).length, 1, "one card per week, whoever opens Us");
});

test("daily question follows the opener's interface language, not the language the couple writes in", async (t) => {
  const asked = {};
  const f = await fixture(t, {
    shared: () => ({ reply: "好的", draftAgreement: null, actions: [] }),
    structured: ({ name, instructions }) => { asked[name] = instructions; return name === "daily_question" ? { question: "今天什么时候最想见到 TA？" } : { reply: "你们都想到了对方。" }; },
  });
  const [a, b] = f.ids;
  for (const [userId, text] of [[a, "这周末要不要回我爸妈家吃饭？"], [b, "我这周有点累，想周六在家休息"]]) await f.request("/together/messages", "POST", { text, itemId: randomUUID(), language: "en" }, userId);
  const open = async (userId) => (await f.request("/together?language=en&timezone=UTC", "GET", null, userId)).body.conversation.messages;
  let question = null;
  for (let i = 0; i < 50 && !question; i += 1) { question = (await open(a)).find((message) => message.kind === "daily_question"); if (!question) await new Promise((r) => setTimeout(r, 40)); }
  assert.match(asked.daily_question, /in English/, "an English interface gets an English question even when the couple writes Chinese");
  for (const [userId, text] of [[a, "你做的早饭"], [b, "你下班前的拥抱"]]) await f.request(`/together/daily/${question.id}/answer`, "POST", { text, language: "en" }, userId);
  let reaction = null;
  for (let i = 0; i < 50 && !reaction; i += 1) { reaction = (await open(a)).find((message) => message.replyTo === question.id && message.role === "agent"); if (!reaction) await new Promise((r) => setTimeout(r, 40)); }
  assert.match(asked.daily_reaction, /In English/);
});

test("Pinky answers in Us in the interface language of whoever called it, whatever language they write in", async (t) => {
  const replied = [], mediated = [];
  const f = await fixture(t, {
    shared: (context, language) => { replied.push(language); return /看看|help/.test(context.messages.at(-1).text) ? { reply: "", draftAgreement: null, actions: [together({ kind: "mediate" })] } : { reply: "好的", draftAgreement: null, actions: [] }; },
    mediate: (_context, members, language) => { mediated.push(language); return { shared: "You both want to be heard.", feedback: members.map((member) => ({ memberId: member.id, text: "x" })) }; },
  });
  const [a, b] = f.ids;
  // Both phones are set to English; the couple argues in Chinese and calls Pinky in Chinese: Pinky still answers in English
  // (founder 11-06: one language everywhere).
  await f.request("/together/messages", "POST", { text: "你从来不听我说话", itemId: randomUUID(), language: "en" }, b);
  const sent = await f.request("/together/messages", "POST", { text: "Pinky，帮我们看看刚才怎么了", itemId: randomUUID(), language: "en" }, a);
  assert.equal(sent.body.reply.text, "You both want to be heard.");
  assert.deepEqual([replied, mediated], [["en"], ["en"]]);
  // A phone set to Chinese gets Chinese, even for an English line.
  await f.request("/together/messages", "POST", { text: "Pinky, thanks for that", itemId: randomUUID(), language: "zh" }, a);
  assert.deepEqual(replied, ["en", "zh"]);
});

test("daily question: one a day for both; each answer stays hidden from the partner and the model until both answered", async (t) => {
  let context = null;
  const f = await fixture(t, {
    shared: (input) => { context = input; return { reply: "ok", draftAgreement: null, actions: [] }; },
    structured: ({ name, input }) => name === "daily_question" ? { question: "What made you smile today?" } : name === "daily_reaction" ? { reply: `You both answered: ${JSON.parse(input).answers.map((item) => item.text).join(" / ")}` } : { question: "", reply: "" },
  });
  const [a, b] = f.ids;
  const open = async (userId) => (await f.request("/together?language=en&timezone=UTC", "GET", null, userId)).body.conversation.messages;
  const daily = async (userId) => (await open(userId)).filter((message) => message.kind === "daily_question");
  await open(a);
  for (let i = 0; i < 50 && !(await daily(a)).length; i += 1) await new Promise((r) => setTimeout(r, 40));
  await open(b); await f.request("/together?language=en&timezone=Pacific/Kiritimati", "GET", null, b); await new Promise((r) => setTimeout(r, 100));
  const [question] = await daily(b);
  assert.equal((await daily(a)).length, 1, "one question a day, whoever opens Us first, even from a time zone already on tomorrow");
  assert.equal(question.text, "What made you smile today?");
  const answer = (userId, text) => f.request(`/together/daily/${question.id}/answer`, "POST", { text, language: "en" }, userId);
  assert.equal((await answer(a, "first draft")).status, 200);
  assert.equal((await answer(a, "Your terrible pun at breakfast")).status, 200, "an answer can change until the partner answers");
  assert.deepEqual(Object.keys((await daily(a))[0].answers), [a]);
  assert.deepEqual((await daily(b))[0].answers, {}, "the partner cannot see an answer before giving their own");
  await f.request("/together/messages", "POST", { text: "Pinky, what did my partner answer?", itemId: randomUUID(), language: "en" }, b);
  assert.ok(!JSON.stringify(context).includes("terrible pun"), "nor can the model");
  const { hideUnrevealedAnswers } = await import("../server/relationship-domain.mjs");
  assert.deepEqual(hideUnrevealedAnswers({ messages: [{ answers: { [a]: { text: "x" } } }] }, b).messages[0].answers, {});
  assert.equal((await answer(b, "Your hug before work")).status, 200);
  const revealed = (await daily(b))[0].answers;
  assert.equal(revealed[a].text, "Your terrible pun at breakfast"); assert.equal(revealed[b].text, "Your hug before work");
  assert.equal((await answer(a, "too late")).status, 409, "revealed answers are final");
  let reaction = null;
  for (let i = 0; i < 50 && !reaction; i += 1) { reaction = (await open(a)).find((message) => message.replyTo === question.id && message.role === "agent"); if (!reaction) await new Promise((r) => setTimeout(r, 40)); }
  assert.match(reaction.text, /terrible pun/);
  await f.request("/together/messages", "POST", { text: "Pinky, that was sweet", itemId: randomUUID(), language: "en" }, a);
  assert.equal(context.messages.find((message) => message.id === question.id).answers.length, 2, "once revealed, Pinky can talk about both answers");
});
