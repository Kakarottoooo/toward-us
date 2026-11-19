import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createFileStore } from "../server/store.mjs";
import { createReminderService } from "../server/reminder-service.mjs";
import { createAssistantRouter } from "../server/assistant-router.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { nextYearly, occasionOf, sendHeadsUps } from "../server/heads-up.mjs";

// Founder 11-08, from user research: what hurts is having to remind your partner of your own birthday. Pinky tells the
// other one privately, a week and a day ahead, with what the birthday person has said they want.
async function fixture(t) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "heads-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const store = await createFileStore(join(directory, "store.json"));
  const [ziwei, mia] = [randomUUID(), randomUUID()];
  for (const [id, name, language] of [[ziwei, "Ziwei", "zh"], [mia, "Mia", "en"]]) await store.createUser({ id, name, language, email: `${id}@example.invalid`, passwordHash: "x", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ziwei, role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ziwei, expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, mia, new Date().toISOString());
  await store.transaction(`relationship:${relationshipId}`, (tx) => tx.createRelationshipRecord("togetherConversations", { ...createRelationshipRecord({ relationshipId, userId: ziwei, visibility: "shared", aiAccessScope: "joint", status: "active", messages: [] }), id: `together:${relationshipId}` }));
  const assistant = createAssistantRouter({ store, mediator: { planAssistantTurn: async () => ({ reply: "", actions: [] }) }, reminderService: createReminderService({ store }) }).assistant;
  for (const [id, language] of [[ziwei, "zh"], [mia, "en"]]) await assistant.createSession(id, { language, timezone: "America/Los_Angeles" });
  const add = (collection, data) => store.transaction(`relationship:${relationshipId}`, (tx) => tx.createRelationshipRecord(collection, createRelationshipRecord({ relationshipId, userId: ziwei, status: "active", ...data })));
  const pushes = [];
  const run = (iso) => sendHeadsUps({ store, now: () => new Date(iso), postNote: assistant.postNote, notify: async (userId, message) => { pushes.push({ userId, message }); } });
  const notes = async (userId) => (await store.listRelationshipRecordsForUser("privateAgentThreads", userId)).filter((thread) => thread.ownerUserId === userId).flatMap((thread) => thread.messages).map((message) => message.text);
  return { store, ziwei, mia, relationshipId, add, run, notes, pushes };
}

test("a week and a day before Mia's birthday, only Ziwei is told, privately, with what Mia wished for", async (t) => {
  const f = await fixture(t);
  await f.add("milestones", { visibility: "shared", aiAccessScope: "joint", type: "custom", title: "Mia 生日", date: "1996-11-17", recurringRule: "yearly", timezone: "UTC" });
  // Ziwei's own private note about Mia, and one Mia keeps about herself privately (never used for Ziwei).
  await f.add("memories", { userId: f.ziwei, ownerUserId: f.ziwei, visibility: "private", aiAccessScope: "private", kind: "profile", subjectUserId: f.mia, category: "wishes", text: "想要一台拍立得", approvals: [] });
  await f.add("memories", { userId: f.mia, ownerUserId: f.mia, visibility: "private", aiAccessScope: "private", kind: "profile", subjectUserId: f.mia, category: "wishes", text: "SECRET_WISH", approvals: [] });

  assert.equal((await f.run("2026-11-10T14:00:00Z")).sent, 0, "07:00 in Los Angeles is too early");
  assert.equal((await f.run("2026-11-10T18:00:00Z")).sent, 1);
  const told = (await f.notes(f.ziwei)).at(-1);
  assert.match(told, /^Mia 的生日还有 7 天（11 月 17 日）。Mia 说过想要：想要一台拍立得。要我帮你挑礼物/);
  assert.doesNotMatch(told, /SECRET_WISH/, "only notes Ziwei may see");
  assert.equal((await f.notes(f.mia)).length, 0, "the birthday person hears nothing");
  assert.deepEqual(f.pushes.map((push) => [push.userId, push.message.body.zh]), [[f.ziwei, "Mia 的生日还有 7 天"]]);
  assert.equal((await f.run("2026-11-10T22:00:00Z")).sent, 0, "once per day it applies");
  assert.equal((await f.run("2026-11-16T18:00:00Z")).sent, 1);
  assert.match((await f.notes(f.ziwei)).at(-1), /^明天是 Mia 的生日。/);
  assert.equal((await f.run("2026-11-12T18:00:00Z")).sent, 0, "nothing on other days");
});

test("before their anniversary each of them is told privately, in their own language", async (t) => {
  const f = await fixture(t);
  await f.add("milestones", { visibility: "shared", aiAccessScope: "joint", type: "relationship_started", title: "在一起", date: "2024-11-11", recurringRule: "yearly", timezone: "UTC" });
  assert.equal((await f.run("2026-11-10T18:00:00Z")).sent, 2);
  assert.equal((await f.notes(f.ziwei)).at(-1).split("。")[0], "明天是你们在一起 2 周年");
  assert.match((await f.notes(f.mia)).at(-1), /^Tomorrow is your 2-year anniversary\./);
});

test("dates: leap days, the year turning, and whose birthday a title names", () => {
  assert.equal(nextYearly("2000-02-29", "2026-02-20"), "2026-02-28");
  assert.equal(nextYearly("1996-01-03", "2026-12-30"), "2027-01-03");
  const members = [{ userId: "a", user: { name: "Ziwei" } }, { userId: "b", user: { name: "Mia" } }];
  assert.deepEqual(occasionOf({ title: "mia's birthday" }, members), { kind: "birthday", of: "b" });
  assert.equal(occasionOf({ title: "妈妈生日" }, members), null, "family birthdays stay on the shared calendar");
  assert.deepEqual(occasionOf({ title: "结婚纪念日" }, members), { kind: "anniversary" });
});
