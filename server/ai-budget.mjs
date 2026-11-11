import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { createRelationshipRecord } from "./relationship-domain.mjs";
import { cachedPurchases, membershipFor } from "./membership.mjs";

// Cost guard (founder, 11-04): "普通用户不能用这么多后台模型额度，只用他需要用到的" and "不能反复调用模型，只运行必要的运行".
// Every model call is counted per person, per couple and per feature per UTC day, in the app's own store (file or Postgres).
// Calls the person waits for stop at a daily cap with a friendly message; background work stops silently, runs on a cheaper
// model, and never repeats a call whose input has not changed since it last succeeded.

// ── The knobs: tune these after measuring a few days with GET /api/internal/ai-usage. ────────────────────────────────────
// interactive: calls the person waits for (Pinky's turns, searches, voice); counted per person and per couple.
// background: work nobody waits for (promises, daily question, suggestions, recaps, triage); one pool per couple (per person
//   while unpaired). chat_import: one history import is up to ~61 calls on the cheaper model, so it has its own per-person pool.
// features: extra per-person caps for single features inside their pool. photo_memory is one call per album memory, so a big
//   album would otherwise use the whole couple pool in a day (games, translations); the rest of the album follows tomorrow.
// TEMPORARY (11-04): the free values are deliberately generous so live beta couples (all on free, AI_PAID_USERS unset) are
// never cut off mid-mediation while we measure. The founder sets the real caps after 2–3 days of /api/internal/ai-usage.
export const AI_CAPS = Object.freeze({
  free: { person: 60, couple: 100, background: 80, chatImport: 65, features: { composer_suggestions: 15, photo_memory: 24 } },
  paid: { person: 100, couple: 160, background: 120, chatImport: 200, features: { composer_suggestions: 30, photo_memory: 36 } },
});
// Signed-out calls (the public demo room) share one in-memory allowance per server per day.
export const ANONYMOUS_DAILY_CAP = 60;
// Paid = a Pinky membership (membership.mjs: one member pays, the couple is members), or an id/email listed in AI_PAID_USERS
// (comma-separated, for the founder's own accounts). A couple gets the paid couple and background caps when either is paid.
const paidList = () => new Set(String(process.env.AI_PAID_USERS || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));

// Which pool each model feature draws from. Anything unlisted counts as interactive and keeps the main model.
const FEATURES = {
  together_turn: "interactive", together_mediation: "interactive", assistant_turn: "interactive", web_lookup: "interactive",
  private_agent: "interactive", perspective_summary: "interactive", decision_options: "interactive",
  demo_analysis: "interactive", demo_answer: "interactive", transcription: "interactive", realtime_voice: "interactive",
  couple_promises: "background", couple_profile: "background", couple_game: "background", daily_question: "background", daily_reaction: "background", composer_suggestions: "background",
  ludo_tasks: "background",
  couple_recap: "background", shared_translation: "background", feedback_triage: "background", agreement_commitments: "background", photo_memory: "background", pet_draw: "background", pet_guess: "background", soup_puzzle: "background", soup_answer: "background",
  chat_history_part: "chat_import", chat_history_report: "chat_import", chat_screenshots: "chat_import",
};
export const featureKind = (feature) => FEATURES[feature] || "interactive";
/** Background work and chat-history import run on the cheaper model; what the person is waiting for keeps the main one. */
export const usesCheaperModel = (feature) => featureKind(feature) !== "interactive";

// Mediator method -> feature. `structured` calls are named by their schema name (the feature names above).
const METHODS = {
  structured: (params) => params?.name || "structured", readScreenshots: () => "chat_screenshots",
  planAssistantTurn: () => "assistant_turn", answerScreenshot: () => "assistant_turn", rewriteReply: () => "assistant_turn", lookup: () => "web_lookup", analyze: () => "demo_analysis", answer: () => "demo_answer",
  continuePrivateAgentThread: () => "private_agent", summarizePerspective: () => "perspective_summary", generateDecisionOptions: () => "decision_options",
  continueTogether: () => "together_turn", mediateTogether: () => "together_mediation", transcribe: () => "transcription", createRealtimeSession: () => "realtime_voice",
};

