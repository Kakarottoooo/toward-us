import test from "node:test";
import assert from "node:assert/strict";
import { prepareSourceReply, sourceCheckInstructions } from "../server/source-reply.mjs";
import { privateBoundaryReply, requiresReplyScopeCheck, checkReplyFormat } from "../server/reply-contract.mjs";

test("ordinary conversation and the server privacy boundary make no source call", async () => {
  const mediator = { checkReplySources() { throw Error("unneeded"); }, rewriteReply() { throw Error("unneeded"); } };
  assert.equal(await prepareSourceReply("真替你开心。", { request: "今天好多了", mediator }), "真替你开心。");
  assert.equal(await prepareSourceReply(privateBoundaryReply("zh"), { request: "只回一句，她告诉你谁的秘密？", sources: [{ text: "private" }], mediator }), privateBoundaryReply("zh"));
});

test("scope routing covers value questions and literal limits across interface languages", () => {
  for (const request of ["星期几？", "哪天？", "几点结束？", "多少人？", "谁去？", "店在哪？", "两行说完", "80字以内", "给个短回复", "Give one sentence", "Where is it?", "How much?", "Respuesta breve", "¿Qué fecha?", "¿Quién viene?"]) {
    assert.equal(requiresReplyScopeCheck(request), true, request);
  }
  for (const request of ["你好", "今天聊得挺开心", "帮我分析一下我们的沟通", "Tell me about your day", "Gracias"]) {
    assert.equal(requiresReplyScopeCheck(request), false, request);
  }
});

test("source, missing assessment, scope and format issues share one check and one rewrite", async () => {
  const request = "看截图，是我太敏感了吗？帮我写一句能守住边界的回复。";
  const reply = "你不敏感，不愿交出密码是正当的边界。\n可以说：我不会把密码给你。这是我的隐私。";
  const sources = [{ kind: "import", text: "Send me your passwords or we are done. If you loved me, you would do it." }];
  let checks = 0, repairs = 0;
  const corrected = "索要密码并用感情施压不合理，你有权拒绝。\n回复：我不会交出密码，请尊重我的隐私和决定。";
  const actual = await prepareSourceReply(reply, { request, sources, mediator: {
    async checkReplySources(input) {
      checks++; assert.equal(input.checkScope, true); assert.deepEqual(input.sources, sources);
      return { claims: [], newUnauthorizedStance: false, lostDeliverables: false, deliveryIssues: input.previousReply ? [] : ["缺少对感情施压行为是否合理的评价；仅拒交密码不够"] };
    },
    async rewriteReply(input) {
      repairs++; assert.equal(input.request, request); assert.deepEqual(input.sources, sources);
      assert.ok(input.issues.some(issue => issue.includes("感情施压")));
      assert.ok(input.issues.some(issue => issue.includes("Expected 1 sentence")));
      return corrected;
    },
  } });
  assert.equal(actual, corrected); assert.equal(checks, 2); assert.equal(repairs, 1);
  assert.match(sourceCheckInstructions, /BOTH missing required content and prohibited content/);
  assert.match(sourceCheckInstructions, /pressuring behavior itself/);
});

test("scope-only checks repair the captured short reply and current-value answer once", async () => {
  for (const [request, reply, issue, corrected] of [
    ["谢谢你，今天聊完好多了。就像手机聊天那样回我一句，不要列清单。", "听你这么说我也松了口气，今晚好好歇歇吧。", "删除未请求的休息建议", "听你这么说我也松了口气。"],
    ["我们的纪念日是哪天？", "是 5 月 21 号。你之前提过 20 号，后来改正成了 21 号，我按最新的记着。", "只给当前日期，删除旧日期及更正过程", "是 5 月 21 号。"],
  ]) {
    let checks = 0, rewrites = 0;
    assert.equal(await prepareSourceReply(reply, { request, mediator: {
      async checkReplySources(input) {
        checks++; assert.equal(input.checkScope, true); assert.equal(input.request, request);
        assert.deepEqual(input.sources, []);
        return { claims: [], newUnauthorizedStance: false, lostDeliverables: false, deliveryIssues: input.previousReply ? [] : [issue] };
      },
      async rewriteReply(input) {
        rewrites++; assert.equal(input.request, request); assert.ok(input.issues.includes(issue)); return corrected;
      },
    } }), corrected);
    assert.equal(checks, 2); assert.equal(rewrites, 1);
  }
});

