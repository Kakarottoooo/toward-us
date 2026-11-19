import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareSourceReply, sourceCheckInstructions, sourceCheckSchema } from "../server/source-reply.mjs";
import { finishReply, privateBoundaryReply, renderReply } from "../server/reply-contract.mjs";
import { sourceChronology } from "../server/source-chronology.mjs";

const clean = () => ({ claims: [], deliveryIssues: [], newUnauthorizedStance: false, lostDeliverables: false });
const defect = (n = 1) => ({ ...clean(), deliveryIssues: Array.from({ length: n }, (_, i) => `defect ${i}`) });
const original = { reply: "原稿分析，不代表用户承诺。", sendableDraft: "我们再商量一下好吗？" };
const revised = { reply: "改写分析。", sendableDraft: "我们再确认一下好吗？" };

const round14 = JSON.parse(readFileSync(new URL("./fixtures/task36-receipt-replay.json", import.meta.url), "utf8"));
for (const row of round14.rows) test(`round14 verbatim replay keeps evidence boundaries: ${row.id}`, async () => {
  if (row.id.startsWith("memory-partner-")) {
    for (let index = 0; index < 3; index++) {
      const reply = privateBoundaryReply("zh", index);
      assert.doesNotMatch(reply, /私聊|私密|秘密|告诉过我|反复|追问/);
      assert.notEqual(reply, privateBoundaryReply("zh", (index + 1) % 3));
      assert.match(reply, /直接问|问 TA|约个/);
    }
  }
  if (row.id === "plan-recall-then-remind") {
    assert.match(row.answer, /提醒目前也还没有设置/);
    const receipt = "已设好提醒：沟通，2026-11-12 20:00 (Asia/Shanghai)。";
    const result = finishReply(row.answer, { receipts: [receipt], reminderWritten: true, formatChecked: true });
    assert.doesNotMatch(result, /还没有设置/); assert.match(result, /已设好提醒/);
    assert.match(row.visible.history[0].answer, /提高了声音/);
    assert.deepEqual(JSON.parse(row.events[0].prompt).sources, [], "captured source gap, not an alleged new model result");
  }
  if (row.id === "memory-abstain-false-premise") {
    assert.match(row.answer, /没有聊天记录可以查/);
    assert.ok(row.visible.history.length > 0, "the original false denial contradicts the visible input");
  }
  if (row.id === "interaction-file-chat") {
    const messages = row.visible.file.split("\n").map(line => {
      const [, at, sender, text] = line.match(/^\[(.*?)\] (.*?): (.*)$/);
      return { at: at.replace(" ", "T") + ":00Z", sender, text };
    });
    const evidence = sourceChronology(messages);
    assert.match(evidence, /19:45/); assert.match(evidence, /19:30/);
    assert.equal((evidence.match(/after \/ 晚于/g) || []).length, 2);
    assert.doesNotMatch(evidence, /before \/ 早于|at \/ 正好/);
  }
  // Replay saved checks/rewrites, not a new quality score. Each recorded pipeline
  // still delivers one complete candidate; no model calls or action runs.
  for (let index = 0; index < row.events.length; index++) {
    const event = row.events[index];
    if (event.name !== "reply_source_check") continue;
    const input = JSON.parse(event.prompt);
    if (input.previousReply) continue;
    const repair = row.events[index + 1]?.name === "reply_format_repair" ? row.events[index + 1] : null;
    let checks = 0, rewritten;
    const result = await prepareSourceReply(input.reply, { ...input, mediator: {
      async checkReplySources() { return JSON.parse((checks++ ? row.events[index + 2] : event).text); },
      async rewriteReply() { if (!repair) throw Error("No captured rewrite"); rewritten = JSON.parse(repair.text); return rewritten; },
    } });
    assert.ok([renderReply(input), renderReply(rewritten)].includes(result));
  }
});

test("activity descriptions are rendered before checking and survive intact selection", async () => {
  const result = await prepareSourceReply("两人160元，没有预订。", { sendableDraft: "一起去{{activityDescription}}好吗？", activityDescription: "植物拓印体验",
    sources: [{ text: "Botanical Printing, 80 per person" }], mediator: {
      async checkReplySources(input) { assert.equal(input.sendableDraft, "一起去植物拓印体验好吗？"); return clean(); },
    } });
  assert.match(result, /一起去植物拓印体验好吗/);
  assert.doesNotMatch(result, /activityDescription/);
});

