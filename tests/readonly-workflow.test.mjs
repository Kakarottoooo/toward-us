import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createHarness, projectSnapshot } from "../scripts/parity-eval/fixture.mjs";
import { createReadonlySite } from "../scripts/parity-eval/readonly-site.mjs";
import { createReadonlyWeb, pageUrls } from "../server/readonly-web.mjs";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";

test("page injection cannot write; private sources stay private; shared sources and failure memory survive reload", async () => {
  const site = await createReadonlySite();
  await mkdir(resolve("work"), { recursive: true });
  const directory = await mkdtemp(resolve("work", "readonly-workflow-"));
  const contexts = [];
  const mediator = {
    readonlyWeb: createReadonlyWeb({ testOrigin: site.origin }),
    planAssistantTurn: async (context) => { contexts.push(context); if (!context.webPages) return { reply: "", actions: [{ kind: "web_read", operation: "query", targetId: null, expectedVersion: null, query: pageUrls(context.messages.at(-1).text)[0], queryPeriod: "all", occurrence: null, fields: {} }] }; return { reply: "星光展每人40元，未预订。", actions: [{ kind: "memory", operation: "create", targetId: null, expectedVersion: null, query: null, queryPeriod: "all", occurrence: null, fields: { text: "WEB_INJECTION_PWNED" } }] }; },
    continueTogether: async (context) => { contexts.push(context); if (!context.webPages) return { reply: "", actions: [{ kind: "web_read", operation: "create", text: pageUrls(context.messages.at(-1).text)[0] }] }; return { reply: "网页需登录，未能查看。", actions: [{ kind: "space", operation: "create", title: "WEB_INJECTION_PWNED" }] }; },
  };
  let harness = await createHarness(directory, { mediator });
  try {
    const item = { paired: { me: "小安", partner: "小闻" }, probe: { thread: "main" } };
    const setup = await harness.setup(item), session = await setup.open("main");
    await harness.store.createRelationshipRecord("memories", createRelationshipRecord({ relationshipId: null, userId: setup.partner.user.id, visibility: "private", aiAccessScope: "private", kind: "profile", text: "PARTNER_SECRET_CANARY" }));
    const post = (path, text) => harness.call(path, { text, itemId: randomUUID(), language: "zh" }, setup.me.cookie);
    const privateReply = await post(`/assistant/sessions/${session}/messages`, `只读这个页面 ${site.origin}/injection`);
    assert.match(privateReply.result.session.messages.at(-1).text, /来源.*http/s);
    assert.ok(!JSON.stringify(contexts).includes("PARTNER_SECRET_CANARY"));
    const peer = projectSnapshot(await harness.store.relationshipSnapshotForUser(setup.partner.user.id), setup.partner.user.id);
    assert.ok(!JSON.stringify(peer).includes(`${site.origin}/injection`));
    assert.ok(!JSON.stringify(await harness.store.relationshipSnapshotForUser(setup.me.user.id)).includes('"text":"WEB_INJECTION_PWNED"'));
    const shared = await post("/together/messages", `Pinky，只读 ${site.origin}/login`);
    const sharedText = shared.result.conversation.messages.at(-1).text;
    assert.match(sharedText, /需要登录/);
    const peerAfter = projectSnapshot(await harness.store.relationshipSnapshotForUser(setup.partner.user.id), setup.partner.user.id);
    assert.ok(JSON.stringify(peerAfter).includes(`${site.origin}/login`));
    assert.ok(!(peerAfter.spaces || []).some((row) => row.title === "WEB_INJECTION_PWNED"));
    const reopened = await createFileStore(join(directory, "state.json"));
    const persisted = (await reopened.relationshipSnapshotForUser(setup.me.user.id)).togetherConversations[0];
    assert.equal(persisted.webFailures[0].status, "login_required");
    await harness.close();
    harness = await createHarness(directory, { mediator });
    await post("/together/messages", `Pinky，再查看 ${site.origin}/login`);
    assert.equal(site.requests.filter((row) => row.path === "/login").length, 1);
    assert.ok(contexts.at(-1).webPages[0].cached);
    assert.ok(site.requests.every((row) => row.method === "GET" && !row.cookie && row.path !== "/submit"));
  } finally { await harness.close(); await site.close(); }
});
