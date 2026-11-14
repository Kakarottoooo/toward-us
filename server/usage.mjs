import express from "express";
import { createRelationshipRecord } from "./relationship-domain.mjs";
import { internalBearerStatus } from "./reminder-router.mjs";
import { AI_CAPS, aiUsageReport } from "./ai-budget.mjs";

// Content-free usage records. A record is only {userId, relationshipId|null, action, channel, createdAt}: never text, titles,
// object ids or phone numbers. It is owner-private (not in any projection, export or partner view) and read only by the
// founder's internal /api/internal/usage report. The channel is decided by the server code that calls this, never by the client:
// "app" is every request from the signed-in UI (the SPA and a browser tab are indistinguishable server-side, so "web" is unused today);
// the iMessage entry point will pass "imessage".
const CHANNELS = new Set(["app", "imessage", "web"]);
const ACTION = /^[a-z][a-z0-9_]{2,47}$/;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Call as `void recordUsage(...)` after the surrounding store.transaction has finished: it never rejects, so it cannot become an
// unhandled rejection, and callers do not wait for it. A failed insert must never poison the caller's transaction or the request.
// The file store serializes the write through its transaction queue, so concurrent un-awaited writes cannot lose each other. relationshipId undefined means "look it up"; null means explicitly unpaired.
export async function recordUsage(store, { userId, relationshipId, action, channel = "app" }) {
  try {
    if (!userId || !ACTION.test(action || "")) return null;
    const pairedId = relationshipId === undefined ? (await store.getRelationshipContext(userId))?.relationship.id ?? null : relationshipId;
    return await store.createRelationshipRecord("productEvents", createRelationshipRecord({ relationshipId: pairedId, userId, visibility: "private", aiAccessScope: "none", approvalPolicy: "owner", status: "recorded", action, channel: CHANNELS.has(channel) ? channel : "app" }));
  } catch (error) { console.error("usage_record_failed", error?.code || error?.name || "error"); return null; }
}

// ISO week (Monday start, UTC), e.g. "2026-W44".
export function isoWeek(value) {
  const date = new Date(value); const day = (date.getUTCDay() + 6) % 7;
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day + 3));
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return `${thursday.getUTCFullYear()}-W${String(Math.floor((thursday.getTime() - yearStart) / WEEK_MS) + 1).padStart(2, "0")}`;
}
const weekStart = (value) => { const date = new Date(value); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - ((date.getUTCDay() + 6) % 7)); };

// One row per relationship that is or was active, per ISO week it existed in the window (quiet weeks show activeMembers 0).
export async function weeklyUsage(store, { weeks = 4, now = new Date() } = {}) {
  const current = weekStart(now), first = current - (weeks - 1) * WEEK_MS;
  const relationships = new Map((await store.listRelationshipsForJob()).filter((item) => item.status === "active" || item.status === "ended").map((item) => [item.id, item]));
  const rows = new Map();
  const row = (relationshipId, start) => { const key = `${relationshipId}|${start}`; if (!rows.has(key)) rows.set(key, { relationshipId, week: isoWeek(start), members: new Set(), actions: {} }); return rows.get(key); };
  for (const [id, relationship] of relationships) {
    const from = Math.max(first, weekStart(relationship.createdAt)), to = relationship.status === "ended" ? Math.min(current, weekStart(relationship.updatedAt)) : current;
    for (let start = from; start <= to; start += WEEK_MS) row(id, start);
  }
  for (const event of await store.listRecordsForJob("productEvents")) {
    const start = weekStart(event.createdAt);
    if (!relationships.has(event.relationshipId) || start < first || start > current) continue;
    const target = row(event.relationshipId, start); target.members.add(event.ownerUserId); target.actions[event.action] = (target.actions[event.action] || 0) + 1;
  }
  return [...rows.values()].sort((a, b) => a.relationshipId.localeCompare(b.relationshipId) || a.week.localeCompare(b.week))
    .map(({ relationshipId, week, members, actions }) => ({ relationshipId, week, activeMembers: Math.min(members.size, 2), actions }));
}

