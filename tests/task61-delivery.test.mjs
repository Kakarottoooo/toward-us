// Task 61: post-processing only deletes. Every step between the model's draft and the delivered reply may remove what breaks
// the user's contract or restates a server receipt; none adds or rewords a fact. The round-23 practice and HOLDOUT-R5 answers
// below are replayed verbatim from tests/fixtures/task61-replay.json (fictional evaluation data); no model is called.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { agreementPresentation, checkReplyFormat, contractIssues, finishReply, formatContract, privateBoundaryReply, quietUnderContract, settleContract } from "../server/reply-contract.mjs";
import { prepareSourceReply } from "../server/source-reply.mjs";
import { normalizeAssistantTurn, validateAssistantTurn } from "../server/assistant-agent.mjs";
import { explicitSelfFacts, scanPrivateProfile } from "../server/profile.mjs";
import { webEvidence, webSourceText } from "../server/readonly-web.mjs";
import { writeChecks } from "../scripts/parity-eval/external-cases.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { createFileStore } from "../server/store.mjs";
import { personFor } from "../server/people.mjs";

const { cases, losses } = JSON.parse(readFileSync(new URL("./fixtures/task61-replay.json", import.meta.url), "utf8"));
const json = (text) => JSON.parse(String(text).slice(String(text).indexOf("{"), String(text).lastIndexOf("}") + 1));
const outputs = (id, name) => cases[id].outputs.filter((row) => row.name === name).map((row) => row.text);
// Answers each audit and rewrite with the recorded round output, in order.
const recorded = (id) => { const checks = outputs(id, "reply_source_check").map(json), rewrites = outputs(id, "reply_format_repair").map(json); return { async checkReplySources() { return checks.shift(); }, async rewriteReply() { return rewrites.shift(); } }; };
const receiptLine = (id) => cases[id].answer.split("\n").find((line) => /^好，/u.test(line));
const quiet = () => { const info = console.info; console.info = () => {}; return () => { console.info = info; }; };

test("fix 2: a standalone \"一句话。\" and a closed set of answers are contracts, so attached notes stay quiet", () => {
  const stance = cases["h5-int-screenshot-stance-time-proposed"].question, coming = cases["h5-int-screenshot-maybe-coming"].question;
  assert.equal(formatContract(stance).sentences, 1);
  assert.equal(formatContract(stance).scope, "sendableDraft");
  assert.deepEqual(formatContract(coming).only, { kinds: [], alone: false });
  assert.equal(quietUnderContract(stance), true);
  assert.equal(quietUnderContract(coming), true);
  assert.match(cases["h5-int-screenshot-maybe-coming"].answer, /已为 阿蒙 建档\n已记进 阿蒙 的档案/, "round 23 sent both notes beside the contract answer");
  // Ordinary wording is no contract: "只说了一半" names nothing to answer with.
  assert.equal(formatContract("你只说了一半，再说说").only, null);
  assert.equal(quietUnderContract("帮我看看这段聊天，她什么意思？"), false);
  assert.equal(formatContract("帮我回她，一句就行。").sentences, 1);
  assert.equal(formatContract("再说一句依据").sentences, null);
});

test("fix 3: \"只答时间\" keeps only the time itself (R5 flight)", async () => {
  const id = "h5-mem-flight-corrected-time-only", row = cases[id], plan = json(outputs(id, "private_assistant_operations")[0]);
  const restore = quiet();
  const audited = await prepareSourceReply(plan.reply, { sendableDraft: plan.sendableDraft, request: row.question, language: "zh", sources: [{ kind: "recall", text: "改成12月20日晚上7点45分落地" }], context: {}, mediator: recorded(id), label: true }).finally(restore);
  assert.equal(finishReply(audited, { request: row.question, language: "zh" }), "晚上7点45分。");
  assert.equal(row.answer, "12月20日晚上7点45分落地。", "round 23 kept the date");
  assert.equal(contractIssues(row.answer, row.question).length, 1);
  assert.equal(settleContract("下午3点。", "几点？只答时间。"), "下午3点。");
  assert.equal(settleContract("12月5日（周六）15:00 开始。", "哪天？只答日期。"), "12月5日（周六）。");
  assert.equal(settleContract("在示例小区7栋。门口见。", "在哪？只答地点。"), "在示例小区7栋。", "a place keeps its sentence");
});

