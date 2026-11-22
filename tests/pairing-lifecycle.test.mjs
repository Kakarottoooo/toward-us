import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApiApp } from "../server/app.mjs";
import { createFileStore } from "../server/store.mjs";
import { AI_NOTICE_VERSION } from "../server/ai-permission.mjs";
import { localEnvFile } from "../server/env-file.mjs";

const password = "synthetic-test-password-26";

// One throwaway server per test, fictional accounts only. `mediator` counts every model call it is asked for.
async function harness(t, run) {
  const directory = await mkdtemp(join(tmpdir(), "toward-pairing-"));
  const store = await createFileStore(join(directory, "state.json"));
  const modelCalls = [];
  const mediator = { aiReady: true, model: "test", continueTogether: async () => { modelCalls.push("continueTogether"); return { reply: "ok", actions: [], draftAgreement: null }; }, structured: async (params) => { modelCalls.push(params?.name || "structured"); return null; } };
  const server = createApiApp({ store, mediator }).listen(0, "127.0.0.1");
  await new Promise((done) => server.once("listening", done));
  const base = `http://127.0.0.1:${server.address().port}`;
  // Any request leaving this machine (a model, the moderation screen, a push service) is counted and refused.
  const realFetch = globalThis.fetch, external = [];
  t.mock.method(globalThis, "fetch", (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === "127.0.0.1") return realFetch(input, init);
    external.push(url.href);
    return Promise.reject(new Error("external request in test"));
  });
  const request = async (path, { method = "GET", body, cookie } = {}) => {
    const response = await fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  };
  const register = async (name) => {
    const result = await request("/api/auth/register", { method: "POST", body: { name, adultConfirmed: true, email: `${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`, password } });
    assert.equal(result.status, 201, result.body?.error);
    return result.cookie;
  };
  const invite = async (cookie) => {
    const made = await request("/api/partner/invitations", { method: "POST", body: {}, cookie });
    assert.ok([200, 201].includes(made.status), made.body?.error);
    return made.body.pairing.invitation.code;
  };
  const pair = async (inviter, invitee) => {
    const accepted = await request("/api/partner/accept", { method: "POST", body: { code: await invite(inviter) }, cookie: invitee });
    assert.equal(accepted.status, 200, accepted.body?.error);
  };
  const streams = [];
  // The live relationship stream, collecting every `relationship` event payload until closed.
  const listen = async (cookie) => {
    const controller = new AbortController();
    const response = await realFetch(`${base}/api/relationship/events`, { headers: { cookie }, signal: controller.signal });
    assert.equal(response.status, 200);
    const events = [], waiters = [];
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = "";
    void (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let index;
          while ((index = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, index); buffer = buffer.slice(index + 2);
            const type = /^event: (.*)$/m.exec(block)?.[1], data = /^data: (.*)$/m.exec(block)?.[1];
            if (type === "relationship" || type === "access-ended") events.push({ type, ...JSON.parse(data || "{}") });
            for (const waiter of waiters.splice(0)) waiter();
          }
        }
      } catch { /* aborted */ }
    })();
    const stream = {
      events,
      async next(match, ms = 3000) {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
          const found = events.find(match); if (found) return found;
          await new Promise((done) => { waiters.push(done); setTimeout(done, 50); });
        }
        return null;
      },
      close: () => controller.abort(),
    };
    streams.push(stream);
    return stream;
  };
  try { await run({ request, register, invite, pair, listen, store, modelCalls, external }); }
  finally {
    for (const stream of streams) stream.close();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await rm(directory, { recursive: true, force: true });
  }
}

test("a test run never falls back to the owner's home secrets file; an explicit env file still loads", () => {
  const home = resolve("/fictional-home");
  assert.equal(localEnvFile({}, home), resolve(home, ".pinky.env"));
  assert.equal(localEnvFile({ TOWARD_US_TEST: "1" }, home), "");
  assert.equal(localEnvFile({ NODE_ENV: "test" }, home), "");
  assert.equal(localEnvFile({ TOWARD_US_TEST: "1", TOWARD_US_ENV_FILE: "work/explicit.env" }, home), "work/explicit.env");
  assert.equal(process.env.TOWARD_US_TEST, "1", "the test:app preload marks every run as a test run");
});

