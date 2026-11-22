import { signInText } from "./request-language.mjs";
import express from "express";
import { createRelationshipRecord } from "./relationship-domain.mjs";

// 经期记录 (founder 11-06): the most private thing in Pinky. Logged by talking in Just me ("姨妈来了", "经期结束了"), kept as
// the member's own private records, and predicted only on their own Coming up. Their partner learns nothing unless they turn
// on "让 TA 知道"; even then the partner gets only "这几天多照顾 TA 一点" while it applies: no dates, no days, no word of why.
// The shared Pinky never sees any of it.
export const CYCLE = "cycle", CYCLE_SETTINGS = "cycle_settings";
const DAY = 86_400_000, DEFAULT_CYCLE = 28, DEFAULT_LENGTH = 5;
const isDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
const between = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);
const plus = (day, days) => new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;
export const isCycleRecord = (record) => record?.kind === CYCLE || record?.kind === CYCLE_SETTINGS;
const mine = async (db, userId) => (await db.listRelationshipRecordsForUser("checkins", userId)).filter((item) => item.ownerUserId === userId && item.visibility === "private" && !item.archivedAt && !item.deletedAt);
const logsOf = (records) => records.filter((item) => item.kind === CYCLE && isDay(item.start)).sort((a, b) => a.start.localeCompare(b.start));

/** From past logs: typical cycle and period length (the last six, within reason), and where today falls. */
export function predict(logs, today) {
  const starts = logs.map((log) => log.start);
  const gaps = starts.slice(1).map((start, index) => between(starts[index], start)).filter((gap) => gap >= 18 && gap <= 45).slice(-6);
  const lengths = logs.filter((log) => isDay(log.end)).map((log) => between(log.start, log.end) + 1).filter((length) => length >= 1 && length <= 12).slice(-6);
  const avg = (values, fallback) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : fallback;
  const cycle = avg(gaps, DEFAULT_CYCLE), length = avg(lengths, DEFAULT_LENGTH);
  const last = logs.at(-1);
  if (!last) return null;
  const lastEnd = last.end || plus(last.start, length - 1);
  const inPeriod = today >= last.start && today <= lastEnd && between(last.start, today) < 12 ? between(last.start, today) + 1 : null;
  let next = plus(last.start, cycle);
  while (next < today && !inPeriod) next = plus(next, cycle); // a missed log: keep predicting forward
  return { cycle, length, lastStart: last.start, inPeriod, nextStart: next, daysUntil: between(today, next), learned: gaps.length };
}

/** Logs a start or an end from the conversation. A start within a week of an open one is the same period; a start inside an
 * ended period (or up to a week before it) is that period too, never merged past its end (QA round 4: a start a few days
 * after a finished period vanished into it). With `strict` (logged by hand), ending a period that already ended is refused
 * with the day it ended, instead of silently moving it; the conversation may still correct it ("其实 5 号就结束了"). */
export async function logPeriod(tx, { userId, relationshipId = null, event, date, strict = false, language }) {
  if (!["start", "end"].includes(event) || !isDay(date)) throw fail(400, "When?");
  const logs = logsOf(await mine(tx, userId));
  if (event === "start") {
    const same = logs.find((log) => log.end ? between(date, log.start) <= 7 && date <= log.end : Math.abs(between(log.start, date)) <= 7);
    if (same) return date < same.start ? tx.updateRelationshipRecordForUser("checkins", same.id, userId, (draft) => { draft.start = date; draft.version += 1; }) : same;
    const record = createRelationshipRecord({ relationshipId: null, userId, visibility: "private", aiAccessScope: "private", kind: CYCLE, start: date, end: null, provenanceSource: "assistant" });
    await tx.createRelationshipRecord("checkins", record);
    return record;
  }
  const open = logs.filter((log) => log.start <= date && between(log.start, date) <= 12).at(-1);
  if (!open) throw fail(409, "No period to end.");
  if (strict && open.end === date) return open;
  if (strict && open.end) throw Object.assign(fail(409, say(language, `这次经期已在 ${open.end} 结束，要改请编辑这条记录。`, `This period already ended on ${open.end}. Edit it instead.`, `Este periodo ya terminó el ${open.end}. Edítalo en su lugar.`)), { code: "cycle_already_ended" });
  return tx.updateRelationshipRecordForUser("checkins", open.id, userId, (draft) => { draft.end = date; draft.version += 1; });
}

/** Days a log covers, for overlap checks: to its end, or a week on while it is still open (the same-period window). */
const reach = (log) => log.end || plus(log.start, 7);
const overlapping = (logs, start, end, exceptId) => logs.find((log) => log.id !== exceptId && log.start <= (end || plus(start, 7)) && start <= reach(log));

const sharing = (records) => records.find((item) => item.kind === CYCLE_SETTINGS)?.shareCare === true;

