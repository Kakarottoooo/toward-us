import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createFileStore } from "../server/store.mjs";
import { createReminderService } from "../server/reminder-service.mjs";
import { createAssistantRouter } from "../server/assistant-router.mjs";
import { createTogetherRouter } from "../server/together-router.mjs";
import { createSpaceRouter } from "../server/space-router.mjs";
import { balanceFor, createLedgerRouter, ledgerContext } from "../server/ledger.mjs";

const fields = (patch = {}) => ({ title: null, text: null, localDateTime: null, timezone: null, frequency: null, date: null, mood: null, layout: null, spaceId: null, done: null, photoId: null, amount: null, currency: null, paidBy: null, split: null, ...patch });
const usAction = (patch) => ({ kind: "expense", operation: "create", targetId: null, spaceId: null, title: null, text: null, date: null, layout: null, done: null, recurringRule: null, remindDaysBefore: null, photoId: null, localDateTime: null, idea: null, amount: null, currency: null, paidBy: null, split: null, ...patch });

test("balance: half of what one paid, all of what was for the other, nothing once settled", () => {
  const entry = (amount, paidByUserId, split = "half", settledAt = null) => ({ expense: { amount, currency: "CNY", split, paidByUserId, settledAt } });
  assert.deepEqual(balanceFor([entry(320, "a"), entry(100, "b"), entry(60, "b", "for_other"), entry(999, "a", "half", "2026-01-01")], "a"), [{ currency: "CNY", amount: 50 }]);
  assert.deepEqual(balanceFor([entry(100, "a"), entry(100, "b")], "a"), [], "even means nothing owed");
});

