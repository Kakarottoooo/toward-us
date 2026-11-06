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
import { createMemoryRouter } from "../server/memory-router.mjs";
import { buildTogetherContext } from "../server/together-domain.mjs";
import { createCycleRouter, predict } from "../server/cycle.mjs";

const fields = (patch = {}) => ({ title: null, text: null, localDateTime: null, timezone: null, frequency: null, date: null, mood: null, layout: null, spaceId: null, done: null, photoId: null, ...patch });
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test("prediction: typical cycle and length from the logs, today's day of the period, and a missed log rolls forward", () => {
  const logs = [{ start: "2026-08-01", end: "2026-08-05" }, { start: "2026-08-29", end: "2026-09-02" }, { start: "2026-09-28", end: "2026-10-03" }];
  const during = predict(logs, "2026-09-30");
  assert.equal(during.cycle, 29); assert.equal(during.length, 5); assert.equal(during.inPeriod, 3); assert.equal(during.nextStart, "2026-10-27");
  assert.equal(predict(logs, "2026-11-10").nextStart, "2026-11-25", "a month with no log still predicts ahead of today");
  assert.deepEqual([predict([{ start: "2026-10-01", end: null }], "2026-10-02").cycle, predict([{ start: "2026-10-01", end: null }], "2026-10-02").inPeriod], [28, 2], "one log: defaults, and the period is assumed ongoing");
});

test("经期: kept privately from the conversation; the partner gets only 这几天多照顾 TA, only with consent", async (t) => {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "cycle-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const [index, id] of ids.entries()) await store.createUser({ id, email: `${id}@example.invalid`, name: ["Mia", "Ziwei"][index], passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  let planned = null;
  const mediator = { planAssistantTurn: async () => ({ reply: "抱抱，记下了。", actions: [planned] }), continueTogether: async () => ({ reply: "ok", draftAgreement: null, actions: [] }) };
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createAssistantRouter({ store, mediator, reminderService: createReminderService({ store }) }));
  app.use("/api", createTogetherRouter({ store, mediator }));
  app.use("/api", createMemoryRouter({ store }));
  app.use("/api", createCycleRouter({ store }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, method = "GET", body, userId = ids[0]) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  const session = (await request("/assistant/sessions", "POST", { language: "zh", timezone: "UTC" })).body.session;
  const say = async (text, action) => { planned = { kind: "period", operation: "create", targetId: null, expectedVersion: null, fields: fields(action), query: null, queryPeriod: "all", occurrence: null }; const result = await request(`/assistant/sessions/${session.id}/messages`, "POST", { text, itemId: randomUUID() }); assert.equal(result.status, 200, JSON.stringify(result.body)); };

  await say("上个月 1 号来的", { title: "start", date: day(-30) });
  await say("那次 5 号就结束了", { title: "end", date: day(-26) });
  await say("姨妈今天来了", { title: "start", date: day(-1) });
  await say("其实是昨天来的，今天也算", { title: "start", date: day(0) });
  let mine = (await request("/cycle?timezone=UTC")).body.mine;
  assert.equal(mine.logs.length, 2, "a start within a week of an open one is the same period");
  assert.equal(mine.prediction.inPeriod, 2);
  assert.equal(mine.sharing, false);
  assert.equal((await request("/checkins")).body.checkins.length, 0, "never listed with mood check-ins");

  // By default Ziwei learns nothing anywhere: not the cycle page, not Us, not the shared Pinky.
  const leaks = (value) => { const text = JSON.stringify(value); return text.includes(day(-1)) || text.includes(day(-30)) || /cycle|period|经期|照顾/.test(text); };
  let seen = (await request("/cycle?timezone=UTC", "GET", null, ids[1])).body;
  assert.equal(seen.mine, null); assert.equal(seen.care, null);
  const us = (await request("/together?language=zh&timezone=UTC", "GET", null, ids[1])).body;
  assert.equal(us.care, null); assert.ok(!leaks(us.conversation));
  assert.ok(!leaks(buildTogetherContext(await store.relationshipSnapshotForUser(ids[1]), relationshipId, { userId: ids[1] })), "the shared Pinky never sees it");

  // Mia chooses "let him know": Ziwei now sees only her name with the care line, nothing else.
  await request("/cycle/sharing", "POST", { on: true });
  seen = (await request("/cycle?timezone=UTC", "GET", null, ids[1])).body;
  assert.deepEqual(seen.care, { name: "Mia" }); assert.equal(seen.mine, null);
  assert.ok(!JSON.stringify(seen).includes(day(-1)), "no dates");
  assert.deepEqual((await request("/together?language=zh&timezone=UTC", "GET", null, ids[1])).body.care, { name: "Mia" });
  assert.equal((await request("/together?language=zh&timezone=UTC")).body.care, null, "Mia herself gets no note about her own period");
  const consent = (await store.listRelationshipRecordsForUser("consentEvents", ids[0])).filter((item) => item.eventType === "cycle.care_shared");
  assert.equal(consent.length, 1);

  // Turning it off stops it at once; after the period, nothing shows even with sharing on.
  await request("/cycle/sharing", "POST", { on: false });
  assert.equal((await request("/cycle?timezone=UTC", "GET", null, ids[1])).body.care, null);
  await request("/cycle/sharing", "POST", { on: true });
  await say("这次昨天就结束了", { title: "end", date: day(-1) });
  mine = (await request("/cycle?timezone=UTC")).body.mine;
  assert.equal(mine.prediction.inPeriod, null);
  assert.equal((await request("/cycle?timezone=UTC", "GET", null, ids[1])).body.care, null, "once it is over, nothing shows even with sharing on");
  for (const log of mine.logs) assert.equal((await request(`/cycle/${log.id}`, "DELETE", undefined, ids[1])).status, 404, "nobody else can delete it");
  for (const log of mine.logs) await request(`/cycle/${log.id}`, "DELETE");
  assert.equal((await request("/cycle?timezone=UTC")).body.mine, null);
  assert.equal((await request("/cycle?timezone=UTC", "GET", null, ids[1])).body.care, null);
});
