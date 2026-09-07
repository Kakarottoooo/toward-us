import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiApp } from "../server/app.mjs";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";

const password = "synthetic-test-password-26";
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "toward-privacy-"));
  const store = await createFileStore(join(directory, "state.json"));
  const mediator = { aiReady: false, model: "test", continuePrivateAgentThread: async ({ messages }) => ({ reply: "Private draft", readyToShare: true, source: "test", draft: { title: "A small decision", shareableSummary: messages.at(-1).text, goal: "private goal" } }) };
  const server = createApiApp({ store, mediator }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = "GET", body, cookie, status = 200 } = {}) => {
    const response = await fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const result = response.status === 204 ? null : await response.json();
    assert.equal(response.status, status, `${path}: ${JSON.stringify(result)}`);
    return { ...result, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  };
  const register = async (name) => request("/api/auth/register", { method: "POST", body: { name, email: `${name}@example.test`, password }, status: 201 });
  try { await run({ store, request, register, mediator }); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
}

test("an unpaired person can think privately, then explicitly share an exact preview after pairing", () => fixture(async ({ register, request }) => {
  const a = await register("solo-a"); const b = await register("solo-b");
  const created = await request("/api/private-agent/threads", { cookie: a.cookie, method: "POST", body: { intentType: "decision" }, status: 201 });
  assert.equal(created.thread.relationshipId, null);
  const thought = await request(`/api/private-agent/threads/${created.thread.id}/messages`, { cookie: a.cookie, method: "POST", body: { text: "ONLY_A_RAW_THOUGHT" } });
  await request(`/api/private-agent/threads/${created.thread.id}`, { cookie: b.cookie, status: 404 });
  assert.equal((await request("/api/private-agent/threads", { cookie: b.cookie })).threads.length, 0);
  await request(`/api/private-agent/threads/${created.thread.id}/share-decision`, { cookie: a.cookie, method: "POST", body: {}, status: 409 });
  const invite = await request("/api/partner/invitations", { cookie: a.cookie, method: "POST", body: {}, status: 201 });
  await request("/api/partner/accept", { cookie: b.cookie, method: "POST", body: { code: invite.pairing.invitation.code } });
  const before = await request("/api/relationship/home", { cookie: b.cookie });
  assert.equal(before.graph.issues.length, 0); assert.equal(JSON.stringify(before).includes("ONLY_A_RAW_THOUGHT"), false);
  const preview = await request(`/api/private-agent/threads/${created.thread.id}/share-preview`, { cookie: a.cookie, method: "POST", body: { summary: "We can choose a time to talk." } });
  await request(`/api/private-agent/threads/${created.thread.id}/share-decision`, { cookie: a.cookie, method: "POST", body: { ...preview.preview, digest: preview.digest, confirm: true, summary: "changed text" }, status: 409 });
  const shares = await Promise.all(Array.from({ length: 2 }, (_, index) => request(`/api/private-agent/threads/${created.thread.id}/share-decision`, { cookie: a.cookie, method: "POST", body: { ...preview.preview, digest: preview.digest, confirm: true }, status: index ? 200 : 201 })));
  assert.equal(shares[0].issue.id, shares[1].issue.id);
  const after = await request("/api/relationship/home", { cookie: b.cookie });
  assert.equal(after.graph.issues.length, 1); assert.equal(after.graph.summaries[0].text, "We can choose a time to talk.");
  assert.equal(JSON.stringify(after).includes("ONLY_A_RAW_THOUGHT"), false);
  await request(`/api/private-agent/threads/${created.thread.id}/messages`, { cookie: a.cookie, method: "POST", body: { text: "A later private change" } });
  assert.equal((await request("/api/relationship/home", { cookie: b.cookie })).graph.summaries[0].text, "We can choose a time to talk.");
}));

test("recovery codes are private, single-use, rotated and invalidate every old session", () => fixture(async ({ register, request }) => {
  const a = await register("recovery-a");
  await request("/api/privacy/recovery-code", { cookie: a.cookie, method: "POST", body: { password: "wrong" }, status: 403 });
  const first = await request("/api/privacy/recovery-code", { cookie: a.cookie, method: "POST", body: { password } });
  const second = await request("/api/privacy/recovery-code", { cookie: a.cookie, method: "POST", body: { password } });
  const privacy = await request("/api/privacy", { cookie: a.cookie });
  assert.equal(privacy.recoveryEnabled, true); assert.equal(JSON.stringify(privacy).includes(second.recoveryCode), false); assert.equal(JSON.stringify(privacy).includes("recoveryCodeHash"), false);
  await request("/api/auth/recover", { method: "POST", body: { email: "recovery-a@example.test", recoveryCode: first.recoveryCode, password: "new-synthetic-password" }, status: 401 });
  await request("/api/auth/recover", { method: "POST", body: { email: "recovery-a@example.test", recoveryCode: second.recoveryCode, password: "new-synthetic-password" }, status: 204 });
  assert.equal((await request("/api/auth/me", { cookie: a.cookie })).user, null);
  await request("/api/auth/recover", { method: "POST", body: { email: "recovery-a@example.test", recoveryCode: second.recoveryCode, password: "another-password-26" }, status: 401 });
  await request("/api/auth/login", { method: "POST", body: { email: "recovery-a@example.test", password: "new-synthetic-password" } });
}));

test("leaving ends shared access, export excludes partner secrets, and private deletion preserves shared records", () => fixture(async ({ store, register, request }) => {
  const a = await register("leaving-a"); const b = await register("leaving-b"); const c = await register("next-c");
  const invite = await request("/api/partner/invitations", { cookie: a.cookie, method: "POST", body: {}, status: 201 });
  await request("/api/partner/accept", { cookie: b.cookie, method: "POST", body: { code: invite.pairing.invitation.code } });
  const relationshipId = invite.pairing.id;
  const shared = createRelationshipRecord({ relationshipId, userId: a.user.id, visibility: "shared", title: "Shared history" });
  await store.createRelationshipRecord("issues", shared);
  for (const member of [a, b]) await store.createRelationshipRecord("memories", createRelationshipRecord({ relationshipId, userId: member.user.id, visibility: "private", text: member === a ? "A_PRIVATE" : "B_PRIVATE" }));
  const exported = await request("/api/privacy/export", { cookie: a.cookie, method: "POST", body: { password } });
  assert.equal(JSON.stringify(exported).includes("A_PRIVATE"), true); assert.equal(JSON.stringify(exported).includes("B_PRIVATE"), false);
  await request("/api/privacy/leave", { cookie: a.cookie, method: "POST", body: { password, confirm: true } });
  assert.equal((await request("/api/auth/me", { cookie: b.cookie })).pairing, null);
  await request(`/api/issues/${shared.id}`, { cookie: a.cookie, status: 404 });
  const nextInvite = await request("/api/partner/invitations", { cookie: a.cookie, method: "POST", body: {}, status: 201 });
  await request("/api/partner/accept", { cookie: c.cookie, method: "POST", body: { code: nextInvite.pairing.invitation.code } });
  assert.equal(JSON.stringify(await request("/api/relationship/home", { cookie: c.cookie })).includes("Shared history"), false);
  await request("/api/privacy/delete-private", { cookie: a.cookie, method: "POST", body: { password, confirm: true } });
  const final = await request("/api/privacy/export", { cookie: a.cookie, method: "POST", body: { password } });
  assert.equal(JSON.stringify(final).includes("A_PRIVATE"), false); assert.equal(JSON.stringify(final).includes("Shared history"), true);
}));


test("memory withdrawal survives a model fallback without leaking through the old draft", () => fixture(async ({ register, request, mediator }) => {
  const a = await register("memory-fallback-a"); const cookie = a.cookie;
  const { memory } = await request("/api/memories", { cookie, method: "POST", body: { text: "SYNTHETIC_WITHDRAWN_MEMORY", allowPrivateAI: true }, status: 201 });
  const { thread } = await request("/api/private-agent/threads", { cookie, method: "POST", body: { intentType: "decision" }, status: 201 });
  let turn = 0, captured;
  mediator.continuePrivateAgentThread = async (input) => { captured = input; turn += 1; return { source: turn === 2 ? "local" : "openai", reply: "A draft", readyToShare: true, draft: turn === 1 ? { title: "A title", shareableSummary: memory.text } : input.draft }; };
  const send = () => request(`/api/private-agent/threads/${thread.id}/messages`, { cookie, method: "POST", body: { text: "Please continue." } });
  await send(); await send();
  await request(`/api/memories/${memory.id}`, { cookie, method: "PATCH", body: { text: memory.text, expectedVersion: memory.version, allowPrivateAI: false } });
  await send();
  assert.equal(captured.memory.memories.length, 0);
  assert.equal(JSON.stringify(captured).includes(memory.text), false);
}));

test("a delayed old-password login cannot create a valid session after account recovery", () => fixture(async ({ store, register, request }) => {
  const a = await register("login-race-a");
  const { recoveryCode } = await request("/api/privacy/recovery-code", { cookie: a.cookie, method: "POST", body: { password } });
  const original = store.getUserByEmail.bind(store); let release, entered;
  const started = new Promise(resolve => { entered = resolve; }); const gate = new Promise(resolve => { release = resolve; }); let first = true;
  store.getUserByEmail = async email => { const user = await original(email); if (first) { first = false; entered(); await gate; } return user; };
  const pending = request("/api/auth/login", { method: "POST", body: { email: a.user.email, password }, status: 401 });
  await started;
  await request("/api/auth/recover", { method: "POST", body: { email: a.user.email, recoveryCode, password: "replacement-password-26" }, status: 204 });
  release(); await pending;
  assert.equal((await request("/api/auth/me", { cookie: a.cookie })).user, null);
}));

test("reauthentication is checked after a queued recovery-code rotation acquires its transaction", () => fixture(async ({ store, register, request }) => {
  const a = await register("rotation-race-a");
  const { recoveryCode } = await request("/api/privacy/recovery-code", { cookie: a.cookie, method: "POST", body: { password } });
  const original = store.transaction.bind(store); let release, entered;
  const started = new Promise(resolve => { entered = resolve; }); const gate = new Promise(resolve => { release = resolve; }); let first = true;
  store.transaction = async (key, callback) => { if (first && key === `user:${a.user.id}`) { first = false; entered(); await gate; } return original(key, callback); };
  const pending = request("/api/privacy/recovery-code", { cookie: a.cookie, method: "POST", body: { password }, status: 403 });
  await started;
  await request("/api/auth/recover", { method: "POST", body: { email: a.user.email, recoveryCode, password: "replacement-password-26" }, status: 204 });
  release(); await pending;
  assert.equal((await store.getRelationshipRecordForUser("accountSettings", `account:${a.user.id}`, a.user.id)).recoveryCodeHash, undefined);
}));
