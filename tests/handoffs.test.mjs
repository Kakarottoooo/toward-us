import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { bookTable, buy } from "../server/handoffs.mjs";
import { validateAssistantTurn, normalizeAssistantTurn } from "../server/assistant-agent.mjs";
import { createFileStore } from "../server/store.mjs";
import { createReminderService } from "../server/reminder-service.mjs";
import { createAssistantRouter } from "../server/assistant-router.mjs";
import { createTogetherRouter } from "../server/together-router.mjs";

// "Pinky does things for you, you tap the last step" (founder 11-06): bookings and purchases become links into the real
// services with everything filled in; Pinky never books, pays, sends or calls by itself.
const table = { name: "海底捞", area: "法拉盛", date: "2026-11-07", time: "19:00", partySize: 2, phone: null, website: null, store: null, budget: null };
const urls = (result) => result.cards.map((card) => card.url);

test("a table becomes OpenTable, Resy and map searches already set to the day, time and party size", () => {
  const result = bookTable(table, { language: "en", today: "2026-11-06" });
  const [openTable, resy, map] = urls(result).map((url) => new URL(url));
  assert.equal(openTable.origin + openTable.pathname, "https://www.opentable.com/s");
  assert.equal(openTable.searchParams.get("dateTime"), "2026-11-07T19:00"); assert.equal(openTable.searchParams.get("covers"), "2");
  assert.equal(openTable.searchParams.get("term"), "海底捞 法拉盛");
  assert.equal(resy.hostname, "resy.com"); assert.equal(resy.searchParams.get("seats"), "2"); assert.equal(resy.searchParams.get("date"), "2026-11-07");
  assert.equal(map.origin + map.pathname, "https://www.google.com/maps/search/"); assert.equal(map.searchParams.get("query"), "海底捞 法拉盛");
  assert.equal(result.cards.length, 3, "no Dianping outside Chinese, no call or website when unknown");
  assert.deepEqual(result.cards.map((card) => card.title), ["Book on OpenTable", "Book on Resy", "See 海底捞 on the map"]);
  assert.match(result.summary, /Sat, Nov 7 at 19:00, 2 people, 海底捞 \(法拉盛\)\. Tap below to book; you confirm the last step yourself\./);
  assert.equal(result.script, "");
});

