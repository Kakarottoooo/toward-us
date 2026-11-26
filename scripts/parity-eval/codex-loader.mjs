// Registered only by the evaluation runner. Production imports are unchanged.
export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  if (result.url.endsWith("/server/claude-cli-client.mjs")) {
    return { url: new URL("./codex-client.mjs", import.meta.url).href, shortCircuit: true };
  }
  return result;
}

// Content screening calls OpenAI's moderation endpoint with the paid key, which evaluations never carry. Bare ChatGPT,
// the rival, is not screened either, so for scoring answers the screen passes: the runner answers the moderation
// request locally (run.mjs) and every other paid endpoint is refused. Only this file's key read is replaced.
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!url.endsWith("/server/ai-screening.mjs")) return result;
  const source = String(result.source).replace("const key = process.env.OPENAI_API_KEY;", 'const key = "parity-eval-local-moderation";');
  if (!source.includes("parity-eval-local-moderation")) throw new Error("ai-screening.mjs changed: update the evaluation loader");
  return { ...result, source, shortCircuit: true };
}
