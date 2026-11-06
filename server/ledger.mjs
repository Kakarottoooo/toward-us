import express from "express";
import { canViewRecord, createRelationshipRecord } from "./relationship-domain.mjs";
import { addSpaceItem } from "./space-domain.mjs";

// 共同记账 (founder 11-06): no page until it is needed. The first time either of them mentions money they spent for the two of
// them ("晚饭我付了 320"), Pinky keeps it in "我们的账本", a shared space created then. Each entry says what, how much, who paid
// and how it is split; the balance says who owes whom, and settling up starts a fresh balance. Said in Us it is recorded at
// once (both see it); said in Just me it waits for the member to confirm the exact card, like anything else that goes shared.
export const LEDGER = "ledger";
export const SPLITS = ["half", "for_other"];
const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const clean = (value, limit) => typeof value === "string" ? value.trim().replace(/\0/g, "").slice(0, limit) : "";
const activePair = (context) => context?.relationship.status === "active" && context.members.length === 2;

/** A valid amount (positive, at most ten million, two decimals) and an upper-case ISO currency code, or null. */
export function cleanExpense({ amount, currency, split }, fallbackCurrency = "CNY") {
  const value = typeof amount === "number" && Number.isFinite(amount) ? Math.round(amount * 100) / 100 : NaN;
  if (!(value > 0 && value <= 10_000_000)) return null;
  const code = typeof currency === "string" && /^[A-Za-z]{3}$/.test(currency.trim()) ? currency.trim().toUpperCase() : fallbackCurrency;
  return { amount: value, currency: code, split: SPLITS.includes(split) ? split : "half" };
}

export const defaultCurrency = (language) => language === "en" ? "USD" : language === "es" ? "EUR" : "CNY";
const isEntry = (item) => item?.expense && typeof item.expense.amount === "number";

/** The couple's ledger, created on first use inside the caller's relationship lock. */
export async function ensureLedger(tx, { userId, relationshipId, language = "zh" }) {
  const existing = (await tx.listRelationshipRecordsForUser("spaces", userId)).find((space) => space.system === LEDGER && space.relationshipId === relationshipId && canViewRecord(space, userId));
  if (existing) return existing;
  const record = createRelationshipRecord({ relationshipId, userId, visibility: "shared", aiAccessScope: "joint", title: say(language, "我们的账本", "Our ledger", "Nuestras cuentas"), layout: "list", description: "", system: LEDGER, provenanceSource: "agent" });
  await tx.createRelationshipRecord("spaces", record);
  return record;
}

/** Records one expense in the ledger. `paidByUserId` must be one of the two. */
export async function addExpense(tx, { userId, relationshipId, members, language, title, date, amount, currency, split, paidByUserId, source = "agent" }) {
  if (!members.some((member) => member.userId === paidByUserId)) throw fail(400, "Who paid?");
  const ledger = await ensureLedger(tx, { userId, relationshipId, language });
  const last = (await entries(tx, userId, ledger.id)).at(-1);
  const expense = cleanExpense({ amount, currency, split }, last?.expense.currency || defaultCurrency(language));
  if (!expense) throw fail(400, say(language, "金额不对，再说一次多少钱？", "That amount doesn't look right. How much was it?", "Ese importe no parece correcto. ¿Cuánto fue?"));
  const item = await addSpaceItem(tx, { userId, space: ledger, title: clean(title, 160) || say(language, "一笔开销", "An expense", "Un gasto"), date, source });
  return tx.updateRelationshipRecordForUser("spaceItems", item.id, userId, (draft) => { draft.expense = { ...expense, paidByUserId, settledAt: null }; });
}

async function entries(db, userId, ledgerId) {
  return (await db.listRelationshipRecordsForUser("spaceItems", userId)).filter((item) => item.spaceId === ledgerId && canViewRecord(item, userId) && isEntry(item)).sort((a, b) => (a.date || a.createdAt.slice(0, 10)).localeCompare(b.date || b.createdAt.slice(0, 10)) || a.createdAt.localeCompare(b.createdAt));
}

/** Who owes whom, per currency, over entries not yet settled: positive means the other member owes `userId`. */
export function balanceFor(items, userId) {
  const totals = {};
  for (const item of items) {
    if (!isEntry(item) || item.expense.settledAt || item.archivedAt) continue;
    const { amount, currency, split, paidByUserId } = item.expense;
    const share = split === "for_other" ? amount : amount / 2;
    totals[currency] = (totals[currency] || 0) + (paidByUserId === userId ? share : -share);
  }
  return Object.entries(totals).map(([currency, value]) => ({ currency, amount: Math.round(value * 100) / 100 })).filter((item) => item.amount !== 0);
}

/** Settles everything open: each open entry is marked settled and one note records what was settled. */
export async function settleUp(tx, { userId, relationshipId, members, language }) {
  const ledger = await ensureLedger(tx, { userId, relationshipId, language });
  const open = (await entries(tx, userId, ledger.id)).filter((item) => !item.expense.settledAt && !item.expense.settle);
  if (!open.length) return { ledger, settled: 0, balance: [] };
  const balance = balanceFor(open, userId), at = new Date().toISOString();
  for (const item of open) await tx.updateRelationshipRecordForUser("spaceItems", item.id, userId, (draft) => { draft.expense = { ...draft.expense, settledAt: at }; draft.version += 1; });
  const partner = members.find((member) => member.userId !== userId);
  const note = await addSpaceItem(tx, { userId, space: ledger, title: say(language, "结清了", "Settled up", "Cuentas saldadas"), date: at.slice(0, 10), source: "agent" });
  await tx.updateRelationshipRecordForUser("spaceItems", note.id, userId, (draft) => { draft.expense = { amount: 0, currency: balance[0]?.currency || defaultCurrency(language), split: "half", paidByUserId: userId, settle: true, settledAt: at, balance: balance.map((item) => ({ ...item, owedToUserId: item.amount > 0 ? userId : partner?.userId })) }; });
  return { ledger, settled: open.length, balance };
}

