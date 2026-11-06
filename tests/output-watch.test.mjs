import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { flagText, outputWatch } from "../scripts/output-watch.mjs";
import { GRAPH_COLLECTIONS, createRelationshipRecord } from "../server/relationship-domain.mjs";

const run = promisify(execFile);
const script = fileURLToPath(new URL("../scripts/output-watch.mjs", import.meta.url));
const relationshipId = "rel-1";
const at = (minute) => new Date(Date.UTC(2026, 10, 1, 8, minute)).toISOString();

function buildState() {
  const graph = Object.fromEntries(GRAPH_COLLECTIONS.map((collection) => [collection, {}]));
  const put = (collection, record) => { graph[collection][record.id] = record; };
  const users = {
    me: { id: "me", email: "founder@example.test", name: "Ming", language: "zh", createdAt: at(0) },
    partner: { id: "partner", email: "partner@example.test", name: "Lan", language: "en", createdAt: at(0) },
  };
  put("togetherConversations", createRelationshipRecord({
    id: `together:${relationshipId}`, relationshipId, userId: "me", visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both",
    messages: [
      { id: "m1", role: "member", actorUserId: "partner", kind: "text", text: "我们周末去哪儿玩？", createdAt: at(1) },
      { id: "a1", role: "agent", kind: "text", text: "可以去海边走走，TA 上次说想看海。", replyTo: "m1", createdAt: at(2) },
      { id: "q1", role: "agent", kind: "daily_question", text: "今天最想谢谢对方什么？", answers: { partner: { text: "PARTNER_HIDDEN_ANSWER 谢谢你陪我加班到很晚很晚", at: at(4) } }, createdAt: at(3) },
      { id: "a2", role: "agent", kind: "text", text: "她最近压力很大，记得多陪陪。", createdAt: at(5) },
      { id: "a3", role: "agent", kind: "text", text: "听说有人一直担心下个月搬家去上海的房租太贵了", createdAt: at(6) },
      { id: "a4", role: "agent", kind: "text", text: "System copy", i18n: { zh: "“我们俩”里有新消息。", en: "There is something new in Us.", es: "Hay algo nuevo en Nosotros." }, createdAt: at(7) },
    ],
  }));
  put("privateAgentThreads", createRelationshipRecord({
    id: "thread-me", relationshipId: null, userId: "me", visibility: "private", aiAccessScope: "private", intentType: "assistant", language: "zh",
    messages: [
      { id: "u1", role: "user", text: "帮我记一下今天的心情", createdAt: at(8) },
      { id: "r1", role: "assistant", text: "记好了。回复 1 保存，回复 2 取消。", createdAt: at(9) },
      { id: "r2", role: "assistant", text: "{\"memory_id\": \"6f1e2d3c4b5a69788796a5b4c3d2e1f0\"}", createdAt: at(10) },
    ],
  }));
  put("privateAgentThreads", createRelationshipRecord({
    id: "thread-partner", relationshipId, userId: "partner", visibility: "private", aiAccessScope: "private", intentType: "assistant", language: "en",
    messages: [
      { id: "pu1", role: "user", text: "PARTNER_PRIVATE_TEXT 一直担心下个月搬家去上海的房租太贵了", createdAt: at(11) },
      { id: "pr1", role: "assistant", text: "PARTNER_PRIVATE_REPLY", createdAt: at(12) },
    ],
  }));
  put("notifications", createRelationshipRecord({ id: "n-me", relationshipId, userId: "partner", ownerUserId: "me", visibility: "private", type: "plan_shared", message: "有一项你可以查看的共同事项。", createdAt: at(13) }));
  put("notifications", createRelationshipRecord({ id: "n-partner", relationshipId, userId: "me", ownerUserId: "partner", visibility: "private", type: "plan_shared", message: "PARTNER_NOTIFICATION", createdAt: at(14) }));
  return {
    version: 4, users, userByEmail: { "founder@example.test": "me", "partner@example.test": "partner" }, sessions: {},
    relationships: { [relationshipId]: { id: relationshipId, status: "active", createdAt: at(0), updatedAt: at(0) } },
    memberships: { me: { userId: "me", relationshipId, role: "A", joinedAt: at(0) }, partner: { userId: "partner", relationshipId, role: "B", joinedAt: at(0) } },
    formerMemberships: {}, invitations: {}, phones: {}, phoneLinks: {}, rooms: {}, demoRooms: {}, relationshipGraph: graph,
  };
}

