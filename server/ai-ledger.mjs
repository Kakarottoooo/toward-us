import { readFileSync, statSync } from "node:fs";
import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { createRelationshipRecord } from "./relationship-domain.mjs";
import { AI_LIMIT, MODEL_METHODS, currentAiUser, featureForCall, isPaidAiUser } from "./ai-budget.mjs";
import { currentAiCall, runInAiCall } from "./ai-call-context.mjs";
import { claudeResult } from "./model-call-budget.mjs";
import { MODEL_PRICES, PRICE_SOURCES, canonicalModel, estimateUsd } from "./ai-prices.mjs";

// AI cost ledger and cost controls (founder, 11-12: a cost table per user and per feature, and cost control, before the
// App Store). Every model call made by the server goes through `meteredCall` at the provider boundary (Claude CLI, Anthropic
// API, OpenAI) or `recordAiCall` (live voice minutes, Replicate video), which writes one content-free ledger row: who, which
// couple, which feature, provider, model, tokens or audio seconds, latency, outcome and the estimated USD at list price.
// `runAiFeature` wraps each feature call: it applies the global kill switch and the per-person and per-feature caps, asks for
// a cheaper model past the soft limit, and never blocks a safety or consent call. Rows are owner-only records (never shared
// with the partner, never in a snapshot or export) and are read only by the founder's internal report.

// ── The fixed feature enum. Anything else is counted as "other". ────────────────────────────────────────────────────────
export const AI_FEATURES = Object.freeze([
  "assistant_turn", "together_turn", "together_mediation", "private_agent", "perspective_summary", "decision_options", "decision_discussion",
  "web_lookup", "reply_source_check", "demo_analysis", "demo_answer", "transcription", "realtime_voice", "voice_call",
  "chat_screenshots", "chat_history_part", "chat_history_report", "photo_memory", "character_motion",
  "couple_promises", "couple_profile", "couple_game", "couple_recap", "daily_question", "daily_reaction", "composer_suggestions",
  "shared_translation", "feedback_triage", "agreement_commitments", "agreement_point", "conversation_summary", "memory_tidy",
  "people_reading", "portrait", "ludo_tasks", "pet_draw", "pet_guess", "soup_puzzle", "soup_answer", "other",
]);
const featureName = (name) => AI_FEATURES.includes(name) ? name : "other";

// ── Controls. Defaults below; AI_COST_CONFIG_FILE (JSON, re-read when it changes) overrides any part, AI_KILL_SWITCH=1 stops
// every model call except safety. Amounts are estimated USD at list price, per person, per UTC day or month. ────────────
export const AI_COST_DEFAULTS = Object.freeze({
  killSwitch: false,
  // Where soft and hard limits act. Calls on the founder's Claude subscription are only shadow-checked (logged and counted as
  // "would limit") until "subscription" is added here, so dogfood couples are never cut off by a hypothetical bill.
  enforceOn: ["metered"],
  caps: {
    free: { dailyUsd: { soft: 0.5, hard: 2 }, monthlyUsd: { soft: 6, hard: 15 } },
    paid: { dailyUsd: { soft: 1.5, hard: 5 }, monthlyUsd: { soft: 20, hard: 40 } },
  },
  // Per person per day, for one feature: past it that feature stops for the day (hard), the rest of Pinky keeps working.
  featureDailyUsd: { voice_call: 1.5, web_lookup: 0.3, chat_screenshots: 1, chat_history_part: 1, chat_history_report: 0.5, photo_memory: 0.3, character_motion: 0.3 },
  // Consent steps: drafting the summary a member confirms before anything is shared.
  exemptFeatures: ["perspective_summary"],
  anomaly: { callUsd: 0.25, userDailyUsd: 1 },
  retentionDays: 35, rollupMonths: 13, maxRows: 200_000,
});

