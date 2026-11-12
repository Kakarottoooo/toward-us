import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { AI_LIMIT, asAiUser, guardMediator } from "../server/ai-budget.mjs";
import { estimateUsd } from "../server/ai-prices.mjs";
import { AI_COST_DEFAULTS, AI_FEATURES, aiCostConfig, aiCostReport, flushAiLedger, installAiLedger, meterMediator, meterOpenAI, meteredCall, modelFor, pruneAiLedger, recordAiCall, runAiFeature, runAiLedgerMaintenance, safetySignal, usageFromAnthropic, usageFromClaudeCli, usageFromOpenAI, usageFromTranscription } from "../server/ai-ledger.mjs";
import { createAiCostRouter } from "../server/ai-cost-router.mjs";
import { formatReport } from "../scripts/ai-cost-report.mjs";

// AI cost ledger (founder, 11-12): every model call is one content-free row with its estimated list-price cost, rolled up
// per person per day and month; the report is admin-only; caps degrade then stop, never on safety or consent.
let directory, store, counter = 0, clock = new Date("2026-11-12T10:00:00Z");
const logs = [];
const log = { log: (line) => logs.push(line), warn: (line) => logs.push(line), error: (...line) => logs.push(line.join(" ")) };
before(async () => {
  await mkdir(join(process.cwd(), "work"), { recursive: true });
  directory = await mkdtemp(join(process.cwd(), "work", "ai-ledger-"));
  store = await createFileStore(join(directory, "state.json"));
});
afterEach(() => { delete process.env.AI_KILL_SWITCH; delete process.env.AI_COST_CONFIG_FILE; aiCostConfig(Date.now() + 60_000); });
after(async () => { installAiLedger({}); if (directory) await rm(directory, { recursive: true, force: true }); });
const install = () => { logs.length = 0; installAiLedger({ store, now: () => clock, log }); };

async function user(name) {
  return store.createUser({ id: randomUUID(), email: `ledger-${++counter}@example.com`, name, passwordHash: "x", createdAt: new Date().toISOString() });
}
async function couple() {
  const a = await user("Alex"), b = await user("Blair"), now = new Date();
  const relationship = { id: randomUUID(), status: "pending", createdAt: now.toISOString(), updatedAt: now.toISOString() };
  const code = randomUUID().slice(0, 8);
  await store.createInvitation({ relationship, membership: { relationshipId: relationship.id, userId: a.id, role: "A", joinedAt: now.toISOString() }, invitation: { code, relationshipId: relationship.id, createdByUserId: a.id, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), acceptedAt: null, acceptedByUserId: null } });
  await store.acceptInvitation(code, b.id, now.toISOString());
  return { a, b, relationshipId: relationship.id };
}
/** A stand-in mediator whose methods make one "OpenAI" request each, through the real metering boundary. */
function fakeMediator({ usage = { input_tokens: 10_000, input_tokens_details: { cached_tokens: 4_000 }, output_tokens: 500 }, model = "gpt-5.4" } = {}) {
  const seen = [];
  const openai = meterOpenAI({ responses: { create: async (params) => { seen.push(params.model); return { output_text: "{}", usage }; } } });
  const call = () => openai.responses.create({ model, input: "secret words that must never reach the ledger" });
  return { seen, mediator: { aiReady: true, model, planAssistantTurn: call, continueTogether: call, summarizePerspective: call, structured: call, lookup: call } };
}
const rowsFor = async (userId) => (await store.listRecordsForJob("aiUsage")).filter((record) => record.kind === "ai_ledger" && record.ownerUserId === userId);
const limitOf = (promise) => promise.then(() => null, (error) => error);

