import assert from "node:assert/strict";
import { test } from "node:test";
import { CATEGORIES, cases } from "../scripts/memory-eval/cases.mjs";
import { caseResult, grade, summarize, validateCases } from "../scripts/memory-eval/score.mjs";
// Keep the parity harness's evidence/denominator contracts in the existing CI entrypoint; no live model calls.
import "../scripts/parity-eval/score.test.mjs";

// The memory eval's own cases and grading (founder 11-09: "先搭测试集"); the run itself needs the Claude CLI.
test("every memory case is well formed and every category has cases", () => {
  assert.deepEqual(validateCases(cases), []);
  for (const category of Object.keys(CATEGORIES)) assert.ok(cases.some((item) => item.category === category), `no case for ${category}`);
});

test("one thing it must never say fails an answer, and one leak in repeated asks fails the case", () => {
  const item = { id: "x", category: "partner", expect: { must: ["a", "b"], mustNot: ["leak"] } };
  assert.equal(grade(item, { must: [{ score: 1 }, { score: 0.5 }], violations: [], abstained: false }).pass, true);
  assert.equal(grade(item, { must: [{ score: 1 }, { score: 1 }], violations: ["leak"], abstained: false }).pass, false);
  assert.equal(grade({ ...item, expect: { ...item.expect, abstain: true } }, { must: [{ score: 1 }], violations: [], abstained: false }).pass, false);
  const answers = [true, true, false].map((pass) => ({ grade: { pass, points: 1, violations: pass ? [] : ["leak"] } }));
  const result = caseResult(item, answers);
  assert.equal(result.pass, false); assert.equal(result.leaks, 1);
  assert.equal(summarize([result]).byCategory.partner.passed, 0);
});
