import test from "node:test";
import assert from "node:assert/strict";
import { checkReplyFormat, repairReplyFormat, wantsOneSentence } from "../server/reply-contract.mjs";

test("explicit sentence requests include drafting verbs without truncating mixed answers", () => {
  assert.equal(wantsOneSentence("帮我写一句祝贺，不要发送。"), true);
  assert.equal(checkReplyFormat("恭喜。做得好。", "帮我写一句祝贺。").ok, false);
  assert.equal(checkReplyFormat("活动五点结束。\n“周末一起去画画吗？”", "几点结束？再给我一句邀约。").ok, true);
  assert.equal(checkReplyFormat("活动五点结束。\n“去画画吗？我买票。”", "几点结束？再给我一句邀约。").ok, false);
  assert.equal(checkReplyFormat("有误会。\n“刚才说“总是”太重了。我们另约一天。”", "评评理，最后给一句回复。").ok, false);
});

test("line and character constraints work in all interface languages", () => {
  for (const request of ["用两行，不超过十字", "exactly 2 lines, at most 10 characters", "exactamente 2 líneas, máximo 10 caracteres"]) {
    assert.equal(checkReplyFormat("第一行\n第二行", request).ok, true);
    assert.equal(checkReplyFormat("第一行", request).ok, false);
    assert.equal(checkReplyFormat("1234567890\n123", request).ok, false);
  }
  assert.equal(checkReplyFormat("It costs 2.50 euros.", "Just one sentence.", "en").ok, true);
});

test("only one prose repair is allowed, with reasons and honest fallback", async () => {
  let calls = 0;
  const result = await repairReplyFormat("好。谢谢。", { request: "回我一句", language: "zh", rewrite: async ({ issues }) => {
    calls++; assert.ok(issues.some((x) => x.includes("sentence"))); return "好。谢谢。";
  } });
  assert.equal(calls, 1);
  assert.match(result, /格式/);
  assert.match(result, /好。/, "even unsuccessful format repair delivers usable wording");
  assert.equal(await repairReplyFormat("谢谢你。", { request: "回我一句", rewrite: () => { throw Error("unneeded"); } }), "谢谢你。");
});

test("captured natural draft labels work across interface languages without accepting source quotes", () => {
  const captured = "你不是太敏感，Sam 用分手和“你爱我就该给”来施压确实越界了，回复可以这样写：“密码我不会给，这和爱不爱是两回事”";
  const question = "看截图，是我太敏感了吗？帮我写一句能守住边界的回复。";
  for (const label of ["回复可以这样写", "可以这样发", "你可以说", "你可以这样回复", "可复制的回复"]) {
    assert.equal(checkReplyFormat(captured.replace("回复可以这样写", label), question).ok, true, label);
  }
  for (const [language, request, labels, draft] of [
    ["en", "What happened? Then draft just one sentence.", ["You can say", "You could reply", "You can write", "Reply like this"], "I will keep my password private."],
    ["es", "¿Qué pasó? Solo una frase.", ["Puedes decir", "Podrías responder", "Puedes escribir", "Respuesta sugerida"], "Prefiero mantener mi contraseña privada."],
  ]) for (const label of labels) {
    assert.equal(checkReplyFormat(`Context. ${label}: “${draft}”`, request, language).ok, true, label);
    assert.equal(checkReplyFormat(`Context says “${label}: ${draft}” is a quotation.`, request, language).ok, false);
  }
});

test("failed mixed-format repair retains the complete closest draft and analysis", async () => {
  const reply = "双方需要重新确认时间。回复：我愿意再约。请提前告诉我。";
  const result = await repairReplyFormat(reply, { request: "发生什么了？再给我一句回复。", rewrite: async () => reply });
  assert.ok(result.includes(reply));
  assert.match(result, /格式/);
});

test("analysis quotes cannot stand in for the requested final draft", async () => {
  const request = "根据记录评评理，最后给我一句能回的话。";
  const reply = "你那句“总是迟到”没有足够依据。现在可以这样回：\n\n刚才那句“总是迟到”说重了，对不起。我们重新约个时间好吗？";
  const checked = checkReplyFormat(reply, request);
  assert.equal(checked.ok, false);
  assert.ok(checked.issues.some((issue) => /found 2/.test(issue)));
  let calls = 0;
  const fixed = await repairReplyFormat(reply, { request, rewrite: async ({ reply: rejected, issues }) => {
    calls++;
    assert.equal(rejected, reply);
    assert.ok(issues.length);
    return "这句话超出了记录的依据。回复：“刚才说重了，我们重新约个时间好吗？”";
  } });
  assert.equal(calls, 1);
  assert.equal(checkReplyFormat(fixed, request).ok, true);
  assert.equal(checkReplyFormat("对方说“还没结束”，不能据此认定对方拒绝。", request).ok, false);
  assert.equal(checkReplyFormat("对方说“可以这样回：我不去”，这是转述。", request).ok, false);
  assert.equal(checkReplyFormat("双方还没确认。\n“我们再定时间好吗？”", request).ok, true);
  assert.equal(checkReplyFormat("双方还没确认，可以这样说：“我们再定时间好吗？”", request).ok, true);
  assert.equal(checkReplyFormat("双方还没确认。可以这样平和地说：“我们再定时间好吗？”这是私人草稿。", request).ok, true);
  assert.equal(checkReplyFormat("双方还没确认。\n“我们再定时间好吗？”\n另一个引文是“拒绝”。", request).ok, false);
  for (const [language, question, answer] of [
    ["en", "What happened? Then draft just one sentence.", 'They said "later". Reply: I understand. Shall we reschedule?'],
    ["es", "¿Qué pasó? Solo una frase.", 'Dijo "más tarde". Respuesta: Entiendo. ¿Cambiamos la hora?'],
  ]) assert.equal(checkReplyFormat(answer, question, language).ok, false);
});
