import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiApp } from "../server/app.mjs";
import { createFileStore } from "../server/store.mjs";
import { createEmailSender } from "../server/email.mjs";

const password = "synthetic-test-password-26";
const replacement = "replacement-password-26";
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "toward-reset-"));
  const store = await createFileStore(join(directory, "state.json"));
  const sent = [];
  const email = { configured: true, send: async (message) => { sent.push(message); return { sent: true }; } };
  const mediator = { aiReady: false, model: "test" };
  const server = createApiApp({ store, mediator, email }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = "GET", body, cookie, status = 200 } = {}) => {
    const response = await fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const result = response.status === 204 ? null : await response.json();
    assert.equal(response.status, status, `${path}: ${JSON.stringify(result)}`);
    return { ...result, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  };
  const register = (name) => request("/api/auth/register", { method: "POST", body: { name, email: `${name}@example.test`, password }, status: 201 });
  const requestLink = async (address) => { await request("/api/auth/reset-request", { method: "POST", body: { email: address, language: "en" } }); await new Promise((resolve) => setImmediate(resolve)); };
  const tokenOf = (message) => new URL(message.link).searchParams.get("reset");
  try { await run({ store, request, register, requestLink, tokenOf, sent, base }); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
}

test("reset requests never reveal whether an email has an account", () => fixture(async ({ request, requestLink, sent, register }) => {
  await requestLink("nobody@example.test");
  assert.equal(sent.length, 0);
  await register("known-a");
  await requestLink(" Known-A@Example.test ");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "known-a@example.test");
  assert.match(sent[0].link, /^http:\/\/127\.0\.0\.1:\d+\/\?reset=.+\..+/);
  assert.ok(sent[0].text.includes(sent[0].link));
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

test("a reset link stops working after 30 minutes and a new request replaces the old link", () => fixture(async ({ store, request, register, requestLink, tokenOf, sent }) => {
  const a = await register("reset-b");
  await requestLink("reset-b@example.test");
  const first = tokenOf(sent[0]);
  await requestLink("reset-b@example.test");
  const second = tokenOf(sent[1]);
  assert.notEqual(first, second);
  await request("/api/auth/reset", { method: "POST", body: { token: first, password: replacement }, status: 400 });
  await store.updateRelationshipRecordForUser("accountSettings", `account:${a.user.id}`, a.user.id, (record) => { record.passwordReset.expiresAt = new Date(Date.now() - 1000).toISOString(); });
  await request("/api/auth/reset", { method: "POST", body: { token: second, password: replacement }, status: 400 });
  await request("/api/auth/login", { method: "POST", body: { email: "reset-b@example.test", password } });
  const record = await store.getRelationshipRecordForUser("accountSettings", `account:${a.user.id}`, a.user.id);
  assert.match(record.passwordReset.hash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(record).includes(second.split(".")[1]), false);
}));

test("too many reset requests still answer 200 but stop sending", () => fixture(async ({ register, requestLink, sent }) => {
  await register("reset-c");
  for (let index = 0; index < 5; index += 1) await requestLink("reset-c@example.test");
  assert.equal(sent.length, 3);
}));

test("the email sender logs locally, stays quiet in production and never leaks the key", async () => {
  const lines = [];
  const log = { log: (line) => lines.push(line), error: (line) => lines.push(line) };
  const local = createEmailSender({ env: {}, log });
  assert.equal(local.configured, false);
  await local.send({ to: "a@example.test", subject: "Hello", text: "body", link: "https://x.test/?reset=1" });
  assert.deepEqual(lines, ["[email to a@example.test] Hello https://x.test/?reset=1"]);
  await createEmailSender({ env: { NODE_ENV: "production" }, log }).send({ to: "a@example.test", subject: "Hello", text: "body" });
  assert.equal(lines.length, 1);
  let call;
  const live = createEmailSender({ env: { RESEND_API_KEY: "re_secret_key" }, log, fetchImpl: async (url, options) => { call = { url, options }; return { ok: false, status: 422 }; } });
  assert.equal(live.configured, true);
  await live.send({ to: "a@example.test", subject: "Hello", text: "secret body" });
  assert.equal(call.url, "https://api.resend.com/emails");
  assert.equal(call.options.headers.authorization, "Bearer re_secret_key");
  assert.equal(JSON.parse(call.options.body).from, "Pinky <onboarding@resend.dev>");
  assert.deepEqual(lines.slice(1), ["[email] delivery failed with status 422"]);
});
