import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarBlank, ArrowLeft, ArrowRight, X } from "@phosphor-icons/react";
import { BottomSheet, KeyboardInput, useKeyboard } from "../../mobile";
import { languageTag, localized, type Language } from "../../i18n";
import { relationshipApi } from "../relationship/api";

export type ConversationSource = { channel: "me" | "us"; conversationId: string; messageId: string; date: string; personId?: string };
type HistoryMessage = { id: string; role: string; text: string; createdAt: string; actorUserId?: string; photoIds?: string[] };
type HistoryPage = { channel: "me" | "us"; conversationId: string; messageId: string; messages: HistoryMessage[]; before: string | null; after: string | null };

export function RecallLinks({ sources, language, busy, onJump }: { sources?: ConversationSource[]; language: Language; busy: boolean; onJump: (source: ConversationSource) => void }) {
  if (!sources?.length) return null;
  return <div className="recall-links">{sources.map((source) => <button type="button" key={`${source.conversationId}:${source.messageId}`} disabled={busy} onClick={() => onJump(source)} data-testid="recall-source">
    <CalendarBlank size={16} />{localized(language, "那天的对话", "Conversation that day", "Conversación de ese día")} · {source.date}
  </button>)}</div>;
}

export function useConversationRecall({ channel, sessionId, language, userId, members, photos }: { channel: "me" | "us"; sessionId?: string; language: Language; userId: string; members: Array<{ id: string; name: string }>; photos: (ids: string[]) => ReactNode }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [picker, setPicker] = useState(false);
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [highlight, setHighlight] = useState("");
  const target = useRef<HTMLElement>(null);
  const request = useRef(0);
  const close = () => { keyboard.hide(); request.current++; setPage(null); setPicker(false); setBusy(false); setError(""); setHighlight(""); };
  useEffect(() => { close(); setDate(""); }, [channel, sessionId, userId]);
  useEffect(() => () => { request.current++; }, []);
  useEffect(() => {
    if (!page) return;
    const frame = requestAnimationFrame(() => { target.current?.scrollIntoView({ block: "center" }); target.current?.focus({ preventScroll: true }); });
    const timer = window.setTimeout(() => setHighlight(""), 2400);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [page]);
  const jump = async (source?: ConversationSource, direction?: "before" | "after") => {
    keyboard.hide();
    const scope = source?.channel || page?.channel || channel;
    const id = source?.conversationId || page?.conversationId || sessionId;
    if (scope === "me" && !id) return;
    const ticket = ++request.current;
    setBusy(true); setError("");
    const params = new URLSearchParams({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
    if (source) params.set("messageId", source.messageId); else params.set("date", date);
    if (direction) params.set("direction", direction);
    if (scope === "us" && id && source) params.set("conversationId", id);
    try {
      const result = await relationshipApi<HistoryPage>(`${scope === "me" ? `/api/assistant/sessions/${encodeURIComponent(id!)}/locate` : "/api/together/locate"}?${params}`);
      if (ticket !== request.current) return;
      setPage(result); setHighlight(result.messageId); setPicker(false);
    } catch (error) {
      if (ticket !== request.current) return;
      const noMessages = !source && (error as { status?: number }).status === 404;
      setError(noMessages
        ? t("那天没有消息，试试其他日期。", "There are no messages that day. Try another date.", "No hay mensajes ese día. Prueba otra fecha.")
        : t("暂时无法打开对话，请稍后重试。", "Couldn't open the conversation. Try again in a moment.", "No se pudo abrir la conversación. Inténtalo de nuevo en un momento."));
    } finally { if (ticket === request.current) setBusy(false); }
  };
  const browse = (messageId: string, direction: "before" | "after") => { if (page) void jump({ channel: page.channel, conversationId: page.conversationId, messageId, date: "" }, direction); };
  const title = t("查找对话", "Find conversation", "Buscar conversación");
  const openPicker = () => { keyboard.hide(); setError(""); setPicker(true); };
  const closePicker = () => { keyboard.hide(); request.current++; setPicker(false); setBusy(false); setError(""); };
  const dateSheet = <BottomSheet open={picker} onOpenChange={(open) => { if (!open) closePicker(); }} title={title}
    description={channel === "us" ? t("我们俩的对话", "Your shared chat", "Su chat compartido") : t("当前私人对话", "Your current private chat", "Tu chat privado actual")} snap={0.46}>
    <form className="recall-date-picker" onSubmit={(event) => { event.preventDefault(); if (date && !busy) void jump(); }}>
      <button className="recall-picker-close" type="button" onClick={closePicker} aria-label={t("关闭", "Close", "Cerrar")}><X size={22} /></button>
      <label>{t("选择日期", "Choose a date", "Elige una fecha")}
        <KeyboardInput type="date" value={date} disabled={busy} onFocus={() => keyboard.hide()}
          onChange={(event) => { setDate(event.target.value); setError(""); }} data-testid="recall-date" />
      </label>
      {picker && error && <p className="recall-error" role="alert">{error}</p>}
      <button className="recall-date-submit" type="submit" disabled={!date || busy} data-testid="recall-date-go">
        {busy ? t("正在查找…", "Looking up…", "Buscando…") : t("查看那天的对话", "View chat from that day", "Ver el chat de ese día")}
      </button>
    </form>
  </BottomSheet>;
  const controls = <>
    {page && <div className="recall-toolbar"><span>{page.channel === "us" ? t("我们俩 · 历史对话", "Us · Earlier conversation", "Nosotros · Conversación anterior") : t("只有我 · 历史对话", "Just me · Earlier conversation", "Solo yo · Conversación anterior")}</span><button type="button" onClick={close} data-testid="recall-latest">{t("回到最新", "Back to latest", "Volver al presente")}</button></div>}
    {!picker && error && <p className="recall-error" role="alert">{error}</p>}
  </>;
  const history = page && <>
    {page.before && <button type="button" className="conversation-earlier" disabled={busy} onClick={() => browse(page.before!, "before")}><ArrowLeft size={16} />{t("更早的消息", "Earlier messages", "Mensajes anteriores")}</button>}
    {page.messages.map((message) => {
      const mine = message.role === "user" || message.actorUserId === userId;
      const agent = message.role === "assistant" || message.role === "agent";
      const author = agent ? "Pinky" : members.find((member) => member.id === message.actorUserId)?.name || t("我", "Me", "Yo");
      return <article key={message.id} ref={message.id === page.messageId ? target : undefined} tabIndex={-1} data-message-id={message.id} data-highlighted={highlight === message.id ? "true" : undefined}
        className={`conversation-message ${mine ? "from-me" : agent ? "from-agent" : "from-partner"} recall-original${highlight === message.id ? " is-highlighted" : ""}`}>
        <span>{author}</span><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString(languageTag(language), { dateStyle: "medium", timeStyle: "short" })}</time>
        {!!message.photoIds?.length && photos(message.photoIds)}{message.text && <p>{message.text}</p>}
      </article>;
    })}
    {page.after && <button type="button" className="conversation-earlier" disabled={busy} onClick={() => browse(page.after!, "after")}>{t("较新的消息", "Newer messages", "Mensajes más recientes")}<ArrowRight size={16} /></button>}
  </>;
  return { active: Boolean(page), busy, jump, close, controls, history, dateSheet, openPicker };
}
