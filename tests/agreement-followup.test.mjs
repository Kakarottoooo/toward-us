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
import { openCheckIn } from "../server/together-domain.mjs";

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
  assert.match(card.i18n.zh, /^约定「Trash」，有人想改，等新的一份\nBlair 想改：Tuesdays work better\n/); assert.match(card.i18n.en, /\nBlair wants a change: Tuesdays work better\n/); assert.match(card.i18n.es, /\nBlair quiere cambiar: Tuesdays work better\n/);
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

test("a plain answer to the check-in reaches Pinky, which records only the writer's own part of the commitments", async (t) => {
  const f = await fixture(t, { structured: () => ({ commitments: [{ termIndex: 0, description: "cook dinner", by: "A", dueDate: date(3) }, { termIndex: 1, description: "walk on Wednesdays", by: "both", dueDate: "" }] }) });
  const agreement = await f.draft({ title: "Evenings", summary: "Dinner and walks", terms: [`Alex cooks dinner on ${date(3)}`, "We walk every Wednesday"] });
  await f.approve(agreement, f.a); await f.approve(agreement, f.b);
  const [cook, walk] = (await f.store.listRelationshipRecordsForUser("commitments", f.a)).sort((x, y) => x.id.localeCompare(y.id));
  f.advance(Date.now() + 7 * DAY + 60_000); await f.service.runDue();
  const checkIn = (await f.conversation()).messages.at(-1);
  assert.equal(checkIn.kind, "review");
  // The model answers whoever wrote last: Alex says both are done, Blair then claims Alex's dinner for themself.
  const seen = [];
  f.mediator.continueTogether = async (context) => {
    seen.push(context); const last = context.messages.at(-1);
    if (last.text === "Yes! I cooked on time and we walked") return { reply: "Lovely, Alex. Blair, how did it go for you?", draftAgreement: null, actions: [{ kind: "commitment", operation: "update", targetId: cook.id, done: true, text: "cooked on time" }, { kind: "commitment", operation: "update", targetId: walk.id, done: true, text: "we walked" }] };
    if (last.text === "I cooked dinner too") return { reply: "Noted.", draftAgreement: null, actions: [{ kind: "commitment", operation: "update", targetId: cook.id, done: true, text: "cooked" }] };
    return { reply: "ok", draftAgreement: null, actions: [] };
  };
  const send = async (userId, text) => { const result = await f.request("/together/messages", "POST", { text, language: "en", itemId: randomUUID() }, userId); assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body; };
  // 1. Alex answers without @-mentioning Pinky: it counts as a reply to the check-in, and Pinky answers.
  const first = await send(f.a, "Yes! I cooked on time and we walked");
  assert.equal(first.message.replyTo, checkIn.id); assert.equal(first.reply?.replyTo, first.message.id);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].openCommitments.map((item) => [item.id, item.owner]), [[cook.id, "Alex"], [walk.id, "both"]], "the model sees whose part each commitment is");
  const cookNow = await f.store.getRelationshipRecordForUser("commitments", cook.id, f.b), walkNow = await f.store.getRelationshipRecordForUser("commitments", walk.id, f.b);
  assert.equal(cookNow.status, "completed", "Alex's one-off commitment is done"); assert.deepEqual(cookNow.completedBy, [f.a]);
  assert.equal(walkNow.status, "active", "a standing rule stays in force"); assert.deepEqual(walkNow.completedBy, []);
  assert.deepEqual(walkNow.checkIns.map((item) => [item.userId, item.kept, item.note]), [[f.a, true, "we walked"]]);
  assert.ok(first.reply.refs.some((ref) => ref.type === "commitment" && ref.id === cook.id));
  // 2. Blair's first message after the check-in is an answer too; trying to record Alex's part changes nothing.
  const reopened = await f.store.updateRelationshipRecordForUser("commitments", cook.id, f.a, (draft) => { draft.status = "active"; draft.completedBy = []; });
  const second = await send(f.b, "I cooked dinner too");
  assert.equal(second.message.replyTo, checkIn.id); assert.equal(seen.length, 2);
  assert.match(second.reply.text, /couldn't do that, and nothing was changed/);
  assert.deepEqual((await f.store.getRelationshipRecordForUser("commitments", cook.id, f.a)).completedBy, reopened.completedBy);
  // 3. After each has answered once, Pinky waits to be called again.
  const third = await send(f.a, "see you tonight");
  assert.equal(third.message.replyTo, null); assert.equal(third.reply, null); assert.equal(seen.length, 2);
});

