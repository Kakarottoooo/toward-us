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
  const register = async (name) => request("/api/auth/register", { method: "POST", body: { name, adultConfirmed: true, email: `${name}@example.test`, password }, status: 201 });
  try { await run({ store, request, register, mediator, base, directory }); }
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
  // Typed back in capitals, with spaces instead of dashes, it still works (QA round 3: codes were case-sensitive).
  const typed = ` ${second.recoveryCode.toUpperCase().replaceAll("-", " ")} `;
  assert.notEqual(typed.trim(), second.recoveryCode);
  await request("/api/auth/recover", { method: "POST", body: { email: "recovery-a@example.test", recoveryCode: typed, password: "new-synthetic-password" }, status: 204 });
  assert.equal((await request("/api/auth/me", { cookie: a.cookie })).user, null);
  await request("/api/auth/recover", { method: "POST", body: { email: "recovery-a@example.test", recoveryCode: second.recoveryCode, password: "another-password-26" }, status: 401 });
  await request("/api/auth/login", { method: "POST", body: { email: "recovery-a@example.test", password: "new-synthetic-password" } });
}));

// QA round 4 D4: a code typed on a full-width keyboard still works, and the limit is per account from one network and says how long.
test("recovery codes: full-width input matches; too many tries lock only that account and say how long to wait", () => fixture(async ({ register, request, base }) => {
  const a = await register("wide-a"); await register("wide-b"); await register("wide-c");
  const { recoveryCode } = await request("/api/privacy/recovery-code", { cookie: a.cookie, method: "POST", body: { password } });
  const wide = recoveryCode.toUpperCase().replace(/[0-9A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0xfee0)).replaceAll("-", "－");
  assert.notEqual(wide.normalize("NFKC"), wide);
  await request("/api/auth/recover", { method: "POST", body: { email: "wide-a@example.test", recoveryCode: `　${wide}　`, password: "new-synthetic-password" }, status: 204 });
  const guess = { email: "wide-b@example.test", recoveryCode: "0000-0000", password: "new-synthetic-password", language: "en" };
  for (let index = 0; index < 6; index += 1) await request("/api/auth/recover", { method: "POST", body: guess, status: 401 });
  const blocked = await fetch(`${base}/api/auth/recover`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(guess) });
  const body = await blocked.json();
  assert.equal(blocked.status, 429);
  assert.ok(body.retryAfter > 0 && body.retryAfter <= 900, JSON.stringify(body));
  assert.equal(blocked.headers.get("retry-after"), String(body.retryAfter));
  assert.match(body.error, /^Too many tries\. Try again in 15 minutes\.$/);
  const zh = await fetch(`${base}/api/auth/recover`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...guess, language: "zh" }) });
  assert.match((await zh.json()).error, /15 分钟后再试/);
  await request("/api/auth/recover", { method: "POST", body: { ...guess, email: "wide-c@example.test" }, status: 401 });
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