test("fix 1: finishing deletes claims and receipt restatements without re-adding audit quotes as fragments", async () => {
  for (const [id, transcript] of [["interaction-voice-reminder", "x"], ["h5-tool-reminder-only-ring", undefined]]) {
    const row = cases[id], plan = json(outputs(id, "private_assistant_operations")[0]), receipt = receiptLine(id);
    const restore = quiet();
    const audited = await prepareSourceReply(plan.reply, { sendableDraft: plan.sendableDraft, request: row.question, language: "zh", sources: [{ kind: "execution_receipt", text: receipt }], context: {}, mediator: recorded(id), label: true }).finally(restore);
    assert.equal(finishReply(audited, { request: row.question, language: "zh", receipts: [receipt], reminderWritten: true, sourceTranscript: transcript }), receipt, id);
    assert.match(row.answer, /^(?:我来设一个|其他的不会记)\n/u, "round 23 re-added a quoted fragment above the receipt");
  }
  // Leading clauses that say something survive a trailing action claim; an interjection alone does not.
  assert.equal(finishReply("先说感受，再谈当下，我会提醒你明天沟通。", { receipts: ["好，明天晚上 9:00 提醒你沟通。"], reminderWritten: true }), "先说感受，再谈当下。\n好，明天晚上 9:00 提醒你沟通。");
  assert.equal(finishReply("好的，我来设一个明晚的提醒。", { receipts: ["好，明天晚上 9:00 提醒你沟通。"], reminderWritten: true }), "好，明天晚上 9:00 提醒你沟通。");
  // The old supplement input is ignored: nothing outside the draft is added.
  assert.equal(finishReply("好的，明白。", { request: "回我一句", language: "zh", deliverables: ["另外一句被核对器摘出来的话"] }), "好的，明白。");
});

test("fix 6: an activity description never re-inserts a time or place the draft already says (practice image-invitation)", async () => {
  const id = "interaction-image-invitation", row = cases[id], first = JSON.parse(cases[id].outputs.find((output) => output.name === "reply_source_check").prompt);
  const rewrite = json(outputs(id, "reply_format_repair")[0]);
  const restore = quiet();
  const audited = await prepareSourceReply(first.reply, { sendableDraft: first.sendableDraft, request: row.question, language: "zh", sources: first.sources, context: {}, mediator: recorded(id), label: true }).finally(restore);
  const delivered = finishReply(audited, { request: row.question, language: "zh" });
  assert.match(row.answer, /Studio 6有个周六14:00-16:00在Studio 6/, "round 23 interpolated the time and place twice");
  assert.equal((delivered.match(/Studio 6/g) || []).length, 1, delivered);
  assert.equal((delivered.match(/14:00/g) || []).length, 1, delivered);
  assert.match(delivered, /Clay Together陶艺活动/);
  assert.match(rewrite.sendableDraft, /^周六14:00到16:00在Studio 6有个Clay Together陶艺活动/);
});

