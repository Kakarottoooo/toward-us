import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApiApp } from "../server/app.mjs";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { buildTogetherContext } from "../server/together-domain.mjs";
import { privacyExport } from "../server/privacy-router.mjs";
import { promiseToMention, scanPrivate, scanTogether, verifyFindings } from "../server/promises.mjs";

// "还欠着什么" (11-03): promises noticed in conversation, kept under the privacy and two-approval rules.
let server, base, directory, store, counter = 0;
before(async () => {
  await mkdir(join(process.cwd(), "work"), { recursive: true });
  directory = await mkdtemp(join(process.cwd(), "work", "promises-"));
  store = await createFileStore(join(directory, "state.json"));
  const previousKey = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "";
  // The App's own mediator has no model: background scans stay idle, and each test drives a fake one directly.
  server = createApiApp({ store, mediator: { aiReady: false, model: "test" } }).listen(0, "127.0.0.1");
  if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); if (directory) await rm(directory, { recursive: true, force: true }); });

async function call(path, user, body, status = 200) {
  const response = await fetch(`${base}/api${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", cookie: user.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.status, status, `${path}: ${JSON.stringify(result)}`);
  return result;
}
async function pair() {
  const register = async (name) => {
    const response = await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, email: `promises-${++counter}@example.com`, password: "correct horse battery" }) });
    assert.equal(response.status, 201); return { ...(await response.json()), cookie: response.headers.get("set-cookie").split(";")[0] };
  };
  const a = await register("Alex"), b = await register("Blair");
  const invitation = await call("/partner/invitations", a, {}, 201);
  await call("/partner/accept", b, { code: invitation.pairing.invitation.code });
  const context = await store.getRelationshipContext(a.user.id);
  return { a, b, relationshipId: context.relationship.id };
}
const say = (user, text) => call("/together/messages", user, { text, itemId: crypto.randomUUID(), language: "en" }, 201);
const conversation = (relationshipId, userId) => store.getRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, userId);
/** A stand-in model: records what it was shown and answers with whatever the test scripts. */
function fakeModel(answer) {
  const seen = [];
  return { seen, structured: async ({ name, input }) => { assert.equal(name, "couple_promises"); const parsed = JSON.parse(input); seen.push(parsed); return { promises: answer(parsed) }; } };
}

test("promises in Us are kept only with a real quote from a partner, once, and only new lines are read", async () => {
  const { a, b, relationshipId } = await pair();
  await say(a, "This weekend I'll come with you to see the apartment, promise.");
  await say(b, "Deal. And I'll book the dinner for Friday.");
  const lines = (await conversation(relationshipId, a.user.id)).messages;
  const model = fakeModel(() => [
    { messageId: lines[0].id, quote: "This weekend I'll come with you to see the apartment", by: "A", what: "come with Blair to see the apartment", when: "this weekend" },
    { messageId: lines[1].id, quote: "I'll book the dinner", by: "B", what: "book the dinner", when: "Friday" },
    // Invented words, an unknown line and a duplicate never become promises.
    { messageId: lines[1].id, quote: "I'll pay for the trip", by: "B", what: "pay for the trip", when: "" },
    { messageId: "made-up", quote: "I'll book the dinner", by: "B", what: "book the dinner", when: "" },
    { messageId: lines[1].id, quote: "I'll book the dinner", by: "B", what: "Book the dinner.", when: "" },
  ]);
  const created = await scanTogether({ store, mediator: model, relationshipId, userId: a.user.id });
  assert.deepEqual(created.map((item) => item.description).sort(), ["book the dinner", "come with Blair to see the apartment"]);
  assert.ok(created.every((item) => item.visibility === "shared" && item.status === "noticed" && item.agreementId === null && item.origin === "conversation"));
  const dinner = created.find((item) => item.description === "book the dinner");
  assert.equal(dinner.ownerType, "member_b"); assert.equal(dinner.ownerUserId, b.user.id); assert.equal(dinner.evidence.quote, "I'll book the dinner"); assert.equal(dinner.whenText, "Friday");
  assert.deepEqual(model.seen[0].messages.map((item) => item.isNew), [true, true]);

  assert.deepEqual(await scanTogether({ store, mediator: model, relationshipId, userId: b.user.id }), [], "nothing new: no second look");
  assert.equal(model.seen.length, 1, "the model is not asked again without new lines");
  await say(a, "Also, I'll call your mom on Sunday.");
  const again = await scanTogether({ store, mediator: fakeModel((input) => input.messages.filter((item) => item.isNew).map((item) => ({ messageId: item.id, quote: "I'll call your mom", by: "A", what: "call Blair's mom", when: "Sunday" }))), relationshipId, userId: a.user.id });
  assert.equal(again.length, 1);
  const list = await call("/promises?language=en", b);
  assert.equal(list.promises.length, 3, "both see the shared ones");
  assert.equal(list.promises.find((item) => item.description === "book the dinner").by, "me");
  assert.equal(list.promises.find((item) => item.description === "call Blair's mom").by, "partner");
});

test("verification drops any quote that is not in the partner's own line", () => {
  const lines = [{ id: "1", role: "member", actorUserId: "a", text: "我周末陪你去看房，  说好了" }, { id: "2", role: "agent", actorUserId: null, text: "我会提醒你们" }];
  const kept = verifyFindings([
    { messageId: "1", quote: "「我周末陪你去看房」", by: "A", what: "陪 Blair 去看房", when: "周末" },
    { messageId: "1", quote: "我下周陪你去看房", by: "A", what: "陪 Blair 去看房", when: "" },
    { messageId: "2", quote: "我会提醒你们", by: "both", what: "提醒", when: "" },
  ], lines, (line) => line.role === "member");
  assert.deepEqual(kept.map((item) => item.quote), ["我周末陪你去看房"]);
});

test("a promise from a private chat stays its owner's through every API until they share the exact words", async () => {
  const { a, b, relationshipId } = await pair();
  const session = createRelationshipRecord({ relationshipId: null, userId: a.user.id, visibility: "private", aiAccessScope: "private", intentType: "assistant", language: "en", timezone: "UTC", messages: [
    { id: "m1", role: "user", text: "Honestly I told Blair I'd stop working late on Thursdays. SECRET_REASON: my boss.", createdAt: new Date().toISOString() },
    { id: "m2", role: "assistant", text: "That sounds like a kind thing to do.", createdAt: new Date().toISOString() },
  ] });
  await store.createRelationshipRecord("privateAgentThreads", session);
  const model = fakeModel(() => [{ messageId: "m1", quote: "I'd stop working late on Thursdays", by: "A", what: "stop working late on Thursdays", when: "Thursdays" }, { messageId: "m2", quote: "kind thing", by: "A", what: "be kind", when: "" }]);
  const [promise] = await scanPrivate({ store, mediator: model, userId: a.user.id, sessionId: session.id });
  assert.equal(promise.visibility, "private"); assert.equal(promise.ownerUserId, a.user.id); assert.equal(promise.relationshipId, relationshipId);
  assert.deepEqual(model.seen[0].messages.filter((item) => item.isNew).map((item) => item.id), ["m1"], "only the owner's own lines are read as new");
  assert.equal((await store.getRelationshipRecordForUser("privateAgentThreads", session.id, a.user.id)).version, session.version, "the session version never moves under the member's next turn");

  const mine = await call("/promises?language=en", a);
  assert.equal(mine.promises.length, 1); assert.equal(mine.promises[0].shared, false);
  assert.equal(mine.promises[0].shareText, "I promise you: stop working late on Thursdays (Thursdays)");
  // The partner cannot read, find or touch it anywhere.
  const leaks = (value) => JSON.stringify(value).includes("working late") || JSON.stringify(value).includes(promise.id);
  assert.deepEqual((await call("/promises", b)).promises, []);
  assert.equal((await call("/promises/nudge", b)).promise, null);
  assert.ok(!leaks(await call("/relationship/home", b)), "not in the partner's graph");
  for (const path of ["done", "later", "dismiss", "reopen", "agreement"]) await call(`/promises/${promise.id}/${path}`, b, { version: promise.version }, 404);
  await call(`/promises/${promise.id}/share`, b, { version: promise.version, confirm: true }, 404);
  for (const path of ["renegotiate", "review", "complete", "confirm"]) await call(`/commitments/${promise.id}/${path}`, b, { version: promise.version }, 404);
  assert.ok(!leaks(buildTogetherContext(await store.relationshipSnapshotForUser(b.user.id), relationshipId, { userId: b.user.id })), "not in what the shared Agent reads");
  assert.ok(!leaks(privacyExport(await store.getPrivacySnapshot(b.user.id), b.user)), "not in the partner's export");
  // Even the owner cannot push it into the agreement flow while it is private.
  await call(`/promises/${promise.id}/agreement`, a, { version: promise.version }, 409);

  await call(`/promises/${promise.id}/share`, a, { version: promise.version }, 400);
  const shared = await call(`/promises/${promise.id}/share`, a, { version: promise.version, confirm: true, text: "I promise you: no more late Thursdays", language: "en" });
  assert.equal(shared.promise.shared, true);
  const seen = await call("/promises?language=en", b);
  assert.equal(seen.promises.length, 1); assert.equal(seen.promises[0].by, "partner");
  assert.equal(seen.promises[0].quote, null, "the private quote stays behind");
  assert.ok(!JSON.stringify(seen).includes("SECRET_REASON") && !JSON.stringify(await call("/relationship/home", b)).includes("SECRET_REASON"));
  const relay = (await conversation(relationshipId, b.user.id)).messages.at(-1);
  assert.equal(relay.kind, "relay"); assert.equal(relay.actorUserId, a.user.id); assert.equal(relay.text, "I promise you: no more late Thursdays");
});

test("a shared promise becomes an agreement only when both approve the same version", async () => {
  const { a, b, relationshipId } = await pair();
  await say(b, "OK, I'll take out the trash every Monday.");
  const [line] = (await conversation(relationshipId, a.user.id)).messages;
  const [promise] = await scanTogether({ store, mediator: fakeModel(() => [{ messageId: line.id, quote: "I'll take out the trash every Monday", by: "B", what: "take out the trash", when: "every Monday" }]), relationshipId, userId: a.user.id });
  const { agreement } = await call(`/promises/${promise.id}/agreement`, a, { version: promise.version, language: "en" });
  assert.equal(agreement.status, "awaiting_approvals"); assert.deepEqual(agreement.terms, ["take out the trash (every Monday)"]);
  assert.equal((await conversation(relationshipId, a.user.id)).messages.at(-1).kind, "agreement_card");
  await call(`/promises/${promise.id}/agreement`, b, { version: promise.version + 1, language: "en" }, 409);

  const first = await call(`/together/agreements/${agreement.id}/approve`, a, { version: agreement.version });
  assert.equal(first.agreement.status, "awaiting_approvals", "one approval is not enough");
  // A change request makes a new version; the old approval no longer counts.
  const changed = await call(`/together/agreements/${agreement.id}/request-change`, b, { version: agreement.version, reason: "Tuesdays work better" });
  await call(`/together/agreements/${agreement.id}/approve`, a, { version: agreement.version }, 409);
  const revised = await call("/together/agreements/draft", a, { title: "Trash", summary: "Take out the trash", terms: ["take out the trash every Tuesday"], language: "en" }, 201);
  assert.equal(revised.agreement.id, agreement.id); assert.equal(revised.agreement.version, changed.agreement.version + 1);
  await call(`/together/agreements/${agreement.id}/approve`, a, { version: revised.agreement.version });
  const both = await call(`/together/agreements/${agreement.id}/approve`, b, { version: revised.agreement.version });
  assert.equal(both.agreement.status, "active");
  const listed = (await call("/promises", b)).promises.find((item) => item.id === promise.id);
  assert.deepEqual(listed.agreement, { id: agreement.id, version: revised.agreement.version, status: "active" });
  const done = await call(`/promises/${promise.id}/done`, b, { version: listed.version });
  assert.equal(done.promise.status, "kept");
});

test("Pinky brings up at most one shared promise per fresh start, and not again soon", async () => {
  const { a, b, relationshipId } = await pair();
  await say(a, "I'll fix the bike. I'll plan the trip.");
  const [line] = (await conversation(relationshipId, a.user.id)).messages;
  const made = await scanTogether({ store, mediator: fakeModel(() => [{ messageId: line.id, quote: "I'll fix the bike", by: "A", what: "fix the bike", when: "" }, { messageId: line.id, quote: "I'll plan the trip", by: "A", what: "plan the trip", when: "" }]), relationshipId, userId: a.user.id });
  assert.equal(made.length, 2);
  assert.equal(await promiseToMention(store, { userId: a.user.id, relationshipId }), null, "never right after it was said");
  const day = 86_400_000, start = Date.now() + 2 * day;
  const first = await promiseToMention(store, { userId: a.user.id, relationshipId, now: start });
  assert.ok(first);
  assert.equal((await promiseToMention(store, { userId: b.user.id, relationshipId, now: start + 60_000 })).id, first.id, "the same one through this fresh start");
  assert.equal(await promiseToMention(store, { userId: a.user.id, relationshipId, now: start + 14 * 3_600_000 }), null, "then quiet for most of a day");
  const second = await promiseToMention(store, { userId: a.user.id, relationshipId, now: start + day });
  assert.notEqual(second.id, first.id, "the next day, the other one");
  // "Not now" keeps it on the list but out of Pinky's mouth for a week.
  const current = (await call("/promises", a)).promises;
  for (const item of current) await call(`/promises/${item.id}/later`, a, { version: item.version });
  assert.ok((await call("/promises", a)).promises.every((item) => item.later));
  assert.equal(await promiseToMention(store, { userId: a.user.id, relationshipId, now: start + 5 * day }), null);
  // Removed ones leave the list and are never noticed again from the same words.
  const [gone] = (await call("/promises", a)).promises;
  await call(`/promises/${gone.id}/dismiss`, a, { version: gone.version });
  assert.equal((await call("/promises", a)).promises.length, 1);
});
