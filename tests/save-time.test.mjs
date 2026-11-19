import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createFileStore } from "../server/store.mjs";
import { createReminderService } from "../server/reminder-service.mjs";

// Save time, not kill time (founder 11-07): Pinky reaches out when it needs something from a member and says what it is;
// it does not push to bring people back, and it keeps nights quiet.
async function couple(t, clock) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "save-time-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await createFileStore(join(directory, "store.json"));
  const [a, b] = [randomUUID(), randomUUID()];
  for (const id of [a, b]) await store.createUser({ id, email: `${id}@example.invalid`, name: id === a ? "Alex" : "Blair", passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: a, role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: a, expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, b, new Date().toISOString());
  const sent = [];
  const service = createReminderService({ store, now: () => clock.at, sendNative: async (token, payload) => { sent.push({ token, body: payload.body }); } });
  await service.registerNativeDevice(a, { token: "fcm-token-alex-0001", platform: "ios" });
  await service.registerNativeDevice(b, { token: "fcm-token-blair-0002", platform: "ios" });
  const conversation = { id: `together:${relationshipId}`, relationshipId, createdByUserId: a, messages: [] };
  let tick = 0;
  // Each post is a fresh minute past the 10-minute per-member window, so only the rules under test decide.
  const post = async (fields) => {
    clock.at = new Date(clock.at.getTime() + 11 * 60_000 + (tick += 1));
    conversation.messages.push({ id: randomUUID(), createdAt: clock.at.toISOString(), refs: [], ...fields });
    sent.length = 0; await service.notifyTogether(conversation);
    return sent.map((item) => item.body);
  };
  return { service, a, b, post };
}

test("a push about something Pinky asks says the question itself", async (t) => {
  const clock = { at: new Date("2099-12-01T18:00:00Z") };
  const { post } = await couple(t, clock);
  assert.deepEqual(await post({ role: "agent", kind: "daily_question", text: "这周最想和 TA 一起做的一件小事是什么？" }), ["这周最想和 TA 一起做的一件小事是什么？", "这周最想和 TA 一起做的一件小事是什么？"]);
  assert.deepEqual(await post({ role: "agent", kind: "watch_check", text: "Did you finish Dune 2?", i18n: { zh: "《沙丘2》看完了吗？", en: "Did you finish Dune 2?", es: "¿Terminaron Dune 2?" } }), ["《沙丘2》看完了吗？", "《沙丘2》看完了吗？"]);
});

test("Pinky's own surprises do not push by default, and Pinky alone reaches a member at most 3 times a day", async (t) => {
  const clock = { at: new Date("2099-12-01T16:00:00Z") };
  const { a, b, post } = await couple(t, clock);
  assert.deepEqual(await post({ role: "agent", kind: "story", text: "100 days", handle: "story:x:day-100" }), [], "recap cards are off by default");
  assert.deepEqual(await post({ role: "agent", kind: "text", text: "🎉 Lv.3", handle: "pet-level:3" }), [], "the little one growing is a surprise too");
  for (let round = 1; round <= 3; round += 1) assert.equal((await post({ role: "agent", kind: "daily_question", text: `Q${round}` })).length, 2, `Pinky ask ${round} reaches both`);
  assert.deepEqual(await post({ role: "agent", kind: "daily_question", text: "Q4" }), [], "a fourth Pinky-only push the same day waits");
  assert.equal((await post({ role: "member", actorUserId: a, kind: "text", text: "hi" })).length, 1, "the partner's words still reach Blair");
  assert.equal((await post({ role: "member", actorUserId: b, kind: "text", text: "hey" })).length, 1);
  clock.at = new Date("2099-12-02T16:00:00Z");
  assert.equal((await post({ role: "agent", kind: "daily_question", text: "Q5" })).length, 2, "a new day starts over");
});

test("nights are quiet by default once a member's time zone is known; without one nothing is guessed", async (t) => {
  // 07:00 UTC is 23:00 in Los Angeles.
  const clock = { at: new Date("2099-12-01T06:40:00Z") };
  const { service, a, b, post } = await couple(t, clock);
  assert.equal((await post({ role: "member", actorUserId: a, kind: "text", text: "night 1" })).length, 1, "Blair's zone is unknown, so no night is assumed");
  await service.updateNotify(b, { messages: true, timezone: "America/Los_Angeles" });
  assert.deepEqual(await post({ role: "member", actorUserId: a, kind: "text", text: "night 2" }), [], "23:00 in Blair's Los Angeles: quiet");
  await service.updateNotify(b, { quiet: false });
  assert.equal((await post({ role: "member", actorUserId: a, kind: "text", text: "night 3" })).length, 1, "Blair turned quiet nights off");
});
