import { createHash } from "node:crypto";
import { fixtureValue } from "./external-cases.mjs";

export const corpusHash = (cases) => createHash("sha256").update(JSON.stringify(cases)).digest("hex");

// Fail closed: reusing an answer is only meaningful with the exact same question and visible material.
export function frozenCase(item, baseline, hash) {
  if (!baseline) return null;
  if (baseline.caseHash !== hash) throw new Error("Frozen opponent corpus hash differs");
  const rows = baseline.results.filter((row) => row.id === item.id);
  if (rows.length !== 1) throw new Error(`Frozen case missing or duplicated: ${item.id}`);
  const row = rows[0], at = Date.parse(row.visible?.now);
  if (!Number.isFinite(at) || !row.question) throw new Error(`Frozen case lacks time/question: ${item.id}`);
  const question = fixtureValue(item.probe.text, { at, timezone: item.timezone || "Asia/Shanghai" });
  // Historical opponents must retain their exact question, including the old
  // UTC-template wording. New runs use the corrected case-local calendar.
  const legacyQuestion = fixtureValue(item.probe.text, { at, timezone: "UTC" });
  if (question !== row.question && legacyQuestion !== row.question) throw new Error(`Frozen question differs: ${item.id}`);
  for (const provider of ["claude", "codex"]) {
    if (row.rivals?.[provider]?.error || !row.rivals?.[provider]?.answer) throw new Error(`Frozen answer unavailable: ${item.id}/${provider}`);
  }
  return row;
}

// Only this disposable evaluation process uses the old case's calendar. Time continues to advance,
// so product timeout loops still terminate; concurrent cases and non-case reporting keep separate clocks.
export function installCaseClock(context) {
  const RealDate = globalThis.Date;
  const now = () => {
    const clock = context.getStore()?.clock;
    return clock ? clock.at + RealDate.now() - clock.startedAt : RealDate.now();
  };
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args) { return Reflect.construct(target, args.length ? args : [now()]); },
    apply() { return new RealDate(now()).toString(); },
    get(target, property) { return property === "now" ? now : Reflect.get(target, property); },
  });
  return () => { globalThis.Date = RealDate; };
}

export function frozenOpponent(row, provider, source) {
  const original = structuredClone(row.rivals[provider]);
  return { ...original, reused: true, originalCost: { usd: original.usd ?? null, usage: original.usage, ms: original.ms },
    // Historical spend is evidence, never a new invocation in this run's total.
    usd: 0, usage: null, ms: 0, frozenSource: source };
}

export const agreementProtocol = [
  "第一步：先只给约定草稿，不能把提出者说的代批准当作另一方同意。",
  "第二步：提出者看过草稿后，明确点击发给双方批准；此时仍不生效。",
  "第三步：提出者只批准自己的同一版本，不能代替另一方批准。",
  "第四步：另一位虚构用户登录自己的独立账号，看过同一版本后亲自批准，双方批准后才生效。",
];