test("published prices give the cost of a call; anything not published stays unknown", () => {
  // Sonnet 5.5: 1,000 in at $2, 200 out at $10, 5,000 cache reads at $0.10, 2,000 cache writes at $2.50 (per MTok).
  assert.equal(estimateUsd({ model: "claude-sonnet-5-5", inputTokens: 1000, outputTokens: 200, cachedInputTokens: 5000, cacheWriteTokens: 2000 }).usd, 0.0095);
  assert.equal(estimateUsd({ model: "claude-cli:sonnet", inputTokens: 1_000_000 }).usd, 2, "CLI aliases resolve to the model they name");
  // Haiku 5.5 over 100K prompt tokens is priced at the long-prompt rates.
  assert.equal(estimateUsd({ model: "claude-haiku-5-5", inputTokens: 200_000 }).usd, 0.1);
  assert.equal(estimateUsd({ model: "claude-haiku-5-5", inputTokens: 50_000 }).usd, 0.005);
  assert.deepEqual(estimateUsd({ model: "gpt-5.4", inputTokens: 6000, cachedInputTokens: 4000, outputTokens: 500 }), { usd: 0.015 + 0.001 + 0.0075, price: "listed" });
  assert.deepEqual(estimateUsd({ model: "gpt-live-1", audioSeconds: 120 }), { usd: 0.1, price: "listed" });
  assert.deepEqual(estimateUsd({ model: "bytedance/seedance-1-lite", units: 4 }), { usd: 0.072, price: "listed" });
  assert.deepEqual(estimateUsd({ model: "claude-opus-5-5", webSearches: 2, inputTokens: 1000 }), { usd: 0.004 + 0.02, price: "listed" });
  assert.deepEqual(estimateUsd({ model: "some-new-model", inputTokens: 1000 }), { usd: null, price: "unknown" });
  assert.deepEqual(estimateUsd({ model: "gpt-realtime", units: 1 }), { usd: null, price: "unknown" }, "a realtime session's audio is not seen by the server");
  assert.deepEqual(estimateUsd({ model: "claude-sonnet-5-5", inputTokens: 1000, reportedUsd: 0.0123 }), { usd: 0.0123, price: "reported" });
});

test("each provider's usage report becomes the same row shape", () => {
  const cli = JSON.stringify({ type: "result", is_error: false, num_turns: 1, result: "{}", total_cost_usd: 0.0421, usage: { input_tokens: 12, cache_creation_input_tokens: 9000, cache_read_input_tokens: 3000, output_tokens: 400, server_tool_use: { web_search_requests: 1 } }, modelUsage: { "claude-haiku-5-5": { costUSD: 0.001 }, "claude-sonnet-5-5": { costUSD: 0.041 } } });
  assert.deepEqual(usageFromClaudeCli(cli), { model: "claude-sonnet-5-5", inputTokens: 12, outputTokens: 400, cachedInputTokens: 3000, cacheWriteTokens: 9000, webSearches: 1, reportedUsd: 0.0421, outcome: "ok" });
  assert.equal(usageFromClaudeCli(JSON.stringify({ type: "result", is_error: true, result: "x" })).outcome, "error");
  assert.deepEqual(usageFromAnthropic({ usage: { input_tokens: 5, output_tokens: 6, cache_read_input_tokens: 7, cache_creation_input_tokens: 8 } }), { inputTokens: 5, outputTokens: 6, cachedInputTokens: 7, cacheWriteTokens: 8, webSearches: undefined });
  assert.deepEqual(usageFromOpenAI({ usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 40 }, output_tokens: 9 } }), { inputTokens: 60, cachedInputTokens: 40, outputTokens: 9 });
  assert.deepEqual(usageFromTranscription({ duration: 31.5, usage: { type: "duration", seconds: 32 } }), { audioSeconds: 32 });
  assert.equal(usageFromTranscription({ duration: 12, usage: { type: "tokens", input_tokens: 300, output_tokens: 40 } }).inputTokens, 300);
});

