import { test } from "node:test";
import assert from "node:assert/strict";
import { blindPair, completionResult, decodeVerdict, summarize } from "./score.mjs";
import { formatVisibleAnswer, projectSnapshot, visibleContext } from "./fixture.mjs";
import { createRelationshipRecord } from "../../server/relationship-domain.mjs";
import { recordChecks } from "./evidence.mjs";
import { cases, layers } from "./cases.mjs";
import { createHarness } from "./fixture.mjs";
import { corpusHash, frozenCase, frozenOpponent, installCaseClock } from "./replay.mjs";
import { AsyncLocalStorage } from "node:async_hooks";
import { reviewBatches } from "./review-batch.mjs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

test("batched reviewers never see the same product answer against both rivals in one call", async (t) => {
  const directory = await mkdtemp(join(resolve("work"), "review-batch-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const packets = [0, 1].map((id) => ({
    item: { id: String(id), question: `question-${id}`, visible: {}, expect: { must: [], mustNot: [] } },
    result: { id: String(id), pinky: { answer: `product-${id}`, machineCompleted: true }, comparisons: {},
      rivals: { claude: { provider: "claude", answer: `first-${id}` }, codex: { provider: "codex", answer: `second-${id}` } } },
  }));
  for (const { result } of packets) await mkdir(join(directory, result.id));
  let calls = 0;
  await reviewBatches({ packets, directory, context: new AsyncLocalStorage(), seed: "test", checkpoint: async () => {}, batchSize: 16,
    invokeJudge: async (_judge, { input }) => {
      calls++;
      const batch = JSON.parse(input);
      assert.equal(new Set(batch.map((row) => row.question)).size, batch.length);
      assert.ok(batch.every((row) => /^packet-\d+$/.test(row.id)));
      return { value: { verdicts: batch.map(({ id }) => ({ id, verdict: { winner: "tie", aComplete: true, bComplete: true, aViolations: [], bViolations: [], reason: "Both satisfy the packet." } })) } };
    } });
  assert.equal(calls, 4);
  assert.ok(packets.every(({ result }) => result.pinky.completed && Object.values(result.comparisons).every((pair) => pair.judges.length === 2)));
});

test("unknown judgments never become non-losses; disagreements are separately counted", () => {
  const row = (judges, error) => ({ layer: "memory", pinky: { completed: true, error }, rivals: { claude: {}, codex: {} }, comparisons: { claude: { judges }, codex: { judges } } });
  const rows = [row([{ outcome: "loss" }, { outcome: "loss" }]), row([{ outcome: "win" }, { outcome: "loss" }]), row([{ outcome: "tie" }, { error: "timeout" }]), row([{ outcome: "tie" }, { outcome: "tie" }], "HTTP 503")];
  const summary = summarize(rows, layers).memory;
  assert.deepEqual(summary.comparisons.claude, { loss: 1, notLose: 1, disagreement: 1, pending: 2, rate: 0.25 });
  assert.equal(summary.reached, false);
});

test("private partner histories never reach a competitor's context", () => {
  const item = { paired: { me: "Alice", partner: "Bob" }, probe: { as: "partner", thread: "main" }, history: [{ thread: "main", day: -3, text: "PRIVATE_CANARY" }, { thread: "partner", day: -2, text: "Bob owns this" }], notes: [{ about: "me", day: -1, text: "PRIVATE_NOTE" }] };
  const visible = visibleContext(item, Date.UTC(2026, 10, 10));
  assert.equal(visible.user, "Bob");
  assert.equal(visible.history.length, 1);
  assert.doesNotMatch(JSON.stringify(visible), /PRIVATE/);
  const own = visibleContext({ ...item, probe: { thread: "main" } }, Date.UTC(2026, 10, 10));
  assert.doesNotMatch(JSON.stringify(own), /Bob owns/);
  const shared = visibleContext({ ...item, channel: "shared", probe: { thread: "main" } }, Date.UTC(2026, 10, 10));
  assert.deepEqual(shared.history, []);
  assert.deepEqual(shared.notes, []);
});

test("raw paired memories are projected before deciding whether a partner can see private content", () => {
  const privateMemory = createRelationshipRecord({ relationshipId: "paired", userId: "alice", visibility: "private", aiAccessScope: "private", text: "我在考虑辞职" });
  const raw = { memories: [privateMemory] };
  assert.match(JSON.stringify(raw), /辞职/);
  assert.deepEqual(projectSnapshot(raw, "bob").memories, []);
  assert.match(JSON.stringify(projectSnapshot(raw, "alice")), /辞职/);
  // A real shared disclosure must still fail the same no-disclosure predicate.
  const disclosed = { memories: [{ ...privateMemory, visibility: "shared" }] };
  const undisclosed = (snapshot) => !JSON.stringify(projectSnapshot(snapshot, "bob")).includes("辞职");
  assert.equal(undisclosed(raw), true);
  assert.equal(undisclosed(disclosed), false);
  assert.equal(raw.memories[0].visibility, "private");
});

