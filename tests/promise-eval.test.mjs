import assert from "node:assert/strict";
import { test } from "node:test";
import { droppedReasons, loadFixtures, scoreFixture, scoreRun, validateFixtures } from "../scripts/promise-eval/score.mjs";

// The promise-extraction eval's fixtures and scorer, checked without any model call.
const data = loadFixtures();
const fixture = (id) => data.fixtures.find((item) => item.id === id);

test("the eval fixtures are well-formed and cover what the eval promises to cover", () => {
  assert.deepEqual(validateFixtures(data), []);
  assert.ok(data.fixtures.length >= 20);
  assert.ok(data.fixtures.some((item) => item.channel === "private"));
  assert.ok(data.fixtures.some((item) => item.messages.length >= 20), "a long chat with a buried promise");
  const traps = new Set(data.fixtures.flatMap((item) => item.traps.map((trap) => trap.kind)));
  for (const kind of ["wish", "joke", "done", "cancelled", "third-party", "question", "pinky"]) assert.ok(traps.has(kind), `a ${kind} trap`);
  for (const by of ["A", "B", "both"]) assert.ok(data.fixtures.some((item) => item.expected.some((expected) => expected.by === by)), `a promise by ${by}`);
  assert.ok(data.fixtures.some((item) => item.expected.length === 0), "chats with no promise at all");
});

test("the validator names a broken fixture", () => {
  const broken = { fixtures: [{ id: "x", channel: "together", names: { A: "a", B: "b" }, messages: [{ from: "Pinky", text: "hi" }], expected: [{ line: 0, by: "A", to: "A", what: [], when: "" }], traps: [{ line: 4, kind: "wish" }] }] };
  const problems = validateFixtures(broken).join("\n");
  for (const part of ["partner's message", "to must be B", "what needs keywords", "when must be a list", "trap 0"]) assert.match(problems, new RegExp(part));
});

test("a perfect canned answer scores 100% on every fixture", () => {
  const runs = data.fixtures.map((item) => ({ fixture: item, predictions: item.expected.filter((expected) => !expected.optional).map((expected) => ({
    line: Array.isArray(expected.line) ? expected.line[0] : expected.line, by: expected.by,
    what: expected.what.map((word) => word.split("|")[0]).join(" "), when: expected.when.find((option) => option !== "") || "",
  })) }));
  const { totals, errors } = scoreRun(runs);
  assert.equal(totals.precision, 1); assert.equal(totals.recall, 1);
  assert.deepEqual([totals.fields.by, totals.fields.what, totals.fields.when], [1, 1, 1]);
  assert.deepEqual(errors, {});
});

test("the scorer counts misses, false alarms, duplicates and wrong fields", () => {
  // The joke line kept, the real promise found with the wrong person and time, and found twice.
  const sarcasm = scoreFixture(fixture("en-sarcasm-then-real"), [
    { line: 2, by: "A", what: "do every dish", when: "" },
    { line: 3, by: "A", what: "do the dishes", when: "tomorrow" },
    { line: 3, by: "B", what: "wash dishes", when: "tonight" },
  ]);
  assert.deepEqual([sarcasm.tp, sarcasm.fp, sarcasm.fn], [1, 2, 0]);
  assert.deepEqual(sarcasm.results.map((item) => item.error || item.outcome), ["false:joke", "true_positive", "false:duplicate"]);
  assert.deepEqual(sarcasm.results[1].fields, { by: false, what: true, when: false });

  // Nothing found in a chat with three promises; a judgment call found is neither a hit nor a false alarm.
  const birthday = scoreFixture(fixture("zh-two-promises-birthday"), []);
  assert.deepEqual([birthday.tp, birthday.fp, birthday.fn], [0, 0, 3]);
  const socks = scoreFixture(fixture("zh-sarcasm-socks"), [{ line: 3, by: "A", what: "把袜子收好", when: "现在" }]);
  assert.deepEqual([socks.tp, socks.fp, socks.fn, socks.optionalHits], [0, 0, 0, 1]);

  // Accents and case do not matter; an empty time is right only where the fixture allows it.
  assert.equal(scoreFixture(fixture("es-en-paella"), [{ line: 1, by: "B", what: "Cocinar paella", when: "el Sábado" }]).results[0].fields.when, true);
  assert.equal(scoreFixture(fixture("zh-two-promises-birthday"), [{ line: 1, by: "B", what: "订餐厅", when: "" }]).results[0].fields.when, true);
  assert.equal(scoreFixture(fixture("en-call-mom-tomorrow"), [{ line: 2, by: "B", what: "call her", when: "" }]).results[0].fields.when, false);

  const run = scoreRun([
    { fixture: fixture("en-sarcasm-then-real"), predictions: [{ line: 2, by: "A", what: "do every dish", when: "" }], raw: [{ line: 2, quote: "I'll just do every single dish" }, { line: 3, quote: "" }] },
    { fixture: fixture("en-call-mom-tomorrow"), predictions: [], error: "claude CLI timed out" },
  ]);
  assert.deepEqual([run.totals.tp, run.totals.fp, run.totals.fn, run.totals.precision, run.totals.recall], [0, 1, 2, 0, 0]);
  assert.equal(run.totals.droppedBeforeKeeping, 1);
  assert.deepEqual(run.errors, { "missed:plain": 2, "false:joke": 1, model_error: 1, "dropped:empty_quote": 1 });
});

test("answers the app's quote check throws away are named by why", () => {
  const chat = fixture("zh-third-party-and-pinky");
  const raw = [
    { line: 4, quote: "我周日下午去交" }, { line: 4, quote: "我周日下午去交" }, { line: -1, quote: "我周日下午去交" },
    { line: 4, quote: "" }, { line: 4, quote: "我明天去交" }, { line: 3, quote: "周日上午提醒你们交房租" },
  ];
  assert.deepEqual(droppedReasons(chat, raw, [{ line: 4 }]), ["dropped:duplicate", "dropped:bad_message_id", "dropped:empty_quote", "dropped:quote_not_in_line", "dropped:not_partner_line"]);
});
