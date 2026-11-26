import { screeningSource } from "./eval-moderation.mjs";
// Registered only by the evaluation runner. Production imports are unchanged.
export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  if (result.url.endsWith("/server/claude-cli-client.mjs")) {
    return { url: new URL("./codex-client.mjs", import.meta.url).href, shortCircuit: true };
  }
  return result;
}

// Content screening needs the paid key evaluations never carry: see eval-moderation.mjs.
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  const source = screeningSource(url, result.source);
  return source === null ? result : { ...result, source, shortCircuit: true };
}
