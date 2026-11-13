// Task 58: the user's format contract outranks semantic scores, receipts read like a person, agreement titles survive their
// projection, "remember" keeps one fact per thing said, interpolation names an activity once, a draft's stance matches the
// source, and privacy suggestions fit the kind of question. Every round-22 / R4 losing answer below is replayed verbatim
// from tests/fixtures/task58-format-contract.json (fictional evaluation data); no model is called.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { activityDraft, agreementPresentation, checkReplyFormat, contractIssues, finishReply, formatContract, isPrivateBoundaryReply, privateBoundaryReply, renderReply, replySimilarity, settleContract } from "../server/reply-contract.mjs";
import { prepareSourceReply, settleSourceStance, sourceStanceIssues } from "../server/source-reply.mjs";
import { reminderReceipt, rememberReceipt, checklistReceipt } from "../server/receipts.mjs";
import { oneThingOneFact, scanPrivateProfile, verifyFacts } from "../server/profile.mjs";
import { createRelationshipRecord, projectRecord } from "../server/relationship-domain.mjs";
import { createFileStore } from "../server/store.mjs";

const replay = JSON.parse(readFileSync(new URL("./fixtures/task58-format-contract.json", import.meta.url), "utf8")).cases;
const json = (text) => JSON.parse(String(text).slice(String(text).indexOf("{"), String(text).lastIndexOf("}") + 1));
// A mediator that answers each audit and rewrite with the recorded round-22 output, in order.
const recorded = (row) => {
  const checks = row.sourceChecks.map((check) => json(check.text)), rewrites = row.rewrites.map(json);
  return { calls: 0, async checkReplySources() { this.calls += 1; return checks.shift(); }, async rewriteReply() { return rewrites.shift(); } };
};
const candidateOf = (row) => { const prompt = JSON.parse(row.sourceChecks[0].prompt); return { prompt, candidate: { reply: prompt.reply, sendableDraft: prompt.sendableDraft ?? null } }; };

test("the user format contract is parsed from the user's own words", () => {
  assert.deepEqual(formatContract(replay["interaction-mobile-short-reply"].question), { sentences: 1, lines: null, chars: null, scope: "whole reply", avoid: [], only: null, noSend: false, noSave: false });
  assert.equal(formatContract(replay["interaction-screenshot-fair"].question).scope, "sendableDraft");
  assert.deepEqual(formatContract("只告诉我几点结束。").only, { kinds: ["time"], alone: true });
  assert.deepEqual(formatContract("只告诉我时间，再写一句邀约。").only, { kinds: ["time"], alone: false });
  assert.deepEqual(formatContract("帮我回他，不要提他前任。").avoid, ["他前任"]);
  assert.deepEqual(formatContract("不要提醒我了，也不要提前告诉她。").avoid, []);
  assert.equal(formatContract("写好草稿，先别发送。").noSend, true);
  assert.equal(formatContract("只是吐槽一下，不用记下来。").noSave, true);
  assert.equal(formatContract("帮我记住：阿杰不吃香菜。").noSave, false);
  assert.equal(formatContract("20字以内回我").chars, 20);
});

test("mobile-short-reply: the delivered reply keeps the one-sentence contract even when the audit vetoes the rewrite", async () => {
  const row = replay["interaction-mobile-short-reply"], mediator = recorded(row);
  const original = json(row.planner[0]).reply;
  assert.equal(contractIssues(original, row.question).length, 1, "the round-22 answer broke the one-sentence contract");
  const audited = await prepareSourceReply(original, { request: row.question, language: "zh", sources: [], mediator });
  const delivered = finishReply(audited, { request: row.question, language: "zh", formatChecked: true });
  // The recorded final audit set lostDeliverables, which still vetoes the rewrite; code acceptance then truncates.
  assert.equal(delivered, "听到你好多了我也松了口气。");
  assert.equal(checkReplyFormat(delivered, row.question).ok, true);
  // Without any rewrite, code acceptance truncates to a complete first sentence.
  assert.equal(finishReply(original, { request: row.question, language: "zh", formatChecked: true }), "听到你好多了我也松了口气。");
  assert.equal(row.answer, original, "fixture holds the delivered round-22 answer");
});

