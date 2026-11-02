import { CalendarBlank, ChatCircleDots, ClockCounterClockwise, ListChecks, PaperPlaneRight, Sparkle, UsersThree } from "@phosphor-icons/react";
import "../spaces/spaces.css";
import { useCallback, useEffect, useState } from "react";
import { languageTag, localized, type Language } from "../../i18n";
import { DecisionWorkspace } from "../decisions/DecisionWorkspace";
import { ListsPanel } from "../lists/ListsPanel";
import { MilestonesPanel } from "../milestones/MilestonesPanel";
import { PrivateAgentWorkspace } from "../private-agent/PrivateAgentWorkspace";
import { relationshipApi } from "../relationship/api";
import type { RelationshipHomePayload } from "../relationship/types";

import { MemoryWorkspace } from "../memories/MemoryWorkspace";
import { CheckinPanel } from "../checkins/CheckinPanel";
import { RemindersPanel, type ReminderTarget } from "../reminders/RemindersPanel";
import "../private-agent/personal.css";
import { PageHeader } from "../conversation/ConversationHome";

type View = "agreements" | "upcoming" | "talk" | "decide" | "plans" | "moments" | "lists" | "reminders";
const VIEWS: View[] = ["agreements", "upcoming", "talk", "decide", "plans", "moments", "lists", "reminders"];
// Older links (assistant cards, notifications) still name these views; they land on the page that now holds them.
const ALIASES: Record<string, View> = { checkins: "moments", memories: "moments", home: "agreements", notifications: "upcoming" };
type RoomSummary = { code: string; title: string; updatedAt: string; joined: boolean };

/** The shared pages the drawer opens. Each shows what Pinky has done; new things are asked for in the conversation. */
export function RelationshipHome({ user, language, rooms, notice, busy, onSetup, onJoin, onHistory, onNotice, onAccessChanged, onBack, onAsk }: { user: { id: string; name: string }; language: Language; rooms: RoomSummary[]; notice: string; busy: boolean; onSetup: () => void; onJoin: (code: string, join: boolean) => void; onHistory: () => void; onNotice: (value: string) => void; onAccessChanged: () => void; onBack: () => void; onAsk: (text: string, channel: "me" | "us") => void }) {
  const [view, setView] = useState<View>(() => { const requested = new URLSearchParams(location.search).get("view") || ""; return VIEWS.includes(requested as View) ? requested as View : ALIASES[requested] || "agreements"; }); const [parent, setParent] = useState<View | null>(null); const [payload, setPayload] = useState<RelationshipHomePayload | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [code, setCode] = useState("");
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
    talk: localized(language, "调解与复盘", "Mediation & reviews", "Mediación y revisiones"), decide: localized(language, "约定详情", "Agreement details", "Detalles del acuerdo"),
    plans: localized(language, "计划", "Plans", "Planes"), moments: localized(language, "回忆", "Moments", "Momentos"),
    lists: localized(language, "日期与清单", "Dates & lists", "Fechas y listas"), reminders: localized(language, "我的提醒", "My reminders", "Mis recordatorios"),
  };
  const back = () => { if (parent) { setView(parent); setParent(null); } else onBack(); };
  const openRow = (item: { type: string; id: string }) => () => openItem(item);
  return <div className="paper-screen relationship-shell" data-testid="dashboard-screen"><PageHeader language={language} title={titles[view]} onBack={back} />
    <main className="relationship-main">
      {view === "agreements" && <div className="home-columns page-sections"><HomeSection title={localized(language, "等你处理", "Waiting on you", "Te esperan")} empty={localized(language, "目前没有等你处理的事。", "Nothing is waiting on you right now.", "No hay nada pendiente para ti.")} items={payload.home.pending.map((item) => ({ id: item.id, onClick: openRow(item), title: item.type === "outcome_review" ? localized(language, "结果复盘已到期", "Outcome review is due", "La revisión del resultado está pendiente") : item.title, meta: relationshipLabel(language, item.type) }))} /><HomeSection title={localized(language, "正在进行", "In motion", "En marcha")} empty={localized(language, "两人都批准的约定和承诺会出现在这里。在“我们俩”里叫 Pinky 帮你们定下来。", "Agreements you both approve appear here. Ask Pinky in Us to help you settle something.", "Los acuerdos que ambos aprueben aparecerán aquí. Pídeselo a Pinky en Nosotros.")} items={payload.home.plans.map((item) => ({ id: item.id, onClick: openRow(item), title: item.title, meta: relationshipLabel(language, item.status) }))} /></div>}
      {view === "upcoming" && <div className="feature-stack"><div className="home-columns page-sections"><HomeSection title={localized(language, "我们俩的", "Ours", "Nuestro")} empty={localized(language, "纪念日和约定的期限会出现在这里。", "Shared dates and agreement deadlines appear here.", "Las fechas compartidas y los plazos de los acuerdos aparecerán aquí.")} items={payload.home.upcoming.map((item) => ({ id: item.id, onClick: openRow(item), title: item.title, meta: new Date(item.at).toLocaleDateString(languageTag(language)) }))} /></div><RemindersPanel language={language} onChanged={refresh} /></div>}
      {view === "talk" && <TalkView language={language} rooms={rooms} code={code} setCode={setCode} busy={busy} notice={notice} onSetup={onSetup} onJoin={onJoin} onHistory={onHistory} />}
      {view === "decide" && <DecisionWorkspace language={language} userId={user.id} graph={payload.graph} members={payload.relationship.members} initialIssueId={selection.issueId} initialOutcomeId={selection.outcomeId} initialPrompt={null} onChanged={refresh} />}
      {view === "decide" && <div className="lifecycle-tools"><button onClick={() => selectReminder(selection.outcomeId ? { kind: "outcome", id: selection.outcomeId } : selection.issueId ? { kind: "issue", id: selection.issueId } : { kind: "reminders" })}>{localized(language, "设置我的跟进提醒", "Set my follow-up reminder", "Configurar mi recordatorio de seguimiento")}</button></div>}
      {view === "plans" && <div className="feature-stack"><PrivateAgentWorkspace key={selectedPlan} language={language} userId={user.id} intentType="plan" threads={[...payload.graph.privateAgentThreads].sort((a, b) => Number(b.id === selectedPlan) - Number(a.id === selectedPlan))} onShared={(id) => { history.replaceState(null, "", `/?view=plans&milestone=${encodeURIComponent(id)}`); }} initialPrompt={null} onChanged={refresh} /></div>}
      {view === "lists" && <div className="feature-stack"><MilestonesPanel language={language} milestones={payload.graph.milestones} reminders={payload.graph.reminders} onRemind={(id, title) => selectReminder({ kind: "milestone", id }, title)} onChanged={refresh} /><ListsPanel language={language} lists={payload.graph.lists} items={payload.graph.listItems} onChanged={refresh} /></div>}
      {view === "moments" && <div className="feature-stack"><CheckinPanel language={language} userId={user.id} relationshipId={payload.relationship.id} onChanged={refresh} compose={false} /><MemoryWorkspace language={language} userId={user.id} relationshipId={payload.relationship.id} onChanged={refresh} compose={false} /><button className="space-ask" onClick={() => onAsk(localized(language, "帮我记下：", "Remember this for me: ", "Recuerda esto: "), "me")}><ChatCircleDots size={20} weight="fill" />{localized(language, "跟 Pinky 说", "Tell Pinky", "Díselo a Pinky")}</button></div>}
      {view === "reminders" && <RemindersPanel key={`${reminderTarget?.kind}:${reminderTarget?.id}`} language={language} initialTarget={reminderTarget} initialTitle={reminderTitle} onChanged={refresh} />}
    </main>
  </div>;
}

