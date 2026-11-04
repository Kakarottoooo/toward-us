import { readFileSync } from "node:fs";

// Scoring for the promise-extraction eval: no model, no store, so tests can run it on a canned answer.
export const fixturesUrl = new URL("./fixtures.json", import.meta.url);
export const loadFixtures = () => JSON.parse(readFileSync(fixturesUrl, "utf8"));

const BY = new Set(["A", "B", "both"]);
const TO = { A: "B", B: "A", both: "each other" };
const norm = (value) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "");
const lines = (item) => Array.isArray(item.line) ? item.line : [item.line];

/** Problems with the fixtures file, as readable strings; empty when it is well-formed. */
export function validateFixtures(data) {
  const problems = [], ids = new Set();
  if (!Array.isArray(data?.fixtures) || !data.fixtures.length) return ["fixtures must be a non-empty list"];
  for (const fixture of data.fixtures) {
    const at = (text) => problems.push(`${fixture.id || "?"}: ${text}`);
    if (!fixture.id || ids.has(fixture.id)) at("missing or duplicate id");
    ids.add(fixture.id);
    if (!["together", "private"].includes(fixture.channel)) at("channel must be together or private");
    if (!fixture.names?.A || !fixture.names?.B) at("names.A and names.B are required");
    const messages = fixture.messages || [];
    if (!messages.length) at("no messages");
    const speakers = fixture.channel === "private" ? ["A", "Pinky"] : ["A", "B", "Pinky"];
    messages.forEach((message, index) => {
      if (!speakers.includes(message.from)) at(`message ${index} from ${message.from} is not one of ${speakers.join("/")}`);
      if (!String(message.text || "").trim()) at(`message ${index} has no text`);
    });
    const partnerLine = (line) => Number.isInteger(line) && line >= 0 && line < messages.length && messages[line].from !== "Pinky";
    for (const [index, item] of (fixture.expected || []).entries()) {
      if (!lines(item).length || !lines(item).every(partnerLine)) at(`expected ${index} line must point at a partner's message`);
      if (!BY.has(item.by)) at(`expected ${index} by must be A, B or both`);
      if (item.to !== TO[item.by]) at(`expected ${index} to must be ${TO[item.by]} when by is ${item.by}`);
      if (!Array.isArray(item.what) || !item.what.length || item.what.some((word) => !String(word).trim())) at(`expected ${index} what needs keywords`);
      if (!Array.isArray(item.when)) at(`expected ${index} when must be a list`);
    }
    for (const [index, trap] of (fixture.traps || []).entries()) {
      if (!Number.isInteger(trap.line) || trap.line < 0 || trap.line >= messages.length || !trap.kind) at(`trap ${index} needs a line in range and a kind`);
    }
  }
  return problems;
}

const whatMatches = (expected, what) => expected.what.every((word) => String(word).split("|").some((option) => norm(what).includes(norm(option))));
const whenMatches = (expected, when) => {
  const said = norm(when);
  if (!expected.when.length) return !said;
  if (!said) return expected.when.includes("");
  return expected.when.some((option) => option !== "" && (said.includes(norm(option)) || norm(option).includes(said)));
};

