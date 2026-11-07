import express from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRelationshipRecord } from "./relationship-domain.mjs";
import { memberTimezone } from "./reminder-service.mjs";
import { coupleStreak, dayIn, validZone } from "./streak.mjs";

// The iPhone home-screen widget's data (monetize batch 11-06). Inside the App, after sign-in, the web side asks for a widget
// token and hands it to the native PinkyWidget plugin; the widget then reads GET /api/widget with it, without a cookie.
// The token is "<userId>.<secret>" (32 random bytes, base64url); only sha256(secret) is kept, on the owner's private
// accountSettings record, one per member (a new one replaces the old; signing out in the App, a password reset or recovery drops it).
// The answer holds only what a lock screen may show: names, counts and the next shared date. Never message text, never
// anything private.
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const between = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
const hash = (value) => createHash("sha256").update(String(value)).digest("hex");

/** A yearly date's next day on or after `today` (29 February falls on the 28th in other years). */
function nextYearly(date, today) {
  for (const year of [Number(today.slice(0, 4)), Number(today.slice(0, 4)) + 1]) {
    const leap = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1;
    const day = `${year}-${date.slice(5) === "02-29" && !leap ? "02-28" : date.slice(5)}`;
    if (day >= today && day >= date) return day;
  }
  return null;
}

/** What the widget shows for `user`, as of `now`. */
export async function widgetData(store, user, now = new Date()) {
  const language = ["zh", "en", "es"].includes(user.language) ? user.language : "zh";
  const data = { v: 1, language, partnerName: null, daysTogether: null, streak: { days: 0, me: false, partner: false }, next: null, updatedAt: now.toISOString() };
  const context = await store.getRelationshipContext(user.id);
  if (!context || context.relationship.status !== "active" || context.members.length !== 2) return data;
  const relationshipId = context.relationship.id;
  data.partnerName = context.members.find((member) => member.userId !== user.id)?.user?.name || null;
  const conversation = await store.getRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, user.id);
  const zone = validZone(conversation?.zones?.[user.id]) || (await memberTimezone(store, user.id).catch(() => null)) || "UTC";
  const today = dayIn(now, zone);
  // The same shared dates Coming up shows: the day they got together, yearly dates, and the next time they meet.
  const dates = (await store.listRelationshipRecordsForUser("milestones", user.id)).filter((item) => item.relationshipId === relationshipId && item.visibility === "shared" && !item.archivedAt && DAY_RE.test(String(item.date || "")));
  const since = dates.find((item) => item.type === "relationship_started")?.date;
  if (since && since <= today) data.daysTogether = between(since, today) + 1;
  const ahead = dates.map((item) => ({ title: String(item.title || "").slice(0, 60), date: item.recurringRule === "yearly" ? nextYearly(item.date, today) : item.type === "meetup" && item.date >= today ? item.date : null })).filter((item) => item.date && item.title).sort((a, b) => a.date.localeCompare(b.date));
  if (ahead[0]) data.next = { title: ahead[0].title, date: ahead[0].date, inDays: between(today, ahead[0].date) };
  const { days, me, partner } = await coupleStreak(store, relationshipId, { userId: user.id, timezone: zone, now });
  data.streak = { days, me, partner };
  return data;
}

export function createWidgetRouter({ store, perHour = 60 }) {
  const router = express.Router();
  const hits = new Map();
  const limited = (key) => {
    const now = Date.now(), recent = (hits.get(key) || []).filter((at) => at > now - 3_600_000);
    const over = recent.length >= perHour; if (!over) recent.push(now); hits.set(key, recent);
    if (hits.size > 5000) for (const [candidate, times] of hits) if (times.every((at) => at < now - 3_600_000)) hits.delete(candidate);
    return over;
  };
  const updateSettings = async (tx, userId, updater) => {
    const current = await tx.getRelationshipRecordForUser("accountSettings", `account:${userId}`, userId);
    if (current) return tx.updateRelationshipRecordForUser("accountSettings", current.id, userId, (record) => { updater(record); record.version += 1; });
    const record = createRelationshipRecord({ relationshipId: null, userId, visibility: "private", aiAccessScope: "none", privateRetentionDays: null });
    record.id = `account:${userId}`; updater(record); return tx.createRelationshipRecord("accountSettings", record);
  };
  const signedIn = (req, res, next) => req.auth ? next() : res.status(401).json({ error: "Please sign in." });

  router.post("/widget/token", signedIn, async (req, res) => {
    const userId = req.auth.user.id, secret = randomBytes(32).toString("base64url");
    await store.transaction(`user:${userId}`, (tx) => updateSettings(tx, userId, (record) => { record.widgetToken = { hash: hash(secret), createdAt: new Date().toISOString() }; }));
    res.status(201).json({ token: `${userId}.${secret}` });
  });
  router.delete("/widget/token", signedIn, async (req, res) => {
    const userId = req.auth.user.id;
    await store.transaction(`user:${userId}`, async (tx) => { const current = await tx.getRelationshipRecordForUser("accountSettings", `account:${userId}`, userId); if (current?.widgetToken) await updateSettings(tx, userId, (record) => { delete record.widgetToken; }); });
    res.status(204).end();
  });
  router.get("/widget", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const denied = () => res.status(401).json({ error: "invalid_token" });
    const token = /^Bearer ([A-Za-z0-9._-]{1,200})$/.exec(String(req.headers.authorization || ""))?.[1] || "";
    const [userId, secret, ...extra] = token.split(".");
    if (!userId || !secret || extra.length) return denied();
    if (limited(hash(token))) return res.status(429).json({ error: "rate_limited" });
    const stored = (await store.getRelationshipRecordForUser("accountSettings", `account:${userId}`, userId))?.widgetToken?.hash;
    if (!stored || !timingSafeEqual(Buffer.from(hash(secret), "hex"), Buffer.from(stored, "hex"))) return denied();
    const user = await store.getUserById(userId);
    if (!user || user.passwordHash === "deleted") return denied();
    res.json(await widgetData(store, user));
  });
  return router;
}