let configCache = { at: 0, mtime: null, value: AI_COST_DEFAULTS, file: null };
const merge = (base, extra) => {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return extra === undefined ? base : extra;
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) out[key] = base?.[key] && typeof base[key] === "object" && !Array.isArray(base[key]) ? merge(base[key], value) : value;
  return out;
};
/** The controls in force: defaults, then the JSON file in AI_COST_CONFIG_FILE, then AI_KILL_SWITCH. Checked every 30 s. */
export function aiCostConfig(now = Date.now()) {
  const file = process.env.AI_COST_CONFIG_FILE || null;
  if (file !== configCache.file || now - configCache.at > 30_000) {
    let value = AI_COST_DEFAULTS, mtime = null;
    if (file) {
      try {
        mtime = statSync(file).mtimeMs;
        value = mtime === configCache.mtime && file === configCache.file ? configCache.base : merge(AI_COST_DEFAULTS, JSON.parse(readFileSync(file, "utf8")));
      } catch (error) { if (configCache.file !== file || configCache.mtime !== "error") console.error("ai_cost_config_unreadable", error?.code || error?.name || "error"); mtime = "error"; value = AI_COST_DEFAULTS; }
    }
    configCache = { at: now, mtime, file, base: value, value };
  }
  const kill = /^(1|true|on|yes)$/i.test(process.env.AI_KILL_SWITCH || "");
  return kill ? { ...configCache.value, killSwitch: true } : configCache.value;
}

// ── Friendly limit messages in the member's language. The code is the existing "today's limit" code, so every screen and
// channel that already shows that message (App, iMessage, imports, photos) shows these too. ───────────────────────────────
const LIMIT_TEXT = {
  daily: { zh: "今天 Pinky 的 AI 用量已经到上限了，明天会自动恢复。其他功能照常可用。", en: "Pinky has reached today's AI limit. It resets tomorrow; everything else keeps working.", es: "Pinky alcanzó el límite de IA de hoy. Se renueva mañana; todo lo demás sigue funcionando." },
  monthly: { zh: "这个月 Pinky 的 AI 用量已经到上限了，下个月 1 日会自动恢复。其他功能照常可用。", en: "Pinky has reached this month's AI limit. It resets on the 1st of next month; everything else keeps working.", es: "Pinky alcanzó el límite de IA de este mes. Se renueva el día 1 del próximo mes; todo lo demás sigue funcionando." },
  feature: { zh: "今天这项功能的 AI 用量已经到上限了，明天会自动恢复。Pinky 的其他功能照常可用。", en: "This feature has reached today's AI limit. It resets tomorrow; the rest of Pinky keeps working.", es: "Esta función alcanzó el límite de IA de hoy. Se renueva mañana; el resto de Pinky sigue funcionando." },
  kill_switch: { zh: "Pinky 的 AI 正在短暂维护，请稍后再试。其他功能照常可用。", en: "Pinky's AI is briefly paused for maintenance. Please try again soon; everything else keeps working.", es: "La IA de Pinky está en una breve pausa de mantenimiento. Inténtalo pronto; todo lo demás sigue funcionando." },
};
const costLimitError = (scope, language, feature) => {
  const text = LIMIT_TEXT[scope];
  return Object.assign(new Error(text[language] || text.zh), { statusCode: 429, code: AI_LIMIT, i18n: text, feature, scope, cost: true });
};

// Safety first: a request that shows self-harm, violence, threats or coercion is never capped, degraded or switched off.
const SAFETY = /自杀|自尽|轻生|不想活|活不下去|想死|结束(?:自己的)?生命|自残|割腕|伤害自己|家暴|打我|威胁我|掐我|强迫我|跟踪我|控制我|害怕(?:他|她|TA)|暴力|suicid|kill (?:myself|me)|end (?:my|it all)|self[- ]?harm|hurt(?:ing)? myself|want to die|domestic violence|abus(?:e|ive)|(?:hits|hit|beats|choked?) me|threaten|stalk|afraid of (?:him|her|them)|violen|matarme|quitarme la vida|hacerme daño|autolesi|me pega|me amenaza|maltrato|tengo miedo de (?:él|ella)/i;
export function safetySignal(args) {
  try { return SAFETY.test(JSON.stringify(args ?? null).slice(0, 40_000)); } catch { return false; }
}

