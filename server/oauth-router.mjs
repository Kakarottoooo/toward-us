import express from "express";
import { createHash, randomBytes } from "node:crypto";
import { createUser, issueSession, setSessionCookie, verifyPassword } from "./auth.mjs";
import { REWARD_LOCK } from "./reward-ledger.mjs";
import { createOAuthProviders } from "./oauth-providers.mjs";

const random = () => randomBytes(32).toString("base64url");
const digest = (value) => createHash("sha256").update(value).digest("base64url");
const proof = /^[A-Za-z0-9_-]{43}$/;
const path = "/api/auth/oauth";
const minute = 60_000;
const failure = (code, status = 400) => Object.assign(new Error(code), { code, status });
const cookie = (req, key) => (req.headers.cookie || "").split(/;\s*/).find((entry) => entry.startsWith(key + "="))?.slice(key.length + 1);

// Single-instance Render service: interrupted handshakes can be restarted. Sessions and identity bindings are durable.
function expiringMap(now) {
  const entries = new Map();
  return {
    put(key, value, ttl) {
      if (entries.size >= 4096 || entries.size % 128 === 0) {
        for (const [id, item] of entries) if (item.expires <= now()) entries.delete(id);
      }
      if (!entries.has(key) && entries.size >= 4096) throw failure("rate_limited", 429);
      entries.set(key, { value, expires: now() + ttl });
    },
    get(key) {
      const item = entries.get(key);
      if (item?.expires > now()) return item.value;
      entries.delete(key);
    },
    delete: (key) => entries.delete(key),
  };
}

