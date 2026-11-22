// QA round 5 (findings 8–11): sign-up, sign-in and recovery limits, and which address they count.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiApp } from "../server/app.mjs";
import { createFileStore } from "../server/store.mjs";
import { trustProxySetting } from "../server/auth-limits.mjs";

const password = "synthetic-test-password-26";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fixture(run, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "toward-auth-limits-"));
  const store = await createFileStore(join(directory, "state.json"));
  const sent = [];
  const email = { configured: true, send: async (message) => { sent.push(message); return { sent: true }; } };
  const server = createApiApp({ store, mediator: { aiReady: false, model: "test" }, email, ...options }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body, { ip, status, cookie, headers = {} } = {}) => {
    const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(ip ? { "x-forwarded-for": ip } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: JSON.stringify(body) });
    const payload = response.status === 204 ? null : await response.json();
    if (status !== undefined) assert.equal(response.status, status, `${path} ${JSON.stringify(payload)}`);
    const device = response.headers.getSetCookie().map((line) => line.split(";")[0]).find((line) => line.startsWith("toward_us_device=")) || null;
    return { status: response.status, body: payload, retryAfter: response.headers.get("retry-after"), device };
  };
  const register = (name, extra = {}, opts = {}) => call("/api/auth/register", { name, adultConfirmed: true, email: `${name}@example.test`, password, ...extra }, opts);
  const login = (name, pass, opts = {}) => call("/api/auth/login", { email: `${name}@example.test`, password: pass, language: opts.language || "en" }, opts);
  const resetByEmail = async (name, newPassword) => {
    await call("/api/auth/reset-request", { email: `${name}@example.test`, language: "en" }, { status: 200 });
    await new Promise((resolve) => setImmediate(resolve));
    const token = new URLSearchParams(new URL(sent.at(-1).link).hash.slice(1)).get("reset");
    await call("/api/auth/reset", { token, password: newPassword }, { status: 204 });
  };
  const assertLimited = (result, language = "en") => {
    assert.equal(result.status, 429, JSON.stringify(result.body));
    assert.equal(result.body.code, "rate_limited");
    assert.ok(result.body.retryAfterSeconds > 0, JSON.stringify(result.body));
    assert.equal(result.retryAfter, String(result.body.retryAfterSeconds));
    const pattern = { en: /^Too many tries\. Try again in \d+ (second|minute)s?\.$/, zh: /^尝试次数过多，请 \d+ (秒|分钟)后再试。$/, es: /^Demasiados intentos\. Vuelve a intentarlo en \d+ (segundo|minuto)s?\.$/ }[language];
    assert.match(result.body.error, pattern);
  };
  try { await run({ call, register, login, resetByEmail, assertLimited, sent }); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
}

test("sign-up is capped per network; 'already registered' counts, invalid input does not; the wait is localized", () => fixture(async ({ register, assertLimited }) => {
  // Invalid input is refused before anything counts.
  for (let index = 0; index < 5; index += 1) await register("short", { password: "short" }, { status: 400 });
  await register("first", {}, { status: 201 });
  const taken = await register("first", { language: "en" }, { status: 409 });
  assert.equal(taken.body.code, "email_registered");
  assert.match(taken.body.error, /already registered.*reset your password/);
  await register("first", { language: "es" }, { status: 409 });
  // Three counted (one created, two taken): the fourth is refused, whatever the address, in the reader's language.
  assertLimited(await register("second", { language: "zh" }), "zh");
  assertLimited(await register("third", { language: "es" }), "es");
  const result = await register("fourth", { language: "en" });
  assertLimited(result);
  assert.ok(result.body.retryAfterSeconds > 3500 && result.body.retryAfterSeconds <= 3600, JSON.stringify(result.body));
}, { authLimits: { registerPerIp: { max: 3, windowMs: 60 * 60_000 } } }));

test("sign-up has a global cap across networks", () => fixture(async ({ register, assertLimited }) => {
  await register("g1", {}, { ip: "203.0.113.1", status: 201 });
  await register("g2", {}, { ip: "203.0.113.2", status: 201 });
  assertLimited(await register("g3", { language: "en" }, { ip: "203.0.113.3" }));
}, { trustProxy: 1, authLimits: { registerGlobal: { max: 2, windowMs: 10 * 60_000 } } }));