// ── Ledger state: installed once per app (createApiApp). Without it (evaluations, unit tests of a client) nothing is
// recorded or capped. ───────────────────────────────────────────────────────────────────────────────────────────────────
let ledger = null;
const COLLECTION = "aiUsage";
const day = (date) => date.toISOString().slice(0, 10);
const month = (date) => date.toISOString().slice(0, 7);
const rollupId = (userId, monthKey) => `ai-cost:${userId}:${monthKey}`;
const round = (value) => Math.round(value * 1e6) / 1e6;
// Store reads are sync in the file store and async in Postgres; a failed read never stops a model call.
const attempt = async (read) => { try { return await read(); } catch { return null; } };
const spaceOf = async (store, userId) => (await attempt(() => store.getRelationshipContext(userId)))?.relationship?.id ?? null;

export function installAiLedger({ store, now = () => new Date(), log = console } = {}) {
  // Ledger writes run outside whatever store transaction the model call happened in (a call made inside a transaction must
  // not write into it after it committed), so they are bound to the context the ledger was installed in.
  ledger = store ? { store, now, log, outside: AsyncResource.bind((work) => work()), pending: new Set(), warned: new Set(), anonymous: { day: "", usd: 0, calls: 0, unknown: 0, features: {} }, lastMaintenance: 0 } : null;
  return ledger;
}
/** Waits for ledger writes in flight (tests, and before a report is read). */
export async function flushAiLedger() { while (ledger?.pending.size) await Promise.allSettled([...ledger.pending]); }

const anomaly = (kind, payload, onceKey = null) => {
  if (!ledger) return;
  if (onceKey) { if (ledger.warned.has(onceKey)) return; ledger.warned.add(onceKey); if (ledger.warned.size > 5000) ledger.warned.clear(); }
  ledger.log.warn(`ai_cost_anomaly ${JSON.stringify({ kind, ...payload })}`);
};

const channelOfProvider = (provider) => provider === "claude-cli" ? "subscription" : provider === "none" ? "none" : "metered";
/** Subscription (the founder's Claude CLI sign-in) or metered (pay-per-token keys), from a client's or mediator's model name. */
export const channelOfModel = (model) => String(model || "").startsWith("claude-cli:") ? "subscription" : "metered";

/** One ledger row, recorded in the background. The feature, person and couple come from the call being served. */
export function recordAiCall(fields) {
  if (!ledger) return null;
  const call = currentAiCall() || {}, at = ledger.now();
  const userId = fields.userId ?? call.userId ?? currentAiUser()?.userId ?? null;
  const provider = fields.provider || "none", model = canonicalModel(fields.model);
  const tokens = (key) => Math.max(0, Math.round(Number(fields[key]) || 0));
  const usage = { inputTokens: tokens("inputTokens"), outputTokens: tokens("outputTokens"), cachedInputTokens: tokens("cachedInputTokens"), cacheWriteTokens: tokens("cacheWriteTokens"), webSearches: tokens("webSearches") };
  const audioSeconds = Number.isFinite(fields.audioSeconds) ? Math.max(0, Math.round(fields.audioSeconds)) : null;
  const units = Number.isFinite(fields.units) ? fields.units : null;
  const outcome = fields.outcome || "ok";
  const { usd, price } = outcome.startsWith("blocked") ? { usd: 0, price: "none" } : estimateUsd({ model, ...usage, audioSeconds, units, reportedUsd: Number.isFinite(fields.reportedUsd) ? fields.reportedUsd : null });
  const row = {
    kind: "ai_ledger", at: at.toISOString(), utcDay: day(at), userId, spaceId: fields.spaceId ?? call.spaceId ?? null,
    feature: featureName(fields.feature ?? call.feature ?? "other"), provider, channel: fields.channel || channelOfProvider(provider), model: model || null,
    requestedModel: fields.requested ? canonicalModel(fields.requested) : null, degraded: Boolean(fields.requested && canonicalModel(fields.requested) !== model),
    exempt: call.exempt || null, wouldLimit: call.wouldLimit || null,
    ...usage, audioSeconds, units, latencyMs: Number.isFinite(fields.latencyMs) ? Math.round(fields.latencyMs) : null, outcome, estUsd: usd, price,
  };
  if (price === "unknown" && model && outcome === "ok") anomaly("unknown_price", { provider, model, feature: row.feature }, `price:${provider}:${model}`);
  if (usd !== null && usd > aiCostConfig().anomaly.callUsd) anomaly("call_cost", { userId, feature: row.feature, model, usd });
  if (!userId) { addAnonymous(row); return row; }
  const work = ledger.outside(() => persist(row)).catch((error) => ledger?.log.error("ai_ledger_write_failed", error?.code || error?.name || "error")).finally(() => ledger?.pending.delete(work));
  ledger.pending.add(work);
  return row;
}

