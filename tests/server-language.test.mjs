import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createApiApp } from "../server/app.mjs";
import { createMediator } from "../server/mediator.mjs";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { createReminderService } from "../server/reminder-service.mjs";
import { createTogetherRouter } from "../server/together-router.mjs";
import { createAssistantRouter } from "../server/assistant-router.mjs";
import { sendHeadsUps } from "../server/heads-up.mjs";

// The interface is complete in zh, en and es: a member reading English or Spanish never meets Chinese the server wrote.
const CJK = /[㐀-鿿]/;
const noChinese = (text, where) => assert.doesNotMatch(String(text), CJK, `${where}: ${text}`);

async function workDir(t, prefix) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, prefix));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return directory;
}

async function pairedStore(t, languages) {
  const store = await createFileStore(join(await workDir(t, "language-"), "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const [index, id] of ids.entries()) await store.createUser({ id, email: `${id}@example.invalid`, name: ["Ziwei", "Mia"][index], language: languages[index], passwordHash: "x", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z", createdAt: new Date().toISOString() } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  return { store, ids, relationshipId };
}

test("API errors read in the member's language: demo rooms, pairing, shared decisions and sign-in", async (t) => {
  const store = await createFileStore(join(await workDir(t, "language-api-"), "store.json"));
  const app = createApiApp({ store, mediator: {}, production: false });
  const server = app.listen(0, "127.0.0.1"); await new Promise((done) => server.once("listening", done));
  t.after(() => new Promise((done) => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { method = "GET", cookie, body, headers = {} } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: response.status === 204 ? null : await response.json(), headers: response.headers };
  };
  const register = async (name) => {
    const response = await call("/api/auth/register", { method: "POST", body: { name, email: `${name}-${randomUUID()}@example.com`, password: "correct-horse-battery" } });
    assert.equal(response.status, 201);
    return (response.headers.get("set-cookie") || "").split(";")[0];
  };

  // A quick-session room that does not exist: the visitor's browser language decides, Chinese stays for zh.
  for (const [accept, language] of [["en-US,en;q=0.9", "en"], ["es-ES", "es"]]) {
    const missing = await call("/api/demo/rooms/ABCDEFGH", { headers: { "accept-language": accept } });
    assert.equal(missing.status, 404); noChinese(missing.body.error, `demo room ${language}`);
  }
  assert.match((await call("/api/demo/rooms/ABCDEFGH", { headers: { "accept-language": "zh-CN" } })).body.error, CJK);

  // Signed in, the language the App saved for the member is used even when a request names none.
  const alice = await register("Alice"), bob = await register("Bob");
  for (const cookie of [alice, bob]) assert.equal((await call("/api/me/language", { method: "POST", cookie, body: { language: "en" } })).status, 200);
  const invitation = await call("/api/partner/invitations", { method: "POST", cookie: alice, body: {} });
  assert.equal(invitation.status, 201);
  const selfAccept = await call("/api/partner/accept", { method: "POST", cookie: alice, body: { code: invitation.body.pairing.invitation.code } });
  assert.equal(selfAccept.status, 409); noChinese(selfAccept.body.error, "self accept");
  assert.equal((await call("/api/partner/accept", { method: "POST", cookie: bob, body: { code: invitation.body.pairing.invitation.code } })).status, 200);
  const issue = await call(`/api/issues/${randomUUID()}`, { cookie: alice });
  assert.equal(issue.status, 404); assert.equal(issue.body.error, "This shared decision was not found.");
  assert.match((await call(`/api/issues/${randomUUID()}?language=es`, { cookie: alice })).body.error, /^No se encontró/);
  const decision = await call("/api/agreements/nope/approve", { method: "POST", cookie: bob, body: { version: 1 } });
  assert.ok(decision.status >= 400); noChinese(decision.body.error, "decision error");

  // Signed out, an explicit language is honoured; without one the Chinese the App maps itself is kept unchanged.
  const signedOut = await call("/api/partner/accept", { method: "POST", body: { code: "ABCDEFGH", language: "es" } });
  assert.equal(signedOut.status, 401); noChinese(signedOut.body.error, "signed out es");
  assert.equal((await call("/api/partner/accept", { method: "POST", body: { code: "ABCDEFGH" } })).body.error, "请先登录。");
  assert.equal((await call("/api/auth/login", { method: "POST", body: { email: "nobody@example.com", password: "wrong-password-1" } })).body.error, "邮箱或密码不正确。");
});

test("voice errors from the model service are in the requested language", async () => {
  const saved = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
  try {
    const mediator = createMediator({ apiKey: "" });
    for (const language of ["en", "es"]) {
      await assert.rejects(mediator.transcribe(Buffer.alloc(200), "audio/webm", language), (error) => { noChinese(error.message, `transcribe ${language}`); return error.statusCode === 503; });
      await assert.rejects(mediator.createRealtimeSession({ sdp: "v=0", language }), (error) => { noChinese(error.message, `realtime ${language}`); return error.statusCode === 503; });
    }
  } finally { if (saved === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved; }
});

test("a browser reminder push follows the member's interface language, not the stored zh default", async (t) => {
  const store = await createFileStore(join(await workDir(t, "language-push-"), "store.json"));
  const userId = randomUUID(); await store.createUser({ id: userId, email: `${userId}@example.invalid`, name: "Mia", language: "es", createdAt: new Date().toISOString() });
  let time = new Date("2026-09-07T12:00:00Z");
  const sent = [];
  const service = createReminderService({ store, enabled: true, publicKey: "test-public", now: () => new Date(time), sendPush: async (...args) => { sent.push(args); return { statusCode: 201 }; } });
  // The App turned reminders on without naming a language, so the stored preference says zh.
  await service.updateSettings(userId, { enabled: true, timezone: "UTC" });
  await service.subscribe(userId, { endpoint: "https://fcm.googleapis.com/fcm/send/test", keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url") } });
  await service.createReminder(userId, { title: "Cena", localDateTime: "2026-09-07T12:01", timezone: "UTC", frequency: "once" });
  time = new Date("2026-09-07T12:02Z");
  assert.equal((await service.runDue()).accepted, 1);
  assert.equal(sent[0][1].body, "Tienes un recordatorio. Abre Pinky cuando quieras.");
});

test("the little one's new level is announced in both members' languages", async (t) => {
  const { store, ids, relationshipId } = await pairedStore(t, ["zh", "en"]);
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createTogetherRouter({ store, mediator: {} }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((done) => server.once("listening", done));
  t.after(() => new Promise((done) => server.close(done)));
  const open = async (userId, language) => (await (await fetch(`http://127.0.0.1:${server.address().port}/api/together?language=${language}&timezone=UTC`, { headers: { "x-user": userId } })).json());
  await open(ids[0], "zh");
  await store.transaction(`relationship:${relationshipId}`, (tx) => tx.updateRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, ids[0], (draft) => {
    for (let index = 0; index < 10; index += 1) draft.messages.push({ id: randomUUID(), role: "agent", actorUserId: null, kind: "game", text: `round ${index}`, game: { type: "choice", options: ["a", "b"], aboutUserId: null }, answers: { [ids[0]]: { choice: 0, text: "a" }, [ids[1]]: { choice: 1, text: "b" } }, refs: [], createdAt: new Date().toISOString() });
  }));
  const seen = await open(ids[0], "zh");
  const level = seen.conversation.messages.find((message) => /Lv\.2/.test(message.text || ""));
  assert.ok(level, "the level is announced");
  assert.deepEqual(Object.keys(level.i18n || {}).sort(), ["en", "es", "zh"]);
  noChinese(level.i18n.en, "pet en"); noChinese(level.i18n.es, "pet es");
});

test("a one-year anniversary heads-up is singular in Spanish", async (t) => {
  const { store, ids, relationshipId } = await pairedStore(t, ["zh", "es"]);
  await store.transaction(`relationship:${relationshipId}`, (tx) => tx.createRelationshipRecord("togetherConversations", { ...createRelationshipRecord({ relationshipId, userId: ids[0], visibility: "shared", aiAccessScope: "joint", status: "active", messages: [] }), id: `together:${relationshipId}` }));
  const assistant = createAssistantRouter({ store, mediator: { planAssistantTurn: async () => ({ reply: "", actions: [] }) }, reminderService: createReminderService({ store }) }).assistant;
  for (const [index, id] of ids.entries()) await assistant.createSession(id, { language: ["zh", "es"][index], timezone: "America/Los_Angeles" });
  await store.transaction(`relationship:${relationshipId}`, (tx) => tx.createRelationshipRecord("milestones", createRelationshipRecord({ relationshipId, userId: ids[0], status: "active", visibility: "shared", aiAccessScope: "joint", type: "relationship_started", title: "Our anniversary", date: "2025-11-11", recurringRule: "yearly", timezone: "UTC" })));
  const pushes = [];
  assert.equal((await sendHeadsUps({ store, now: () => new Date("2026-11-10T18:00:00Z"), postNote: assistant.postNote, notify: async (userId, message) => { pushes.push({ userId, message }); } })).sent, 2);
  const spanish = (await store.listRelationshipRecordsForUser("privateAgentThreads", ids[1])).filter((thread) => thread.ownerUserId === ids[1]).flatMap((thread) => thread.messages).at(-1).text;
  assert.match(spanish, /su aniversario de 1 año\./);
  noChinese(spanish, "heads-up es");
});