test("a stranger cannot lock the owner out: the right password always works; only wrong ones are slowed", () => fixture(async ({ register, login, resetByEmail }) => {
  await register("owner", {}, { status: 201 });
  // Two free failures from two networks; further wrong passwords are answered with the same 401 after the backoff.
  await login("owner", "wrong-password-1", { ip: "198.51.100.1", status: 401 });
  await login("owner", "wrong-password-2", { ip: "198.51.100.2", status: 401 });
  const started = Date.now();
  const held = await login("owner", "wrong-password-3", { ip: "198.51.100.3", status: 401 });
  assert.equal(held.body.code, "invalid_credentials");
  assert.ok(Date.now() - started >= 900, "the wrong answer waited for the backoff");
  // An unknown address behaves identically (no hint that the account exists).
  await login("nobody", "wrong-password-1", { ip: "198.51.100.1", status: 401 });
  // The owner, from a network that never failed, signs in at once while the account is backing off.
  await login("owner", password, { ip: "198.51.100.9", status: 200 });
  // A reset by email still works.
  const replacement = "replacement-password-26";
  await resetByEmail("owner", replacement);
  await login("owner", replacement, { ip: "198.51.100.6", status: 200 });
}, { trustProxy: 1, authLimits: { accountBackoff: { free: 2, maxSeconds: 900, maxHoldSeconds: 2 } } }));

test("lockout simulation (QA round 6): an attacker hammering an account never makes the owner wait", () => fixture(async ({ register, login }) => {
  await register("victim", {}, { status: 201 });
  // The attacker's own network runs out of tries; the owner's network never does.
  for (let index = 0; index < 4; index += 1) await login("victim", `wrong-password-${index}`, { ip: "198.51.100.7", status: 401 });
  assert.equal((await login("victim", "wrong-password-9", { ip: "198.51.100.7" })).status, 429);
  for (let index = 0; index < 5; index += 1) await login("victim", password, { ip: "203.0.113.10", status: 200 });
}, { trustProxy: 1, authLimits: { loginPerIpEmail: { max: 4, windowMs: 10 * 60_000 }, accountBackoff: { free: 1000, maxSeconds: 900 } } }));

test("lockout simulation in virtual time (QA round 6 out/lockout-sim): an hour of attack, then the owner every minute is never refused", async () => {
  const { createAuthLimits } = await import("../server/auth-limits.mjs");
  const realNow = Date.now; let t = 1_000_000; Date.now = () => t;
  try {
    const limits = createAuthLimits(); const email = "victim@example.invalid";
    while (t < 1_000_000 + 60 * 60_000) { const wait = limits.loginWait("198.51.100.7", email); if (wait) { t += wait * 1000; continue; } limits.loginFailed("198.51.100.7", email); t += 1; }
    let refused = 0;
    for (let minute = 0; minute < 60; minute += 1) {
      t += 60_000;
      if (!limits.loginWait("198.51.100.7", email)) limits.loginFailed("198.51.100.7", email);
      if (limits.loginWait("203.0.113.10", email)) refused += 1;
    }
    assert.equal(refused, 0);
  } finally { Date.now = realNow; }
});

test("distributed guessing hits a per-account ceiling that never blocks a device or network that signed in before", () => fixture(async ({ register, login, resetByEmail }) => {
  const first = await register("ceiling", {}, { ip: "203.0.113.50", status: 201 });
  const known = await login("ceiling", password, { ip: "203.0.113.51", status: 200 });
  assert.ok(known.device && first.device, "a device cookie is set on sign-up and sign-in");
  // Ten networks, one wrong guess each: the account's hourly ceiling (5) is passed.
  for (let index = 0; index < 10; index += 1) {
    const result = await login("ceiling", "wrong-password-1", { ip: `198.51.100.${100 + index}` });
    assert.ok([401, 429].includes(result.status), JSON.stringify(result.body));
  }
  // A brand-new device on a brand-new network is refused, whether or not the password is right.
  const wrong = await login("ceiling", "wrong-password-2", { ip: "192.0.2.200" });
  const right = await login("ceiling", password, { ip: "192.0.2.201" });
  assert.equal(wrong.status, 429); assert.equal(right.status, 429);
  // The browser that signed in before, from anywhere, and the network that signed in before, are never refused.
  await login("ceiling", password, { ip: "192.0.2.202", cookie: known.device, status: 200 });
  await login("ceiling", password, { ip: "192.0.2.203", cookie: first.device, status: 200 });
  await login("ceiling", password, { ip: "203.0.113.51", status: 200 });
  // A device cookie for another account proves nothing here.
  await register("other", {}, { ip: "203.0.113.60", status: 201 });
  const otherDevice = (await login("other", password, { ip: "203.0.113.60", status: 200 })).device;
  assert.equal((await login("ceiling", password, { ip: "192.0.2.204", cookie: otherDevice })).status, 429);
  // A reset by email clears the ceiling.
  await resetByEmail("ceiling", "after-reset-password-26");
  await login("ceiling", "after-reset-password-26", { ip: "192.0.2.205", status: 200 });
}, { trustProxy: 1, authLimits: { accountCeiling: { max: 5, windowMs: 60 * 60_000 }, accountBackoff: { free: 1000, maxSeconds: 900 } } }));

