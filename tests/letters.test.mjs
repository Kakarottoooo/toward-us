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
import { createSpaceRouter } from "../server/space-router.mjs";
import { createRelationshipRouter } from "../server/relationship-router.mjs";
import { deliverLetters } from "../server/letters.mjs";

const fields = (patch = {}) => ({ title: null, text: null, localDateTime: null, timezone: null, frequency: null, date: null, mood: null, layout: null, spaceId: null, done: null, photoId: null, ...patch });
const action = (patch = {}) => ({ kind: "partner_message", operation: "create", targetId: null, expectedVersion: null, fields: fields(), query: null, queryPeriod: "all", occurrence: null, ...patch });
const LETTER = "Dear Mia, a year ago today we drove to the coast and you sang the whole way.";

test("a letter is written with Pinky, sealed on confirm, unreadable until its day, then delivered into Us and memories", async (t) => {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "letters-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const id of ids) await store.createUser({ id, email: `${id}@example.invalid`, name: id === ids[0] ? "Ziwei" : "Mia", passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  const nextYear = `${new Date().getUTCFullYear() + 1}-03-05`;
  let planned = action({ fields: fields({ text: LETTER, date: nextYear }) });
  const mediator = { planAssistantTurn: async () => ({ reply: "Here is your letter.", actions: [planned] }), continueTogether: async () => ({ reply: "ok", draftAgreement: null, actions: [] }) };
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createAssistantRouter({ store, mediator, reminderService: createReminderService({ store }) }));
  app.use("/api", createTogetherRouter({ store, mediator }));
  app.use("/api", createSpaceRouter({ store }));
  app.use("/api", createRelationshipRouter({ store, mediator }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, method = "GET", body, userId = ids[0]) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  const session = (await request("/assistant/sessions", "POST", { language: "en", timezone: "UTC" })).body.session;
  const turn = await request(`/assistant/sessions/${session.id}/messages`, "POST", { text: "Help me write Mia a letter for next March 5", itemId: randomUUID() });
  const card = turn.body.session.messages.at(-1).cards.find((item) => item.kind === "partner_message");
  assert.equal(card.openOn, nextYear, "the draft shows the day it opens");

  const sealed = await request(`/assistant/sessions/${session.id}/share-confirm`, "POST", { confirm: true, cardId: card.id, digest: card.digest });
  assert.equal(sealed.status, 200, JSON.stringify(sealed.body));
  const us = async (userId) => (await request("/together?language=en&timezone=UTC", "GET", null, userId)).body.conversation;
  const seen = await us(ids[1]);
  assert.ok(seen.messages.some((message) => message.kind === "letter_sealed"), "the partner sees a letter is waiting");
  assert.ok(!JSON.stringify(seen).includes("drove to the coast"), "but not a word of it");
  const home = (await request("/relationship/home", "GET", null, ids[1])).body;
  assert.ok(home.graph.milestones.some((item) => item.type === "letter" && item.date === nextYear), "the day is on their calendar");

  assert.equal((await deliverLetters({ store })).delivered, 0, "nothing opens before its day");
  const onTheDay = () => new Date(`${nextYear}T09:00:00Z`);
  assert.equal((await deliverLetters({ store, now: onTheDay })).delivered, 1);
  assert.equal((await deliverLetters({ store, now: onTheDay })).delivered, 0, "delivered once");
  const opened = (await us(ids[1])).messages.find((message) => message.kind === "letter");
  assert.equal(opened.text, LETTER);
  assert.equal(opened.actorUserId, ids[0]);
  const album = (await request("/spaces", "GET", null, ids[1])).body.spaces.find((space) => space.system === "moments" && space.visibility === "shared");
  assert.ok(album.items.some((item) => item.text === LETTER && item.date === nextYear), "kept in their shared memories");

  // A message without a later day is still an ordinary one, sent at once.
  planned = action({ fields: fields({ text: "Thank you for today." }) });
  const plain = (await request(`/assistant/sessions/${session.id}/messages`, "POST", { text: "Tell her thanks", itemId: randomUUID() })).body.session.messages.at(-1).cards.find((item) => item.kind === "partner_message");
  assert.equal(plain.openOn, undefined);
  await request(`/assistant/sessions/${session.id}/share-confirm`, "POST", { confirm: true, cardId: plain.id, digest: plain.digest });
  assert.ok((await us(ids[1])).messages.some((message) => message.kind === "relay" && message.text === "Thank you for today."));
});
