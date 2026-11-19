import express from "express";
import { internalBearerStatus } from "./reminder-router.mjs";
import { aiCostReport } from "./ai-ledger.mjs";

// The founder's AI cost report (admin only, behind the internal bearer secret like /api/internal/usage): estimated cost per
// person per day and month, per feature, the top people and the cost per active person. Content-free: ids and numbers only.
// No member-facing route reads the ledger, so a partner never sees the other member's usage.
export function createAiCostRouter({ store, internalSecret = () => "" }) {
  const router = express.Router();
  router.get("/api/internal/ai-cost", async (req, res, next) => {
    const status = internalBearerStatus(req, internalSecret());
    if (status === 503) return res.status(503).json({ error: "Cost reporting is not configured." });
    if (status !== 200) return res.status(401).json({ error: "Unauthorized." });
    const requested = req.query.days === undefined ? 7 : Number(req.query.days);
    if (!Number.isInteger(requested) || requested < 1) return res.status(400).json({ error: "days must be a positive integer.", code: "invalid_days" });
    res.setHeader("Cache-Control", "no-store");
    try { res.json(await aiCostReport(store, { days: Math.min(requested, 35) })); } catch (error) { next(error); }
  });
  return router;
}