test("the waiting inviter hears the moment the invitation is accepted, and both hear when the pairing ends", (t) => harness(t, async ({ request, register, invite, listen }) => {
  const a = await register("Avery"), b = await register("Blake");
  const code = await invite(a);
  const waiting = await listen(a); // pending pairing: the stream is open before anyone joins
  assert.equal((await request("/api/partner/accept", { method: "POST", body: { code }, cookie: b })).status, 200);
  const joined = await waiting.next((event) => event.eventType === "pairing.updated");
  assert.ok(joined, "the inviter's open stream gets pairing.updated");
  assert.equal(joined.status, "active");
  const relationshipId = (await request("/api/auth/me", { cookie: a })).body.pairing.id;
  assert.equal(joined.objectId, relationshipId);
  const partnerStream = await listen(b);
  assert.equal((await request("/api/privacy/leave", { method: "POST", body: { confirm: true, password }, cookie: a })).status, 200);
  for (const stream of [waiting, partnerStream]) {
    const ended = await stream.next((event) => event.eventType === "pairing.updated" && event.status === "ended");
    assert.ok(ended, "both members hear the pairing ended");
    assert.ok(await stream.next((event) => event.type === "access-ended"), "then the stream closes");
  }
}));

test("the Just me greeting never keeps naming a partner after leaving, re-pairing or the partner deleting their account", (t) => harness(t, async ({ request, register, pair, store }) => {
  const a = await register("Avery"), b = await register("Blake"), c = await register("Casey");
  await pair(a, b);
  const opened = await request("/api/assistant/sessions", { method: "POST", body: { language: "en", timezone: "UTC", opened: true }, cookie: a });
  assert.equal(opened.status, 201, opened.body?.error);
  assert.match(opened.body.session.messages.at(-1).text, /Blake/, "the greeting names the current partner");
  const userId = (await request("/api/auth/me", { cookie: a })).body.user.id;
  // The greeting as stored on the member's conversation, open or closed after leaving.
  const greeting = async () => {
    const threads = (await store.listRelationshipRecordsForUser("privateAgentThreads", userId)).filter((thread) => thread.ownerUserId === userId && thread.knowYouAt);
    assert.equal(threads.length, 1);
    return threads[0].messages.find((message) => message.knowYou)?.text || "";
  };
  // Blake leaves: the greeting stops naming Blake.
  assert.equal((await request("/api/privacy/leave", { method: "POST", body: { confirm: true, password }, cookie: b })).status, 200);
  assert.doesNotMatch(await greeting(), /Blake/);
  assert.match(await greeting(), /your partner/);
  // Avery pairs with Casey: the greeting names Casey, never Blake.
  await pair(a, c);
  assert.match(await greeting(), /Casey/);
  assert.doesNotMatch(await greeting(), /Blake/);
  // Casey deletes their account: the greeting no longer names Casey.
  assert.equal((await request("/api/privacy/account", { method: "DELETE", body: { confirm: true, password }, cookie: c })).status, 204);
  assert.doesNotMatch(await greeting(), /Casey|Blake/);
  assert.match(await greeting(), /your partner/);
}));

test("without AI consent a message to the partner is delivered with no model or screening call; a message to Ourever is still refused", (t) => harness(t, async ({ request, register, pair, modelCalls, external }) => {
  const a = await register("Avery"), b = await register("Blake");
  await pair(a, b);
  assert.equal((await request("/api/privacy/ai-consent", { method: "POST", body: { agree: true, noticeVersion: AI_NOTICE_VERSION }, cookie: b })).status, 200);
  const sent = await request("/api/together/messages", { method: "POST", body: { text: "Ourever, can you hear me? Dinner at 7?", recipient: "partner", itemId: "fixture-1", language: "en" }, cookie: a });
  assert.equal(sent.status, 201, sent.body?.error);
  assert.equal(sent.body.aiSkipped, true);
  assert.equal(sent.body.reply, null);
  assert.equal(sent.body.message.noAi, true);
  const seen = (await request("/api/together", { cookie: b })).body.conversation.messages;
  assert.ok(seen.some((message) => message.text === "Ourever, can you hear me? Dinner at 7?"), "the partner sees it");
  // A retry with the same itemId is the same message.
  const retried = await request("/api/together/messages", { method: "POST", body: { text: "Ourever, can you hear me? Dinner at 7?", recipient: "partner", itemId: "fixture-1", language: "en" }, cookie: a });
  assert.equal(retried.status, 200);
  assert.equal(retried.body.message.id, sent.body.message.id);
  // Addressed to Ourever: consent is still required.
  const asked = await request("/api/together/messages", { method: "POST", body: { text: "What should we cook?", recipient: "assistant", itemId: "fixture-2", language: "en" }, cookie: a });
  assert.equal(asked.status, 403);
  assert.match(asked.body.error, /AI/, "the existing consent refusal");
  const called = await request("/api/together/messages", { method: "POST", body: { text: "@agent what should we cook?", itemId: "fixture-3", language: "en" }, cookie: a });
  assert.equal(called.status, 403);
  await new Promise((done) => setTimeout(done, 100));
  // Opening Us as Blake may write the day's question (from the question pool, never from anyone's words); nothing else ran.
  assert.deepEqual(modelCalls.filter((name) => name !== "daily_question"), [], "no model ran on the non-consenting member's words");
  assert.deepEqual(external, [], "nothing was sent to a moderation or model provider");
}));

