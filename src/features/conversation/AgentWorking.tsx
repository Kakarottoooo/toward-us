import { localized, type Language } from "../../i18n";
import "./agent-working.css";

// What Pinky is doing while it prepares a reply (server/agent-activity.mjs gives the step code). Shown as a small pill under
// the couple's character and as a typing bubble in the thread (the founder, 11-03, after Meta Muse).
export type AgentActivity = { step: string; detail?: string | null } | null;

export function agentStepLabel(step: string, language: Language) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  switch (step) {
    case "searching_web": return t("正在搜索", "Searching the web", "Buscando en internet");
    case "searching_chats": return t("正在翻聊天记录", "Reading your chat history", "Revisando el historial");
    case "checking_records": return t("正在查日程和记录", "Checking your calendar and notes", "Revisando calendario y notas");
    case "mediating": return t("正在梳理两边的想法", "Weighing both sides", "Ordenando ambas partes");
    case "writing": return t("正在整理回答", "Writing the answer", "Escribiendo la respuesta");
    case "acting": return t("正在办", "Getting it done", "Haciéndolo");
    default: return t("正在想", "Thinking", "Pensando");
  }
}

function Dots() {
  return <span className="agent-dots" aria-hidden="true"><i /><i /><i /></span>;
}

/** The pill under the character: the step only, short enough to sit under it at phone width. */
export function AgentStatusPill({ activity, language }: { activity: NonNullable<AgentActivity>; language: Language }) {
  return <span className="agent-pill" data-testid="agent-pill"><Dots /><span>{agentStepLabel(activity.step, language)}</span></span>;
}

/** Pinky's typing bubble at the end of the thread; in Us it sits in Pinky's row with its avatar, like its replies. */
export function AgentTyping({ activity, language, inUs }: { activity: NonNullable<AgentActivity>; language: Language; inUs: boolean }) {
  const label = agentStepLabel(activity.step, language);
  const bubble = <article className="conversation-message from-agent agent-typing" role="status" data-testid="agent-typing">
    <span>Pinky</span><p><Dots /><span>{activity.detail ? localized(language, `${label}：${activity.detail}`, `${label}: ${activity.detail}`, `${label}: ${activity.detail}`) : label}</span></p>
  </article>;
  return inUs ? <div className="us-row from-agent"><i className="us-avatar is-pinky" aria-hidden="true">P</i>{bubble}</div> : bubble;
}
