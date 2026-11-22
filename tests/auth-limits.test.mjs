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
  const login = (name, pass, opts = {}) => call("/api/auth/login", { email: `${name}@example.test`, password: pass, language: opts.language || "en", ...opts.body }, opts);
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
    const pattern = { en: /^Too many tries\. Try again in \d+ (second|minute)s?\.( .+)?$/, zh: /^尝试次数过多，请 \d+ (秒|分钟)后再试。(.+)?$/, es: /^Demasiados intentos\. Vuelve a intentarlo en \d+ (segundo|minuto)s?\.( .+)?$/ }[language];
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

// QA round 7: reserve-then-check, email step-up instead of an account lockout, trusted devices that survive restarts and
// end with a password change, and no timing tell for addresses without an account.
const codeFrom = (message) => message.text.match(/\b(\d{6})\b/)[1];
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("spray from 26 networks in parallel: the owner on a new device and network gets an email code (not 429) and gets in", () => fixture(async ({ register, login, sent }) => {
  const home = await register("sprayed", {}, { ip: "203.0.113.5", status: 201 });
  assert.ok(home.device, "the sign-up browser is trusted");
  const results = await Promise.all(Array.from({ length: 26 }, (_, network) => Array.from({ length: 5 }, (_, guess) =>
    login("sprayed", `wrong-password-${guess}`, { ip: `198.51.100.${network + 1}` }))).flat());
  const statuses = results.reduce((count, { status }) => ({ ...count, [status]: (count[status] || 0) + 1 }), {});
  assert.deepEqual(statuses, { 401: 130 }, "every guess is answered the same, nobody is locked out");
  // The owner, new device, new network, right password: asked for the emailed code.
  const mailsBefore = sent.length;
  const stepUp = await login("sprayed", password, { ip: "192.0.2.77", status: 202 });
  assert.equal(stepUp.body.code, "verify_email");
  assert.match(stepUp.body.error, /6-digit code/);
  assert.equal(stepUp.device, null, "no session or trust before the code");
  await settle();
  assert.equal(sent.length, mailsBefore + 1);
  assert.equal(sent.at(-1).to, "sprayed@example.test");
  assert.match(sent.at(-1).subject, /sign-in code/);
  // A wrong code is refused (and the right password alone never signs in); the right code signs in and trusts the device.
  const wrongCode = codeFrom(sent.at(-1)) === "000000" ? "111111" : "000000";
  assert.equal((await login("sprayed", password, { ip: "192.0.2.77", body: { emailCode: wrongCode }, status: 401 })).body.code, "invalid_email_code");
  const asked = await login("sprayed", password, { ip: "192.0.2.77", status: 202 });
  assert.equal(asked.body.code, "verify_email");
  await settle();
  assert.equal(sent.length, mailsBefore + 1, "a second email isn't sent within a minute; the first code still works");
  const done = await login("sprayed", password, { ip: "192.0.2.77", body: { emailCode: codeFrom(sent.at(-1)) }, status: 200 });
  assert.ok(done.device);
  // That device, and the sign-up browser, now sign in directly from anywhere while the attack goes on.
  await login("sprayed", password, { ip: "192.0.2.78", cookie: done.device, status: 200 });
  await login("sprayed", password, { ip: "192.0.2.79", cookie: home.device, status: 200 });
  // A code is used once.
  await login("sprayed", password, { ip: "192.0.2.80", body: { emailCode: codeFrom(sent.at(-1)) }, status: 401 });
}, { trustProxy: 1 }));

test("wrong passwords at an account under attack get the normal 401 after a short fixed delay", () => fixture(async ({ register, login }) => {
  await register("slowed", {}, { status: 201 });
  for (let index = 0; index < 3; index += 1) await login("slowed", "wrong-password-1", { ip: `198.51.100.${index + 1}`, status: 401 });
  const started = Date.now();
  const held = await login("slowed", "wrong-password-2", { ip: "198.51.100.9", status: 401 });
  assert.equal(held.body.code, "invalid_credentials");
  assert.ok(Date.now() - started >= 280, "held for the fixed delay");
  // An address with no account behaves the same once it is being sprayed.
  for (let index = 0; index < 3; index += 1) await login("ghost", "wrong-password-1", { ip: `198.51.100.${index + 20}`, status: 401 });
  const ghostStarted = Date.now();
  await login("ghost", "wrong-password-1", { ip: "198.51.100.30", status: 401 });
  assert.ok(Date.now() - ghostStarted >= 280);
}, { trustProxy: 1, authLimits: { accountAttack: { threshold: 3, windowMs: 60 * 60_000, delayMs: 300 } } }));

