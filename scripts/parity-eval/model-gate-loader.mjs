// Evaluation process only: serialize every real transport, including background work.
export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  if (result.url.endsWith("/server/claude-cli-client.mjs") && process.env.MODEL_GATE_CHANNEL === "openai") {
    return { url: new URL("./model-gate-openai.mjs", import.meta.url).href, shortCircuit: true };
  }
  if (!result.url.endsWith("/server/cli-process.mjs")) return result;
  const source = `import { runCliProcess as native } from ${JSON.stringify(result.url + "?gate-native")};
let queue = Promise.resolve(), last = 0; const jobs = new Set();
const now = () => performance.timeOrigin + performance.now();
globalThis.modelGateDrain = async () => { while (jobs.size || last && now() - last < 21000) {
  if (jobs.size) await Promise.allSettled([...jobs]); else await new Promise(resolve => setTimeout(resolve, 100));
} };
export function runCliProcess(command, args, ...rest) {
  const changed = [...args], index = changed.indexOf('--model');
  const claude = /(?:^|[\\\\/])claude(?:\\.exe|\\.cmd)?$/i.test(command);
  if (claude && index >= 0 && changed[index + 1] !== 'haiku') changed[index + 1] = process.env.MODEL_GATE_MODEL;
  const job = queue.then(async () => { if (globalThis.modelGateStopped) throw Error('Model gate transport stopped; no retry');
    const output = await native(command, changed, ...rest);
    globalThis.modelGateTransport?.({ provider: claude ? 'claude' : 'codex', model: index >= 0 ? changed[index + 1] : null, output });
    return output;
  });
  jobs.add(job); job.then(() => {}, () => { globalThis.modelGateStopped = true; }).finally(() => { jobs.delete(job); last = now(); });
  queue = job.catch(() => {}); return job;
}`;
  return { url: "data:text/javascript," + encodeURIComponent(source), shortCircuit: true };
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!url.endsWith("/server/model-call-budget.mjs")) return result;
  const needle = "activeBudget?.reserve(provider, maxTurns)";
  if (!String(result.source).includes(needle)) throw Error("Unknown model budget boundary");
  // Native CLIs can report two internal turns for one text request. Reserve enough
  // before the call and still charge the exact returned num_turns; no post-hoc reset.
  return { ...result, source: String(result.source).replace(needle, "activeBudget?.reserve(provider, Math.max(maxTurns, 10))") };
}
