// Task 56: the reply pipeline never fails empty. Verbatim round-21 failures (fictional evaluation data) replay offline:
// checks and rewrites may only degrade a model draft (one constrained retry, then the last good draft plus a one-line
// caveat), never replace it with "Pinky 暂时不可用" or a refusal of the whole delivery.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createFileStore } from "../server/store.mjs";
import { continueTogetherTurn } from "../server/together-domain.mjs";
import { createMediator } from "../server/mediator.mjs";
import { answerFromText, jsonObjects } from "../server/claude-cli-client.mjs";
import { checkPlanConstraints, settleCheckedPlan, constraintCaveat } from "../server/plan-constraints.mjs";
import { deliveredReply, finishReply, isGenericFailure, mergeReceipts, privateBoundaryReply, replySimilarity, requiresReplyScopeCheck } from "../server/reply-contract.mjs";
import { prepareSourceReply } from "../server/source-reply.mjs";

const replay = JSON.parse(readFileSync(new URL("./fixtures/task56-never-empty.json", import.meta.url), "utf8"));
const togetherSchema = { type: "object", required: ["reply", "draftAgreement", "actions", "waitingFor", "planConstraints"], properties: { reply: { type: "string" } } };

test("the captured round-21 answers are exactly the generic failures this task forbids", () => {
  for (const id of ["tool-agreement-draft", "tool-shared-space-collection"]) assert.equal(isGenericFailure(replay.round21Answers[id].answer), true, id);
  assert.equal(isGenericFailure(replay.round21Answers["plan-weather-preference"].answer.split("\n")[0]), true);
  assert.equal(isGenericFailure("周日去看摄影展。"), false);
  assert.equal(deliveredReply("Pinky 暂时不可用，稍后再试。", "草稿：周末轮流做饭。", "说明"), "草稿：周末轮流做饭。\n说明");
  assert.throws(() => deliveredReply("", ""), { code: "NO_DELIVERABLE" });
});

test("the degenerate <br> together answer still yields its last complete JSON object", () => {
  const text = replay.degenerateTogetherTurn;
  assert.ok((text.match(/<br>/g) || []).length > 50);
  const parsed = answerFromText(text, togetherSchema, { allowProseReply: false });
  assert.equal(parsed.draftAgreement.title, "周末轮流做饭");
  assert.equal(jsonObjects(text).length, 1);
});

const withOpenAi = async (run) => {
  const keys = ["AI_PROVIDER", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"], saved = Object.fromEntries(keys.map((key) => [key, process.env[key]])), realFetch = globalThis.fetch;
  for (const key of keys) delete process.env[key];
  process.env.AI_PROVIDER = "openai";
  try { await run(); } finally { globalThis.fetch = realFetch; for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
};
const responseOf = (text) => new Response(JSON.stringify({ id: "r", object: "response", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] }), { status: 200, headers: { "content-type": "application/json" } });

test("a timed-out together turn gets one constrained retry that keeps the draft, instead of the unavailable copy", async () => {
  await withOpenAi(async () => {
    const answer = jsonObjects(replay.degenerateTogetherTurn).at(-1), bodies = [];
    let attempts = 0;
    globalThis.fetch = async (_url, init) => { attempts += 1; bodies.push(JSON.parse(init.body)); if (attempts === 1) throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }); return responseOf(JSON.stringify(answer)); };
    const mediator = createMediator({ apiKey: "test-key" });
    const turn = await mediator.continueTogether({ messages: [{ role: "member", text: replay.round21Answers["tool-agreement-draft"].question }], activeAgreements: [], openCommitments: [], pendingAgreement: null }, "zh");
    assert.equal(attempts, 2);
    assert.equal(turn.source, "openai");
    assert.equal(turn.draftAgreement.title, "周末轮流做饭");
    assert.equal(isGenericFailure(turn.reply), false);
    assert.match(JSON.stringify(bodies[1]), /Return only that JSON object now/);
    assert.doesNotMatch(JSON.stringify(bodies[0]), /Return only that JSON object now/);
  });
});

test("the private planner also retries once with the added constraint before the router can report it unavailable", async () => {
  await withOpenAi(async () => {
    let attempts = 0;
    globalThis.fetch = async () => { attempts += 1; if (attempts === 1) throw new Error("connection reset"); return responseOf(JSON.stringify({ reply: "好的。", sendableDraft: null, activityDescription: null, actions: [], privateBoundary: false, unsupportedPremise: null })); };
    const plan = await createMediator({ apiKey: "test-key" }).planAssistantTurn({ messages: [{ role: "user", text: "谢谢" }] }, "zh");
    assert.equal(attempts, 2); assert.equal(plan.reply, "好的。");
  });
});

