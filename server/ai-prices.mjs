// Published list prices for every model Pinky calls, in one place. Only prices read on the provider's own pricing page are
// here, each with its source and the day it was checked; anything not published stays null, and a ledger row it prices is
// marked "unknown" rather than guessed. Update the numbers and `checked` together when a provider changes its prices.
//
// Units: tokens in USD per million (MTok); audio in USD per minute; units (searches, video seconds) in USD per unit.
// "subscription" channels (the founder's Claude CLI sign-in) are not billed per call: their rows carry the list-price
// equivalent so the founder sees what the same traffic would cost once it runs on pay-per-token keys.

const ANTHROPIC = "https://platform.claude.com/docs/en/about-claude/pricing.md";
const OPENAI = "https://developers.openai.com/api/docs/pricing";
const REPLICATE = "https://replicate.com/bytedance/seedance-1-lite";
const CHECKED = "2026-11-12";

export const PRICE_SOURCES = Object.freeze({ anthropic: ANTHROPIC, openai: OPENAI, replicate: REPLICATE, checked: CHECKED });

const anthropic = (input, cacheWrite, cacheRead, output, extra = {}) => ({ inputPerMTok: input, cacheWritePerMTok: cacheWrite, cacheReadPerMTok: cacheRead, outputPerMTok: output, source: ANTHROPIC, checked: CHECKED, ...extra });
const openai = (input, cachedInput, output, extra = {}) => ({ inputPerMTok: input, cacheReadPerMTok: cachedInput, cacheWritePerMTok: null, outputPerMTok: output, source: OPENAI, checked: CHECKED, ...extra });

export const MODEL_PRICES = Object.freeze({
  // Anthropic first-party API. Cache write = 5-minute TTL (the only TTL Pinky uses).
  "claude-opus-5-5": anthropic(4, 5, 0.2, 20),
  "claude-sonnet-5-5": anthropic(2, 2.5, 0.1, 10),
  // The whole prompt (cache reads and writes included) over 100K tokens is priced at the long-prompt rates.
  "claude-haiku-5-5": anthropic(0.1, 0.125, 0.01, 0.5, { longPrompt: { aboveTokens: 100_000, inputPerMTok: 0.5, cacheWritePerMTok: 0.625, cacheReadPerMTok: 0.05, outputPerMTok: 2.5 } }),
  // OpenAI, standard tier. gpt-5.4 above 272K context is priced higher.
  "gpt-5.4": openai(2.5, 0.25, 15, { longPrompt: { aboveTokens: 272_000, inputPerMTok: 5, cacheReadPerMTok: 0.5, outputPerMTok: 22.5 } }),
  "gpt-5.4-mini": openai(0.75, 0.075, 4.5),
  // Audio tokens in, text out; OpenAI also publishes about $0.006 per minute as an estimate.
  "gpt-4o-transcribe-diarize": openai(2.5, null, 10, { perAudioMinute: 0.006 }),
  // Realtime: text-token prices; audio is priced separately but the server never sees the session's token counts.
  "gpt-realtime": openai(4, 0.4, 16, { audioInputPerMTok: 32, audioOutputPerMTok: 64 }),
  "gpt-live-transcribe": { perAudioMinute: 0.017, source: OPENAI, checked: CHECKED },
  // Billed per second; backend model and tool use during the session are charged separately.
  "gpt-live-1": { perAudioMinute: 0.05, source: OPENAI, checked: CHECKED },
  // Replicate: per second of output video at 480p (the only resolution Pinky asks for).
  "bytedance/seedance-1-lite": { perUnit: 0.018, unit: "video_second", source: REPLICATE, checked: CHECKED },
});

// Server tools billed per use on top of tokens.
export const TOOL_PRICES = Object.freeze({
  anthropicWebSearch: { perUnit: 10 / 1000, unit: "search", source: ANTHROPIC, checked: CHECKED },
});

// The Claude CLI takes aliases; its JSON result names the model it really used, which wins when present.
const CLI_ALIASES = { opus: "claude-opus-5-5", sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5" };
export const canonicalModel = (model) => {
  const name = String(model || "").replace(/^(?:anthropic|claude-cli|openai):/, "").replace(/\[[^\]]*\]$/, "");
  return CLI_ALIASES[name] || name;
};

const perMillion = (tokens, price) => (tokens || 0) * price / 1_000_000;

/**
 * Estimated USD for one call, from published list prices. `reportedUsd` (the Claude CLI's own list-price total) is used
 * when present. Returns { usd, price } where price is "reported", "listed" or "unknown"; usd is null when unknown.
 */
export function estimateUsd({ model, inputTokens = 0, outputTokens = 0, cachedInputTokens = 0, cacheWriteTokens = 0, audioSeconds = null, webSearches = 0, units = null, reportedUsd = null }) {
  if (Number.isFinite(reportedUsd) && reportedUsd >= 0) return { usd: round(reportedUsd), price: "reported" };
  const table = MODEL_PRICES[canonicalModel(model)];
  if (!table) return { usd: null, price: "unknown" };
  let usd = 0, priced = false;
  const tokens = inputTokens + outputTokens + cachedInputTokens + cacheWriteTokens;
  if (tokens > 0 && table.inputPerMTok !== undefined) {
    const prompt = inputTokens + cachedInputTokens + cacheWriteTokens;
    const rate = table.longPrompt && prompt > table.longPrompt.aboveTokens ? { ...table, ...table.longPrompt } : table;
    if ([rate.inputPerMTok, rate.outputPerMTok].some((value) => value === null) || (cachedInputTokens && rate.cacheReadPerMTok === null) || (cacheWriteTokens && rate.cacheWritePerMTok == null)) return { usd: null, price: "unknown" };
    usd += perMillion(inputTokens, rate.inputPerMTok) + perMillion(outputTokens, rate.outputPerMTok) + perMillion(cachedInputTokens, rate.cacheReadPerMTok || 0) + perMillion(cacheWriteTokens, rate.cacheWritePerMTok || 0);
    priced = true;
  } else if (Number.isFinite(audioSeconds) && audioSeconds >= 0 && table.perAudioMinute) {
    usd += audioSeconds / 60 * table.perAudioMinute; priced = true;
  } else if (Number.isFinite(units) && units > 0 && table.perUnit) {
    usd += units * table.perUnit; priced = true;
  }
  if (webSearches > 0) { usd += webSearches * TOOL_PRICES.anthropicWebSearch.perUnit; priced = true; }
  return priced ? { usd: round(usd), price: "listed" } : { usd: null, price: "unknown" };
}

const round = (value) => Math.round(value * 1e6) / 1e6;