test("import chronology distinguishes before, equal and after without converting the wall clock", () => {
  const rows = [{ sender: "A", at: "2026-08-04T17:00:00Z", text: "See you at six?" },
    ...["17:45", "18:00", "18:20"].map(time => ({ sender: "B", at: `2026-08-04T${time}:00Z`, text: "An update" }))];
  const result = sourceChronology(rows);
  assert.match(result, /before \/ 早于/); assert.match(result, /at \/ 正好/); assert.match(result, /after \/ 晚于/);
  assert.match(result, /18:00/); assert.match(result, /inferred/);
  assert.equal(sourceChronology([{ ...rows[0], text: "See you tomorrow at six?" }, ...rows.slice(1)]), "");
  assert.equal(sourceChronology([rows[0], { ...rows[3], at: "2026-08-05T18:20:00Z" }]), "");
});

test("selection keeps exactly one complete version, with hard regressions taking precedence", async () => {
  for (const [before, after, winner] of [
    [defect(2), defect(1), revised], [defect(1), defect(2), original], [defect(1), defect(1), revised],
    [defect(2), { ...clean(), newUnauthorizedStance: true }, original],
    [defect(2), { ...clean(), lostDeliverables: true }, original],
  ]) {
    let checks = 0, rewrites = 0;
    const result = await prepareSourceReply(original.reply, { ...original, sources: [{ text: "来源" }], mediator: {
      async checkReplySources(input) {
        if (++checks === 1) return before;
        assert.deepEqual(input.previousReply, original);
        return after;
      },
      async rewriteReply() { rewrites++; return revised; },
    } });
    assert.equal(result, renderReply(winner));
    assert.equal(checks, 2); assert.equal(rewrites, 1);
  }
});

test("unauthorized acceptance, commitment and refusal in either field return the intact original", async () => {
  for (const field of ["reply", "sendableDraft"]) for (const stance of ["八点半可以。", "我保证去。", "我拒绝参加。"] ) {
    const result = await prepareSourceReply(original.reply, { ...original, sources: [{ text: "对方提议八点半；用户尚未回应。" }], mediator: {
      async checkReplySources(input) { return input.previousReply ? { ...clean(), newUnauthorizedStance: true } : defect(); },
      async rewriteReply() { return { ...revised, [field]: stance }; },
    } });
    assert.equal(result, renderReply(original));
  }
});

test("timeouts, malformed checks, parse failures and empty rewrites retain a complete answer without retry", async () => {
  for (const stage of ["initial-check", "rewrite", "final-check"]) for (const mode of ["timeout", "parse", "invalid"]) {
    let checks = 0, rewrites = 0;
    const fail = () => {
      if (mode === "invalid") return stage === "rewrite" ? { reply: "", sendableDraft: null } : null;
      if (mode === "parse") return JSON.parse("not JSON");
      throw Object.assign(Error("timeout"), { code: "ETIMEDOUT" });
    };
    const result = await prepareSourceReply(original.reply, { ...original, sources: [{ text: "来源" }], mediator: {
      async checkReplySources() {
        checks++;
        return stage === (checks === 1 ? "initial-check" : "final-check") ? fail() : defect();
      },
      async rewriteReply() { rewrites++; return stage === "rewrite" ? fail() : revised; },
    } });
    assert.equal(result, renderReply(original));
    assert.equal(checks, stage === "final-check" ? 2 : 1);
    assert.equal(rewrites, stage === "initial-check" ? 0 : 1);
    assert.doesNotMatch(result, /这次没能回答|格式还需调整/);
  }
});

test("format-only rewrites are reviewed and tied issue counts choose the rewrite", async () => {
  let checks = 0;
  const result = await prepareSourceReply("谢谢。真开心。", { request: "只回一句", mediator: {
    async checkReplySources() { checks++; return clean(); },
    async rewriteReply() { return { reply: "谢谢，真开心。", sendableDraft: null }; },
  } });
  assert.equal(result, "谢谢，真开心。"); assert.equal(checks, 2);
});