test("every model call becomes one owner-only row with feature, provider, model, tokens, latency, outcome and cost", async () => {
  install();
  const { a, b, relationshipId } = await couple();
  const { mediator } = fakeMediator();
  const metered = meterMediator(guardMediator(mediator, { store }));
  await asAiUser({ userId: a.id }, async () => { await metered.planAssistantTurn({}); await metered.structured({ name: "daily_question" }); await metered.structured({ name: "not_in_the_enum" }); });
  await flushAiLedger();
  const rows = await rowsFor(a.id);
  assert.equal(rows.length, 3);
  const turn = rows.find((row) => row.feature === "assistant_turn");
  assert.equal(turn.provider, "openai"); assert.equal(turn.channel, "metered"); assert.equal(turn.model, "gpt-5.4");
  assert.equal(turn.inputTokens, 6000); assert.equal(turn.cachedInputTokens, 4000); assert.equal(turn.outputTokens, 500);
  assert.equal(turn.outcome, "ok"); assert.ok(Number.isFinite(turn.latencyMs)); assert.equal(turn.estUsd, 0.0235); assert.equal(turn.price, "listed");
  assert.equal(turn.spaceId, relationshipId); assert.equal(turn.relationshipId, null); assert.equal(turn.visibility, "private");
  assert.deepEqual(rows.map((row) => row.feature).sort(), ["assistant_turn", "daily_question", "other"]);
  assert.ok(AI_FEATURES.includes("daily_question") && AI_FEATURES.includes("other"));
  // Content-free: nothing the person wrote reaches the ledger.
  assert.doesNotMatch(JSON.stringify(await store.listRecordsForJob("aiUsage")), /secret words/);
  // The partner can never read the member's rows or totals, and they stay out of every snapshot.
  assert.equal(await store.getRelationshipRecordForUser("aiUsage", turn.id, b.id), null);
  assert.equal(await store.getRelationshipRecordForUser("aiUsage", `ai-cost:${a.id}:2026-11`, b.id), null);
  assert.ok((await store.getRelationshipRecordForUser("aiUsage", `ai-cost:${a.id}:2026-11`, a.id)).total.usd > 0);
  assert.equal((await store.relationshipSnapshotForUser(b.id)).aiUsage, undefined);
});