function TalkView({ language, rooms, code, setCode, busy, notice, onSetup, onJoin, onHistory }: { language: Language; rooms: RoomSummary[]; code: string; setCode: (value: string) => void; busy: boolean; notice: string; onSetup: () => void; onJoin: (code: string, join: boolean) => void; onHistory: () => void }) {
  return <section className="relationship-feature talk-view"><header><div><UsersThree size={24} /><h2>{localized(language, "沟通与调解", "Talk & mediate", "Hablar y mediar")}</h2></div><p>{localized(language, "原有调解、实时语音、私人反馈与共同复盘完整保留。", "Mediation, live voice, private feedback, and shared reviews remain intact.", "Se conservan la mediación, la voz en vivo, los comentarios privados y las revisiones compartidas.")}</p></header><button className="relationship-primary" onClick={onSetup}>{localized(language, "开始一次调解", "Start a mediation", "Iniciar una mediación")}</button><div className="join-relationship-room"><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} placeholder={localized(language, "六位房间码", "Six-character room code", "Código de seis caracteres")} maxLength={6} /><button data-testid="join-active-room" onClick={() => onJoin(code, true)} disabled={busy || code.length !== 6}><PaperPlaneRight size={19} /></button></div>{notice && <p role="alert" className="relationship-notice">{notice}</p>}<div className="relationship-rows">{rooms.map((room) => <article key={room.code}><div><strong>{room.title}</strong><span>{room.code}</span></div><button onClick={() => onJoin(room.code, !room.joined)}>{localized(language, "打开", "Open", "Abrir")}</button></article>)}</div><button className="text-action history-action" onClick={onHistory}><ClockCounterClockwise size={18} />{localized(language, "查看我们的复盘", "Open our reviews", "Abrir nuestras revisiones")}</button></section>;
}

function HomeSection({ title, empty, items }: { title: string; empty: string; items: Array<{ id: string; title: string; meta: string; onClick: () => void }> }) { return <section className="home-section"><h2>{title}</h2>{items.length ? items.map((item) => <article key={`${item.id}:${item.meta}`}><button onClick={item.onClick}><strong>{item.title}</strong><span>{item.meta}</span></button></article>) : <p>{empty}</p>}</section>; }
function relationshipLabel(language: Language, value: string) { const labels: Record<string, [string, string, string]> = { perspective: ["提交我的观点", "My perspective", "Mi perspectiva"], approval: ["等待我的批准", "My approval", "Mi aprobación"], outcome_review: ["结果复盘", "Outcome review", "Revisión del resultado"], active: ["进行中", "Active", "Activo"], renegotiation_requested: ["请求重新协商", "Renegotiation requested", "Renegociación solicitada"] }; const label = labels[value]; return label ? localized(language, ...label) : value; }
