import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createTogetherRouter } from "../server/together-router.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";

const usAction = (patch) => ({ kind: "milestone", operation: "create", targetId: null, spaceId: null, title: null, text: null, date: null, layout: null, done: null, recurringRule: null, remindDaysBefore: null, photoId: null, localDateTime: null, idea: null, amount: null, currency: null, paidBy: null, split: null, ...patch });

test("异地: each one's time zone is shared with the other, and the next meeting is counted down", async (t) => {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "distance-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const [index, id] of ids.entries()) await store.createUser({ id, email: `${id}@example.invalid`, name: ["Ziwei", "Mia"][index], passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  const nextMonth = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const mediator = { continueTogether: async () => ({ reply: "记下了，还有 30 天见面！", draftAgreement: null, actions: [usAction({ title: "去洛杉矶见面", date: nextMonth, text: "next_meeting", recurringRule: "yearly" })] }) };
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createTogetherRouter({ store, mediator }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, method = "GET", body, userId = ids[0]) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const open = (userId, zone) => request(`/together?language=zh&timezone=${encodeURIComponent(zone)}`, "GET", null, userId);

  await open(ids[0], "Asia/Shanghai");
  await open(ids[1], "Not/AZone");
  assert.deepEqual((await open(ids[0], "Asia/Shanghai")).body.conversation.zones, { [ids[0]]: "Asia/Shanghai" }, "a zone that does not exist is never kept");
  const seen = (await open(ids[1], "America/Los_Angeles")).body;
  assert.deepEqual(seen.conversation.zones, { [ids[0]]: "Asia/Shanghai", [ids[1]]: "America/Los_Angeles" }, "Mia sees Ziwei's zone and her own");
  assert.equal(seen.nextMeeting, null, "nothing to count down yet");

  // In Us: "我们下个月见面" becomes a one-time meetup date both see counted down.
  await request("/together/messages", "POST", { text: "Pinky，我下个月去洛杉矶见 Mia", itemId: randomUUID(), language: "zh" });
  const meeting = (await open(ids[1], "America/Los_Angeles")).body.nextMeeting;
  assert.deepEqual({ date: meeting.date, title: meeting.title }, { date: nextMonth, title: "去洛杉矶见面" });
  const record = (await store.listRelationshipRecordsForUser("milestones", ids[0])).find((item) => item.id === meeting.id);
  assert.equal(record.type, "meetup"); assert.equal(record.recurringRule, "once", "a meeting is once, whatever the model said");

  // A meeting that has passed no longer counts down; the soonest upcoming one does.
  await store.createRelationshipRecord("milestones", createRelationshipRecord({ relationshipId, userId: ids[0], visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "active", type: "meetup", title: "上次见面", date: "2020-01-01", timezone: "UTC", recurringRule: "once" }));
  const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  await store.createRelationshipRecord("milestones", createRelationshipRecord({ relationshipId, userId: ids[1], visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "active", type: "meetup", title: "周末见", date: soon, timezone: "UTC", recurringRule: "once" }));
  assert.equal((await open(ids[0], "Asia/Shanghai")).body.nextMeeting.date, soon);
});