test("deterministic truncation keeps whole sentences and clauses, and never cuts a receipt", () => {
  assert.equal(settleContract("第一句话。第二句话！", "回我一句"), "第一句话。");
  assert.equal(settleContract("今天下雨，我们改到周日去公园散步吧。", "10字以内回我"), "今天下雨。");
  assert.equal(settleContract("你好。", "回我一句", "zh", { receipts: ["好，记住了：陆川每周三晚上固定去打羽毛球。"] }), "");
  assert.equal(settleContract("分析一句。分析两句。\n\n可以这样回：我不去。下次吧。", "帮我写一句回复"), "分析一句。分析两句。\n\n可以这样回：我不去。");
  // Task 61: "只答 X" keeps X itself.
  assert.equal(settleContract("八点结束。门票 120 元。", "只告诉我几点结束"), "八点。");
  assert.equal(settleContract("我会说清楚。他前任的事先不聊。", "帮我回他，不要提他前任。"), "我会说清楚。");
});

test("a supplement that would break the contract is not added", () => {
  const reply = finishReply("好的，明白。", { request: "回我一句", language: "zh", formatChecked: true, deliverables: ["另外一句被核对器摘出来的话"] });
  assert.equal(reply, "好的，明白。");
});

test("screenshot-boundary: an analysis and a draft are delivered with the draft introduced as sendable wording", async () => {
  const row = replay["interaction-screenshot-boundary"], { prompt, candidate } = candidateOf(row);
  const audited = await prepareSourceReply(candidate.reply, { sendableDraft: candidate.sendableDraft, request: row.question, language: "zh", sources: prompt.sources, context: {}, mediator: recorded(row), label: true });
  const delivered = finishReply(audited, { request: row.question, language: "zh", formatChecked: true });
  assert.match(delivered, /\n可以这样回：我不会把密码给你，爱不是靠交出密码来证明的，也不能用分手来逼我。$/);
  assert.equal(checkReplyFormat(delivered, row.question).ok, true, "the one-sentence limit measures the labelled draft only");
  assert.equal(renderReply({ reply: "分析。", sendableDraft: "我想再谈谈。" }), "分析。\n\n我想再谈谈。", "unlabelled rendering is unchanged");
});

test("screenshot-fair: a draft calling the counterpart's proposed 8:30 undecided is caught and settled to the sanctioned stance", async () => {
  const row = replay["interaction-screenshot-fair"], { prompt, candidate } = candidateOf(row), rewrite = json(row.rewrites[0]);
  assert.equal(sourceStanceIssues(rewrite, prompt.sources).length, 1);
  assert.equal(sourceStanceIssues(candidate, prompt.sources).length, 0);
  assert.equal(sourceStanceIssues({ reply: "", sendableDraft: "我是想和你吃饭，7点我还没确定。" }, prompt.sources).length, 0, "only a time the counterpart proposed");
  const audited = await prepareSourceReply(candidate.reply, { sendableDraft: candidate.sendableDraft, request: row.question, language: "zh", sources: prompt.sources, context: {}, mediator: recorded(row), label: true });
  const delivered = finishReply(audited, { request: row.question, language: "zh", formatChecked: true });
  assert.doesNotMatch(delivered, /8:30这个时间我还没确定/);
  // Superseded by task 61 (post-processing only deletes): the contradicted clause is removed, never reworded.
  assert.match(delivered, /可以这样回：我是想和你一起吃饭，能不能再商量一下？/);
  assert.doesNotMatch(delivered, /你提的 8:30/);
  assert.equal(checkReplyFormat(delivered, row.question).ok, true);
  assert.equal(settleSourceStance("Lily 提了 8:30，你还没确定。", prompt.sources), "Lily 提了 8:30，你还没确定。", "analysis is never rewritten");
});

