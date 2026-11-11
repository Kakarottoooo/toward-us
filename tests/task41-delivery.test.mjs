import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareSourceReply, sourceCheckInstructions } from "../server/source-reply.mjs";
import { renderReply } from "../server/reply-contract.mjs";

const clean = () => ({ claims: [], deliveryIssues: [], stanceChecks: [], newUnauthorizedStance: false, lostDeliverables: false });
const rows = JSON.parse(readFileSync(new URL("./fixtures/task41-source-replay.json", import.meta.url), "utf8")).rows;

test("task39 raw replays preserve whole candidates and expose residual defects, without fresh model claims", async () => {
  for (const row of rows) {
    const event = row.events.find(e => e.name === "reply_source_check");
    const input = JSON.parse(event.prompt);
    const repair = row.events.find(e => e.name === "reply_format_repair");
    const candidate = repair ? JSON.parse(repair.text) : null;
    let checks = 0;
    const answer = await prepareSourceReply(input.reply, { ...input, mediator: {
      async checkReplySources() { return JSON.parse((checks++ ? row.events.at(-1) : event).text); },
      async rewriteReply() { if (!candidate) throw Error("No historical rewrite"); return candidate; },
    } });
    assert.ok([renderReply(input), renderReply(candidate)].includes(answer));
    if (row.id.endsWith("boundary")) {
      assert.equal(checks, 2);
      assert.match(candidate.sendableDraft, /不舒服/);
      assert.doesNotMatch(candidate.sendableDraft, /不给|不会给|拒绝/);
    }
    if (row.id.endsWith("fair")) {
      assert.match(row.answer, /““/);
      assert.doesNotMatch(answer, /““/);
      assert.match(JSON.parse(row.events.at(-1).text).claims.find(c => !c.supported).claim, /今晚/);
    }
    if (row.id.endsWith("file-chat")) {
      assert.ok(JSON.parse(row.events.at(-1).text).claims.some(c => !c.supported));
    }
  }
});

test("structured draft wrappers are removed without stripping inline source quotations", () => {
  for (const draft of ['“我想再谈谈。”', '““我想再谈谈。””', '"我想再谈谈。"', '「我想再谈谈。」']) {
    assert.equal(renderReply({ reply: "分析。", sendableDraft: draft }), "分析。\n\n我想再谈谈。");
  }
  assert.equal(renderReply({ reply: "分析。", sendableDraft: '“总是”这个说法太绝对了。' }), '分析。\n\n“总是”这个说法太绝对了。');
});

test("requested stance needs a per-item quote from the draft, not analysis or a positive boolean alone", async () => {
  for (const request of ["帮我写一句拒绝借车的回复。", "Write a reply accepting the invitation.", "Escribe una disculpa."]) {
    const before = { reply: "我可以拒绝。", sendableDraft: "我有点不舒服。" };
    const after = { reply: "分析。", sendableDraft: "这是用户要求的明确立场。" };
    let checks = 0;
    const output = await prepareSourceReply(before.reply, { ...before, request, mediator: {
      async checkReplySources(input) {
        checks++;
        const [stance] = input.requestedDeliverables.stances;
        assert.equal(stance.clause, request);
        return { ...clean(), stanceChecks: [{ id: stance.id, requiredStance: request, present: true,
          draftQuote: input.previousReply ? after.sendableDraft : before.reply }] };
      },
      async rewriteReply(input) { assert.match(input.issues[0], /Missing requested stance/); return after; },
    } });
    assert.equal(output, renderReply(after)); assert.equal(checks, 2);
  }
});

test("factual grounding outranks any number of wording defects; missing stances still choose a whole candidate", async () => {
  const before = { reply: "原分析", sendableDraft: "原稿" }, after = { reply: "改写分析", sendableDraft: "改写稿" };
  const fact = { claim: "总体概括", source: "只覆盖一条", supported: false, issue: "不覆盖每条引用" };
  const output = await prepareSourceReply(before.reply, { ...before, sources: [{ text: "两条来源" }], mediator: {
    async checkReplySources(input) { return input.previousReply ? { ...clean(), claims: [fact] } : { ...clean(), deliveryIssues: Array(8).fill("措辞问题") }; },
    async rewriteReply() { return after; },
  } });
  assert.equal(output, renderReply(before));
  assert.match(sourceCheckInstructions, /true for only some instances, return supported:false/);
  const stillMissing = await prepareSourceReply(before.reply, { ...before, request: "写一句拒绝的话", mediator: {
    async checkReplySources(input) { return { ...clean(), deliveryIssues: input.previousReply ? [] : ["措辞问题"] }; },
    async rewriteReply() { return after; },
  } });
  assert.equal(stillMissing, renderReply(after));
});
