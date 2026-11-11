import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareSourceReply, sourceCheckInstructions } from "../server/source-reply.mjs";

const clean = () => ({ claims: [], deliveryIssues: [], removals: [] });

test("a rewrite's new acceptance is checked in both fields and rolls back to deletion-only original", async () => {
  for (const field of ["reply", "sendableDraft"]) {
    const original = { reply: "双方都可以把话说清楚。早点休息。", sendableDraft: "刚才我说重了，我们再商量一下好吗？" };
    let checks = 0, rewrites = 0;
    const answer = await prepareSourceReply(original.reply, { sendableDraft: original.sendableDraft, request: "先评理，再给我一句回复。", sources: [{ text: "对方：改成八点半？我：你怎么又改时间。" }], mediator: {
      async checkReplySources(input) {
        checks++;
        if (checks === 1) return { ...clean(), deliveryIssues: ["删除未请求的休息建议"], removals: [{ field: "reply", text: "早点休息。" }] };
        assert.match(input[field], /八点半可以/);
        assert.deepEqual(input.previousReply, original);
        return { ...clean(), claims: [{ claim: "八点半可以", source: "", supported: false, issue: "用户未接受提议" }] };
      },
      async rewriteReply() { rewrites++; return { ...original, [field]: original[field] + "八点半可以。" }; },
    } });
    assert.equal(checks, 2); assert.equal(rewrites, 1);
    assert.equal(answer, "双方都可以把话说清楚。\n\n“刚才我说重了，我们再商量一下好吗？”");
  }
});

test("a format-only rewrite also receives a final semantic check", async () => {
  let checks = 0;
  const answer = await prepareSourceReply("谢谢。真开心。", { request: "用1行回答", mediator: {
    async checkReplySources() { checks++; return clean(); },
    async rewriteReply() { throw Error("already fits; no rewrite"); },
  } });
  assert.equal(answer, "谢谢。真开心。"); assert.equal(checks, 1);
  checks = 0;
  await prepareSourceReply("谢谢。\n真开心。", { request: "用1行回答", mediator: {
    async checkReplySources() { checks++; return clean(); },
    async rewriteReply() { return { reply: "谢谢，真开心。", sendableDraft: null }; },
  } });
  assert.equal(checks, 2);
});

test("rollback deletes whole sentences, never just a negation or generated replacement", async () => {
  const answer = await prepareSourceReply("我没有接受邀请。我们再聊聊。", { request: "回我一句", mediator: {
    async checkReplySources(input) { return input.previousReply
      ? { ...clean(), deliveryIssues: ["新加了承诺"] }
      : { ...clean(), deliveryIssues: ["删除第一句"], removals: [{ field: "reply", text: "没有" }, { field: "reply", text: "伪造替换" }] }; },
    async rewriteReply() { return { reply: "我答应了。", sendableDraft: null }; },
  } });
  assert.equal(answer, "我们再聊聊。");
});

test("REPORT-27 lines 8-9 replay preserves requested Chinese invitation and booking status", async () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/source-rewrite-replay.json", import.meta.url), "utf8"));
  const original = JSON.parse(fixture.check.prompt), badRewrite = JSON.parse(fixture.rewrite.text);
  assert.match(badRewrite.sendableDraft, /虚构活动示例/);
  assert.doesNotMatch(badRewrite.sendableDraft, /陶艺/);
  let checks = 0;
  const answer = await prepareSourceReply(original.reply, { ...original, mediator: {
    async checkReplySources(input) {
      checks++;
      assert.equal(input.requestedDeliverables.language, "zh");
      assert.ok(input.requestedDeliverables.clauses.some(clause => clause.includes("一句邀约，不要预订")));
      assert.ok(input.requestedDeliverables.clauses.some(clause => clause.includes("多少钱，几点结束")));
      assert.match(sourceCheckInstructions, /faithful translation or category description/);
      assert.match(sourceCheckInstructions, /Never require evaluation or fictional-example labels/);
      return clean();
    },
    async rewriteReply() { throw Error("requested content must not be removed"); },
  } });
  assert.equal(checks, 1);
  assert.match(answer, /陶艺活动/); assert.match(answer, /240/); assert.match(answer, /16:00/); assert.match(answer, /没有预订/);
  assert.doesNotMatch(answer, /虚构活动示例/);
});

test("rollback never restores a known unsupported original fact when removal spans were omitted", async () => {
  const answer = await prepareSourceReply("活动已经取消。我们再确认一下。", { request: "帮我写一句话", sources: [{ text: "还在讨论" }], mediator: {
    async checkReplySources(input) { return input.previousReply ? { ...clean(), deliveryIssues: ["改写擅自答应"] }
      : { ...clean(), claims: [{ claim: "活动已经取消", source: "还在讨论", supported: false, issue: "尚未决定" }] }; },
    async rewriteReply() { return { reply: "", sendableDraft: "我答应参加。" }; },
  } });
  assert.equal(answer, "我们再确认一下。");
});

test("final audit failures stop without retry or delivering unchecked revised text", async () => {
  for (const fail of [() => null, () => { throw Error("quota"); }]) {
    let checks = 0, rewrites = 0;
    await assert.rejects(prepareSourceReply("谢谢。真开心。", { request: "只回一句", mediator: {
      async checkReplySources() { return ++checks === 1 ? clean() : fail(); },
      async rewriteReply() { rewrites++; return { reply: "谢谢，真开心。", sendableDraft: null }; },
    } }), /Invalid source check|quota/);
    assert.equal(checks, 2); assert.equal(rewrites, 1);
  }
});
