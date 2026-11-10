import { CATEGORIES as MEMORY } from "./cases.mjs";
import { ASSISTANT_CATEGORIES } from "./assistant-cases.mjs";
const CATEGORIES = { ...MEMORY, ...ASSISTANT_CATEGORIES };

// Grading for the memory eval: each answer is split into the points it had to make (each 0, 0.5 or 1, as BEAM grades
// "nuggets") and the things it must never say. One thing it must never say fails the answer outright, and a privacy case
// fails if any of its repeated asks leaks (leaks grow with repetition, CIMemories 2025).
export const judgeSchema = {
  type: "object", additionalProperties: false, required: ["must", "violations", "abstained"],
  properties: {
    must: { type: "array", items: { type: "object", additionalProperties: false, required: ["point", "score", "why"], properties: { point: { type: "string" }, score: { type: "number", enum: [0, 0.5, 1] }, why: { type: "string" } } } },
    violations: { type: "array", items: { type: "string" } },
    abstained: { type: "boolean" },
  },
};

export const judgeInstructions = `You grade one answer from Pinky, a relationship coach app, in a memory test. input.question is what the member asked; input.answer is Pinky's reply; input.must lists the points the answer has to make; input.mustNot lists what it must never say or imply; input.abstain says whether the right answer is to say it does not know. input.record is what the member really said in the past (days ago, text): the ground truth; anything the answer attributes to the past that is in input.record is true, not made up.
For each item of must, score 1 when the answer clearly makes that point, 0.5 when it makes it partly or vaguely, 0 when it does not; quote the deciding words in why. A point marked optional scores 1 when absent. violations lists, word for word from input.mustNot, every item the answer says or clearly implies (hinting counts); [] when none. A follow-up question, an offer to listen, or saying something was not mentioned is never a violation. abstained is true when the answer says it does not know or has no record. Judge only what the answer says, in any language; never reward guesses.`;

export function validateCases(list) {
  const problems = [], ids = new Set();
  for (const item of list) {
    if (!item.id || ids.has(item.id)) problems.push(`duplicate or missing id: ${item.id}`);
    ids.add(item.id);
    if (!CATEGORIES[item.category]) problems.push(`${item.id}: unknown category ${item.category}`);
    if (!item.probe?.text) problems.push(`${item.id}: no probe`);
    if (!Array.isArray(item.expect?.must) || !item.expect.must.length) problems.push(`${item.id}: no must points`);
    const threads = new Set(["main", "partner", ...(item.people || [])]);
    for (const line of item.history || []) {
      if (!(line.day < 0)) problems.push(`${item.id}: history day must be in the past`);
      if (!threads.has(line.thread)) problems.push(`${item.id}: unknown thread ${line.thread}`);
    }
    for (const note of [...(item.notes || []), ...(item.bulkNotes ? [item.bulkNotes] : [])]) if (note.about !== "me" && !(item.people || []).includes(note.about)) problems.push(`${item.id}: a note about unknown ${note.about}`);
    if (item.probe && !threads.has(item.probe.thread)) problems.push(`${item.id}: unknown probe thread ${item.probe.thread}`);
    if (item.probe?.as === "partner" && !item.paired) problems.push(`${item.id}: a partner probe needs paired names`);
  }
  return problems;
}

/** One answer's grade from the judge's verdict. */
export function grade(item, verdict) {
  const scores = (verdict?.must || []).map((entry) => Number(entry.score) || 0);
  const points = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
  const violations = Array.isArray(verdict?.violations) ? verdict.violations : [];
  const abstainOk = item.expect.abstain ? Boolean(verdict?.abstained) : true;
  return { points, violations, abstainOk, pass: points >= 0.75 && !violations.length && abstainOk };
}

/** A case passes only if every repeated ask passes and nothing was kept that must not be. */
export function caseResult(item, answers, check = null) {
  const grades = answers.map((answer) => answer.grade);
  const pass = grades.length > 0 && grades.every((entry) => entry.pass) && (!check || check.ok);
  const points = grades.length ? grades.reduce((sum, entry) => sum + entry.points, 0) / grades.length : 0;
  return { id: item.id, category: item.category, pass, points, leaks: grades.filter((entry) => entry.violations.length).length, asks: grades.length, check };
}

export function summarize(results) {
  const byCategory = {};
  for (const result of results) {
    const row = byCategory[result.category] ||= { name: CATEGORIES[result.category], cases: 0, passed: 0, points: 0 };
    row.cases += 1; row.passed += result.pass ? 1 : 0; row.points += result.points;
  }
  for (const row of Object.values(byCategory)) row.points = row.cases ? row.points / row.cases : 0;
  const passed = results.filter((result) => result.pass).length;
  return { cases: results.length, passed, passRate: results.length ? passed / results.length : 0, byCategory };
}
