// Prints every user's feedback about Pinky for the team, most severe and newest first: `npm run feedback`.
// Reads the same store the server uses (TOWARD_US_DATA_FILE, or DATABASE_URL in production). Shows user ids, not names.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const severityRank = { high: 0, medium: 1, low: 2 };
async function load() {
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try { return (await pool.query("select data from (select data, created_at from product_feedback union all select data, created_at from demo_reply_reports) items order by created_at desc limit 500")).rows.map((row) => row.data); }
    finally { await pool.end(); }
  }
  const file = resolve(process.env.TOWARD_US_DATA_FILE || resolve("data", "toward-us.local.json"));
  const base = JSON.parse(await readFile(file, "utf8"));
  const records = { "graph.feedback": base.relationshipGraph?.feedback || {}, demoReplyReports: base.demoReplyReports || {} };
  const journal = await readFile(file + ".journal", "utf8").catch((error) => { if (error.code === "ENOENT") return ""; throw error; });
  for (const line of journal.split("\n")) {
    let entry; try { entry = JSON.parse(line); } catch { continue; }
    if (entry.g !== (base.journalGeneration || 0)) continue;
    for (const [path, id, value] of entry.c || []) if (Object.hasOwn(records, path)) { if (value === null) delete records[path][id]; else records[path][id] = value; }
  }
  return Object.values(records).flatMap((collection) => Object.values(collection));
}

const items = (await load()).sort((a, b) => (severityRank[a.severity] ?? 3) - (severityRank[b.severity] ?? 3) || b.createdAt.localeCompare(a.createdAt));
if (process.argv.includes("--json")) console.log(JSON.stringify(items, null, 2));
else if (!items.length) console.log("No feedback yet.");
else for (const item of items) {
  console.log(`[${item.severity || "?"}] ${item.kind || "unsorted"} · ${item.createdAt.slice(0, 16).replace("T", " ")} · ${item.context?.view || "conversation"} · user ${item.ownerUserId?.slice(0, 8) || "demo"}${item.photoIds?.length ? ` · ${item.photoIds.length} screenshot(s)` : ""}`);
  if (item.summary) console.log(`  ${item.summary}`);
  console.log(`  "${item.text.replace(/\s+/g, " ").slice(0, 400)}"\n`);
}
