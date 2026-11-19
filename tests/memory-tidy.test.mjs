import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { personFor, personSubject } from "../server/people.mjs";
import { profileContext } from "../server/profile.mjs";
import { searchMemory } from "../server/memory-search.mjs";
import { tidyMemory } from "../server/memory-tidy.mjs";
import { createApiApp } from "../server/app.mjs";

// 后台整理 (memory plan, founder 11-09: "接着做整理……反正你把所有的记忆层都完成"): duplicates fold into one, an older
// note a newer one contradicts is marked no longer true and kept, and nothing shared is ever rewritten.
async function setup(t) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "tidy-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const store = await createFileStore(join(directory, "store.json"));
  const user = { id: randomUUID(), name: "Alex" };
  await store.createUser({ ...user, email: `${user.id}@example.invalid`, passwordHash: "test", createdAt: new Date().toISOString() });
  const alex = await store.transaction(`user:${user.id}`, (tx) => personFor(tx, user.id, "Alex Chen"));
  const note = async (text, saidAt, extra = {}) => { const record = createRelationshipRecord({ relationshipId: null, userId: user.id, ownerUserId: user.id, visibility: "private", aiAccessScope: "private", status: "active", kind: "profile", subjectUserId: personSubject(alex.id), category: "likes", text, evidence: { saidAt }, ...extra }); await store.createRelationshipRecord("memories", record); return record; };
  return { store, user, alex, note };
}

test("duplicates fold into one, an outdated note is kept as what used to be true, and both are found as such", async (t) => {
  const { store, user, alex, note } = await setup(t);
  const coffee = [await note("喜欢喝咖啡", "2025-01-01T00:00:00Z"), await note("爱喝咖啡", "2025-02-01T00:00:00Z"), await note("每天都要喝咖啡", "2025-03-01T00:00:00Z")];
  const shanghai = await note("住在上海", "2025-01-05T00:00:00Z", { category: "other" });
  const beijing = await note("搬到北京了", "2026-10-20T00:00:00Z", { category: "other" });
  for (const thing of ["爬山", "猫", "爵士乐", "日料"]) await note(`喜欢${thing}`, "2025-04-01T00:00:00Z");
  let calls = 0, seen = null;
  const mediator = { structured: async ({ input }) => { calls += 1; seen = JSON.parse(input); return { merges: [{ keep: coffee[2].id, drop: [coffee[0].id, coffee[1].id], text: "每天都要喝咖啡" }], outdated: [{ old: shanghai.id, by: beijing.id }, { old: beijing.id, by: shanghai.id }] }; } };
  assert.equal(await tidyMemory({ store, mediator, userId: user.id }), 3);
  assert.equal(seen.notes.length, 9);

  const records = await store.listRelationshipRecordsForUser("memories", user.id);
  const of = (id) => records.find((record) => record.id === id);
  assert.deepEqual([of(coffee[0].id).status, of(coffee[0].id).mergedInto], ["archived", coffee[2].id], "folded, not deleted");
  assert.deepEqual([of(shanghai.id).status, of(shanghai.id).supersededBy, of(shanghai.id).invalidAt], ["archived", beijing.id, "2026-10-20T00:00:00Z"]);
  assert.equal(of(beijing.id).status, "active", "a newer note is never marked outdated by an older one");
  assert.deepEqual(of(beijing.id).past, [{ text: "住在上海", saidAt: "2025-01-05T00:00:00Z", until: "2026-10-20T00:00:00Z" }]);

  const known = (await profileContext(store, user.id)).people.find((person) => person.id === alex.id).facts.map((item) => item.fact);
  assert.ok(known.includes("搬到北京了") && !known.includes("住在上海") && known.filter((fact) => fact.includes("咖啡")).length === 1);
  assert.match(await searchMemory({ store, userId: user.id, query: "住在上海" }), /以前是这样，2026-10-20 起变成：搬到北京了/);

  // At most once a day, and only with something new.
  assert.equal(await tidyMemory({ store, mediator, userId: user.id }), 0);
  assert.equal(calls, 1);
  assert.equal(await tidyMemory({ store, mediator, userId: user.id, now: Date.now() + 2 * 86400000 }), 0, "nothing new since");
  assert.equal(calls, 1);
});

test("notes shared with a partner are never part of a tidy, and too few notes cost no call", async (t) => {
  const directory = await mkdtemp(join(resolve("work"), "tidy-pair-"));
  const store = await createFileStore(join(directory, "store.json"));
  const server = createApiApp({ store, mediator: { aiReady: false, model: "test" } }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  const request = async (path, { method = "GET", body, cookie } = {}) => { const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] }; };
  const register = async (name) => (await request("/api/auth/register", { method: "POST", body: { name, email: `${name}-${Date.now()}@example.test`, password: "synthetic-test-password-26" } }));
  const a = await register("tidy-a"), b = await register("tidy-b");
  const invite = await request("/api/partner/invitations", { method: "POST", body: {}, cookie: a.cookie });
  await request("/api/partner/accept", { method: "POST", body: { code: invite.body.pairing.invitation.code }, cookie: b.cookie });
  const me = (await request("/api/auth/me", { cookie: a.cookie })).body.user.id;
  const pairing = (await store.getRelationshipContext(me)).relationship;
  const note = (text, extra = {}) => store.createRelationshipRecord("memories", createRelationshipRecord({ relationshipId: pairing.id, userId: me, ownerUserId: me, visibility: "private", aiAccessScope: "private", status: "active", kind: "profile", subjectUserId: me, category: "likes", text, evidence: { saidAt: "2025-04-01T00:00:00Z" }, ...extra }));
  for (const thing of ["爬山", "猫", "爵士乐"]) await note(`喜欢${thing}`);
  let calls = 0, seen = null;
  const mediator = { structured: async ({ input }) => { calls += 1; seen = JSON.parse(input); return { merges: [], outdated: [] }; } };
  assert.equal(await tidyMemory({ store, mediator, userId: me }), 0);
  assert.equal(calls, 0, "fewer than eight notes: nothing to tidy");
  for (const thing of ["日料", "跑步", "看展", "乐高", "咖啡"]) await note(`喜欢${thing}`);
  await note("我们一起养了一只猫", { visibility: "shared", aiAccessScope: "joint", subjectUserId: null });
  await tidyMemory({ store, mediator, userId: me, force: true });
  assert.equal(calls, 1);
  assert.ok(!seen.notes.some((item) => item.text.includes("一起养")), "shared notes are the couple's, not tidied");
});