test("a wrong password is answered in the reader's language with a code the App maps itself", () => fixture(async ({ login, call }) => {
  for (const [language, pattern] of [["en", /^The email or password is incorrect\.$/], ["es", /^El correo o la contraseña son incorrectos\.$/], ["zh", /^邮箱或密码不正确。$/]]) {
    const result = await login("nobody", "wrong-password-1", { language, status: 401 });
    assert.equal(result.body.code, "invalid_credentials"); assert.match(result.body.error, pattern);
  }
  const byHeader = await call("/api/auth/login", { email: "nobody@example.test", password: "wrong-password-1" }, { headers: { "accept-language": "fr-FR, es;q=0.9, en;q=0.5" }, status: 401 });
  assert.match(byHeader.body.error, /^El correo/);
}));

test("without a configured proxy the per-network caps are raised so one shared address is not a global lock", () => fixture(async ({ register }) => {
  // The default per-network sign-up cap is 20 an hour; with no proxy configured 25 sign-ups from one address go through.
  for (let index = 0; index < 25; index += 1) await register(`shared${index}`, {}, { status: 201 });
}, { trustProxy: "" }));

test("Accept-Language q-values decide the sign-up language", async () => {
  const { acceptedLanguage } = await import("../server/auth.mjs");
  assert.equal(acceptedLanguage("fr-FR,fr;q=0.9,es;q=0.8,en;q=0.7"), "es");
  assert.equal(acceptedLanguage("en;q=0.2, zh-CN;q=0.9"), "zh");
  assert.equal(acceptedLanguage("es-MX"), "es");
  assert.equal(acceptedLanguage("es;q=0, en;q=0.1"), "en");
  assert.equal(acceptedLanguage("de, fr"), null);
  assert.equal(acceptedLanguage(""), null);
});

test("sessions slide: used past half their life they renew (cookie too), capped at a year, and sign-out still ends them", async () => {
  const { renewedSessionExpiry, sessionId } = await import("../server/auth.mjs");
  const day = 86_400_000, created = Date.parse("2026-01-01T00:00:00Z");
  const session = (expiresAt) => ({ createdAt: new Date(created).toISOString(), expiresAt: new Date(expiresAt).toISOString() });
  assert.equal(renewedSessionExpiry(session(created + 30 * day), new Date(created + 5 * day)), null, "fresh sessions are left alone");
  assert.equal(renewedSessionExpiry(session(created + 30 * day), new Date(created + 20 * day)), new Date(created + 50 * day).toISOString());
  assert.equal(renewedSessionExpiry(session(created + 360 * day), new Date(created + 350 * day)), new Date(created + 365 * day).toISOString(), "never past a year");
  assert.equal(renewedSessionExpiry(session(created + 365 * day), new Date(created + 364 * day)), null);

  const directory = await mkdtemp(join(tmpdir(), "toward-session-slide-"));
  const store = await createFileStore(join(directory, "state.json"));
  const server = createApiApp({ store, mediator: { aiReady: false, model: "test" } }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const signup = await fetch(base + "/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Slide", email: "slide@example.test", password, adultConfirmed: true }) });
    const cookie = signup.headers.getSetCookie().find((line) => line.startsWith("toward_us_session=")).split(";")[0];
    const id = sessionId(decodeURIComponent(cookie.slice("toward_us_session=".length)));
    // Age the session to 20 of 30 days, then use it: it is extended and the cookie refreshed.
    await store.extendSession(id, new Date(Date.now() + 10 * day).toISOString());
    const me = await fetch(base + "/api/auth/me", { headers: { cookie } });
    assert.equal((await me.json()).user.name, "Slide");
    const refreshed = me.headers.getSetCookie().find((line) => line.startsWith("toward_us_session="));
    assert.match(refreshed, /Max-Age=259\d{4}/, refreshed);
    assert.ok(Date.parse((await store.getSession(id)).expiresAt) > Date.now() + 29 * day);
    // Used again at once: nothing to renew, no cookie.
    assert.equal((await fetch(base + "/api/auth/me", { headers: { cookie } })).headers.getSetCookie().length, 0);
    // Sign-out still ends it, and a revoked session is never revived.
    await fetch(base + "/api/auth/logout", { method: "POST", headers: { cookie } });
    assert.equal(await store.extendSession(id, new Date(Date.now() + 30 * day).toISOString()), false);
    assert.equal((await (await fetch(base + "/api/auth/me", { headers: { cookie } })).json()).user, null);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});

