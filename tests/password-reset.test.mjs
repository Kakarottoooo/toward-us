import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiApp } from "../server/app.mjs";
import { createFileStore } from "../server/store.mjs";
import { createEmailSender, resetMessage } from "../server/email.mjs";

const password = "synthetic-test-password-26";
const replacement = "replacement-password-26";
async function fixture(run, { configured = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "toward-reset-"));
  const store = await createFileStore(join(directory, "state.json"));
  const sent = [];
  const email = { configured, send: async (message) => { sent.push(message); return { sent: true }; } };
  const mediator = { aiReady: false, model: "test" };
  const server = createApiApp({ store, mediator, email }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = "GET", body, cookie, status = 200 } = {}) => {
    const response = await fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const result = response.status === 204 ? null : await response.json();
    assert.equal(response.status, status, path);
    return { ...result, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  };
  const register = (name) => request("/api/auth/register", { method: "POST", body: { name, adultConfirmed: true, email: `${name}@example.test`, password }, status: 201 });
  const requestLink = async (address) => { await request("/api/auth/reset-request", { method: "POST", body: { email: address, language: "en" } }); await new Promise((resolve) => setImmediate(resolve)); };
  const tokenOf = (message) => new URLSearchParams(new URL(message.link).hash.slice(1)).get("reset");
  try { await run({ store, request, register, requestLink, tokenOf, sent, base }); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
}

test("reset requests never reveal whether an email has an account", () => fixture(async ({ request, requestLink, sent, register, base, tokenOf }) => {
  await requestLink("nobody@example.test");
  assert.equal(sent.length, 0);
  await register("known-a");
  await requestLink(" Known-A@Example.test ");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "known-a@example.test");
  // Hosted builds run these tests with TOWARD_US_BASE_URL set; the link then points there instead of at this test server.
  const origin = (process.env.TOWARD_US_BASE_URL || base).replace(/\/+$/, "");
  assert.ok(sent[0].link.startsWith(`${origin}/#reset=`));
  assert.equal(new URL(sent[0].link).search, "");
  assert.ok(/^.+\..+$/.test(tokenOf(sent[0])));
  assert.ok(sent[0].text.includes(sent[0].link));
  assert.ok(sent[0].html.includes(`href="${sent[0].link}"`));
  const unknown = await request("/api/auth/reset-request", { method: "POST", body: { email: "nobody@example.test" } });
  assert.deepEqual({ ok: unknown.ok }, { ok: true });
}));

test("a reset link sets the new password, signs out old sessions and works once", () => fixture(async ({ request, register, requestLink, tokenOf, sent }) => {
  const a = await register("reset-a");
  await requestLink("reset-a@example.test");
  const token = tokenOf(sent[0]);
  await request("/api/auth/reset", { method: "POST", body: { token, password: "short" }, status: 400 });
  await request("/api/auth/reset", { method: "POST", body: { token: `${token}x`, password: replacement }, status: 400 });
  await request("/api/auth/me", { cookie: a.cookie });
  await request("/api/auth/reset", { method: "POST", body: { token, password: replacement }, status: 204 });
  assert.equal((await request("/api/auth/me", { cookie: a.cookie })).user, null);
  await request("/api/auth/login", { method: "POST", body: { email: "reset-a@example.test", password }, status: 401 });
  await request("/api/auth/login", { method: "POST", body: { email: "reset-a@example.test", password: replacement } });
  const again = await request("/api/auth/reset", { method: "POST", body: { token, password: "another-password-26", language: "es" }, status: 400 });
  assert.match(again.error, /enlace/);
  await request("/api/auth/login", { method: "POST", body: { email: "reset-a@example.test", password: replacement } });
}));

