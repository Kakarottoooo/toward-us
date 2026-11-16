import { readdirSync, statSync, openSync, fstatSync, readSync, closeSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Inspect rate metadata only. Never emit session content or authentication files.
export function primaryQuota(directory, home = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "sessions")) {
  const year = new Date(performance.timeOrigin + performance.now()).toISOString().slice(0, 4);
  const month = new Date(performance.timeOrigin + performance.now()).toISOString().slice(5, 7);
  const root = join(home, year, month);
  const files = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => {
    const folder = join(root, entry.name);
    return readdirSync(folder).filter(name => name.endsWith(".jsonl")).map(name => ({ path: join(folder, name), modified: statSync(join(folder, name)).mtimeMs }));
  }).sort((a, b) => b.modified - a.modified).slice(0, 10);
  const readings = [];
  for (const file of files) {
    const fd = openSync(file.path, "r");
    try {
      const size = fstatSync(fd).size, buffer = Buffer.alloc(Math.min(size, 2000000));
      readSync(fd, buffer, 0, buffer.length, size - buffer.length);
      for (const line of buffer.toString("utf8").split("\n")) if (line.includes('"rate_limits"')) {
        try {
          const row = JSON.parse(line), primary = row.payload?.rate_limits?.primary;
          if (typeof primary?.used_percent === "number") readings.push({ observedAt: row.timestamp, usedPercent: primary.used_percent });
        } catch { /* partial first/last line */ }
      }
    } finally { closeSync(fd); }
  }
  const latest = readings.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
  if (!latest) throw Error("没有 Codex primary 额度读数，停止调用");
  appendFileSync(join(directory, "quota.jsonl"), JSON.stringify({ checkedAt: new Date(performance.timeOrigin + performance.now()).toISOString(), ...latest }) + "\n");
  if (latest.usedPercent >= 97) throw Error("Codex primary 额度已达 97%，停止调用");
  return latest;
}
