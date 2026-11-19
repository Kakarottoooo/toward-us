import { AsyncLocalStorage } from "node:async_hooks";

export const AI_NOTICE_VERSION = "2026-11-18";
export const AI_PROVIDERS = ["OpenAI", "Anthropic", "Replicate"];

export function acceptedAt(settings) {
  return settings?.aiNoticeVersion === AI_NOTICE_VERSION ? settings.aiConsentAt || null : null;
}

export async function aiConsentAt(store, userId) {
  return acceptedAt(await store.getRelationshipRecordForUser("accountSettings", `account:${userId}`, userId));
}

export function demoHasPermission(room) {
  return room?.participants.length === 2 && room.participants.every((p) => p.consentAt && p.aiNoticeVersion === AI_NOTICE_VERSION);
}

const demo = new AsyncLocalStorage();
export const asDemoAi = (code, work) => demo.run(code, work);

const sharedFeatures = new Set(["together_turn", "together_mediation", "decision_discussion", "decision_options", "shared_translation", "agreement_commitments", "agreement_point", "couple_recap"]);
export async function requireAiPermission(store, userId, language = "zh", feature) {
  const code = demo.getStore();
  if (code) {
    const room = await store.getDemoRoom(code);
    if (demoHasPermission(room) && room.expiresAt > new Date().toISOString()) return;
  } else if (userId && await aiConsentAt(store, userId)) {
    if (!sharedFeatures.has(feature)) return;
    const pairing = await store.getRelationshipContext(userId);
    if (pairing?.relationship.status === "active" && pairing.members.length === 2 && await aiConsentAt(store, pairing.members.find((p) => p.userId !== userId)?.userId)) return;
  }
  const messages = { zh: "请先单独确认第三方 AI 数据处理授权。", en: "Confirm permission for third-party AI processing first.", es: "Confirma primero el permiso para procesar los datos con IA de terceros." };
  throw Object.assign(new Error(messages[language] || messages.zh), { statusCode: 403, code: "ai_consent_required" });
}