function addAnonymous(row) {
  const bucket = ledger.anonymous;
  if (bucket.day !== row.utcDay) Object.assign(bucket, { day: row.utcDay, usd: 0, calls: 0, unknown: 0, features: {} });
  bucket.calls += 1; if (row.estUsd === null) bucket.unknown += 1; else bucket.usd = round(bucket.usd + row.estUsd);
  bucket.features[row.feature] = round((bucket.features[row.feature] || 0) + (row.estUsd || 0));
}

const emptyBucket = () => ({ usd: 0, meteredUsd: 0, calls: 0, unknown: 0, blocked: 0, features: {} });
function addToBucket(bucket, row) {
  bucket.calls += 1;
  if (row.outcome.startsWith("blocked")) bucket.blocked = (bucket.blocked || 0) + 1;
  if (row.estUsd === null) bucket.unknown += 1;
  else { bucket.usd = round(bucket.usd + row.estUsd); if (row.channel === "metered") bucket.meteredUsd = round((bucket.meteredUsd || 0) + row.estUsd); }
  const feature = bucket.features[row.feature] || { usd: 0, calls: 0, unknown: 0 };
  feature.calls += 1; if (row.estUsd === null) feature.unknown += 1; else feature.usd = round(feature.usd + row.estUsd);
  bucket.features[row.feature] = feature;
}

async function persist(row) {
  const { store } = ledger;
  if (!row.spaceId) row.spaceId = await spaceOf(store, row.userId);
  // Owner-only: no relationshipId, so the partner can never read it; the couple is kept as spaceId for the report.
  const base = { relationshipId: null, userId: row.userId, visibility: "private", aiAccessScope: "none", approvalPolicy: "owner", status: "recorded", provenanceSource: "system" };
  const monthKey = row.utcDay.slice(0, 7), id = rollupId(row.userId, monthKey);
  let dayUsd = 0;
  await store.transaction(`ai-cost:${row.userId}`, async (tx) => {
    const entry = createRelationshipRecord({ ...base, ...row }); entry.id = `ai-ledger:${randomUUID()}`;
    await tx.createRelationshipRecord(COLLECTION, entry);
    let rollup = await tx.getRelationshipRecordForUser(COLLECTION, id, row.userId);
    if (!rollup) {
      const created = createRelationshipRecord({ ...base, kind: "ai_cost_month", month: monthKey, spaceId: row.spaceId, total: emptyBucket(), days: {} });
      created.id = id; await tx.createRelationshipRecord(COLLECTION, created);
    }
    await tx.updateRelationshipRecordForUser(COLLECTION, id, row.userId, (draft) => {
      const days = { ...(draft.days || {}) }, today = structuredClone(days[row.utcDay] || emptyBucket()), total = structuredClone(draft.total || emptyBucket());
      addToBucket(today, row); addToBucket(total, row);
      days[row.utcDay] = today; draft.days = days; draft.total = total; if (row.spaceId) draft.spaceId = row.spaceId;
      dayUsd = today.usd;
    });
  });
  if (dayUsd > aiCostConfig().anomaly.userDailyUsd) anomaly("user_day_cost", { userId: row.userId, day: row.utcDay, usd: dayUsd }, `day:${row.userId}:${row.utcDay}`);
}