export function createOAuthRouter({ store, production, register, providers = createOAuthProviders(), env = process.env, now = Date.now }) {
  const router = express.Router();
  const starts = expiringMap(now), states = expiringMap(now), handoffs = expiringMap(now), links = expiringMap(now), limits = expiringMap(now);
  const googleOrApple = (provider) => provider === "google" || provider === "apple";
  const origin = (req) => {
    const value = env.OAUTH_PUBLIC_ORIGIN || env.TOWARD_US_BASE_URL || (!production && `${req.protocol}://${req.get("host")}`);
    if (!value) return null;
    try {
      const url = new URL(value);
      return (!production || url.protocol === "https:") && url.host === req.get("host") ? url.origin : null;
    } catch { return null; }
  };
  const options = (maxAge, sameSite = "lax") => ({ path, httpOnly: true, secure: production, sameSite, maxAge });
  const attempt = (key, max, ttl) => {
    let count = limits.get(key);
    if (!count) { count = { hits: 0 }; limits.put(key, count, ttl); }
    if (++count.hits > max) throw failure("rate_limited", 429);
  };
  const responseError = (res, error) => {
    const known = [400, 401, 409, 410, 429, 503].includes(error.status);
    return res.status(known ? error.status : 503).json({ code: known ? error.code : "failed" });
  };
  async function authenticate(identity, signup, confirmation) {
    // Same lock/order as sign-up attribution and account deletion. Session creation and linking commit together.
    return store.transaction(REWARD_LOCK, async (tx) => {
      const { provider, subject, email, revocation } = identity;
      const known = await tx.getOAuthIdentity(provider, subject);
      const trustedEmail = provider === "apple" && identity.emailOmitted && !identity.relay ? known?.authoritativeEmail || null :
        identity.authoritative && !identity.relay && !email?.endsWith("@privaterelay.appleid.com") ? email : null;
      let user = known && await tx.getUserForUpdate(known.userId);
      if (known && (!user || user.passwordHash === "deleted" || (confirmation && user.id !== confirmation.userId) ||
          (await tx.getOAuthIdentity(provider, subject))?.userId !== user.id)) throw failure("failed");
      if (!known) {
        if (!email || (provider === "apple" && !revocation)) throw failure("failed");
        user = await tx.getUserByEmail(email);
        if (!user && !confirmation) {
          if (!signup.adultConfirmed) throw failure("adult_required", 409);
          const candidate = createUser({ email, name: identity.name || email.split("@")[0].replace(/[<>]/g, "").slice(0, 24) || "Ourever", passwordHash: "federated" });
          user = await register(tx, candidate, signup);
          if (user) {
            await tx.bindOAuthIdentity(provider, subject, user.id, revocation, trustedEmail);
            return issueSession(tx, user.id, provider);
          }
          user = await tx.getUserByEmail(email); // A simultaneous password sign-up won the unique email insert.
        }
        user = user && await tx.getUserForUpdate(user.id);
        if (!user || user.email !== email || user.passwordHash === "deleted" || identity.relay || email.endsWith("@privaterelay.appleid.com")) throw failure("failed");
        const bindings = await tx.getUserOAuthIdentities(user.id);
        if (bindings.some((link) => link.provider === provider)) throw failure("failed");
        // Legacy password registrations did not verify the email. An email claim alone cannot claim that account,
        // including Google accounts with third-party addresses that may no longer belong to the Google user.
        const previouslyVerified = user.passwordHash === "federated" && trustedEmail && bindings.some((link) => link.authoritativeEmail === trustedEmail);
        if (!previouslyVerified) {
          if (!confirmation) return { linkUserId: user.id };
          if (confirmation.userId !== user.id || !await verifyPassword(confirmation.password, user.passwordHash)) throw failure("invalid_credentials", 401);
        }
      }
      await tx.bindOAuthIdentity(provider, subject, user.id, revocation, trustedEmail === user.email ? trustedEmail : null);
      return issueSession(tx, user.id, provider);
    });
  }
  async function finish(res, grant, web) {
    const result = await authenticate(grant.identity, grant.signup);
    if (result.linkUserId) {
      const ticket = random();
      links.put(digest(ticket), { ...grant, userId: result.linkUserId }, 10 * minute);
      res.cookie("ourever_link", ticket, options(10 * minute));
      return web ? res.redirect(303, "/?signin=link_required") : res.status(409).json({ code: "link_required" });
    }
    setSessionCookie(res, result.token, production);
    return web ? res.redirect(303, "/") : res.json({ ok: true });
  }
  router.get("/providers", (req, res) => {
    const ready = Boolean(origin(req));
    res.json({ google: ready && providers.configured.google, apple: ready && providers.configured.apple });
  });
  router.post("/:provider/start", (req, res) => {
    try {
      const provider = req.params.provider, base = origin(req);
      if (!base || !googleOrApple(provider) || !providers.configured[provider]) throw failure("unavailable", 503);
      if (!req.is("application/json")) throw failure("invalid_request");
      const { challenge, adultConfirmed, referralCode, installId, partnerInviteCode } = req.body || {};
      if (challenge !== undefined && (typeof challenge !== "string" || !proof.test(challenge))) throw failure("invalid_request");
      attempt("start:" + req.ip, 30, 10 * minute);
      const id = random(), binding = random();
      const short = (value) => typeof value === "string" ? value.slice(0, 128) : undefined;
      const signup = { adultConfirmed: adultConfirmed === true, referralCode: short(referralCode), installId: short(installId), partnerInviteCode: short(partnerInviteCode), actor: req.auth?.user?.id };
      starts.put(id, { provider, base, binding, challenge, signup }, 2 * minute);
      if (!challenge) res.cookie("ourever_start", binding, options(2 * minute));
      res.json({ url: `${base}${path}/${provider}/authorize?request=${id}` });
    } catch (error) { responseError(res, error); }
  });
  router.get("/:provider/authorize", (req, res) => {
    const id = req.query.request;
    const start = starts.get(id);
    if (!start || start.provider !== req.params.provider || start.base !== origin(req) || (!start.challenge && cookie(req, "ourever_start") !== start.binding)) return res.redirect(303, "/?signin=failed");
    starts.delete(id);
    try {
      const state = random(), nonce = random(), verifier = random(), binding = random();
      const redirectUri = `${start.base}${path}/${start.provider}/callback`;
      states.put(state, { ...start, binding, nonce, verifier, redirectUri }, 10 * minute);
      // Apple returns a cross-site form POST. This cookie is short-lived, host-only and checked against single-use state.
      res.cookie("ourever_oauth", binding, options(10 * minute, start.provider === "apple" ? "none" : "lax"));
      return res.redirect(303, providers.authorization(start.provider, { state, nonce, redirectUri, challenge: digest(verifier) }));
    } catch { return res.redirect(303, "/?signin=failed"); }
  });
  async function callback(req, res) {
    const params = req.method === "GET" ? req.query : req.body || {};
    const flow = states.get(params.state);
    if (!flow || flow.provider !== req.params.provider || flow.base !== origin(req) || cookie(req, "ourever_oauth") !== flow.binding) return res.redirect(303, "/?signin=failed");
    states.delete(params.state);
    const native = Boolean(flow.challenge);
    const errorRedirect = (error) => res.redirect(303, native ? "us.toward.app://signin?error=" + error : "/?signin=" + error);
    if (params.error) return errorRedirect(params.error === "access_denied" || params.error === "user_cancelled_authorize" ? "cancelled" : "failed");
    if (typeof params.code !== "string" || !params.code || params.code.length > 4096) return errorRedirect("failed");
    try {
      const identity = await providers.redeem(flow.provider, params.code, flow);
      // Apple supplies a display name in the first form post only. Authorization always uses the signed subject.
      if (flow.provider === "apple" && typeof params.user === "string" && !identity.name) {
        try {
          const name = JSON.parse(params.user)?.name;
          identity.name = [name?.firstName, name?.lastName].filter((part) => typeof part === "string").join(" ").trim().replace(/[<>]/g, "").slice(0, 24);
        } catch { /* Name is optional. */ }
      }
      const grant = { identity, signup: flow.signup };
      if (!native) return await finish(res, grant, true);
      const code = random();
      handoffs.put(digest(code), { ...grant, challenge: flow.challenge }, minute);
      return res.redirect(303, "us.toward.app://signin?code=" + code);
    } catch (error) { return errorRedirect(error.code === "adult_required" ? "adult_required" : "failed"); }
  }
  router.get("/:provider/callback", callback);
  router.post("/apple/callback", express.urlencoded({ extended: false, limit: "12kb", parameterLimit: 8 }), (req, res) => {
    req.params.provider = "apple";
    return callback(req, res);
  });
  router.post("/exchange", async (req, res) => {
    try {
      if (!req.is("application/json")) throw failure("invalid_request");
      const { code, verifier } = req.body || {};
      if (typeof code !== "string" || !proof.test(code) || typeof verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw failure("invalid_request");
      const key = digest(code), grant = handoffs.get(key);
      if (!grant || digest(verifier) !== grant.challenge) throw failure("expired", 410);
      handoffs.delete(key);
      return await finish(res, grant, false);
    } catch (error) { return responseError(res, error); }
  });
  router.post("/confirm-link", async (req, res) => {
    try {
      if (!req.is("application/json")) throw failure("invalid_request");
      const ticket = cookie(req, "ourever_link");
      const key = ticket && digest(ticket), grant = links.get(key);
      if (!grant || grant.busy) throw failure("expired", 410);
      const password = req.body?.password;
      if (typeof password !== "string" || !password || password.length > 128) throw failure("invalid_credentials", 401);
      attempt("link-user:" + grant.userId, 6, 15 * minute);
      attempt("link-ip:" + req.ip, 30, 15 * minute);
      grant.busy = true;
      let result;
      try { result = await authenticate(grant.identity, grant.signup, { userId: grant.userId, password }); }
      finally { grant.busy = false; }
      links.delete(key);
      setSessionCookie(res, result.token, production);
      return res.json({ ok: true });
    } catch (error) { return responseError(res, error); }
  });
  return router;
}