test("a check-in stays open to each member's first message for twelve hours, and only agreement check-ins open it", () => {
  const at = Date.parse("2026-11-05T10:00:00.000Z"), hour = 3_600_000;
  const checkIn = { id: "c", role: "agent", kind: "review", refs: [{ type: "agreement", id: "x", version: 1 }], createdAt: new Date(at).toISOString() };
  assert.equal(openCheckIn([checkIn], "a", at + 11 * hour)?.id, "c");
  assert.equal(openCheckIn([checkIn], "a", at + 13 * hour), null, "too late");
  assert.equal(openCheckIn([checkIn, { id: "m", role: "member", actorUserId: "a", createdAt: checkIn.createdAt }], "a", at + hour), null, "already answered");
  assert.equal(openCheckIn([checkIn, { id: "m", role: "member", actorUserId: "b", createdAt: checkIn.createdAt }], "a", at + hour)?.id, "c", "the partner's answer leaves it open for this member");
  assert.equal(openCheckIn([{ ...checkIn, refs: [{ type: "outcome", id: "o" }] }], "a", at + hour), null, "an outcome review is answered privately");
});

test("the note in Us names due and check-in days in the members' own time zone, not the UTC date", async (t) => {
  const f = await fixture(t, { structured: () => ({ commitments: [{ termIndex: 0, description: "book the table", by: "A", dueDate: date(3) }] }) });
  // Alex is in Auckland (UTC+13 in November), where 09:00 on the due day is still the previous day in UTC.
  await f.service.updateNotify(f.a, { messages: true, timezone: "Pacific/Auckland" });
  const agreement = await f.draft({ title: "Anniversary", summary: "Dinner out", terms: ["Alex books the table"] });
  // A check-in the two chose themselves, at 15:00 UTC: already the next morning in Auckland.
  const reviewAt = `${date(8)}T15:00:00.000Z`;
  await f.store.updateRelationshipRecordForUser("agreements", agreement.id, f.a, (draft) => { draft.reviewAt = reviewAt; });
  await f.approve(agreement, f.b); await f.approve(agreement, f.a);
  const [commitment] = await f.store.listRelationshipRecordsForUser("commitments", f.a);
  assert.equal(commitment.dueAt.slice(0, 10), date(2), "stored as an instant: the UTC date is a day earlier");
  const note = (await f.conversation()).messages.at(-1);
  assert.ok(note.i18n.en.includes(`1. Alex: book the table (by ${date(3)})`), note.i18n.en);
  assert.ok(note.i18n.en.includes(`check in here on ${date(9)}.`), note.i18n.en);
  assert.ok(note.i18n.zh.includes(`（${date(3)} 前）`) && note.i18n.zh.includes(`${date(9)} 我在这里问问`), note.i18n.zh);
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

test("an open point is settled on the card: a new version, both say yes again, and Us hears what changed; who said yes shows", async (t) => {
  const f = await fixture(t);
  const agreement = await f.draft({ title: "This weekend", summary: "Rest Saturday, lunch at my parents' Sunday", terms: ["Saturday: rest at home", "Sunday: lunch at my parents' at 1pm"], unresolvedPoints: ["When do we leave on Sunday?", "Who tells my parents?"] });
  assert.deepEqual([agreement.proposedBy, agreement.approvedBy], [f.a, []]);
  const yes = await f.approve(agreement, f.a);
  assert.deepEqual(yes.approvedBy, [f.a], "the shared agreement says who has said yes to this version");
  assert.deepEqual((await f.request("/together", "GET", null, f.b)).body.pendingAgreement.approvedBy, [f.a], "so Blair sees Alex already agreed");

  const answer = (body, userId = f.b) => f.request(`/together/agreements/${agreement.id}/answer`, "POST", { version: yes.version, language: "en", ...body }, userId);
  assert.equal((await answer({ index: 0, text: "  " })).status, 400);
  assert.equal((await answer({ index: 5, text: "12:30" })).status, 400);
  assert.equal((await answer({ index: 0, text: "12:30", version: yes.version + 1 })).status, 409);
  const settled = (await answer({ index: 0, text: "12:30 by taxi" })).body.agreement;
  assert.equal(settled.version, yes.version + 1);
  assert.deepEqual(settled.terms.at(-1), "When do we leave on Sunday：12:30 by taxi");
  assert.deepEqual(settled.unresolvedPoints, ["Who tells my parents?"]);
  assert.deepEqual(settled.approvedBy, [], "a new version: the earlier yes no longer counts");
  assert.equal(settled.status, "awaiting_approvals");
  const us = await f.conversation(f.a);
  assert.ok(us.messages.some((message) => message.i18n?.en === `Blair settled "When do we leave on Sunday": 12:30 by taxi. It's a new version now, so you both say yes again.`));
  assert.ok(us.messages.some((message) => message.kind === "agreement_card" && message.refs?.some((ref) => ref.id === agreement.id && ref.version === settled.version)), "with the new version's card to approve");

  assert.equal((await f.request(`/together/agreements/${agreement.id}/approve`, "POST", { version: yes.version }, f.b)).status, 409, "the old version can't be approved any more");
  await f.approve(settled, f.a);
  assert.equal((await f.approve(settled, f.b)).status, "active");
  assert.equal((await f.request(`/together/agreements/${agreement.id}/answer`, "POST", { version: settled.version, index: 0, text: "I will" })).status, 409, "only while it waits for approval");
});

test("Pinky words a settled point like the other terms; without it, the point and the answer are kept as they are", async (t) => {
  const asked = [];
  const f = await fixture(t, { structured: ({ name, input }) => { asked.push({ name, input: JSON.parse(input) }); return { term: "周日：十二点半出发，打车去" }; } });
  const agreement = await f.draft({ title: "本周末", summary: "周日去爸妈家", terms: ["周日：下午一点到爸妈家吃饭。"], unresolvedPoints: ["周日几点出发，以及怎么去。"] });
  const settled = (await f.request(`/together/agreements/${agreement.id}/answer`, "POST", { version: agreement.version, index: 0, text: "十二点半出发，打车", language: "zh" })).body.agreement;
  assert.equal(settled.terms.at(-1), "周日：十二点半出发，打车去");
  assert.deepEqual(asked, [{ name: "agreement_point", input: { terms: ["周日：下午一点到爸妈家吃饭。"], point: "周日几点出发，以及怎么去。", answer: "十二点半出发，打车" } }], "only the agreement's terms, the point and the answer");
});

test("计划 not 约定: a plan written as an agreement goes onto the shared calendar, a reminder the day before, the agreement taken away", async (t) => {
  const { datedTerms } = await import("../server/plan-to-calendar.mjs");
  // Written on Monday 2 November 2026: 周六 is the 7th, 周日 the 8th, 明天 the 3rd; a term with no day isn't dated.
  assert.deepEqual(datedTerms(["周六：在家休息。", "周日：下午一点到爸妈家吃饭。", "Sunday: back by 7pm", "明天：买水果", "一起早点睡"], "2026-11-02"),
    [{ date: "2026-11-07", label: "周六", text: "在家休息" }, { date: "2026-11-08", label: "周日", text: "下午一点到爸妈家吃饭" }, { date: "2026-11-08", label: "Sunday", text: "back by 7pm" }, { date: "2026-11-03", label: "明天", text: "买水果" }]);
  const f = await fixture(t);
  const agreement = await f.draft({ title: "本周末安排", summary: "周末", terms: ["周六：在家休息。", "周日：下午一点到爸妈家吃饭。"] });
  const move = (body, userId = f.b) => f.request(`/together/agreements/${agreement.id}/to-calendar`, "POST", { version: agreement.version, language: "zh", ...body }, userId);
  assert.equal((await move({ version: agreement.version + 1 })).status, 409);
  const moved = await move({});
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.agreement.status, "archived"); assert.ok(moved.body.agreement.archivedAt, "archived, never deleted");
  const dates = (await f.store.listRelationshipRecordsForUser("milestones", f.a)).filter((item) => item.sourceAgreementId === agreement.id);
  assert.deepEqual(dates.map((item) => [item.title, item.recurringRule, item.visibility]).sort(), [["周六 · 在家休息", "once", "shared"], ["周日 · 下午一点到爸妈家吃饭", "once", "shared"]]);
  const reminders = (await f.store.listRelationshipRecordsForUser("reminders", f.a)).filter((item) => dates.some((date) => date.id === item.milestoneId));
  assert.deepEqual(reminders.map((item) => item.minutesBefore), [1440, 1440], "a reminder the day before each");
  assert.equal((await f.request("/together", "GET", null, f.a)).body.pendingAgreement, null, "no agreement waiting any more");
  assert.ok((await f.conversation(f.a)).messages.some((message) => /^Blair 把「本周末安排」放进了日历：/.test(message.i18n?.zh || "")));
  // One with no days can't go on the calendar.
  const rule = await f.draft({ title: "做饭", summary: "轮流做饭", terms: ["我们轮流做饭"] });
  assert.equal((await f.request(`/together/agreements/${rule.id}/to-calendar`, "POST", { version: rule.version })).status, 400);
});