test("every value is URL-encoded, so a name cannot break out of its parameter", () => {
  const result = bookTable({ ...table, name: "Tom & Jerry's #1?", area: "NYC/SoHo" }, { language: "es" });
  for (const url of urls(result)) assert.doesNotMatch(url, /[ #']|& |\?.*\?/);
  assert.equal(new URL(urls(result)[0]).searchParams.get("term"), "Tom & Jerry's #1? NYC/SoHo");
  assert.equal(new URL(urls(result)[0]).searchParams.get("covers"), "2", "the party size survives the ampersand in the name");
  const bought = buy({ ...table, name: "a&b=c #gift" }, { language: "en" });
  assert.equal(new URL(urls(bought)[0]).searchParams.get("k"), "a&b=c #gift");
});

test("Dianping and Taobao only in Chinese; a call link only with a phone number; the restaurant's own site only when it is a web page", () => {
  const zh = bookTable({ ...table, phone: "+1 (718) 555-0100", website: "https://example.com/book" }, { language: "zh" });
  assert.ok(urls(zh).includes(`https://www.dianping.com/search/keyword/0/0_${encodeURIComponent("海底捞 法拉盛")}`));
  assert.ok(urls(zh).includes("tel:+17185550100")); assert.ok(urls(zh).includes("https://example.com/book"));
  assert.match(zh.summary, /19:00，2 位，海底捞（法拉盛）。点下面去订，最后一步你自己确认。/);
  assert.match(zh.script, /^打电话可以这样说：“你好，我想订 .+19:00 的位子，2 位。”$/);
  for (const language of ["en", "es"]) assert.ok(!urls(bookTable(table, { language })).some((url) => url.includes("dianping")));
  assert.ok(!urls(bookTable({ ...table, phone: "call them", website: "javascript:alert(1)" }, { language: "zh" })).some((url) => /^(tel|javascript):/.test(url)));
  assert.ok(urls(buy({ name: "蜡烛" }, { language: "zh" })).some((url) => url.startsWith("https://s.taobao.com/search?q=")));
  for (const language of ["en", "es"]) assert.ok(!urls(buy({ name: "candle" }, { language })).some((url) => url.includes("taobao")));
});

test("a purchase hands over the named store, Amazon and Google Shopping, and keeps the budget in the words only", () => {
  const result = buy({ name: "scented candle", store: "https://www.etsy.com/listing/1", budget: "$50" }, { language: "en" });
  assert.deepEqual(result.cards.map((card) => card.title), ["Buy at etsy.com", "Find scented candle on Amazon", "Compare prices on Google Shopping"]);
  assert.equal(urls(result)[0], "https://www.etsy.com/listing/1");
  assert.ok(!urls(result).some((url) => url.includes("50")));
  assert.match(result.summary, /scented candle \(budget \$50\): .*checkout and payment are yours/);
  assert.equal(new URL(urls(buy({ name: "candle", store: "Costco" }, { language: "en" }))[1]).searchParams.get("q"), "candle Costco");
});

test("a missing date, time or party size is asked for, never guessed", () => {
  assert.deepEqual(bookTable({ ...table, date: null, partySize: null }, { language: "zh" }).missing, ["date", "partySize"]);
  assert.match(bookTable({ ...table, time: "7pm" }, { language: "zh" }).question, /几点/);
  assert.match(bookTable({ ...table, partySize: 0 }, { language: "en" }).question, /how many people/);
  assert.deepEqual(bookTable({ ...table, date: "2026-02-30" }).missing, ["date"]);
  assert.deepEqual(bookTable(table, { today: "2026-11-08" }).missing, ["date"], "a day already past");
  assert.deepEqual(buy({ name: "  " }).missing, ["name"]);
});

const fields = (patch = {}) => ({ title: null, text: null, localDateTime: null, timezone: null, frequency: null, date: null, mood: null, layout: null, spaceId: null, done: null, photoId: null, handoff: null, ...patch });
const action = (patch = {}) => ({ kind: "handoff", operation: "book_table", targetId: null, expectedVersion: null, fields: fields({ handoff: table }), query: null, queryPeriod: "all", occurrence: null, ...patch });

test("the planner contract: a handoff carries its details, and only a handoff does", () => {
  assert.equal(validateAssistantTurn({ reply: "", actions: [action()] }), true);
  assert.equal(validateAssistantTurn({ reply: "", actions: [action({ operation: "create" })] }), false);
  assert.equal(validateAssistantTurn({ reply: "", actions: [action({ fields: fields() })] }), false);
  assert.equal(validateAssistantTurn({ reply: "", actions: [action({ kind: "link", fields: fields({ title: "x", handoff: table }) })] }), false);
  assert.equal(validateAssistantTurn({ reply: "", actions: [action({ kind: "reminder", operation: "buy" })] }), false);
  const { handoff, ...older } = fields({ title: "x", text: "https://example.com" });
  assert.equal(validateAssistantTurn(normalizeAssistantTurn({ reply: "", actions: [action({ kind: "link", operation: "create", fields: older })] })), true, "older planners without the field still pass");
});

test("empty action fields repeated at the top of a planner answer do not refuse a good reply", () => {
  const stray = { reply: "记下了：阿凯压力大时不喜欢被追问。", actions: [], query: null, queryPeriod: "all", occurrence: null };
  assert.deepEqual(normalizeAssistantTurn(stray), { reply: stray.reply, actions: [] });
  assert.equal(validateAssistantTurn(normalizeAssistantTurn(stray)), true);
  assert.equal(validateAssistantTurn(normalizeAssistantTurn({ ...stray, query: "阿凯" })), false, "an extra with content still fails");
  // Use-case round 5: a screenshot import came back without fields.frequency and was refused with a 502.
  const { frequency, ...withoutFrequency } = fields();
  assert.equal(validateAssistantTurn(normalizeAssistantTurn({ reply: "", actions: [action({ kind: "chat_import", operation: "create", fields: withoutFrequency })] })), true);
});

async function setup(t, plan) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "handoffs-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const id of ids) await store.createUser({ id, email: `${id}@example.invalid`, name: id === ids[0] ? "Ziwei" : "Mia", passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  const mediator = { planAssistantTurn: async () => plan(), continueTogether: async () => ({ reply: "ok", draftAgreement: null, actions: [] }) };
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createAssistantRouter({ store, mediator, reminderService: createReminderService({ store }) }));
  app.use("/api", createTogetherRouter({ store, mediator }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  const request = async (path, method = "GET", body, userId = ids[0]) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  const session = (await request("/assistant/sessions", "POST", { language: "zh", timezone: "UTC" })).body.session;
  const say = (text) => request(`/assistant/sessions/${session.id}/messages`, "POST", { text, itemId: randomUUID(), language: "zh" });
  return { store, ids, request, say };
}

test("in Just me, a booking becomes link cards and a summary, and nothing is sent, shared or saved", async (t) => {
  const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const { store, ids, request, say } = await setup(t, () => ({ reply: "已经帮你订好了！", actions: [action({ fields: fields({ handoff: { ...table, date: day, phone: "718-555-0100" } }) })] }));
  const turn = await say("帮我订周六晚上七点海底捞法拉盛，两个人");
  assert.equal(turn.status, 200, JSON.stringify(turn.body));
  const reply = turn.body.session.messages.at(-1);
  assert.ok(reply.cards.length >= 5 && reply.cards.every((card) => card.kind === "link" && card.status === "active" && card.title && card.url));
  assert.ok(reply.cards.some((card) => card.url.startsWith("https://www.opentable.com/s?") && card.url.includes(`dateTime=${day}T19%3A00`) && card.url.includes("covers=2")));
  assert.ok(reply.cards.some((card) => card.url === "tel:7185550100"));
  assert.ok(reply.cards.some((card) => card.url.includes("dianping.com")));
  assert.match(reply.text, /19:00，2 位，海底捞（法拉盛）。点下面去订，最后一步你自己确认。\n打电话可以这样说/);
  assert.doesNotMatch(reply.text, /订好了/, "the server, not the model, says what was prepared, and never that it is booked");
  for (const card of reply.cards) assert.ok(!card.url.includes("Ziwei") && !card.url.includes(ids[0]), "nothing of the member's own goes into a link");
  const us = (await request("/together?language=zh", "GET", null, ids[1])).body.conversation.messages;
  assert.deepEqual(us.filter((message) => message.kind !== "daily_question"), [], "nothing reaches the partner");
  for (const collection of ["reminders", "milestones", "agreements"]) assert.deepEqual(await store.listRelationshipRecordsForUser(collection, ids[0]), [], `no ${collection}`);
  const thread = (await store.listRelationshipRecordsForUser("privateAgentThreads", ids[0]))[0];
  assert.equal(thread.partnerMessage, undefined); assert.equal(thread.pendingShares, undefined);
});

test("in Just me, a booking without a time or party size asks for it instead of preparing links", async (t) => {
  const { say } = await setup(t, () => ({ reply: "订好了！", actions: [action({ fields: fields({ handoff: { ...table, date: "2099-01-02", time: null, partySize: null } }) })] }));
  const turn = await say("帮我订海底捞");
  assert.equal(turn.status, 200, JSON.stringify(turn.body));
  const reply = turn.body.session.messages.at(-1);
  assert.equal(reply.text, "订位还差一点：几点、几位？");
  assert.ok(!reply.cards?.length);
});

test("in Just me, a purchase hands over shopping links in the member's language", async (t) => {
  const { say } = await setup(t, () => ({ reply: "", actions: [action({ operation: "buy", fields: fields({ handoff: { ...table, name: "香薰蜡烛", area: null, date: null, time: null, partySize: null, budget: "300元" } }) })] }));
  const turn = await say("帮我买个香薰蜡烛，300 以内");
  assert.equal(turn.status, 200, JSON.stringify(turn.body));
  const reply = turn.body.session.messages.at(-1);
  assert.deepEqual(reply.cards.map((card) => new URL(card.url).hostname), ["www.amazon.com", "www.google.com", "s.taobao.com"]);
  assert.match(reply.text, /「香薰蜡烛」，预算 300元，.*下单付款你自己来/);
});
