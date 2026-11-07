import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { ensureTogetherConversation } from "../server/together-domain.mjs";
import { markShowedUp, shiftDay } from "../server/streak.mjs";
import { createWidgetRouter } from "../server/widget-router.mjs";

async function setup(t, { perHour } = {}) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "widget-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const [index, id] of ids.entries()) await store.createUser({ id, email: `${id}@example.invalid`, name: ["Ziwei", "Mia"][index], passwordHash: "test", language: "en", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createWidgetRouter({ store, ...(perHour ? { perHour } : {}) }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true }); });
  const call = async (path, { method = "GET", userId = null, token = null } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { ...(userId ? { "x-user": userId } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    const text = await response.text();
    return { status: response.status, cache: response.headers.get("cache-control"), text, body: text ? JSON.parse(text) : null };
  };
  return { store, ids, relationshipId, call };
}

test("widget token: issued signed in, stored only as a hash, replaced by the next one, revoked on delete", async (t) => {
  const { store, ids: [me], call } = await setup(t);
  assert.equal((await call("/widget/token", { method: "POST" })).status, 401, "needs a session");
  const first = await call("/widget/token", { method: "POST", userId: me });
  assert.equal(first.status, 201);
  const [owner, secret] = first.body.token.split(".");
  assert.equal(owner, me); assert.equal(Buffer.from(secret, "base64url").length, 32);
  const settings = await store.getRelationshipRecordForUser("accountSettings", `account:${me}`, me);
  assert.equal(settings.widgetToken.hash, createHash("sha256").update(secret).digest("hex"));
  assert.ok(!JSON.stringify(settings).includes(secret), "the token itself is never stored");

  assert.equal((await call("/widget", { token: first.body.token })).status, 200);
  const second = await call("/widget/token", { method: "POST", userId: me });
  assert.equal((await call("/widget", { token: first.body.token })).status, 401, "one active token: the new one replaces it");
  assert.equal((await call("/widget", { token: second.body.token })).status, 200);
  assert.equal((await call("/widget/token", { method: "DELETE" })).status, 401);
  assert.equal((await call("/widget/token", { method: "DELETE", userId: me })).status, 204);
  assert.equal((await call("/widget", { token: second.body.token })).status, 401, "revoked");
});

test("widget data: Bearer only, 401 for anything else, no-store, and nothing private", async (t) => {
  const { store, ids: [me, partner], relationshipId, call } = await setup(t);
  const token = (await call("/widget/token", { method: "POST", userId: me })).body.token;
  for (const bad of [null, "nope", `${me}.wrong`, `${partner}.${token.split(".")[1]}`, `${token}.extra`]) assert.equal((await call("/widget", { token: bad })).status, 401, String(bad));
  assert.equal((await call("/widget", { userId: me })).status, 401, "a session cookie is not a widget token");

  const today = new Date().toISOString().slice(0, 10);
  const add = (values) => store.createRelationshipRecord("milestones", createRelationshipRecord({ relationshipId, userId: me, visibility: "shared", status: "active", ...values }));
  await add({ type: "relationship_started", title: "Our anniversary", date: shiftDay(today, -9), recurringRule: "yearly" });
  const birthday = shiftDay(today, 5);
  await add({ type: "custom", title: "Mia's birthday", date: `2021${birthday.slice(4)}`, recurringRule: "yearly" });
  await add({ type: "custom", title: "Old plan", date: shiftDay(today, -30) });
  await store.createRelationshipRecord("milestones", createRelationshipRecord({ relationshipId, userId: me, visibility: "private", status: "active", type: "custom", title: "Secret surprise", date: shiftDay(today, 1), recurringRule: "yearly" }));
  await store.transaction(`relationship:${relationshipId}`, async (tx) => {
    const { conversation } = await ensureTogetherConversation(tx, { relationshipId, userId: me });
    await tx.updateRelationshipRecordForUser("togetherConversations", conversation.id, me, (draft) => { draft.messages.push({ id: randomUUID(), role: "member", actorUserId: partner, kind: "text", text: "our private words", refs: [], createdAt: new Date().toISOString() }); });
    await markShowedUp(tx, { relationshipId, userId: me, zone: "UTC", at: new Date(`${shiftDay(today, -1)}T12:00:00Z`) });
    await markShowedUp(tx, { relationshipId, userId: partner, zone: "UTC", at: new Date(`${shiftDay(today, -1)}T12:00:00Z`) });
  });

  const result = await call("/widget", { token });
  assert.equal(result.status, 200);
  assert.equal(result.cache, "no-store");
  assert.deepEqual(Object.keys(result.body).sort(), ["daysTogether", "language", "next", "partnerName", "streak", "updatedAt", "v"]);
  const { updatedAt, ...rest } = result.body;
  assert.ok(Date.parse(updatedAt));
  assert.deepEqual(rest, { v: 1, language: "en", partnerName: "Mia", daysTogether: 10, streak: { days: 1, me: false, partner: true }, next: { title: "Mia's birthday", date: birthday, inDays: 5 } });
  for (const secret of ["our private words", "Secret surprise", "Old plan", "test", "@example.invalid"]) assert.ok(!result.text.includes(secret), secret);
});

test("widget data: unpaired members get an empty card; each token is rate limited", async (t) => {
  const { store, call } = await setup(t, { perHour: 3 });
  const solo = randomUUID();
  await store.createUser({ id: solo, email: `${solo}@example.invalid`, name: "Solo", passwordHash: "test", createdAt: new Date().toISOString() });
  const token = (await call("/widget/token", { method: "POST", userId: solo })).body.token;
  const first = await call("/widget", { token });
  assert.deepEqual({ ...first.body, updatedAt: null }, { v: 1, language: "zh", partnerName: null, daysTogether: null, streak: { days: 0, me: false, partner: false }, next: null, updatedAt: null });
  assert.equal((await call("/widget", { token })).status, 200);
  assert.equal((await call("/widget", { token })).status, 200);
  assert.equal((await call("/widget", { token })).status, 429, "the fourth read within the hour");
});