test("fix 4: empty unknown action keys and misspelled empty fields are dropped; only a non-empty unknown key is refused (R5 502s)", () => {
  for (const id of ["h5-env-boardgame-retry", "h5-env-parents-meet-updated"]) {
    const first = normalizeAssistantTurn(json(outputs(id, "private_assistant_operations")[0]), "zh", 0, cases[id].question);
    assert.equal(validateAssistantTurn(first), true, id);
    assert.equal(first.actions[0].kind, "web_read"); assert.match(first.actions[0].query, /^http:\/\/127\.0\.0\.1:\d+\//);
    assert.match(cases[id].error, /HTTP 502/, "round 23 refused the whole turn");
  }
  const misspelled = normalizeAssistantTurn(json(outputs("h5-env-boardgame-retry", "private_assistant_operations")[1]), "zh");
  assert.equal(validateAssistantTurn(misspelled), true, "\"swpaceId\": null is ignored");
  const plan = json(outputs("h5-env-boardgame-retry", "private_assistant_operations")[1]);
  const withContent = normalizeAssistantTurn({ ...plan, actions: [{ ...plan.actions[0], extra: "keep me" }] }, "zh");
  assert.equal(validateAssistantTurn(withContent), false, "a non-empty unknown key still refuses the turn");
  const fieldContent = normalizeAssistantTurn({ ...plan, actions: [{ ...plan.actions[0], fields: { ...plan.actions[0].fields, swpaceId: "abc" } }] }, "zh");
  assert.equal(validateAssistantTurn(fieldContent), false, "a misspelled field with content is refused");
});

test("fix 5: one remembered thing is one fact, whichever scan found it (R5 godmother)", async (t) => {
  const id = "h5-tool-memory-godmother-once", question = cases[id].question;
  assert.deepEqual(explicitSelfFacts({ id: "m", text: question }, ["桃桃"]), [], "no fragment cut at \"——\" or after the name");
  assert.match(cases[id].answer, /；的干妈12月15日过六十大寿——是干妈。$/u, "round 23 kept a second, broken fact");
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "task61-")); t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const store = await createFileStore(join(directory, "store.json"));
  const user = { id: randomUUID(), name: "小安" };
  await store.createUser({ ...user, email: `${user.id}@example.invalid`, passwordHash: "test", createdAt: new Date().toISOString() });
  const jie = await store.transaction(`user:${user.id}`, (tx) => personFor(tx, user.id, "阿杰"));
  await store.transaction(`user:${user.id}`, (tx) => personFor(tx, user.id, "桃桃"));
  const run = async (text, facts) => {
    const message = { id: randomUUID(), role: "user", text, createdAt: new Date().toISOString() };
    const session = createRelationshipRecord({ relationshipId: null, userId: user.id, visibility: "private", aiAccessScope: "private", intentType: "assistant", language: "zh", timezone: "Asia/Shanghai", messages: [message] });
    await store.createRelationshipRecord("privateAgentThreads", session);
    return scanPrivateProfile({ store, userId: user.id, sessionId: session.id, silent: true, mediator: { structured: async () => ({ facts: facts.map((fact) => ({ ...fact, messageId: message.id })) }) } });
  };
  assert.equal((await run(question, json(outputs(id, "couple_profile")[0]).facts)).length, 1);
  // The model left the person empty; the user's own words name 阿杰, so the one fact goes on 阿杰's card.
  const kept = await run("帮我记住：阿杰不吃香菜。", [{ quote: "阿杰不吃香菜", subject: "B", person: "", category: "food", fact: "不吃香菜", replaces: "" }]);
  assert.equal(kept.length, 1); assert.equal(kept[0].subjectUserId, `person:${jie.id}`); assert.equal(kept[0].text, "不吃香菜");
});

test("evaluation (ruling): a memories write count is facts only, never a person card", () => {
  const person = { id: "p", kind: "person", name: "陆川" }, fact = { id: "f", kind: "profile", text: "每周三晚上固定去打羽毛球" };
  const [check] = writeChecks([{ collection: "memories", count: 1, fields: { kind: "profile" } }], { memories: [] }, { memories: [person, fact] }, {});
  assert.equal(check.ok, true); assert.equal(check.changedCount, 1);
});

test("fix 7: privacy replies never suggest the other person has private conversations (R5 privacy-thought-about-dad)", () => {
  const question = cases["h5-int-privacy-thought-about-dad"].question;
  assert.match(cases["h5-int-privacy-thought-about-dad"].answer, /TA 的私人对话只有 TA 自己能看/);
  for (const language of ["zh", "en", "es"]) for (const ask of [question, "她最近有没有在准备惊喜？", "他这周末什么安排？", ""]) for (const index of [0, 1, 2]) {
    assert.doesNotMatch(privateBoundaryReply(language, index, ask), /私人对话|private conversation|conversaciones privadas/iu);
  }
  assert.match(privateBoundaryReply("zh", 2, "她在想什么？"), /我这边看不到 TA 没主动分享的内容/);
  assert.match(privateBoundaryReply("zh", 2, ""), /TA 没主动分享的内容，我这边看不到/);
});

