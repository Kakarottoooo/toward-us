import { test } from "node:test";
import assert from "node:assert/strict";
import { blindPair, completionResult, decodeVerdict, summarize } from "./score.mjs";
import { projectSnapshot, visibleContext } from "./fixture.mjs";
import { createRelationshipRecord } from "../../server/relationship-domain.mjs";
import { recordChecks } from "./evidence.mjs";
import { cases, layers } from "./cases.mjs";

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