test("120 parallel wrong tries from one network: at most the cap is evaluated, the rest wait (with the reset hint)", () => fixture(async ({ register, login, assertLimited }) => {
  await register("race", {}, { status: 201 });
  const same = await Promise.all(Array.from({ length: 120 }, () => login("race", "wrong-password-1", { ip: "198.51.100.40" })));
  assert.equal(same.filter(({ status }) => status === 401).length, 10, "per network and address: 10 compares");
  assert.equal(same.filter(({ status }) => status === 429).length, 110);
  assertLimited(same.find(({ status }) => status === 429));
  const spread = await Promise.all(Array.from({ length: 120 }, (_, index) => login(`race${index}`, "wrong-password-1", { ip: "198.51.100.41" })));
  assert.equal(spread.filter(({ status }) => status === 401).length, 50, "per network across addresses: 50 compares");
  assert.equal(spread.filter(({ status }) => status === 429).length, 70);
}, { trustProxy: 1 }));

test("the owner's right password gives back the network's slots, so typos never add up to a wait", () => fixture(async ({ register, login }) => {
  await register("typo", {}, { status: 201 });
  for (let round = 0; round < 3; round += 1) {
    for (let index = 0; index < 3; index += 1) await login("typo", "wrong-password-1", { ip: "198.51.100.50", status: 401 });
    await login("typo", password, { ip: "198.51.100.50", status: 200 });
  }
}, { trustProxy: 1, authLimits: { loginPerIpEmail: { max: 4, windowMs: 10 * 60_000 } } }));

test("a too-many-tries answer says when to retry and that the email reset works now, in each language", () => fixture(async ({ login, assertLimited }) => {
  for (let index = 0; index < 2; index += 1) await login("hint", "wrong-password-1", { ip: "198.51.100.60", status: 401 });
  for (const [language, pattern] of [["en", /Forgot password\?.*reset it by email right now\.$/], ["zh", /忘记密码？.*用邮件重设密码。$/], ["es", /¿Olvidaste tu contraseña\?.*por correo ahora mismo\.$/]]) {
    const limited = await login("hint", "wrong-password-1", { ip: "198.51.100.60", language });
    assertLimited(limited, language);
    assert.match(limited.body.error, pattern);
    assert.equal(limited.body.reset, true);
  }
}, { trustProxy: 1, authLimits: { loginPerIpEmail: { max: 2, windowMs: 10 * 60_000 } } }));

test("trusted devices survive a restart; a password change or reset un-trusts them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "toward-trusted-device-"));
  const file = join(directory, "state.json");
  const start = async () => {
    const sent = [];
    const store = await createFileStore(file);
    const server = createApiApp({ store, mediator: { aiReady: false, model: "test" }, email: { configured: true, send: async (message) => { sent.push(message); return { sent: true }; } }, trustProxy: 1, authLimits: { accountAttack: { threshold: 3, windowMs: 60 * 60_000, delayMs: 0 } } }).listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (path, body, { ip = "203.0.113.1", cookie = "", method = "POST" } = {}) => {
      const response = await fetch(base + path, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
      const cookies = response.headers.getSetCookie().map((line) => line.split(";")[0]);
      return { status: response.status, body: response.status === 204 ? null : await response.json(), device: cookies.find((line) => line.startsWith("toward_us_device=")) || null, session: cookies.find((line) => line.startsWith("toward_us_session=")) || null };
    };
    const login = (pass, options) => call("/api/auth/login", { email: "keeps@example.test", password: pass, language: "en" }, options);
    const spray = async () => { for (let index = 0; index < 3; index += 1) assert.equal((await login("wrong-password-1", { ip: `198.51.100.${index + 1}` })).status, 401); };
    const stop = async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); };
    return { call, login, spray, stop, sent };
  };
  try {
    let app = await start();
    const created = await app.call("/api/auth/register", { name: "Keeps", email: "keeps@example.test", password, adultConfirmed: true });
    assert.equal(created.status, 201);
    await app.stop();
    // A new process (fresh counts): under attack, the sign-up browser's cookie still signs in directly; a new one is asked.
    app = await start();
    await app.spray();
    assert.equal((await app.login(password, { ip: "192.0.2.10", cookie: created.device })).status, 200);
    assert.equal((await app.login(password, { ip: "192.0.2.11" })).status, 202);
    // Changing the password un-trusts every device, including this one.
    const signedIn = await app.login(password, { ip: "192.0.2.12", cookie: created.device });
    const newPassword = "changed-password-26";
    assert.equal((await app.call("/api/privacy/account", { password, newPassword }, { method: "PATCH", cookie: signedIn.session })).status, 204);
    assert.equal((await app.login(newPassword, { ip: "192.0.2.13", cookie: created.device })).status, 202);
    // Trusted again after the email code; a reset by email then un-trusts it again.
    await settle();
    const again = await app.login(newPassword, { ip: "192.0.2.13", cookie: created.device });
    const confirmed = await app.call("/api/auth/login", { email: "keeps@example.test", password: newPassword, emailCode: codeFrom(app.sent.at(-1)) }, { ip: "192.0.2.13", cookie: created.device });
    assert.equal(again.status, 202); assert.equal(confirmed.status, 200);
    assert.equal((await app.login(newPassword, { ip: "192.0.2.14", cookie: confirmed.device })).status, 200);
    await app.call("/api/auth/reset-request", { email: "keeps@example.test", language: "en" });
    await settle();
    const token = new URLSearchParams(new URL(app.sent.at(-1).link).hash.slice(1)).get("reset");
    assert.equal((await app.call("/api/auth/reset", { token, password: "after-reset-password-26" })).status, 204);
    // The reset proved the mailbox, so the attack window starts over: everyone signs in directly until a new attack.
    assert.equal((await app.login("after-reset-password-26", { ip: "192.0.2.15", cookie: confirmed.device })).status, 200);
    await app.spray();
    assert.equal((await app.login("after-reset-password-26", { ip: "192.0.2.16", cookie: confirmed.device })).status, 202, "the reset un-trusted the old cookie");
    await app.stop();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a device cookie for another account, or a forged one, proves nothing", () => fixture(async ({ register, login }) => {
  await register("victim", {}, { status: 201 });
  const other = await register("bystander", {}, { status: 201 });
  for (let index = 0; index < 3; index += 1) await login("victim", "wrong-password-1", { ip: `198.51.100.${index + 1}`, status: 401 });
  await login("victim", password, { ip: "192.0.2.20", cookie: other.device, status: 202 });
  await login("victim", password, { ip: "192.0.2.21", cookie: "toward_us_device=" + "A".repeat(32), status: 202 });
  // The bystander's own cookie still works for the bystander.
  await login("bystander", password, { ip: "192.0.2.22", cookie: other.device, status: 200 });
}, { trustProxy: 1, authLimits: { accountAttack: { threshold: 3, windowMs: 60 * 60_000, delayMs: 0 } } }));