test("image-invitation: the translated activity description names the activity once", () => {
  const row = replay["interaction-image-invitation"], { candidate } = candidateOf(row);
  const [description, draft] = [candidate.sendableDraft.slice(0, candidate.sendableDraft.indexOf("：")), candidate.sendableDraft.slice(candidate.sendableDraft.indexOf("：") + 1)];
  assert.equal(description, "陶艺活动 Clay Together");
  assert.equal(candidate.sendableDraft.match(/Clay Together/g).length, 2, "round 22 named it twice");
  const fixed = activityDraft({ sendableDraft: draft, activityDescription: description });
  assert.equal(fixed.match(/Clay Together/g).length, 1);
  assert.match(fixed, /陶艺活动 Clay Together/);
  assert.equal(activityDraft({ sendableDraft: "周六有个{{activityDescription}}，Clay Together 在 Studio 6，要一起去吗？", activityDescription: description }).match(/Clay Together/g).length, 1);
  assert.equal(activityDraft({ sendableDraft: "周六一起去{{activityDescription}}吗？", activityDescription: "植物拓印体验" }), "周六一起去植物拓印体验吗？");
  assert.equal(activityDraft({ sendableDraft: "周六一起去吗？", activityDescription: "植物拓印体验" }), "植物拓印体验：周六一起去吗？");
});

test("agreement drafts keep their title: a term equal to the title and near-duplicate lines are the ones removed", () => {
  const cooking = json(replay["tool-agreement-draft"].together.at(-1)).draftAgreement;
  const shown = agreementPresentation(cooking).draft;
  assert.equal(shown.title, "周末轮流做饭");
  assert.deepEqual(shown.terms, ["这周小安做饭", "下周小闻做饭，之后每周轮换"]);
  const record = createRelationshipRecord({ userId: "owner", visibility: "private", draftAgreement: cooking });
  assert.equal(projectRecord(record, "owner").draftAgreement.title, "周末轮流做饭", "the projection the evaluator reads keeps the title");
  const menu = json(replay["h4-tool-no-proxy-menu"].together[0]).draftAgreement;
  const menuShown = agreementPresentation(menu).draft;
  assert.equal(menuShown.title, "每周日晚上定下周菜单");
  assert.equal(menuShown.summary, "", "the summary only re-worded the one term");
  assert.deepEqual(menuShown.terms, ["每周日晚上，我们一起定好下周的菜单。"]);
  assert.deepEqual(agreementPresentation({ title: "冷静", summary: "", terms: ["吵架时先冷静十分钟", "吵架后先冷静十分钟再回来聊"] }).draft.terms, ["吵架后先冷静十分钟再回来聊"]);
  assert.deepEqual(agreementPresentation({ title: "倒垃圾", summary: "", terms: ["每周一倒垃圾", "每周二倒垃圾"] }).draft.terms, ["每周一倒垃圾", "每周二倒垃圾"]);
});

