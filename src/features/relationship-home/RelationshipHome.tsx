import { Sparkle } from "@phosphor-icons/react";
import "../spaces/spaces.css";
import { useCallback, useEffect, useState } from "react";
import { languageTag, localized, type Language } from "../../i18n";
import { DecisionWorkspace } from "../decisions/DecisionWorkspace";
import { PrivateAgentWorkspace } from "../private-agent/PrivateAgentWorkspace";
import { relationshipApi } from "../relationship/api";
import type { RelationshipHomePayload } from "../relationship/types";

import { RemindersPanel, type ReminderTarget } from "../reminders/RemindersPanel";
import { UpcomingPage } from "../upcoming/UpcomingPage";
import { MomentsPage } from "../moments/MomentsPage";
import "../private-agent/personal.css";
import { PageHeader } from "../conversation/ConversationHome";
import { AgreementsPage } from "../agreements/AgreementsPage";

type View = "agreements" | "upcoming" | "decide" | "plans" | "moments" | "reminders";
const VIEWS: View[] = ["agreements", "upcoming", "decide", "plans", "moments", "reminders"];
// Older links (assistant cards, notifications) still name these views; they land on the page that now holds them.
const ALIASES: Record<string, View> = { checkins: "moments", memories: "moments", home: "agreements", notifications: "upcoming", lists: "upcoming" };