const JOIN_WINDOW_MS = 48 * 60 * 60 * 1000;
/** The two-sided cold start in numbers: partner invites created, opened and joined, and how many joined within 48 hours.
 * Only invites at least 48 hours old count towards the 48-hour share, so a fresh invite does not pull it down. A partner who
 * joined by typing the code counts as opened too, so the funnel never narrows the wrong way. Timestamps only. */
export function partnerJoinReport(invitations, { days = 30, now = new Date() } = {}) {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = invitations.filter((invitation) => invitation.createdAt >= since);
  const joinedWithin = (invitation) => invitation.acceptedAt && Date.parse(invitation.acceptedAt) - Date.parse(invitation.createdAt) <= JOIN_WINDOW_MS;
  const settled = rows.filter((invitation) => now.getTime() - Date.parse(invitation.createdAt) >= JOIN_WINDOW_MS);
  const within = settled.filter(joinedWithin).length;
  return {
    days, since, until: now.toISOString(),
    created: rows.length, opened: rows.filter((invitation) => invitation.openedAt || invitation.acceptedAt).length, joined: rows.filter((invitation) => invitation.acceptedAt).length,
    joinedWithin48h: rows.filter(joinedWithin).length, settled: settled.length, settledJoinedWithin48h: within, shareJoinedWithin48h: settled.length ? within / settled.length : null,
  };
}

export function createUsageRouter({ store, internalSecret = () => "" }) {
  const router = express.Router();
  // The App opened from a push (its link carries from=push): counted, never with what the push said.
  router.post("/api/usage/push-opened", async (req, res) => {
    if (!req.auth?.user?.id) return res.status(401).json({ error: "Please sign in." });
    await recordUsage(store, { userId: req.auth.user.id, action: "push_opened" });
    res.status(204).end();
  });
  router.get("/api/internal/usage", async (req, res, next) => {
    const status = internalBearerStatus(req, internalSecret());
    if (status === 503) return res.status(503).json({ error: "Usage reporting is not configured." });
    if (status !== 200) return res.status(401).json({ error: "Unauthorized." });
    const requested = req.query.weeks === undefined ? 4 : Number(req.query.weeks);
    if (!Number.isInteger(requested) || requested < 1) return res.status(400).json({ error: "weeks must be a positive integer.", code: "invalid_weeks" });
    res.setHeader("Cache-Control", "no-store");
    try { res.json(await weeklyUsage(store, { weeks: Math.min(requested, 12) })); } catch (error) { next(error); }
  });
  // Partner invites created / opened / joined and the share joined within 48 hours: node scripts/partner-join-report.mjs.
  router.get("/api/internal/partner-joins", async (req, res, next) => {
    const status = internalBearerStatus(req, internalSecret());
    if (status === 503) return res.status(503).json({ error: "Usage reporting is not configured." });
    if (status !== 200) return res.status(401).json({ error: "Unauthorized." });
    const requested = req.query.days === undefined ? 30 : Number(req.query.days);
    if (!Number.isInteger(requested) || requested < 1) return res.status(400).json({ error: "days must be a positive integer.", code: "invalid_days" });
    res.setHeader("Cache-Control", "no-store");
    try { res.json(partnerJoinReport(await store.listInvitationsForJob(), { days: Math.min(requested, 365) })); } catch (error) { next(error); }
  });
  // Model calls per day, per couple (or unpaired person) and per feature, with the caps in force: for tuning AI_CAPS.
  router.get("/api/internal/ai-usage", async (req, res, next) => {
    const status = internalBearerStatus(req, internalSecret());
    if (status === 503) return res.status(503).json({ error: "Usage reporting is not configured." });
    if (status !== 200) return res.status(401).json({ error: "Unauthorized." });
    const requested = req.query.days === undefined ? 3 : Number(req.query.days);
    if (!Number.isInteger(requested) || requested < 1) return res.status(400).json({ error: "days must be a positive integer.", code: "invalid_days" });
    res.setHeader("Cache-Control", "no-store");
    try { res.json({ caps: AI_CAPS, rows: await aiUsageReport(store, { days: Math.min(requested, 31) }) }); } catch (error) { next(error); }
  });
  return router;
}