/** What either Pinky may know about the couple's ledger: recent entries, the open balance and what they spent by month. */
/** `speakingTo` set means the member's own private chat: they are "you", never their name. */
export async function ledgerContext(db, userId, { speakingTo = false } = {}) {
  const context = await db.getRelationshipContext(userId);
  if (!activePair(context)) return null;
  const ledger = (await db.listRelationshipRecordsForUser("spaces", userId)).find((space) => space.system === LEDGER && space.relationshipId === context.relationship.id && canViewRecord(space, userId));
  if (!ledger) return { exists: false };
  const items = await entries(db, userId, ledger.id), name = (id) => speakingTo && id === userId ? "you" : context.members.find((member) => member.userId === id)?.user?.name || "";
  const months = {};
  for (const item of items) if (!item.expense.settle) { const key = `${(item.date || item.createdAt).slice(0, 7)} ${item.expense.currency}`; months[key] = Math.round(((months[key] || 0) + item.expense.amount) * 100) / 100; }
  const partner = context.members.find((member) => member.userId !== userId);
  return {
    exists: true, id: ledger.id,
    balance: balanceFor(items, userId).map(({ currency, amount }) => ({ currency, amount: Math.abs(amount), owes: amount > 0 ? name(partner?.userId) : name(userId), to: amount > 0 ? name(userId) : name(partner?.userId) })),
    spentByMonth: Object.entries(months).slice(-6).map(([key, total]) => ({ month: key.slice(0, 7), currency: key.slice(8), total })),
    recent: items.slice(-15).map((item) => item.expense.settle ? { id: item.id, settledUp: item.date } : { id: item.id, what: item.title, amount: item.expense.amount, currency: item.expense.currency, paidBy: name(item.expense.paidByUserId), split: item.expense.split, date: item.date, settled: Boolean(item.expense.settledAt) }),
  };
}

/** The page's view of the ledger, from this member's side. */
export async function ledgerView(db, userId, ledgerId) {
  const ledger = await db.getRelationshipRecordForUser("spaces", ledgerId, userId);
  if (!ledger || ledger.system !== LEDGER || !canViewRecord(ledger, userId)) throw fail(404, "Not found.");
  const context = await db.getRelationshipContext(userId);
  const items = await entries(db, userId, ledger.id);
  return {
    id: ledger.id, title: ledger.title, partnerName: context?.members.find((member) => member.userId !== userId)?.user?.name || null,
    balance: balanceFor(items, userId),
    entries: items.slice().reverse().map((item) => ({ id: item.id, version: item.version, title: item.title, date: item.date || item.createdAt.slice(0, 10), amount: item.expense.amount, currency: item.expense.currency, split: item.expense.split, paidBy: item.expense.paidByUserId === userId ? "me" : "partner", settled: Boolean(item.expense.settledAt), settle: Boolean(item.expense.settle), settledBalance: item.expense.settle ? (item.expense.balance || []).map(({ currency, amount, owedToUserId }) => ({ currency, amount: Math.abs(amount), owedTo: owedToUserId === userId ? "me" : "partner" })) : undefined })),
  };
}

/** The ledger page: read it, and settle up with one tap (a member's own explicit action). */
export function createLedgerRouter({ store, emit = () => {} }) {
  const router = express.Router();
  router.use("/ledger", (req, res, next) => req.auth ? next() : res.status(401).json({ error: "Please sign in." }));
  // From the drawer: the couple's ledger, made now if they have none yet, so it can be found before the first expense.
  router.post("/ledger", async (req, res) => {
    const userId = req.auth.user.id, context = await store.getRelationshipContext(userId);
    if (!activePair(context)) throw fail(409, "Connect with your partner first.");
    const language = ["en", "es"].includes(req.body?.language) ? req.body.language : "zh";
    const ledger = await store.transaction(`relationship:${context.relationship.id}`, (tx) => ensureLedger(tx, { userId, relationshipId: context.relationship.id, language }));
    res.json({ id: ledger.id });
  });
  router.get("/ledger/:id", async (req, res) => { res.json({ ledger: await ledgerView(store, req.auth.user.id, req.params.id) }); });
  router.post("/ledger/:id/settle", async (req, res) => {
    const userId = req.auth.user.id, context = await store.getRelationshipContext(userId);
    if (!activePair(context)) throw fail(409, "Connect with your partner first.");
    const language = ["en", "es"].includes(req.body?.language) ? req.body.language : "zh";
    const result = await store.transaction(`relationship:${context.relationship.id}`, async (tx) => {
      const current = await tx.getRelationshipContext(userId);
      if (!activePair(current) || current.relationship.id !== context.relationship.id) throw fail(409, "Connect with your partner first.");
      const ledger = await tx.getRelationshipRecordForUser("spaces", req.params.id, userId);
      if (!ledger || ledger.system !== LEDGER || ledger.relationshipId !== current.relationship.id) throw fail(404, "Not found.");
      return settleUp(tx, { userId, relationshipId: current.relationship.id, members: current.members, language });
    });
    emit(result.ledger, "space.updated");
    res.json({ settled: result.settled, ledger: await ledgerView(store, userId, req.params.id) });
  });
  return router;
}

/** "¥320", "$45.50", "45,50 €" in the reader's language. */
export function formatMoney(amount, currency, language = "zh") {
  try { return new Intl.NumberFormat(language === "en" ? "en-US" : language === "es" ? "es-ES" : "zh-CN", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount); }
  catch { return `${amount} ${currency}`; }
}
