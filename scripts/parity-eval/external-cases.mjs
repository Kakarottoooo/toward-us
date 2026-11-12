import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

export async function loadCasesFile(file) {
  const path = resolve(file);
  if (path.split(/[\\/]/).some((part) => ["dogfood", "data"].includes(part.toLowerCase()))) throw new Error("Synthetic cases only");
  const bytes = await readFile(path);
  const source = JSON.parse(bytes);
  if (source.version !== 1 || !["examples", "holdout"].includes(source.purpose) || !Array.isArray(source.cases) || !source.cases.length) throw new Error("Expected version 1 external cases with purpose examples/holdout");
  const ids = new Set();
  const cases = source.cases.map((row) => {
    if (!/^[a-z0-9][a-z0-9_-]{0,100}$/.test(row.id) || ids.has(row.id)) throw new Error("Unsafe or duplicate case ID");
    ids.add(row.id);
    if (row.probe?.repeat !== undefined && (!Number.isInteger(row.probe.repeat) || row.probe.repeat < 1 || row.probe.repeat > 3)) throw new Error(`Invalid repeat: ${row.id}`);
    if (!["interaction", "memory", "orchestration", "tools", "environment"].includes(row.layer) || !row.title || !row.probe?.text || !row.probe.thread || !row.completion || !Array.isArray(row.expect?.must) || !Array.isArray(row.expect?.mustNot)) throw new Error(`Incomplete case: ${row.id}`);
    const threads = ["main", "partner", ...(row.people || [])];
    if (!threads.includes(row.probe.thread) || (row.history || []).some((line) => !threads.includes(line.thread) || !Number.isFinite(line.day) || typeof line.text !== "string")) throw new Error(`Invalid history/thread: ${row.id}`);
    if ((row.notes || []).some((note) => !["me", ...(row.people || [])].includes(note.about) || !Number.isFinite(note.day) || !note.text || !note.category)) throw new Error(`Invalid note: ${row.id}`);
    if ((row.probe.as === "partner" || row.history?.some((line) => line.thread === "partner") || row.shared?.length || row.channel === "shared") && !row.paired) throw new Error(`Partner data requires a pair: ${row.id}`);
    for (const entry of row.shared || []) if (!["me", "partner"].includes(entry.speaker) || !entry.text || !Number.isFinite(entry.day)) throw new Error(`Invalid shared message: ${row.id}`);
    for (const entry of row.reminders || []) if (!["me", "partner"].includes(entry.owner) || !entry.title || !entry.dueAt || !entry.timezone || !["once", "weekly"].includes(entry.frequency) || entry.owner === "partner" && !row.paired) throw new Error(`Invalid reminder: ${row.id}`);
    for (const check of row.writes || []) if (!["reminders", "memories", "checkins", "spaces", "spaceItems", "agreements", "draftAgreement"].includes(check.collection) || !Number.isSafeInteger(check.count) || check.count < 0 || !check.fields || !["created", "updated"].includes(check.mode || "created") || check.scope !== undefined && check.scope !== "user_visible") throw new Error(`Invalid write check: ${row.id}`);
    if (row.layer === 'environment') {
      if (!row.pages || !Object.keys(row.pages).length || !row.readonly?.paths?.length || !['ok', 'blocked', 'login_required', 'unavailable', 'unsupported', 'timeout'].includes(row.readonly.status)) throw new Error(`Missing declarative pages: ${row.id}`);
      if (/https?:\/\/|javascript:|data:|file:|\/\//iu.test(JSON.stringify(row))) throw new Error(`External URLs are forbidden: ${row.id}`);
      for (const [path, page] of Object.entries(row.pages)) {
        if (!/^\/[a-zA-Z0-9/_-]*$/.test(path) || path.includes('//') || path.includes('..') || !page || Object.keys(page).some(key => !['html', 'statuses', 'delayMs'].includes(key))
          || typeof page.html !== 'string' || page.html.length > 50_000 || !Array.isArray(page.statuses) || !page.statuses.length || page.statuses.length > 10
          || page.statuses.some(status => !Number.isInteger(status) || status < 200 || status > 599 || status >= 300 && status < 400)
          || page.delayMs !== undefined && (!Number.isInteger(page.delayMs) || page.delayMs < 0 || page.delayMs > 15_000)
          || /<(?:script|iframe|object|embed|svg|math|link|meta|base)\b|\bon\w+\s*=|&#|&colon;/iu.test(page.html)) throw new Error(`Unsafe declarative page: ${row.id}${path}`);
      }
      if (row.readonly.paths.some(path => !Object.hasOwn(row.pages, path)) || !row.probe.text.includes('{{origin}}')) throw new Error(`Unknown page or missing origin placeholder: ${row.id}`);
    } else if (row.pages || row.readonly) throw new Error(`Pages require environment layer: ${row.id}`);
    let assetText = row.assetText;
    if (row.screenshot) {
      if (!row.screenshot.title || !Array.isArray(row.screenshot.messages) || !row.screenshot.messages.length || row.screenshot.messages.some((line) => !line.speaker || !line.time || typeof line.text !== "string")) throw new Error(`Invalid screenshot: ${row.id}`);
      assetText = [row.screenshot.title, ...row.screenshot.messages.map((line) => `${line.speaker} ${line.time}: ${line.text}`)].join("\n");
    }
    if (["screenshot", "image", "file"].includes(row.modality) && !assetText) throw new Error(`Missing attachment: ${row.id}`);
    return { ...row, ...(assetText ? { assetText } : {}) };
  });
  return { cases, source: { path, sha256: createHash("sha256").update(bytes).digest("hex"), purpose: source.purpose, createdAt: source.createdAt || null } };
}

export function externalWebCases(cases, origin) {
  return cases.map(row => row.layer === 'environment' ? { ...row, probe: { ...row.probe, text: row.probe.text.replaceAll('{{origin}}', `${origin}/${row.id}`) }, readonly: { ...row.readonly, paths: row.readonly.paths.map(path => `/${row.id}${path}`) } } : row);
}

export async function renderAsset(item, root) {
  if (!["image", "screenshot"].includes(item.modality)) return null;
  const { default: sharp } = await import("sharp");
  const escape = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const lines = (item.assetText || "Synthetic image").split("\n").flatMap((line) => line.match(/.{1,66}/g) || [""]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${Math.max(360, lines.length * 40 + 100)}"><rect width="100%" height="100%" fill="white"/>${lines.map((line, index) => `<text x="30" y="${60 + 40 * index}" font-family="Arial,Microsoft YaHei" font-size="25" fill="black">${escape(line)}</text>`).join("")}</svg>`;
  const path = join(root, "synthetic.png");
  await sharp(Buffer.from(svg)).png().toFile(path);
  return path;
}

export function fixtureValue(value, { me, partner, at, timezone = "UTC" }) {
  if (value === "$me") return me;
  if (value === "$partner") return partner;
  if (typeof value !== "string" || !/\{date:-?\d+\}/u.test(value)) return value;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
  return typeof value === "string" ? value.replace(/\{date:(-?\d+)\}/g, (_, days) => new Date(Date.parse(`${day}T00:00:00Z`) + Number(days) * 86400000).toISOString().slice(0, 10)) : value;
}

export function writeChecks(specs, before, after, context) {
  return specs.map((spec) => {
    const records = snapshot => spec.collection === "draftAgreement"
      ? (snapshot.togetherConversations || []).filter(row => row.draftAgreement).map(row => ({ id: row.id, ...row.draftAgreement }))
      : (snapshot[spec.collection] || []).filter(row => spec.collection !== "spaces" || !row.system);
    const old = new Map(records(before).map((row) => [row.id, row]));
    const changed = records(after).filter((row) => spec.mode === "updated" ? old.has(row.id) && JSON.stringify(old.get(row.id)) !== JSON.stringify(row) : !old.has(row.id));
    const matches = changed.filter((row) => Object.entries(spec.fields).every(([key, value]) => JSON.stringify(row[key]) === JSON.stringify(fixtureValue(value, { ...context, timezone: spec.fields.timezone || context.timezone }))));
    return { name: spec.name || `${spec.collection}: ${spec.mode || "created"}`, ok: changed.length === spec.count && matches.length === spec.count, expectedCount: spec.count, changedCount: changed.length, matchingCount: matches.length };
  });
}