test("visible answers include chat card dates and complete drafts without backend identifiers or detail-only fields", () => {
  const answer = formatVisibleAnswer("已准备好。", {
    cards: [{ id: "PRIVATE_ID", kind: "reminder", title: "给妈妈打电话", text: "明天联系", localDateTime: "2026-11-11T08:00", timezone: "HIDDEN_ZONE", frequency: "HIDDEN_FREQUENCY", tool: "HIDDEN_TOOL" },
      { kind: "link", url: "/internal/PRIVATE_ID", title: "打开资料", text: "HIDDEN_LINK_TEXT" }],
    draft: { id: "PRIVATE_DRAFT_ID", title: "轮流做饭", summary: "周末分担", terms: ["这周我做", "下周你做"], unresolvedPoints: ["几点开始"], privateNotes: "HIDDEN_NOTE" },
  });
  for (const text of ["已准备好", "给妈妈打电话", "明天联系", "2026-11-11 08:00", "打开资料", "轮流做饭", "周末分担", "这周我做", "下周你做", "还没定的", "几点开始"]) assert.ok(answer.includes(text), text);
  assert.match(answer, /你们俩都要批准同一版本/);
  assert.doesNotMatch(answer, /PRIVATE|HIDDEN|reminder|Pinky/);
});

test("blind order decodes correctly in either direction without exposing labels", () => {
  const item = { id: "x", question: "Ask Pinky", visible: {}, expect: { must: ["Claude"], mustNot: [] }, completion: "Pinky cite" };
  const pair = blindPair(item, { answer: "Pinky answer", evidence: { persisted: ["IDENTITY_CANARY"] } }, { provider: "codex", answer: "Codex answer" }, "claude", "seed");
  assert.doesNotMatch(JSON.stringify(pair.input), /Pinky|Claude|Codex/i);
  assert.doesNotMatch(JSON.stringify(pair.input), /IDENTITY_CANARY|persisted|provider/);
  for (const swap of [true, false]) assert.equal(decodeVerdict({ winner: swap ? "B" : "A", aComplete: true, bComplete: false, aViolations: [], bViolations: [], reason: "evidence" }, swap).outcome, "win");
  assert.throws(() => decodeVerdict({ winner: "tie" }, false));
});

test("stored success cannot become task completion without all content judges", () => {
  assert.equal(completionResult(true, [{ error: "timeout" }]), null);
  assert.equal(completionResult(false, [{ error: "timeout" }]), false);
  assert.equal(completionResult(true, Array.from({ length: 4 }, () => ({ pinkyComplete: true }))), true);
  assert.equal(completionResult(true, [{ pinkyViolations: ["private disclosure"] }]), false);
});

test("a stored reminder with wrong time cannot pass on title alone", () => {
  const item = cases.find((entry) => entry.id === "tool-reminder-once");
  const record = { title: "给妈妈打电话", ownerUserId: "u", visibility: "private", dueAt: "2026-11-11T01:00:00Z", timezone: "Asia/Shanghai", frequency: "once" };
  const checks = recordChecks(item, [record], { userId: "u", now: Date.parse("2026-11-10T10:00:00Z") });
  assert.equal(checks.find((check) => check.name === "日期、时区及时间正确").ok, false);
  record.dueAt = "2026-11-11T00:00:00Z";
  assert.ok(recordChecks(item, [record], { userId: "u", now: Date.parse("2026-11-10T10:00:00Z") }).every((check) => check.ok));
});

test("a shared space without its items is not a completed list", () => {
  const item = cases.find((entry) => entry.id === "tool-shared-space-list");
  const space = { id: "s", title: "周末露营", visibility: "shared" };
  const checks = recordChecks(item, [space], { userId: "u", peer: { spaces: [space], spaceItems: [] }, spaceItems: [] });
  assert.equal(checks.find((check) => check.name === "所有清单内容已保存").ok, false);
});

test("corpus includes all layers, privacy repeats, and real multimodal inputs", () => {
  assert.equal(new Set(cases.map((item) => item.id)).size, cases.length);
  for (const layer of Object.keys(layers)) assert.ok(cases.filter((item) => item.layer === layer).length >= 8);
  for (const item of cases) { assert.ok(item.completion); assert.ok(item.expect.must.length); assert.ok(item.probe.text); }
  assert.equal(cases.filter((item) => item.check?.kind === "privacy" && item.probe.repeat === 3).length, 2);
  assert.ok(cases.some((item) => item.modality === "screenshot" && item.assetText));
  assert.ok(cases.some((item) => item.modality === "file" && item.assetText));
});