test("a double-submitted reminder is created once, by itemId or as an identical reminder within seconds", (t) => harness(t, async ({ request, register }) => {
  const a = await register("Avery");
  const when = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 16);
  const body = { title: "Call the florist", localDateTime: when, timezone: "UTC", frequency: "once" };
  const first = await request("/api/reminders", { method: "POST", body: { ...body, itemId: "reminder-fixture-1" }, cookie: a });
  assert.equal(first.status, 201, first.body?.error);
  const again = await request("/api/reminders", { method: "POST", body: { ...body, itemId: "reminder-fixture-1" }, cookie: a });
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.reminder.id, first.body.reminder.id);
  const plain = await request("/api/reminders", { method: "POST", body: { ...body, title: "Buy candles" }, cookie: a });
  assert.equal(plain.status, 201);
  const plainAgain = await request("/api/reminders", { method: "POST", body: { ...body, title: "Buy candles" }, cookie: a });
  assert.equal(plainAgain.status, 200);
  assert.equal(plainAgain.body.reminder.id, plain.body.reminder.id);
  assert.equal((await request("/api/reminders", { method: "POST", body: { ...body, title: "Buy candles", frequency: "weekly" }, cookie: a })).status, 201, "a different reminder is not a duplicate");
  const listed = (await request("/api/reminders", { cookie: a })).body.reminders;
  assert.equal(listed.length, 3);
}));

test("an invitee can decline an invitation; the code stops working and the inviter hears it", (t) => harness(t, async ({ request, register, invite, listen }) => {
  const a = await register("Avery"), b = await register("Blake");
  const code = await invite(a);
  assert.equal((await request(`/api/partner/invitations/${code}/decline`, { method: "POST", cookie: a })).body.code, "invite_self");
  const waiting = await listen(a);
  assert.equal((await request(`/api/partner/invitations/${code}`)).body.invitation.status, "open");
  const declined = await request(`/api/partner/invitations/${code}/decline`, { method: "POST" }); // signed out, like the preview
  assert.equal(declined.status, 200, declined.body?.error);
  assert.deepEqual(declined.body, { invitation: { status: "declined" } });
  assert.equal((await request(`/api/partner/invitations/${code}/decline`, { method: "POST", cookie: b })).status, 200, "declining twice is harmless");
  const preview = (await request(`/api/partner/invitations/${code}`)).body.invitation;
  assert.equal(preview.status, "declined");
  assert.equal(preview.inviterName, "");
  const accepted = await request("/api/partner/accept", { method: "POST", body: { code }, cookie: b });
  assert.equal(accepted.status, 409);
  assert.equal(accepted.body.code, "invite_declined");
  const heard = await waiting.next((event) => event.eventType === "pairing.updated");
  assert.equal(heard?.status, "declined");
  const me = (await request("/api/auth/me", { cookie: a })).body.pairing;
  assert.ok(me.invitation.declinedAt, "the inviter's waiting card can say it was declined");
  assert.notEqual(await invite(a), code, "the inviter can send a new link");
  assert.equal((await request("/api/partner/invitations/ZZZZZZZZ/decline", { method: "POST" })).status, 404);
}));
