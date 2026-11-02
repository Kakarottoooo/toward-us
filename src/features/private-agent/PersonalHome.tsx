import { useCallback, useEffect, useState } from "react";
import { localized, type Language } from "../../i18n";
import { PrivateAgentWorkspace } from "./PrivateAgentWorkspace";
import { MemoryWorkspace } from "../memories/MemoryWorkspace";
import { CheckinPanel } from "../checkins/CheckinPanel";
import { RemindersPanel } from "../reminders/RemindersPanel";
import { relationshipApi } from "../relationship/api";
import type { GraphRecord } from "../relationship/types";
import { PageHeader } from "../conversation/ConversationHome";
import "./personal.css";

type View = "memories" | "reminders" | "plans";

/** The private pages the drawer opens before a partner joins. New things are asked for in the conversation. */
export function PersonalHome({ user, relationshipId, language, onShared, onBack }: { user: { id: string; name: string }; relationshipId?: string | null; language: Language; onShared: () => void; onBack: () => void }) {
  const [view] = useState<View>(() => { const requested = new URLSearchParams(location.search).get("view") || ""; return requested === "reminders" ? "reminders" : requested === "plans" ? "plans" : "memories"; });
  const [selectedPlan] = useState(() => new URLSearchParams(location.search).get("thread") || "");
  const [threads, setThreads] = useState<GraphRecord[]>([]); const [error, setError] = useState("");
  const refresh = useCallback(async () => { try { const data = await relationshipApi<{ threads: GraphRecord[] }>("/api/private-agent/threads"); setThreads(data.threads); setError(""); } catch (caught) { setError((caught as Error).message); } }, []);
  useEffect(() => { void refresh(); const focus = () => void refresh(); window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [refresh]);
  const title = view === "reminders" ? localized(language, "即将到来", "Coming up", "Próximamente") : view === "plans" ? localized(language, "计划", "Plans", "Planes") : localized(language, "回忆", "Moments", "Momentos");
  return <div className="paper-screen relationship-shell personal-shell" data-testid="personal-screen">
    <PageHeader language={language} title={title} onBack={onBack} />
    <main className="relationship-main">
      {error && <p role="alert">{error}</p>}
      {view === "plans" && <PrivateAgentWorkspace key={selectedPlan} language={language} userId={user.id} intentType="plan" threads={[...threads].sort((a, b) => Number(b.id === selectedPlan) - Number(a.id === selectedPlan))} onChanged={refresh} canShare={Boolean(relationshipId)} onShared={onShared} />}
      {view === "memories" && <div className="feature-stack"><CheckinPanel language={language} userId={user.id} relationshipId={relationshipId} /><MemoryWorkspace language={language} userId={user.id} relationshipId={relationshipId} /></div>}
      {view === "reminders" && <RemindersPanel language={language} />}
    </main>
  </div>;
}