test("the account backoff is capped at 15 minutes by default", async () => {
  const { backoff } = await import("../server/auth-limits.mjs");
  let now = 0; const limiter = backoff({ free: 5, maxSeconds: 900 }, () => now);
  for (let index = 0; index < 5; index += 1) limiter.fail("k");
  assert.equal(limiter.wait("k"), 1);
  for (let index = 0; index < 20; index += 1) limiter.fail("k");
  assert.equal(limiter.wait("k"), 900);
  now += 900_000; assert.equal(limiter.wait("k"), 0);
});

test("one network is capped across all addresses; another network is not", () => fixture(async ({ login, assertLimited }) => {
  for (const name of ["a", "b", "c"]) await login(name, "wrong-password-1", { ip: "192.0.2.10", status: 401 });
  assertLimited(await login("d", "wrong-password-1", { ip: "192.0.2.10" }));
  await login("d", "wrong-password-1", { ip: "192.0.2.11", status: 401 });
}, { trustProxy: 1, authLimits: { loginPerIp: { max: 3, windowMs: 15 * 60_000 } } }));

test("X-Forwarded-For is ignored unless TRUST_PROXY is set", () => fixture(async ({ login, assertLimited }) => {
  // No proxy configured: every request is the socket address, whatever the header claims.
  await login("x1", "wrong-password-1", { ip: "203.0.113.21", status: 401 });
  await login("x2", "wrong-password-1", { ip: "203.0.113.22", status: 401 });
  assertLimited(await login("x3", "wrong-password-1", { ip: "203.0.113.23" }));
}, { trustProxy: "", authLimits: { loginPerIp: { max: 2, windowMs: 15 * 60_000 } } })); // "" = not configured, even on Render (RENDER is set there)

test("with TRUST_PROXY=1 the client is the right-most X-Forwarded-For entry (what the one proxy appended)", () => fixture(async ({ login, assertLimited }) => {
  // A client-supplied left part changes nothing; the address the proxy appended is what counts.
  await login("y1", "wrong-password-1", { ip: "203.0.113.31, 198.51.100.77", status: 401 });
  await login("y2", "wrong-password-1", { ip: "203.0.113.32, 198.51.100.77", status: 401 });
  assertLimited(await login("y3", "wrong-password-1", { ip: "198.51.100.77" }));
  await login("y4", "wrong-password-1", { ip: "198.51.100.77, 198.51.100.78", status: 401 });
}, { trustProxy: trustProxySetting("1"), authLimits: { loginPerIp: { max: 2, windowMs: 15 * 60_000 } } }));

test("TRUST_PROXY parsing and the Render blueprint", async () => {
  assert.equal(trustProxySetting(undefined), false);
  assert.equal(trustProxySetting(""), false);
  assert.equal(trustProxySetting("false"), false);
  assert.equal(trustProxySetting("1"), 1);
  assert.equal(trustProxySetting("loopback"), "loopback");
  assert.match(await readFile(new URL("../render.yaml", import.meta.url), "utf8"), /key:\s+TRUST_PROXY\s+value:\s+"1"/);
});

test("recovery: a too-short new password is refused before it counts toward the limit", () => fixture(async ({ register, call }) => {
  await register("short-recover", {}, { status: 201 });
  const guess = { email: "short-recover@example.test", recoveryCode: "0000-0000", language: "en" };
  for (let index = 0; index < 10; index += 1) await call("/api/auth/recover", { ...guess, password: "short" }, { status: 400 });
  await call("/api/auth/recover", { ...guess, password: "long-enough-password-26" }, { status: 401 });
}));

test("recovery guesses from rotating networks back off with a visible wait, and email reset still works", () => fixture(async ({ register, call, login, resetByEmail, assertLimited }) => {
  await register("sprayed", {}, { status: 201 });
  const guess = { email: "sprayed@example.test", recoveryCode: "0000-0000", password: "long-enough-password-26", language: "en" };
  await call("/api/auth/recover", guess, { ip: "203.0.113.41", status: 401 });
  await call("/api/auth/recover", guess, { ip: "203.0.113.42", status: 401 });
  const blocked = await call("/api/auth/recover", guess, { ip: "203.0.113.43" });
  assertLimited(blocked);
  assert.equal(blocked.body.retryAfterSeconds, 1);
  // The owner's mailbox route stays open while recovery-code guesses wait, and it clears the backoff.
  await resetByEmail("sprayed", "owner-new-password-26");
  await login("sprayed", "owner-new-password-26", { ip: "203.0.113.44", status: 200 });
  await call("/api/auth/recover", guess, { ip: "203.0.113.45", status: 401 });
}, { trustProxy: 1, authLimits: { recoveryBackoff: { free: 2, maxSeconds: 900 } } }));