test("reminder receipts are one natural sentence read from the stored record, without ISO dates or zone codes", () => {
  const voice = json(replay["interaction-voice-reminder"].planner[0]).actions[0].fields;
  assert.equal(voice.localDateTime, "2026-11-12T20:30");
  const saved = { title: voice.title, dueAt: "2026-11-12T12:30:00.000Z", timezone: voice.timezone, frequency: "once" };
  const receipt = reminderReceipt(saved, { language: "zh", sessionTimezone: "Asia/Shanghai" });
  assert.match(receipt, /^好，(?:2026 年 )?11 月 12 日晚上 8:30 提醒你给他回电话。$/);
  assert.match(replay["interaction-voice-reminder"].answer, /Asia\/Shanghai/, "round 22 showed a system format");
  const correction = reminderReceipt({ title: "给妈妈买生日蛋糕", dueAt: "2026-11-12T08:00:00.000Z", timezone: "Asia/Shanghai", frequency: "once" }, { language: "zh", sessionTimezone: "Asia/Shanghai" });
  assert.match(correction, /下午 4:00 提醒你给妈妈买生日蛋糕。$/);
  for (const text of [receipt, correction]) assert.doesNotMatch(text, /Asia\/|\d{4}-\d{2}-\d{2}|UTC|\(/);
  assert.match(reminderReceipt({ title: "妈妈生日", dueAt: "2026-11-12T01:00:00.000Z", timezone: "Asia/Shanghai", frequency: "once" }, { sessionTimezone: "Asia/Shanghai" }), /上午 9:00 提醒你：妈妈生日。$/);
  assert.match(reminderReceipt({ title: "Call", dueAt: "2026-11-12T12:30:00.000Z", timezone: "America/New_York", frequency: "weekly" }, { language: "en", sessionTimezone: "Asia/Shanghai" }), /^OK, I'll remind you every Thursday at 7:30 AM \(Eastern Standard Time\), starting Nov 12: Call\.$/);
  const delivered = finishReply(json(replay["interaction-voice-reminder"].planner[0]).reply, { request: replay["interaction-voice-reminder"].question, language: "zh", formatChecked: true, receipts: [receipt], reminderWritten: true });
  assert.equal(delivered, receipt, "one action, one sentence");
});

test("remember: one receipt sentence names whom the fact is about, and a one-sentence request gets only that sentence", () => {
  const row = replay["h4-int-single-receipt"];
  assert.equal(row.answer, "已记住：每周三晚上固定去打羽毛球。", "round 22 lost 陆川");
  const fact = json(row.profile[0]).facts[0];
  const receipt = rememberReceipt([{ who: fact.person, text: fact.fact }]);
  assert.equal(receipt, "好，记住了：陆川每周三晚上固定去打羽毛球。");
  assert.equal(finishReply(json(row.planner[0]).reply, { request: row.question, language: "zh", formatChecked: true, receipts: [receipt] }), receipt);
  assert.equal(rememberReceipt([{ who: "阿杰", text: "不吃香菜" }, { who: "阿杰", text: "对花粉过敏" }]), "好，记住了：阿杰不吃香菜；对花粉过敏。");
  assert.equal(rememberReceipt([{ who: "你", text: "2026-11-07 他打游戏一晚上不回我消息" }]), "好，记住了：2026-11-07 他打游戏一晚上不回我消息。");
  assert.equal(checklistReceipt({ space: "周末露营", created: true, items: ["帐篷", "饮用水", "充电宝"] }), "好，建好了只有你能看到的“周末露营”，放进了帐篷、饮用水和充电宝。");
});

test("remember: one self-corrected thing said is one fact, while separate things stay separate", () => {
  const row = replay["h4-int-voice-cousin-memory"], facts = json(row.profile[0]).facts;
  assert.equal(facts.length, 3, "round 22 split one wedding into three facts");
  const line = { id: facts[0].messageId, text: row.question, createdAt: "2026-11-12T23:23:05.704Z" };
  const found = verifyFacts(facts, [line], () => true);
  const merged = oneThingOneFact(found);
  assert.equal(merged.length, 1);
  assert.ok(row.question.includes(merged[0].quote));
  assert.match(merged[0].fact, /12 月 27 日结婚/); assert.match(merged[0].fact, /不是亲姐姐/); assert.match(merged[0].fact, /南湖酒店/);
  const separate = { id: "m1", text: "帮我记住：阿杰不吃香菜，而且对花粉过敏。" };
  const two = verifyFacts([{ messageId: "m1", quote: "阿杰不吃香菜", subject: "B", person: "阿杰", category: "food", fact: "不吃香菜", replaces: "" },
    { messageId: "m1", quote: "对花粉过敏", subject: "B", person: "阿杰", category: "food", fact: "对花粉过敏", replaces: "" }], [separate], () => true);
  assert.equal(oneThingOneFact(two).length, 2);
});

test("the explicit scan and a later background scan share one dedupe key: one message never yields a second record", async (t) => {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "task58-")); t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const store = await createFileStore(join(directory, "store.json"));
  const user = { id: randomUUID(), name: "小安" };
  await store.createUser({ ...user, email: `${user.id}@example.invalid`, passwordHash: "test", createdAt: new Date().toISOString() });
  const message = { id: randomUUID(), role: "user", text: "帮我记住：我每周三晚上固定去打羽毛球。", createdAt: new Date().toISOString() };
  const session = createRelationshipRecord({ relationshipId: null, userId: user.id, visibility: "private", aiAccessScope: "private", intentType: "assistant", language: "zh", timezone: "Asia/Shanghai", messages: [message] });
  await store.createRelationshipRecord("privateAgentThreads", session);
  const answers = [[{ messageId: message.id, quote: "我每周三晚上固定去打羽毛球", subject: "A", person: "", category: "traits", fact: "每周三晚上固定去打羽毛球", replaces: "" }],
    [{ messageId: message.id, quote: "每周三晚上固定去打羽毛球", subject: "A", person: "", category: "likes", fact: "每周三晚上打羽毛球", replaces: "" }]];
  const mediator = { structured: async () => ({ facts: answers.shift() }) };
  assert.equal((await scanPrivateProfile({ store, mediator, userId: user.id, sessionId: session.id, silent: true })).length, 1);
  // The background scan reads the same message again (its cursor was lost): differently worded, still the same fact.
  await store.updateRelationshipRecordForUser("privateAgentThreads", session.id, user.id, (draft) => { draft.profileScan = null; draft.version += 1; });
  await scanPrivateProfile({ store, mediator, userId: user.id, sessionId: session.id, silent: true });
  const kept = (await store.listRelationshipRecordsForUser("memories", user.id)).filter((record) => record.kind === "profile");
  assert.equal(kept.length, 1);
});

