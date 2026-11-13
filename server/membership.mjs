import express from "express";
import { X509Certificate, createHash, createHmac, randomUUID, timingSafeEqual, verify as verifySignature } from "node:crypto";
import { createRelationshipRecord } from "./relationship-domain.mjs";

// Pinky 会员 (founder 11-06: "按对会员+装扮", paid "两个都做": Stripe on the web, Apple in-app purchase in the iPhone app).
// Membership is per couple: one member pays and both are members while that payment is active. Outfits for the couple's
// little one are bought once and belong to the couple; members get all of them. Every payment is a private "purchases" record
// owned by the payer and written only from a verified source: a Stripe webhook (signed with STRIPE_WEBHOOK_SECRET), an Apple
// signed transaction (JWS chained to Apple Root CA - G3), or a beta code. The client never decides who has paid.

export const PRICES = Object.freeze({ monthly: { usd: 999, days: 31 }, yearly: { usd: 5999, days: 366 }, outfit: { usd: 199 } });
export const OUTFITS = Object.freeze(["bow", "crown", "scarf", "glasses", "flower", "santa"]);
export const APPLE_PRODUCTS = Object.freeze({
  "us.toward.pinky.member.monthly": { kind: "membership", plan: "monthly" },
  "us.toward.pinky.member.yearly": { kind: "membership", plan: "yearly" },
  ...Object.fromEntries(OUTFITS.map((id) => [`us.toward.pinky.outfit.${id}`, { kind: "outfit", outfit: id }])),
});
const COLLECTION = "purchases";
// A renewal can land a little after the period ends; keep the member on for a day so nobody is cut off mid-renewal.
const GRACE_MS = 24 * 60 * 60 * 1000;

const purchase = (userId, relationshipId, data) => createRelationshipRecord({ relationshipId: relationshipId || null, userId, visibility: "private", aiAccessScope: "none", approvalPolicy: "owner", status: "active", provenanceSource: data.source, ...data });

// Purchases are read at most once a minute per store for hot paths (AI caps, the pet in every Us load); a verified payment
// clears the cache so the buyer sees it at once.
const purchaseCache = new WeakMap();
export async function cachedPurchases(store, now = new Date()) {
  const cached = purchaseCache.get(store);
  if (cached && now.getTime() - cached.at < 60_000 && now.getTime() >= cached.at) return cached.records;
  const records = await store.listRecordsForJob(COLLECTION).catch(() => []);
  purchaseCache.set(store, { at: now.getTime(), records }); return records;
}
export const forgetPurchases = (store) => purchaseCache.delete(store);

/** The couple's (or, unpaired, the person's) plan, from active purchase records of either member. */
export async function membershipFor(store, userId, { now = new Date(), purchases } = {}) {
  const pairing = await store.getRelationshipContext(userId);
  const members = pairing?.relationship?.status === "active" && pairing.members?.length ? pairing.members.map((member) => member.userId) : [userId];
  const owners = new Set(members);
  const records = (purchases || await store.listRecordsForJob(COLLECTION)).filter((record) => owners.has(record.ownerUserId) && record.status === "active");
  const active = records.filter((record) => record.kind === "membership" && record.until && Date.parse(record.until) + GRACE_MS > now.getTime()).sort((a, b) => Date.parse(b.until) - Date.parse(a.until));
  const best = active[0] || null;
  const owned = [...new Set(records.filter((record) => record.kind === "outfit" && OUTFITS.includes(record.outfit)).map((record) => record.outfit))];
  return { plan: best ? "member" : "free", until: best?.until || null, source: best?.source || null, paidBy: best?.ownerUserId || null, members, outfits: best ? [...OUTFITS] : owned };
}

// ── Apple: StoreKit 2 signed transactions ───────────────────────────────────────────────────────────────────────────────
// SHA-256 fingerprint of Apple Root CA - G3 (Apple's published root list), which signs the App Store's transaction certificates.
const APPLE_ROOT_G3 = "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179";
const b64url = (value) => Buffer.from(value, "base64url");
const fail = (status, message, code) => Object.assign(new Error(message), { statusCode: status, code });