test("deleting private data or the account also deletes private photo and chat-history files from disk", () => fixture(async ({ register, request, base, directory }) => {
  const { readdir } = await import("node:fs/promises");
  const previous = process.env.TOWARD_US_MEDIA_DIR;
  const media = join(directory, "media");
  process.env.TOWARD_US_MEDIA_DIR = media;
  try {
    const files = async () => (await readdir(media).catch(() => [])).length;
    const bring = async (cookie) => {
      for (const [path, type, body] of [["/api/photos?scope=private", "image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2])], ["/api/imports?name=chat.txt&language=en", "application/octet-stream", Buffer.from("[1/2/24, 9:00:00 PM] Sam: hi\n[1/2/24, 9:01:00 PM] Robin: hello\n[1/2/24, 9:02:00 PM] Sam: dinner?")]]) {
        const response = await fetch(`${base}${path}`, { method: "POST", headers: { cookie, "content-type": type, ...(path.startsWith("/api/imports") ? { "X-Pinky-Import-Disclosure": "1" } : {}) }, body });
        assert.equal(response.status, 201, await response.text());
      }
    };
    const a = await register("files-a"), b = await register("files-b");
    await bring(a.cookie); await bring(b.cookie);
    assert.equal(await files(), 4);
    await request("/api/privacy/delete-private", { cookie: a.cookie, method: "POST", body: { password, confirm: true } });
    assert.equal(await files(), 2, "a's photo and chat file are gone; b's stay");
    await request("/api/privacy/account", { cookie: b.cookie, method: "DELETE", body: { password, confirm: true }, status: 204 });
    assert.equal(await files(), 0);
  } finally {
    if (previous === undefined) delete process.env.TOWARD_US_MEDIA_DIR;
    else process.env.TOWARD_US_MEDIA_DIR = previous;
  }
}));

test("a new display name needs no password, but a new password still asks for the current one", () => fixture(async ({ register, request }) => {
  const a = await register("rename-a");
  await request("/api/privacy/account", { cookie: a.cookie, method: "PATCH", body: { name: "Renamed" }, status: 204 });
  assert.equal((await request("/api/auth/me", { cookie: a.cookie })).user.name, "Renamed");
  await request("/api/privacy/account", { cookie: a.cookie, method: "PATCH", body: { newPassword: "another-synthetic-pass" }, status: 403 });
  await request("/api/privacy/account", { cookie: a.cookie, method: "PATCH", body: { name: "Again", newPassword: "another-synthetic-pass", password: "wrong" }, status: 403 });
  assert.equal((await request("/api/auth/me", { cookie: a.cookie })).user.name, "Renamed");
  await request("/api/privacy/account", { cookie: a.cookie, method: "PATCH", body: { newPassword: "another-synthetic-pass", password }, status: 204 });
}));

// QA round 3 N4: the deletion copy says what they wrote in Us "stays for your partner"; it does, read-only, with a one-time note.
test("after a partner deletes their account, the one left keeps their Us history read-only and is told once", () => fixture(async ({ register, request }) => {
  const a = await register("former-a"); const b = await register("former-b");
  for (const member of [a, b]) await request("/api/privacy/ai-consent", { cookie: member.cookie, method: "POST", body: { agree: true, noticeVersion: "2026-11-18" } }).catch(() => {});
  const invite = await request("/api/partner/invitations", { cookie: a.cookie, method: "POST", body: {}, status: 201 });
  await request("/api/partner/accept", { cookie: b.cookie, method: "POST", body: { code: invite.pairing.invitation.code } });
  await request("/api/together/messages", { cookie: a.cookie, method: "POST", body: { text: "A_SAID_THIS_IN_US", itemId: "former-1", recipient: "partner" }, status: 201 });
  await request("/api/together/messages", { cookie: b.cookie, method: "POST", body: { text: "B_REPLIED", itemId: "former-2", recipient: "partner" }, status: 201 });
  assert.equal((await request("/api/privacy/former-us", { cookie: b.cookie })).former, null, "nothing while the pair is active");
  await request("/api/privacy/account", { cookie: a.cookie, method: "DELETE", body: { password, confirm: true }, status: 204 });
  assert.equal((await request("/api/auth/me", { cookie: b.cookie })).pairing, null);
  const { former } = await request("/api/privacy/former-us?language=en", { cookie: b.cookie });
  assert.equal(former.name, "former-a"); assert.equal(former.seen, false);
  assert.deepEqual(former.messages.filter((line) => line.role === "member").map((line) => [line.text, line.mine]), [["A_SAID_THIS_IN_US", false], ["B_REPLIED", true]]);
  assert.equal(JSON.stringify(former).includes(a.user.id), false, "no ids of the deleted account");
  await request("/api/privacy/former-us/seen", { cookie: b.cookie, method: "POST", body: {} });
  assert.equal((await request("/api/privacy/former-us", { cookie: b.cookie })).former.seen, true);
  await request("/api/privacy/former-us", { status: 401 });
}));
