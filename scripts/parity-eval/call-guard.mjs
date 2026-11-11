import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createModelCallBudget, setModelCallBudget } from "../../server/model-call-budget.mjs";

export const quotaError = (text) => /you.ve hit your[^\n]{0,80}limit|(?:usage|rate) limit reached|rate_limit_error|too many requests|out of extra usage|credit balance is too low/i.test(text);

// Installed only by the disposable evaluation runner, before any model call.
// Observe all transports (including vision/search), not just text usage events.
export function installCallGuard({ directory, context, maxClaudeCalls = 120, maxCalls = Infinity, maxClaudeTurns = 120, maxCodexCalls = 40, budgetFile = join(directory, "model-budget.json"), checkpoint }) {
  const budget = createModelCallBudget({ maxClaudeTurns, maxCodexCalls, file: budgetFile, context, onStop: (reason) => stop(reason) });
  setModelCallBudget(budget);
  const original = childProcess.spawn, children = new Set(), calls = [];
  let stopped = false;
  const log = (event) => appendFileSync(join(directory, "calls.jsonl"), `${JSON.stringify(event)}\n`);
  const stop = (reason) => {
    if (stopped) return;
    stopped = true;
    checkpoint?.();
    writeFileSync(join(directory, "aborted.json"), JSON.stringify({ reason, at: new Date().toISOString(), calls }, null, 2));
    for (const child of children) {
      if (!child.pid) continue;
      if (process.platform === "win32") {
        try { childProcess.execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {}
      } else child.kill("SIGTERM");
    }
    console.error(`Evaluation stopped without retry: ${reason}`);
    process.exit(2);
  };
  childProcess.spawn = function (command, args = [], options) {
    const provider = /(?:^|[\\/])claude(?:\.exe|\.cmd)?$/i.test(command) ? "claude" : args.some((arg) => /codex[\\/]bin[\\/]codex\.js$/.test(arg)) || /(?:^|[\\/])codex$/.test(command) ? "codex" : null;
    if (provider && calls.length >= maxCalls) stop("total model call budget reached");
    if (provider === "claude" && calls.filter((call) => call.provider === "claude").length >= maxClaudeCalls) stop("evaluation Claude call budget reached");
    const child = original(command, args, options);
    if (!provider) return child;
    const tag = context.getStore() || {};
    const call = { id: calls.length + 1, provider, model: args.includes("--model") ? args[args.indexOf("--model") + 1] : null,
      case: tag.case || null, phase: tag.phase || null, startedAt: new Date().toISOString() };
    calls.push(call); children.add(child); log({ event: "start", ...call });
    let output = "";
    const inspect = (chunk) => {
      output += chunk.toString();
      if (quotaError(output)) stop(`${provider} subscription quota error`);
    };
    child.stdout?.on("data", inspect); child.stderr?.on("data", inspect);
    child.once("close", (code) => {
      children.delete(child); call.code = code; call.endedAt = new Date().toISOString();
      if (provider === "claude") {
        try { const result = JSON.parse(output); call.usage = result.usage; call.usd = result.total_cost_usd; call.turns = result.num_turns; } catch {}
      }
      log({ event: "end", ...call });
    });
    return child;
  };
  syncBuiltinESMExports();
  return { calls, budget, restore: () => { childProcess.spawn = original; syncBuiltinESMExports(); setModelCallBudget(null); } };
}