/** What a member's own Pinky may know, to answer "我下次什么时候来". Never given to the shared Pinky. */
export async function cycleContext(db, userId, today) {
  const records = await mine(db, userId), logs = logsOf(records);
  if (!logs.length) return null;
  const prediction = predict(logs, today);
  return { lastStart: prediction.lastStart, periodDay: prediction.inPeriod, nextStart: prediction.nextStart, daysUntilNext: prediction.daysUntil, typicalCycle: prediction.cycle, typicalLength: prediction.length, partnerToldToCare: sharing(records) };
}

/** Whether the partner should be gently told "这几天多照顾 TA": only with the owner's consent, from a day before a predicted
 * start through the period. Returns the owner's name or null; nothing else leaves. */
export async function careNoteFor(db, viewerId, today) {
  const context = await db.getRelationshipContext(viewerId);
  if (!(context?.relationship.status === "active" && context.members.length === 2)) return null;
  const partner = context.members.find((member) => member.userId !== viewerId);
  const records = await mine(db, partner.userId);
  if (!sharing(records)) return null;
  const prediction = predict(logsOf(records), today);
  if (!prediction) return null;
  const soon = prediction.daysUntil >= 0 && prediction.daysUntil <= 1;
  return prediction.inPeriod || soon ? { name: partner.user?.name || "" } : null;
}