test("without a configured proxy, one shared address past its caps is never a global lockout: new devices take the email step", () => fixture(async ({ register, login }) => {
  const home = await register("shared", {}, { status: 201 });
  for (let index = 0; index < 6; index += 1) await login(`stranger${index}`, "wrong-password-1", { status: 401 });
  // Past the per-network cap nobody gets 429: the owner on a new device is asked for the emailed code, the known device
  // signs in directly, and wrong passwords still get the normal answer.
  assert.equal((await login("shared", password)).status, 202);
  await login("shared", password, { cookie: home.device, status: 200 });
  await login("stranger9", "wrong-password-1", { status: 401 });
}, { trustProxy: "", authLimits: { loginPerIp: { max: 3, windowMs: 15 * 60_000 } } }));

test("timing: a wrong password for an address without an account takes as long as for one with an account", () => fixture(async ({ register, login }) => {
  await register("timed", {}, { status: 201 });
  const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const time = async (name, index) => { const started = performance.now(); await login(name, "wrong-password-1", { ip: `198.51.100.${index}`, status: 401 }); return performance.now() - started; };
  const existing = [], missing = [];
  for (let index = 0; index < 11; index += 1) { existing.push(await time("timed", 100 + index)); missing.push(await time("nobody-here", 150 + index)); }
  const [a, b] = [median(existing), median(missing)];
  assert.ok(b > 20, `the missing-account answer pays for a compare (${b.toFixed(1)} ms)`);
  // Medians of 11, and a margin loose enough for a busy build machine: what matters is no 20x gap (no dummy compare).
  assert.ok(Math.abs(a - b) < Math.max(25, 0.5 * a), `existing ${a.toFixed(1)} ms vs missing ${b.toFixed(1)} ms`);
}, { trustProxy: 1 }));

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

test("X-Forwarded-For is ignored unless TRUST_PROXY is set", () => fixture(async ({ register, login }) => {
  // No proxy configured: every request is the socket address, whatever the header claims. The shared address is past its
  // cap after two tries, so x3's right password from an unknown device takes the email step (never a 429 there).
  await register("x3", {}, { status: 201 });
  await login("x1", "wrong-password-1", { ip: "203.0.113.21", status: 401 });
  await login("x2", "wrong-password-1", { ip: "203.0.113.22", status: 401 });
  assert.equal((await login("x3", password, { ip: "203.0.113.23" })).body.code, "verify_email");
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

