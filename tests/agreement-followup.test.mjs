import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createReminderService } from "../server/reminder-service.mjs";
import { createTogetherRouter } from "../server/together-router.mjs";
import { createRelationshipRecord } from "../server/relationship-domain.mjs";
import { followThroughAgreement, verifyPlan } from "../server/agreement-followup.mjs";

// "说到做到" (founder, 11-01): an agreement both approve in Us turns into commitments, reminders and a check-in.
const DAY = 86_400_000;
const date = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

async function fixture(t, { structured = null } = {}) {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "followup-"));
  const store = await createFileStore(join(directory, "store.json"));
  const [a, b] = [randomUUID(), randomUUID()];
  for (const id of [a, b]) await store.createUser({ id, email: `${id}@example.invalid`, name: id === a ? "Alex" : "Blair", passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: a, role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: a, expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, b, new Date().toISOString());
  const mediator = { continueTogether: async () => ({ reply: "ok", draftAgreement: null, actions: [] }), ...(structured ? { structured: async (...args) => structured(...args) } : {}) };
  let time = new Date();
  const service = createReminderService({ store, now: () => new Date(time) });
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createTogetherRouter({ store, mediator }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); assert.ok(resolve(directory).startsWith(base)); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, method = "GET", body, userId = a) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  const conversation = (userId = a) => store.getRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, userId);
  const draft = async (values) => { const result = await request("/together/agreements/draft", "POST", { ...values, language: "en" }); assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body.agreement; };
  const approve = async (agreement, userId, version = agreement.version) => { const result = await request(`/together/agreements/${agreement.id}/approve`, "POST", { version, language: "en" }, userId); assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.agreement; };
  return { store, a, b, relationshipId, mediator, request, service, conversation, draft, approve, advance: (value) => { time = new Date(value); } };
}