/** Verifies a JWS from the App Store (ES256, x5c chain to Apple Root CA - G3) and returns its payload. In development an
 * Xcode StoreKit-testing transaction (signed by Xcode's local certificate) is accepted only when `allowXcode` is set. */
export function verifyAppleJws(jws, { now = new Date(), allowXcode = false } = {}) {
  const parts = String(jws || "").split(".");
  if (parts.length !== 3) throw fail(400, "Not a signed App Store transaction.", "apple_invalid");
  let header, payload;
  try { header = JSON.parse(b64url(parts[0]).toString("utf8")); payload = JSON.parse(b64url(parts[1]).toString("utf8")); } catch { throw fail(400, "Not a signed App Store transaction.", "apple_invalid"); }
  if (header.alg !== "ES256" || !Array.isArray(header.x5c) || header.x5c.length < 1) throw fail(400, "Unsupported App Store signature.", "apple_invalid");
  const chain = header.x5c.map((der) => new X509Certificate(Buffer.from(der, "base64")));
  const xcode = payload.environment === "Xcode";
  if (xcode && !allowXcode) throw fail(400, "Xcode test purchases only work on a development server.", "apple_xcode");
  if (!xcode) {
    if (chain.length !== 3) throw fail(400, "Unsupported App Store certificate chain.", "apple_invalid");
    const [leaf, intermediate, root] = chain;
    const fingerprint = createHash("sha256").update(root.raw).digest("hex");
    if (fingerprint !== APPLE_ROOT_G3) throw fail(400, "This purchase was not signed by Apple.", "apple_untrusted");
    if (!leaf.verify(intermediate.publicKey) || !intermediate.verify(root.publicKey) || !root.verify(root.publicKey)) throw fail(400, "This purchase was not signed by Apple.", "apple_untrusted");
    for (const cert of chain) if (Date.parse(cert.validFrom) > now.getTime() || Date.parse(cert.validTo) < now.getTime()) throw fail(400, "Apple's certificate is not valid now.", "apple_untrusted");
  }
  const ok = verifySignature("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), { key: chain[0].publicKey, dsaEncoding: "ieee-p1363" }, b64url(parts[2]));
  if (!ok) throw fail(400, "This purchase was not signed by Apple.", "apple_untrusted");
  return payload;
}

const appleBundles = () => new Set(String(process.env.APPLE_BUNDLE_IDS || "us.toward.app,us.toward.pinky.ziwei").split(",").map((item) => item.trim()).filter(Boolean));

// ── Stripe: webhooks and Checkout, over its REST API (no SDK) ───────────────────────────────────────────────────────────
/** Checks a Stripe-Signature header (t=…,v1=…) against the raw body; 5-minute tolerance. */
export function verifyStripeSignature(rawBody, header, secret, { now = new Date(), tolerance = 300 } = {}) {
  if (!secret) return false;
  const fields = Object.fromEntries(String(header || "").split(",").map((item) => item.split("=")).filter((pair) => pair.length === 2).map(([key, value]) => [key.trim(), value.trim()]));
  const signatures = String(header || "").split(",").filter((item) => item.trim().startsWith("v1=")).map((item) => item.trim().slice(3));
  const stamp = Number(fields.t);
  if (!Number.isFinite(stamp) || Math.abs(now.getTime() / 1000 - stamp) > tolerance || !signatures.length) return false;
  const expected = createHmac("sha256", secret).update(`${stamp}.`).update(rawBody).digest();
  return signatures.some((value) => { const given = Buffer.from(value, "hex"); return given.length === expected.length && timingSafeEqual(given, expected); });
}
const form = (data, prefix = "", out = new URLSearchParams()) => {
  for (const [key, value] of Object.entries(data)) {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value === undefined || value === null) continue;
    if (typeof value === "object") form(value, name, out); else out.append(name, String(value));
  }
  return out;
};

const LIMIT = { zh: "开通会员", en: "Become a member", es: "Hazte miembro" };
const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;

