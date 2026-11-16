import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { resolve, join } from "node:path";
import { gateSummary, loadGate, gateRoot, machineChecks, writeRepresentativeBaseline, canonical } from "../scripts/parity-eval/model-gate.mjs";
import { primaryQuota } from "../scripts/parity-eval/model-gate-quota.mjs";
import { prepareSourceReply } from "../server/source-reply.mjs";
import { renderReply } from "../server/reply-contract.mjs";

test("the gate freezes 40 verified main answers and 20 independent representative cases", () => {
  const { config, baseline } = loadGate();
  assert.equal(config.cases.length, 60);
  assert.equal(baseline.sourceCommit, "de725b8c81e297a0ebea2a24f40e85e0cb805bd7");
  for (const item of config.cases.filter(item => item.set === "practice")) assert.ok(baseline.results.some(row => row.id === item.id && row.pinky.answer));
  assert.equal(baseline.results.filter(row => row.id.startsWith("h7-")).length, 0);
  assert.equal(canonical({ url: "http://127.0.0.1:65136/event" }), canonical({ url: "http://127.0.0.1:39221/event" }));
});

test("an edited archived answer fails closed before model calls", () => {
  mkdirSync(resolve("work"), { recursive: true });
  const root = mkdtempSync(resolve("work", "gate-integrity-"));
  cpSync(join(gateRoot, "model-gate-baselines"), join(root, "model-gate-baselines"), { recursive: true });
  cpSync(join(gateRoot, "model-gate-cases.json"), join(root, "model-gate-cases.json"));
  const archive = join(root, "model-gate-baselines/task65-claude.json");
  writeFileSync(archive, readFileSync(archive, "utf8").replaceAll("\n", "\r\n"));
  assert.equal(loadGate(root).baseline.results.length, 40);
  writeFileSync(archive, readFileSync(archive, "utf8").replace('"answer":', '"changedAnswer":'));
  assert.throws(() => loadGate(root), /哈希/);
});

test("quick fails empty answers, real-write failures, missing page evidence and literal contract violations", () => {
  const text = { probe: { text: "不超过3字，只用一句话回答。" } };
  assert.equal(machineChecks(text, { answer: "", completed: null }).every(row => row.ok), false);
  assert.equal(machineChecks(text, { answer: "这是一个远超过三个字的回答。", completed: null }).every(row => row.ok), false);
  assert.equal(machineChecks({ probe: { text: "提醒我" }, check: { kind: "reminder" } }, { answer: "已设好", completed: false }).every(row => row.ok), false);
  assert.equal(machineChecks({ probe: { text: "查页面" }, readonly: {} }, { answer: "查到了", completed: null }).every(row => row.ok), false);
  assert.equal(machineChecks({ probe: { text: "只答时间。" } }, { answer: "19:30", completed: null }).every(row => row.ok), true);
  assert.equal(machineChecks({ probe: { text: "只答时间。" } }, { answer: "明天19:30，我已经记住了。", completed: null }).every(row => row.ok), false);
  assert.equal(gateSummary([{ layer: "tools", checks: [{ ok: false }] }], { quick: true }).pass, false);
});

test("one loss is allowed per layer; two losses, disputes, missing votes or machine failure cannot pass", () => {
  const make = outcome => ({ layer: "memory", checks: [{ ok: true }], votes: [{ judge: "codex", outcome }, { judge: "claude", outcome }] });
  const rows = Array.from({ length: 12 }, () => make("tie"));
  rows[0] = make("loss"); assert.equal(gateSummary(rows).pass, true);
  rows[1] = make("loss"); assert.equal(gateSummary(rows).pass, false);
  rows[0] = { ...make("tie"), votes: [{ judge: "codex", outcome: "loss" }, { judge: "claude", outcome: "tie" }] };
  assert.equal(gateSummary(rows).layers.memory.disputed, 1);
  assert.equal(gateSummary(rows).pass, false);
  assert.equal(gateSummary([{ layer: "tools", checks: [{ ok: true }], votes: [] }]).pass, false);
  assert.equal(gateSummary([{ ...make("win"), checks: [{ ok: false }] }]).pass, false);
  assert.equal(gateSummary([{ layer: "tools", checks: [{ ok: true }], votes: [{ judge: "codex", outcome: "win" }] }]).pass, true);
});

