import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const quotaError = (text) => /you.ve hit your[^\n]{0,80}limit|(?:usage|rate) limit reached|rate_limit_error|too many requests|out of extra usage|credit balance is too low/i.test(text);
let activeBudget = null;

// One evaluation process owns this ledger. Reserve in-flight CLI turns before starting:
// returned num_turns releases only unused reservations. Missing metadata fails closed.
export function createModelCallBudget({ maxClaudeTurns = 120, maxCodexCalls = 40, file, context, onStop } = {}) {
  const state = file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { claudeTurns: 0, codexCalls: 0, stopped: null, calls: [] };
  if (![maxClaudeTurns, maxCodexCalls].every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error("Invalid model budget");
  const save = () => { if (file) writeFileSync(file, JSON.stringify({ ...state, maxClaudeTurns, maxCodexCalls }, null, 2)); };
  const stop = (reason) => { state.stopped = reason; save(); onStop?.(reason); throw Object.assign(new Error(reason), { code: "MODEL_BUDGET_STOP" }); };
  // A previous process could have died with an unreported call; never assume zero turns.
  if (state.calls.some((call) => call.status === "reserved")) state.stopped ||= "Unresolved model call from previous process";
  return {
    state,
    reserve(provider, maxTurns = 1) {
      if (state.stopped) stop(state.stopped);
      if (provider === "claude" && (!Number.isSafeInteger(maxTurns) || maxTurns < 1)) stop("Invalid CLI turn reservation");
      const inFlight = state.calls.filter((call) => call.provider === "claude" && call.status === "reserved").reduce((sum, call) => sum + call.reserved, 0);
      const remaining = maxClaudeTurns - state.claudeTurns - inFlight;
      if (provider === "claude" && remaining <= 0 || provider === "codex" && state.codexCalls >= maxCodexCalls) stop(`${provider} model budget reached`);
      const call = { id: state.calls.length + 1, provider, ...context?.getStore(), reserved: provider === "claude" ? Math.min(maxTurns, remaining) : 1, status: "reserved" };
      state.calls.push(call);
      if (provider === "codex") state.codexCalls++;
      save();
      return {
        maxTurns: call.reserved,
        finish(output, error) {
          if (call.status !== "reserved") return;
          let raw;
          try { raw = provider === "claude" ? JSON.parse(output) : null; } catch {}
          const turns = raw?.num_turns;
          const known = Number.isSafeInteger(turns) && turns >= 1;
          call.status = error ? "failed" : "finished";
          if (provider === "claude") {
            call.num_turns = known ? turns : null;
            call.chargedTurns = known ? turns : call.reserved;
            state.claudeTurns += call.chargedTurns;
          }
          call.usd = raw?.total_cost_usd ?? null;
          save();
          if (quotaError(String(output) + String(error || ""))) stop(`${provider} subscription quota error`);
          if (provider === "claude" && !known) stop("Claude num_turns missing; charged full reservation");
          if (provider === "claude" && turns > call.reserved) stop("Claude exceeded --max-turns; actual num_turns recorded");
        },
      };
    },
  };
}

export function setModelCallBudget(budget) { activeBudget = budget; }

// Both product clients and evaluation judges use this at the actual request boundary.
export async function budgetedModelCall(provider, args, execute, maxTurns = 4) {
  const ticket = activeBudget?.reserve(provider, maxTurns);
  const boundedArgs = ticket && provider === "claude" ? [...args, "--max-turns", String(ticket.maxTurns)] : args;
  let result;
  try { result = await execute(boundedArgs); }
  catch (error) { ticket?.finish("", error); throw error; }
  ticket?.finish(typeof result === "string" ? result : result.stdout);
  return result;
}