export function createMembershipRouter({ store, production = false, fetchImpl = (...args) => fetch(...args), now = () => new Date(), env = process.env, onOutfit }) {
  const stripeOn = () => Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
  const stripe = async (method, path, body) => {
    const response = await fetchImpl(`https://api.stripe.com/v1/${path}`, { method, headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) }, ...(body ? { body: form(body).toString() } : {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw fail(502, data?.error?.message || "The payment service did not answer.", "stripe_error");
    return data;
  };
  const relationshipOf = async (userId) => { const pairing = await store.getRelationshipContext(userId); return pairing?.relationship?.status === "active" ? pairing.relationship.id : null; };
  const findBy = async (field, value) => value ? (await store.listRecordsForJob(COLLECTION)).find((record) => record[field] === value) || null : null;
  /** Creates or updates the purchase record for an external id (a subscription, an Apple original transaction, a session). */
  const upsert = async (ownerUserId, externalId, fields) => { try { return await write(ownerUserId, externalId, fields); } finally { forgetPurchases(store); } };
  const write = async (ownerUserId, externalId, fields) => store.transaction(`purchase:${externalId}`, async (tx) => {
    const existing = (await tx.listRecordsForJob(COLLECTION)).find((record) => record.externalId === externalId);
    if (existing) return tx.updateRelationshipRecordForUser(COLLECTION, existing.id, existing.ownerUserId, (record) => { Object.assign(record, fields); record.version += 1; });
    if (!ownerUserId || !(await tx.getUserById(ownerUserId))) return null;
    return tx.createRelationshipRecord(COLLECTION, purchase(ownerUserId, await relationshipOf(ownerUserId), { externalId, ...fields }));
  });
  const view = async (userId) => {
    const plan = await membershipFor(store, userId, { now: now() });
    const equipped = await equippedOutfit(store, userId);
    return { plan: plan.plan, until: plan.until, source: plan.source, paidBy: plan.paidBy, outfits: { owned: plan.outfits, equipped: equipped && plan.outfits.includes(equipped) ? equipped : null }, providers: { stripe: stripeOn(), apple: true }, prices: PRICES };
  };

  // Webhooks first: they carry their own signatures, need the raw body, and come from Stripe/Apple, not from the app's origin.
  const webhooks = express.Router();
  webhooks.post("/api/membership/stripe/webhook", express.raw({ type: () => true, limit: "1mb" }), async (req, res) => {
    if (!stripeOn()) return res.status(503).json({ error: "Stripe is not configured." });
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    if (!verifyStripeSignature(raw, req.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET, { now: now() })) return res.status(400).json({ error: "Bad signature." });
    let event; try { event = JSON.parse(raw.toString("utf8")); } catch { return res.status(400).json({ error: "Bad payload." }); }
    try {
      const object = event?.data?.object || {};
      if (event.type === "checkout.session.completed" && object.mode === "payment" && object.payment_status === "paid" && OUTFITS.includes(object.metadata?.outfit)) {
        await upsert(object.metadata?.userId || object.client_reference_id, `stripe:${object.id}`, { kind: "outfit", outfit: object.metadata.outfit, source: "stripe", status: "active" });
      }
      if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
        const end = object.current_period_end || object.items?.data?.[0]?.current_period_end;
        const live = event.type !== "customer.subscription.deleted" && ["active", "trialing", "past_due"].includes(object.status);
        await upsert(object.metadata?.userId, `stripe:${object.id}`, { kind: "membership", plan: object.metadata?.plan === "yearly" ? "yearly" : "monthly", source: "stripe", customer: object.customer || null, status: live ? "active" : "ended", until: end ? new Date(end * 1000).toISOString() : null });
      }
      res.json({ received: true });
    } catch (error) { console.error("stripe_webhook_failed", error?.code || error?.message); res.status(500).json({ error: "Retry later." }); }
  });
  // App Store Server Notifications V2: renewals, expiry, refunds. The transaction inside says who and until when.
  webhooks.post("/api/membership/apple/notifications", express.raw({ type: () => true, limit: "1mb" }), async (req, res) => {
    try {
      const body = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "{}");
      const notice = verifyAppleJws(body.signedPayload, { now: now(), allowXcode: !production });
      const signed = notice?.data?.signedTransactionInfo;
      if (signed) await applyApple(null, signed);
      res.json({ received: true });
    } catch (error) { res.status(error?.statusCode === 400 ? 400 : 500).json({ error: "Not accepted." }); }
  });

  /** Records a verified Apple transaction for `userId` (or, from a notification, the user named in appAccountToken). */
  async function applyApple(userId, signedTransaction) {
    const payload = verifyAppleJws(signedTransaction, { now: now(), allowXcode: !production });
    const product = APPLE_PRODUCTS[payload.productId];
    if (!product || !appleBundles().has(payload.bundleId)) throw fail(400, "This is not a Pinky purchase.", "apple_product");
    const owner = String(payload.appAccountToken || "").toLowerCase();
    if (userId && owner && owner !== userId.toLowerCase()) throw fail(403, "This purchase belongs to another account.", "apple_owner");
    const externalId = `apple:${payload.originalTransactionId || payload.transactionId}`;
    const revoked = Boolean(payload.revocationDate);
    const existing = await findBy("externalId", externalId);
    const ownerUserId = existing?.ownerUserId || userId || owner || null;
    if (product.kind === "outfit") return upsert(ownerUserId, externalId, { kind: "outfit", outfit: product.outfit, source: "apple", status: revoked ? "ended" : "active", environment: payload.environment || null });
    const until = payload.expiresDate ? new Date(Number(payload.expiresDate)).toISOString() : null;
    return upsert(ownerUserId, externalId, { kind: "membership", plan: product.plan, source: "apple", status: revoked ? "ended" : "active", until, environment: payload.environment || null });
  }

  const router = express.Router();
  const auth = (req, res, next) => req.auth?.user ? next() : res.status(401).json({ error: say(req.body?.language || req.query?.language, "请先登录。", "Please sign in first.", "Inicia sesión primero.") });
  router.get("/membership", auth, async (req, res, next) => { try { res.setHeader("Cache-Control", "no-store"); res.json(await view(req.auth.user.id)); } catch (error) { next(error); } });
  // Dress the couple's little one: any outfit the couple owns (all of them for members), or null to take it off.
  router.post("/membership/outfit", auth, async (req, res) => {
    const userId = req.auth.user.id, outfit = req.body?.outfit ?? null;
    const pairing = await store.getRelationshipContext(userId);
    const relationshipId = pairing?.relationship?.status === "active" ? pairing.relationship.id : null;
    if (!relationshipId) return res.status(409).json({ error: "Your little one lives in Us; invite your partner first.", code: "not_paired" });
    if (outfit !== null && !(await membershipFor(store, userId, { now: now() })).outfits.includes(outfit)) return res.status(402).json({ error: "This outfit isn't yours yet.", code: "outfit_locked" });
    const saved = await store.transaction(`relationship:${relationshipId}`, (tx) => tx.updateRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, userId, (draft) => { draft.petOutfit = outfit; }));
    if (!saved) return res.status(404).json({ error: "Not found." });
    onOutfit?.(saved);
    res.json(await view(userId));
  });
  router.post("/membership/apple/verify", auth, async (req, res) => {
    try { await applyApple(req.auth.user.id, req.body?.signedTransaction); res.json(await view(req.auth.user.id)); }
    catch (error) { res.status(error?.statusCode || 500).json({ error: error?.message || "Could not check this purchase.", code: error?.code }); }
  });
  router.post("/membership/apple/restore", auth, async (req, res) => {
    const list = Array.isArray(req.body?.signedTransactions) ? req.body.signedTransactions.slice(0, 50) : [];
    for (const item of list) { try { await applyApple(req.auth.user.id, item); } catch { /* one bad or foreign transaction never blocks the rest */ } }
    res.json(await view(req.auth.user.id));
  });
  router.post("/membership/stripe/checkout", auth, async (req, res) => {
    const language = ["zh", "en", "es"].includes(req.body?.language) ? req.body.language : ["en", "es"].includes(req.auth.user.language) ? req.auth.user.language : "zh";
    if (!stripeOn()) return res.status(503).json({ error: say(language, "网页付款还没开通。", "Paying on the web isn't open yet.", "El pago web aún no está disponible."), code: "stripe_off" });
    const product = String(req.body?.product || ""), user = req.auth.user, origin = `${req.protocol}://${req.get("host")}`;
    const outfit = product.startsWith("outfit:") ? product.slice(7) : null;
    if (!["monthly", "yearly"].includes(product) && !OUTFITS.includes(outfit)) return res.status(400).json({ error: "Unknown product.", code: "unknown_product" });
    try {
      const common = { client_reference_id: user.id, customer_email: user.email, success_url: `${origin}/?view=membership&paid=1`, cancel_url: `${origin}/?view=membership`, locale: language === "zh" ? "zh" : language, metadata: { userId: user.id } };
      const session = outfit
        ? await stripe("POST", "checkout/sessions", { ...common, mode: "payment", metadata: { userId: user.id, outfit }, line_items: { 0: { quantity: 1, price_data: { currency: "usd", unit_amount: PRICES.outfit.usd, product_data: { name: `Pinky outfit: ${outfit}` } } } } })
        : await stripe("POST", "checkout/sessions", { ...common, mode: "subscription", subscription_data: { metadata: { userId: user.id, plan: product } }, line_items: { 0: env[product === "yearly" ? "STRIPE_PRICE_YEARLY" : "STRIPE_PRICE_MONTHLY"]
          ? { quantity: 1, price: env[product === "yearly" ? "STRIPE_PRICE_YEARLY" : "STRIPE_PRICE_MONTHLY"] }
          : { quantity: 1, price_data: { currency: "usd", unit_amount: PRICES[product].usd, recurring: { interval: product === "yearly" ? "year" : "month" }, product_data: { name: product === "yearly" ? "Pinky membership (yearly)" : "Pinky membership (monthly)" } } } } });
      res.json({ url: session.url });
    } catch (error) { res.status(error?.statusCode || 500).json({ error: say(language, "现在付不了款，请稍后再试。", "Payment isn't available right now. Try again soon.", "El pago no está disponible ahora. Inténtalo más tarde."), code: error?.code }); }
  });
  router.post("/membership/stripe/portal", auth, async (req, res) => {
    if (!stripeOn()) return res.status(503).json({ error: "Stripe is not configured.", code: "stripe_off" });
    const mine = (await store.listRecordsForJob(COLLECTION)).filter((record) => record.ownerUserId === req.auth.user.id && record.source === "stripe" && record.customer).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
    if (!mine) return res.status(404).json({ error: "No web membership to manage.", code: "no_stripe" });
    try { const session = await stripe("POST", "billing_portal/sessions", { customer: mine.customer, return_url: `${req.protocol}://${req.get("host")}/?view=membership` }); res.json({ url: session.url }); }
    catch (error) { res.status(error?.statusCode || 500).json({ error: error?.message, code: error?.code }); }
  });
  // Development only (never in production): grant a membership so the app can be tried without paying.
  if (!production) router.post("/membership/test-grant", auth, async (req, res) => {
    const days = Math.min(Math.max(Number(req.body?.days) || 30, 1), 400);
    await upsert(req.auth.user.id, `test:${randomUUID()}`, { kind: "membership", plan: "monthly", source: "test", status: "active", until: new Date(now().getTime() + days * 86400000).toISOString() });
    res.json(await view(req.auth.user.id));
  });
  return { router, webhooks, membershipFor: (userId) => membershipFor(store, userId, { now: now() }), view, grant: upsert };
}

/** The outfit the couple's little one wears, kept on their shared Us conversation as `petOutfit`. */
async function equippedOutfit(store, userId) {
  try { const pairing = await store.getRelationshipContext(userId); const id = pairing?.relationship?.status === "active" ? pairing.relationship.id : null; if (!id) return null; return (await store.getRelationshipRecordForUser("togetherConversations", `together:${id}`, userId))?.petOutfit || null; } catch { return null; }
}
export const MEMBER_CTA = LIMIT;
