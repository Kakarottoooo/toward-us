// QA round 7, finding 3: an English or Spanish sign-up without a name was stored as "我" and shown to the partner that way.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiApp } from "../server/app.mjs";
import { createFileStore } from "../server/store.mjs";
import { eitherWord, nameOr, partnerWord, placeholderName } from "../server/display-name.mjs";

const password = "synthetic-test-password-26";

test("a sign-up without a name is never shown to the partner as 我; first run can still ask for one", async () => {
  const directory = await mkdtemp(join(tmpdir(), "toward-name-"));
  const store = await createFileStore(join(directory, "state.json"));
  const server = createApiApp({ store, mediator: { aiReady: false, model: "test" } }).listen(0, "127.0.0.1");
  await new Promise((done) => server.once("listening", done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = "GET", body, cookie } = {}) => {
    const response = await fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, cookie: response.headers.getSetCookie().find((line) => line.startsWith("toward_us_session="))?.split(";")[0] };
  };
  try {
    const alex = await request("/api/auth/register", { method: "POST", body: { name: "Alex", adultConfirmed: true, email: "alex@example.test", password, language: "en" } });
    const nameless = await request("/api/auth/register", { method: "POST", body: { name: "", adultConfirmed: true, email: "quiet@example.test", password, language: "en" } });
    assert.equal(nameless.status, 201, JSON.stringify(nameless.body));
    assert.equal(nameless.body.user.name, "", "no placeholder name is stored");
    assert.equal(nameless.body.user.nameSet, false, "first run still asks for a name");
    const made = await request("/api/partner/invitations", { method: "POST", body: {}, cookie: alex.cookie });
    assert.equal((await request("/api/partner/accept", { method: "POST", body: { code: made.body.pairing.invitation.code }, cookie: nameless.cookie })).status, 200);
    const seen = await request("/api/auth/me", { cookie: alex.cookie });
    assert.ok(!JSON.stringify(seen.body).includes("我"), JSON.stringify(seen.body.pairing));
    assert.deepEqual(seen.body.pairing.members.map((member) => member.name).sort(), ["", "Alex"]);
  } finally { server.closeAllConnections(); await new Promise((done) => server.close(done)); await rm(directory, { recursive: true, force: true }); }
});

test("an old placeholder 我 reads as no name when the store loads; a name someone chose is kept", async () => {
  const directory = await mkdtemp(join(tmpdir(), "toward-name-old-"));
  const file = join(directory, "state.json");
  const user = (id, name, nameSource) => ({ id, email: `${id}@example.test`, name, ...(nameSource ? { nameSource } : {}), passwordHash: "x", createdAt: "2026-01-01T00:00:00.000Z" });
  await writeFile(file, JSON.stringify({ users: { a: user("a", "我", "fallback"), b: user("b", "我"), c: user("c", "我", "user"), d: user("d", "Dana", "user") } }));
  try {
    const store = await createFileStore(file);
    assert.equal((await store.getUserById("a")).name, "");
    assert.equal((await store.getUserById("b")).name, "");
    assert.equal((await store.getUserById("b")).nameSource, "fallback", "still asked for a name");
    assert.equal((await store.getUserById("c")).name, "我", "chosen on purpose");
    assert.equal((await store.getUserById("d")).name, "Dana");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("fallback words are in the reader's language", () => {
  assert.equal(nameOr("", partnerWord("en", true)), "Your partner");
  assert.equal(nameOr(" ", partnerWord("es")), "tu pareja");
  assert.equal(nameOr("", partnerWord("zh")), "对方");
  assert.equal(nameOr("", eitherWord("en")), "One of you");
  assert.equal(nameOr("Sam", eitherWord("en")), "Sam");
  assert.equal(placeholderName({ name: "我", nameSource: "user" }), false);
});
