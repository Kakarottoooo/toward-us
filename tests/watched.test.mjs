import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { addSpaceItem, ensureMomentSpaces, WATCHED } from "../server/space-domain.mjs";
import { answerWatchCheck, askWatchChecks } from "../server/watched.mjs";

// 一起看过的 (founder 11-07): a shared shelf per couple; the day after a plan to watch together Pinky asks if they finished it.
async function setup(t) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "watched-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const store = await createFileStore(join(directory, "store.json"));
  const [a, b] = [randomUUID(), randomUUID()];
  for (const id of [a, b]) await store.createUser({ id, email: `${id}@example.invalid`, name: id === a ? "Ziwei" : "Mia", passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: a, role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: a, expiresAt: new Date(Date.now() + 86400000).toISOString() } });
  await store.acceptInvitation(relationshipId, b, new Date().toISOString());
  const shelf = async (userId = a) => (await store.listRelationshipRecordsForUser("spaces", userId)).filter((space) => space.system === WATCHED && !space.archivedAt);
  const items = async (userId = a) => { const [space] = await shelf(userId); return (await store.listRelationshipRecordsForUser("spaceItems", userId)).filter((item) => item.spaceId === space.id && !item.archivedAt); };
  const plan = (date, notes, title = "一起看") => store.createRelationshipRecord("milestones", createRelationshipRecord({ relationshipId, userId: a, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", type: "custom", title, date, timezone: "UTC", recurringRule: "once", notes }));
  const checks = async () => (await store.getRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, a))?.messages.filter((message) => message.kind === "watch_check") || [];
  return { store, a, b, relationshipId, shelf, items, plan, checks };
}

test("each couple gets exactly one shared shelf, seen by both", async (t) => {
  const { store, a, b, shelf } = await setup(t);
  await Promise.all([ensureMomentSpaces(store, a), ensureMomentSpaces(store, b), ensureMomentSpaces(store, a)]);
  assert.equal((await shelf(a)).length, 1);
  assert.deepEqual((await shelf(b)).map((space) => space.id), (await shelf(a)).map((space) => space.id), "the same shelf for both");
  assert.equal((await shelf(a))[0].visibility, "shared");
});

test("the morning after a plan to watch together, Pinky asks once; other dates and ordinary milestones are left alone", async (t) => {
  const { store, a, relationshipId, plan, checks } = await setup(t);
  await ensureMomentSpaces(store, a);
  await plan("2026-11-06", "watch:请回答1988", "一起看《请回答1988》第13集 · 你 20:00 / Mia 11:00");
  await plan("2026-11-05", "watch:沙丘2");
  await plan("2026-11-06", "", "Mia 的生日");
  assert.equal(await askWatchChecks({ store, relationshipId, userId: a, day: "2026-11-07" }), 1);
  assert.equal(await askWatchChecks({ store, relationshipId, userId: a, day: "2026-11-07" }), 0, "never asked twice");
  const [check] = await checks();
  assert.match(check.text, /请回答1988/); assert.equal(check.watch.date, "2026-11-06"); assert.equal(check.i18n.en.includes("Did you finish it?"), true);
});

test("看完了 puts it on the shelf for both with the planned day; a show already wanted is ticked, not duplicated", async (t) => {
  const { store, a, b, relationshipId, shelf, items, plan, checks } = await setup(t);
  await ensureMomentSpaces(store, a);
  const [space] = await shelf(a);
  await store.transaction(`relationship:${relationshipId}`, (tx) => addSpaceItem(tx, { userId: a, space, title: "《请回答1988》", text: "看到第 12 集", done: false }));
  await plan("2026-11-06", "watch:请回答1988"); await plan("2026-11-06", "watch:沙丘2");
  await askWatchChecks({ store, relationshipId, userId: a, day: "2026-11-07" });
  const [first, second] = await checks();
  await answerWatchCheck({ store, relationshipId, userId: b, messageId: first.id, finished: true });
  await answerWatchCheck({ store, relationshipId, userId: a, messageId: first.id, finished: false });
  await answerWatchCheck({ store, relationshipId, userId: a, messageId: second.id, finished: false });
  const shows = await items(b);
  assert.equal(shows.length, 1, "the wanted show was ticked off, nothing added for 还没");
  assert.equal(shows[0].done, true); assert.equal(shows[0].date, "2026-11-06"); assert.equal(shows[0].text, "看到第 12 集");
  const [answered, notYet] = await checks();
  assert.equal(answered.watchAnswer.finished, true, "the first answer stands"); assert.equal(answered.watchAnswer.by, b);
  assert.equal(notYet.watchAnswer.finished, false);
  await assert.rejects(answerWatchCheck({ store, relationshipId, userId: a, messageId: first.id, finished: "yes" }), /message_required/);
});

test("看完了 on a show not on the shelf yet adds it, watched that day", async (t) => {
  const { store, a, relationshipId, items, plan, checks } = await setup(t);
  await plan("2026-11-06", "watch:沙丘2");
  await askWatchChecks({ store, relationshipId, userId: a, day: "2026-11-07" });
  const [check] = await checks();
  await answerWatchCheck({ store, relationshipId, userId: a, messageId: check.id, finished: true });
  const [show] = await items(a);
  assert.equal(show.title, "沙丘2"); assert.equal(show.done, true); assert.equal(show.date, "2026-11-06");
});
