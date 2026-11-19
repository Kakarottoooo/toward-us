// Registered only by the evaluation runner. Production imports are unchanged.
export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  if (result.url.endsWith("/server/claude-cli-client.mjs")) {
    return { url: new URL("./codex-client.mjs", import.meta.url).href, shortCircuit: true };
  }
  return result;
}
