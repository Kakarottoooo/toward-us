// Evaluation processes only. Content screening calls OpenAI's moderation endpoint with the paid key, which evaluations
// never carry; the bare-assistant rivals are not screened either. So the moderation request is answered here (nothing
// flagged) and every other call to a paid model API is refused, so an evaluation can never spend money.
export const SCREENING_KEY_LINE = "const key = process.env.OPENAI_API_KEY;";
export const SCREENING_PLACEHOLDER = 'const key = "parity-eval-local-moderation";';

/** For a module loader's load hook: give ai-screening.mjs a placeholder key; null for every other file. */
export function screeningSource(url, source) {
  if (!url.endsWith("/server/ai-screening.mjs")) return null;
  const text = String(source).replace(SCREENING_KEY_LINE, SCREENING_PLACEHOLDER);
  if (!text.includes(SCREENING_PLACEHOLDER)) throw new Error("ai-screening.mjs changed: update the evaluation loader");
  return text;
}

export function installLocalModeration() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url || input);
    if (url.startsWith("https://api.openai.com/v1/moderations")) {
      const body = JSON.parse(init?.body || "{}"), count = Array.isArray(body.input) && typeof body.input[0] === "string" ? body.input.length : 1;
      return new Response(JSON.stringify({ results: Array.from({ length: count }, () => ({ flagged: false, categories: {} })) }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.startsWith("https://api.openai.com/") || url.startsWith("https://api.anthropic.com/")) throw new Error(`Paid model API blocked in evaluation: ${url}`);
    return realFetch(input, init);
  };
}