test("a failed call is recorded with its outcome and latency, then the error goes on", async () => {
  install();
  const { a } = await couple();
  await asAiUser({ userId: a.id }, () => runAiFeature({ feature: "assistant_turn" }, async () => {
    await assert.rejects(meteredCall({ provider: "anthropic", model: "claude-opus-5-5" }, async () => { throw Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" }); }), /timed out/);
    await assert.rejects(meteredCall({ provider: "anthropic", model: "claude-opus-5-5" }, async () => { throw new Error("overloaded"); }), /overloaded/);
  }));
  await flushAiLedger();
  assert.deepEqual((await rowsFor(a.id)).map((row) => row.outcome).sort(), ["error", "timeout"]);
});

test("past the soft limit a metered call runs on the cheaper model; on the subscription it is only shadow-checked", async () => {
  install();
  const { a } = await couple(), { b } = await couple();
  recordAiCall({ userId: a.id, feature: "assistant_turn", provider: "openai", model: "gpt-5.4", reportedUsd: 0.6 });
  recordAiCall({ userId: b.id, feature: "assistant_turn", provider: "claude-cli", model: "sonnet", reportedUsd: 0.6 });
  await flushAiLedger();
  const { mediator, seen } = fakeMediator();
  await asAiUser({ userId: a.id }, () => meterMediator(mediator).planAssistantTurn({}));
  assert.deepEqual(seen, ["gpt-5.4-mini"]);
  await flushAiLedger();
  const degraded = (await rowsFor(a.id)).find((row) => row.degraded);
  assert.equal(degraded.model, "gpt-5.4-mini"); assert.equal(degraded.requestedModel, "gpt-5.4");
  assert.ok(logs.some((line) => /ai_cost_anomaly .*"kind":"soft_limit"/.test(line)));
  // The founder's Claude subscription: same spend, but the model stays and the row says it would have been limited.
  const cli = { aiReady: true, model: "claude-cli:sonnet", planAssistantTurn: () => meteredCall({ provider: "claude-cli", model: modelFor("claude-cli", "sonnet"), requested: "sonnet" }, async () => "{}") };
  await asAiUser({ userId: b.id }, () => meterMediator(cli).planAssistantTurn({}));
  await flushAiLedger();
  const shadow = (await rowsFor(b.id)).find((row) => row.wouldLimit);
  assert.equal(shadow.wouldLimit, "soft"); assert.equal(shadow.degraded, false); assert.equal(shadow.channel, "subscription");
  assert.ok(logs.some((line) => /"kind":"soft_limit_shadow"/.test(line)));
});

test("at the hard limit the member gets a friendly message in their language, and the blocked call is recorded", async () => {
  install();
  const { a } = await couple();
  recordAiCall({ userId: a.id, feature: "assistant_turn", provider: "openai", model: "gpt-5.4", reportedUsd: 2.5 });
  await flushAiLedger();
  const { mediator, seen } = fakeMediator();
  const metered = meterMediator(mediator);
  for (const [language, pattern] of [["zh", /今天 Pinky 的 AI 用量已经到上限了/], ["en", /today's AI limit/], ["es", /límite de IA de hoy/]]) {
    const error = await limitOf(asAiUser({ userId: a.id, language }, () => metered.planAssistantTurn({})));
    assert.equal(error.code, AI_LIMIT); assert.equal(error.statusCode, 429); assert.equal(error.scope, "daily"); assert.match(error.message, pattern);
  }
  assert.equal(seen.length, 0, "no model call was made");
  await flushAiLedger();
  assert.equal((await rowsFor(a.id)).filter((row) => row.outcome === "blocked_daily").length, 3);
  // The monthly cap, and a single feature's daily cap, stop in the same way with their own wording.
  const { a: monthly } = await couple();
  clock = new Date("2026-11-03T10:00:00Z"); recordAiCall({ userId: monthly.id, feature: "assistant_turn", provider: "openai", model: "gpt-5.4", reportedUsd: 1.9 });
  for (const date of ["04", "05", "06", "07", "08", "09", "10"]) { clock = new Date(`2026-11-${date}T10:00:00Z`); recordAiCall({ userId: monthly.id, feature: "assistant_turn", provider: "openai", model: "gpt-5.4", reportedUsd: 1.9 }); }
  clock = new Date("2026-11-12T10:00:00Z"); await flushAiLedger();
  assert.match((await limitOf(asAiUser({ userId: monthly.id }, () => metered.planAssistantTurn({})))).message, /这个月/);
  const { a: looker } = await couple();
  recordAiCall({ userId: looker.id, feature: "web_lookup", provider: "anthropic", model: "claude-opus-5-5", reportedUsd: 0.31 });
  await flushAiLedger();
  const feature = await limitOf(asAiUser({ userId: looker.id, language: "en" }, () => metered.lookup("cafes")));
  assert.equal(feature.scope, "feature"); assert.match(feature.message, /This feature/);
  await asAiUser({ userId: looker.id }, () => metered.planAssistantTurn({})); // the rest of Pinky still works
});

test("caps never block safety or consent, and the kill switch stops everything else", async () => {
  install();
  const { a } = await couple();
  recordAiCall({ userId: a.id, feature: "assistant_turn", provider: "openai", model: "gpt-5.4", reportedUsd: 3 });
  await flushAiLedger();
  const { mediator, seen } = fakeMediator();
  const metered = meterMediator(guardMediator(mediator, { store, caps: { free: { person: 0, couple: 0, background: 0, chatImport: 0, features: {} }, paid: { person: 0, couple: 0, background: 0, chatImport: 0, features: {} } } }));
  assert.ok(safetySignal([{ text: "他昨天又打我了，我很害怕" }]) && safetySignal(["I want to end my life"]) && safetySignal(["me amenaza"]));
  assert.equal(safetySignal([{ text: "帮我订周五的餐厅" }]), false);
  // Over the cost cap and over the call-count cap, a safety message and the consent summary still reach the model.
  await asAiUser({ userId: a.id }, () => metered.planAssistantTurn({ messages: [{ text: "他威胁我，说要伤害我" }] }));
  await asAiUser({ userId: a.id }, () => metered.summarizePerspective({ text: "my side" }));
  assert.deepEqual(seen, ["gpt-5.4", "gpt-5.4"], "full model, not degraded");
  assert.equal((await limitOf(asAiUser({ userId: a.id }, () => metered.planAssistantTurn({ messages: [{ text: "推荐一部电影" }] })))).code, AI_LIMIT);
  await flushAiLedger();
  assert.deepEqual((await rowsFor(a.id)).filter((row) => row.exempt).map((row) => row.exempt).sort(), ["consent", "safety"]);
  // Kill switch (env or config file): every other model call stops with the maintenance wording; safety still goes through.
  const { a: other } = await couple();
  process.env.AI_KILL_SWITCH = "1";
  const killed = await limitOf(asAiUser({ userId: other.id, language: "en" }, () => metered.continueTogether({})));
  assert.equal(killed.scope, "kill_switch"); assert.match(killed.message, /paused/);
  await asAiUser({ userId: other.id }, () => metered.planAssistantTurn({ text: "I want to die" }));
  delete process.env.AI_KILL_SWITCH;
  const file = join(directory, "controls.json");
  await writeFile(file, JSON.stringify({ killSwitch: true, featureDailyUsd: { web_lookup: 0.05 } }));
  process.env.AI_COST_CONFIG_FILE = file;
  const config = aiCostConfig(Date.now() + 60_000);
  assert.equal(config.killSwitch, true); assert.equal(config.featureDailyUsd.web_lookup, 0.05); assert.equal(config.featureDailyUsd.voice_call, AI_COST_DEFAULTS.featureDailyUsd.voice_call);
  assert.equal((await limitOf(asAiUser({ userId: other.id }, () => metered.continueTogether({})))).scope, "kill_switch");
});

test("the admin report gives cost per user per day and month, per feature, top users and cost per active user", async () => {
  install();
  const { a, b, relationshipId } = await couple(), { a: solo } = await couple();
  clock = new Date("2026-11-11T09:00:00Z");
  recordAiCall({ userId: a.id, feature: "couple_recap", provider: "claude-cli", model: "sonnet", reportedUsd: 0.04, latencyMs: 3000 });
  clock = new Date("2026-11-12T09:00:00Z");
  recordAiCall({ userId: a.id, feature: "couple_recap", provider: "claude-cli", model: "sonnet", reportedUsd: 0.06, latencyMs: 5000 });
  recordAiCall({ userId: b.id, feature: "voice_call", provider: "openai", model: "gpt-live-1", audioSeconds: 600 });
  recordAiCall({ userId: solo.id, feature: "realtime_voice", provider: "openai", model: "gpt-realtime", units: 1 });
  clock = new Date("2026-11-12T10:00:00Z");
  const report = await aiCostReport(store, { days: 2, now: clock, top: 100 });
  const day = (userId, date) => report.perUserDay.find((row) => row.userId === userId && row.day === date);
  assert.equal(day(a.id, "2026-11-12").features.couple_recap, 0.06);
  assert.equal(day(a.id, "2026-11-11").usd, 0.04);
  assert.equal(day(a.id, "2026-11-12").spaceId, relationshipId);
  assert.equal(day(b.id, "2026-11-12").usd, 0.5);
  assert.equal(day(solo.id, "2026-11-12").unknownCalls, 1);
  assert.ok(report.perUserMonth.some((row) => row.userId === a.id && row.month === "2026-11" && row.usd >= 0.1));
  const voice = report.perFeature.find((row) => row.feature === "voice_call");
  assert.equal(voice.usd, 0.5); assert.equal(voice.users, 1);
  assert.equal(report.perFeature.find((row) => row.feature === "couple_recap").medianLatencyMs, 5000);
  const rank = (userId) => report.topUsers.findIndex((row) => row.userId === userId);
  assert.ok(rank(b.id) >= 0 && rank(b.id) < rank(a.id), "the larger spender ranks higher");
  assert.deepEqual(report.topUsers.map((row) => row.usd), [...report.topUsers.map((row) => row.usd)].sort((x, y) => y - x));
  assert.ok(report.costPerActiveUser.activeUsers >= 3);
  assert.equal(report.costPerActiveUser.usdPerActiveUser, Math.round(report.window.usd / report.costPerActiveUser.activeUsers * 1e6) / 1e6);
  assert.ok(report.byChannel.subscription > 0 && report.byChannel.metered > 0);
  assert.match(report.prices.anthropic, /^https:\/\/platform\.claude\.com/); assert.equal(report.prices.checked, "2026-11-12");
  const text = formatReport(report);
  assert.match(text, /Per feature/); assert.match(text, /voice_call/); assert.match(text, /Cost per active user/);
  assert.match(formatReport({ ...report, perUserDay: [] }), /\(no data yet\)/);

  // Admin only: the internal bearer secret, never a member's session.
  const app = express(); app.use(createAiCostRouter({ store, internalSecret: () => "s".repeat(40) }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/internal/ai-cost`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { authorization: "Bearer wrong" } })).status, 401);
    assert.equal((await fetch(`${url}?days=0`, { headers: { authorization: `Bearer ${"s".repeat(40)}` } })).status, 400);
    const response = await fetch(`${url}?days=3`, { headers: { authorization: `Bearer ${"s".repeat(40)}` } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.perUserDay) && Array.isArray(body.perFeature) && Array.isArray(body.topUsers) && body.costPerActiveUser);
  } finally { server.close(); }
});

test("rows are kept 35 days, monthly totals 13 months, and the hourly summary line is content-free", async () => {
  install();
  const { a } = await couple();
  clock = new Date("2026-09-01T09:00:00Z"); recordAiCall({ userId: a.id, feature: "assistant_turn", provider: "openai", model: "gpt-5.4", reportedUsd: 0.01 });
  clock = new Date("2026-11-12T09:00:00Z"); recordAiCall({ userId: a.id, feature: "assistant_turn", provider: "openai", model: "gpt-5.4", reportedUsd: 0.01 });
  await flushAiLedger();
  const old = createOldRollup(a.id);
  await store.createRelationshipRecord("aiUsage", old);
  const pruned = await pruneAiLedger(store, clock);
  assert.ok(pruned >= 2);
  const left = (await store.listRecordsForJob("aiUsage")).filter((record) => record.ownerUserId === a.id);
  assert.deepEqual(left.filter((record) => record.kind === "ai_ledger").map((record) => record.utcDay), ["2026-11-12"]);
  assert.ok(left.some((record) => record.id === `ai-cost:${a.id}:2026-09`), "the September total stays for the monthly report");
  assert.ok(!left.some((record) => record.id === old.id));
  // maxRows bounds the table even inside the window.
  for (let index = 0; index < 3; index += 1) recordAiCall({ userId: a.id, feature: "daily_question", provider: "openai", model: "gpt-5.4-mini", reportedUsd: 0.001 });
  await flushAiLedger();
  await pruneAiLedger(store, clock, { ...AI_COST_DEFAULTS, maxRows: 2 });
  assert.equal((await store.listRecordsForJob("aiUsage")).filter((record) => record.kind === "ai_ledger").length, 2);
  const report = await runAiLedgerMaintenance(store, clock);
  assert.ok(report);
  const line = logs.find((entry) => String(entry).startsWith("ai_cost_summary "));
  assert.ok(line); assert.ok(JSON.parse(line.slice("ai_cost_summary ".length)).users.length >= 1);
  assert.equal(await runAiLedgerMaintenance(store, clock), null, "at most once an hour");
});

function createOldRollup(userId) {
  return { id: `ai-cost:${userId}:2025-09`, relationshipId: null, createdByUserId: userId, ownerUserId: userId, visibility: "private", aiAccessScope: "none", approvalPolicy: "owner", status: "recorded", version: 1, createdAt: "2025-09-01T00:00:00Z", updatedAt: "2025-09-01T00:00:00Z", kind: "ai_cost_month", month: "2025-09", total: { usd: 1, calls: 1, unknown: 0, features: {} }, days: {} };
}
