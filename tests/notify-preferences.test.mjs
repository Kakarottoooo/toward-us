import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createFileStore } from "../server/store.mjs";
import { createReminderService } from "../server/reminder-service.mjs";

test("each member hears only the kinds of news they keep on, and only reminders during their quiet night", async (t) => {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "notify-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await createFileStore(join(directory, "store.json"));
  const [a, b] = [randomUUID(), randomUUID()];
  for (const id of [a, b]) await store.createUser({ id, email: `${id}@example.invalid`, name: id === a ? "Alex" : "Blair", passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: a, role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: a, expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, b, new Date().toISOString());
  let clock = new Date("2099-12-01T04:00:00Z"); const sent = [];
  const service = createReminderService({ store, now: () => clock, sendNative: async (token, payload) => { sent.push([token, payload.body]); } });
  await service.registerNativeDevice(a, { token: "fcm-token-alex-0001", platform: "ios" });
  await service.registerNativeDevice(b, { token: "fcm-token-blair-0002", platform: "ios" });
  // Save time, not kill time (11-07): surprises are off and nights quiet unless a member chooses otherwise.
  assert.deepEqual((await service.getSettings(a)).notify, { messages: true, pinky: false, reminders: true, quiet: true });
  await service.updateNotify(a, { pinky: true });
  let at = 0; const message = (fields) => ({ id: randomUUID(), createdAt: new Date(Date.parse("2099-12-01T04:00:00Z") + (at += 1000)).toISOString(), refs: [], ...fields });
  const conversation = { id: `together:${relationshipId}`, relationshipId, createdByUserId: a, messages: [] };
  conversation.messages.push(message({ role: "agent", kind: "story", text: "100 days", handle: "story:x:day-100" }));
  await service.notifyTogether(conversation);
  assert.deepEqual(sent.map(([token]) => token), ["fcm-token-alex-0001"], "only the member who keeps surprises on hears about one");
  // Alex sleeps from 22:00 in Los Angeles (UTC-8): a message at 07:00 UTC is 23:00 there.
  await service.updateNotify(a, { quiet: true, timezone: "America/Los_Angeles" });
  clock = new Date("2099-12-01T07:00:00Z"); sent.length = 0;
  conversation.messages.push(message({ role: "member", actorUserId: b, kind: "text", text: "night", createdAt: "2099-12-01T07:00:00.000Z" }));
  await service.notifyTogether(conversation);
  assert.deepEqual(sent, [], "no message pushes during the quiet night");
});