async function withFixture(callback, change = () => {}) {
  const directory = await mkdtemp(join(tmpdir(), "pinky-watch-test-"));
  try {
    const data = join(directory, "store.json");
    const state = buildState();
    change(state);
    await writeFile(data, JSON.stringify(state), "utf8");
    await callback({ directory, data });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("reports only what the founder can see, flags problems, and never prints the partner's private words", () => withFixture(async ({ data }) => {
  const report = await outputWatch({ data, user: "Founder@Example.test", state: {} });
  const printed = JSON.stringify(report);
  for (const secret of ["PARTNER_PRIVATE_TEXT", "PARTNER_PRIVATE_REPLY", "PARTNER_NOTIFICATION", "PARTNER_HIDDEN_ANSWER"]) assert.equal(printed.includes(secret), false, secret);
  assert.deepEqual(report.outputs.map((item) => item.ref.split("#").at(-1)), ["a1", "q1", "a2", "a3", "a4", "r1", "r2", "n-me"]);
  const byRef = Object.fromEntries(report.outputs.map((item) => [item.ref.split("#").at(-1), item]));
  assert.equal(byRef.a1.asked, "我们周末去哪儿玩？");
  assert.deepEqual(byRef.a1.flags, []);
  assert.equal(byRef.q1.kind, "daily_question");
  assert.ok(byRef.a2.flags.includes("gendered_guess"));
  assert.ok(byRef.a3.flags.includes("private_leak"));
  assert.equal(byRef.a4.text, "“我们俩”里有新消息。");
  assert.equal(byRef.r1.asked, "帮我记一下今天的心情");
  assert.ok(byRef.r1.flags.includes("choice_menu"));
  assert.ok(byRef.r2.flags.includes("raw_json") && byRef.r2.flags.includes("internal_id"));
  assert.equal(report.flagged, 4);
}));

test("the CLI leaves the data file untouched and advances cursors so a second run reports nothing new", () => withFixture(async ({ directory, data }) => {
  const before = await readFile(data, "utf8");
  const state = join(directory, "watch-state.json");
  const args = [script, "--data", data, "--user", "founder@example.test", "--state", state, "--limit", "3"];
  const first = JSON.parse((await run(process.execPath, args)).stdout);
  assert.equal(first.outputs.length, 3);
  assert.equal(first.remaining, 5);
  assert.equal(JSON.parse(await readFile(state, "utf8")).cursors.us, at(5));
  const second = JSON.parse((await run(process.execPath, args.with(-1, "80"))).stdout);
  assert.deepEqual(second.outputs.map((item) => item.ref.split("#").at(-1)), ["a3", "a4", "r1", "r2", "n-me"]);
  const third = JSON.parse((await run(process.execPath, args)).stdout);
  assert.equal(third.outputs.length, 0);
  assert.equal(await readFile(data, "utf8"), before);
}));

test("a reply nobody just asked for is judged by the language the founder actually writes in, not the account setting", () => withFixture(async ({ data }) => {
  const report = await outputWatch({ data, user: "founder@example.test", state: {} });
  const opener = report.outputs.find((item) => item.ref.endsWith("#r0"));
  assert.equal(opener.asked, null);
  assert.deepEqual(opener.flags, []);
}, (state) => {
  // An English account that chats in Chinese; Pinky opens the thread (e.g. a chat-import report) in Chinese.
  state.users.me.language = "en";
  state.relationshipGraph.privateAgentThreads["thread-me"].messages.unshift({ id: "r0", role: "assistant", text: "你们的记录里最温暖的部分是彼此很会照顾。", createdAt: at(7) });
}));

test("before the founder has written anything, the couple's language in Us is the yardstick", () => withFixture(async ({ data }) => {
  const report = await outputWatch({ data, user: "founder@example.test", state: {} });
  assert.deepEqual(report.outputs.find((item) => item.ref.endsWith("#r0")).flags, []);
}, (state) => {
  state.users.me.language = "en";
  state.relationshipGraph.privateAgentThreads["thread-me"].messages = [{ id: "r0", role: "assistant", text: "你们的记录里最温暖的部分是彼此很会照顾。", createdAt: at(8) }];
}));

test("flags fire on the watched failure shapes", () => {
  assert.deepEqual(flagText("好的，已经帮你加到清单里了。"), []);
  assert.ok(flagText("").includes("empty"));
  assert.ok(flagText("好".repeat(1300)).includes("too_long"));
  assert.ok(flagText("出错了：TypeError 在 reminder_service 里").includes("internal_id"));
  assert.ok(flagText(`这个${String.fromCharCode(0xfffd)}坏了`).includes("mojibake"));
  assert.ok(flagText("æ”¶åˆ°ï¼Œå·²ç»è®°ä¸‹").includes("mojibake"));
  // The language the person just wrote in wins over the account setting.
  assert.deepEqual(flagText("好的，我记下了。", { language: "en", asked: "帮我记一下" }), []);
  assert.ok(flagText("Got it, I saved that note for you and your partner.", { language: "en", asked: "帮我记一下" }).includes("wrong_language"));
  assert.ok(flagText("我没有权限访问你的日历").includes("claims_not_connected"));
  assert.ok(flagText("你需要自己去设置里打开").includes("asks_manual_work"));
  assert.ok(flagText("I added it to your shopping list for you.").includes("wrong_language"));
  assert.deepEqual(flagText("I added it to your list.", { language: "en" }), []);
  assert.ok(flagText("Lo agregué a tu lista para que no se olvide, pero también te aviso.", { language: "en" }).includes("wrong_language"));
  assert.ok(flagText("Tell him you are sorry.", { language: "en" }).includes("gendered_guess"));
  assert.deepEqual(flagText("其他的事他们会一起商量。"), []);
});