/** The shared pages the drawer opens. Each shows what Pinky has done; new things are asked for in the conversation. */
export function RelationshipHome({ user, language, onNotice, onAccessChanged, onBack, onAsk }: { user: { id: string; name: string }; language: Language; onNotice: (value: string) => void; onAccessChanged: () => void; onBack: () => void; onAsk: (text: string, channel: "me" | "us") => void }) {
  const [view, setView] = useState<View>(() => { const requested = new URLSearchParams(location.search).get("view") || ""; return VIEWS.includes(requested as View) ? requested as View : ALIASES[requested] || "agreements"; }); const [parent, setParent] = useState<View | null>(null); const [payload, setPayload] = useState<RelationshipHomePayload | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [selection, setSelection] = useState(() => ({ issueId: new URLSearchParams(location.search).get("issue") || undefined, outcomeId: new URLSearchParams(location.search).get("outcome") || undefined }));
  const [reminderTarget, setReminderTarget] = useState<ReminderTarget | undefined>();
  const [reminderTitle, setReminderTitle] = useState("");
  const [selectedPlan] = useState(() => new URLSearchParams(location.search).get("thread") || "");
  const go = (next: View) => { setParent(view); setView(next); };
  const selectReminder = (target: ReminderTarget, title = "") => { setReminderTarget(target); setReminderTitle(title); go("reminders"); };
  const openItem = (item: { type: string; id: string }) => {
    if (item.type === "milestone") { history.replaceState(null, "", `/?view=plans&milestone=${encodeURIComponent(item.id)}`); go("plans"); return; }
    const agreement = item.type === "commitment" ? payload?.graph.agreements.find(a => a.id === payload.graph.commitments.find(c => c.id === item.id)?.agreementId) : payload?.graph.agreements.find(a => a.id === item.id);
    setSelection({ issueId: String(agreement?.sourceIssueId || (item.type === "perspective" ? item.id : "")) || undefined, outcomeId: item.type === "outcome_review" ? item.id : undefined }); go("decide");
  };
  const refresh = useCallback(async () => { try { const result = await relationshipApi<RelationshipHomePayload>("/api/relationship/home"); if (!result?.graph || !Array.isArray(result.graph.notifications)) throw new Error(localized(language, "共同空间返回了无效数据，请重试。", "The shared space returned invalid data. Please retry.", "El espacio compartido devolvió datos no válidos. Inténtalo de nuevo.")); setPayload(result); setError(""); onNotice(""); } catch (caught) { const message = (caught as Error).message; setError(message); onNotice(message); } finally { setLoading(false); } }, [language, onNotice]);
  useEffect(() => { void refresh(); const events = new EventSource("/api/relationship/events"); events.addEventListener("relationship", () => void refresh()); events.addEventListener("access-ended", () => { events.close(); setPayload(null); onAccessChanged(); }); return () => events.close(); }, [refresh, onAccessChanged]);
  if (loading) return <div className="relationship-loading" role="status"><Sparkle size={25} /><span>{localized(language, "正在整理你们的共同空间…", "Organizing your shared space…", "Organizando su espacio compartido…")}</span></div>;
  if (!payload) return <div className="relationship-loading"><Sparkle size={25} /><p role="alert">{error}</p><button className="secondary-action" onClick={() => { setLoading(true); void refresh(); }}>{localized(language, "重新加载", "Try again", "Reintentar")}</button></div>;
  const titles: Record<View, string> = {
    agreements: localized(language, "约定", "Agreements", "Acuerdos"), upcoming: localized(language, "即将到来", "Coming up", "Próximamente"),
    decide: localized(language, "约定详情", "Agreement details", "Detalles del acuerdo"),
    plans: localized(language, "计划", "Plans", "Planes"), moments: localized(language, "回忆", "Moments", "Momentos"),
    reminders: localized(language, "我的提醒", "My reminders", "Mis recordatorios"),
  };
  const back = () => { if (parent) { setView(parent); setParent(null); } else onBack(); };
  const openRow = (item: { type: string; id: string }) => () => openItem(item);
  return <div className="paper-screen relationship-shell" data-testid="dashboard-screen"><PageHeader language={language} title={titles[view]} onBack={back} />
    <main className="relationship-main">
      {view === "agreements" && <AgreementsPage language={language} userId={user.id} payload={payload} onChanged={refresh} onReview={(id) => openItem({ type: "outcome_review", id })} />}
      {view === "upcoming" && <UpcomingPage language={language} userId={user.id} milestones={payload.graph.milestones} reminders={payload.graph.reminders} commitments={payload.graph.commitments} onOpenCommitment={(id) => openItem({ type: "commitment", id })} onAsk={(text) => onAsk(text, "us")} onChanged={refresh} />}
      {view === "decide" && <DecisionWorkspace language={language} userId={user.id} graph={payload.graph} members={payload.relationship.members} initialIssueId={selection.issueId} initialOutcomeId={selection.outcomeId} initialPrompt={null} onChanged={refresh} />}
      {view === "decide" && <div className="lifecycle-tools"><button onClick={() => selectReminder(selection.outcomeId ? { kind: "outcome", id: selection.outcomeId } : selection.issueId ? { kind: "issue", id: selection.issueId } : { kind: "reminders" })}>{localized(language, "设置我的跟进提醒", "Set my follow-up reminder", "Configurar mi recordatorio de seguimiento")}</button></div>}
      {view === "plans" && <div className="feature-stack"><PrivateAgentWorkspace key={selectedPlan} language={language} userId={user.id} intentType="plan" threads={[...payload.graph.privateAgentThreads].sort((a, b) => Number(b.id === selectedPlan) - Number(a.id === selectedPlan))} onShared={(id) => { history.replaceState(null, "", `/?view=plans&milestone=${encodeURIComponent(id)}`); }} initialPrompt={null} onChanged={refresh} /></div>}
      {view === "moments" && <MomentsPage language={language} userId={user.id} paired since={String(payload.graph.milestones.find((item) => item.type === "relationship_started" && !item.archivedAt)?.date || "") || null} onSince={async (date) => { await relationshipApi("/api/relationship/together-since", { method: "PUT", body: JSON.stringify({ date, language }) }); await refresh(); }} onAsk={onAsk} />}
      {view === "reminders" && <RemindersPanel key={`${reminderTarget?.kind}:${reminderTarget?.id}`} language={language} initialTarget={reminderTarget} initialTitle={reminderTitle} onChanged={refresh} />}
    </main>
  </div>;
}
