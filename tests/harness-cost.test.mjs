import assert from "node:assert/strict";
import { test } from "node:test";
import { createAnthropicClient } from "../server/anthropic-client.mjs";
import { assistantInstructions } from "../server/assistant-agent.mjs";
import { createModelCallBudget, setModelCallBudget, budgetedModelCall } from "../server/model-call-budget.mjs";

test("model budget reserves concurrent internal turns and reconciles CLI num_turns", async (t) => {
  const budget = createModelCallBudget({ maxClaudeTurns: 4, maxCodexCalls: 2 });
  setModelCallBudget(budget); t.after(() => setModelCallBudget(null));
  const first = budget.reserve("claude", 3);
  const second = budget.reserve("claude", 3);
  assert.equal(second.maxTurns, 1);
  second.finish('{"num_turns":1}'); first.finish('{"num_turns":2}');
  let dispatched = 0;
  await budgetedModelCall("claude", [], async (args) => { dispatched++; assert.deepEqual(args, ["--max-turns", "1"]); return '{"num_turns":1}'; }, 6);
  assert.equal(budget.state.claudeTurns, 4);
  await assert.rejects(budgetedModelCall("claude", [], async () => { dispatched++; }), /budget reached/);
  assert.equal(dispatched, 1);
});

test("unknown metadata, quota errors and Codex exhaustion stop subsequent requests", () => {
  const unknown = createModelCallBudget();
  assert.throws(() => unknown.reserve("claude", 6).finish("bad output"), /num_turns missing/);
  assert.equal(unknown.state.claudeTurns, 6);
  assert.throws(() => unknown.reserve("claude"), /num_turns missing/);
  const quota = createModelCallBudget();
  assert.throws(() => quota.reserve("claude").finish(JSON.stringify({ num_turns: 1, result: "You've hit your usage limit" })), /quota error/);
  assert.throws(() => quota.reserve("codex"), /quota error/);
  const codex = createModelCallBudget({ maxCodexCalls: 1 });
  codex.reserve("codex").finish("");
  assert.throws(() => codex.reserve("codex"), /budget reached/);
});

// Cost pass on the harness (founder 11-10: "首先得先保证我们的模型输出结果保质保量，然后再开始节省成本").

test("the system part is the same bytes for every member, turn and day, and is cached on the API", async (t) => {
  // Nothing per member, per turn or per day may sit in the instructions: any changed byte makes every call pay full price.
  assert.equal(assistantInstructions("zh"), assistantInstructions("zh"));
  assert.doesNotMatch(assistantInstructions("zh"), /\d{4}-\d{2}-\d{2}|[0-9a-f]{8}-[0-9a-f]{4}-/);

  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let body = null;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "m", content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  await createAnthropicClient({ apiKey: "test-key", model: "m" }).responses.create({ model: "m", instructions: "Stable instructions.", input: "volatile context", text: { format: { type: "json_schema", name: "x", schema: { type: "object", properties: {} } } } }, { maxRetries: 0 });
  assert.deepEqual(body.system, [{ type: "text", text: "Stable instructions.", cache_control: { type: "ephemeral" } }]);
  assert.equal(body.messages[0].content, "volatile context", "what changes every turn comes after the cached part");
});

test("with a portrait a turn carries only the newest notes about that person; without one, everything as before", async (t) => {
  const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
  const { join, resolve } = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  const { createFileStore } = await import("../server/store.mjs");
  const { createRelationshipRecord } = await import("../server/relationship-domain.mjs");
  const { profileContext, BRIEF } = await import("../server/profile.mjs");
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "brief-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const store = await createFileStore(join(directory, "store.json"));
  const userId = randomUUID();
  await store.createUser({ id: userId, name: "Alex", email: `${userId}@example.invalid`, passwordHash: "x", createdAt: new Date().toISOString() });
  const add = (fields) => store.createRelationshipRecord("memories", createRelationshipRecord({ relationshipId: null, userId, ownerUserId: userId, visibility: "private", aiAccessScope: "private", status: "active", ...fields }));
  for (let index = 0; index < 60; index += 1) await add({ kind: "profile", subjectUserId: userId, category: "likes", text: `喜欢第${index}种东西` });
  assert.equal((await profileContext(store, userId)).me.length, 60);
  await add({ kind: "portrait", subjectKey: "me", text: "画像", timeline: [], builtAt: new Date().toISOString() });
  const brief = await profileContext(store, userId);
  assert.equal(brief.me.length, 60, "the member's own lasting notes are never trimmed");
  assert.equal(brief.portraits.me.portrait, "画像");
});

test("an answer written twice ('Wait, I need to return a valid object only.') is read, not asked for again", async () => {
  const { answerFromText } = await import("../server/claude-cli-client.mjs");
  const schema = { type: "object", required: ["reply", "actions"], properties: { reply: { type: "string" }, actions: { type: "array" } } };
  const first = { reply: "好的，每周五晚上7点提醒你。", actions: [{ kind: "reminder", fields: { title: "买花 {周五}" } }], query: null };
  const meant = { reply: "好的，每周五晚上7点提醒你给女朋友买花。", actions: [{ kind: "reminder", fields: { title: "给女朋友买花" } }] };
  const text = `${JSON.stringify(first)}\n\nWait, I need to return a valid object only.\n\n${JSON.stringify(meant)}`;
  assert.deepEqual(answerFromText(text, schema), meant, "the last complete answer is the one it meant");
  assert.deepEqual(answerFromText(JSON.stringify(meant), schema), meant);
});

test("beside a person's portrait only their newest notes go along, and every old dislike or food note too", async (t) => {
  const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
  const { join, resolve } = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  const { createFileStore } = await import("../server/store.mjs");
  const { createRelationshipRecord } = await import("../server/relationship-domain.mjs");
  const { profileContext, BRIEF } = await import("../server/profile.mjs");
  const { personFor, personSubject } = await import("../server/people.mjs");
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "guard-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const store = await createFileStore(join(directory, "store.json"));
  const userId = randomUUID();
  await store.createUser({ id: userId, name: "Alex", email: `${userId}@example.invalid`, passwordHash: "x", createdAt: new Date().toISOString() });
  const jie = await store.transaction(`user:${userId}`, (tx) => personFor(tx, userId, "阿杰"));
  const add = (fields, at) => store.createRelationshipRecord("memories", createRelationshipRecord({ relationshipId: null, userId, ownerUserId: userId, visibility: "private", aiAccessScope: "private", status: "active", ...fields, ...(at ? { createdAt: at, updatedAt: at } : {}) }));
  await add({ kind: "profile", subjectUserId: personSubject(jie.id), category: "food", text: "对芒果过敏" }, "2024-01-01T00:00:00Z");
  for (let index = 0; index < 40; index += 1) await add({ kind: "profile", subjectUserId: personSubject(jie.id), category: "likes", text: `喜欢第${index}种东西` });
  assert.equal((await profileContext(store, userId)).people[0].facts.length, 30);
  await add({ kind: "portrait", subjectKey: personSubject(jie.id), text: "画像", timeline: [], builtAt: new Date().toISOString() });
  const facts = (await profileContext(store, userId)).people[0].facts.map((item) => item.fact);
  assert.equal(facts.length, BRIEF.personFacts + 1);
  assert.ok(facts.includes("对芒果过敏"));
});
