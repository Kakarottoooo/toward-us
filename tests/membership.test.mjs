import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { X509Certificate, createHmac, createPrivateKey, randomUUID, sign } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createMembershipRouter, membershipFor, verifyAppleJws, verifyStripeSignature, OUTFITS } from "../server/membership.mjs";

// Pinky 会员 (founder 11-06): per couple, paid by Stripe on the web or Apple in the iPhone app; only verified payments count.
const SECRET = "whsec_test_secret";
const env = { STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: SECRET };
const fixtures = resolve("tests/fixtures");

async function setup(t, { production = false, paired = true, fetchImpl } = {}) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "membership-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  for (const id of ids) await store.createUser({ id, email: `${id}@example.invalid`, name: id === ids[0] ? "Ziwei" : id === ids[1] ? "Mia" : "Other", passwordHash: "test", createdAt: new Date().toISOString() });
  if (paired) {
    const relationshipId = randomUUID();
    await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: new Date(Date.now() + 86400000).toISOString() } });
    await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  }
  const calls = [];
  const membership = createMembershipRouter({ store, production, env, fetchImpl: fetchImpl || (async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" }) }; }) });
  const app = express(); app.use(membership.webhooks); app.use(express.json());
  app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"], email: `${req.headers["x-user"]}@example.invalid` } }; next(); });
  app.use("/api", membership.router);
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  const url = (path) => `http://127.0.0.1:${server.address().port}${path}`;
  const request = async (path, method = "GET", body, userId = ids[0]) => {
    const response = await fetch(url(`/api${path}`), { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const webhook = async (event, { secret = SECRET, at = Math.floor(Date.now() / 1000) } = {}) => {
    const raw = JSON.stringify(event), signature = createHmac("sha256", secret).update(`${at}.${raw}`).digest("hex");
    return (await fetch(url("/api/membership/stripe/webhook"), { method: "POST", headers: { "content-type": "application/json", "stripe-signature": `t=${at},v1=${signature}` }, body: raw })).status;
  };
  return { store, ids, request, webhook, calls };
}
const subscription = (userId, patch = {}) => ({ type: "customer.subscription.created", data: { object: { id: "sub_1", customer: "cus_1", status: "active", current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, metadata: { userId, plan: "monthly" }, ...patch } } });

test("a Stripe signature is checked against the raw body, the secret and the time", () => {
  const raw = Buffer.from('{"a":1}'), at = Math.floor(Date.now() / 1000), good = createHmac("sha256", SECRET).update(`${at}.`).update(raw).digest("hex");
  assert.equal(verifyStripeSignature(raw, `t=${at},v1=${good}`, SECRET), true);
  assert.equal(verifyStripeSignature(Buffer.from('{"a":2}'), `t=${at},v1=${good}`, SECRET), false, "a changed body fails");
  assert.equal(verifyStripeSignature(raw, `t=${at},v1=${good}`, "whsec_other"), false, "another secret fails");
  assert.equal(verifyStripeSignature(raw, `t=${at - 3600},v1=${createHmac("sha256", SECRET).update(`${at - 3600}.`).update(raw).digest("hex")}`, SECRET), false, "an old signature fails");
  assert.equal(verifyStripeSignature(raw, "", SECRET), false);
});

test("one member pays on the web and both are members; when the subscription ends both are back on free", async (t) => {
  const { ids, request, webhook } = await setup(t);
  assert.equal((await request("/membership")).body.plan, "free");
  assert.equal(await webhook(subscription(ids[0]), { secret: "whsec_wrong" }), 400, "a forged webhook changes nothing");
  assert.equal((await request("/membership")).body.plan, "free");
  assert.equal(await webhook(subscription(ids[0])), 200);
  const mine = (await request("/membership")).body, hers = (await request("/membership", "GET", null, ids[1])).body;
  assert.equal(mine.plan, "member"); assert.equal(mine.paidBy, ids[0]); assert.equal(mine.source, "stripe");
  assert.equal(hers.plan, "member", "the partner is a member too"); assert.deepEqual(hers.outfits.owned, [...OUTFITS], "members get every outfit");
  assert.equal((await request("/membership", "GET", null, ids[2])).body.plan, "free", "someone outside the couple is not");
  assert.equal(await webhook({ ...subscription(ids[0], { status: "canceled" }), type: "customer.subscription.deleted" }), 200);
  assert.equal((await request("/membership", "GET", null, ids[1])).body.plan, "free");
});

test("an outfit bought on the web belongs to the couple", async (t) => {
  const { ids, request, webhook } = await setup(t);
  assert.equal(await webhook({ type: "checkout.session.completed", data: { object: { id: "cs_9", mode: "payment", payment_status: "paid", client_reference_id: ids[1], metadata: { userId: ids[1], outfit: "crown" } } } }), 200);
  const view = (await request("/membership")).body;
  assert.equal(view.plan, "free"); assert.deepEqual(view.outfits.owned, ["crown"]);
});

test("checkout asks Stripe for the right plan with the member's id, and is closed when Stripe isn't set up", async (t) => {
  const { request, calls, ids } = await setup(t);
  const response = await request("/membership/stripe/checkout", "POST", { product: "yearly", language: "en" });
  assert.equal(response.status, 200); assert.equal(response.body.url, "https://checkout.stripe.com/c/cs_1");
  const sent = new URLSearchParams(calls[0].options.body);
  assert.equal(calls[0].url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(sent.get("mode"), "subscription"); assert.equal(sent.get("subscription_data[metadata][userId]"), ids[0]); assert.equal(sent.get("subscription_data[metadata][plan]"), "yearly");
  assert.equal(sent.get("line_items[0][price_data][recurring][interval]"), "year"); assert.equal(sent.get("line_items[0][price_data][unit_amount]"), "5999");
  assert.equal((await request("/membership/stripe/checkout", "POST", { product: "lifetime" })).status, 400);
  const outfit = await request("/membership/stripe/checkout", "POST", { product: "outfit:bow" });
  assert.equal(outfit.status, 200); assert.equal(new URLSearchParams(calls[1].options.body).get("metadata[outfit]"), "bow");
});

// Xcode StoreKit-testing transactions are signed by a local certificate; we stand in for it with a test-only key.
const appleJws = async (payload) => {
  const key = createPrivateKey(await readFile(join(fixtures, "storekit-test.key.pem")));
  const cert = new X509Certificate(await readFile(join(fixtures, "storekit-test.crt.pem")));
  const header = Buffer.from(JSON.stringify({ alg: "ES256", x5c: [cert.raw.toString("base64")] })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign("sha256", Buffer.from(`${header}.${body}`), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${header}.${body}.${signature}`;
};
const transaction = (userId, patch = {}) => ({ environment: "Xcode", bundleId: "us.toward.app", productId: "us.toward.pinky.member.yearly", transactionId: "2000000001", originalTransactionId: "2000000001", appAccountToken: userId, expiresDate: Date.now() + 365 * 86400000, ...patch });

test("an Apple purchase made in the iPhone app makes the couple members; tampered or foreign ones are refused", async (t) => {
  const { ids, request } = await setup(t);
  const jws = await appleJws(transaction(ids[0]));
  const [header, body, signature] = jws.split(".");
  const tampered = `${header}.${Buffer.from(JSON.stringify(transaction(ids[0], { expiresDate: Date.now() + 9e12 }))).toString("base64url")}.${signature}`;
  assert.equal((await request("/membership/apple/verify", "POST", { signedTransaction: tampered })).status, 400);
  assert.equal((await request("/membership/apple/verify", "POST", { signedTransaction: jws }, ids[1])).status, 403, "someone else's purchase can't be claimed");
  assert.equal((await request("/membership/apple/verify", "POST", { signedTransaction: await appleJws(transaction(ids[0], { bundleId: "com.other.app" })) })).status, 400);
  const verified = await request("/membership/apple/verify", "POST", { signedTransaction: jws });
  assert.equal(verified.status, 200, JSON.stringify(verified.body)); assert.equal(verified.body.plan, "member"); assert.equal(verified.body.source, "apple");
  assert.equal((await request("/membership", "GET", null, ids[1])).body.plan, "member");
  assert.ok(body);
});

test("on a production server only App Store transactions chained to Apple's root count", async (t) => {
  const { ids, request } = await setup(t, { production: true });
  assert.equal((await request("/membership/apple/verify", "POST", { signedTransaction: await appleJws(transaction(ids[0])) })).status, 400, "an Xcode test purchase is refused in production");
  const signed = await appleJws(transaction(ids[0], { environment: "Production" }));
  assert.throws(() => verifyAppleJws(signed), /certificate chain|not signed by Apple/);
  assert.equal((await request("/membership/apple/verify", "POST", { signedTransaction: signed })).status, 400);
  assert.equal((await request("/membership")).body.plan, "free");
  assert.equal((await request("/membership/test-grant", "POST", {})).status, 404, "no free test grants in production");
});

test("membership lapses after its period (with a day's grace) and an unpaired payer is a member alone", async (t) => {
  const { store, ids, webhook } = await setup(t, { paired: false });
  assert.equal(await webhook(subscription(ids[0], { current_period_end: Math.floor(Date.now() / 1000) + 3600 })), 200);
  assert.equal((await membershipFor(store, ids[0])).plan, "member");
  assert.equal((await membershipFor(store, ids[1])).plan, "free");
  assert.equal((await membershipFor(store, ids[0], { now: new Date(Date.now() + 2 * 86400000) })).plan, "free");
});

test("outfits: locked until bought, the couple shares what one buys, members wear any, and nobody unpaired can dress a pet", async (t) => {
  const { store, ids, request, webhook } = await setup(t);
  const { ensureTogetherConversation } = await import("../server/together-domain.mjs");
  const relationshipId = (await store.getRelationshipContext(ids[0])).relationship.id;
  await store.transaction(`relationship:${relationshipId}`, (tx) => ensureTogetherConversation(tx, { relationshipId, userId: ids[0] }));
  const worn = async () => (await store.getRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, ids[0])).petOutfit ?? null;
  assert.equal((await request("/membership/outfit", "POST", { outfit: "crown" })).status, 402, "not bought yet");
  assert.equal((await request("/membership/outfit", "POST", { outfit: "cape" })).status, 402, "not an outfit");
  assert.equal(await webhook({ type: "checkout.session.completed", data: { object: { id: "cs_2", mode: "payment", payment_status: "paid", metadata: { userId: ids[1], outfit: "crown" } } } }), 200);
  const dressed = await request("/membership/outfit", "POST", { outfit: "crown" });
  assert.equal(dressed.status, 200, JSON.stringify(dressed.body)); assert.equal(dressed.body.outfits.equipped, "crown"); assert.equal(await worn(), "crown", "Mia bought it; Ziwei can put it on");
  assert.equal((await request("/membership/outfit", "POST", { outfit: "santa" })).status, 402);
  assert.equal(await webhook(subscription(ids[1])), 200);
  assert.equal((await request("/membership/outfit", "POST", { outfit: "santa" })).status, 200, "members wear any outfit");
  assert.equal((await request("/membership/outfit", "POST", { outfit: null })).body.outfits.equipped, null, "and can take it off");
  assert.equal((await request("/membership/outfit", "POST", { outfit: "bow" }, ids[2])).status, 409, "an unpaired person has no little one to dress");
});

test("deleting your private data keeps the couple's membership and clears your streak days; deleting the account ends it", async (t) => {
  const { store, ids, webhook } = await setup(t);
  const { markShowedUp } = await import("../server/streak.mjs");
  const relationshipId = (await store.getRelationshipContext(ids[0])).relationship.id;
  await store.transaction(`relationship:${relationshipId}`, (tx) => markShowedUp(tx, { relationshipId, userId: ids[0], zone: "UTC" }));
  assert.equal(await webhook(subscription(ids[0])), 200);
  await store.deletePrivateData(ids[0]);
  assert.equal((await membershipFor(store, ids[1])).plan, "member", "a payment is a billing record, not private data to wipe");
  assert.equal((await store.listRecordsForJob("accountSettings")).some((record) => record.id.startsWith("showedup:") && record.ownerUserId === ids[0]), false, "the showed-up days go with private data");
  await store.deleteAccount(ids[0]);
  assert.equal((await store.listRecordsForJob("purchases")).some((record) => record.ownerUserId === ids[0]), false);
  assert.equal((await membershipFor(store, ids[1])).plan, "free");
});