export const AI_LIMIT = "ai_daily_limit";
export const AI_UNCHANGED = "ai_unchanged_input";
const LIMIT_TEXT = {
  zh: "今天 Pinky 的 AI 额度已经用完了，明天会自动恢复。其他功能照常可用。",
  en: "Pinky has used up today's AI allowance. It resets tomorrow; everything else keeps working.",
  es: "Pinky ya usó la asignación de IA de hoy. Se renueva mañana; todo lo demás sigue funcionando.",
};
// Free couples hear that a membership gives more each day (Settings → Pinky 会员); members only hear when it resets.
const FREE_LIMIT_TEXT = {
  zh: "今天 Pinky 的免费额度用完了，明天会自动恢复。开通 Pinky 会员（设置里）每天可以多用一些。其他功能照常可用。",
  en: "Pinky has used up today's free allowance. It resets tomorrow, and a Pinky membership (in Settings) gives you more each day. Everything else keeps working.",
  es: "Pinky ya usó la asignación gratuita de hoy. Se renueva mañana y la membresía Pinky (en Ajustes) da más cada día. Todo lo demás sigue funcionando.",
};
export const isAiLimit = (error) => error?.code === AI_LIMIT;
const limitError = (language, feature, scope, free = false) => { const text = free ? FREE_LIMIT_TEXT : LIMIT_TEXT; return Object.assign(new Error(text[language] || text.zh), { statusCode: 429, code: AI_LIMIT, i18n: text, feature, scope, upgrade: free, background: featureKind(feature) === "background" }); };

// Who a model call is for. Set once per signed-in request (and around channel turns and import jobs), so every call made
// while serving it, including background work it starts, is counted for that person.
const context = new AsyncLocalStorage();
export const asAiUser = ({ userId, language = "zh" }, work) => context.run({ userId, language }, work);
export function aiUserMiddleware(req, _res, next) {
  if (!req.auth?.user) return next();
  const hint = req.body?.language || req.query?.language || req.auth.user.language;
  context.run({ userId: req.auth.user.id, language: ["zh", "en", "es"].includes(hint) ? hint : "zh" }, next);
}

const COLLECTION = "aiUsage";
const day = (date) => date.toISOString().slice(0, 10);
const usageId = (scope, date) => `ai-usage:${scope}:${date}`;
const inputsId = (userId) => `ai-inputs:${userId}`;
const sum = (counts, kind) => Object.entries(counts || {}).reduce((total, [feature, count]) => total + (featureKind(feature) === kind ? count : 0), 0);
const digest = (feature, args) => createHash("sha256").update(feature).update("\0").update(JSON.stringify(args ?? null)).digest("hex").slice(0, 32);
const RECENT_INPUTS = 20;

/** Counts one call for this person, or throws the "today's limit" error if a cap is reached. */
async function take(store, { userId, language }, feature, now, anonymous, caps) {
  if (!userId) {
    const key = day(now); if (anonymous.day !== key) { anonymous.day = key; anonymous.count = 0; }
    if (anonymous.count >= ANONYMOUS_DAILY_CAP) throw limitError(language, feature, "anonymous");
    anonymous.count += 1; return;
  }
  const pairing = await store.getRelationshipContext(userId);
  const relationshipId = pairing?.relationship?.id || null, members = pairing?.members?.length ? pairing.members : null;
  const paid = paidList();
  const member = (await membershipFor(store, userId, { now, purchases: await cachedPurchases(store, now) })).plan === "member";
  const isPaid = async (id, user) => member || (paid.size > 0 && (paid.has(id.toLowerCase()) || paid.has(String((user || await store.getUserById(id))?.email || "").toLowerCase())));
  const plan = caps[await isPaid(userId, members?.find((member) => member.userId === userId)?.user) ? "paid" : "free"];
  const couplePlan = members && (await Promise.all(members.map((member) => isPaid(member.userId, member.user)))).some(Boolean) ? caps.paid : plan;
  const id = usageId(relationshipId || `user-${userId}`, day(now)), kind = featureKind(feature);
  await store.transaction(`ai-usage:${id}`, async (tx) => {
    let record = await tx.getRelationshipRecordForUser(COLLECTION, id, userId);
    if (!record) {
      record = createRelationshipRecord({ relationshipId, userId, visibility: relationshipId ? "shared" : "private", aiAccessScope: "none", approvalPolicy: "owner", status: "recorded", provenanceSource: "system", day: day(now), counts: {} });
      record.id = id;
      await tx.createRelationshipRecord(COLLECTION, record);
    }
    const mine = record.counts[userId] || {}, everyone = Object.values(record.counts);
    const total = (pick) => everyone.reduce((count, counts) => count + pick(counts), 0);
    const over = kind === "interactive" ? (sum(mine, kind) >= plan.person ? "person" : relationshipId && total((counts) => sum(counts, kind)) >= couplePlan.couple ? "couple" : null)
      : kind === "background" ? (total((counts) => sum(counts, kind)) >= couplePlan.background ? "background" : null)
        : sum(mine, kind) >= plan.chatImport ? "chat_import" : null;
    if (over || (plan.features[feature] !== undefined && (mine[feature] || 0) >= plan.features[feature])) throw limitError(language, feature, over || feature, couplePlan === caps.free);
    await tx.updateRelationshipRecordForUser(COLLECTION, id, userId, (draft) => { draft.counts = { ...draft.counts, [userId]: { ...mine, [feature]: (mine[feature] || 0) + 1 } }; });
  });
}

