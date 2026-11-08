import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createMembershipRouter } from "../server/membership.mjs";
import { createBetaRouter } from "../server/beta.mjs";
import { recordUsage } from "../server/usage.mjs";

// 内测 (founder 11-06): invite codes give one couple 90 days of membership; only the founder makes codes and sees the board.
async function setup(t) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "beta-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = { founder: randomUUID(), a: randomUUID(), b: randomUUID(), c: randomUUID(), d: randomUUID() };
  for (const [name, id] of Object.entries(ids)) await store.createUser({ id, email: `${name}@example.invalid`, name, passwordHash: "test", createdAt: new Date().toISOString() });
  for (const [x, y] of [[ids.a, ids.b], [ids.c, ids.d]]) {
    const relationshipId = randomUUID();
    await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: x, role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: x, expiresAt: new Date(Date.now() + 86400000).toISOString() } });
    await store.acceptInvitation(relationshipId, y, new Date().toISOString());
  }
  const membership = createMembershipRouter({ store, env: {} });
  const beta = createBetaRouter({ store, grant: membership.grant, env: { FOUNDER_EMAILS: " Founder@example.invalid , other@x.y" } });
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", membership.router); app.use("/api", beta.router);
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  const request = async (path, method = "GET", body, userId = ids.founder) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  return { ids, request, store };
}

test("only the founder makes codes and sees the board", async (t) => {
  const { ids, request } = await setup(t);
  assert.equal((await request("/founder/beta", "GET", null, ids.a)).status, 404);
  assert.equal((await request("/founder/beta/codes", "POST", { count: 1 }, ids.a)).status, 404);
  const made = await request("/founder/beta/codes", "POST", { count: 2, note: "小王和女朋友" });
  assert.equal(made.status, 201); assert.equal(made.body.codes.length, 2); assert.match(made.body.codes[0].code, /^PINKY-[A-Z2-9]{6}$/);
  const board = await request("/founder/beta");
  assert.equal(board.status, 200); assert.equal(board.body.codes.length, 2); assert.equal(board.body.couples.length, 2);
  assert.equal(JSON.stringify(board.body).includes("@example.invalid"), false, "the board never shows emails");
});

test("a code makes one couple members for 90 days; another couple can't reuse it; a wrong code is refused", async (t) => {
  const { ids, request } = await setup(t);
  const [{ code }] = (await request("/founder/beta/codes", "POST", { count: 1, note: "first" })).body.codes;
  assert.equal((await request("/membership/redeem", "POST", { code: "PINKY-NOPE00" }, ids.a)).status, 404);
  const redeemed = await request("/membership/redeem", "POST", { code: ` ${code.toLowerCase()} ` }, ids.a);
  assert.equal(redeemed.status, 200, JSON.stringify(redeemed.body)); assert.equal(redeemed.body.plan, "member");
  const partner = (await request("/membership", "GET", null, ids.b)).body;
  assert.equal(partner.plan, "member"); assert.equal(partner.source, "beta");
  assert.ok(Date.parse(partner.until) > Date.now() + 89 * 86400000 && Date.parse(partner.until) < Date.now() + 91 * 86400000);
  assert.equal((await request("/membership/redeem", "POST", { code }, ids.b)).status, 200, "the partner using the same code is harmless");
  assert.equal((await request("/membership/redeem", "POST", { code }, ids.c)).status, 409, "another couple can't reuse it");
  assert.equal((await request("/membership", "GET", null, ids.c)).body.plan, "free");
  const board = (await request("/founder/beta")).body;
  assert.equal(board.codes[0].used, true);
  const couple = board.couples.find((item) => item.beta);
  assert.equal(couple.note, "first"); assert.equal(couple.plan, "member");
});

test("the board counts what got done apart from how much a couple tapped (save time, not kill time, 11-07)", async (t) => {
  const { ids, request, store } = await setup(t);
  for (const action of ["together_message", "together_message", "daily_answered", "agreement_approved", "plan_scheduled"]) await recordUsage(store, { userId: ids.a, action });
  const couple = (await request("/founder/beta")).body.couples.find((item) => item.actions === 5);
  assert.ok(couple, "the couple with this week's taps is on the board");
  assert.equal(couple.done, 2, "an approved agreement and a plan on the calendar");
});

test("guessing codes is limited", async (t) => {
  const { ids, request } = await setup(t);
  for (let i = 0; i < 10; i += 1) assert.equal((await request("/membership/redeem", "POST", { code: `PINKY-AAAA${i}` }, ids.c)).status, 404);
  assert.equal((await request("/membership/redeem", "POST", { code: "PINKY-AAAAZZ" }, ids.c)).status, 429);
});
