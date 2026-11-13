import express from "express";
import { randomBytes } from "node:crypto";
import { createRelationshipRecord } from "./relationship-domain.mjs";
import { weeklyUsage } from "./usage.mjs";
import { aiUsageReport } from "./ai-budget.mjs";
import { membershipFor } from "./membership.mjs";

// 内测 (founder 11-06: find the first real couples). The founder makes invite codes; a couple that redeems one is a Pinky
// member for `days` (90 by default), and the founder sees how each beta couple is doing without any content: counts of
// actions and AI calls, active days, membership, feedback. Founder = an account whose email is in FOUNDER_EMAILS.
const COLLECTION = "betaCodes";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeCode = () => `PINKY-${[...randomBytes(6)].map((byte) => ALPHABET[byte % ALPHABET.length]).join("")}`;
const normal = (value) => String(value || "").trim().toUpperCase().replace(/\s+/g, "");
const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;
const founders = (env) => new Set(String(env.FOUNDER_EMAILS || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
const DAY = 86_400_000;

// Things that got done, not activity: an agreement both approved, a plan put on the calendar, a hard message actually sent,
// a show marked watched, a letter kept, a check-in saved.
const OUTCOMES = new Set(["agreement_approved", "plan_scheduled", "partner_message_shared", "watch_answered", "letter_kept", "checkin_saved"]);

export function createBetaRouter({ store, grant, env = process.env, now = () => new Date() }) {
  const router = express.Router();
  const auth = (req, res, next) => req.auth?.user ? next() : res.status(401).json({ error: say(req.body?.language || req.query?.language, "请先登录。", "Please sign in first.", "Inicia sesión primero.") });
  const isFounder = async (userId) => { const list = founders(env); if (!list.size) return false; const user = await store.getUserById(userId); return Boolean(user?.email && list.has(user.email.toLowerCase())); };
  const founderOnly = async (req, res, next) => (await isFounder(req.auth.user.id)) ? next() : res.status(404).json({ error: "Not found." });
  const attempts = new Map();

  // A couple redeems a code: one code, one couple (the partner of whoever redeemed it may "redeem" it again harmlessly).
  router.post("/membership/redeem", auth, async (req, res) => {
    const userId = req.auth.user.id, language = ["zh", "en", "es"].includes(req.body?.language) ? req.body.language : ["en", "es"].includes(req.auth.user.language) ? req.auth.user.language : "zh", code = normal(req.body?.code);
    const recent = (attempts.get(userId) || []).filter((at) => now().getTime() - at < 3_600_000);
    if (recent.length >= 10) return res.status(429).json({ error: say(language, "试太多次了，过一会儿再试。", "Too many tries; try again later.", "Demasiados intentos; prueba más tarde."), code: "too_many" });
    attempts.set(userId, [...recent, now().getTime()]);
    const found = (await store.listRecordsForJob(COLLECTION)).find((record) => record.code === code && record.status === "active");
    if (!found) return res.status(404).json({ error: say(language, "这个内测码不对，或者已经失效了。", "That beta code isn't valid.", "Ese código de beta no es válido."), code: "bad_code" });
    const pairing = await store.getRelationshipContext(userId);
    const couple = pairing?.relationship?.status === "active" ? pairing.members.map((member) => member.userId) : [userId];
    if (found.usedBy && !couple.includes(found.usedBy)) return res.status(409).json({ error: say(language, "这个内测码已经被别人用过了。", "Someone else already used this code.", "Otra persona ya usó este código."), code: "used" });
    if (!found.usedBy) {
      const claimed = await store.transaction(`beta:${found.id}`, async (tx) => {
        const fresh = (await tx.listRecordsForJob(COLLECTION)).find((record) => record.id === found.id);
        if (fresh.usedBy && !couple.includes(fresh.usedBy)) return false;
        if (!fresh.usedBy) await tx.updateRelationshipRecordForUser(COLLECTION, fresh.id, fresh.ownerUserId, (draft) => { draft.usedBy = userId; draft.usedAt = now().toISOString(); draft.version += 1; });
        return true;
      });
      if (!claimed) return res.status(409).json({ error: say(language, "这个内测码已经被别人用过了。", "Someone else already used this code.", "Otra persona ya usó este código."), code: "used" });
      await grant(userId, `beta:${found.code}`, { kind: "membership", plan: "beta", source: "beta", status: "active", until: new Date(now().getTime() + (found.days || 90) * DAY).toISOString() });
    }
    res.json({ ok: true, plan: (await membershipFor(store, userId, { now: now() })).plan });
  });

  router.get("/founder/beta", auth, founderOnly, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const at = now(), codes = (await store.listRecordsForJob(COLLECTION)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const relationships = (await store.listRelationshipsForJob()).filter((item) => item.status === "active").sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const weeks = await weeklyUsage(store, { weeks: 2, now: at }), ai = await aiUsageReport(store, { days: 7, now: at });
    const feedback = await store.listRecordsForJob("feedback").catch(() => []);
    const weekAgo = new Date(at.getTime() - 7 * DAY).toISOString();
    // Relationships don't list their members; anyone who created a record in one is a candidate, confirmed by their context.
    const candidates = new Map(), add = (relationshipId, userId) => { if (relationshipId && userId) { if (!candidates.has(relationshipId)) candidates.set(relationshipId, new Set()); candidates.get(relationshipId).add(userId); } };
    for (const record of await store.listRecordsForJob("togetherConversations").catch(() => [])) add(record.relationshipId, record.createdByUserId);
    for (const record of await store.listRecordsForJob("productEvents").catch(() => [])) add(record.relationshipId, record.ownerUserId);
    for (const row of ai) for (const person of row.people) add(row.relationshipId, person.userId);
    for (const record of await store.listRecordsForJob("purchases").catch(() => [])) add(record.relationshipId, record.ownerUserId);
    for (const item of codes.filter((code) => code.usedBy)) add((await store.getRelationshipContext(item.usedBy))?.relationship?.id, item.usedBy);
    const membersOf = async (relationshipId) => { for (const id of candidates.get(relationshipId) || []) { const context = await store.getRelationshipContext(id); if (context?.relationship?.id === relationshipId) return context.members.map((member) => member.userId); } return []; };
    const couples = [];
    for (const [index, relationship] of relationships.entries()) {
      const members = await membersOf(relationship.id);
      const code = codes.find((item) => item.usedBy && members.includes(item.usedBy));
      const thisWeek = weeks.filter((row) => row.relationshipId === relationship.id).at(-1);
      const calls = ai.filter((row) => row.relationshipId === relationship.id);
      const activeDays = new Set(calls.map((row) => row.day));
      const plan = members[0] ? await membershipFor(store, members[0], { now: at }) : null;
      couples.push({
        label: `#${index + 1}`, since: relationship.createdAt || null, beta: Boolean(code), code: code?.code || null, note: code?.note || "",
        plan: plan?.plan || "free", source: plan?.source || null, activeMembers: thisWeek?.activeMembers || 0,
        actions: Object.values(thisWeek?.actions || {}).reduce((sum, count) => sum + count, 0),
        // Save time, not kill time (11-07): what Pinky got done for them this week, apart from how much they tapped.
        done: Object.entries(thisWeek?.actions || {}).filter(([name]) => OUTCOMES.has(name)).reduce((sum, [, count]) => sum + count, 0),
        // Pushes that reached them this week and how many opened the App.
        pushes: { sent: thisWeek?.actions?.push_sent || 0, opened: thisWeek?.actions?.push_opened || 0 }, topActions: Object.entries(thisWeek?.actions || {}).sort((a, b) => b[1] - a[1]).slice(0, 5),
        aiCalls: calls.reduce((sum, row) => sum + row.total, 0), aiDays: activeDays.size, lastAiDay: calls[0]?.day || null,
        feedback: feedback.filter((item) => members.includes(item.ownerUserId) && item.createdAt >= weekAgo).length,
      });
    }
    res.json({ codes: codes.map(({ code, days, note, usedBy, usedAt, createdAt, status }) => ({ code, days, note, used: Boolean(usedBy), usedAt, createdAt, status })), couples });
  });

  router.post("/founder/beta/codes", auth, founderOnly, async (req, res) => {
    const count = Math.min(Math.max(Number(req.body?.count) || 1, 1), 20), days = Math.min(Math.max(Number(req.body?.days) || 90, 7), 365), note = String(req.body?.note || "").slice(0, 60);
    const made = [];
    for (let i = 0; i < count; i += 1) made.push(await store.createRelationshipRecord(COLLECTION, createRelationshipRecord({ relationshipId: null, userId: req.auth.user.id, visibility: "private", aiAccessScope: "none", approvalPolicy: "owner", status: "active", provenanceSource: "founder", code: makeCode(), days, note, usedBy: null, usedAt: null })));
    res.status(201).json({ codes: made.map(({ code, days: d, note: n }) => ({ code, days: d, note: n, used: false })) });
  });
  return { router, isFounder };
}
