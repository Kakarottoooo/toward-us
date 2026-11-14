#!/usr/bin/env node
// Partner join report: node scripts/partner-join-report.mjs [--days 30] [--url https://pinky-app.fly.dev] [--json]
// It reads GET /api/internal/partner-joins with the internal secret from REMINDER_RUN_SECRET (never printed). Counts and
// timestamps only: no names, emails or invite codes leave the server.
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(`--${name}`); return index >= 0 && args[index + 1] ? args[index + 1] : fallback; };
const base = option("url", process.env.PINKY_URL || "http://127.0.0.1:5180").replace(/\/$/, "");
const days = Number(option("days", "30"));
const secret = process.env.REMINDER_RUN_SECRET || "";

export function formatReport(report) {
  const percent = (value) => value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
  return [
    `Partner joins ${report.since.slice(0, 10)} .. ${report.until.slice(0, 10)} (${report.days} days)`,
    `  invites created   ${report.created}`,
    `  links opened      ${report.opened}`,
    `  partners joined   ${report.joined}`,
    `  joined within 48h ${report.joinedWithin48h}`,
    `  48h join share    ${percent(report.shareJoinedWithin48h)} (${report.settledJoinedWithin48h} of ${report.settled} invites at least 48h old)`,
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!secret) { console.error("Set REMINDER_RUN_SECRET (the server's internal secret) to read the partner join report."); process.exit(2); }
  if (!Number.isInteger(days) || days < 1) { console.error("--days must be a positive integer."); process.exit(2); }
  const response = await fetch(`${base}/api/internal/partner-joins?days=${days}`, { headers: { authorization: `Bearer ${secret}` } }).catch((error) => { console.error(`Could not reach ${base}: ${error.message}`); process.exit(1); });
  if (!response.ok) { console.error(`The server answered ${response.status}.`); process.exit(1); }
  const report = await response.json();
  console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : formatReport(report));
}