/** Today's and this month's estimated spend for one person, and what the caps say about the next call. */
export async function aiSpendState(store, userId, feature, now = new Date(), config = aiCostConfig()) {
  const rollup = await attempt(() => store.getRelationshipRecordForUser(COLLECTION, rollupId(userId, month(now)), userId));
  const today = rollup?.days?.[day(now)] || emptyBucket();
  const dayUsd = today.usd || 0, monthUsd = rollup?.total?.usd || 0, featureUsd = today.features?.[feature]?.usd || 0;
  const plan = (await isPaidAiUser(store, userId, now).catch(() => false)) ? "paid" : "free";
  const caps = config.caps[plan], featureCap = config.featureDailyUsd?.[feature];
  const hard = monthUsd >= caps.monthlyUsd.hard ? "monthly" : dayUsd >= caps.dailyUsd.hard ? "daily" : Number.isFinite(featureCap) && featureUsd >= featureCap ? "feature" : null;
  const soft = !hard && (monthUsd >= caps.monthlyUsd.soft || dayUsd >= caps.dailyUsd.soft);
  return { plan, dayUsd, monthUsd, featureUsd, hard, soft };
}

/**
 * Admits one feature call and runs it inside its ledger context. Throws the friendly limit error (code ai_daily_limit) when
 * the kill switch is on or a hard cap is reached on an enforced channel; past a soft cap the call runs on a cheaper model.
 * Safety and consent calls are never blocked or degraded.
 */
export async function runAiFeature({ feature, args = [], channel = "metered", userId: explicitUser, language: explicitLanguage }, work) {
  if (!ledger) return work();
  const who = currentAiUser(), userId = explicitUser ?? who?.userId ?? null;
  const language = ["zh", "en", "es"].includes(explicitLanguage) ? explicitLanguage : who?.language || "zh";
  const name = featureName(feature), config = aiCostConfig(), now = ledger.now();
  const exempt = config.exemptFeatures?.includes(name) ? "consent" : safetySignal(args) ? "safety" : null;
  const spaceId = userId ? await spaceOf(ledger.store, userId) : null;
  const call = { feature: name, userId, spaceId, channel, degrade: false, exempt, wouldLimit: null };
  const block = (scope) => {
    recordAiCall({ userId, spaceId, feature: name, channel, outcome: `blocked_${scope}` });
    throw costLimitError(scope, language, name);
  };
  if (!exempt && config.killSwitch) {
    anomaly("kill_switch", { feature: name }, `kill:${day(now)}:${now.getUTCHours()}`);
    block("kill_switch");
  }
  if (!exempt && userId) {
    const state = await aiSpendState(ledger.store, userId, name, now, config);
    const enforced = (config.enforceOn || []).includes(channel);
    if (state.hard) {
      anomaly(enforced ? "hard_limit" : "hard_limit_shadow", { userId, scope: state.hard, plan: state.plan, dayUsd: state.dayUsd, monthUsd: state.monthUsd, feature: name }, `hard:${userId}:${state.hard}:${day(now)}${state.hard === "feature" ? `:${name}` : ""}:${enforced}`);
      if (enforced) block(state.hard === "feature" ? "feature" : state.hard);
      call.wouldLimit = "hard";
    } else if (state.soft) {
      anomaly(enforced ? "soft_limit" : "soft_limit_shadow", { userId, plan: state.plan, dayUsd: state.dayUsd, monthUsd: state.monthUsd }, `soft:${userId}:${day(now)}:${enforced}`);
      if (enforced) call.degrade = true; else call.wouldLimit = "soft";
    }
  }
  return runInAiCall(call, work);
}

// ── The provider boundary. Adapters call `modelFor` to pick the model (a cheaper one past the soft limit), then run the
// request through `meteredCall`, which times it and records one row from the provider's own usage report. ─────────────────
const CHEAPER = {
  "claude-cli": () => process.env.CLAUDE_CLI_BACKGROUND_MODEL || "haiku",
  anthropic: () => process.env.ANTHROPIC_BACKGROUND_MODEL || "claude-haiku-5-5",
  openai: () => process.env.OPENAI_BACKGROUND_MODEL || "gpt-5.4-mini",
};
/** The model to use for this request: the cheaper model of the same provider when the soft limit asked for it. */
export function modelFor(provider, model) {
  return currentAiCall()?.degrade && CHEAPER[provider] ? CHEAPER[provider]() : model;
}

