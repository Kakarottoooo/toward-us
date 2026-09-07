import { useCallback, useEffect, useState } from "react";
import { Bell, HandHeart, LockKey, SignOut, UserGear } from "@phosphor-icons/react";
import { languages, localized, type Language } from "../../i18n";
import { PrivateAgentWorkspace } from "./PrivateAgentWorkspace";
import { MemoryWorkspace } from "../memories/MemoryWorkspace";
import { CheckinPanel } from "../checkins/CheckinPanel";
import { RemindersPanel } from "../reminders/RemindersPanel";
import { relationshipApi } from "../relationship/api";
import type { GraphRecord } from "../relationship/types";
import "./personal.css";

export function PersonalHome({ user, relationshipId, language, onLanguage, onPair, onShared, onPrivacy, onLogout }: { user: { id: string; name: string }; relationshipId?: string | null; language: Language; onLanguage: (language: Language) => void; onPair: () => void; onShared: () => void; onPrivacy: () => void; onLogout: () => void }) {
  const [view, setView] = useState(() => new URLSearchParams(location.search).get("view") === "reminders" ? "reminders" : ["moments", "checkins"].includes(new URLSearchParams(location.search).get("view") || "") ? "memories" : "agent");
  const [threads, setThreads] = useState<GraphRecord[]>([]); const [error, setError] = useState("");
  const refresh = useCallback(async () => { try { const data = await relationshipApi<{ threads: GraphRecord[] }>("/api/private-agent/threads"); setThreads(data.threads); setError(""); } catch (caught) { setError((caught as Error).message); } }, []);
  useEffect(() => { void refresh(); const focus = () => void refresh(); window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [refresh]);
  return <div className="paper-screen relationship-shell personal-shell" data-testid="personal-screen">
    <header className="relationship-header"><div className="relationship-brand"><strong>TOWARD US</strong><span>{localized(language, "我的空间", "My space", "Mi espacio")}</span></div>
      <nav aria-label={localized(language, "个人空间导航", "Personal-space navigation", "Navegación del espacio personal")}>
        <button className={view === "agent" ? "active" : ""} onClick={() => setView("agent")}><LockKey /><span>{localized(language, "私人 Agent", "Private Agent", "Agente privado")}</span></button>
        <button className={view === "memories" ? "active" : ""} onClick={() => setView("memories")}><HandHeart /><span>{localized(language, "记忆与日常", "Memories & daily life", "Recuerdos y día a día")}</span></button>
        <button className={view === "reminders" ? "active" : ""} onClick={() => setView("reminders")}><Bell /><span>{localized(language, "提醒", "Reminders", "Recordatorios")}</span></button>
      </nav>
      <div className="relationship-header-actions"><button onClick={onPrivacy} aria-label={localized(language, "隐私与账号", "Privacy & account", "Privacidad y cuenta")}><UserGear size={21} /></button><div className="relationship-languages">{languages.map(item => <button key={item} className={item === language ? "active" : ""} onClick={() => onLanguage(item)}>{item.toUpperCase()}</button>)}</div><button onClick={onLogout} aria-label={localized(language, "退出登录", "Sign out", "Cerrar sesión")}><SignOut size={20} /></button></div>
    </header>
    <main className="relationship-main"><div className="personal-welcome"><div><p>{localized(language, "先照顾自己的想法，再走向彼此", "Room for your thoughts, before sharing", "Espacio para pensar antes de compartir")}</p><h1>{user.name}</h1></div><button className="secondary-action" onClick={relationshipId ? onShared : onPair}>{relationshipId ? localized(language, "进入共同空间", "Open shared space", "Abrir espacio compartido") : localized(language, "邀请或加入另一半", "Invite or join your partner", "Invitar o unirme a mi pareja")}</button></div>
      {error && <p role="alert">{error}</p>}
      {view === "agent" && <PrivateAgentWorkspace language={language} userId={user.id} intentType="decision" threads={threads} onChanged={refresh} canShare={Boolean(relationshipId)} onShared={onShared} />}
      {view === "memories" && <div className="feature-stack"><CheckinPanel language={language} userId={user.id} relationshipId={relationshipId} /><MemoryWorkspace language={language} userId={user.id} relationshipId={relationshipId} /></div>}
      {view === "reminders" && <RemindersPanel language={language} />}
    </main>
  </div>;
}