/** The member's own view for Coming up, plus a care note if their partner shares one. */
export function createCycleRouter({ store, emit = () => {} }) {
  const router = express.Router();
  router.use("/cycle", (req, res, next) => req.auth ? next() : res.status(401).json({ error: signInText(req) }));
  const today = (req) => { try { return new Date().toLocaleDateString("en-CA", { timeZone: String(req.query?.timezone || req.body?.timezone || "UTC") }); } catch { return new Date().toISOString().slice(0, 10); } };
  // The last day a log may name (QA round 5): with a real time zone, today there; without one, a day of grace for zones
  // ahead of UTC.
  const latest = (req) => { const zone = String(req.query?.timezone || req.body?.timezone || ""); try { if (zone) { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return today(req); } } catch { /* unknown zone */ } return plus(today(req), 1); };
  // The reader's language: the request's, the saved one, the browser's, else English (never Chinese by default).
  const lang = (req) => [req.body?.language, req.query?.language, req.auth.user.language].find((value) => ["zh", "en", "es"].includes(value)) || String(req.headers?.["accept-language"] || "").toLowerCase().match(/^\s*(zh|en|es)(?![a-z])/)?.[1] || "en";
  const lock = async (userId) => `user:${userId}`;
  router.get("/cycle", async (req, res) => {
    const userId = req.auth.user.id, day = today(req), records = await mine(store, userId), logs = logsOf(records);
    const context = await store.getRelationshipContext(userId), paired = context?.relationship.status === "active" && context.members.length === 2;
    res.json({
      mine: logs.length ? { prediction: predict(logs, day), logs: logs.slice(-12).reverse().map(({ id, version, start, end }) => ({ id, version, start, end })), sharing: sharing(records) } : null,
      partnerName: paired ? context.members.find((member) => member.userId !== userId)?.user?.name || null : null,
      care: await careNoteFor(store, userId, day),
    });
  });
  // "让 TA 知道": the owner's explicit choice, recorded as consent; turning it off stops the note at once.
  router.post("/cycle/sharing", async (req, res) => {
    const userId = req.auth.user.id, on = req.body?.on === true;
    const context = await store.getRelationshipContext(userId);
    await store.transaction(await lock(userId), async (tx) => {
      const settings = (await mine(tx, userId)).find((item) => item.kind === CYCLE_SETTINGS);
      if (settings) await tx.updateRelationshipRecordForUser("checkins", settings.id, userId, (draft) => { draft.shareCare = on; draft.version += 1; });
      else await tx.createRelationshipRecord("checkins", createRelationshipRecord({ relationshipId: null, userId, visibility: "private", aiAccessScope: "none", kind: CYCLE_SETTINGS, shareCare: on }));
      await tx.createRelationshipRecord("consentEvents", createRelationshipRecord({ relationshipId: context?.relationship?.id || null, userId, visibility: "private", aiAccessScope: "none", status: "recorded", objectType: CYCLE, eventType: on ? "cycle.care_shared" : "cycle.care_stopped" }));
    });
    if (context?.relationship) emit({ id: `cycle:${userId}`, relationshipId: context.relationship.id }, "cycle.updated");
    res.json({ sharing: on });
  });
  // Logged by hand on Coming up (QA round 3: it used to work only by telling Ourever, so not at all with AI declined or down).
  // A start or an end on a day, by the same rule as the conversation: a start within a week of an open one is the same period.
  const changed = (context) => { if (context?.relationship) emit({ id: `cycle:${context.userId}`, relationshipId: context.relationship.id }, "cycle.updated"); };
  router.post("/cycle/log", async (req, res) => {
    const userId = req.auth.user.id, event = req.body?.event, date = String(req.body?.date || today(req));
    if (!isDay(date) || date > latest(req)) throw fail(400, say(lang(req), "请选择今天或更早的日期。", "Pick today or an earlier date.", "Elige hoy o una fecha anterior."));
    let record;
    try { record = await store.transaction(await lock(userId), (tx) => logPeriod(tx, { userId, event, date, strict: true, language: lang(req) })); }
    catch (error) { if (error.statusCode === 409 && !error.code) throw fail(409, say(lang(req), "这一天之前 12 天内没有记过开始。", "There is no start logged in the 12 days before that day.", "No hay un inicio registrado en los 12 días anteriores.")); throw error; }
    changed({ ...(await store.getRelationshipContext(userId)), userId });
    res.status(201).json({ log: { id: record.id, version: record.version, start: record.start, end: record.end } });
  });
  // A corrected or restored log: real days, none in the future, and none already in another log (QA round 4: edits and undo
  // could make two logs share days, or a period that hasn't happened yet).
  const checkDays = (req, language, start, end) => {
    if (!isDay(start) || (end && (!isDay(end) || end < start || between(start, end) > 11))) throw fail(400, say(language, "日期不对：结束要在开始之后 12 天内。", "Those dates don't work: the end must be within 12 days after the start.", "Esas fechas no sirven: el final debe estar en los 12 días siguientes al inicio."));
    if ((end || start) > latest(req)) throw fail(400, say(language, "请选择今天或更早的日期。", "Pick today or an earlier date.", "Elige hoy o una fecha anterior."));
  };
  const clash = (language, log) => fail(409, say(language, `这几天已经记在 ${log.start} 开始的那条里了，请改那一条。`, `Those days are already in the log that starts ${log.start}. Edit that one instead.`, `Esos días ya están en el registro que empieza el ${log.start}. Edita ese.`));
  // Corrects one log's start and end (end may be cleared).
  router.patch("/cycle/:id", async (req, res) => {
    const userId = req.auth.user.id, language = lang(req);
    const start = String(req.body?.start || ""), end = req.body?.end ? String(req.body.end) : null;
    checkDays(req, language, start, end);
    const record = await store.transaction(await lock(userId), async (tx) => {
      const current = await tx.getRelationshipRecordForUser("checkins", req.params.id, userId);
      if (!current || current.kind !== CYCLE || current.ownerUserId !== userId) throw fail(404, say(language, "没有找到", "Not found", "No encontrado"));
      const other = overlapping(logsOf(await mine(tx, userId)), start, end, current.id);
      if (other) throw clash(language, other);
      return tx.updateRelationshipRecordForUser("checkins", current.id, userId, (draft) => { draft.start = start; draft.end = end; draft.version += 1; });
    });
    changed({ ...(await store.getRelationshipContext(userId)), userId });
    res.json({ log: { id: record.id, version: record.version, start: record.start, end: record.end } });
  });
  // An undone delete: the same days come back as a new log. Idempotent: if those exact days are already logged (a double tap,
  // or logged again before Undo), that log is the answer; days that overlap a different log are refused, never doubled.
  router.post("/cycle/restore", async (req, res) => {
    const userId = req.auth.user.id, language = lang(req);
    const start = String(req.body?.start || ""), end = req.body?.end ? String(req.body.end) : null;
    checkDays(req, language, start, end);
    const { record, created } = await store.transaction(await lock(userId), async (tx) => {
      const logs = logsOf(await mine(tx, userId));
      const same = logs.find((log) => log.start === start && (log.end || null) === end);
      if (same) return { record: same, created: false };
      const other = overlapping(logs, start, end);
      if (other) throw clash(language, other);
      const fresh = createRelationshipRecord({ relationshipId: null, userId, visibility: "private", aiAccessScope: "private", kind: CYCLE, start, end, provenanceSource: "member" });
      await tx.createRelationshipRecord("checkins", fresh);
      return { record: fresh, created: true };
    });
    if (created) changed({ ...(await store.getRelationshipContext(userId)), userId });
    res.status(created ? 201 : 200).json({ log: { id: record.id, version: record.version, start: record.start, end: record.end } });
  });
  router.delete("/cycle/:id", async (req, res) => {
    const userId = req.auth.user.id;
    await store.transaction(await lock(userId), async (tx) => {
      const record = await tx.getRelationshipRecordForUser("checkins", req.params.id, userId);
      if (!record || record.kind !== CYCLE || record.ownerUserId !== userId) throw fail(404, say(req.query?.language || req.auth.user.language, "没有找到", "Not found", "No encontrado"));
      await tx.deleteRelationshipRecordForUser("checkins", record.id, userId);
    });
    res.status(204).end();
  });
  return router;
}
