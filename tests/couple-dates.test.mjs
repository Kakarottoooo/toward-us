import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiApp } from "../server/app.mjs";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";

async function couple(run) {
  const directory = await mkdtemp(join(tmpdir(), "toward-dates-"));
  const store = await createFileStore(join(directory, "state.json"));
  const server = createApiApp({ store, mediator: { aiReady: false, model: "test" } }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = "GET", body, cookie } = {}) => {
    const response = await fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: response.status === 204 ? null : await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
  };
  try {
    const register = async (name) => {
      const result = await request("/api/auth/register", { method: "POST", body: { name, adultConfirmed: true, email: `${name}-${Date.now()}@example.test`, password: "synthetic-test-password-26" } });
      assert.equal(result.status, 201, result.body.error);
      return result.cookie;
    };
    const a = await register("dates-a"), b = await register("dates-b");
    const invite = await request("/api/partner/invitations", { method: "POST", body: {}, cookie: a });
    assert.equal(invite.status, 201, invite.body.error);
    const accepted = await request("/api/partner/accept", { method: "POST", body: { code: invite.body.pairing.invitation.code }, cookie: b });
    assert.equal(accepted.status, 200, accepted.body.error);
    await run({ request, a, b, store });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

test("either partner sets the day they got together; setting it again moves the one date, and future days are refused", () => couple(async ({ request, a, b }) => {
  assert.equal((await request("/api/relationship/together-since", { method: "PUT", body: { date: "2025-05-20", language: "zh" }, cookie: a })).status, 200);
  assert.equal((await request("/api/relationship/together-since", { method: "PUT", body: { date: "2025-05-21", language: "zh" }, cookie: b })).status, 200);
  assert.equal((await request("/api/relationship/together-since", { method: "PUT", body: { date: "2999-01-01" }, cookie: a })).status, 400);
  const started = (await request("/api/relationship/home?language=zh", { cookie: a })).body.graph.milestones.filter((item) => item.type === "relationship_started");
  assert.deepEqual(started.map((item) => [item.date, item.recurringRule, item.title]), [["2025-05-21", "yearly", "在一起纪念日"]]);
}));

test("QA round 6: the default anniversary title is shown in each reader's language; a typed title is kept as typed", () => couple(async ({ request, a, b, store }) => {
  // Set by a Chinese-speaking partner; the English and Spanish readers see their own words.
  assert.equal((await request("/api/relationship/together-since", { method: "PUT", body: { date: "2025-05-20", language: "zh" }, cookie: a })).status, 200);
  const title = async (cookie, language) => (await request(`/api/relationship/home${language ? `?language=${language}` : ""}`, { cookie })).body.graph.milestones.find((item) => item.type === "relationship_started").title;
  assert.equal(await title(b, "en"), "Our anniversary");
  assert.equal(await title(b, "es"), "Nuestro aniversario");
  assert.equal(await title(a, "zh"), "在一起纪念日");
  // The member's saved interface language is used when the request names none.
  assert.equal((await request("/api/me/language", { method: "POST", body: { language: "es" }, cookie: b })).status, 200);
  assert.equal(await title(b), "Nuestro aniversario");
  // A title someone typed is theirs, in every language.
  const { user } = (await request("/api/auth/me", { cookie: a })).body;
  const record = (await store.listRelationshipRecordsForUser("milestones", user.id)).find((item) => item.type === "relationship_started");
  await store.updateRelationshipRecordForUser("milestones", record.id, user.id, (draft) => { draft.title = "初遇"; draft.version += 1; });
  assert.equal(await title(b, "en"), "初遇");
}));

test("Coming up learns each partner's interface language, so a couple with different languages sees both sets of holidays", () => couple(async ({ request, a, b }) => {
  const members = async () => (await request("/api/relationship/home", { cookie: a })).body.relationship.members.map((member) => member.language);
  assert.deepEqual(await members(), [null, null], "a member who never chose a language has none");
  assert.equal((await request("/api/me/language", { method: "POST", body: { language: "zh" }, cookie: a })).status, 200);
  assert.equal((await request("/api/me/language", { method: "POST", body: { language: "en" }, cookie: b })).status, 200);
  assert.deepEqual(await members(), ["zh", "en"]);
}));

test("an old shared list becomes a checklist space once, with its items", () => couple(async ({ request, a, b, store }) => {
  const { user, pairing } = (await request("/api/auth/me", { cookie: a })).body;
  const list = createRelationshipRecord({ relationshipId: pairing.id, userId: user.id, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", title: "Date ideas", type: "custom" });
  await store.createRelationshipRecord("lists", list);
  for (const [title, visibility] of [["Picnic", "shared"], ["A surprise", "private_surprise"]]) await store.createRelationshipRecord("listItems", createRelationshipRecord({ relationshipId: pairing.id, userId: user.id, visibility, aiAccessScope: visibility === "shared" ? "joint" : "private", listId: list.id, title }));
  const spaces = async (cookie) => (await request("/api/spaces", { cookie })).body.spaces.filter((space) => !space.system);
  const seen = await spaces(b);
  assert.deepEqual(seen.map((space) => [space.title, space.layout, space.visibility, space.items.map((item) => item.title)]), [["Date ideas", "checklist", "shared", ["Picnic"]]]);
  assert.equal((await spaces(a)).length, 1, "converted only once");
}));
