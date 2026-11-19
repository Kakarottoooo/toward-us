import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createTogetherRouter } from "../server/together-router.mjs";
import { awaitedBy, shouldAgentSpeak } from "../server/together-domain.mjs";

// Found by role-play testing (founder 11-07): Pinky asked to hear Mia's side, Mia answered without @Pinky, and Pinky stayed
// silent. Now the member Pinky is waiting to hear from reaches it once, within a check-in's window.
const msg = (patch) => ({ id: randomUUID(), role: "member", actorUserId: "a", text: "", createdAt: new Date().toISOString(), ...patch });

test("only the awaited member's first message after Pinky's question opens it, within the window", () => {
  const asked = msg({ role: "agent", actorUserId: null, awaiting: ["b"] });
  assert.equal(awaitedBy([msg({}), asked], "b")?.id, asked.id);
  assert.equal(awaitedBy([msg({}), asked], "a"), null, "not the one who called");
  assert.equal(awaitedBy([asked, msg({ actorUserId: "b" })], "b"), null, "she already answered once");
  assert.equal(awaitedBy([{ ...asked, createdAt: new Date(Date.now() - 13 * 3_600_000).toISOString() }], "b"), null, "too old");
  assert.equal(awaitedBy([msg({ role: "agent", actorUserId: null })], "b"), null, "Pinky waits for nobody");
  assert.equal(shouldAgentSpeak(msg({ actorUserId: "b", text: "堵车了" }), { awaited: asked }), true);
  assert.equal(shouldAgentSpeak(msg({ actorUserId: "b", text: "堵车了" }), {}), false);
});

async function setup(t, mediator) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "awaited-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID()];
  for (const [index, id] of ids.entries()) await store.createUser({ id, email: `${id}@example.invalid`, name: index ? "Mia" : "Ziwei", passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: new Date(Date.now() + 86400000).toISOString() } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createTogetherRouter({ store, mediator }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const say = async (userId, text) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/together/messages`, { method: "POST", headers: { "content-type": "application/json", "x-user": userId }, body: JSON.stringify({ text, itemId: randomUUID(), language: "zh", timezone: "UTC" }) });
    const body = await response.json(); assert.ok(response.status < 300, JSON.stringify(body));
    return body.conversation.messages;
  };
  return { ids, say };
}
const action = (kind) => ({ kind, operation: "create", targetId: null, spaceId: null, title: null, text: null, date: null, layout: null, done: null, recurringRule: "once", remindDaysBefore: null, photoId: null, localDateTime: null, idea: null });

test("after a mediation that waits for Mia, her plain reply gets an answer; her next one does not", async (t) => {
  let turns = 0;
  const mediator = {
    continueTogether: async () => (turns += 1) === 1 ? { reply: "x", actions: [action("mediate")], draftAgreement: null, waitingFor: [] } : { reply: `谢谢你说出来（第${turns}次）`, actions: [], draftAgreement: null, waitingFor: [] },
    mediateTogether: async () => ({ shared: "还需要听听 Mia 怎么看迟到这件事。", feedback: [] }),
  };
  const { ids: [ziwei, mia], say } = await setup(t, mediator);
  let messages = await say(ziwei, "@Pinky 我们又因为迟到吵起来了，你帮我们评评理");
  assert.deepEqual(messages.at(-1).awaiting, [mia], "the reflection waits for Mia, who has not spoken");
  messages = await say(mia, "我也不是故意的，路上真的堵车了。");
  assert.equal(messages.at(-1).role, "agent"); assert.match(messages.at(-1).text, /谢谢你说出来/);
  messages = await say(mia, "好吧，下次我早点出门。");
  assert.equal(messages.at(-1).role, "member", "Pinky is not called by every later message");
});

test("a normal reply that asks Mia something by name waits for her", async (t) => {
  let turns = 0;
  const mediator = { continueTogether: async () => (turns += 1) === 1 ? { reply: "Mia，你周六晚上方便吗？", actions: [], draftAgreement: null, waitingFor: ["mia"] } : { reply: "好，那就周六。", actions: [], draftAgreement: null, waitingFor: [] } };
  const { ids: [ziwei, mia], say } = await setup(t, mediator);
  await say(ziwei, "@Pinky 帮我们定个周末吃饭的时间");
  const messages = await say(mia, "可以呀");
  assert.equal(messages.at(-1).text, "好，那就周六。");
});
