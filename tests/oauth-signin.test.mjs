import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportPKCS8, generateKeyPair, SignJWT } from "jose";
import { createApiApp } from "../server/app.mjs";
import { createFileStore } from "../server/store.mjs";
import { createPostgresStore } from "../server/postgres-store.mjs";
import { createOAuthProviders } from "../server/oauth-providers.mjs";

const secret = () => randomBytes(32).toString("base64url");
const digest = (v) => createHash("sha256").update(v).digest("base64url");
const cookieOf = (r) => r.headers.get("set-cookie")?.split(";")[0];
const rsa = await generateKeyPair("RS256");
const clientKey = await generateKeyPair("ES256", { extractable: true });
const applePrivate = await exportPKCS8(clientKey.privateKey);

async function fixture(t, { postgres = false } = {}) {
  const env = { GOOGLE_CLIENT_ID: "google-test", GOOGLE_CLIENT_SECRET: secret(), APPLE_SIGNIN_CLIENT_ID: "apple-test",
    APPLE_SIGNIN_TEAM_ID: "team", APPLE_SIGNIN_KEY_ID: "key", APPLE_SIGNIN_PRIVATE_KEY: applePrivate, APPLE_SIGNIN_TOKEN_KEY: randomBytes(32).toString("base64") };
  const codes = new Map(), revoked = [], providerState = { revokeAvailable: true };
  const refresh = secret();
  const providers = createOAuthProviders({ env, keys: { google: rsa.publicKey, apple: rsa.publicKey }, fetchImpl: async (url, { body }) => {
    if (url.endsWith("/revoke")) {
      if (!providerState.revokeAvailable) return new Response(null, { status: 503 });
      revoked.push(body.get("token")); return new Response();
    }
    const record = codes.get(body.get("code"));
    if (!record || (record.challenge && digest(body.get("code_verifier")) !== record.challenge)) return new Response(null, { status: 400 });
    codes.delete(body.get("code"));
    return Response.json({ id_token: record.token, refresh_token: refresh });
  } });
  const directory = await mkdtemp(join(tmpdir(), "ourever-oauth-"));
  const file = join(directory, "db.json");
  let store;
  if (postgres) {
    const url = new URL(process.env.POSTGRES_TEST_URL);
    assert.equal(url.hostname, "localhost", "OAuth database tests only run on local PostgreSQL");
    const admin = new Pool({ connectionString: url.href });
    const name = "ourever_oauth_" + randomUUID().replaceAll("-", "");
    await admin.query("create database " + name);
    url.pathname = "/" + name;
    store = await createPostgresStore(url.href);
    t.after(async () => { await store.close(); await admin.query("drop database " + name); await admin.end(); });
  } else store = await createFileStore(file);
  const mailbox = [];
  const email = { configured: true, async send(message) { mailbox.push(message); return { sent: true }; } };
  const server = createApiApp({ store, mediator: { aiReady: false, model: "test" }, oauthProviders: providers, email }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const request = (path, { body, cookie, method = body ? "POST" : "GET", form } = {}) => fetch(new URL(path, base), {
    redirect: "manual", method: form ? "POST" : method,
    headers: { connection: "close", ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}), ...(form ? { origin: "https://appleid.apple.com", "sec-fetch-site": "cross-site" } : {}) },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  async function start(provider = "google", signup = { adultConfirmed: true }) {
    const prefix = "/api/auth/oauth/" + provider;
    const start = await request(prefix + "/start", { body: signup });
    assert.equal(start.status, 200);
    const authUrl = (await start.json()).url;
    const authorize = await request(authUrl, { cookie: cookieOf(start) });
    assert.equal(authorize.status, 303);
    const query = new URL(authorize.headers.get("location")).searchParams;
    if (provider === "google") assert.equal(query.get("code_challenge_method"), "S256");
    const browser = cookieOf(authorize);
    async function callback(claims = {}, options = {}) {
      const state = options.state ?? query.get("state"), code = secret();
      const token = await new SignJWT({ nonce: query.get("nonce"), email: "sample@example.invalid", email_verified: true, ...claims })
        .setProtectedHeader({ alg: "RS256" }).setIssuer(options.issuer ?? (provider === "apple" ? "https://appleid.apple.com" : "https://accounts.google.com"))
        .setAudience(options.aud ?? (provider + "-test")).setSubject(options.subject || "stable-subject").setIssuedAt().setExpirationTime(options.exp || "5m").sign(rsa.privateKey);
      codes.set(code, { token: options.badSignature ? token.slice(0, token.lastIndexOf(".") + 1) + secret() : token, challenge: query.get("code_challenge") });
      const params = new URLSearchParams(options.cancel ? { state, error: "access_denied" } : { state, code });
      return provider === "apple" ? request(prefix + "/callback", { form: params, cookie: options.cookie ?? browser })
        : request(prefix + "/callback?" + params, { cookie: options.cookie ?? browser });
    }
    return { callback, authUrl };
  }
  return { request, start, file, store, revoked, refresh, providerState, mailbox };
}

test("web handshake rejects unbound browsers, bad state, nonce, issuer, audience, unverified email and replay", async (t) => {
  const { start, request } = await fixture(t);
  const first = await start();
  assert.equal((await first.callback({}, { cookie: "" })).headers.get("location"), "/?signin=failed");
  assert.equal((await first.callback({}, { state: secret() })).headers.get("location"), "/?signin=failed");
  const ok = await first.callback();
  assert.equal(ok.headers.get("location"), "/");
  const session = cookieOf(ok);
  assert.equal((await (await request("/api/auth/me", { cookie: session })).json()).user.passwordless, true);
  assert.equal((await first.callback()).headers.get("location"), "/?signin=failed");
  for (const [claims, options] of [[{ nonce: secret() }, {}], [{}, { badSignature: true }], [{}, { aud: "unrelated" }], [{}, { issuer: "https://example.invalid" }], [{}, { exp: 1 }], [{ email_verified: false }, { subject: "unseen" }]]) {
    assert.equal((await (await start()).callback(claims, options)).headers.get("location"), "/?signin=failed");
  }
  assert.equal((await (await start()).callback({}, { cancel: true })).headers.get("location"), "/?signin=cancelled");
  assert.equal((await (await start("google", {})).callback({email: "new@example.invalid"}, {subject: "new"})).headers.get("location"), "/?signin=adult_required");
  assert.equal((await request("/api/auth/logout", { cookie: session, body: {} })).status, 204);
  assert.equal((await (await request("/api/auth/me", { cookie: session })).json()).user, null);
});

test("first link proves the original password, preserves both sessions and the couple, and does not change subject on email reuse", async (t) => {
  const { request, start, file } = await fixture(t);
  const password = secret();
  const old = await request("/api/auth/register", { body: { email: "couple@example.invalid", password, name: "One", adultConfirmed: true } });
  const oldCookie = cookieOf(old), id = (await old.json()).user.id;
  const invite = (await (await request("/api/partner/invitations", { body: {}, cookie: oldCookie })).json()).pairing;
  const partner = await (await start("apple")).callback({ email: "partner@privaterelay.appleid.com", is_private_email: "true" });
  const joined = await request("/api/partner/accept", { cookie: cookieOf(partner), body: { code: invite.invitation.code } });
  assert.equal((await joined.json()).pairing.status, "active");
  const linked = await (await start()).callback({ email: "couple@example.invalid" });
  assert.equal(linked.headers.get("location"), "/?signin=link_required");
  const proofCookie = cookieOf(linked);
  assert.equal((await request("/api/auth/oauth/confirm-link", { body: { password: secret() }, cookie: proofCookie })).status, 401);
  const confirm = await request("/api/auth/oauth/confirm-link", { body: { password }, cookie: proofCookie });
  assert.equal(confirm.status, 200);
  for (const cookie of [oldCookie, cookieOf(confirm)]) {
    const me = await (await request("/api/auth/me", { cookie })).json();
    assert.equal(me.user.id, id); assert.equal(me.pairing.id, invite.id); assert.equal(me.pairing.status, "active");
  }
  assert.equal((await request("/api/auth/oauth/confirm-link", { body: { password }, cookie: proofCookie })).status, 410);
  assert.equal((await (await start()).callback({ email: "couple@example.invalid" }, { subject: "changed-sub" })).headers.get("location"), "/?signin=failed");
  const again = await (await start()).callback({ email: undefined });
  assert.equal((await (await request("/api/auth/me", { cookie: cookieOf(again) })).json()).user.id, id);
  const restored = await createFileStore(file);
  assert.equal((await restored.getOAuthIdentity("google", "stable-subject")).userId, id);
  assert.equal((await restored.getRelationshipContext(id)).relationship.id, invite.id);
});

test("native Apple handoff requires the originating verifier once, deletes and revokes, and separates private relay collisions", async (t) => {
  const { request, start, revoked, refresh, store, providerState } = await fixture(t);
  const verifier = secret(), email = "relay@privaterelay.appleid.com";
  const signup = { challenge: digest(verifier), adultConfirmed: true };
  const result = await (await start("apple", signup)).callback({ email, is_private_email: true });
  const handoff = new URL(result.headers.get("location"));
  assert.equal(handoff.origin, "null"); assert.equal(handoff.protocol, "us.toward.app:"); assert.equal(handoff.host, "signin");
  assert.equal(await store.getUserByEmail(email), null);
  const code = handoff.searchParams.get("code");
  const exchange = (value) => request("/api/auth/oauth/exchange", { body: { code, verifier: value } });
  assert.equal((await exchange(secret())).status, 410);
  const success = await exchange(verifier), session = cookieOf(success);
  assert.equal(success.status, 200); assert.equal((await exchange(verifier)).status, 410);
  const identity = await store.getOAuthIdentity("apple", "stable-subject");
  assert.ok(identity.revocation && !identity.revocation.includes(refresh));
  assert.equal((await (await start("apple")).callback({ email, is_private_email: true }, { subject: "other-relay" })).headers.get("location"), "/?signin=failed");
  const deleteAccount = () => request("/api/privacy/account", { method: "DELETE", cookie: session, body: { confirm: true } });
  providerState.revokeAvailable = false;
  assert.equal((await deleteAccount()).status, 503);
  assert.equal((await (await request("/api/auth/me", { cookie: session })).json()).user.id, identity.userId);
  providerState.revokeAvailable = true;
  const deleted = await deleteAccount();
  assert.equal(deleted.status, 204); assert.ok(revoked.length === 1 && revoked[0] === refresh);
  assert.equal(await store.getOAuthIdentity("apple", "stable-subject"), null);
  assert.equal((await (await request("/api/auth/me", { cookie: session })).json()).user, null);
});

test("two providers attesting the same authoritative mailbox share one account; an unhosted external address needs more proof", async (t) => {
  const { request, start, store, mailbox } = await fixture(t);
  const email = "hosted@workspace.example.invalid";
  const google = await (await start()).callback({ email, hd: "workspace.example.invalid" });
  assert.equal(google.headers.get("location"), "/");
  const apple = await (await start("apple")).callback({ email });
  assert.equal(apple.headers.get("location"), "/");
  const identities = await Promise.all([google, apple].map(async (r) => (await (await request("/api/auth/me", { cookie: cookieOf(r) })).json()).user.id));
  assert.equal(identities[0], identities[1]);
  assert.equal((await store.getUserOAuthIdentities(identities[0])).length, 2);
  const alternate = "old-address@example.invalid";
  const thirdParty = await (await start()).callback({ email: alternate }, { subject: "external" });
  assert.equal(thirdParty.headers.get("location"), "/");
  const collision = await (await start("apple")).callback({ email: alternate }, { subject: "other-provider" });
  assert.equal(collision.headers.get("location"), "/?signin=link_required");
  assert.equal(await store.getOAuthIdentity("apple", "other-provider"), null);
  assert.equal((await request("/api/auth/reset-request", { body: { email: alternate, language: "en" } })).status, 200);
  await new Promise((resolve) => setImmediate(resolve));
  const token = new URL(mailbox.at(-1).link).searchParams.get("reset"), password = secret();
  assert.equal((await request("/api/auth/reset", { body: { token, password } })).status, 204);
  assert.equal(await store.getOAuthIdentity("google", "external"), null);
  assert.equal((await (await request("/api/auth/me", { cookie: cookieOf(thirdParty) })).json()).user, null);
  const confirmed = await request("/api/auth/oauth/confirm-link", { cookie: cookieOf(collision), body: { password } });
  assert.equal(confirmed.status, 200);
  assert.equal((await (await start()).callback({ email: alternate }, { subject: "external" })).headers.get("location"), "/?signin=link_required");
});

test("old OAuth callbacks and native grants expire, and starts are bounded by IP", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const { request, start } = await fixture(t);
  const web = await start();
  t.mock.timers.tick(600_001);
  assert.equal((await web.callback()).headers.get("location"), "/?signin=failed");
  const verifier = secret();
  const native = await start("google", { challenge: digest(verifier), adultConfirmed: true });
  const code = new URL((await native.callback()).headers.get("location")).searchParams.get("code");
  t.mock.timers.tick(60_001);
  assert.equal((await request("/api/auth/oauth/exchange", { body: { code, verifier } })).status, 410);
  for (let i = 0; i < 29; ++i) assert.equal((await request("/api/auth/oauth/google/start", { body: {} })).status, 200);
  assert.equal((await request("/api/auth/oauth/google/start", { body: {} })).status, 429);
});

test("PostgreSQL commits simultaneous OAuth signups once, invalidates sessions and removes the identity on deletion", { skip: !process.env.POSTGRES_TEST_URL }, async (t) => {
  const { start, request, store } = await fixture(t, { postgres: true });
  const [one, two] = await Promise.all([start(), start()]);
  const [first, second] = await Promise.all([one.callback(), two.callback()]);
  const sessions = [first, second].map(cookieOf);
  const accounts = await Promise.all(sessions.map(async (cookie) => (await (await request("/api/auth/me", { cookie })).json()).user));
  assert.ok(accounts[0]?.id && accounts[0]?.id === accounts[1]?.id);
  assert.equal((await store.getUserOAuthIdentities(accounts[0].id)).length, 1);
  assert.equal((await request("/api/privacy/account", { method: "DELETE", cookie: sessions[0], body: { confirm: true } })).status, 204);
  assert.equal(await store.getOAuthIdentity("google", "stable-subject"), null);
  assert.equal((await (await request("/api/auth/me", { cookie: sessions[1] })).json()).user, null);
});