test("a reset link stops working after 30 minutes and a new request replaces the old link", (t) => fixture(async ({ store, request, register, requestLink, tokenOf, sent }) => {
  const a = await register("reset-b");
  await requestLink("reset-b@example.test");
  const first = tokenOf(sent[0]);
  let now = Date.now() + 30_001;
  t.mock.method(Date, "now", () => now);
  await requestLink("reset-b@example.test");
  const second = tokenOf(sent[1]);
  assert.ok(first !== second);
  await request("/api/auth/reset", { method: "POST", body: { token: first, password: replacement }, status: 400 });
  now += 30 * 60_000;
  await request("/api/auth/reset", { method: "POST", body: { token: second, password: replacement }, status: 400 });
  await request("/api/auth/login", { method: "POST", body: { email: "reset-b@example.test", password } });
  const record = await store.getRelationshipRecordForUser("accountSettings", `account:${a.user.id}`, a.user.id);
  assert.equal(Date.parse(record.passwordReset.expiresAt), now);
  assert.match(record.passwordReset.hash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(record).includes(second.split(".")[1]), false);
}));

test("a 30-second cooldown and hourly address limit both apply", (t) => fixture(async ({ register, requestLink, sent }) => {
  await register("reset-c");
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  await requestLink("reset-c@example.test");
  now += 29_999;
  await requestLink("RESET-C@example.test");
  assert.equal(sent.length, 1);
  for (let attempt = 0; attempt < 3; attempt++) {
    now += 30_000;
    await requestLink("reset-c@example.test");
  }
  assert.equal(sent.length, 3);
}));

test("one IP cannot rotate email addresses to send more reset emails", () => fixture(async ({ register, requestLink, sent }) => {
  await register("reset-d");
  for (let attempt = 0; attempt < 20; attempt++) await requestLink(`unknown-${attempt}@example.test`);
  await requestLink("reset-d@example.test");
  assert.equal(sent.length, 0);
}));

test("a missing sender returns the same temporary error for all addresses", () => fixture(async ({ request, register, sent }) => {
  await register("reset-e");
  for (const email of ["reset-e@example.test", "unknown@example.test"]) {
    const response = await request("/api/auth/reset-request", { method: "POST", body: { email, language: "es" }, status: 503 });
    assert.match(response.error, /no está disponible/);
  }
  assert.equal(sent.length, 0);
}, { configured: false }));

test("Resend requires an explicit sender and never logs message contents", async () => {
  const lines = [];
  const log = { log: (line) => lines.push(line), error: (line) => lines.push(line) };
  const mockKey = "mock-test-only";
  const message = { to: "a@example.test", ...resetMessage("en", "https://example.test/#reset=mock") };
  for (const env of [{}, { RESEND_API_KEY: mockKey }, { RESEND_API_KEY: mockKey, EMAIL_FROM: "invalid" }, { EMAIL_FROM: "sender@example.test" }]) {
    const sender = createEmailSender({ env, log, fetchImpl: assert.fail });
    assert.equal(sender.configured, false);
    assert.deepEqual(await sender.send(message), { sent: false });
  }
  assert.deepEqual(lines, []);
  let call;
  const live = createEmailSender({ env: { RESEND_API_KEY: mockKey, EMAIL_FROM: "Company <sender@example.test>" }, log, fetchImpl: async (url, options) => { call = { url, options }; return { ok: false, status: 422 }; } });
  assert.equal(live.configured, true);
  assert.deepEqual(await live.send(message), { sent: false });
  assert.equal(call.url, "https://api.resend.com/emails");
  assert.ok(call.options.headers.authorization === `Bearer ${mockKey}`);
  assert.deepEqual(JSON.parse(call.options.body), { ...message, from: "Ourever <sender@example.test>", to: [message.to] });
  assert.deepEqual(lines, ["[email] delivery failed with status 422"]);
  for (const language of ["en", "es", "zh"]) {
    const mail = resetMessage(language, "https://example.test/#reset=mock");
    assert.match(mail.subject, /Ourever/);
    assert.match(mail.text, /30/);
    assert.match(mail.html, /30/);
  }
});