test("recording requires all 20 current-model answers and never overwrites an existing archive", () => {
  mkdirSync(resolve("work"), { recursive: true });
  const root = mkdtempSync(resolve("work", "gate-record-"));
  const { config } = loadGate(), input = { cases: config.cases, channel: "claude", model: "sonnet", commit: "main-test", corpusHash: "fixed" };
  const results = config.cases.filter(item => item.set === "representative").map(item => ({ id: item.id, question: item.probe.text, visible: {}, pinky: { answer: "test transport answer" } }));
  const file = join(root, "baseline.json");
  assert.throws(() => writeRepresentativeBaseline(file, input, results.slice(1)), /不完整/);
  assert.throws(() => writeRepresentativeBaseline(file, { ...input, model: "fake" }, results), /线上模型/);
  writeRepresentativeBaseline(file, input, results);
  assert.equal(JSON.parse(readFileSync(file)).results.length, 20);
  assert.throws(() => writeRepresentativeBaseline(file, input, results), /EEXIST/);
});

test("Codex quota uses the latest metadata and stops at 97 percent or when readings are missing", () => {
  mkdirSync(resolve("work"), { recursive: true });
  const root = mkdtempSync(resolve("work", "gate-quota-"));
  const now = new Date(), home = join(root, "sessions"), folder = join(home, String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, "0"), "01");
  mkdirSync(folder, { recursive: true });
  const file = join(folder, "session.jsonl");
  writeFileSync(file, "");
  assert.throws(() => primaryQuota(root, home), /没有.*读数/);
  const event = (at, used) => JSON.stringify({ timestamp: at, payload: { rate_limits: { primary: { used_percent: used } } } }) + "\n";
  writeFileSync(file, event("2026-11-01T00:00:00Z", 99) + event("2026-11-02T00:00:00Z", 96));
  assert.equal(primaryQuota(root, home).usedPercent, 96);
  writeFileSync(file, event("2026-11-02T00:00:00Z", 97));
  assert.throws(() => primaryQuota(root, home), /97%/);
});

test("standalone historical source observations remain covered by the whole-candidate replay corpus", () => {
  const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
  const corpus = fixture("source-selection-replay.json").rows.flatMap(row => row.events.map(event => event.text));
  const standalone = fixture("source-rewrite-replay.json");
  for (const event of [standalone.check, standalone.rewrite]) assert.ok(corpus.includes(event.text));
});

test("all historical rollback sequences select a whole original or rewritten answer", async () => {
  const { events } = JSON.parse(readFileSync(new URL("./fixtures/source-rollback-replay.json", import.meta.url), "utf8"));
  assert.equal(events.length, 9);
  for (let index = 0; index < events.length; index += 3) {
    const [check, rewrite, review] = events.slice(index, index + 3);
    assert.deepEqual([check.name, rewrite.name, review.name], ["reply_source_check", "reply_format_repair", "reply_source_check"]);
    const input = JSON.parse(check.prompt);
    let candidate;
    try { candidate = JSON.parse(rewrite.text); } catch { candidate = rewrite.text; }
    let calls = 0;
    const answer = await prepareSourceReply(input.reply, { ...input, mediator: {
      async checkReplySources() { return { ...JSON.parse((calls++ ? review : check).text), newUnauthorizedStance: false, lostDeliverables: false }; },
      async rewriteReply() { return candidate; },
    } });
    assert.ok([renderReply(input), renderReply(candidate)].includes(answer), check.case);
    assert.ok(answer.trim());
  }
});
