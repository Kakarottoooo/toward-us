import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { runCliProcess } from "../server/cli-process.mjs";
import { createModelCallBudget, setModelCallBudget, budgetedModelCall } from "../server/model-call-budget.mjs";
import { assistantInstructions, screenshotAdviceInstructions } from "../server/assistant-agent.mjs";
import { loadCasesFile, renderAsset, writeChecks } from "../scripts/parity-eval/external-cases.mjs";
import { createHarness, visibleContext } from "../scripts/parity-eval/fixture.mjs";

test("CLI failure retains drained UTF-8 output and budget metadata; missing metadata permits the next call", async (t) => {
  const budget = createModelCallBudget({ maxClaudeTurns: 6 });
  setModelCallBudget(budget); t.after(() => setModelCallBudget(null));
  const execute = (source) => runCliProcess(process.execPath, ["-e", source], "", process.cwd(), 2000);
  await assert.rejects(budgetedModelCall("claude", [], () => execute('process.stdout.write(JSON.stringify({num_turns:2,result:"中文"})); process.stderr.write("diagnostic"); process.exitCode=1;'), 4), (error) => error.code === 1 && error.stderr === "diagnostic" && error.stdout.includes("中文"));
  assert.equal(budget.state.claudeTurns, 2);
  await assert.rejects(budgetedModelCall("claude", [], () => execute('process.stderr.write("missing result");process.exitCode=1;'), 1));
  assert.equal(budget.state.claudeTurns, 3);
  await budgetedModelCall("claude", [], async () => '{"type":"system"}\n{"type":"result","num_turns":1}', 1);
  assert.equal(budget.state.claudeTurns, 4);
  assert.equal(budget.state.stopped, null);
});

test("CLI timeout closes transport and retains partial output", async () => {
  await assert.rejects(runCliProcess(process.execPath, ["-e", 'process.stdout.write("partial");setInterval(()=>{},1000)'], "", process.cwd(), 500), (error) => error.code === "ETIMEDOUT" && error.stdout === "partial");
});

test("source grounding applies to both first image answers and ordinary file/transcript replies", () => {
  for (const language of ["zh", "en", "es"]) {
    for (const prompt of [assistantInstructions(language), screenshotAdviceInstructions(language)]) {
      assert.match(prompt, /Ground all prose in visible sources; keep speakers\/dates; states aren't outcomes/);
      assert.match(prompt, /Never invent events, feelings or consent/);
      assert.match(prompt, /unsupportedPremise to any unrecorded event assumed by the question/);
      assert.match(prompt, /sendableDraft: copyable wording or null/);
    }
    assert.match(assistantInstructions(language), /cross-contact from shared utensils, oil or preparation/);
    assert.match(assistantInstructions(language), /otherwise avoid it/);
  }
});

test("external examples seed projected records, render PNG, and check actual writes independently of replies", async (t) => {
  await mkdir(resolve("work"), { recursive: true });
  const directory = await mkdtemp(join(resolve("work"), "round4-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { cases, source } = await loadCasesFile("scripts/parity-eval/examples.json");
  assert.equal(source.purpose, "examples");
  const item = cases[0];
  const png = await renderAsset(item, directory);
  assert.equal((await readFile(png)).subarray(1, 4).toString(), "PNG");
  const harness = await createHarness(directory, { mediator: { structured: async () => ({ notes: [] }) } });
  t.after(() => harness.close());
  const setup = await harness.setup({ ...item, history: [], notes: [] });
  const own = await harness.store.relationshipSnapshotForUser(setup.me.user.id);
  const peer = await harness.store.relationshipSnapshotForUser(setup.partner.user.id);
  assert.equal(own.reminders.filter((row) => row.ownerUserId === setup.me.user.id).length, 1);
  assert.equal(peer.reminders.filter((row) => row.ownerUserId === setup.partner.user.id).length, 1);
  assert.ok(own.togetherConversations.some((row) => row.messages.some((message) => message.text === item.shared[0].text)));
  assert.equal(visibleContext(item, Date.now()).reminders.length, 1);
  assert.ok(!JSON.stringify(visibleContext(item, Date.now())).includes("PRIVATE_EXAMPLE"));
  const specs = cases[1].writes;
  const context = { me: "owner", at: Date.parse("2026-11-11T08:00:00Z") };
  assert.equal(writeChecks(specs, {}, { reminders: [] }, context)[0].ok, false);
  const row = { id: "new", title: "占位提醒", dueAt: "2026-11-12T01:00:00.000Z", timezone: "Asia/Shanghai", frequency: "once", visibility: "private", ownerUserId: "owner" };
  assert.equal(writeChecks(specs, {}, { reminders: [row] }, context)[0].ok, true);
  assert.equal(writeChecks(specs, {}, { reminders: [row, { ...row, id: "duplicate" }] }, context)[0].ok, false);
  assert.equal(writeChecks(specs, {}, { reminders: [{ ...row, ownerUserId: "other" }] }, context)[0].ok, false);
  await writeFile(join(directory, "invalid.json"), JSON.stringify({ version: 1, purpose: "examples", cases: [{ ...item, id: "../escape" }] }));
  await assert.rejects(loadCasesFile(join(directory, "invalid.json")), /Unsafe/);
});