test("共同记账: in Us it is kept at once, from Just me only after confirming, and settling up starts afresh", async (t) => {
  const base = resolve("work"); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "ledger-"));
  const store = await createFileStore(join(directory, "store.json"));
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  for (const [index, id] of ids.entries()) await store.createUser({ id, email: `${id}@example.invalid`, name: ["Ziwei", "Mia", "Stranger"][index], passwordHash: "test", createdAt: new Date().toISOString() });
  const relationshipId = randomUUID();
  await store.createInvitation({ relationship: { id: relationshipId, status: "pending" }, membership: { relationshipId, userId: ids[0], role: "A" }, invitation: { code: relationshipId, relationshipId, createdByUserId: ids[0], expiresAt: "2099-01-01T00:00:00.000Z" } });
  await store.acceptInvitation(relationshipId, ids[1], new Date().toISOString());
  let usTurn = { reply: "记下了。", draftAgreement: null, actions: [] }, privateTurn = { reply: "好的", actions: [] };
  const mediator = { planAssistantTurn: async () => privateTurn, continueTogether: async (context) => { mediator.seen = context; return usTurn; } };
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.headers["x-user"]) req.auth = { user: { id: req.headers["x-user"] } }; next(); });
  app.use("/api", createAssistantRouter({ store, mediator, reminderService: createReminderService({ store }) }));
  app.use("/api", createTogetherRouter({ store, mediator }));
  app.use("/api", createSpaceRouter({ store }));
  app.use("/api", createLedgerRouter({ store }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, method = "GET", body, userId = ids[0]) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { "x-user": userId, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  assert.equal((await ledgerContext(store, ids[0])).exists, false, "no ledger until it is needed");
  // Opened from the drawer before any expense: made then, and the same one every time and for both.
  const opened = (await request("/ledger", "POST", { language: "zh" })).body.id;
  assert.equal((await request("/ledger", "POST", { language: "zh" }, ids[1])).body.id, opened);
  assert.equal((await request("/ledger", "POST", {}, ids[2])).status, 409, "not without a partner");

  // Us: Mia says she paid for dinner; Pinky keeps it at once, in a ledger made on first use.
  usTurn = { reply: "记下了。", draftAgreement: null, actions: [usAction({ title: "晚饭", amount: 320, currency: "CNY", paidBy: "writer", split: "half" })] };
  const said = await request("/together/messages", "POST", { text: "Pinky 晚饭我付了 320，记一下", itemId: randomUUID(), language: "zh" }, ids[1]);
  assert.equal(said.status, 201, JSON.stringify(said.body));
  const reply = said.body.conversation.messages.at(-1);
  const ledgerRef = reply.refs.find((ref) => ref.system === "ledger");
  assert.equal(ledgerRef.id, opened, "expenses go into the ledger opened from the drawer");
  assert.ok(ledgerRef, "the reply links to the ledger");
  let view = (await request(`/ledger/${ledgerRef.id}`)).body.ledger;
  assert.equal(view.title, "我们的账本");
  assert.deepEqual(view.entries.map((entry) => [entry.title, entry.amount, entry.paidBy, entry.split]), [["晚饭", 320, "partner", "half"]]);
  assert.deepEqual(view.balance, [{ currency: "CNY", amount: -160 }], "Ziwei owes Mia half");
  assert.equal((await request(`/ledger/${ledgerRef.id}`, "GET", null, ids[2])).status, 404, "nobody else can read it");

  // Just me: Ziwei mentions the groceries privately; nothing is recorded until he confirms the exact card.
  privateTurn = { reply: "好，确认后记进账本。", actions: [{ kind: "expense", operation: "create", targetId: null, expectedVersion: null, fields: fields({ title: "超市", amount: 80, paidBy: "me" }), query: null, queryPeriod: "all", occurrence: null }] };
  const session = (await request("/assistant/sessions", "POST", { language: "zh", timezone: "UTC" })).body.session;
  const turn = await request(`/assistant/sessions/${session.id}/messages`, "POST", { text: "今天超市我花了 80，记到账本", itemId: randomUUID() });
  assert.equal(turn.status, 200, JSON.stringify(turn.body));
  const card = turn.body.session.messages.at(-1).cards.find((item) => item.kind === "space_share");
  assert.match(card.text, /^超市 · ¥80(\.00)? · 你付的 · 各一半/);
  assert.equal((await request(`/ledger/${ledgerRef.id}`)).body.ledger.entries.length, 1, "not recorded before confirming");
  assert.equal((await request(`/assistant/sessions/${session.id}/space-confirm`, "POST", { cardId: card.id, digest: "0".repeat(64) })).status, 409);
  assert.equal((await request(`/assistant/sessions/${session.id}/space-confirm`, "POST", { cardId: card.id, digest: card.digest })).status, 200);
  view = (await request(`/ledger/${ledgerRef.id}`, "GET", null, ids[1])).body.ledger;
  assert.deepEqual(view.entries.map((entry) => [entry.title, entry.amount, entry.currency, entry.paidBy]), [["超市", 80, "CNY", "partner"], ["晚饭", 320, "CNY", "me"]], "Mia sees it from her side, in the ledger's currency");
  assert.deepEqual(view.balance, [{ currency: "CNY", amount: 120 }], "Ziwei now owes Mia 160 - 40");
  const known = await ledgerContext(store, ids[0]);
  assert.deepEqual(known.balance, [{ currency: "CNY", amount: 120, owes: "Ziwei", to: "Mia" }]);
  assert.equal(known.spentByMonth.at(-1).total, 400);
  assert.deepEqual((await ledgerContext(store, ids[0], { speakingTo: true })).balance[0].owes, "you", "in his own chat Ziwei is \"you\"");

  // Us sees the ledger too, and settling up there clears the balance for both.
  usTurn = { reply: "结清啦。", draftAgreement: null, actions: [usAction({ kind: "settle_up" })] };
  await request("/together/messages", "POST", { text: "Pinky 我刚把 120 转给 Mia 了，结清", itemId: randomUUID(), language: "zh" });
  assert.deepEqual(mediator.seen.ledger.balance, [{ currency: "CNY", amount: 120, owes: "Ziwei", to: "Mia" }], "the shared Pinky knew the balance");
  view = (await request(`/ledger/${ledgerRef.id}`, "GET", null, ids[1])).body.ledger;
  assert.deepEqual(view.balance, []);
  assert.deepEqual(view.entries[0].settledBalance, [{ currency: "CNY", amount: 120, owedTo: "me" }]);
  assert.ok(view.entries.slice(1).every((entry) => entry.settled));
  // Settling again with nothing open changes nothing; the page's button settles too.
  const again = await request(`/ledger/${ledgerRef.id}/settle`, "POST", { language: "zh" }, ids[1]);
  assert.equal(again.body.settled, 0);
});
