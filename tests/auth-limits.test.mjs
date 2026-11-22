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
  const call = async (path, body, { ip, status } = {}) => {
    const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(ip ? { "x-forwarded-for": ip } : {}) }, body: JSON.stringify(body) });
    const payload = response.status === 204 ? null : await response.json();
    if (status !== undefined) assert.equal(response.status, status, `${path} ${JSON.stringify(payload)}`);
    return { status: response.status, body: payload, retryAfter: response.headers.get("retry-after") };
  };
  const register = (name, extra = {}, opts = {}) => call("/api/auth/register", { name, adultConfirmed: true, email: `${name}@example.test`, password, ...extra }, opts);
  const login = (name, pass, opts = {}) => call("/api/auth/login", { email: `${name}@example.test`, password: pass, language: "en" }, opts);
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

test("failed sign-ins back off per account across networks, say how long, and an email reset clears it", () => fixture(async ({ register, login, resetByEmail, assertLimited }) => {
  await register("owner", {}, { status: 201 });
  // Two free failures from two networks, then the account waits 1 s, then 2 s …
  await login("owner", "wrong-password-1", { ip: "198.51.100.1", status: 401 });
  await login("owner", "wrong-password-2", { ip: "198.51.100.2", status: 401 });
  const first = await login("owner", password, { ip: "198.51.100.3" });
  assertLimited(first);
  assert.equal(first.body.retryAfterSeconds, 1);
  assert.match(first.body.error, /^Too many tries\. Try again in 1 second\.$/);
  await sleep(1100);
  await login("owner", "wrong-password-3", { ip: "198.51.100.4", status: 401 });
  const second = await login("owner", password, { ip: "198.51.100.5" });
  assertLimited(second);
  assert.equal(second.body.retryAfterSeconds, 2);
  // The owner is never locked out: resetting by email clears the backoff at once.
  const replacement = "replacement-password-26";
  await resetByEmail("owner", replacement);
  await login("owner", replacement, { ip: "198.51.100.6", status: 200 });
}, { trustProxy: 1, authLimits: { accountBackoff: { free: 2, maxSeconds: 900 } } }));

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

