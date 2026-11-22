// Production request timing for /api/ calls: which routes are slow, measured where users feel it. Logs only the method,
// the route with every id blanked, and milliseconds, never user ids, emails, bodies or query strings.
const ID = /\/(?:\d+|[0-9a-fA-F-]{8,}|[A-Za-z0-9_-]{20,}|[^/]*[@%][^/]*)(?=\/|$)/g;
export const SLOW_MS = 300;
const SUMMARY_MS = 900_000;
const MAX_SAMPLES = 500;
const MAX_ROUTES = 500;
const TOP = 12;

/** The path without its query string, with ids, tokens, emails and encoded values replaced by :id, at most 80 chars. */
export function route(url) {
  const path = String(url || "").split(/[?#]/, 1)[0];
  return path.replace(ID, "/:id").slice(0, 80);
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

export function createRequestTiming({ log = console.log, now = () => performance.now(), summaryMs = SUMMARY_MS } = {}) {
  const samples = new Map();

  function record(method, path, ms) {
    const key = `${method} ${route(path)}`;
    const rounded = Math.round(ms);
    if (rounded >= SLOW_MS) log(`[timing] slow ${key} ${rounded}ms`);
    let list = samples.get(key);
    if (!list) {
      if (samples.size >= MAX_ROUTES) return;
      samples.set(key, (list = []));
    }
    list.push(rounded);
    if (list.length > MAX_SAMPLES) list.splice(0, list.length - MAX_SAMPLES);
  }

  /** Logs the busiest routes since the last summary and starts a fresh window. */
  function summarize() {
    const rows = [...samples].sort((a, b) => b[1].length - a[1].length).slice(0, TOP);
    samples.clear();
    for (const [key, list] of rows) {
      const sorted = [...list].sort((a, b) => a - b);
      log(`[timing] ${key} n=${sorted.length} p50=${percentile(sorted, 0.5)}ms p95=${percentile(sorted, 0.95)}ms`);
    }
  }

  function middleware(req, res, next) {
    if (!req.originalUrl?.startsWith("/api/")) return next();
    const started = now();
    res.on("finish", () => record(req.method, req.originalUrl, now() - started));
    next();
  }

  const timer = summaryMs > 0 ? setInterval(summarize, summaryMs) : null;
  timer?.unref?.();
  return Object.assign(middleware, { record, summarize, stop: () => timer && clearInterval(timer) });
}
