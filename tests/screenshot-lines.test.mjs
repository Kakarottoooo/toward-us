import assert from "node:assert/strict";
import { test } from "node:test";
import { familyOrGroup, splitLabeledLines } from "../server/chat-import.mjs";

// QA 11-26 (ChatGPT comparison): a labelled-line screenshot came back as one bubble from the other person, so the user's
// own "你根本不考虑我" was attributed to them and the drafted line never owned it.
test("a labelled-line screenshot is split into each speaker's messages, 我 being the user", () => {
  const one = [{ mine: false, name: null, time: null, text: "钟哲（11月12日 周三）\n钟哲 21:03: 我看了那只柯基的领养信息\n我 21:17: 你根本不考虑我\n钟哲 21:30: 随便你吧" }];
  assert.deepEqual(splitLabeledLines(one), [
    { mine: false, name: "钟哲", time: "21:03", text: "我看了那只柯基的领养信息" },
    { mine: true, name: null, time: "21:17", text: "你根本不考虑我" },
    { mine: false, name: "钟哲", time: "21:30", text: "随便你吧" },
  ]);
  const bubbles = [{ mine: true, name: null, time: "21:17", text: "你根本不考虑我" }, { mine: false, name: "钟哲", time: null, text: "随便你吧\n晚安" }];
  assert.deepEqual(splitLabeledLines(bubbles), bubbles, "ordinary bubbles are left as they are");
});

test("relatives and groups are not filed as someone the user is getting to know", () => {
  for (const name of ["魏妈妈", "婆婆", "我哥", "家庭群", "Mom", "Brother Tom", "Tía Rosa"]) assert.equal(familyOrGroup(name), true, name);
  for (const name of ["小满", "钟哲", "王哥", "小姐姐", "小哥哥", "River", "Ana", "Sandra"]) assert.equal(familyOrGroup(name), false, name);
});

// QA 11-26: "给我一句" cut the drafted message to its first full stop and dropped the apology; the line is kept whole.
test("a drafted line to send is joined into one sentence, never cut", async () => {
  const { joinSentences } = await import("../server/reply-contract.mjs");
  assert.equal(joinSentences("昨天我不想一直僵着。我说“你根本不考虑我”太重了，对不起。养狗的事先放放。"), "昨天我不想一直僵着，我说“你根本不考虑我”太重了，对不起，养狗的事先放放。");
  assert.equal(joinSentences("就一句。"), "就一句。");
});

// QA 11-26: a one-line invitation came back as "去美术馆{{activityDescription}}" because the line skipped the placeholder fill.
test("a drafted line never shows the activity placeholder", async () => {
  const { activityDraft } = await import("../server/reply-contract.mjs");
  assert.equal(activityDraft({ sendableDraft: "周六下午要不要一起去{{activityDescription}}？", activityDescription: "看莫奈展" }), "周六下午要不要一起去看莫奈展？");
  assert.equal(activityDraft({ sendableDraft: "周六下午要不要一起去美术馆{{activityDescription}}？", activityDescription: null }), "周六下午要不要一起去美术馆？");
});