export async function meteredCall({ provider, model, requested = null }, execute, usageOf = () => ({})) {
  if (!ledger) return execute();
  const started = Date.now();
  const usage = (value) => { try { return usageOf(value) || {}; } catch { return {}; } };
  try {
    const result = await execute();
    const used = usage(result);
    recordAiCall({ provider, requested, ...used, model: used.model || model, latencyMs: Date.now() - started, outcome: used.outcome || "ok" });
    return result;
  } catch (error) {
    const used = error?.stdout ? usage(error.stdout) : {};
    const timeout = error?.code === "ETIMEDOUT" || /time(?:d)? ?out/i.test(String(error?.message || "")) || error?.name === "APIConnectionTimeoutError";
    recordAiCall({ provider, requested, ...used, model: used.model || model, latencyMs: Date.now() - started, outcome: timeout ? "timeout" : "error" });
    throw error;
  }
}

/** Usage from a `claude -p --output-format json` result: tokens, web searches, the model really used, its list-price USD. */
export function usageFromClaudeCli(stdout) {
  const result = claudeResult(typeof stdout === "string" ? stdout : stdout?.stdout);
  if (!result) return {};
  const usage = result.usage || {}, models = Object.entries(result.modelUsage || {});
  const main = models.sort((a, b) => (Number(b[1]?.costUSD) || 0) - (Number(a[1]?.costUSD) || 0))[0]?.[0];
  return { model: main, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cachedInputTokens: usage.cache_read_input_tokens, cacheWriteTokens: usage.cache_creation_input_tokens, webSearches: usage.server_tool_use?.web_search_requests, reportedUsd: Number.isFinite(Number(result.total_cost_usd)) && result.total_cost_usd !== null ? Number(result.total_cost_usd) : null, outcome: result.is_error ? "error" : "ok" };
}
/** Usage from an Anthropic Messages API response. */
export function usageFromAnthropic(message) {
  const usage = message?.usage || {};
  return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cachedInputTokens: usage.cache_read_input_tokens, cacheWriteTokens: usage.cache_creation_input_tokens, webSearches: usage.server_tool_use?.web_search_requests };
}
/** Usage from an OpenAI Responses API response (input_tokens includes the cached part). */
export function usageFromOpenAI(response) {
  const usage = response?.usage || {}, cached = usage.input_tokens_details?.cached_tokens || 0;
  return { inputTokens: Math.max(0, (usage.input_tokens || 0) - cached), cachedInputTokens: cached, outputTokens: usage.output_tokens };
}
/** Usage from an OpenAI transcription: tokens when reported, else the audio duration. */
export function usageFromTranscription(result) {
  const usage = result?.usage || {};
  if (usage.type === "tokens" || Number.isFinite(usage.input_tokens)) return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, audioSeconds: Number(result?.duration) || null };
  return { audioSeconds: Number(usage.seconds ?? result?.duration) || null };
}

/** The OpenAI client Pinky uses (Responses and transcription), with each request metered. */
export function meterOpenAI(client) {
  if (!client) return client;
  return {
    responses: { create(params, options) {
      const model = modelFor("openai", params.model);
      return meteredCall({ provider: "openai", model, requested: params.model }, () => client.responses.create(model === params.model ? params : { ...params, model }, options), usageFromOpenAI);
    } },
    audio: { transcriptions: { create: (params, options) => meteredCall({ provider: "openai", model: params.model }, () => client.audio.transcriptions.create(params, options), usageFromTranscription) } },
  };
}

const AUDIO_FEATURES = new Set(["transcription", "realtime_voice"]);
/** The mediator every router uses, with each feature call admitted by the cost controls and attributed in the ledger. */
export function meterMediator(mediator) {
  if (!mediator || mediator.aiReady === false) return mediator;
  const metered = { ...mediator }, textChannel = channelOfModel(mediator.model);
  for (const method of MODEL_METHODS) {
    if (typeof mediator[method] !== "function") continue;
    metered[method] = (...args) => {
      const feature = featureForCall(method, args), channel = AUDIO_FEATURES.has(feature) ? "metered" : textChannel;
      return runAiFeature({ feature, args, channel }, async () => {
        if (feature !== "realtime_voice") return mediator[method](...args);
        // The realtime session runs between the phone and OpenAI; the server only opens it, so its cost is not known here.
        const started = Date.now(), model = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
        try { const answer = await mediator[method](...args); recordAiCall({ provider: "openai", model, units: 1, latencyMs: Date.now() - started, outcome: "ok" }); return answer; }
        catch (error) { recordAiCall({ provider: "openai", model, units: 1, latencyMs: Date.now() - started, outcome: "error" }); throw error; }
      });
    };
  }
  return metered;
}

