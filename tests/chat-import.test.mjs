import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createReminderService } from "../server/reminder-service.mjs";
import { createAssistantRouter } from "../server/assistant-router.mjs";
import { createTogetherRouter } from "../server/together-router.mjs";
import { createChatImportRouter } from "../server/chat-import.mjs";

const fields = (patch = {}) => ({ title: null, text: null, localDateTime: null, timezone: null, frequency: null, date: null, mood: null, layout: null, spaceId: null, done: null, photoId: null, ...patch });
const action = (kind, operation, patch = {}) => ({ kind, operation, targetId: null, expectedVersion: null, fields: fields(), query: null, queryPeriod: "all", occurrence: null, ...patch });
const whatsapp = ["[1/2/24, 9:00:00 PM] Alex: are you coming home soon", "[1/2/24, 9:20:00 PM] Blair: running late, sorry", "[1/2/24, 9:21:00 PM] Alex: you always say that", "[1/3/24, 8:00:00 AM] Blair: I'm sorry about last night", "[1/3/24, 8:05:00 AM] Alex: thank you, I love you"].join("\n");
const report = { message: "You read each other closely.", overview: "Lateness sets off most arguments; repairs come the next morning.", conflictCycle: "Alex asks, Blair goes quiet.", patterns: [{ title: "Lateness", detail: "Being late starts arguments.", evidence: [{ date: "2024-01-02", speaker: "Alex", quote: "you always say that" }] }], strengths: [], hurts: [], suggestions: [], moments: [], dates: [], promises: [], safety: { concern: false, note: null } };

