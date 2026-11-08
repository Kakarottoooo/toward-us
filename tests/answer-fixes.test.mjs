import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createReminderService } from "../server/reminder-service.mjs";
import { createAssistantRouter } from "../server/assistant-router.mjs";
import { jsonFromText, jsonInstruction } from "../server/claude-cli-client.mjs";
import { assistantInstructions } from "../server/assistant-agent.mjs";

test("a concrete apology request gets ordinary private wording without invented feelings or an interview", () => {
  for (const language of ["zh", "en", "es"]) {
    const prompt = assistantInstructions(language);
    assert.match(prompt, /give a copyable draft now/);
    assert.match(prompt, /without excuses, therapist language, assumed feelings or setting/);
    assert.match(prompt, /"Don't send" means private wording only, actions:\[\]/);
    assert.match(prompt, /Put the COMPLETE apology itself inside reply/);
    assert.match(prompt, /Do not demand forgiveness or add an interview question/);
    assert.match(prompt, /private draft are not an agreed commitment/);
  }
});

// Found by role-play testing (founder 11-07): a records search that found nothing promised results that never came, and the
// CLI model sometimes answered "the suggestions are above" instead of giving them.
const fields = (patch = {}) => ({ title: null, text: null, localDateTime: null, timezone: null, frequency: null, date: null, mood: null, layout: null, spaceId: null, done: null, photoId: null, handoff: null, ...patch });
const action = (patch = {}) => ({ kind: "checkin", operation: "query", targetId: null, expectedVersion: null, fields: fields(), query: "妈妈", queryPeriod: "all", occurrence: null, ...patch });

async function setup(t, plan) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "answers-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const store = await createFileStore(join(directory, "store.json"));
  const id = randomUUID();
  await store.createUser({ id, email: `${id}@example.invalid`, name: "Ziwei", passwordHash: "test", createdAt: new Date().toISOString() });
  const mediator = { planAssistantTurn: async () => plan() };
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.auth = { user: { id } }; next(); });
  app.use("/api", createAssistantRouter({ store, mediator, reminderService: createReminderService({ store }) }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const request = async (path, body) => (await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const session = (await request("/assistant/sessions", { language: "zh", timezone: "UTC" })).session;
  return { say: async (text) => (await request(`/assistant/sessions/${session.id}/messages`, { text, itemId: randomUUID() })).session.messages.at(-1) };
}

test("a records search that finds nothing says so instead of promising results", async (t) => {
  const { say } = await setup(t, () => ({ reply: "我来找找你们之前关于她妈妈来住这件事的记录，结果会直接显示给你。", actions: [action()] }));
  const reply = await say("你还记得上次我们因为她妈妈要来住的事吵架是怎么解决的吗？");
  assert.match(reply.text, /没有找到这件事的记录/);
  assert.doesNotMatch(reply.text, /结果会直接显示/);
  assert.equal((reply.cards || []).length, 0);
});

test("a search that finds something keeps Pinky's own words and shows what it found", async (t) => {
  let turn = 0;
  const { say } = await setup(t, () => (turn += 1) === 1
    ? { reply: "记下了。", actions: [action({ operation: "create", query: null, queryPeriod: "all", fields: fields({ text: "她妈妈下个月来住两周", mood: "mixed" }) })] }
    : { reply: "找到了你记过的这件事。", actions: [action()] });
  await say("她妈妈下个月来住两周，帮我记一下");
  const reply = await say("我之前说过她妈妈的事吗？");
  assert.equal(reply.text, "找到了你记过的这件事。");
  assert.equal(reply.cards.length, 1);
});

test("structured answers are read from the model's one JSON reply, fences and stray text tolerated", () => {
  assert.deepEqual(jsonFromText('{"reply":"建议：猫咖","actions":[]}'), { reply: "建议：猫咖", actions: [] });
  assert.deepEqual(jsonFromText('```json\n{"reply":"好","actions":[]}\n```'), { reply: "好", actions: [] });
  assert.deepEqual(jsonFromText('Here it is: {"reply":"好","actions":[]} thanks'), { reply: "好", actions: [] });
  assert.equal(jsonFromText("我给你几个建议：1. 猫咖"), null, "prose is not an answer; the caller falls back to --json-schema");
  assert.equal(jsonFromText("[1,2]"), null);
  assert.match(jsonInstruction({ type: "object" }), /exactly one JSON object/);
  assert.match(jsonInstruction({ type: "object", properties: { reply: { type: "string" } } }), /"reply"/);
});

test("advice the model wrote as prose becomes the reply itself, instead of a second call that talks about formatting", async () => {
  const { proseAsReply } = await import("../server/claude-cli-client.mjs");
  const { assistantTurnSchema } = await import("../server/assistant-agent.mjs");
  const prose = "两年异地真的不容易。\n\n先各自写下首选方案和底线，再坐下来对照。";
  assert.deepEqual(proseAsReply(prose, assistantTurnSchema), { reply: prose, actions: [] });
  const together = { type: "object", required: ["reply", "draftAgreement", "actions", "waitingFor"], properties: { reply: { type: "string" }, draftAgreement: { anyOf: [{ type: "null" }, { type: "object" }] }, actions: { type: "array" }, waitingFor: { type: "array" } } };
  assert.deepEqual(proseAsReply("好的。", together), { reply: "好的。", draftAgreement: null, actions: [], waitingFor: [] });
  assert.equal(proseAsReply('{"reply": "broken', assistantTurnSchema), null, "half-written JSON is not prose");
  assert.equal(proseAsReply("text", { type: "object", required: ["facts"], properties: { facts: { type: "array" } } }), null, "schemas without a reply keep the strict path");
  assert.equal(proseAsReply("text", { type: "object", required: ["reply", "title"], properties: { reply: { type: "string" }, title: { type: "string" } } }), null, "nothing required may be made up");
});
