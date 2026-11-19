import { createHash } from "node:crypto";
import express from "express";
import { internalBearerStatus } from "./reminder-router.mjs";

const DAY = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_KINDS = new Set(["open", "foreground", "heartbeat", "background"]);

function validDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const time = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function eventTime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/.test(value) || !validDay(value.slice(0, 10))) return null;
  const time = Date.parse(value), now = Date.now();
  return time >= now - 30 * DAY && time <= now + 600_000 ? new Date(time).toISOString() : null;
}

function hasOnlyKeys(object, allowed) {
  return object && typeof object === "object" && !Array.isArray(object) && Object.keys(object).every((key) => allowed.includes(key));
}

function lifecycleRecord(body) {
  if (!hasOnlyKeys(body, ["event_id", "install_id", "session_id", "kind", "at"])) return null;
  if (![body.event_id, body.install_id, body.session_id].every((id) => typeof id === "string" && UUID.test(id))) return null;
  const at = eventTime(body.at);
  if (!at || !EVENT_KINDS.has(body.kind)) return null;
  // Only timings belonging to the same session can be joined. No persistent install identifier is stored.
  const sessionKey = createHash("sha256").update(body.install_id.toLowerCase() + ":" + body.session_id.toLowerCase()).digest("hex");
  return { sessionKey, kind: body.kind, at };
}

function diagnosticRecord(body) {
  if (!hasOnlyKeys(body, ["event_id", "build", "at", "crashes"]) || typeof body.event_id !== "string" || !UUID.test(body.event_id)) return null;
  const at = eventTime(body.at);
  if (!at || typeof body.build !== "string" || body.build.length > 18 || !/^\d+(?:\.\d+){0,2}$/.test(body.build)) return null;
  if (!Array.isArray(body.crashes) || body.crashes.length < 1 || body.crashes.length > 16) return null;
  const crashes = [];
  for (const item of body.crashes) {
    if (!hasOnlyKeys(item, ["count", "signal", "exception_type", "exception_code"]) || !Number.isInteger(item.count) || item.count < 1 || item.count > 100_000) return null;
    for (const key of ["signal", "exception_type"]) {
      if (item[key] !== undefined && (!Number.isInteger(item[key]) || item[key] < -2147483648 || item[key] > 2147483647)) return null;
    }
    if (item.exception_code !== undefined) {
      const code = item.exception_code;
      if (!(typeof code === "string" && /^-?\d{1,20}$/.test(code)) && !Number.isSafeInteger(code)) return null;
    }
    crashes.push({ ...item });
  }
  return { id: body.event_id.toLowerCase(), at, build: body.build, crashes };
}

export function createAppMetricsRouter({ store, adminToken = () => process.env.PINKY_METRICS_ADMIN_TOKEN }) {
  const router = express.Router();
  // Offline devices flush several events at once. Keep only transient IP counters, never IPs in the database.
  const requests = new Map();
  let windowEnd = 0;
  function limitIntake(req, res, next) {
    const now = Date.now();
    if (now >= windowEnd) {
      requests.clear();
      windowEnd = now + 60_000;
    }
    const count = requests.get(req.ip) || 0;
    if (count >= 600 || (!count && requests.size >= 10_000)) {
      res.setHeader("Retry-After", String(Math.ceil((windowEnd - now) / 1000)));
      return res.status(429).end();
    }
    requests.set(req.ip, count + 1);
    next();
  }

  router.post("/app-metrics/lifecycle", limitIntake, async (req, res) => {
    const event = lifecycleRecord(req.body);
    if (!event) return res.status(400).json({ error: "invalid_lifecycle_event" });
    // An old anonymous event cannot be retroactively attributed to a newly created login session.
    const userId = req.auth?.session?.createdAt <= event.at ? req.auth.user.id : null;
    await store.createAppLifecycleRecord(event, userId);
    res.status(204).end();
  });

  router.post("/app-metrics/diagnostics", limitIntake, async (req, res) => {
    const record = diagnosticRecord(req.body);
    if (!record) return res.status(400).json({ error: "invalid_crash_summary" });
    await store.createAppCrashSummary(record);
    res.status(204).end();
  });

  router.get("/internal/app-metrics", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const status = internalBearerStatus(req, adminToken());
    if (status !== 200) return res.status(status).json({ error: status === 503 ? "metrics_admin_not_configured" : "unauthorized" });
    const { from, to } = req.query;
    if (!validDay(from) || !validDay(to) || from > to || Date.parse(to) - Date.parse(from) >= 366 * DAY) {
      return res.status(400).json({ error: "Expected an inclusive UTC range of 1 to 366 days in YYYY-MM-DD format." });
    }
    res.json({ product: "pinky", days: await store.getAppMetricDays(from, to) });
  });
  return router;
}