async function fixture(t, { planner = () => ({ reply: "", actions: [] }), shared = () => ({ reply: "ok", draftAgreement: null, actions: [] }) } = {}) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "imports-"));
  const previous = process.env.TOWARD_US_DATA_FILE; process.env.TOWARD_US_DATA_FILE = join(directory, "store.json");
  const store = await createFileStore(join(directory, "store.json"));
  const people = [{ id: randomUUID(), name: "Alex" }, { id: randomUUID(), name: "Blair" }];
  for (const person of people) await store.createUser({ ...person, email: `${person.id}@example.invalid`, passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: people[0].id, role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: people[0].id, expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, people[1].id, new Date().toISOString());
  const calls = { planner: [], shared: [], structured: [] };
  const mediator = {
    planAssistantTurn: async (context) => { calls.planner.push(context); return planner(context); },
    continueTogether: async (context) => { calls.shared.push(context); return shared(context); },
    structured: async ({ name, input }) => { calls.structured.push({ name, input }); return name === "chat_history_part" ? { episodes: [{ date: "2024-01-02", kind: "conflict", title: "Late again", summary: "Blair was late.", speaker: "Alex", quote: "you always say that" }], themes: ["lateness"], tone: "tense" } : report; },
  };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { const person = people.find((item) => item.id === req.headers["x-user"]); if (person) req.auth = { user: person }; next(); });
  let assistantRouter;
  const imports = createChatImportRouter({ store, mediator, appendAssistantMessage: (...args) => assistantRouter.assistant.postNote(...args) });
  app.use("/api", imports);
  assistantRouter = createAssistantRouter({ store, mediator, reminderService: createReminderService({ store }), chatImports: imports });
  app.use("/api", assistantRouter);
  app.use("/api", createTogetherRouter({ store, mediator }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); process.env.TOWARD_US_DATA_FILE = previous; assert.ok(resolve(directory).startsWith(base)); await rm(directory, { recursive: true, force: true }); });
  const url = (path) => `http://127.0.0.1:${server.address().port}/api${path}`;
  const request = async (path, method = "GET", body, userId = people[0].id) => {
    const response = await fetch(url(path), { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  const upload = async (text, name = "WhatsApp Chat - Blair.txt", userId = people[0].id, session = "") => {
    const response = await fetch(url(`/imports?name=${encodeURIComponent(name)}&language=en${session ? `&session=${session}` : ""}`), { method: "POST", headers: { "x-user": userId, "content-type": "application/octet-stream" }, body: Buffer.from(text) });
    return { status: response.status, body: await response.json() };
  };
  const ready = async (id, userId = people[0].id) => {
    for (let index = 0; index < 400; index += 1) { const item = (await request(`/imports/${id}`, "GET", null, userId)).body.import; if (item?.status === "ready" || item?.status === "failed") return item; await new Promise((r) => setTimeout(r, 30)); }
    throw new Error("analysis did not finish");
  };
  const files = async () => (await readdir(`${process.env.TOWARD_US_DATA_FILE}.media`).catch(() => [])).filter((name) => name.endsWith(".chat.json"));
  const session = (await request("/assistant/sessions", "POST", { language: "en", timezone: "UTC" })).body.session;
  return { people, calls, request, upload, ready, files, session, url };
}

test("an imported chat is analyzed privately and reported back into the owner's conversation", async (t) => {
  const f = await fixture(t);
  const created = await f.upload(whatsapp, undefined, undefined, f.session.id);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.import.status, "analyzing", "the owner's own name and the one other person are recognized without asking");
  const item = await f.ready(created.body.import.id);
  assert.equal(item.status, "ready");
  assert.equal(item.messageCount, 5);
  assert.deepEqual(item.people.map(({ name, role }) => [name, role]), [["Alex", "me"], ["Blair", "partner"]]);
  assert.equal(item.stats.perPerson.me.messages, 3);
  assert.equal(item.analysis.overview, report.overview);
  assert.ok(!JSON.stringify(item).includes("running late"), "the API never returns the raw messages");
  assert.ok(f.calls.structured.some((call) => call.name === "chat_history_part" && call.input.includes("Blair: running late")), "the model reads the transcript with the chosen names");
  // The import is marked ready just before the report is posted, so wait for the report itself.
  let messages = [];
  for (let index = 0; index < 100 && messages.length < 2; index += 1) { messages = (await f.request(`/assistant/sessions/${f.session.id}`)).body.session.messages; if (messages.length < 2) await new Promise((r) => setTimeout(r, 30)); }
  assert.deepEqual(messages.map((message) => message.cards?.[0]?.kind), ["chat_import", "chat_import"]);
  assert.equal(messages.at(-1).text, report.message);
  // The partner sees nothing of it.
  assert.equal((await f.request(`/imports/${item.id}`, "GET", null, f.people[1].id)).status, 404);
  assert.deepEqual((await f.request("/imports", "GET", null, f.people[1].id)).body.imports, []);
  assert.equal((await f.request(`/imports/${item.id}/delete-messages`, "POST", {}, f.people[1].id)).status, 404);
});

test("a multi-conversation export asks which conversation and who is who before reading", async (t) => {
  const f = await fixture(t);
  const thread = (name, partner, count) => ({ title: partner, participants: [{ name: "Sam" }, { name: partner }], messages: Array.from({ length: count }, (_, index) => ({ sender_name: index % 2 ? partner : "Sam", timestamp_ms: 1704200000000 + index * 60000, content: `${name} ${index}` })) });
  const zipless = JSON.stringify(thread("hello", "Robin", 6));
  const single = await f.upload(zipless, "message_1.json");
  assert.equal(single.status, 201, JSON.stringify(single.body));
  assert.equal(single.body.import.status, "needs_people", "neither name is the member's own, so Pinky asks");
  assert.equal((await f.request(`/imports/${single.body.import.id}/people`, "POST", { me: "Sam", partner: "Sam" })).status, 400);
  const assigned = await f.request(`/imports/${single.body.import.id}/people`, "POST", { me: "Sam", partner: "Robin" });
  assert.equal(assigned.body.import.status, "analyzing");
  assert.equal((await f.ready(single.body.import.id)).status, "ready");
});

test("looking together needs the partner's approval, makes a separate shared copy, and can be undone", async (t) => {
  const f = await fixture(t, { shared: () => ({ reply: "Here is what I see.", draftAgreement: null, actions: [] }) });
  const id = (await f.upload(whatsapp)).body.import.id; await f.ready(id);
  assert.equal((await f.request(`/imports/${id}/share-request`, "POST", { language: "en" }, f.people[1].id)).status, 404, "only the owner can ask");
  assert.equal((await f.request(`/imports/${id}/share-request`, "POST", { language: "en" })).status, 200);
  const us = (await f.request("/together?language=en", "GET", null, f.people[1].id)).body;
  const ask = us.conversation.messages.find((message) => message.refs?.some((ref) => ref.type === "chat_import_request"));
  assert.ok(ask, "the request appears in Us");
  assert.equal((await f.request(`/imports/${id}/share-approve`, "POST", { language: "en" })).status, 404, "the owner cannot approve for the partner");
  const approved = await f.request(`/imports/${id}/share-approve`, "POST", { language: "en" }, f.people[1].id);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const copy = approved.body.import;
  assert.notEqual(copy.id, id); assert.equal(copy.shared, true);
  assert.equal((await f.request(`/imports/${copy.id}`, "GET", null, f.people[1].id)).body.import.analysis.overview, report.overview);
  assert.equal((await f.request(`/imports/${id}`, "GET", null, f.people[1].id)).status, 404, "the private original stays private");
  // The shared Agent sees only the shared copy.
  await f.request("/together/messages", "POST", { text: "Pinky, what do you see in our chats?", itemId: randomUUID(), language: "en" }, f.people[1].id);
  assert.deepEqual(f.calls.shared.at(-1).chatHistory.map((entry) => entry.id), [copy.id]);
  assert.equal((await f.files()).length, 2);
  assert.equal((await f.request(`/imports/${copy.id}/unshare`, "POST", {}, f.people[1].id)).status, 204);
  assert.equal((await f.request(`/imports/${copy.id}`)).status, 404);
  assert.equal((await f.files()).length, 1, "the shared copy's messages are deleted from disk");
  assert.equal((await f.request(`/imports/${id}`)).body.import.sharedCopyId, null);
});

test("the private Pinky reads analyses and searches the exact words only when asked", async (t) => {
  let importId = null;
  const f = await fixture(t, { planner: (context) => context.lookups ? { reply: `Found it: ${context.lookups[0].findings.includes("you always say that") ? "yes" : "no"}`, actions: [] } : { reply: "Let me look.", actions: [action("chat_search", "query", { targetId: importId, query: "always" })] } });
  importId = (await f.upload(whatsapp)).body.import.id; await f.ready(importId);
  const turn = await f.request(`/assistant/sessions/${f.session.id}/messages`, "POST", { text: "What did I say that night?", itemId: randomUUID() });
  assert.equal(turn.status, 200, JSON.stringify(turn.body));
  assert.equal(turn.body.session.messages.at(-1).text, "Found it: yes");
  assert.equal(f.calls.planner[0].chatImports[0].overview, report.overview);
  assert.ok(!JSON.stringify(f.calls.planner[0]).includes("running late"), "raw messages never enter the planner context unasked");
});

test("deleting really removes the messages, and a Mac upload token works once", async (t) => {
  const f = await fixture(t);
  const id = (await f.upload(whatsapp)).body.import.id; await f.ready(id);
  assert.equal((await f.files()).length, 1);
  assert.equal((await f.request(`/imports/${id}/delete-messages`, "POST", {})).body.import.rawDeleted, true);
  assert.equal((await f.files()).length, 0);
  assert.equal((await f.request(`/imports/${id}`)).body.import.analysis.overview, report.overview, "the analysis stays");
  assert.equal((await f.request(`/imports/${id}`, "DELETE")).status, 204);
  assert.equal((await f.request(`/imports/${id}`)).status, 404);
  const { command } = (await f.request("/imports/mac-command", "POST", { language: "en" })).body;
  const token = command.split(" ").at(-1);
  const helper = JSON.stringify({ format: "pinky-imessage", chat: { title: "+15550100" }, rows: [{ date: 726000000000000000, is_from_me: 1, handle: "+15550100", text: "hi love", body_hex: null, attachments: 0 }, { date: 726000060000000000, is_from_me: 0, handle: "+15550100", text: "hi you", body_hex: null, attachments: 0 }, { date: 726000120000000000, is_from_me: 1, handle: "+15550100", text: "dinner?", body_hex: null, attachments: 0 }] });
  const post = () => fetch(f.url(`/imports/upload/${token}`), { method: "POST", headers: { "content-type": "application/octet-stream" }, body: helper });
  const first = await post();
  const firstText = await first.text(); assert.equal(first.status, 200, firstText);
  assert.match(firstText, /Imported 3 messages/);
  assert.equal((await f.ready(firstText.trim().split("\n").at(-1))).people.find((person) => person.role === "me").name, "Alex", "the member's own lines carry their name");
  assert.equal((await post()).status, 401, "the token is single-use");
  assert.equal((await fetch(f.url("/imports/mac-helper.sh"))).status, 200, "the helper script needs no session");
  assert.equal((await fetch(f.url("/imports"))).status, 401);
});