test("an agreement both approve in Us becomes commitments, a reminder for whoever is responsible, and a check-in a week later", async (t) => {
  const seen = [];
  const f = await fixture(t, { structured: ({ name, input, instructions }) => {
    assert.equal(name, "agreement_commitments"); seen.push({ input: JSON.parse(input), instructions });
    return { commitments: [{ termIndex: 0, description: "cook dinner", by: "A", dueDate: date(3) }, { termIndex: 1, description: "plan the weekend together", by: "both", dueDate: "" }, { termIndex: 9, description: "invented", by: "B", dueDate: "" }] };
  } });
  const agreement = await f.draft({ title: "Dinner duty", summary: "Who cooks and when we plan", terms: [`Alex cooks dinner on ${date(3)}`, "We plan the weekend together every Sunday"] });
  assert.equal((await f.approve(agreement, f.a)).status, "awaiting_approvals");
  assert.deepEqual(await f.store.listRelationshipRecordsForUser("commitments", f.a), [], "one approval makes nothing");
  assert.equal((await f.approve(agreement, f.b)).status, "active");
  // The model saw only the shared agreement and the two names; nothing else of theirs.
  assert.deepEqual(Object.keys(seen[0].input).sort(), ["summary", "terms", "title"]); assert.match(seen[0].instructions, /A is Alex, B is Blair/);
  const commitments = (await f.store.listRelationshipRecordsForUser("commitments", f.b)).sort((x, y) => x.id.localeCompare(y.id));
  assert.deepEqual(commitments.map((item) => [item.ownerType, item.description, item.status, item.agreementVersion, item.visibility, item.term]),
    [["member_a", "cook dinner", "active", 1, "shared", `Alex cooks dinner on ${date(3)}`], ["both", "plan the weekend together", "active", 1, "shared", "We plan the weekend together every Sunday"]], "an invented term is dropped");
  assert.equal(commitments[0].dueAt, `${date(3)}T09:00:00.000Z`, "due at nine that morning (no time zone known: UTC)");
  assert.equal(commitments[1].dueAt, null);
  assert.deepEqual(commitments[0].confirmedBy, [f.a]); assert.deepEqual(commitments[1].confirmedBy.sort(), [f.a, f.b].sort());
  const stored = await f.store.getRelationshipRecordForUser("agreements", agreement.id, f.a);
  assert.equal(stored.version, 1, "bookkeeping never bumps the version both approved");
  assert.equal(Date.parse(stored.reviewAt) - Date.parse(stored.effectiveAt), 7 * DAY, "a check-in a week after it took effect");
  assert.ok(commitments.every((item) => item.reviewAt === stored.reviewAt));
  // Only Alex is responsible for the dated one, so only Alex gets a reminder (the morning before), and only Alex can see it.
  const mine = (await f.store.listRelationshipRecordsForUser("reminders", f.a)).filter((item) => item.ownerUserId === f.a);
  assert.deepEqual(mine.map((item) => [item.title, item.dueAt, item.target, item.visibility, item.sourceRelationshipId]), [["cook dinner", `${date(2)}T09:00:00.000Z`, { kind: "commitment", id: commitments[0].id }, "private", f.relationshipId]]);
  assert.deepEqual((await f.store.listRelationshipRecordsForUser("reminders", f.b)).filter((item) => item.ownerUserId === f.b), []);
  // Pinky tells both in Us what it will follow up on, in each one's language.
  const note = (await f.conversation()).messages.at(-1);
  assert.equal(note.role, "agent"); assert.match(note.text, /"Dinner duty" is now in effect/);
  assert.match(note.text, new RegExp(`1\\. Alex: cook dinner \\(by ${date(3)}\\)`)); assert.match(note.text, /2\. both of you: plan the weekend together/); assert.match(note.text, /the day before each due date/);
  assert.match(note.i18n.zh, /你们俩：plan the weekend together/); assert.match(note.i18n.es, /los dos: plan the weekend together/);
  assert.deepEqual(note.refs.filter((ref) => ref.type === "commitment").map((ref) => ref.id), commitments.map((item) => item.id));
  // Running it again changes nothing.
  assert.equal(await followThroughAgreement({ store: f.store, mediator: f.mediator, agreementId: agreement.id, userId: f.a }), null);
  assert.equal((await f.store.listRelationshipRecordsForUser("commitments", f.a)).length, 2); assert.equal(seen.length, 1);
  // The check-in is posted in Us once the review date comes, once, for both.
  const checkIns = async () => (await f.conversation(f.b)).messages.filter((item) => item.kind === "review" && item.handle === `agreement-review:${agreement.id}:v1`);
  f.advance(Date.now() + 6 * DAY); await f.service.runDue();
  assert.equal((await checkIns()).length, 0, "not before the review date");
  f.advance(Date.now() + 7 * DAY + 60_000); await f.service.runDue(); await f.service.runDue();
  const [checkIn] = await checkIns();
  assert.equal((await checkIns()).length, 1); assert.match(checkIn.i18n.zh, /「Dinner duty」.*这周做到了吗/); assert.match(checkIn.i18n.en, /Time to check in on "Dinner duty"/);
  assert.deepEqual(checkIn.refs, [{ type: "agreement", id: agreement.id, version: 1 }]);
});

test("a change request says who asked and why, and the version both approve next replaces the old commitments", async (t) => {
  const f = await fixture(t, { structured: ({ input }) => ({ commitments: JSON.parse(input).terms.map((term, termIndex) => ({ termIndex, description: term, by: "B", dueDate: "" })) }) });
  const agreement = await f.draft({ title: "Trash", summary: "Taking out the trash", terms: ["Take out the trash every Monday"] });
  await f.approve(agreement, f.a); await f.approve(agreement, f.b);
  const [first] = await f.store.listRelationshipRecordsForUser("commitments", f.a);
  assert.equal(first.ownerType, "member_b");
  const changed = await f.request(`/together/agreements/${agreement.id}/request-change`, "POST", { version: 1, reason: "Tuesdays work better", language: "en" }, f.b);
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.agreement.status, "draft"); assert.equal(changed.body.agreement.changeReason, "Tuesdays work better"); assert.equal(changed.body.agreement.changedByUserId, f.b);
  // The card in Us says who and why in every language; the old commitment waits for the new version.
  const card = (await f.conversation()).messages.at(-1);
  assert.equal(card.kind, "agreement_card");
  assert.match(card.i18n.zh, /^约定「Trash」v2，有人要求修改，等待新版本\nBlair 想改：Tuesdays work better\n/); assert.match(card.i18n.en, /\nBlair wants a change: Tuesdays work better\n/); assert.match(card.i18n.es, /\nBlair quiere cambiar: Tuesdays work better\n/);
  assert.equal((await f.store.getRelationshipRecordForUser("commitments", first.id, f.a)).status, "renegotiation_requested");
  const revised = await f.draft({ title: "Trash", summary: "Taking out the trash", terms: ["Take out the trash every Tuesday"] });
  assert.equal(revised.id, agreement.id); assert.equal(revised.version, 3);
  await f.approve(revised, f.a); await f.approve(revised, f.b);
  const after = await f.store.listRelationshipRecordsForUser("commitments", f.a);
  assert.deepEqual(after.filter((item) => !item.archivedAt).map((item) => [item.agreementVersion, item.description, item.ownerType, item.status]), [[3, "Take out the trash every Tuesday", "member_b", "active"]]);
  assert.equal(after.find((item) => item.id === first.id).status, "superseded");
});

