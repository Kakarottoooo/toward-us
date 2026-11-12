#!/usr/bin/env node
// The AI cost report as a short table: node scripts/ai-cost-report.mjs [--days 7] [--url http://127.0.0.1:5180] [--json]
// It reads GET /api/internal/ai-cost with the internal secret from REMINDER_RUN_SECRET (never printed). Estimated USD at
// published list prices; Claude CLI (subscription) rows are the list-price equivalent, not a bill.
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(`--${name}`); return index >= 0 && args[index + 1] ? args[index + 1] : fallback; };
const base = option("url", process.env.PINKY_URL || "http://127.0.0.1:5180").replace(/\/$/, "");
const days = Number(option("days", "7"));
const secret = process.env.REMINDER_RUN_SECRET || "";

export function formatReport(report) {
  const usd = (value) => value === null || value === undefined ? "unknown" : `$${Number(value).toFixed(4)}`;
  const short = (id) => id ? String(id).slice(0, 8) : "-";
  const lines = [];
  const table = (title, header, rows) => {
    lines.push("", title);
    if (!rows.length) { lines.push("  (no data yet)"); return; }
    const all = [header, ...rows].map((row) => row.map(String));
    const widths = header.map((_, column) => Math.max(...all.map((row) => row[column].length)));
    for (const row of all) lines.push(`  ${row.map((cell, column) => cell.padEnd(widths[column])).join("  ")}`);
  };
  lines.push(`AI cost ${report.since} .. ${report.until} (${report.days} days), generated ${report.generatedAt}`);
  lines.push(`Total ${usd(report.window.usd)} (metered ${usd(report.window.meteredUsd)}), ${report.window.calls} calls, ${report.window.unknownCalls} priced unknown`);
  lines.push(`Cost per active user: ${usd(report.costPerActiveUser.usdPerActiveUser)} over ${report.costPerActiveUser.activeUsers} users; month to date ${usd(report.costPerActiveUser.monthToDate.usdPerActiveUser)} over ${report.costPerActiveUser.monthToDate.activeUsers}`);
  table("Per user per day", ["day", "user", "couple", "usd", "calls", "unknown", "blocked"], report.perUserDay.map((row) => [row.day, short(row.userId), short(row.spaceId), usd(row.usd), row.calls, row.unknownCalls, row.blocked]));
  table("Per user per month", ["month", "user", "couple", "usd", "calls"], report.perUserMonth.map((row) => [row.month, short(row.userId), short(row.spaceId), usd(row.usd), row.calls]));
  table("Per feature", ["feature", "usd", "calls", "users", "unknown", "errors", "degraded", "blocked", "would limit", "median ms"], report.perFeature.map((row) => [row.feature, usd(row.usd), row.calls, row.users, row.unknownCalls, row.errors + row.timeouts, row.degraded, row.blocked, row.wouldLimit, row.medianLatencyMs ?? "-"]));
  table("Top users", ["user", "couple", "usd", "calls"], report.topUsers.map((row) => [short(row.userId), short(row.spaceId), usd(row.usd), row.calls]));
  table("By model", ["model", "usd"], Object.entries(report.byModel).map(([model, value]) => [model, usd(value)]));
  const controls = report.controls;
  lines.push("", `Controls: kill switch ${controls.killSwitch ? "ON" : "off"}; enforced on ${controls.enforceOn.join(", ") || "nothing"}; free day ${usd(controls.caps.free.dailyUsd.soft)}/${usd(controls.caps.free.dailyUsd.hard)}, month ${usd(controls.caps.free.monthlyUsd.soft)}/${usd(controls.caps.free.monthlyUsd.hard)} (soft/hard)`);
  lines.push(`Prices checked ${report.prices.checked}: ${report.prices.anthropic} ; ${report.prices.openai} ; ${report.prices.replicate}`);
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!secret) { console.error("Set REMINDER_RUN_SECRET (the server's internal secret) to read the cost report."); process.exit(2); }
  if (!Number.isInteger(days) || days < 1) { console.error("--days must be a positive integer."); process.exit(2); }
  const response = await fetch(`${base}/api/internal/ai-cost?days=${days}`, { headers: { authorization: `Bearer ${secret}` } }).catch((error) => { console.error(`Could not reach ${base}: ${error.message}`); process.exit(1); });
  if (!response.ok) { console.error(`The server answered ${response.status}.`); process.exit(1); }
  const report = await response.json();
  console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : formatReport(report));
}