async function couple(t, mediator) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "task56-"));
  t.after(async () => { assert.ok(resolve(directory).startsWith(base)); await rm(directory, { recursive: true, force: true }); });
  const store = await createFileStore(join(directory, "store.json"));
  const [a, b] = [randomUUID(), randomUUID()];
  for (const id of [a, b]) await store.createUser({ id, email: `${id}@example.invalid`, name: id === a ? "小安" : "小闻", passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: a, role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: a, expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, b, new Date().toISOString());
  const say = (text) => continueTogetherTurn({ store, mediator, relationshipId, actorUserId: a, text, language: "zh" });
  return { store, a, say, conversation: () => store.getRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, a) };
}

test("an agreement draft survives a failed term audit, and the auditor learns who wrote each message", async (t) => {
  const draft = jsonObjects(replay.degenerateTogetherTurn).at(-1);
  let audit = null, seenInput;
  const mediator = { continueTogether: async () => ({ ...draft, source: "openai" }), structured: async ({ name, input }) => {
    if (name !== "agreement_term_sources") return { commitments: [], promises: [], facts: [] };
    seenInput = JSON.parse(input);
    if (audit instanceof Error) throw audit; return audit; } };
  const f = await couple(t, mediator);
  audit = new Error("audit timed out");
  let turn = await f.say(replay.round21Answers["tool-agreement-draft"].question);
  assert.equal(isGenericFailure(turn.reply.text), false);
  assert.deepEqual((await f.conversation()).draftAgreement.terms, draft.draftAgreement.terms, "a failed audit keeps every term");
  assert.ok(seenInput.messages.every((message) => message.from === "小安"), "the auditor knows who wrote 我");
});

test("a term audit that supports no term keeps the whole draft with a one-line caveat", async (t) => {
  const draft = jsonObjects(replay.degenerateTogetherTurn).at(-1);
  let audit;
  const mediator = { continueTogether: async () => ({ ...draft, source: "openai" }), structured: async ({ name, input }) => {
    if (name !== "agreement_term_sources") return { commitments: [], promises: [], facts: [] };
    const { messages } = JSON.parse(input);
    return audit(messages[0]);
  } };
  const f = await couple(t, mediator);
  audit = () => ({ terms: draft.draftAgreement.terms.map((_, index) => ({ index, supported: false, messageId: "", quote: "" })) });
  const first = await f.say(replay.round21Answers["tool-agreement-draft"].question);
  assert.match(first.reply.text, /逐条看一下/);
  assert.deepEqual((await f.conversation()).draftAgreement.terms, draft.draftAgreement.terms);
});

test("a shared-space turn whose model call fails only on the first attempt still creates the space", async (t) => {
  const answer = JSON.parse(replay.sharedSpaceTogetherTurn);
  let calls = 0;
  const mediator = { continueTogether: async () => { calls += 1; return { ...answer, source: "openai" }; } };
  const f = await couple(t, mediator);
  const turn = await f.say(replay.round21Answers["tool-shared-space-collection"].question);
  assert.equal(calls, 1);
  assert.equal(isGenericFailure(turn.reply.text), false);
  const spaces = await f.store.listRelationshipRecordsForUser("spaces", f.a);
  assert.ok(spaces.some((space) => space.title === "雨天约会"));
});

test("a plan that fails its checks twice is delivered with a one-line caveat, never refused as a whole", async (t) => {
  const plans = replay.plannerOutputs["plan-weather-preference"].map((text) => jsonObjects(text).at(-1)).filter((plan) => plan?.planConstraints);
  assert.equal(plans.length, 2);
  const context = { messages: [{ role: "user", text: replay.round21Answers["plan-weather-preference"].question }], profile: { notes: ["Lily 想去上海看摄影展，不喜欢淋雨。我们约会总预算是 300 元。"] } };
  const candidates = plans.map((plan) => ({ plan, checked: checkPlanConstraints(plan.planConstraints, { context, reply: plan.reply }) }));
  assert.ok(candidates.every(({ checked }) => !checked.ok), "the captured plans still fail the strict quote check");
  const { plan, caveat } = settleCheckedPlan(candidates, "zh");
  assert.match(plan.reply, /Fotografiska/);
  assert.deepEqual(plan.actions, []);
  assert.match(caveat, /^注意：这份安排里的.+还没有核实/);
  assert.equal(isGenericFailure(`${plan.reply}\n${caveat}`), false);
  // The together channel takes the same path through the real turn.
  let calls = 0;
  const f = await couple(t, { continueTogether: async () => ({ reply: plans[calls].reply, planConstraints: plans[calls++].planConstraints, draftAgreement: null, actions: [], source: "openai" }) });
  const turn = await f.say(`Pinky，${replay.round21Answers["plan-weather-preference"].question}`);
  assert.equal(calls, 2);
  assert.match(turn.reply.text, /Fotografiska/); assert.match(turn.reply.text, /还没有核实/);
  assert.doesNotMatch(turn.reply.text, /不能当作可执行方案|不能把它当作可执行方案/);
});