/** Scores one fixture. `predictions` are what the app kept: [{ line, by, what, when, quote }] (line = message index). */
export function scoreFixture(fixture, predictions) {
  const expected = (fixture.expected || []).map((item, index) => ({ ...item, index, matched: null }));
  const results = [];
  for (const prediction of predictions) {
    const open = expected.filter((item) => !item.matched && Number.isInteger(prediction.line) && lines(item).includes(prediction.line));
    // Prefer the expectation whose words fit, then a required one over a judgment call.
    const rank = (item) => (whatMatches(item, prediction.what) ? 0 : 2) + (item.optional ? 1 : 0);
    const target = open.sort((a, b) => rank(a) - rank(b))[0];
    if (!target) {
      const sameLine = expected.some((item) => lines(item).includes(prediction.line));
      const trap = (fixture.traps || []).find((item) => item.line === prediction.line);
      results.push({ prediction, outcome: "false_positive", error: `false:${sameLine ? "duplicate" : trap?.kind || "unlabelled"}` });
      continue;
    }
    target.matched = prediction;
    const fields = { by: prediction.by === target.by, what: whatMatches(target, prediction.what), when: whenMatches(target, prediction.when) };
    results.push({ prediction, outcome: target.optional ? "optional_hit" : "true_positive", expected: target.index, fields });
  }
  const misses = expected.filter((item) => !item.matched && !item.optional).map((item) => ({ expected: item.index, error: `missed:${item.kind || "plain"}` }));
  const scored = results.filter((item) => item.outcome === "true_positive");
  return {
    id: fixture.id,
    tp: scored.length,
    fp: results.filter((item) => item.outcome === "false_positive").length,
    fn: misses.length,
    optionalHits: results.filter((item) => item.outcome === "optional_hit").length,
    fieldChecks: scored.length,
    fieldsRight: { by: scored.filter((item) => item.fields.by).length, what: scored.filter((item) => item.fields.what).length, when: scored.filter((item) => item.fields.when).length },
    results, misses,
  };
}

const ratio = (part, whole) => whole ? part / whole : null;
const squash = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/** Why each raw model answer the app did not keep was dropped: `raw` items carry `line` (-1 = unknown messageId). */
export function droppedReasons(fixture, raw = [], predictions = []) {
  const kept = predictions.map((item) => item.line), reasons = [];
  for (const item of raw) {
    const message = fixture.messages[item.line];
    const reason = !message ? "dropped:bad_message_id" : !squash(item.quote) ? "dropped:empty_quote"
      : message.from === "Pinky" ? "dropped:not_partner_line" : !squash(message.text).includes(squash(item.quote).replace(/^["“「'‘]+|["”」'’]+$/g, "")) ? "dropped:quote_not_in_line" : null;
    if (reason) { reasons.push(reason); continue; }
    const index = kept.indexOf(item.line);
    if (index >= 0) kept.splice(index, 1); else reasons.push("dropped:duplicate");
  }
  return reasons;
}

/** Totals over every fixture. `runs` is [{ fixture, predictions, raw?, error? }]. */
export function scoreRun(runs) {
  const fixtures = runs.map(({ fixture, predictions, error }) => ({ ...scoreFixture(fixture, error ? [] : predictions), ...(error ? { error } : {}) }));
  const sum = (pick) => fixtures.reduce((total, item) => total + pick(item), 0);
  const tp = sum((item) => item.tp), fp = sum((item) => item.fp), fn = sum((item) => item.fn), checks = sum((item) => item.fieldChecks);
  const precision = ratio(tp, tp + fp), recall = ratio(tp, tp + fn);
  const errors = {};
  const count = (name) => { errors[name] = (errors[name] || 0) + 1; };
  for (const item of fixtures) {
    for (const result of item.results) {
      if (result.error) count(result.error);
      if (result.outcome === "true_positive") for (const [field, right] of Object.entries(result.fields)) if (!right) count(`field:${field}`);
    }
    for (const miss of item.misses) count(miss.error);
    if (item.error) count("model_error");
  }
  for (const run of runs) for (const reason of droppedReasons(run.fixture, run.raw, run.predictions)) count(reason);
  // What the model said that the app did not keep (quote not in the line, or a repeat): invisible to anyone.
  const dropped = runs.reduce((total, run) => total + Math.max(0, (run.raw?.length || 0) - (run.predictions?.length || 0)), 0);
  return {
    totals: {
      tp, fp, fn, precision, recall, f1: precision !== null && recall !== null && precision + recall ? 2 * precision * recall / (precision + recall) : null,
      fields: { checks, by: ratio(sum((item) => item.fieldsRight.by), checks), what: ratio(sum((item) => item.fieldsRight.what), checks), when: ratio(sum((item) => item.fieldsRight.when), checks) },
      optionalHits: sum((item) => item.optionalHits), droppedBeforeKeeping: dropped,
    },
    errors: Object.fromEntries(Object.entries(errors).sort((a, b) => b[1] - a[1])),
    fixtures,
  };
}