test("each source defect is passed to one repair, with original text, never executing actions", async () => {
  const sources = [{ kind: "import", text: "约定19:00；19:45说还在上班。" }];
  const reply = "在临近时才说来不了。";
  let checks = 0, repairs = 0;
  const result = await prepareSourceReply(reply, { sources, request: "说说发生了什么", mediator: {
    async checkReplySources(input) { checks++; assert.deepEqual(input.sources, sources); return { claims: input.previousReply ? [] : [
      { claim: "临近时", source: "19:00；19:45", supported: false, issue: "晚于约定45分钟" },
      { claim: "来不了", source: "还在上班", supported: false, issue: "没有说最终是否到场" },
    ], deliverableChecks: [{ id: "deliverable-1", parts: [{ requirement: "发生了什么", present: true, quote: input.reply }] }], newUnauthorizedStance: false, lostDeliverables: false, deliveryIssues: [] }; },
    async rewriteReply(input) { repairs++; assert.deepEqual(input.sources, sources); assert.equal(input.issues.length, 2); return "晚于约定45分钟才说还在上班。"; },
  } });
  assert.equal(result, "晚于约定45分钟才说还在上班。"); assert.equal(checks, 2); assert.equal(repairs, 1);
});

test("format downgrade retains the corrected content, never revives inaccurate original", async () => {
  const result = await prepareSourceReply("明天已取消。", { sources: [{ text: "还在讨论" }], request: "回我一句", mediator: {
    async checkReplySources(input) { return { claims: input.previousReply ? [] : [{ claim: "已取消", source: "还在讨论", supported: false, issue: "尚未决定" }], newUnauthorizedStance: false, lostDeliverables: false, deliveryIssues: [] }; },
    async rewriteReply() { return "尚未决定。还在讨论。"; },
  } });
  assert.match(result, /尚未决定/); assert.doesNotMatch(result, /格式还需调整/); assert.doesNotMatch(result, /已取消/);
});

test("invalid or failed source checks never silently claim verification or retry", async () => {
  for (const result of [null, {}, { claims: [{ supported: "false" }], newUnauthorizedStance: false, lostDeliverables: false, deliveryIssues: [] }]) {
    assert.equal(await prepareSourceReply("答复", { sources: [{ text: "来源" }], mediator: { checkReplySources: async () => result } }), "答复");
  }
  let calls = 0;
  assert.equal(await prepareSourceReply("答复", { sources: [{ text: "来源" }], mediator: { checkReplySources: async () => { calls++; throw Error("quota"); } } }), "答复");
  assert.equal(calls, 1);
});

import { citedReply } from "../server/conversation-recall.mjs";
test("structured draft is checked independently of analysis and arbitrary labels", () => {
  const request = "先分析，再给我一句回复。";
  assert.equal(checkReplyFormat({ reply: "原文说了两件事。需要分开看。", sendableDraft: "我们再商量一下好吗？" }, request).ok, true);
  assert.equal(checkReplyFormat({ reply: "分析中的引文：‘可以。’", sendableDraft: null }, request).ok, true);
  assert.equal(checkReplyFormat({ reply: "分析。", sendableDraft: "可以。明天见。" }, request).ok, false);
});

test("source repair preserves citation metadata and checks structured copy", async () => {
  const sources = [{ messageId: "old" }, { messageId: "new" }];
  const reply = "旧安排十五分钟。[recall:old]现在改了日期，仍是十五分钟。[recall:new]";
  const result = await prepareSourceReply(reply, { sources: [{ kind: "recall", text: "旧安排十五分钟；新安排只确认日期。" }], request: "以前和现在分别怎么安排？", mediator: {
    async checkReplySources(input) {
      assert.doesNotMatch(input.reply, /\[recall:/);
      assert.doesNotMatch(JSON.stringify(input.sources), /\[recall:/);
      return { claims: input.previousReply ? [] : [{ claim: "仍是十五分钟", source: "新安排只确认日期", supported: false, issue: "新安排没有时长" }], newUnauthorizedStance: false, lostDeliverables: false, deliveryIssues: [] };
    },
    async rewriteReply(input) {
      assert.doesNotMatch(input.reply, /\[recall:/);
      return { reply: "旧安排十五分钟；新安排只确认日期，时长未说明。[recall:forged]", sendableDraft: null };
    },
  } });
  assert.deepEqual(citedReply(result, sources).sources, sources);
  assert.deepEqual(result.match(/\[recall:[^\]]+\]/g), ["[recall:old]", "[recall:new]"]);
});

test("structured wording-only reply renders the field without a label or analysis", async () => {
  const result = await prepareSourceReply("", { sendableDraft: "刚才说重了，对不起。", request: "帮我写一句道歉", mediator: {
    async checkReplySources(input) {
      assert.equal(input.sendableDraft, "刚才说重了，对不起。");
      return { claims: [], newUnauthorizedStance: false, lostDeliverables: false, deliveryIssues: [] };
    },
  } });
  assert.equal(result, "刚才说重了，对不起。");
});