test("privacy suggestions fit the kind of question, never copy its topic, and still vary naturally", () => {
  const question = "小雅最近有没有在准备什么惊喜给我？";
  const replies = [0, 1, 2].map((index) => privateBoundaryReply("zh", index, question));
  assert.match(replies[0], /揭晓/, "a secret is left for them to reveal (ruling, task 58)");
  for (const reply of replies) {
    assert.match(reply, /看不到/);
    assert.doesNotMatch(reply, /惊喜|准备什么|最近有没有/);
    assert.ok(isPrivateBoundaryReply(reply));
  }
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(replySimilarity(replies[i], replies[j]) < 0.5);
  const thought = [0, 1, 2].map((index) => privateBoundaryReply("zh", index, "小雅是不是在想分手？"));
  for (const reply of thought) { assert.doesNotMatch(reply, /分手/); assert.match(reply, /“[^”]{6,}”/); }
  const plan = privateBoundaryReply("en", 0, "What are her plans this weekend?");
  assert.match(plan, /can't see/); assert.doesNotMatch(plan, /weekend/i);
  for (const language of ["zh", "en", "es"]) for (const ask of ["", "她在想什么？", "Is she hiding a surprise?", "¿Qué planes tiene?"]) assert.ok(isPrivateBoundaryReply(privateBoundaryReply(language, 1, ask)));
});

// Every round-22 practice and R4 answer that lost or failed its machine check is replayed through the final code acceptance:
// an answer that already keeps the user's format contract passes through unchanged; one that breaks it comes out compliant.
const allLosses = JSON.parse(readFileSync(new URL("./fixtures/task58-format-contract.json", import.meta.url), "utf8")).losses;
for (const row of allLosses) test(`final acceptance replays losing answer ${row.source}/${row.id}`, () => {
  const settled = settleContract(row.answer, row.question, "zh");
  if (!contractIssues(row.answer, row.question).length) assert.equal(settled, row.answer);
  else assert.equal(checkReplyFormat(settled, row.question).ok, true, settled);
  assert.ok(String(settled).trim(), "never empty");
});

test("model prose restating a remembered-fact receipt is left to the receipt (pre-freeze probe, tool-remember-preference)", () => {
  const receipt = rememberReceipt([{ who: "阿杰", text: "不吃香菜" }, { who: "阿杰", text: "对花粉过敏" }]);
  assert.equal(finishReply("阿杰不吃香菜，对花粉过敏。", { request: "帮我记住：阿杰不吃香菜，而且对花粉过敏。", language: "zh", formatChecked: true, receipts: [receipt] }), receipt);
  assert.equal(finishReply("他下周三生日，可以提前准备礼物。", { request: "帮我记住：阿杰不吃香菜。", language: "zh", formatChecked: true, receipts: [rememberReceipt([{ who: "阿杰", text: "不吃香菜" }])] }), "他下周三生日，可以提前准备礼物。\n好，记住了：阿杰不吃香菜。");
});