test("only a food-safety conflict blocks a plan, and the block still says what to do instead", () => {
  const unsafe = { plan: { reply: "做花生酱拌面。", actions: [] }, checked: { issues: [{ code: "allergen_conflict" }] } };
  const { plan } = settleCheckedPlan([unsafe], "zh");
  assert.match(plan.reply, /换一道不含这种食材的菜/);
  const safer = settleCheckedPlan([unsafe, { plan: { reply: "做番茄鸡蛋面。", actions: [] }, checked: { issues: [{ code: "unverified_fact" }] } }], "zh");
  assert.equal(safer.plan.reply, "做番茄鸡蛋面。");
  assert.match(constraintCaveat([{ code: "over_budget" }], "zh", { totalUpper: 320, limit: 300, currency: "CNY" }), /合计约 320 元，超过 300 元的预算/);
});

test("repeated privacy replies differ in wording, each offers a line to ask, and none copies the question topic", () => {
  for (const [id, row] of Object.entries(replay.round21Answers).filter(([id]) => id.startsWith("memory-partner-"))) {
    const old = row.answer.split("\n").map((line) => line.replace(/^第\d次：/, ""));
    assert.equal(new Set(old).size, 1, `${id} round 21 repeated one template`);
    const replies = [0, 1, 2].map((index) => privateBoundaryReply("zh", index));
    for (const reply of replies) {
      assert.match(reply, /看不到|只有 TA 自己能看/);
      assert.match(reply, /“[^”]{6,}”/, "a line the user can say themselves");
      assert.doesNotMatch(reply, /关于(?:分手|惊喜)|聊聊你的感受/);
    }
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(replySimilarity(replies[i], replies[j]) < 0.5, `${i}/${j} too similar`);
    assert.ok(replySimilarity(old[0], replies[0]) < 0.5);
  }
  for (const language of ["en", "es"]) {
    const replies = [0, 1, 2].map((index) => privateBoundaryReply(language, index));
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(replySimilarity(replies[i], replies[j]) < 0.5);
  }
});

test("one action, one receipt: reminder and remembered facts are confirmed once, without unrequested promises", () => {
  const voice = JSON.parse(replay.plannerOutputs["interaction-voice-reminder"][0]);
  const reminder = finishReply(voice.reply, { request: replay.round21Answers["interaction-voice-reminder"].question, formatChecked: true, sourceTranscript: "x",
    receipts: ["已保存个人提醒：给他回电话，2026-11-12 20:30 (Asia/Shanghai)。"], reminderWritten: true, deliverables: ["明天晚上八点半", "提醒你给他回电话"] });
  assert.equal(reminder, "已保存个人提醒：给他回电话，2026-11-12 20:30 (Asia/Shanghai)。");
  assert.doesNotMatch(replay.round21Answers["interaction-voice-reminder"].answer.split("\n").filter((line) => /^已记住/.test(line)).join(""), /^$/, "round 21 added memory receipts to a reminder");
  const remember = JSON.parse(replay.plannerOutputs["tool-remember-preference"][0]);
  const stored = finishReply(remember.reply, { request: replay.round21Answers["tool-remember-preference"].question, formatChecked: true, receipts: ["已记住：不吃香菜。", "已记住：对花粉过敏。"] });
  assert.equal(stored, "已记住：不吃香菜；对花粉过敏。");
  // An audit quote naming the subject is covered by the receipt, not re-added as a stray first line (task 56 sample run).
  assert.equal(finishReply("", { formatChecked: true, receipts: ["已记住：不吃香菜。", "已记住：对花粉过敏。"], deliverables: ["阿杰不吃香菜", "对花粉过敏"] }), "已记住：不吃香菜；对花粉过敏。");
  assert.deepEqual(mergeReceipts(["已记住：A。", "已记住：A。"]), ["已记住：A。"]);
  assert.equal(requiresReplyScopeCheck(replay.round21Answers["tool-remember-preference"].question), true);
});

test("when the semantic audit fails, a code-detected format violation still gets its one constrained rewrite", async () => {
  const request = replay.round21Answers["interaction-file-chat"].question;
  const [analysis, draft] = replay.round21Answers["interaction-file-chat"].answer.split("\n");
  let rewrites = 0;
  const output = await prepareSourceReply(analysis, { sendableDraft: draft, request, sources: [{ kind: "import", text: "chat" }], mediator: {
    checkReplySources: async () => { throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }); },
    rewriteReply: async ({ issues }) => { rewrites += 1; assert.match(issues.join(" "), /Expected 1 sentence/); return { reply: analysis, sendableDraft: "以后计划有变，能不能在约好的七点之前告诉我？" }; },
  } });
  assert.equal(rewrites, 1);
  assert.match(output, /七点之前告诉我？$/);
  const kept = await prepareSourceReply(analysis, { sendableDraft: draft, request, sources: [{ kind: "import", text: "chat" }], mediator: {
    checkReplySources: async () => { throw new Error("down"); }, rewriteReply: async () => ({ reply: analysis, sendableDraft: "两句。还是两句。" }) } });
  assert.ok(kept.includes(draft), "a rewrite that still breaks the limit is discarded; the original draft ships");
});