test("without a model every term binds both, and agreements from the full decision flow keep their hand-made plan", async (t) => {
  const f = await fixture(t);
  const agreement = await f.draft({ title: "Evenings", summary: "Phone-free dinners", terms: ["No phones at dinner", "Walk after dinner on weekdays"] });
  await f.approve(agreement, f.a); await f.approve(agreement, f.b);
  const made = await f.store.listRelationshipRecordsForUser("commitments", f.a);
  assert.deepEqual(made.map((item) => [item.ownerType, item.description, item.dueAt, item.status]), [["both", "No phones at dinner", null, "active"], ["both", "Walk after dinner on weekdays", null, "active"]]);
  assert.deepEqual(await f.store.listRelationshipRecordsForUser("reminders", f.a), [], "no date, no reminder");
  assert.equal((await f.store.getRelationshipRecordForUser("agreements", agreement.id, f.a)).followedUp.source, "local");
  assert.match((await f.conversation()).messages.at(-1).text, /I'll check in here on \d{4}-\d{2}-\d{2} to see how it went\./);
  // The full decision flow plans commitments by hand, each responsible member confirming their own: Pinky stays out of it.
  const formal = createRelationshipRecord({ relationshipId: f.relationshipId, userId: f.a, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "awaiting_approvals", sourceIssueId: randomUUID(), proposalId: null, title: "Visits", summary: "Monthly visits", terms: ["Each arranges a visit"], unresolvedPoints: [], effectiveAt: null, reviewAt: null });
  await f.store.createRelationshipRecord("agreements", formal);
  await f.approve(formal, f.a); assert.equal((await f.approve(formal, f.b)).status, "active");
  assert.equal((await f.store.listRelationshipRecordsForUser("commitments", f.a)).length, 2, "nothing added for it");
  assert.equal((await f.store.getRelationshipRecordForUser("agreements", formal.id, f.a)).followedUp, undefined);
});

test("a plan is kept only where it points at a real term, names who, and dates nothing in the past", () => {
  const terms = ["Call mom on Sunday", "Split the bills"];
  assert.deepEqual(verifyPlan([
    { termIndex: 0, description: "call mom", by: "A", dueDate: "2026-11-08" },
    { termIndex: 1, description: "split the bills", by: "both", dueDate: "2026-10-01" },
    { termIndex: 2, description: "made up", by: "B", dueDate: "" },
    { termIndex: 1, description: "", by: "B", dueDate: "" },
    { termIndex: 0, description: "call mom", by: "C", dueDate: "" },
    { termIndex: 1, description: "pay", by: "B", dueDate: "not a date" },
  ], terms, "2026-11-05"), [
    { termIndex: 0, description: "call mom", by: "A", dueDate: "2026-11-08" },
    { termIndex: 1, description: "split the bills", by: "both", dueDate: "" },
    { termIndex: 1, description: "pay", by: "B", dueDate: "" },
  ]);
  assert.deepEqual(verifyPlan(null, terms, "2026-11-05"), []);
});
