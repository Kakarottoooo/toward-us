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
