import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createAssistantRouter } from "../server/assistant-router.mjs";
import { createReminderService } from "../server/reminder-service.mjs";
import { KEEP, LIMIT, keepMessages, summarizeEarlier } from "../server/thread-pages.mjs";

// Memory plan (11-09): a conversation with Pinky never fills up ("这段对话已满") and never silently drops its oldest lines.
const line = (index, role = index % 2 ? "assistant" : "user") => ({ id: `m${index}`, role, text: `line ${index}`, createdAt: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString() });

test("over the limit, the oldest messages move to a page in order; nothing is lost", () => {
  const draft = { messages: [] };
  keepMessages(draft, Array.from({ length: LIMIT }, (_, index) => line(index)));
  assert.equal(draft.messages.length, LIMIT); assert.equal(draft.earlier, undefined, "at the limit nothing moves");
  keepMessages(draft, [...draft.messages, line(LIMIT)]);
  assert.equal(draft.messages.length, KEEP);
  assert.equal(draft.earlier.length, 1);
  assert.deepEqual([draft.earlier[0].messages[0].id, draft.earlier[0].messages.at(-1).id, draft.messages[0].id, draft.messages.at(-1).id], ["m0", `m${LIMIT - KEEP}`, `m${LIMIT - KEEP + 1}`, `m${LIMIT}`]);
  assert.equal(draft.earlier[0].messages.length + draft.messages.length, LIMIT + 1);
});

test("a long conversation keeps going, its earlier pages can be read back, and their summary reaches Pinky", async (t) => {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "pages-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const store = await createFileStore(join(directory, "store.json"));
  const id = randomUUID();
  await store.createUser({ id, email: `${id}@example.invalid`, name: "Alex", passwordHash: "test", createdAt: new Date().toISOString() });
  const plans = [], summaries = [];
  const mediator = {
    planAssistantTurn: async (context) => { plans.push(context); return { reply: "好的。", actions: [] }; },
    structured: async ({ input }) => { const { previous, messages } = JSON.parse(input); summaries.push(messages.length); return { summary: `${previous ? `${previous} ` : ""}聊了 ${messages.length} 条，包括 ${messages[0].text}` }; },
  };
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.auth = { user: { id } }; next(); });
  app.use("/api", createAssistantRouter({ store, mediator, reminderService: createReminderService({ store }) }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const call = async (path, body) => { const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; };
  const session = (await call("/assistant/sessions", { language: "zh", timezone: "UTC" })).body.session;
  await store.updateRelationshipRecordForUser("privateAgentThreads", session.id, id, (draft) => { draft.messages = Array.from({ length: LIMIT - 1 }, (_, index) => line(index)); draft.version += 1; });

  const turn = await call(`/assistant/sessions/${session.id}/messages`, { text: "还在吗？", itemId: randomUUID() });
  assert.equal(turn.status, 200, "no 这段对话已满");
  assert.equal(turn.body.session.messages.length, KEEP);
  assert.equal(turn.body.session.earlierPages, 1);
  assert.equal(turn.body.session.messages.at(-1).text, "好的。");
  const earlier = (await call(`/assistant/sessions/${session.id}/earlier?page=1`)).body;
  assert.equal(earlier.messages[0].text, "line 0");
  assert.equal(earlier.messages.length + turn.body.session.messages.length, LIMIT + 1, "every message is still there");

  await summarizeEarlier({ store, mediator, userId: id, sessionId: session.id });
  await call(`/assistant/sessions/${session.id}/messages`, { text: "我们之前聊过什么？", itemId: randomUUID() });
  assert.match(plans.at(-1).earlier, /聊了 101 条，包括 line 0/, "Pinky reads the summary of what moved out");
  assert.equal(plans.at(-1).messages.length <= LIMIT, true);
  assert.deepEqual(summaries, [101], "each page is summarised once");
});
