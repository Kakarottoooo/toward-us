import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApiApp } from "../server/app.mjs";
import { createFileStore } from "../server/store.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { createDecisionAgent } from "../server/decision-agent.mjs";

let server, base, directory, store;
let counter = 0;
const mediator = {
  aiReady: false, model: "test",
  async summarizePerspective(p) { return { text: p.shareableText || p.goal, source: "test" }; },
  async generateDecisionOptions() { return { source: "test", options: [{ title: "Try a shorter visit", rationale: "One hour each Sunday", conditions: [], tradeoffs: [], risks: [], disputedFacts: [] }] }; },
};
before(async () => {
  await mkdir(join(process.cwd(), "work"), { recursive: true });
  directory = await mkdtemp(join(process.cwd(), "work", "decisions-"));
  store = await createFileStore(join(directory, "state.json"));
  const previousKey = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "";
  server = createApiApp({ store, mediator }).listen(0, "127.0.0.1");
  if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); if (directory) await rm(directory, { recursive: true, force: true }); });

async function call(path, user, body, status = 200, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(`${base}/api${path}`, { method, headers: { "content-type": "application/json", ...(user ? { cookie: user.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`);
  return result;
}
async function pair() {
  const register = async () => {
    const response = await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: `Member ${++counter}`, email: `decisions-${counter}@example.com`, password: "correct-horse-battery" }) });
    assert.equal(response.status, 201); return { ...(await response.json()), cookie: response.headers.get("set-cookie").split(";")[0] };
  };
  const a = await register(), b = await register();
  const invitation = await call("/partner/invitations", a, {}, 201);
  await call("/partner/accept", b, { code: invitation.pairing.invitation.code }); return { a, b };
}
async function agreementFixture() {
  const { a, b } = await pair();
  const { issue } = await call("/issues", a, { title: "Weekend plans" }, 201);
  for (const user of [a, b]) {
    await call(`/issues/${issue.id}/perspectives`, user, { goal: "Shorter visits", shareableText: "One hour is enough", privateNotes: `NEVER_SHARE_${user.user.id}` }, 201);
    await call(`/issues/${issue.id}/shareable-summary`, user, { text: "One hour is enough" });
  }
  const { proposals: [proposal] } = await call(`/issues/${issue.id}/generate-options`, a, { language: "en" }, 201);
  for (const user of [a, b]) await call(`/proposals/${proposal.id}/evaluations`, user, { value: "accept" }, 201);
  const { agreement } = await call("/agreements", a, { sourceIssueId: issue.id, proposalId: proposal.id, title: proposal.title, summary: proposal.rationale, terms: ["One hour each Sunday"] }, 201);
  return { a, b, issue, proposal, agreement };
}

test("approval requires the exact reviewed version and one member cannot activate it", async () => {
  const { a, b, agreement } = await agreementFixture();
  await call(`/agreements/${agreement.id}/approve`, a, {}, 409);
  await call(`/agreements/${agreement.id}/approve`, a, { version: agreement.version - 1 }, 409);
  const first = await call(`/agreements/${agreement.id}/approve`, a, { version: agreement.version });
  assert.equal(first.agreement.status, "awaiting_approvals");
  await call(`/agreements/${agreement.id}/approve`, a, { version: agreement.version });
  const second = await call(`/agreements/${agreement.id}/approve`, b, { version: agreement.version });
  assert.equal(second.agreement.status, "active");
  assert.equal(second.approvedCount, 2);
});

async function activate(fixture) {
  for (const user of [fixture.a, fixture.b]) await call(`/agreements/${fixture.agreement.id}/approve`, user, { version: fixture.agreement.version });
  return fixture;
}
async function commitmentFixture() {
  const fixture = await activate(await agreementFixture());
  const { commitment } = await call("/commitments", fixture.a, { agreementId: fixture.agreement.id, agreementVersion: fixture.agreement.version, confirmed: true, ownerType: "both", description: "Each arrange one short visit", dueAt: "2026-01-01T12:00:00Z", reviewAt: "2026-01-02T12:00:00Z" }, 201);
  assert.equal(commitment.status, "awaiting_confirmations");
  await call(`/commitments/${commitment.id}/complete`, fixture.a, { version: commitment.version }, 409);
  await call(`/commitments/${commitment.id}/confirm`, fixture.b, { version: commitment.version });
  return { ...fixture, commitment };
}
test("incomplete and worse outcomes are accurately shared only by explicit consent and trigger renegotiation", async () => {
  const { a, b, commitment, agreement } = await commitmentFixture();
  const { outcome } = await call(`/commitments/${commitment.id}/review`, a, { version: commitment.version });
  await call(`/outcome-reviews/${outcome.id}/responses`, a, {}, 400);
  const answers = { actionCompleted: false, improvement: "worse", effective: "", ineffective: "The visit was exhausting", stillAccept: false, renegotiate: true, shareResponse: true };
  const { response } = await call(`/outcome-reviews/${outcome.id}/responses`, a, answers, 201);
  assert.equal(response.allowLearnedPattern, false);
  await call(`/outcome-reviews/${outcome.id}/finalize`, a, {}, 409);
  await call(`/outcome-reviews/${outcome.id}/responses`, b, { actionCompleted: true, improvement: "same", effective: "Private reflection", ineffective: "PRIVATE_DO_NOT_PUBLISH", stillAccept: true, renegotiate: false }, 201);
  const result = await call(`/outcome-reviews/${outcome.id}/finalize`, a, {});
  assert.equal(result.outcome.learnedPattern, null);
  assert.equal(result.outcome.nextAction, "renegotiate");
  assert.equal(result.outcome.sharedResponses.length, 1);
  assert.equal(result.outcome.sharedResponses[0].improvement, "worse");
  assert.equal(result.outcome.sharedResponses[0].actionCompleted, false);
  assert.equal(JSON.stringify(result).includes("PRIVATE_DO_NOT_PUBLISH"), false);
  const home = await call("/relationship/home", a);
  assert.equal(home.graph.agreements.find((item) => item.id === agreement.id).status, "draft");
  assert.equal(JSON.stringify(home).includes("Private reflection"), false);
});

test("concurrent completion and reviews are idempotent and cannot cross relationships", async () => {
  const { a, b, commitment } = await commitmentFixture();
  const outsider = (await pair()).a;
  await call(`/commitments/${commitment.id}/complete`, outsider, { version: commitment.version }, 404);
  await Promise.all([a, b, a, b].map((user) => call(`/commitments/${commitment.id}/complete`, user, { version: commitment.version, completionEvidence: "I did my part" })));
  const home = await call("/relationship/home", a);
  assert.equal(home.graph.outcomes.length, 1);
  assert.deepEqual(new Set(home.graph.commitments[0].completedBy), new Set([a.user.id, b.user.id]));
  const outcome = home.graph.outcomes[0];
  const answers = { actionCompleted: true, improvement: "improved", effective: "Short visits work", ineffective: "", stillAccept: true, renegotiate: false, shareResponse: false, allowLearnedPattern: true, learnedPatternCandidate: "One hour visits work better for both of us" };
  const duplicates = await Promise.all([fetch(`${base}/api/outcome-reviews/${outcome.id}/responses`, { method: "POST", headers: { cookie: a.cookie, "content-type": "application/json" }, body: JSON.stringify(answers) }), fetch(`${base}/api/outcome-reviews/${outcome.id}/responses`, { method: "POST", headers: { cookie: a.cookie, "content-type": "application/json" }, body: JSON.stringify(answers) })]);
  assert.deepEqual(duplicates.map((item) => item.status).sort(), [200, 201]);
  await call(`/outcome-reviews/${outcome.id}/responses`, b, answers, 201);
  const results = await Promise.all([a, b].map((user) => call(`/outcome-reviews/${outcome.id}/finalize`, user, {})));
  assert.equal(results[0].outcome.learnedPattern, answers.learnedPatternCandidate);
  assert.equal(results[1].outcome.version, results[0].outcome.version);
  assert.deepEqual(results[0].outcome.sharedResponses, []);
});

test("discussion drafts are editable, never approve themselves, and changed agreements reject stale approval", async () => {
  const { a, b, issue, agreement } = await activate(await agreementFixture());
  for (const text of ["month", "AI unavailable"]) await store.createRelationshipRecord("memories", createRelationshipRecord({ relationshipId: issue.relationshipId, userId: a.user.id, visibility: "jointly_confirmed", aiAccessScope: "joint", text, memberUserIds: [a.user.id, b.user.id], approvals: [a, b].map(actor => ({ userId: actor.user.id, version: 1 })) }));
  const { issue: discussed } = await call(`/issues/${issue.id}/messages`, a, { text: "Please change visits to once a month", language: "en", itemId: "same-turn" });
  assert.equal(discussed.discussionDraft.sourceRefs.length, 4, "Two summaries and two current memory grants are pinned to the draft");
  const unchanged = (await call(`/issues/${issue.id}`, b)).agreements[0];
  assert.equal(unchanged.version, agreement.version);
  assert.equal(unchanged.status, "active");
  assert.equal(discussed.discussionDraft.source, "local");
  assert.match(discussed.discussion.at(-1).text, /AI is unavailable/);
  assert.equal(JSON.stringify(discussed.discussion).includes("NEVER_SHARE_"), false);
  const repeat = await call(`/issues/${issue.id}/transcripts`, a, { text: "Please change visits to once a month", itemId: "same-turn" });
  assert.equal(repeat.issue.version, discussed.version);
  const body = { version: discussed.version, draftId: discussed.discussionDraft.id, confirmed: true, title: "Monthly visits", summary: "Try once per month", terms: ["First Sunday of each month, for one hour"], unresolvedPoints: ["Choose a location together"] };
  const { agreement: revised } = await call(`/issues/${issue.id}/discussion-draft/confirm`, a, body);
  assert.equal(revised.status, "awaiting_approvals");
  assert.equal(revised.version, agreement.version + 1);
  assert.deepEqual(revised.terms, body.terms);
  await call(`/agreements/${agreement.id}/approve`, b, { version: agreement.version }, 409);
  assert.equal((await call(`/agreements/${agreement.id}/approve`, a, { version: revised.version })).agreement.status, "awaiting_approvals");
  assert.equal((await call(`/agreements/${agreement.id}/approve`, b, { version: revised.version })).agreement.status, "active");
  const outsider = (await pair()).a;
  await call(`/issues/${issue.id}/messages`, outsider, { text: "Read their private details" }, 404);
});

test("an approval racing a revision never activates the revised version", async () => {
  const { a, b, agreement } = await agreementFixture();
  await call(`/agreements/${agreement.id}/approve`, a, { version: agreement.version });
  const revision = { version: agreement.version, confirmed: true, title: "Different agreement", summary: "A new request", terms: ["Once per month"] };
  const requests = [fetch(`${base}/api/agreements/${agreement.id}`, { method: "PATCH", headers: { cookie: a.cookie, "content-type": "application/json" }, body: JSON.stringify(revision) }), fetch(`${base}/api/agreements/${agreement.id}/approve`, { method: "POST", headers: { cookie: b.cookie, "content-type": "application/json" }, body: JSON.stringify({ version: agreement.version }) })];
  const responses = await Promise.all(requests);
  assert.ok(responses.every((item) => [200, 409].includes(item.status)));
  const record = (await call("/relationship/home", a)).graph.agreements.find((item) => item.id === agreement.id);
  if (record.version > agreement.version) assert.equal(record.status, "awaiting_approvals");
  else assert.equal(record.status, "active");
});

test("simultaneous option generation creates one set and repeated evaluations do not duplicate it", async () => {
  const { a, b } = await pair();
  const { issue } = await call("/issues", a, { title: "One shared topic" }, 201);
  for (const user of [a, b]) {
    await call(`/issues/${issue.id}/perspectives`, user, { goal: "One short visit", shareableText: "One hour" }, 201);
    await call(`/issues/${issue.id}/shareable-summary`, user, { text: "One hour" });
  }
  const responses = await Promise.all([a, b].map((user) => fetch(`${base}/api/issues/${issue.id}/generate-options`, { method: "POST", headers: { cookie: user.cookie, "content-type": "application/json" }, body: JSON.stringify({ language: "en" }) })));
  assert.deepEqual(responses.map((item) => item.status).sort(), [200, 201]);
  const detail = await call(`/issues/${issue.id}`, a);
  assert.equal(detail.proposals.length, 1);
  await call(`/proposals/${detail.proposals[0].id}/evaluations`, a, { value: "revise" }, 201);
  await call(`/proposals/${detail.proposals[0].id}/evaluations`, a, { value: "revise" });
  assert.equal((await call(`/issues/${issue.id}`, a)).evaluations.length, 1);
});

test("model output stays a draft and Responses explicitly disables provider state retention", async () => {
  let sent;
  const agent = createDecisionAgent({ client: { responses: { async create(request) { sent = request; return { output_text: JSON.stringify({ reply: "Please review this proposal", draft: { title: "Monthly", summary: "One visit", terms: ["Once a month"], unresolvedPoints: [], status: "active", approvals: ["both"] } }) }; } } } });
  const result = await agent.discuss({ issue: { title: "Visits" }, confirmedSummaries: [{ text: "A confirmed" }, { text: "B confirmed" }], agreement: null, messages: [{ role: "user", text: "Try monthly" }] }, "en");
  assert.equal(sent.store, false);
  assert.equal(result.source, "openai");
  assert.equal(result.draft.status, undefined);
  assert.equal(result.draft.approvals, undefined);
});

test("concurrent voice turns preserve both people's words and deduplicate retransmission", async () => {
  const { a, b, issue } = await agreementFixture();
  const turns = [{ user: a, text: "A wants monthly visits", itemId: "voice-a" }, { user: b, text: "B wants to discuss the location", itemId: "voice-b" }];
  await Promise.all(turns.map(({ user, ...body }) => call(`/issues/${issue.id}/transcripts`, user, { ...body, language: "en" })));
  await call(`/issues/${issue.id}/transcripts`, a, { text: turns[0].text, itemId: turns[0].itemId });
  const detail = await call(`/issues/${issue.id}`, a);
  const userTurns = detail.issue.discussion.filter((item) => item.role === "user");
  assert.equal(userTurns.length, 2);
  assert.deepEqual(new Set(userTurns.map((item) => item.text)), new Set(turns.map((item) => item.text)));
  assert.deepEqual(new Set(userTurns.map((item) => item.actorUserId)), new Set([a.user.id, b.user.id]));
});
