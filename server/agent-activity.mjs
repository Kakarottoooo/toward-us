import { randomUUID } from "node:crypto";
import express from "express";

// What Pinky is doing right now while it prepares a reply, so the App can say so under the character and in a typing
// bubble (the founder, 11-03, after Meta Muse: a small status like "searching" plus three dots). Kept in memory only: it is
// a live hint that ends with the reply, never a record. Step codes only; the App words them in ZH/EN/ES.
export const AGENT_STEPS = new Set(["thinking", "searching_web", "searching_chats", "checking_records", "mediating", "writing", "acting"]);
const DETAIL_LIMIT = 80;

/**
 * Keys come from the server, never from the client: `me:<userId>` is seen only by that member; `us:<relationshipId>` by
 * both members of an active couple, because what Pinky does there answers a message both of them already see.
 */
export function createAgentActivity({ now = () => Date.now(), staleMs = 120_000, notify = () => {} } = {}) {
  const live = new Map();
  const latest = (key) => {
    const entries = live.get(key); if (!entries) return null;
    for (const [token, entry] of entries) if (now() - entry.updatedAt > staleMs) entries.delete(token);
    if (!entries.size) { live.delete(key); return null; }
    return [...entries.values()].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  };
  /** One turn's progress reporter: `progress(step, detail?)` moves it on; `progress(null)` ends it. Unknown steps are ignored. */
  const track = (key, audience) => {
    const token = randomUUID(); let ended = false;
    return (step, detail = null) => {
      if (ended) return;
      const entries = live.get(key) || new Map();
      if (step === null) { ended = true; entries.delete(token); if (!entries.size) live.delete(key); notify(audience); return; }
      if (!AGENT_STEPS.has(step)) return;
      const previous = entries.get(token);
      entries.set(token, { step, detail: typeof detail === "string" && detail.trim() ? detail.trim().slice(0, DETAIL_LIMIT) : null, startedAt: previous?.startedAt || now(), updatedAt: now() });
      live.set(key, entries); notify(audience);
    };
  };
  const view = (entry) => entry ? { step: entry.step, detail: entry.detail, since: new Date(entry.startedAt).toISOString() } : null;
  return {
    /** A private turn: only `userId` sees it. `relationshipId`, when known, only routes the live nudge to that member. */
    forMember: (userId, relationshipId = null) => track(`me:${userId}`, { relationshipId, ownerUserId: userId }),
    /** A turn in Us: both members see it. */
    forCouple: (relationshipId) => track(`us:${relationshipId}`, { relationshipId, ownerUserId: null }),
    member: (userId) => view(latest(`me:${userId}`)),
    couple: (relationshipId) => view(latest(`us:${relationshipId}`)),
  };
}

/** `GET /agent/activity?channel=me|us`: the caller's own private activity, or their couple's in Us. */
export function createAgentActivityRouter({ store, activity }) {
  const router = express.Router();
  router.get("/agent/activity", async (req, res) => {
    if (!req.auth) return res.status(401).json({ error: "Please sign in." });
    const userId = req.auth.user.id;
    if (req.query?.channel !== "us") return res.json({ activity: activity.member(userId) });
    // Membership is checked here on every read; an ended or unpaired relationship shows nothing.
    const context = await store.getRelationshipContext(userId);
    const active = context?.relationship.status === "active" && context.members.length === 2;
    res.json({ activity: active ? activity.couple(context.relationship.id) : null });
  });
  return router;
}
