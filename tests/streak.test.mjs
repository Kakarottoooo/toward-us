import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createTogetherRouter } from "../server/together-router.mjs";
import { ensureTogetherConversation } from "../server/together-domain.mjs";
import { coupleStreak, LOOKBACK_DAYS, markShowedUp, shiftDay } from "../server/streak.mjs";

async function couple(t, prefix) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const [index, id] of ids.entries()) await store.createUser({ id, email: `${id}@example.invalid`, name: ["Ziwei", "Mia"][index], passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  await store.transaction(`relationship:${relationshipId}`, (tx) => ensureTogetherConversation(tx, { relationshipId, userId: ids[0] }));
  const mark = (userId, day, zone = "UTC") => store.transaction(`relationship:${relationshipId}`, (tx) => markShowedUp(tx, { relationshipId, userId, zone, at: new Date(`${day}T12:00:00Z`) }));
  const streak = (now, userId = ids[0], timezone = "UTC") => coupleStreak(store, relationshipId, { now: new Date(now), timezone, userId });
  return { store, ids, relationshipId, mark, streak };
}

test("连续一起来: a day counts only when both came by; the run ends today once both did, else yesterday", async (t) => {
  const { ids: [a, b], mark, streak } = await couple(t, "streak-");
  const now = "2026-11-06T15:00:00Z";
  assert.deepEqual(await streak(now), { days: 0, me: false, partner: false, byUser: { [a]: false, [b]: false } }, "nobody yet");
  await mark(a, "2026-11-06");
  assert.deepEqual(await streak(now), { days: 0, me: true, partner: false, byUser: { [a]: true, [b]: false } }, "only me today");
  assert.deepEqual(await streak(now, b), { days: 0, me: false, partner: true, byUser: { [a]: true, [b]: false } }, "the partner sees it the other way round");
  for (const day of ["2026-11-04", "2026-11-05"]) { await mark(a, day); await mark(b, day); }
  assert.equal((await streak(now)).days, 2, "today not done by both yet: counted through yesterday, not broken");
  await mark(b, "2026-11-06");
  assert.deepEqual(await streak(now), { days: 3, me: true, partner: true, byUser: { [a]: true, [b]: true } }, "both today");
  await mark(b, "2026-11-06");
  assert.equal((await streak(now)).days, 3, "coming by twice in a day is still one day");
});

test("连续一起来: a day one of them missed breaks the streak", async (t) => {
  const { ids: [a, b], mark, streak } = await couple(t, "streak-gap-");
  for (const day of ["2026-11-01", "2026-11-02", "2026-11-04", "2026-11-05", "2026-11-06"]) { await mark(a, day); await mark(b, day); }
  await mark(a, "2026-11-03");
  assert.equal((await streak("2026-11-06T12:00:00Z")).days, 3, "11-03 only one of them came by");
  assert.equal((await streak("2026-11-08T12:00:00Z")).days, 0, "a whole day with nobody ends it");
});

test("连续一起来: each member's day is their own calendar day", async (t) => {
  const { store, ids: [a, b], relationshipId, mark, streak } = await couple(t, "streak-zone-");
  // 00:30 on 6 November in Shanghai is still 5 November in UTC.
  const lateNight = new Date("2026-11-05T16:30:00Z");
  await store.transaction(`relationship:${relationshipId}`, (tx) => markShowedUp(tx, { relationshipId, userId: a, zone: "Asia/Shanghai", at: lateNight }));
  await mark(b, "2026-11-06");
  assert.deepEqual(await streak("2026-11-06T04:00:00Z", a, "Asia/Shanghai"), { days: 1, me: true, partner: true, byUser: { [a]: true, [b]: true } });
  // The same instant marked in UTC lands on the 5th: no shared day.
  const other = await couple(t, "streak-zone-utc-"), [c, d] = other.ids;
  await other.store.transaction(`relationship:${other.relationshipId}`, (tx) => markShowedUp(tx, { relationshipId: other.relationshipId, userId: c, zone: "UTC", at: lateNight }));
  await other.mark(d, "2026-11-06");
  assert.deepEqual(await other.streak("2026-11-06T04:00:00Z", c, "UTC"), { days: 0, me: false, partner: true, byUser: { [c]: false, [d]: true } });

  // Days still in Us count in the member's zone kept on the conversation (as Us stores it when they open it).
  const conversationId = `together:${relationshipId}`;
  await store.transaction(`relationship:${relationshipId}`, (tx) => tx.updateRelationshipRecordForUser("togetherConversations", conversationId, a, (draft) => {
    draft.zones = { [a]: "Asia/Shanghai", [b]: "UTC" };
    draft.messages.push({ id: randomUUID(), role: "member", actorUserId: a, kind: "text", text: "hi", refs: [], createdAt: "2026-11-06T16:30:00Z" });
    draft.messages.push({ id: randomUUID(), role: "member", actorUserId: b, kind: "text", text: "hey", refs: [], createdAt: "2026-11-07T08:00:00Z" });
  }));
  assert.deepEqual(await streak("2026-11-07T09:00:00Z", b, "UTC"), { days: 2, me: true, partner: true, byUser: { [a]: true, [b]: true } }, "a's 00:30 Shanghai message is their 7 November");
});

test("连续一起来: at most a bounded lookback is kept and counted", async (t) => {
  const { store, ids, relationshipId, mark, streak } = await couple(t, "streak-cap-");
  const today = "2026-11-06";
  const many = Array.from({ length: 450 }, (_, index) => shiftDay(today, -index)).reverse();
  for (const id of ids) {
    await mark(id, shiftDay(today, -449));
    await store.transaction(`relationship:${relationshipId}`, (tx) => tx.updateRelationshipRecordForUser("accountSettings", `showedup:${relationshipId}:${id}`, id, (draft) => { draft.days = many; }));
  }
  assert.equal((await streak(`${today}T12:00:00Z`)).days, LOOKBACK_DAYS);
  const kept = await mark(ids[0], shiftDay(today, 1));
  assert.equal(kept.days.length, LOOKBACK_DAYS, "the private mark keeps only the most recent days");
  assert.equal(kept.days.at(-1), shiftDay(today, 1));
});

test("连续一起来: saying something in Us, answering the daily question and petting each count as coming by", async (t) => {
  const { store, ids: [a, b], relationshipId, streak } = await couple(t, "streak-routes-");
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createTogetherRouter({ store, mediator: {} }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const request = async (path, method, body, userId) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const now = new Date().toISOString();
  assert.equal((await request("/together/messages", "POST", { text: "早呀", timezone: "UTC", language: "zh" }, a)).status, 201);
  assert.deepEqual(await streak(now), { days: 0, me: true, partner: false, byUser: { [a]: true, [b]: false } });
  assert.equal((await request("/together/pet", "POST", { timezone: "UTC" }, b)).status, 200);
  assert.equal((await streak(now)).days, 1, "a message and a pet on the same day");

  // The daily question: an answer alone is coming by, even before the partner has answered.
  const other = await couple(t, "streak-daily-");
  const questionId = randomUUID();
  await other.store.transaction(`relationship:${other.relationshipId}`, (tx) => tx.updateRelationshipRecordForUser("togetherConversations", `together:${other.relationshipId}`, other.ids[0], (draft) => { draft.messages.push({ id: questionId, role: "agent", actorUserId: null, kind: "daily_question", text: "?", answers: {}, refs: [], createdAt: now }); }));
  const { answerDailyQuestion } = await import("../server/daily-question.mjs");
  await answerDailyQuestion({ store: other.store, mediator: {}, relationshipId: other.relationshipId, userId: other.ids[1], messageId: questionId, text: "答案" });
  assert.deepEqual(await other.streak(now, other.ids[1]), { days: 0, me: true, partner: false, byUser: { [other.ids[0]]: false, [other.ids[1]]: true } });

  // The marks are owner-private dates: never part of what the App receives.
  const mark = await store.getRelationshipRecordForUser("accountSettings", `showedup:${relationshipId}:${a}`, a);
  assert.deepEqual([mark.visibility, mark.ownerUserId, Object.keys(mark).includes("text")], ["private", a, false]);
});
