import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { createPeopleRouter, listPeople, nameKey, personFor, personSubject } from "../server/people.mjs";
import { createProfileRouter, profileContext, scanBroughtChat } from "../server/profile.mjs";

// Founder 11-09: someone single may be getting to know several people; Pinky must tell them apart, keep each one's notes
// apart, and never show any of it to a partner they later pair with.
async function setup(t, { paired = false } = {}) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "people-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const store = await createFileStore(join(directory, "store.json"));
  const users = [{ id: randomUUID(), name: "Alex" }, { id: randomUUID(), name: "Blair" }];
  for (const user of users) await store.createUser({ ...user, email: `${user.id}@example.invalid`, passwordHash: "test", createdAt: new Date().toISOString() });
  if (paired) {
    const relationshipId = randomUUID();
    await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: users[0].id, role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: users[0].id, expiresAt: "2099-01-01T00:00:00.000Z" } });
    await store.acceptInvitation(relationshipId, users[1].id, new Date().toISOString());
  }
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { const user = users.find((item) => item.id === req.headers["x-user"]); if (user) req.auth = { user }; next(); });
  app.use("/api", createPeopleRouter({ store }));
  app.use("/api", createProfileRouter({ store }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const request = async (path, method = "GET", body, userId = users[0].id) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const session = createRelationshipRecord({ relationshipId: null, userId: users[0].id, visibility: "private", aiAccessScope: "private", intentType: "assistant", language: "en", timezone: "UTC", messages: [] });
  await store.createRelationshipRecord("privateAgentThreads", session);
  const add = (name) => store.transaction(`user:${users[0].id}`, (tx) => personFor(tx, users[0].id, name));
  return { store, users, request, session, add };
}

test("a chat's name finds the person it belongs to, however the title is written, and placeholders make nobody", async (t) => {
  const { store, users, add } = await setup(t);
  const lily = await add("Lily 🌸");
  assert.equal((await add("lily")).id, lily.id, "case and emoji do not make a second Lily");
  assert.equal((await add("LILY ")).id, lily.id);
  const jie = await add("阿杰");
  assert.notEqual(jie.id, lily.id);
  assert.equal(await add("TA"), null, "a chat with no name shown is nobody's");
  assert.equal(await add("对方"), null);
  assert.deepEqual((await listPeople(store, users[0].id)).map((person) => person.name).sort(), ["Lily 🌸", "阿杰"].sort());
  assert.equal(nameKey("Lily 🌸"), "lily");
});

test("what a chat with one person shows is kept on that person's card, never on another's or the partner's", async (t) => {
  const { store, users, session, add } = await setup(t, { paired: true });
  const lily = await add("Lily"), jie = await add("阿杰");
  const seen = [];
  const mediator = { structured: async ({ input }) => { seen.push(JSON.parse(input)); return { facts: [
    { messageId: "imp:0", quote: "I love cats", subject: "B", person: "", category: "likes", fact: "loves cats", replaces: "" },
    { messageId: "imp:1", quote: "I hate being late", subject: "A", person: "", category: "dislikes", fact: "hates being late", replaces: "" },
  ] }; } };
  const messages = [{ role: "partner", text: "I love cats" }, { role: "me", text: "I hate being late" }];
  const changed = await scanBroughtChat({ store, mediator, userId: users[0].id, sessionId: session.id, sourceId: "imp", messages, personId: lily.id });
  assert.equal(changed.length, 2);
  const known = await profileContext(store, users[0].id);
  assert.deepEqual(known.people.find((person) => person.id === lily.id).facts.map((item) => item.fact), ["loves cats"]);
  assert.deepEqual(known.people.find((person) => person.id === jie.id).facts, []);
  assert.deepEqual(known.partner, [], "nothing about Lily becomes the partner's");
  assert.deepEqual(known.me.map((item) => item.fact), ["hates being late"]);
  const mixed = (await store.getRelationshipRecordForUser("privateAgentThreads", session.id, users[0].id)).messages.at(-1).text;
  assert.match(mixed, /^(Kept on Lily's card: loves cats\. Kept in About us: you: hates being late|已记进 Lily 的档案：loves cats。已记进「关于我们」：你 hates being late)$/, "a mixed note says where each part went");
  // The next chat, with 阿杰, is read without Lily's notes in view.
  await scanBroughtChat({ store, mediator: { structured: async ({ input }) => { seen.push(JSON.parse(input)); return { facts: [] }; } }, userId: users[0].id, sessionId: session.id, sourceId: "imp2", messages, personId: jie.id });
  assert.ok(!JSON.stringify(seen.at(-1).known).includes("loves cats"), "another person's notes are never in view");
  const noted = (await store.getRelationshipRecordForUser("privateAgentThreads", session.id, users[0].id)).messages.find((message) => message.kind === "noted");
  assert.match(noted.text, /About us|Lily/);
});

test("what happened between the member and one person goes on that person's card as history", async (t) => {
  // 11-09 on the founder's phone: a first coffee and a cooled reply came back as "both" and were dropped, so cards stayed empty.
  const { store, users, session, add, request } = await setup(t, { paired: true });
  const lily = await add("Lily");
  const mediator = { structured: async () => ({ facts: [
    { messageId: "imp:0", quote: "昨天的拿铁真的好好喝", subject: "both", person: "", category: "history", fact: "2026-11-08 第一次一起喝咖啡，聊了很久", replaces: "" },
    { messageId: "imp:1", quote: "我一直帮你挑不辣的", subject: "A", person: "", category: "history", fact: "2026-11-09 点菜时一直帮她挑不辣的", replaces: "" },
    { messageId: "imp:1", quote: "我一直帮你挑不辣的", subject: "A", person: "", category: "likes", fact: "会照顾别人口味", replaces: "" }] }) };
  const messages = [{ role: "partner", text: "昨天的拿铁真的好好喝" }, { role: "me", text: "我一直帮你挑不辣的" }];
  const kept = await scanBroughtChat({ store, mediator, userId: users[0].id, sessionId: session.id, sourceId: "imp", messages, personId: lily.id });
  assert.equal(kept.length, 3);
  const card = (await request(`/people/${lily.id}`)).body;
  assert.deepEqual(card.history.map((item) => item.text).sort(), ["2026-11-08 第一次一起喝咖啡，聊了很久", "2026-11-09 点菜时一直帮她挑不辣的"].sort(), "what the member did with them is theirs too");
  const known = await profileContext(store, users[0].id);
  assert.deepEqual(known.history, [], "it never becomes the couple's history");
  assert.deepEqual(known.me.map((item) => item.fact), ["会照顾别人口味"], "the member's own traits stay theirs");
});

test("a partner sees none of the people or their notes, through any route", async (t) => {
  const { store, users, session, add, request } = await setup(t, { paired: true });
  const lily = await add("Lily");
  await scanBroughtChat({ store, mediator: { structured: async () => ({ facts: [{ messageId: "imp:0", quote: "I love cats", subject: "B", person: "", category: "likes", fact: "loves cats", replaces: "" }] }) }, userId: users[0].id, sessionId: session.id, sourceId: "imp", messages: [{ role: "partner", text: "I love cats" }], personId: lily.id });
  assert.deepEqual((await request("/people")).body.people.map((person) => [person.name, person.facts]), [["Lily", 1]]);
  assert.deepEqual((await request("/people", "GET", null, users[1].id)).body.people, [], "the partner has no people of Alex's");
  assert.equal((await request(`/people/${lily.id}`, "PATCH", { name: "Lil" }, users[1].id)).status, 404);
  assert.ok(!JSON.stringify((await request("/profile", "GET", null, users[1].id)).body).includes("loves cats"));
  assert.ok(!JSON.stringify((await request("/profile")).body).includes("loves cats"), "notes about a person stay off About us");
  const partnerView = await profileContext(store, users[1].id);
  assert.ok(!JSON.stringify(partnerView).includes("Lily") && !JSON.stringify(partnerView).includes("loves cats"));
  assert.ok(!(await store.listRelationshipRecordsForUser("memories", users[1].id)).some((record) => record.kind === "person" || record.subjectUserId === personSubject(lily.id)), "not even the store hands them over");
});

test("two cards that are one person merge, rename and archive without losing notes", async (t) => {
  const { store, users, session, add, request } = await setup(t);
  const lily = await add("Lily"), lil = await add("小莉");
  await scanBroughtChat({ store, mediator: { structured: async () => ({ facts: [{ messageId: "imp:0", quote: "I love cats", subject: "B", person: "", category: "likes", fact: "loves cats", replaces: "" }] }) }, userId: users[0].id, sessionId: session.id, sourceId: "imp", messages: [{ role: "partner", text: "I love cats" }], personId: lil.id });
  const merged = (await request(`/people/${lil.id}/merge`, "POST", { into: lily.id })).body.person;
  assert.deepEqual(merged.aliases.sort(), ["Lily", "小莉"].sort());
  assert.equal((await add("小莉")).id, lily.id, "the old name now finds the kept card");
  assert.deepEqual((await profileContext(store, users[0].id)).people.map((person) => [person.name, person.facts.map((item) => item.fact)]), [["Lily", ["loves cats"]]]);
  const card = (await request(`/people/${lily.id}`)).body;
  assert.deepEqual(card.facts.map((item) => item.text), ["loves cats"], "the card shows what Pinky keeps about them");
  assert.equal((await request(`/people/${lily.id}`, "GET", null, users[1].id)).status, 404, "nobody else opens it");
  assert.equal((await request(`/people/${lily.id}`, "PATCH", { name: "Lily Chen" })).body.person.name, "Lily Chen");
  assert.equal((await request(`/people/${lily.id}/archive`, "POST", {})).body.person.archived, true);
  assert.deepEqual((await request("/people")).body.people, []);
  assert.equal((await add("Lily")).id, lily.id, "writing again brings an archived person back");
  assert.equal((await request("/people")).body.people.length, 1);
});

test("people named in the member's own words get their own cards, and each keeps only their own notes", async (t) => {
  // 11-09 use-case test: "Lily 不吃辣，海鲜过敏" and "阿杰最爱火锅和川菜" both landed on one TA, so 阿杰 got Lily's allergies.
  const { scanPrivateProfile } = await import("../server/profile.mjs");
  const { store, users, session } = await setup(t);
  const at = new Date().toISOString();
  await store.updateRelationshipRecordForUser("privateAgentThreads", session.id, users[0].id, (draft) => { draft.messages = [
    { id: "m1", role: "user", text: "Lily 不吃辣，海鲜过敏，记一下", createdAt: at },
    { id: "m2", role: "user", text: "阿杰最爱吃火锅和川菜", createdAt: at }]; draft.version += 1; });
  const mediator = { structured: async ({ instructions }) => { assert.match(instructions, /person: in A's private chat/); return { facts: [
    { messageId: "m1", quote: "Lily 不吃辣", subject: "B", person: "Lily", category: "food", fact: "不吃辣", replaces: "" },
    { messageId: "m1", quote: "海鲜过敏", subject: "B", person: "Lily", category: "food", fact: "海鲜过敏", replaces: "" },
    { messageId: "m2", quote: "阿杰最爱吃火锅和川菜", subject: "B", person: "阿杰", category: "food", fact: "最爱火锅和川菜", replaces: "" }] }; } };
  await scanPrivateProfile({ store, mediator, userId: users[0].id, sessionId: session.id });
  const known = await profileContext(store, users[0].id);
  const of = (name) => known.people.find((person) => person.name === name)?.facts.map((item) => item.fact).sort();
  assert.deepEqual(of("Lily"), ["不吃辣", "海鲜过敏"].sort());
  assert.deepEqual(of("阿杰"), ["最爱火锅和川菜"]);
  assert.deepEqual(known.partner, [], "nothing lands on an unnamed TA");
});
