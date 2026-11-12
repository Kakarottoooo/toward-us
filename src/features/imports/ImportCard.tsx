import { useEffect, useRef, useState } from "react";
import { ArrowClockwise, ArrowRight, ChatsCircle } from "@phosphor-icons/react";
import { counted, localized, type Language } from "../../i18n";
import { getImport, importAction, type ChatImport } from "./imports";
import "./imports.css";

/** One import inside the private conversation: picks the conversation, who is who, shows progress, then opens the analysis. */
export function ImportCard({ id, language, onOpen, onFinished }: { id: string; language: Language; onOpen: (url: string) => void; onFinished?: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [item, setItem] = useState<ChatImport | null>(null);
  const [gone, setGone] = useState(false);
  const [me, setMe] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const seen = useRef("");
  useEffect(() => {
    let alive = true, timer = 0;
    const load = async () => {
      try {
        const next = await getImport(id); if (!alive) return;
        if (seen.current === "analyzing" && next.status === "ready") onFinished?.();
        seen.current = next.status; setItem(next);
        if (next.status === "analyzing") timer = window.setTimeout(load, 3000);
      } catch { if (alive) setGone(true); }
    };
    void load();
    return () => { alive = false; clearTimeout(timer); };
  }, [id, item?.status]);
  const act = async (action: string, body: unknown) => {
    setBusy(true); setError("");
    try { const result = await importAction(id, action, body); if (result.import) setItem(result.import); } catch (caught) { setError((caught as Error).message); } finally { setBusy(false); }
  };
  if (gone) return <article className="conversation-card import-card is-gone"><header><ChatsCircle size={16} />{t("这份聊天记录已删除", "This chat history was deleted", "Este historial fue eliminado")}</header></article>;
  if (!item) return <article className="conversation-card import-card"><header><ChatsCircle size={16} />{t("聊天记录", "Chat history", "Historial de chat")}</header></article>;
  const period = item.firstAt && item.lastAt ? `${item.firstAt.slice(0, 10)} – ${item.lastAt.slice(0, 10)}` : "";
  return <article className={`conversation-card import-card is-${item.status}`} data-testid="import-card">
    <header><ChatsCircle size={16} />{item.title || t("聊天记录", "Chat history", "Historial de chat")}</header>
    {item.status === "needs_choice" && <><p>{t("哪一段是你和 TA 的对话？", "Which conversation is with your partner?", "¿Cuál es la conversación con tu pareja?")}</p>
      <div className="import-choices">{item.conversations?.slice(0, 12).map((conversation) => <button key={conversation.id} disabled={busy} onClick={() => void act("choose", { conversationId: conversation.id })}><strong>{conversation.title || conversation.participants.join(", ")}</strong><small>{t(`${conversation.count} 条`, `${counted(conversation.count, "message", "messages")}`, `${counted(conversation.count, "mensaje", "mensajes")}`)}{conversation.lastAt ? ` · ${conversation.lastAt.slice(0, 10)}` : ""}</small></button>)}</div></>}
    {item.status === "needs_people" && <><p>{me ? t(`哪个是 TA？`, "Which one is your partner?", "¿Cuál es tu pareja?") : t("哪个名字是你？", "Which name is you?", "¿Qué nombre eres tú?")}</p>
      <div className="import-choices">{item.people.filter((person) => person.name !== me).map((person) => <button key={person.name} disabled={busy} onClick={() => me ? void act("people", { me, partner: person.name }) : setMe(person.name)}><strong>{person.name}</strong><small>{t(`${person.count} 条`, `${counted(person.count, "message", "messages")}`, `${counted(person.count, "mensaje", "mensajes")}`)}</small></button>)}</div>
      {me && <button className="import-link" onClick={() => setMe("")}>{t("重新选", "Start over", "Volver a elegir")}</button>}</>}
    {item.status === "analyzing" && <><p>{t(`正在读 ${item.messageCount} 条消息`, `Reading ${counted(item.messageCount, "message", "messages")}`, `Leyendo ${counted(item.messageCount, "mensaje", "mensajes")}`)}{period && <> · <span className="import-period">{period}</span></>}</p>
      <div className="import-progress" role="progressbar" aria-valuemin={0} aria-valuemax={item.progress?.total || 1} aria-valuenow={item.progress?.done || 0}><i style={{ width: `${Math.max(4, Math.round((item.progress?.done || 0) / (item.progress?.total || 1) * 100))}%` }} /></div>
      <small>{t("读完会在这里告诉你，可以先去做别的。", "I'll tell you here when I'm done; feel free to do something else.", "Te avisaré aquí cuando termine; puedes hacer otra cosa mientras.")}</small></>}
    {item.status === "ready" && <><p>{t(`读完了 ${item.messageCount} 条消息`, `Read ${counted(item.messageCount, "message", "messages")}`, `Leí ${counted(item.messageCount, "mensaje", "mensajes")}`)}{period && <> · <span className="import-period">{period}</span></>}</p>
      <div className="card-actions"><button className="card-primary" onClick={() => onOpen(`/?view=import&import=${encodeURIComponent(item.id)}`)}>{t("查看分析", "See the analysis", "Ver el análisis")}<ArrowRight size={16} /></button></div></>}
    {item.status === "failed" && <><p>{t("这次没有读完。", "I couldn't finish reading this.", "No pude terminar de leerlo.")}</p>
      <div className="card-actions"><button disabled={busy} onClick={() => void act("retry", {})}><ArrowClockwise size={16} />{t("再试一次", "Try again", "Intentar de nuevo")}</button></div></>}
    {error && <small className="import-error" role="alert">{error}</small>}
  </article>;
}