// ── Retention and the hourly summary line. ────────────────────────────────────────────────────────────────────────────
/** Deletes ledger rows past the retention window (and the oldest beyond maxRows) and monthly totals past rollupMonths. */
export async function pruneAiLedger(store, now = new Date(), config = aiCostConfig()) {
  const records = await store.listRecordsForJob(COLLECTION);
  const cutoff = new Date(now.getTime() - config.retentionDays * 86_400_000).toISOString();
  const oldestMonth = month(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (config.rollupMonths - 1), 1)));
  const rows = records.filter((record) => record.kind === "ai_ledger").sort((a, b) => a.at.localeCompare(b.at));
  const doomed = rows.filter((record) => record.at < cutoff);
  const kept = rows.length - doomed.length;
  if (kept > config.maxRows) doomed.push(...rows.filter((record) => record.at >= cutoff).slice(0, kept - config.maxRows));
  doomed.push(...records.filter((record) => record.kind === "ai_cost_month" && record.month < oldestMonth));
  for (let index = 0; index < doomed.length; index += 500) {
    await store.transaction("ai-ledger:prune", async (tx) => { for (const record of doomed.slice(index, index + 500)) await tx.deleteRelationshipRecordForUser(COLLECTION, record.id, record.ownerUserId); });
  }
  return doomed.length;
}

/** Hourly from the maintenance tick: retention, and one content-free summary line of today's spend for the logs. */
export async function runAiLedgerMaintenance(store, now = new Date()) {
  if (!ledger || now.getTime() - ledger.lastMaintenance < 3_600_000) return null;
  ledger.lastMaintenance = now.getTime();
  await flushAiLedger();
  const pruned = await pruneAiLedger(store, now);
  const report = await aiCostReport(store, { days: 1, now });
  ledger.log.log(`ai_cost_summary ${JSON.stringify({ day: day(now), pruned, totalUsd: report.window.usd, meteredUsd: report.window.meteredUsd, unknownCalls: report.window.unknownCalls, activeUsers: report.costPerActiveUser.activeUsers, users: report.perUserDay.map(({ userId, spaceId, usd, calls, unknownCalls, features }) => ({ userId, spaceId, usd, calls, unknownCalls, features })) })}`);
  return report;
}

