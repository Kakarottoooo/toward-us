import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareSourceReply, sourceCheckInstructions } from "../server/source-reply.mjs";
import { renderReply, finishReply } from "../server/reply-contract.mjs";
import { normalizeAssistantTurn, validateAssistantTurn } from "../server/assistant-agent.mjs";

const clean = () => ({ claims: [], deliveryIssues: [], stanceChecks: [], newUnauthorizedStance: false, lostDeliverables: false });
const rows = JSON.parse(readFileSync(new URL("./fixtures/task41-source-replay.json", import.meta.url), "utf8")).rows;

const round18 = JSON.parse(readFileSync(new URL("./fixtures/task43-source-replay.json", import.meta.url), "utf8")).rows;
test("round18 original reminder prose yields to one committed receipt, preserving other deliverables", () => {
  const raw = round18.find(row => row.id === "interaction-voice-reminder");
  const initial = JSON.parse(raw.events.find(event => event.name === "private_assistant_operations").text);
  const receipt = "已保存个人提醒：给他回电话，2026-11-12 20:30 (Asia/Shanghai)。";
  assert.equal(finishReply(initial.reply, { receipts: [receipt], reminderWritten: true }), receipt);
  assert.equal(finishReply(`先说自己的感受。${initial.reply}`, { receipts: [receipt], reminderWritten: true }), `先说自己的感受。\n${receipt}`);
});

test("unrecorded premise survives planning and forces whole-answer review even without sources", async () => {
  const raw = round18.find(row => row.id === "memory-abstain-false-premise");
  const plan = normalizeAssistantTurn({ reply: raw.answer, actions: [], unsupportedPremise: "Jordan 出轨", privateBoundary: false }, "zh");
  assert.equal(validateAssistantTurn(plan), true);
  assert.equal(plan.unsupportedPremise, "Jordan 出轨");
  let checks = 0;
  const fixed = "没有这件事的记录，不能确认发生过；记录只提到工作很忙、回消息慢。";
  const answer = await prepareSourceReply(plan.reply, { unsupportedPremise: plan.unsupportedPremise, mediator: {
    async checkReplySources(input) {
      checks++; assert.equal(input.requestedDeliverables.unsupportedPremise, plan.unsupportedPremise);
      return input.previousReply ? clean() : { ...clean(), claims: [{ claim: "又让你想起了那件事", source: "", supported: false, issue: "追问预设未证实事件" }] };
    }, async rewriteReply() { return fixed; },
  } });
  assert.equal(checks, 2); assert.equal(answer, fixed);
});

test("historical poster transcription already contains booking status; preserve it through both audit passes", async () => {
  const row = round18.find(row => row.id === "interaction-image-invitation");
  const input = JSON.parse(row.events.find(event => event.name === "reply_source_check").prompt);
  assert.match(input.sources[0].text, /No booking has been made/);
  const read = JSON.parse(row.events.find(event => event.name === "read_images").text);
  const source = read.messages.map(message => message.text).join("\n");
  let checks = 0;
  await prepareSourceReply(input.reply, { ...input, sources: [{ kind: "image_transcript", text: source }], mediator: {
    async checkReplySources(value) { checks++; assert.match(value.sources[0].text, /\nNo booking has been made/); return clean(); },
    async rewriteReply() { return { reply: "两个人240元，16:00结束；尚未预订。", sendableDraft: "周六一起去做陶艺吗？" }; },
  } });
  assert.equal(checks, 2);
  assert.match(sourceCheckInstructions, /source explicitly saying no booking supports/);
});

test("memory advice checks external factual assertions without turning suggestions into events", async () => {
  const raw = round18.find(row => row.id === "memory-people-allergy-two-chens");
  const fixed = "先确认店家能否避免海鲜交叉接触，再决定。";
  const answer = await prepareSourceReply(raw.answer, { sources: [{ kind: "visible_memory", text: "陈一对海鲜过敏。" }], mediator: {
    async checkReplySources(input) { return input.previousReply ? clean() : { ...clean(), claims: [{ claim: "夹子、油和台面都是共用的", source: "", supported: false, issue: "没有该餐厅做法的来源，只能说可能或建议询问店家" }] }; },
    async rewriteReply() { return fixed; },
  } });
  assert.equal(answer, fixed);
  assert.match(sourceCheckInstructions, /Audit external-world factual assertions even inside advice/);
});

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
