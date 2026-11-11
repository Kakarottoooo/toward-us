import test from "node:test";
import assert from "node:assert/strict";
import { prepareSourceReply } from "../server/source-reply.mjs";
import { privateBoundaryReply } from "../server/reply-contract.mjs";

test("ordinary conversation and the server privacy boundary make no source call", async () => {
  const mediator = { checkReplySources() { throw Error("unneeded"); }, rewriteReply() { throw Error("unneeded"); } };
  assert.equal(await prepareSourceReply("真替你开心。", { request: "回我一句", mediator }), "真替你开心。");
  assert.equal(await prepareSourceReply(privateBoundaryReply("zh"), { sources: [{ text: "private" }], mediator }), privateBoundaryReply("zh"));
});

test("each source defect is passed to one repair, with original text, never executing actions", async () => {
  const sources = [{ kind: "import", text: "约定19:00；19:45说还在上班。" }];
  const reply = "在临近时才说来不了。";
  let checks = 0, repairs = 0;
  const result = await prepareSourceReply(reply, { sources, request: "说说发生了什么", mediator: {
    async checkReplySources(input) { checks++; assert.deepEqual(input.sources, sources); return { claims: [
      { claim: "临近时", source: "19:00；19:45", supported: false, issue: "晚于约定45分钟" },
      { claim: "来不了", source: "还在上班", supported: false, issue: "没有说最终是否到场" },
    ], deliveryIssues: [] }; },
    async rewriteReply(input) { repairs++; assert.deepEqual(input.sources, sources); assert.equal(input.issues.length, 2); return "晚于约定45分钟才说还在上班。"; },
  } });
  assert.equal(result, "晚于约定45分钟才说还在上班。"); assert.equal(checks, 1); assert.equal(repairs, 1);
});

test("format downgrade retains the corrected content, never revives inaccurate original", async () => {
  const result = await prepareSourceReply("明天已取消。", { sources: [{ text: "还在讨论" }], request: "回我一句", mediator: {
    async checkReplySources() { return { claims: [{ claim: "已取消", source: "还在讨论", supported: false, issue: "尚未决定" }], deliveryIssues: [] }; },
    async rewriteReply() { return "尚未决定。还在讨论。"; },
  } });
  assert.match(result, /尚未决定/); assert.match(result, /格式/); assert.doesNotMatch(result, /已取消/);
});

test("invalid or failed source checks never silently claim verification or retry", async () => {
  for (const result of [null, {}, { claims: [{ supported: "false" }], deliveryIssues: [] }]) {
    await assert.rejects(prepareSourceReply("答复", { sources: [{ text: "来源" }], mediator: { checkReplySources: async () => result } }), /Invalid source check/);
  }
  let calls = 0;
  await assert.rejects(prepareSourceReply("答复", { sources: [{ text: "来源" }], mediator: { checkReplySources: async () => { calls++; throw Error("quota"); } } }), /quota/);
  assert.equal(calls, 1);
});