// ── The founder's report. Content-free: ids, features, models and numbers only. ───────────────────────────────────────
const sumInto = (target, key, value) => { target[key] = round((target[key] || 0) + value); };
export async function aiCostReport(store, { days = 7, now = new Date(), top = 10 } = {}) {
  await flushAiLedger();
  const records = await store.listRecordsForJob(COLLECTION);
  const since = day(new Date(now.getTime() - (days - 1) * 86_400_000)), thisMonth = month(now);
  const previousMonth = month(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  const rollups = records.filter((record) => record.kind === "ai_cost_month");
  const perUserDay = [], users = new Map(), features = new Map();
  for (const rollup of rollups) for (const [date, bucket] of Object.entries(rollup.days || {})) {
    if (date < since || date > day(now)) continue;
    const userId = rollup.ownerUserId;
    perUserDay.push({ day: date, userId, spaceId: rollup.spaceId || null, usd: bucket.usd, meteredUsd: bucket.meteredUsd || 0, calls: bucket.calls, unknownCalls: bucket.unknown, blocked: bucket.blocked || 0, features: Object.fromEntries(Object.entries(bucket.features || {}).map(([name, value]) => [name, value.usd])) });
    const user = users.get(userId) || { userId, spaceId: rollup.spaceId || null, usd: 0, meteredUsd: 0, calls: 0, unknownCalls: 0, days: 0 };
    user.usd = round(user.usd + bucket.usd); user.meteredUsd = round(user.meteredUsd + (bucket.meteredUsd || 0)); user.calls += bucket.calls; user.unknownCalls += bucket.unknown; user.days += 1;
    users.set(userId, user);
    for (const [name, value] of Object.entries(bucket.features || {})) {
      const feature = features.get(name) || { feature: name, usd: 0, calls: 0, unknownCalls: 0, users: new Set() };
      feature.usd = round(feature.usd + value.usd); feature.calls += value.calls; feature.unknownCalls += value.unknown; feature.users.add(userId);
      features.set(name, feature);
    }
  }
  // Outcomes, latency, models and channels come from the rows themselves.
  const rows = records.filter((record) => record.kind === "ai_ledger" && record.utcDay >= since && record.utcDay <= day(now));
  const extra = new Map(), byModel = {}, byChannel = {}, outcomes = {};
  for (const row of rows) {
    const entry = extra.get(row.feature) || { errors: 0, timeouts: 0, blocked: 0, degraded: 0, wouldLimit: 0, latency: [] };
    if (row.outcome === "error") entry.errors += 1; if (row.outcome === "timeout") entry.timeouts += 1;
    if (row.outcome.startsWith("blocked")) entry.blocked += 1; if (row.degraded) entry.degraded += 1; if (row.wouldLimit) entry.wouldLimit += 1;
    if (Number.isFinite(row.latencyMs)) entry.latency.push(row.latencyMs);
    extra.set(row.feature, entry);
    sumInto(outcomes, row.outcome, 1);
    if (row.estUsd !== null) { if (row.model) sumInto(byModel, `${row.provider}:${row.model}`, row.estUsd); sumInto(byChannel, row.channel, row.estUsd); }
  }
  const median = (values) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
  const perFeature = [...features.values()].map(({ users: people, ...feature }) => {
    const more = extra.get(feature.feature) || { errors: 0, timeouts: 0, blocked: 0, degraded: 0, wouldLimit: 0, latency: [] };
    return { ...feature, users: people.size, errors: more.errors, timeouts: more.timeouts, blocked: more.blocked, degraded: more.degraded, wouldLimit: more.wouldLimit, medianLatencyMs: median(more.latency) };
  }).sort((a, b) => b.usd - a.usd || b.calls - a.calls);
  const perUserMonth = rollups.filter((rollup) => rollup.month === thisMonth || rollup.month === previousMonth)
    .map((rollup) => ({ month: rollup.month, userId: rollup.ownerUserId, spaceId: rollup.spaceId || null, usd: rollup.total?.usd || 0, meteredUsd: rollup.total?.meteredUsd || 0, calls: rollup.total?.calls || 0, unknownCalls: rollup.total?.unknown || 0 }))
    .sort((a, b) => b.month.localeCompare(a.month) || b.usd - a.usd);
  const window = [...users.values()].reduce((total, user) => ({ usd: round(total.usd + user.usd), meteredUsd: round(total.meteredUsd + user.meteredUsd), calls: total.calls + user.calls, unknownCalls: total.unknownCalls + user.unknownCalls }), { usd: 0, meteredUsd: 0, calls: 0, unknownCalls: 0 });
  const monthRows = perUserMonth.filter((row) => row.month === thisMonth && row.calls > 0);
  const monthUsd = round(monthRows.reduce((total, row) => total + row.usd, 0));
  return {
    generatedAt: now.toISOString(), days, since, until: day(now),
    note: "Estimated USD at published list prices. Subscription rows (Claude CLI) are the list-price equivalent, not a bill. Rows priced unknown are counted in unknownCalls and not in usd.",
    window, byChannel, byModel, outcomes,
    perUserDay: perUserDay.sort((a, b) => b.day.localeCompare(a.day) || b.usd - a.usd),
    perUserMonth, perFeature,
    topUsers: [...users.values()].sort((a, b) => b.usd - a.usd || b.calls - a.calls).slice(0, top),
    costPerActiveUser: {
      activeUsers: users.size, usdPerActiveUser: users.size ? round(window.usd / users.size) : 0,
      monthToDate: { month: thisMonth, activeUsers: monthRows.length, usd: monthUsd, usdPerActiveUser: monthRows.length ? round(monthUsd / monthRows.length) : 0 },
    },
    anonymousToday: ledger?.anonymous?.day === day(now) ? { ...ledger.anonymous } : null,
    controls: aiCostConfig(),
    prices: { ...PRICE_SOURCES, models: Object.keys(MODEL_PRICES) },
  };
}
