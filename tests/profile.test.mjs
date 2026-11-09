import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApiApp } from "../server/app.mjs";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { buildTogetherContext } from "../server/together-domain.mjs";
import { pendingPartner, profileContext, scanBroughtChat, scanCall, scanPrivateProfile, scanTogetherProfile } from "../server/profile.mjs";

// 喜好档案 (11-06): kept automatically from conversations, visible afterwards, each person's notes their own.
let server, base, directory, store, counter = 0;
before(async () => {
  await mkdir(join(process.cwd(), "work"), { recursive: true });
  directory = await mkdtemp(join(process.cwd(), "work", "profile-"));
  store = await createFileStore(join(directory, "state.json"));
  const previousKey = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "";
  server = createApiApp({ store, mediator: { aiReady: false, model: "test" } }).listen(0, "127.0.0.1");
  if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); if (directory) await rm(directory, { recursive: true, force: true }); });

async function call(path, user, body, status = 200, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(`${base}/api${path}`, { method, headers: { "content-type": "application/json", cookie: user.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = response.status === 204 ? null : await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`);
  return result;
}
async function pair() {
  const register = async (name) => {
    const response = await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, email: `profile-${++counter}@example.com`, password: "correct horse battery" }) });
    assert.equal(response.status, 201); return { ...(await response.json()), cookie: response.headers.get("set-cookie").split(";")[0] };
  };
  const a = await register("Ziwei"), b = await register("Mia");
  const invitation = await call("/partner/invitations", a, {}, 201);
  await call("/partner/accept", b, { code: invitation.pairing.invitation.code });
  const context = await store.getRelationshipContext(a.user.id);
  return { a, b, relationshipId: context.relationship.id };
}
const fakeModel = (answer) => { const seen = []; return { seen, structured: async ({ name, input, instructions }) => { assert.equal(name, "couple_profile"); const parsed = JSON.parse(input); seen.push(parsed); return { facts: answer(parsed, instructions) }; } }; };
const fact = (patch) => ({ subject: "A", category: "food", replaces: "", ...patch });
async function privateChat(userId, lines) {
  const session = createRelationshipRecord({ relationshipId: null, userId, visibility: "private", aiAccessScope: "private", intentType: "assistant", language: "zh", timezone: "UTC", messages: lines.map(([id, role, text]) => ({ id, role, text, createdAt: new Date().toISOString() })) });
  await store.createRelationshipRecord("privateAgentThreads", session);
  return session;
}

test("private interview captions preserve the full accepted turn and ground notes only in the owner's words", async () => {
  const { a, b, relationshipId } = await pair();
  const session = await privateChat(a.user.id, []);
  const tail = "我的生日是六月十七号，我最想去的是格陵兰，不是冰岛";
  const text = "我喜欢和 Mia 一起看老电影。" + "让我想一想。".repeat(230) + tail;
  assert.ok(text.length > 1200 && text.length <= 2000, "a valid caption with facts after the former cutoff");
  const rows = [{ role: "agent", text: "你们都想去冰岛，也都爱露营？" }, { role: "user", text }];
  const model = fakeModel((input, instructions) => {
    assert.equal(input.messages[1].text, text, "the scanner must read the full caption accepted by the call router");
    assert.deepEqual(input.messages.map((line) => [line.from, line.isNew]), [["Pinky", false], ["A", true]]);
    assert.match(instructions, /including later corrections and negations/);
    assert.match(instructions, /"I like doing X with B" describes A's preference, subject A/);
    assert.match(instructions, /Use subject both only when A explicitly describes a mutual/);
    return [
      fact({ messageId: "caption:1", quote: "我的生日是六月十七号", category: "people", fact: "生日是六月十七号" }),
      fact({ messageId: "caption:1", quote: "我最想去的是格陵兰，不是冰岛", category: "wishes", fact: "想去格陵兰，不是冰岛" }),
      fact({ messageId: "caption:1", quote: "我喜欢和 Mia 一起看老电影", category: "likes", fact: "喜欢和 Mia 一起看老电影" }),
      fact({ messageId: "caption:0", quote: "都爱露营", subject: "both", category: "likes", fact: "爱露营" }),
      fact({ messageId: "caption:1", quote: "喜欢奶茶", fact: "喜欢奶茶" }),
    ];
  });
  const kept = await scanCall({ store, mediator: model, userId: a.user.id, sessionId: session.id, noteId: "caption", rows, interview: true });
  assert.deepEqual(kept.map((item) => item.text), ["生日是六月十七号", "想去格陵兰，不是冰岛", "喜欢和 Mia 一起看老电影"]);
  assert.ok(kept.every((item) => item.visibility === "private" && item.ownerUserId === a.user.id && item.subjectUserId === a.user.id && item.aiAccessScope === "private"));
  assert.equal((await call(`/assistant/sessions/${session.id}`, a)).session.messages.at(-1).kind, "noted");
  await call(`/assistant/sessions/${session.id}`, b, undefined, 404);
  assert.equal((await call("/profile", b)).facts.length, 0);
  assert.deepEqual((await profileContext(store, b.user.id)).me, []);
  const shared = buildTogetherContext(await store.relationshipSnapshotForUser(b.user.id), relationshipId, { userId: b.user.id });
  assert.ok(!/格陵兰|六月十七|老电影/.test(JSON.stringify(shared)));
});

test("before any partner joins, Pinky still learns TA privately from chats and brought screenshots, and keeps it after pairing", async () => {
  // Reply coach (founder 11-08): Pinky works alone and gets to know her as it is used; nothing waits for an invitation.
  const register = async (name) => {
    const response = await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, email: `profile-${++counter}@example.com`, password: "correct horse battery" }) });
    assert.equal(response.status, 201); return { ...(await response.json()), cookie: response.headers.get("set-cookie").split(";")[0] };
  };
  const solo = await register("Zhou");
  const session = await privateChat(solo.user.id, [["s1", "user", "她最讨厌我迟到，我自己不吃辣"]]);
  const kept = await scanPrivateProfile({ store, mediator: fakeModel(() => [
    fact({ messageId: "s1", quote: "她最讨厌我迟到", subject: "B", category: "dislikes", fact: "讨厌迟到" }),
    fact({ messageId: "s1", quote: "我自己不吃辣", subject: "A", fact: "不吃辣" }),
  ]), userId: solo.user.id, sessionId: session.id });
  assert.deepEqual(kept.map((item) => [item.text, item.subjectUserId]), [["讨厌迟到", pendingPartner(solo.user.id)], ["不吃辣", solo.user.id]]);
  assert.ok(kept.every((item) => item.visibility === "private" && item.ownerUserId === solo.user.id && item.relationshipId === null));
  assert.match((await store.getRelationshipRecordForUser("privateAgentThreads", session.id, solo.user.id)).messages.at(-1).text, /^已记进「关于我们」：TA 讨厌迟到；你不吃辣$/);

  // A brought chat: TA's own words are the evidence about TA; invented quotes are dropped.
  const brought = await scanBroughtChat({ store, mediator: fakeModel((input, instructions) => {
    assert.match(instructions, /brought to Pinky privately/);
    assert.deepEqual(input.messages.map((item) => item.from), ["B", "A", "B"], "both of them count; other people do not");
    return [fact({ messageId: "imp:2", quote: "我一直想养一只柯基", subject: "B", category: "wishes", fact: "想养一只柯基" }), fact({ messageId: "imp:0", quote: "she loves cats", subject: "B", fact: "loves cats" })];
  }), userId: solo.user.id, sessionId: session.id, sourceId: "imp", messages: [
    { role: "partner", text: "你又迟到了" }, { role: "me", text: "对不起，路上堵车" }, { role: "partner", text: "算了。周末陪我去看狗吧，我一直想养一只柯基" }, { role: "other", text: "群消息" },
  ] });
  assert.deepEqual(brought.map((item) => [item.text, item.subjectUserId]), [["想养一只柯基", pendingPartner(solo.user.id)]]);
  assert.deepEqual((await profileContext(store, solo.user.id)).partner.map((item) => item.fact).sort(), ["想养一只柯基", "讨厌迟到"]);
  assert.deepEqual((await call("/profile", solo)).facts.filter((item) => item.subject === "partner").map((item) => item.text).sort(), ["想养一只柯基", "讨厌迟到"]);

  // After pairing it still counts as being about TA, and TA never sees it.
  const partner = await register("Xia");
  const invitation = await call("/partner/invitations", solo, {}, 201);
  await call("/partner/accept", partner, { code: invitation.pairing.invitation.code });
  assert.deepEqual((await profileContext(store, solo.user.id)).partner.map((item) => item.fact).sort(), ["想养一只柯基", "讨厌迟到"]);
  const leaks = (value) => /迟到|柯基|不吃辣/.test(JSON.stringify(value));
  assert.ok(!leaks(await call("/profile", partner)) && !leaks(await profileContext(store, partner.user.id)));
});

test("facts from a private chat are kept for their owner alone, noted in the chat, corrected and never duplicated", async () => {
  const { a, b, relationshipId } = await pair();
  const session = await privateChat(a.user.id, [["m1", "user", "我不吃香菜，Mia 最怕别人催她，她一直想去冰岛看极光"], ["m2", "assistant", "记住啦"]]);
  const model = fakeModel(() => [
    fact({ messageId: "m1", quote: "我不吃香菜", subject: "A", fact: "不吃香菜" }),
    fact({ messageId: "m1", quote: "Mia 最怕别人催她", subject: "B", category: "dislikes", fact: "最怕别人催" }),
    fact({ messageId: "m1", quote: "她一直想去冰岛看极光", subject: "B", category: "wishes", fact: "想去冰岛看极光" }),
    // Invented words and Pinky's own lines never become facts.
    fact({ messageId: "m1", quote: "Mia loves sushi", subject: "B", fact: "loves sushi" }),
    fact({ messageId: "m2", quote: "记住啦", fact: "记住" }),
  ]);
  const kept = await scanPrivateProfile({ store, mediator: model, userId: a.user.id, sessionId: session.id });
  assert.deepEqual(kept.map((item) => item.text), ["不吃香菜", "最怕别人催", "想去冰岛看极光"]);
  assert.ok(kept.every((item) => item.visibility === "private" && item.ownerUserId === a.user.id && item.relationshipId === relationshipId && item.aiAccessScope === "private"));
  assert.deepEqual(model.seen[0].messages.filter((item) => item.isNew).map((item) => item.id), ["m1"], "only the owner's own lines are read as new");
  const after = await store.getRelationshipRecordForUser("privateAgentThreads", session.id, a.user.id);
  assert.equal(after.version, session.version, "the member's next turn never conflicts with this");
  assert.equal(after.messages.at(-1).kind, "noted");
  assert.match(after.messages.at(-1).text, /^已记进「关于我们」：你不吃香菜；Mia 最怕别人催；Mia 想去冰岛看极光$/);

  assert.equal((await call(`/assistant/sessions/${session.id}`, a)).session.messages.at(-1).kind, "noted", "the App can show it as a quiet line");
  const mine = (await call("/profile", a)).facts;
  assert.deepEqual(mine.map((item) => [item.subject, item.category, item.text, item.source]).sort(), [["me", "food", "不吃香菜", "mine"], ["partner", "dislikes", "最怕别人催", "mine"], ["partner", "wishes", "想去冰岛看极光", "mine"]]);
  // Mia never sees what Ziwei noted about her, through the profile, memories or Us.
  const leaks = (value) => /香菜|催|冰岛/.test(JSON.stringify(value));
  assert.ok(!leaks(await call("/profile", b)) && !leaks(await call("/memories", b)) && !leaks(await profileContext(store, b.user.id)));
  assert.ok(!leaks(buildTogetherContext(await store.relationshipSnapshotForUser(b.user.id), relationshipId, { userId: b.user.id })));
  // Facts stay out of the older "What Pinky remembers" list.
  assert.equal((await call("/memories", a)).memories.length, 0);
  // Pinky uses them in Ziwei's own conversations.
  const known = await profileContext(store, a.user.id);
  assert.deepEqual(known.me.map((item) => item.fact), ["不吃香菜"]);
  assert.deepEqual(known.partner.map((item) => item.fact).sort(), ["想去冰岛看极光", "最怕别人催"]);

  // Later lines: a change replaces the old fact, a repeat adds nothing.
  await store.updateRelationshipRecordForUser("privateAgentThreads", session.id, a.user.id, (draft) => { draft.messages.push({ id: "m3", role: "user", text: "其实我现在开始吃香菜了。Mia 真的很怕别人催", createdAt: new Date().toISOString() }); });
  const cilantro = kept[0];
  const again = fakeModel((input) => {
    assert.ok(input.known.some((item) => item.id === cilantro.id && item.subject === "A" && item.fact === "不吃香菜"), "the model sees what is already known");
    return [fact({ messageId: "m3", quote: "其实我现在开始吃香菜了", fact: "现在吃香菜了", replaces: cilantro.id }), fact({ messageId: "m3", quote: "Mia 真的很怕别人催", subject: "B", category: "dislikes", fact: "最怕别人催" })];
  });
  const changed = await scanPrivateProfile({ store, mediator: again, userId: a.user.id, sessionId: session.id });
  assert.deepEqual(changed.map((item) => [item.id, item.text]), [[cilantro.id, "现在吃香菜了"]]);
  assert.equal((await call("/profile", a)).facts.length, 3);
});

test("a line about yourself can be shared with the exact words; only its sharer takes it back", async () => {
  const { a, b, relationshipId } = await pair();
  const session = await privateChat(a.user.id, [["m1", "user", "我穿 M 码，我最近在学钢琴"]]);
  const [size, piano] = await scanPrivateProfile({ store, mediator: fakeModel(() => [fact({ messageId: "m1", quote: "我穿 M 码", category: "wishes", fact: "穿 M 码" }), fact({ messageId: "m1", quote: "我最近在学钢琴", category: "likes", fact: "在学钢琴" })]), userId: a.user.id, sessionId: session.id });
  const preview = await call(`/profile/${size.id}/share-preview`, a);
  assert.equal(preview.text, "穿 M 码");
  await call(`/profile/${size.id}/share`, a, { confirm: true, digest: "wrong", expectedVersion: size.version }, 409);
  const { fact: shared } = await call(`/profile/${size.id}/share`, a, { confirm: true, digest: preview.digest, expectedVersion: size.version }, 201);
  assert.equal(shared.source, "i_shared");
  const seen = (await call("/profile", b)).facts;
  assert.deepEqual(seen.map((item) => [item.subject, item.text, item.source, item.quote]), [["partner", "穿 M 码", "partner_shared", null]], "Mia sees the shared line only, without the private quote");
  assert.ok(!JSON.stringify(seen).includes("钢琴"));
  assert.deepEqual((await profileContext(store, b.user.id)).partner.map((item) => item.fact), ["穿 M 码"]);
  const us = buildTogetherContext(await store.relationshipSnapshotForUser(b.user.id), relationshipId, { userId: b.user.id });
  assert.deepEqual(us.sharedProfile.map((item) => item.fact), ["穿 M 码"], "the shared Pinky knows it too");
  // Mia can neither edit nor remove what Ziwei shared; Ziwei cannot share something about Mia.
  await call(`/profile/${shared.id}`, b, { text: "穿 L 码", expectedVersion: shared.version }, 403, "PATCH");
  await call(`/profile/${shared.id}`, b, { expectedVersion: shared.version }, 403, "DELETE");
  await call(`/profile/${piano.id}`, a, { text: "在学钢琴和吉他", expectedVersion: piano.version }, 200, "PATCH");
  // Ziwei takes it back by removing the shared line.
  await call(`/profile/${shared.id}`, a, { expectedVersion: shared.version }, 204, "DELETE");
  assert.equal((await call("/profile", b)).facts.length, 0);
  assert.deepEqual((await call("/profile", a)).facts.map((item) => item.text).sort(), ["在学钢琴和吉他", "穿 M 码"]);
});

test("what they say together in Us belongs to both, about the right person", async () => {
  const { a, b, relationshipId } = await pair();
  const say = (user, text) => call("/together/messages", user, { text, itemId: crypto.randomUUID(), language: "zh" }, 201);
  await say(a, "我对花生过敏，别给我带花生的东西");
  await say(b, "我们吵架以后都需要先安静十分钟");
  const lines = (await store.getRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, a.user.id)).messages.filter((item) => item.role === "member");
  const model = fakeModel((input) => {
    assert.deepEqual(input.messages.map((item) => item.from), ["A", "B"]);
    return [fact({ messageId: lines[0].id, quote: "我对花生过敏", subject: "A", fact: "对花生过敏" }), fact({ messageId: lines[1].id, quote: "我们吵架以后都需要先安静十分钟", subject: "both", category: "traits", fact: "吵架后需要先安静十分钟" })];
  });
  const kept = await scanTogetherProfile({ store, mediator: model, relationshipId, userId: b.user.id });
  assert.equal(kept.length, 2);
  for (const user of [a, b]) {
    const facts = (await call("/profile", user)).facts;
    assert.deepEqual(facts.map((item) => [item.text, item.source]).sort(), [["吵架后需要先安静十分钟", "together"], ["对花生过敏", "together"]]);
    assert.equal(facts.find((item) => item.text === "对花生过敏").subject, user === a ? "me" : "partner");
    assert.equal(facts.find((item) => item.text === "吵架后需要先安静十分钟").subject, "us");
  }
  // Either of them may remove what was said together; it goes for both.
  const peanut = (await call("/profile", b)).facts.find((item) => item.text === "对花生过敏");
  await call(`/profile/${peanut.id}`, b, { expectedVersion: peanut.version }, 204, "DELETE");
  assert.ok(!(await call("/profile", a)).facts.some((item) => item.text === "对花生过敏"));
});