test("fix 8: a read-only page is credited in one line; fetch time and HTTP status are evidence (R5 housewarming, florist)", () => {
  for (const id of ["h5-env-housewarming-injection", "h5-env-florist-lily-budget"]) {
    const answer = cases[id].answer, url = answer.match(/来源：(\S+)/u)[1];
    assert.match(answer, /抓取时间：.* · HTTP 200/u, "round 23 put fetch details in the reply");
    const page = { url, status: "ok", title: "虚构页面", fetchedAt: "2026-11-13T02:24:20.317Z", attempts: [200] };
    assert.equal(webSourceText([page], "zh"), "来自「虚构页面」页面");
    assert.deepEqual(webEvidence([page]), [{ url, status: "ok", fetchedAt: page.fetchedAt, attempts: [200] }]);
  }
});

test("fix 9 and ruling: user-listed terms stay even when equal to the title; a summary re-wording the terms goes", () => {
  const listed = cases["h5-tool-agreement-title-equals-clause"], draft = json(outputs("h5-tool-agreement-title-equals-clause", "together_turn")[0]).draftAgreement;
  assert.deepEqual(listed.draft.terms.length, 2, "round 23 removed the user's first clause");
  assert.deepEqual(agreementPresentation(draft, "", { userText: listed.question }).draft.terms, ["吵架不过夜", "需要冷静可以说“暂停”，但最多一小时后回来接着谈", "不翻三个月以前的旧账"]);
  // Without the user's words, a model-written term equal to the title is still the repeat that goes.
  assert.deepEqual(agreementPresentation(draft).draft.terms, ["需要冷静可以说“暂停”，但最多一小时后回来接着谈", "不翻三个月以前的旧账"]);
  const cooking = cases["tool-agreement-draft"], rotation = json(outputs("tool-agreement-draft", "together_turn")[0]).draftAgreement;
  const shown = agreementPresentation(rotation, "", { userText: cooking.question }).draft;
  assert.equal(shown.title, "周末轮流做饭"); assert.equal(shown.summary, "", "\"周末由两人按周轮流做饭\" only re-worded the title and terms");
  assert.match(cooking.answer, /周末由两人按周轮流做饭。/);
  assert.deepEqual(agreementPresentation({ title: "倒垃圾", summary: "周一和周二各倒一次，谁在家谁倒。", terms: ["每周一倒垃圾", "每周二倒垃圾"] }).draft.summary, "周一和周二各倒一次，谁在家谁倒。", "a summary that adds something stays");
});

test("fix 10: the future-use promise pattern has word boundaries, not backspace characters", () => {
  const source = readFileSync(new URL("../server/reply-contract.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("\u0008"), false);
  assert.equal(finishReply("Got it. From now on I'll avoid cilantro for him.", { language: "en", receipts: ["Got it, noted: Jay doesn't eat cilantro."] }), "Got it, noted: Jay doesn't eat cilantro.");
});

// Every round-23 practice and R5 answer that lost (UNOFFICIAL Claude pre-judge) or failed its machine check is replayed through
// the final code acceptance: one that keeps the user's format contract passes unchanged; one that breaks it comes out compliant.
for (const row of losses.filter((loss) => loss.answer)) test(`final acceptance replays losing answer ${row.source}/${row.id}`, () => {
  const settled = settleContract(row.answer, row.question, "zh");
  if (!contractIssues(row.answer, row.question).length) assert.equal(settled, row.answer);
  else { assert.equal(checkReplyFormat(settled, row.question).ok, true, settled); assert.equal(contractIssues(settled, row.question).length, 0, settled); }
  assert.ok(String(settled).trim(), "never empty");
});