// The last few successful background inputs per person and feature: content-free hashes in a record only its owner reads.
async function seenInput(store, userId, feature, hash) {
  const record = await store.getRelationshipRecordForUser(COLLECTION, inputsId(userId), userId);
  return Boolean(record?.inputs?.[feature]?.includes(hash));
}
async function rememberInput(store, userId, feature, hash) {
  const id = inputsId(userId);
  await store.transaction(`ai-usage:${id}`, async (tx) => {
    const record = await tx.getRelationshipRecordForUser(COLLECTION, id, userId);
    if (!record) {
      const created = createRelationshipRecord({ relationshipId: null, userId, visibility: "private", aiAccessScope: "none", approvalPolicy: "owner", status: "recorded", provenanceSource: "system", inputs: { [feature]: [hash] } });
      created.id = id; await tx.createRelationshipRecord(COLLECTION, created); return;
    }
    await tx.updateRelationshipRecordForUser(COLLECTION, id, userId, (draft) => { draft.inputs = { ...draft.inputs, [feature]: [hash, ...(draft.inputs?.[feature] || []).filter((item) => item !== hash)].slice(0, RECENT_INPUTS) }; });
  });
}

/** The mediator every router uses: same methods, each model call counted and capped, background repeats skipped. */
export function guardMediator(mediator, { store, caps = AI_CAPS, now = () => new Date() } = {}) {
  if (!mediator || mediator.aiReady === false) return mediator; // No model configured: nothing costs anything.
  const anonymous = { day: "", count: 0 };
  const guarded = { ...mediator };
  for (const [method, featureOf] of Object.entries(METHODS)) {
    if (typeof mediator[method] !== "function") continue;
    guarded[method] = async (...args) => {
      const who = context.getStore() || { userId: null, language: "zh" }, feature = featureOf(args[0]);
      // Background work only: the same input that already succeeded is not sent again.
      const hash = who.userId && featureKind(feature) === "background" ? digest(feature, args) : null;
      if (hash && await seenInput(store, who.userId, feature, hash).catch(() => false)) throw Object.assign(new Error("Unchanged input; skipped."), { code: AI_UNCHANGED, feature });
      try { await take(store, who, feature, now(), anonymous, caps); }
      catch (error) { if (isAiLimit(error)) throw error; console.error("ai_usage_count_failed", error?.code || error?.name || "error"); }
      const result = await mediator[method](...args);
      if (hash) await rememberInput(store, who.userId, feature, hash).catch((error) => console.error("ai_input_hash_failed", error?.code || error?.name || "error"));
      return result;
    };
  }
  return guarded;
}

/** Per-day, per-couple (or unpaired person) counts for the founder's ops report. Content-free. */
export async function aiUsageReport(store, { days = 3, now = new Date() } = {}) {
  const since = day(new Date(now.getTime() - (days - 1) * 86_400_000));
  return (await store.listRecordsForJob(COLLECTION)).filter((record) => record.day && record.day >= since)
    .map((record) => {
      const people = Object.entries(record.counts || {}).map(([userId, counts]) => ({ userId, total: Object.values(counts).reduce((a, b) => a + b, 0), features: counts }));
      const features = {};
      for (const person of people) for (const [feature, count] of Object.entries(person.features)) features[feature] = (features[feature] || 0) + count;
      return { day: record.day, relationshipId: record.relationshipId, total: people.reduce((a, person) => a + person.total, 0), features, people };
    })
    .sort((a, b) => b.day.localeCompare(a.day) || b.total - a.total);
}