test("body, copyable card and source speakers have explicit distinct roles", async () => {
  assert.equal(Object.hasOwn(sourceCheckSchema.properties, "removals"), false);
  assert.match(sourceCheckInstructions, /Together they form ONE delivery/);
  assert.match(sourceCheckInstructions, /never require it again in reply/);
  assert.match(sourceCheckInstructions, /faithful translation or category description/);
  const result = await prepareSourceReply("我没有预订。", { sendableDraft: "一起去陶艺活动好吗？", request: "写一句邀约，不要预订。", sources: [{ text: "[用户] 想去看看。[助手] 我没有预订。[海报] Clay Together" }], mediator: {
    async checkReplySources(input) {
      assert.match(input.inputRoles.reply, /assistant/);
      assert.match(input.inputRoles.sendableDraft, /not evidence/);
      assert.match(input.inputRoles.sources, /speaker attribution/);
      assert.match(input.sources[0].text, /\[用户\].*\[助手\].*\[海报\]/);
      return clean();
    },
    async rewriteReply() { throw Error("card already delivers the invitation"); },
  } });
  assert.equal(result, '我没有预订。\n\n一起去陶艺活动好吗？');
});

const replay = JSON.parse(readFileSync(new URL("./fixtures/source-selection-replay.json", import.meta.url), "utf8"));
for (const row of replay.rows) test(`captured failure returns a whole candidate: ${row.id}`, async () => {
  const input = JSON.parse(row.events[0].prompt);
  const first = JSON.parse(row.events[0].text);
  // Old observations stay verbatim in the fixture. Only the two new booleans are
  // supplied by this deterministic test, never represented as fresh model evidence.
  const adapt = (value) => ({ ...value, newUnauthorizedStance: row.reviewFlag === "newUnauthorizedStance", lostDeliverables: row.reviewFlag === "lostDeliverables" });
  const capturedRewrite = row.events.find(e => e.name === "reply_format_repair");
  let checks = 0, candidate;
  if (capturedRewrite) { try { candidate = JSON.parse(capturedRewrite.text); } catch { candidate = capturedRewrite.text; } }
  const result = await prepareSourceReply(input.reply, { ...input, mediator: {
    async checkReplySources() {
      if (++checks === 1) return { ...adapt(first), newUnauthorizedStance: false, lostDeliverables: false };
      const last = row.events.at(-1);
      return adapt(last.name === "reply_source_check" ? JSON.parse(last.text) : defect());
    },
    async rewriteReply() {
      if (row.reviewFlag === "timeout") throw Object.assign(Error("captured timeout"), { code: "ETIMEDOUT" });
      return candidate;
    },
  } });
  assert.ok([renderReply(input), renderReply(candidate)].includes(result), "never delete, splice or add error prose");
  assert.ok(result.trim());
  assert.doesNotMatch(result, /这次没能回答|格式还需调整/);
  if (row.reviewFlag) assert.equal(result, renderReply(input));
});

test("real mediator and CLI adapter do not retry or reinterpret malformed check/rewrite output", async (t) => {
  const childProcess = (await import("node:child_process")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  const { resolve } = await import("node:path");
  const saved = Object.fromEntries(["AI_PROVIDER", "TMP", "TEMP"].map(key => [key, process.env[key]]));
  process.env.AI_PROVIDER = "claude-cli";
  process.env.TMP = process.env.TEMP = resolve("work");
  let calls = 0;
  const mock = t.mock.method(childProcess, "spawn", () => {
    calls++;
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin.on("finish", () => queueMicrotask(() => {
      child.stdout.end(JSON.stringify({ result: "Unstructured prose instead of the required JSON", num_turns: 1 }));
      child.emit("close", 0);
    }));
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    mock.mock.restore(); syncBuiltinESMExports();
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  const { createMediator } = await import("../server/mediator.mjs");
  const mediator = createMediator({ apiKey: "" });
  await assert.rejects(mediator.checkReplySources({ request: "request", reply: "draft" }), /schema retry disabled/);
  assert.equal(calls, 1);
  await assert.rejects(mediator.rewriteReply({ request: "request", reply: "draft", issues: ["issue"] }), /schema retry disabled/);
  assert.equal(calls, 2, "one transport call per stage, never a strict-schema retry");
});