test("frozen replay refuses changed questions/corpus and does not count historical opponent cost again", () => {
  const item = cases.find((entry) => entry.id === "tool-reminder-once");
  const rival = { answer: "明天八点提醒", usd: 0.1, usage: { input_tokens: 100 }, ms: 500 };
  const baseline = { caseHash: corpusHash(cases), results: [{ id: item.id, question: item.probe.text, visible: visibleContext(item, Date.UTC(2026, 10, 10)), rivals: { claude: rival, codex: rival } }] };
  const row = frozenCase(item, baseline, corpusHash(cases));
  const reused = frozenOpponent(row, "claude", "hash");
  assert.equal(reused.answer, rival.answer); assert.equal(reused.usd, 0); assert.equal(reused.originalCost.usd, 0.1);
  assert.equal(rival.usd, 0.1); assert.throws(() => frozenCase(item, baseline, "different"), /hash differs/);
  assert.throws(() => frozenCase({ ...item, probe: { text: "changed" } }, baseline, corpusHash(cases)), /question differs/);
});

test("replay calendar stays case-local while timeouts advance and native Date operations work", async () => {
  const context = new AsyncLocalStorage(), RealDate = Date, restore = installCaseClock(context);
  try {
    const realStart = RealDate.now(), historical = Date.parse("2026-01-01T00:00:00Z");
    await context.run({ clock: { at: historical, startedAt: realStart } }, async () => {
      assert.equal(new Date().toISOString().slice(0, 10), "2026-01-01");
      assert.equal(new Date(0).toISOString(), "1970-01-01T00:00:00.000Z");
      assert.equal(typeof Date(), "string");
      const start = Date.now(); await new Promise((r) => setTimeout(r, 20)); assert.ok(Date.now() > start);
    });
    assert.ok(Math.abs(Date.now() - RealDate.now()) < 100);
  } finally { restore(); }
  assert.equal(Date, RealDate);
});

test("agreement replay uses actual HTTP actions and independent authenticated approvals", async (t) => {
  const base = resolve("work", "parity-test"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "approval-"));
  const mediator = { aiReady: false, continueTogether: async () => ({ reply: "这是草稿，小闻需要本人批准。", source: "test", actions: [],
    draftAgreement: { title: "轮流做饭", summary: "周末轮换", terms: ["本周小安做饭，下周小闻做饭，之后每周轮换。"], unresolvedPoints: [] } }) };
  const requestContext = new AsyncLocalStorage(), restoreClock = installCaseClock(requestContext);
  const harness = await createHarness(directory, { mediator, requestContext });
  t.after(async () => { await harness.close(); restoreClock(); assert.ok(resolve(directory).startsWith(`${base}\\`) || resolve(directory).startsWith(`${base}/`)); await rm(directory, { recursive: true }); });
  const original = cases.find((entry) => entry.id === "tool-agreement-draft");
  const item = { ...original, question: original.probe.text, agreementFlow: true };
  const clock = { at: Date.parse("2026-01-15T12:00:00Z"), startedAt: Date.now() };
  const setup = await requestContext.run({ case: item.id, phase: "seed", clock }, () => harness.setup(item));
  const result = await requestContext.run({ case: item.id, phase: "probe", clock }, () => harness.ask(setup, item));
  assert.equal(result.completed, true, JSON.stringify(result.evidence.checks));
  assert.equal(result.evidence.approvalFlow.stages.length, 5);
  assert.equal(result.evidence.approvalFlow.stages[2].agreement.approvedBy.length, 1);
  assert.equal(result.evidence.approvalFlow.stages[3].agreement.approvedBy.length, 1);
  assert.equal(result.evidence.approvalFlow.stages[4].agreement.approvedBy.length, 2);
  assert.equal(result.evidence.persisted[0].status, "active");
  assert.equal(result.evidence.persisted[0].effectiveAt.slice(0, 10), "2026-01-15", "HTTP handler inherits frozen case calendar");
  assert.match(result.answer, /约定草稿/);
  assert.doesNotMatch(result.answer, /已生效/);
});


test("economy judging accepts a Codex win but requires Claude for a tie or loss", async () => {
  const { comparisonReady } = await import("./score.mjs");
  const { quotaError } = await import("./call-guard.mjs");
  assert.equal(comparisonReady({policy: "codex-first", judges: [{judge: "codex", outcome: "win"}]}), true);
  for (const outcome of ["tie", "loss"]) assert.equal(comparisonReady({policy: "codex-first", judges: [{judge: "codex", outcome}]}), false);
  assert.equal(comparisonReady({policy: "codex-first", judges: [{judge: "codex", outcome: "loss"}, {judge: "claude", outcome: "tie"}]}), true);
  assert.equal(comparisonReady({policy: "codex-first", judges: [{judge: "codex", error: "quota"}]}), false);
  assert.equal(quotaError("You've hit your weekly limit · resets 6pm"), true);
  assert.equal(quotaError('{"error":"rate_limit_error"}'), true);
  assert.equal(quotaError("I respect your boundaries and limits."), false);
});
