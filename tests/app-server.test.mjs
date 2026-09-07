import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApiApp } from "../server/app.mjs";
import { createMediator, sanitizeFollowUp } from "../server/mediator.mjs";
import { createFileStore } from "../server/store.mjs";
import { nextOccurrence, publicRelationshipEvent } from "../server/relationship-domain.mjs";

let server;
let baseUrl;
let temporaryDirectory;
let store;
let counter = 0;
let lastDecisionContext = null;

test("shared AI follow-up is rendered as clean public prose", () => {
  assert.equal(
    sanitizeFollowUp('可以这样说： **“我愿意先听你说完。”**\n\nsafety.level：0'),
    '可以这样说： “我愿意先听你说完。”',
  );
});

test("WebRTC transcription is created as a realtime call with ASR input enabled", async () => {
  const originalFetch = globalThis.fetch;
  let session;
  globalThis.fetch = async (_url, options) => {
    session = JSON.parse(options.body.get("session"));
    return new Response("v=0\r\ns=-\r\n", { status: 201, headers: { "content-type": "application/sdp" } });
  };
  try {
    const mediator = createMediator({ apiKey: "test-key" });
    const answer = await mediator.createRealtimeSession({ sdp: "v=0\r\ns=-\r\n", language: "es" });
    assert.match(answer, /^v=0/);
    assert.equal(session.type, "realtime");
    assert.equal(session.model, "gpt-realtime");
    assert.deepEqual(session.output_modalities, ["text"]);
    assert.equal(session.audio.input.transcription.model, "gpt-live-transcribe");
    assert.equal(session.audio.input.transcription.language, "es");
    assert.equal(session.audio.input.turn_detection.create_response, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("relationship-domain contracts keep events minimal and yearly dates stable", () => {
  assert.deepEqual(publicRelationshipEvent("issue.updated", "object-1", 3), { eventType: "issue.updated", objectId: "object-1", version: 3 });
  assert.equal(nextOccurrence("2020-09-10", "yearly", new Date("2026-09-02T00:00:00Z")), "2026-09-10T12:00:00.000Z");
  assert.equal(nextOccurrence("2020-08-10", "yearly", new Date("2026-09-02T00:00:00Z")), "2027-08-10T12:00:00.000Z");
});

before(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "toward-us-test-"));
  store = await createFileStore(join(temporaryDirectory, "store.json"));
  const app = createApiApp({ store, mediator: fakeMediator, production: false });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(temporaryDirectory, { recursive: true, force: true });
});

test("registration uses an HttpOnly cookie and partner invitations bind exactly two accounts", async () => {
  const alice = await register("Alice");
  const bob = await register("Bob");
  assert.match(alice.setCookie, /toward_us_session=.*HttpOnly.*SameSite=Lax/);

  const invitation = await request("/api/partner/invitations", { method: "POST", cookie: alice.cookie, expectedStatus: 201 });
  assert.equal(invitation.pairing.status, "pending");
  assert.equal(invitation.pairing.invitation.code.length, 8);

  const selfAccept = await request("/api/partner/accept", { method: "POST", cookie: alice.cookie, body: { code: invitation.pairing.invitation.code }, expectedStatus: 409 });
  assert.match(selfAccept.error, /邀请无效/);

  const accepted = await request("/api/partner/accept", { method: "POST", cookie: bob.cookie, body: { code: invitation.pairing.invitation.code } });
  assert.equal(accepted.pairing.status, "active");
  assert.deepEqual(accepted.pairing.members.map((member) => member.name), ["Alice", "Bob"]);
});

test("relationship data is isolated and private AI feedback is visible only to its account", async () => {
  const pairOne = await createPair("Red", "Blue");
  const pairTwo = await createPair("Green", "Gold");

  const created = await request("/api/rooms", { method: "POST", cookie: pairOne.a.cookie, body: { mode: "remote", language: "zh", personality: "friend" }, expectedStatus: 201 });
  const code = created.room.code;
  await request(`/api/rooms/${code}/join`, { method: "POST", cookie: pairOne.b.cookie });
  await request(`/api/rooms/${code}/messages`, { method: "POST", cookie: pairOne.a.cookie, body: { text: "我希望先确认事实。" }, expectedStatus: 201 });
  await request(`/api/rooms/${code}/messages`, { method: "POST", cookie: pairOne.b.cookie, body: { text: "我希望先被完整听完。" }, expectedStatus: 201 });
  await request(`/api/rooms/${code}/analyze`, { method: "POST", cookie: pairOne.a.cookie });

  const viewA = await request(`/api/rooms/${code}`, { cookie: pairOne.a.cookie });
  const viewB = await request(`/api/rooms/${code}`, { cookie: pairOne.b.cookie });
  assert.deepEqual(Object.keys(viewA.room.privateFeedback), [pairOne.a.user.id]);
  assert.deepEqual(Object.keys(viewB.room.privateFeedback), [pairOne.b.user.id]);
  assert.equal(viewA.room.sharedAnalysis.title, "A shared view");

  const crossPair = await request(`/api/rooms/${code}`, { cookie: pairTwo.a.cookie, expectedStatus: 404 });
  assert.match(crossPair.error, /不属于/);
});

test("realtime speech commits one voice turn to the speaker selected when speech started", async () => {
  const pair = await createPair("RealtimeA", "RealtimeB");
  const created = await request("/api/rooms", { method: "POST", cookie: pair.a.cookie, body: { mode: "shared", language: "zh", personality: "friend" }, expectedStatus: 201 });
  const partner = created.room.participants.find((participant) => participant.role === "B");

  const first = await request(`/api/rooms/${created.room.code}/transcripts`, {
    method: "POST", cookie: pair.a.cookie, expectedStatus: 201,
    body: { itemId: "speech-item-1", speakerId: partner.id, text: "这是停顿后自动完成的一句话。" },
  });
  assert.equal(first.room.messages.at(-1).participantId, partner.id);
  assert.equal(first.room.messages.at(-1).source, "voice");

  const duplicate = await request(`/api/rooms/${created.room.code}/transcripts`, {
    method: "POST", cookie: pair.a.cookie,
    body: { itemId: "speech-item-1", speakerId: pair.a.user.id, text: "重复事件不应新增消息。" },
  });
  assert.equal(duplicate.room.messages.length, 1);
  assert.equal(duplicate.room.messages[0].participantId, partner.id);
});

test("realtime microphone setup is authorized by room membership and returns an SDP answer", async () => {
  const pair = await createPair("WebRtcA", "WebRtcB");
  const created = await request("/api/rooms", { method: "POST", cookie: pair.a.cookie, body: { mode: "remote", language: "en", personality: "friend" }, expectedStatus: 201 });
  const response = await fetch(`${baseUrl}/api/rooms/${created.room.code}/realtime`, {
    method: "POST",
    headers: { cookie: pair.a.cookie, origin: baseUrl, "content-type": "application/sdp" },
    body: "v=0\r\no=test-offer",
  });
  const answer = await response.text();
  assert.equal(response.status, 200, answer);
  assert.equal(response.headers.get("content-type"), "application/sdp; charset=utf-8");
  assert.equal(answer, "v=0\r\no=test-answer");
});

test("both partners can continue a shared conversation with the AI in the same room", async () => {
  const pair = await createPair("AskA", "AskB");
  const created = await request("/api/rooms", { method: "POST", cookie: pair.a.cookie, body: { mode: "remote", language: "zh", personality: "friend" }, expectedStatus: 201 });
  const code = created.room.code;
  await request(`/api/rooms/${code}/join`, { method: "POST", cookie: pair.b.cookie });
  await request(`/api/rooms/${code}/messages`, { method: "POST", cookie: pair.a.cookie, body: { text: "我需要安静一下。" }, expectedStatus: 201 });
  await request(`/api/rooms/${code}/messages`, { method: "POST", cookie: pair.b.cookie, body: { text: "我需要知道什么时候再谈。" }, expectedStatus: 201 });
  await request(`/api/rooms/${code}/analyze`, { method: "POST", cookie: pair.a.cookie });

  const asked = await request(`/api/rooms/${code}/ask-ai`, { method: "POST", cookie: pair.b.cookie, body: { question: "我们今晚可以怎么重新开始？" }, expectedStatus: 201 });
  assert.deepEqual(asked.room.aiConversation.map((entry) => entry.role), ["user", "assistant"]);
  assert.equal(asked.room.aiConversation[0].participantId, pair.b.user.id);
  assert.match(asked.room.aiConversation[1].text, /先约定一个时间/);

  const viewA = await request(`/api/rooms/${code}`, { cookie: pair.a.cookie });
  assert.deepEqual(viewA.room.aiConversation, asked.room.aiConversation);
});

test("archiving requires confirmation from both partners and then appears in shared history", async () => {
  const pair = await createPair("North", "South");
  const created = await request("/api/rooms", { method: "POST", cookie: pair.a.cookie, body: { mode: "shared", language: "en", personality: "direct" }, expectedStatus: 201 });
  const code = created.room.code;
  const partner = created.room.participants.find((participant) => participant.role === "B");
  await request(`/api/rooms/${code}/messages`, { method: "POST", cookie: pair.a.cookie, body: { text: "I want a clear date.", speakerId: pair.a.user.id }, expectedStatus: 201 });
  const attributed = await request(`/api/rooms/${code}/messages`, { method: "POST", cookie: pair.a.cookie, body: { text: "I want a budget first.", speakerId: partner.id }, expectedStatus: 201 });
  assert.equal(attributed.room.messages[1].participantId, partner.id);
  const audioResponse = await fetch(`${baseUrl}/api/rooms/${code}/audio`, {
    method: "POST",
    headers: { cookie: pair.a.cookie, origin: baseUrl, "content-type": "audio/webm", "x-toward-us-speaker-id": partner.id },
    body: Buffer.alloc(128, 1),
  });
  const audioPayload = await audioResponse.json();
  assert.equal(audioResponse.status, 200, JSON.stringify(audioPayload));
  assert.equal(audioPayload.room.messages.at(-1).participantId, partner.id);
  await request(`/api/rooms/${code}/analyze`, { method: "POST", cookie: pair.a.cookie });

  const first = await request(`/api/rooms/${code}/confirm-archive`, { method: "POST", cookie: pair.a.cookie });
  assert.equal(first.room.status, "active");
  assert.equal(first.room.confirmation.confirmedCount, 1);
  const second = await request(`/api/rooms/${code}/confirm-archive`, { method: "POST", cookie: pair.b.cookie });
  assert.equal(second.room.status, "archived");
  assert.equal(second.room.confirmation.complete, true);

  const historyA = await request("/api/history", { cookie: pair.a.cookie });
  const historyB = await request("/api/history", { cookie: pair.b.cookie });
  assert.equal(historyA.items[0].code, code);
  assert.equal(historyB.items[0].code, code);
  const detail = await request(`/api/history/${code}`, { cookie: pair.b.cookie });
  assert.equal(detail.item.sharedAnalysis.commonGround[0], "repair");
});

test("logout revokes the server session", async () => {
  const account = await register("Logout");
  await request("/api/auth/logout", { method: "POST", cookie: account.cookie, expectedStatus: 204, parseJson: false });
  const state = await request("/api/auth/me", { cookie: account.cookie });
  assert.equal(state.user, null);
});

test("P0 relationship graph enforces private reminders and private-surprise non-disclosure", async () => {
  const pair = await createPair("GraphA", "GraphB");
  const milestone = await request("/api/milestones", { method: "POST", cookie: pair.a.cookie, expectedStatus: 201, body: { type: "anniversary", title: "Our anniversary", date: "2020-09-10", timezone: "America/Los_Angeles", recurringRule: "yearly" } });
  await request(`/api/milestones/${milestone.milestone.id}/reminders`, { method: "POST", cookie: pair.a.cookie, expectedStatus: 201, body: { visibility: "private", minutesBefore: 20160, privateNotes: "SECRET_GIFT_REMINDER" } });
  await request(`/api/milestones/${milestone.milestone.id}/reminders`, { method: "POST", cookie: pair.b.cookie, expectedStatus: 201, body: { visibility: "private", minutesBefore: 1440, privateNotes: "B_PRIVATE_REMINDER" } });
  const list = await request("/api/lists", { method: "POST", cookie: pair.a.cookie, expectedStatus: 201, body: { title: "Wishlist", type: "gifts" } });
  const surprise = await request(`/api/lists/${list.list.id}/items`, { method: "POST", cookie: pair.a.cookie, expectedStatus: 201, body: { title: "Secret preparation", visibility: "private_surprise", estimatedCostRange: "private-budget" } });
  const homeA = await request("/api/relationship/home", { cookie: pair.a.cookie });
  const homeB = await request("/api/relationship/home", { cookie: pair.b.cookie });
  assert.equal(homeA.graph.reminders.length, 1);
  assert.equal(homeB.graph.reminders.length, 1);
  assert.equal(homeA.graph.reminders[0].minutesBefore, 20160);
  assert.equal(homeB.graph.reminders[0].minutesBefore, 1440);
  assert.equal(homeA.graph.milestones[0].timezone, "America/Los_Angeles");
  assert.equal(JSON.stringify(homeB).includes("SECRET_GIFT_REMINDER"), false);
  assert.equal(homeA.graph.listItems.some((item) => item.id === surprise.item.id), true);
  assert.equal(homeB.graph.listItems.some((item) => item.id === surprise.item.id), false);
  assert.equal(JSON.stringify(homeB).includes("private-budget"), false);
  const firstReveal = await request(`/api/list-items/${surprise.item.id}/reveal`, { method: "POST", cookie: pair.a.cookie });
  const secondReveal = await request(`/api/list-items/${surprise.item.id}/reveal`, { method: "POST", cookie: pair.a.cookie });
  assert.equal(secondReveal.item.version, firstReveal.item.version);
  const revealed = await request("/api/relationship/home", { cookie: pair.b.cookie });
  assert.equal(revealed.graph.listItems.some((item) => item.id === surprise.item.id), true);
  await request(`/api/list-items/${surprise.item.id}`, { method: "DELETE", cookie: pair.a.cookie, expectedStatus: 204, parseJson: false });
  const archived = await request("/api/relationship/home", { cookie: pair.b.cookie });
  assert.equal(archived.graph.listItems.some((item) => item.id === surprise.item.id), false);
});

test("joint decision context excludes private perspective tokens and objects stay relationship-scoped", async () => {
  const pair = await createPair("DecisionA", "DecisionB");
  const outsider = await createPair("OutsiderA", "OutsiderB");
  const issue = await request("/api/issues", { method: "POST", cookie: pair.a.cookie, expectedStatus: 201, body: { title: "Where should we live?", category: "moving", sharedContext: "We need a decision this month." } });
  const aPerspective = await request(`/api/issues/${issue.issue.id}/perspectives`, { method: "POST", cookie: pair.a.cookie, expectedStatus: 201, body: { goal: "Stay near work", importance: "Short commute", negotiables: "Try for six months", shareableText: "I value a shorter commute.", privateNotes: "PRIVATE_ONLY_SECRET_TOKEN_A" } });
  await request(`/api/issues/${issue.issue.id}/shareable-summary`, { method: "POST", cookie: pair.a.cookie, body: { text: aPerspective.summary.text } });
  const bPerspective = await request(`/api/issues/${issue.issue.id}/perspectives`, { method: "POST", cookie: pair.b.cookie, expectedStatus: 201, body: { goal: "Stay near family", importance: "Support network", negotiables: "Consider nearby areas", shareableText: "I value nearby family support.", privateNotes: "PRIVATE_ONLY_SECRET_TOKEN_B" } });
  await request(`/api/issues/${issue.issue.id}/shareable-summary`, { method: "POST", cookie: pair.b.cookie, body: { text: bPerspective.summary.text } });
  const viewA = await request(`/api/issues/${issue.issue.id}`, { cookie: pair.a.cookie });
  const viewB = await request(`/api/issues/${issue.issue.id}`, { cookie: pair.b.cookie });
  assert.deepEqual(viewA.perspectives.map((item) => item.ownerUserId), [pair.a.user.id]);
  assert.deepEqual(viewB.perspectives.map((item) => item.ownerUserId), [pair.b.user.id]);
  await request(`/api/issues/${issue.issue.id}`, { cookie: outsider.a.cookie, expectedStatus: 404 });
  const generated = await request(`/api/issues/${issue.issue.id}/generate-options`, { method: "POST", cookie: pair.a.cookie, expectedStatus: 201, body: { language: "en" } });
  assert.equal(generated.proposals.length, 3);
  assert.equal(JSON.stringify(lastDecisionContext).includes("PRIVATE_ONLY_SECRET_TOKEN"), false);
  assert.equal(lastDecisionContext.confirmedSummaries.length, 2);
});

test("private Agent keeps even a decision topic hidden until its owner explicitly shares it", async () => {
  const pair = await createPair("PrivateThinkerA", "PrivateThinkerB");
  const created = await request("/api/private-agent/threads", { method: "POST", cookie: pair.a.cookie, expectedStatus: 201, body: { intentType: "decision" } });
  const thought = await request(`/api/private-agent/threads/${created.thread.id}/messages`, { method: "POST", cookie: pair.a.cookie, body: { language: "en", text: "SECRET_TOPIC: I may want to move closer to work." } });
  assert.equal(thought.thread.ownerUserId, pair.a.user.id);
  const realtime = await fetch(`${baseUrl}/api/private-agent/threads/${created.thread.id}/realtime`, { method: "POST", headers: { cookie: pair.a.cookie, "content-type": "application/sdp" }, body: "v=0\r\no=private-offer" });
  assert.equal(realtime.status, 200);
  assert.match(await realtime.text(), /test-answer/);
  const voiceThought = await request(`/api/private-agent/threads/${created.thread.id}/transcripts`, { method: "POST", cookie: pair.a.cookie, body: { itemId: "private-voice-1", text: "A private voice thought." } });
  assert.equal(voiceThought.thread.messages.some((item) => item.itemId === "private-voice-1"), true);
  const beforeA = await request("/api/relationship/home", { cookie: pair.a.cookie });
  const beforeB = await request("/api/relationship/home", { cookie: pair.b.cookie });
  assert.equal(beforeA.graph.privateAgentThreads.length, 1);
  assert.equal(beforeB.graph.privateAgentThreads.length, 0);
  assert.equal(beforeB.graph.issues.length, 0);
  assert.equal(JSON.stringify(beforeB).includes("SECRET_TOPIC"), false);
  await request(`/api/private-agent/threads/${created.thread.id}`, { cookie: pair.b.cookie, expectedStatus: 404 });

  await request(`/api/private-agent/threads/${created.thread.id}/share-decision`, { method: "POST", cookie: pair.a.cookie, expectedStatus: 409, body: {} });
  const preview = await request(`/api/private-agent/threads/${created.thread.id}/share-preview`, { method: "POST", cookie: pair.a.cookie, body: {} });
  const confirmedShare = { ...preview.preview, digest: preview.digest, confirm: true };
  const shared = await request(`/api/private-agent/threads/${created.thread.id}/share-decision`, { method: "POST", cookie: pair.a.cookie, expectedStatus: 201, body: confirmedShare });
  const continued = await request(`/api/private-agent/threads/${created.thread.id}/messages`, { method: "POST", cookie: pair.a.cookie, body: { language: "en", text: "One more private refinement after sharing." } });
  assert.equal(continued.thread.status, "shared");
  await request(`/api/private-agent/threads/${created.thread.id}/share-decision`, { method: "POST", cookie: pair.a.cookie, body: confirmedShare });
  const afterB = await request("/api/relationship/home", { cookie: pair.b.cookie });
  assert.equal(afterB.graph.issues.some((item) => item.id === shared.issue.id), true);
  assert.equal(afterB.graph.issues.length, 1);
  assert.equal(afterB.graph.privateAgentThreads.length, 0);
  assert.equal(afterB.graph.summaries.length, 1);
  assert.equal(JSON.stringify(afterB).includes("SECRET_TOPIC"), true);

  const partnerThread = await request("/api/private-agent/threads", { method: "POST", cookie: pair.b.cookie, expectedStatus: 201, body: { intentType: "decision", issueId: shared.issue.id } });
  await request(`/api/private-agent/threads/${partnerThread.thread.id}/messages`, { method: "POST", cookie: pair.b.cookie, body: { language: "en", text: "B_PRIVATE_THOUGHT: I need family nearby." } });
  const afterA = await request("/api/relationship/home", { cookie: pair.a.cookie });
  assert.equal(JSON.stringify(afterA).includes("B_PRIVATE_THOUGHT"), false);
});

test("agreement approval, commitment completion, and outcome review require both principals", async () => {
  const pair = await createPair("OutcomeA", "OutcomeB");
  const outsider = await createPair("OtherOutcomeA", "OtherOutcomeB");
  const issue = await request("/api/issues", { method: "POST", cookie: pair.a.cookie, expectedStatus: 201, body: { title: "Weekly time", category: "time" } });
  for (const member of [pair.a, pair.b]) {
    const perspective = await request(`/api/issues/${issue.issue.id}/perspectives`, { method: "POST", cookie: member.cookie, expectedStatus: 201, body: { goal: `${member.user.name} goal`, shareableText: `${member.user.name} can share this.` } });
    await request(`/api/issues/${issue.issue.id}/shareable-summary`, { method: "POST", cookie: member.cookie, body: { text: perspective.summary.text } });
  }
  const options = await request(`/api/issues/${issue.issue.id}/generate-options`, { method: "POST", cookie: pair.a.cookie, expectedStatus: 201 });
  await request(`/api/proposals/${options.proposals[2].id}/evaluations`, { method: "POST", cookie: pair.a.cookie, expectedStatus: 201, body: { value: "accept" } });
  await request("/api/agreements", { method: "POST", cookie: pair.a.cookie, expectedStatus: 409, body: { sourceIssueId: issue.issue.id, proposalId: options.proposals[2].id } });
  await request(`/api/proposals/${options.proposals[2].id}/evaluations`, { method: "POST", cookie: pair.b.cookie, expectedStatus: 201, body: { value: "accept_with_conditions", conditions: "Saturday morning" } });
  const agreement = await request("/api/agreements", { method: "POST", cookie: pair.a.cookie, expectedStatus: 201, body: { sourceIssueId: issue.issue.id, proposalId: options.proposals[2].id, title: "Two hours together", terms: ["Friday evening"], reviewAt: new Date(Date.now() + 86400000).toISOString() } });
  const firstApproval = await request(`/api/agreements/${agreement.agreement.id}/approve`, { method: "POST", cookie: pair.a.cookie, body: { version: agreement.agreement.version } });
  assert.equal(firstApproval.agreement.status, "awaiting_approvals");
  const changed = await request(`/api/agreements/${agreement.agreement.id}`, { method: "PATCH", cookie: pair.b.cookie, body: { version: agreement.agreement.version, title: agreement.agreement.title, summary: agreement.agreement.summary, terms: ["Saturday morning"], confirmed: true } });
  assert.equal(changed.agreement.version, 2);
  await request(`/api/agreements/${agreement.agreement.id}/approve`, { method: "POST", cookie: pair.a.cookie, expectedStatus: 409, body: { version: agreement.agreement.version } });
  const afterB = await request(`/api/agreements/${agreement.agreement.id}/approve`, { method: "POST", cookie: pair.b.cookie, body: { version: changed.agreement.version } });
  assert.equal(afterB.approvedCount, 1);
  assert.equal(afterB.agreement.status, "awaiting_approvals");
  const active = await request(`/api/agreements/${agreement.agreement.id}/approve`, { method: "POST", cookie: pair.a.cookie, body: { version: changed.agreement.version } });
  assert.equal(active.agreement.status, "active");
  await request("/api/commitments", { method: "POST", cookie: outsider.a.cookie, body: { agreementId: agreement.agreement.id, description: "cross relationship" }, expectedStatus: 409 });
  const commitment = await request("/api/commitments", { method: "POST", cookie: pair.a.cookie, expectedStatus: 201, body: { agreementId: agreement.agreement.id, agreementVersion: active.agreement.version, confirmed: true, ownerType: "both", description: "Protect Saturday morning", dueAt: new Date(Date.now() - 3600000).toISOString(), reviewAt: new Date(Date.now() - 1000).toISOString(), reviewRequired: true } });
  assert.equal(commitment.commitment.status, "awaiting_confirmations");
  await request(`/api/commitments/${commitment.commitment.id}/complete`, { method: "POST", cookie: pair.a.cookie, expectedStatus: 409, body: { version: commitment.commitment.version, completionEvidence: "A completed" } });
  const confirmedCommitment = await request(`/api/commitments/${commitment.commitment.id}/confirm`, { method: "POST", cookie: pair.b.cookie, body: { version: commitment.commitment.version } });
  assert.equal(confirmedCommitment.commitment.status, "active");
  const oneDone = await request(`/api/commitments/${commitment.commitment.id}/complete`, { method: "POST", cookie: pair.a.cookie, body: { version: confirmedCommitment.commitment.version, completionEvidence: "A completed" } });
  assert.equal(oneDone.commitment.status, "active");
  const bothDone = await request(`/api/commitments/${commitment.commitment.id}/complete`, { method: "POST", cookie: pair.b.cookie, body: { version: oneDone.commitment.version, completionEvidence: "B completed" } });
  assert.equal(bothDone.commitment.status, "completed");
  const outcomeId = bothDone.outcome.id;
  await request(`/api/outcome-reviews/${outcomeId}/responses`, { method: "POST", cookie: pair.a.cookie, expectedStatus: 201, body: { actionCompleted: true, improvement: "improved", effective: "Planning early helped", stillAccept: true, renegotiate: false, shareResponse: true, allowLearnedPattern: true, learnedPatternCandidate: "Choosing the time in advance helped in this situation." } });
  await request(`/api/outcome-reviews/${outcomeId}/finalize`, { method: "POST", cookie: pair.a.cookie, expectedStatus: 409 });
  await request(`/api/outcome-reviews/${outcomeId}/responses`, { method: "POST", cookie: pair.b.cookie, expectedStatus: 201, body: { actionCompleted: true, improvement: "improved", effective: "Planning early helped", stillAccept: true, renegotiate: false, shareResponse: true, allowLearnedPattern: true, learnedPatternCandidate: "Choosing the time in advance helped in this situation." } });
  const finalized = await request(`/api/outcome-reviews/${outcomeId}/finalize`, { method: "POST", cookie: pair.b.cookie, body: {} });
  assert.equal(finalized.outcome.status, "completed");
  assert.equal(finalized.outcome.learnedPattern, "Choosing the time in advance helped in this situation.");
});

test("quick demo rooms require two recording consents and isolate guest capabilities", async () => {
  const createdResponse = await rawRequest("/api/demo/rooms", { method: "POST", body: { mode: "remote", language: "zh", nameA: "红方" } });
  assert.equal(createdResponse.status, 201, JSON.stringify(createdResponse.payload));
  assert.match(createdResponse.headers.get("set-cookie") || "", /toward_us_demo=.*HttpOnly.*SameSite=Lax/);
  assert.equal(createdResponse.headers.get("permissions-policy"), "microphone=(self), camera=()");
  const hostCookie = (createdResponse.headers.get("set-cookie") || "").split(";")[0];
  const code = createdResponse.payload.room.code;
  assert.ok(new Date(createdResponse.payload.room.joinExpiresAt).getTime() - new Date(createdResponse.payload.room.createdAt).getTime() >= 14.9 * 60 * 1000);

  const preview = await request(`/api/demo/rooms/${code}/preview`);
  assert.equal(preview.room.joinOpen, true);
  assert.equal(Object.hasOwn(preview.room, "messages"), false);
  await request(`/api/demo/rooms/${code}`, { expectedStatus: 404 });

  const joinedResponse = await rawRequest(`/api/demo/rooms/${code}/join`, { method: "POST", body: { name: "蓝方" } });
  assert.equal(joinedResponse.status, 200, JSON.stringify(joinedResponse.payload));
  const partnerCookie = (joinedResponse.headers.get("set-cookie") || "").split(";")[0];
  const hostId = createdResponse.payload.room.currentParticipantId;
  const partnerId = joinedResponse.payload.room.currentParticipantId;

  await request(`/api/demo/rooms/${code}/messages`, { method: "POST", cookie: hostCookie, body: { text: "还没同意。" }, expectedStatus: 409 });
  await request(`/api/demo/rooms/${code}/consent`, { method: "POST", cookie: hostCookie, body: { participantId: partnerId }, expectedStatus: 403 });
  await request(`/api/demo/rooms/${code}/consent`, { method: "POST", cookie: hostCookie, body: { participantId: hostId } });
  const bothConsented = await request(`/api/demo/rooms/${code}/consent`, { method: "POST", cookie: partnerCookie, body: { participantId: partnerId } });
  assert.equal(bothConsented.room.allConsented, true);

  await request(`/api/demo/rooms/${code}/messages`, { method: "POST", cookie: hostCookie, body: { text: "我希望先说清楚事实。" }, expectedStatus: 201 });
  await request(`/api/demo/rooms/${code}/messages`, { method: "POST", cookie: partnerCookie, body: { text: "我希望先被听完。" }, expectedStatus: 201 });
  const analyzed = await request(`/api/demo/rooms/${code}/analyze`, { method: "POST", cookie: hostCookie });
  assert.equal(analyzed.room.sharedAnalysis.title, "A shared view");
  assert.deepEqual(Object.keys(analyzed.room.privateFeedback), [hostId]);

  const otherDemo = await rawRequest("/api/demo/rooms", { method: "POST", body: { mode: "remote", language: "zh", nameA: "旁观者" } });
  const otherCookie = (otherDemo.headers.get("set-cookie") || "").split(";")[0];
  await request(`/api/demo/rooms/${code}`, { cookie: otherCookie, expectedStatus: 404 });
});

test("one-device demo preserves Spanish while the host attributes both perspectives", async () => {
  const createdResponse = await rawRequest("/api/demo/rooms", { method: "POST", body: { mode: "shared", language: "es", nameA: "Rojo", nameB: "Azul" } });
  assert.equal(createdResponse.status, 201, JSON.stringify(createdResponse.payload));
  const cookie = (createdResponse.headers.get("set-cookie") || "").split(";")[0];
  const room = createdResponse.payload.room;
  assert.equal(room.language, "es");
  assert.match(room.safety.message, /mediación/i);
  assert.equal(room.participants.length, 2);
  assert.equal(room.canControlAllSpeakers, true);
  await request(`/api/demo/rooms/${room.code}/consent`, { method: "POST", cookie, body: { participantId: room.participants[0].id } });
  await request(`/api/demo/rooms/${room.code}/consent`, { method: "POST", cookie, body: { participantId: room.participants[1].id } });
  await request(`/api/demo/rooms/${room.code}/messages`, { method: "POST", cookie, body: { speakerId: room.participants[0].id, text: "这是我的看法。" }, expectedStatus: 201 });
  const secondView = await request(`/api/demo/rooms/${room.code}/messages`, { method: "POST", cookie, body: { speakerId: room.participants[1].id, text: "这是对方的看法。" }, expectedStatus: 201 });
  assert.equal(secondView.room.messages[1].participantId, room.participants[1].id);
});

test("one-device demo voice obeys the manually selected speaker", async () => {
  const createdResponse = await rawRequest("/api/demo/rooms", { method: "POST", body: { mode: "shared", language: "zh", nameA: "红方", nameB: "蓝方" } });
  const cookie = (createdResponse.headers.get("set-cookie") || "").split(";")[0];
  const room = createdResponse.payload.room;
  await request(`/api/demo/rooms/${room.code}/consent`, { method: "POST", cookie, body: { participantId: room.participants[0].id } });
  await request(`/api/demo/rooms/${room.code}/consent`, { method: "POST", cookie, body: { participantId: room.participants[1].id } });

  const response = await fetch(`${baseUrl}/api/demo/rooms/${room.code}/audio`, {
    method: "POST",
    headers: {
      cookie,
      origin: baseUrl,
      "content-type": "audio/webm",
      "x-toward-us-speaker-id": room.participants[1].id,
    },
    body: Buffer.alloc(128, 1),
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.room.messages.at(-1).participantId, room.participants[1].id);
});

test("one-device demo supports realtime turns and shared AI follow-up without an account", async () => {
  const createdResponse = await rawRequest("/api/demo/rooms", { method: "POST", headers: { "x-forwarded-for": "203.0.113.44" }, body: { mode: "shared", language: "zh", nameA: "小红", nameB: "小蓝" } });
  const cookie = (createdResponse.headers.get("set-cookie") || "").split(";")[0];
  const room = createdResponse.payload.room;
  for (const participant of room.participants) await request(`/api/demo/rooms/${room.code}/consent`, { method: "POST", cookie, body: { participantId: participant.id } });

  const session = await fetch(`${baseUrl}/api/demo/rooms/${room.code}/realtime`, { method: "POST", headers: { cookie, origin: baseUrl, "content-type": "application/sdp" }, body: "v=0\r\no=demo-offer" });
  assert.equal(session.status, 200, await session.text());

  await request(`/api/demo/rooms/${room.code}/transcripts`, { method: "POST", cookie, expectedStatus: 201, body: { itemId: "demo-1", speakerId: room.participants[0].id, text: "我需要先安静一下。" } });
  await request(`/api/demo/rooms/${room.code}/transcripts`, { method: "POST", cookie, expectedStatus: 201, body: { itemId: "demo-2", speakerId: room.participants[1].id, text: "我想知道什么时候再聊。" } });
  await request(`/api/demo/rooms/${room.code}/analyze`, { method: "POST", cookie });
  const asked = await request(`/api/demo/rooms/${room.code}/ask-ai`, { method: "POST", cookie, body: { question: "现在我们先做什么？" }, expectedStatus: 201 });
  assert.deepEqual(asked.room.aiConversation.map((entry) => entry.role), ["user", "assistant"]);
});

test("both demo participants can create accounts and jointly preserve the result", async () => {
  const createdResponse = await rawRequest("/api/demo/rooms", { method: "POST", body: { mode: "remote", language: "en", nameA: "Demo A" } });
  const hostCookie = (createdResponse.headers.get("set-cookie") || "").split(";")[0];
  const code = createdResponse.payload.room.code;
  const hostId = createdResponse.payload.room.currentParticipantId;
  const joinedResponse = await rawRequest(`/api/demo/rooms/${code}/join`, { method: "POST", body: { name: "Demo B" } });
  const partnerCookie = (joinedResponse.headers.get("set-cookie") || "").split(";")[0];
  const partnerId = joinedResponse.payload.room.currentParticipantId;
  await request(`/api/demo/rooms/${code}/consent`, { method: "POST", cookie: hostCookie, body: { participantId: hostId } });
  await request(`/api/demo/rooms/${code}/consent`, { method: "POST", cookie: partnerCookie, body: { participantId: partnerId } });
  await request(`/api/demo/rooms/${code}/messages`, { method: "POST", cookie: hostCookie, body: { text: "I need clarity." }, expectedStatus: 201 });
  await request(`/api/demo/rooms/${code}/messages`, { method: "POST", cookie: partnerCookie, body: { text: "I need time." }, expectedStatus: 201 });
  await request(`/api/demo/rooms/${code}/analyze`, { method: "POST", cookie: hostCookie });

  const accountA = await register("DemoSaveA");
  const accountB = await register("DemoSaveB");
  const firstClaim = await request(`/api/demo/rooms/${code}/claim`, { method: "POST", cookie: `${hostCookie}; ${accountA.cookie}` });
  assert.equal(firstClaim.saved, false);
  assert.equal(firstClaim.room.claimCount, 1);
  const secondClaim = await request(`/api/demo/rooms/${code}/claim`, { method: "POST", cookie: `${partnerCookie}; ${accountB.cookie}` });
  assert.equal(secondClaim.saved, true);
  assert.equal(secondClaim.room.status, "converted");

  const accountStateA = await request("/api/auth/me", { cookie: accountA.cookie });
  const accountStateB = await request("/api/auth/me", { cookie: accountB.cookie });
  assert.equal(accountStateA.pairing.status, "active");
  assert.equal(accountStateB.pairing.status, "active");
  const historyA = await request("/api/history", { cookie: accountA.cookie });
  assert.equal(historyA.items[0].code, secondClaim.historyCode);
  assert.equal(historyA.items[0].title, "A shared view");
});

const fakeMediator = {
  aiReady: true,
  model: "test-mediator",
  async analyze(room) {
    const [a, b] = room.participants;
    return {
      id: `analysis-${room.code}`,
      generatedAt: new Date().toISOString(),
      source: "test",
      model: "test-mediator",
      notice: "test only",
      shared: {
        title: "A shared view",
        overview: "Both perspectives are represented.",
        category: "communication",
        perspectives: [{ participantId: a.id, name: a.name, view: "A view" }, { participantId: b.id, name: b.name, view: "B view" }],
        responsibility: [], commonGround: ["repair"], differences: ["timing"], nextSteps: ["pause"],
      },
      private: {
        [a.id]: { validation: "A private", reflection: "A reflect", suggestion: "A next" },
        [b.id]: { validation: "B private", reflection: "B reflect", suggestion: "B next" },
      },
      safety: { level: 0, message: "safe" },
    };
  },
  async transcribe() { return { text: "这段录音属于当前选择的人。", duration: 1, segments: [{ speaker: "speaker_0", text: "这段录音属于当前选择的人。", start: 0, end: 1 }] }; },
  async createRealtimeSession({ sdp, language }) {
    assert.match(sdp, /offer/);
    assert.ok(["zh", "en"].includes(language));
    return "v=0\r\no=test-answer";
  },
  async answer(_room, question) {
    return `针对“${question}”，先约定一个时间，再轮流说。`;
  },
  async continuePrivateAgentThread({ intentType, messages, draft }) {
    const text = [...messages].reverse().find((item) => item.role === "user")?.text || "";
    return { source: "test-private-agent", reply: "I organized this privately.", readyToShare: true, draft: { title: draft.title || text.slice(0, 80), category: "custom", goal: draft.goal || text, importance: "", constraints: "", negotiables: "", concerns: "", shareableSummary: draft.shareableSummary || text, date: "", recurringRule: intentType === "plan" ? "once" : "once" } };
  },
  async summarizePerspective(perspective) {
    return { text: perspective.shareableText || perspective.goal, source: "test-private-agent" };
  },
  async generateDecisionOptions(context) {
    lastDecisionContext = structuredClone(context);
    return { source: "test-joint-agent", options: [
      { title: "Closer to A", rationale: "A", tradeoffs: [], conditions: [], risks: [], disputedFacts: [] },
      { title: "Closer to B", rationale: "B", tradeoffs: [], conditions: [], risks: [], disputedFacts: [] },
      { title: "Minimax", rationale: "Both", tradeoffs: [], conditions: [], risks: [], disputedFacts: [] },
    ] };
  },
};

async function createPair(firstName, secondName) {
  const a = await register(firstName);
  const b = await register(secondName);
  const invitation = await request("/api/partner/invitations", { method: "POST", cookie: a.cookie, expectedStatus: 201 });
  await request("/api/partner/accept", { method: "POST", cookie: b.cookie, body: { code: invitation.pairing.invitation.code } });
  return { a, b };
}

async function register(name) {
  counter += 1;
  const response = await rawRequest("/api/auth/register", { method: "POST", body: { name, email: `${name.toLowerCase()}-${counter}@example.com`, password: "correct-horse-battery" } });
  assert.equal(response.status, 201, JSON.stringify(response.payload));
  const setCookie = response.headers.get("set-cookie") || "";
  return { user: response.payload.user, cookie: setCookie.split(";")[0], setCookie };
}

async function rawRequest(path, { method = "GET", cookie, body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json();
  return { status: response.status, payload, headers: response.headers };
}

async function request(path, { method = "GET", cookie, body, expectedStatus = 200, parseJson = true } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status !== expectedStatus) {
    const errorBody = await response.text();
    assert.equal(response.status, expectedStatus, `${path}: ${errorBody}`);
  }
  if (!parseJson || response.status === 204) return null;
  return response.json();
}
