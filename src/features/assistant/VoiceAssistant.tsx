import { useEffect, useRef, useState } from "react";
import { ArrowRight, CaretDown, LockKey, Microphone, PaperPlaneRight, Plus, SpeakerHigh, SpeakerSlash, StopCircle } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { KeyboardTextarea, useKeyboard } from "../../mobile";
import { useRealtimeTranscription } from "../../useRealtimeTranscription";
import { jsonBody, relationshipApi } from "../relationship/api";
import "./assistant.css";

export type AssistantCard = { id: string; kind: "reminder" | "checkin" | "memory" | "plan" | "agreement" | "commitment" | "milestone"; title: string; text?: string; status: string; version: number; localDateTime?: string; timezone?: string; frequency?: string; date?: string; nextOccurrenceOnly?: boolean; weeklyTime?: string };
type Message = { id: string; role: "user" | "assistant"; text: string; createdAt: string; cards?: AssistantCard[] };
type Session = { id: string; language: Language; timezone: string; version: number; messages: Message[] };
type Response = { session: Session };
type Turn = { text: string; itemId: string; spoken: boolean };

export function VoiceAssistant({ userId, language, onChanged, onOpen }: { userId: string; language: Language; onChanged: () => Promise<void>; onOpen: (card: AssistantCard) => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(0);
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState<Turn | null>(null);
  const [unsent, setUnsent] = useState<string[]>([]);
  const [readAloud, setReadAloud] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  const creating = useRef<Promise<Session> | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const failedRef = useRef<Turn | null>(null);
  const active = useRef(true);
  const opened = useRef(false);
  const readAloudRef = useRef(true);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const keyboard = useKeyboard();
  const storageKey = `toward-us:assistant:${userId}:${language}`;
  const setCurrent = (current: Session) => { sessionRef.current = current; if (active.current) setSession(current); };
  const silence = () => { window.speechSynthesis?.cancel(); if (active.current) setSpeaking(false); };
  useEffect(() => { active.current = true; return () => { active.current = false; window.speechSynthesis?.cancel(); }; }, []);
  useEffect(() => { if (open) messagesEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [open, session?.version, pending]);

  const ensureSession = async () => {
    if (sessionRef.current) return sessionRef.current;
    if (!creating.current) creating.current = (async () => {
      let existing: string | null = null;
      try { existing = sessionStorage.getItem(storageKey); } catch { /* Session continuity also works in memory. */ }
      if (existing) {
        try {
          const result = await relationshipApi<Response>(`/api/assistant/sessions/${encodeURIComponent(existing)}`);
          setCurrent(result.session); return result.session;
        } catch { try { sessionStorage.removeItem(storageKey); } catch { /* Storage may be disabled. */ } }
      }
      const result = await relationshipApi<Response>("/api/assistant/sessions", jsonBody({ language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" }));
      setCurrent(result.session);
      try { sessionStorage.setItem(storageKey, result.session.id); } catch { /* No private content is stored in browser storage. */ }
      return result.session;
    })().finally(() => { creating.current = null; });
    return creating.current;
  };

  const say = (text: string) => {
    if (!opened.current || !active.current || !readAloudRef.current) return;
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      setNotice(t("此浏览器不能朗读，回复已显示在下方。", "Speech output is unavailable in this browser. Read the reply below.", "Este navegador no puede leer en voz alta. La respuesta aparece abajo.")); return;
    }
    silence();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = languageTag(language);
    const voice = window.speechSynthesis.getVoices().find(candidate => candidate.lang.toLowerCase().startsWith(language));
    if (voice) utterance.voice = voice;
    utterance.onstart = () => { if (active.current) setSpeaking(true); };
    utterance.onend = () => { if (active.current) setSpeaking(false); };
    utterance.onerror = (event) => { if (active.current) { setSpeaking(false); if (!["canceled", "interrupted"].includes(event.error)) setNotice(t("朗读未完成，请查看文字回复。", "Speech output did not finish. The text reply is available.", "La lectura no terminó. Puedes leer la respuesta.")); } };
    window.speechSynthesis.speak(utterance);
  };

  const enqueue = (turn: Turn): Promise<Response> => {
    setPending(count => count + 1);
    const run = queue.current.then(async () => {
      if (failedRef.current && failedRef.current.itemId !== turn.itemId) {
        if (active.current) setUnsent(previous => [...previous, turn.text]);
        throw new Error(t("上一句话尚未确认结果，请先重试，再继续。", "Resolve the previous turn with Retry before continuing.", "Reintenta el turno anterior antes de continuar."));
      }
      try {
        const current = await ensureSession();
        const result = await relationshipApi<Response>(`/api/assistant/sessions/${current.id}/${turn.spoken ? "transcripts" : "messages"}`, jsonBody({ text: turn.text, itemId: turn.itemId }));
        setCurrent(result.session);
        failedRef.current = null;
        if (active.current) { setFailed(null); setNotice(""); }
        window.dispatchEvent(new Event("toward-us:assistant-changed"));
        void onChanged().catch(() => {});
        const reply = result.session.messages.filter(message => message.role === "assistant").at(-1);
        if (turn.spoken && reply) {
          const details = (reply.cards || []).filter(card => card.status !== "unavailable" && card.kind !== "reminder").slice(0, 3).map(card => `${card.title}. ${card.text?.slice(0, 300) || ""}`).join("\n");
          say([reply.text, details].filter(Boolean).join("\n"));
        }
        return result;
      } catch (error) {
        if ([400, 403, 404, 409, 422, 429].includes((error as Error & { status?: number }).status || 0)) {
          failedRef.current = null;
          if (active.current) { setFailed(null); setDraft(turn.text); setNotice((error as Error).message); }
          throw error;
        }
        failedRef.current = turn;
        if (active.current) { setFailed(turn); setNotice((error as Error).message); }
        throw error;
      }
    });
    queue.current = run.catch(() => {});
    void run.finally(() => { if (active.current) setPending(count => count - 1); }).catch(() => {});
    return run;
  };

  const voice = useRealtimeTranscription<Response>({
    endpoint: session ? `/api/assistant/sessions/${session.id}/realtime` : "",
    speakerId: userId,
    onSpeechStarted: silence,
    onTranscript: async (text, itemId) => {
      if (/^(暂停|先停下|停止聆听|结束语音|stop listening|stop voice|pause|deja de escuchar|pausa)[。.!！]?$/i.test(text.trim())) {
        voice.stop(); silence(); return { session: await ensureSession() };
      }
      return enqueue({ text, itemId, spoken: true });
    },
    onCommitted: () => {},
    onError: message => { voice.stop(); silence(); if (active.current) setNotice(language === "zh" ? message : t("语音暂时不可用，仍可输入文字。", "Voice is temporarily unavailable. You can still type below.", "La voz no está disponible. Puedes escribir abajo.")); },
  });

  const toggleVoice = async () => {
    keyboard.hide(); silence();
    if (voice.listening || voice.connecting) { voice.stop(); return; }
    setOpening(true); setNotice("");
    try { const current = await ensureSession(); if (active.current && opened.current) await voice.start(`/api/assistant/sessions/${current.id}/realtime`); }
    catch (error) { if (active.current) setNotice((error as Error).message); }
    finally { if (active.current) setOpening(false); }
  };
  const collapse = () => { keyboard.hide(); voice.stop(); silence(); opened.current = false; setOpen(false); };
  const expand = () => { opened.current = true; setOpen(true); void ensureSession().catch(error => { if (active.current) setNotice(error.message); }); };
  const send = async () => {
    const text = draft.trim(); if (!text || pending || failed) return;
    setDraft(""); silence();
    try { await enqueue({ text, itemId: crypto.randomUUID(), spoken: false }); } catch { /* The exact request is retained for retry. */ }
  };
  const fresh = () => {
    voice.stop(); silence(); sessionRef.current = null; setSession(null); setNotice(""); setUnsent([]);
    try { sessionStorage.removeItem(storageKey); } catch { /* In-memory reset is sufficient. */ }
  };
  const openCard = (card: AssistantCard) => { collapse(); onOpen(card); };
  const kinds: Record<AssistantCard["kind"], string> = { reminder: t("私人提醒", "Private reminder", "Recordatorio privado"), checkin: t("私密日常", "Private note", "Nota privada"), memory: t("私人记忆", "Private memory", "Recuerdo privado"), plan: t("私人计划草稿", "Private plan draft", "Borrador de plan privado"), agreement: t("共同约定", "Shared agreement", "Acuerdo compartido"), commitment: t("承诺", "Commitment", "Compromiso"), milestone: t("共同日期", "Shared date", "Fecha compartida") };
  const statusLabel = (value: string) => ({ active: t("有效", "Active", "Activo"), paused: t("已暂停", "Paused", "En pausa"), archived: t("已归档", "Archived", "Archivado"), draft_ready: t("草稿，尚未分享", "Draft, not shared", "Borrador sin compartir"), completed: t("已完成", "Completed", "Completado"), pending_approval: t("等待批准", "Awaiting approval", "Pendiente de aprobación"), approved: t("已批准", "Approved", "Aprobado") })[value] || t("查看详情", "View details", "Ver detalles");

  return <section className={`voice-assistant ${open ? "is-open" : ""}`} data-testid="assistant-panel" onKeyDown={event => { if (event.key === "Escape") collapse(); }}>
    {!open ? <button className="assistant-launch" data-testid="assistant-open" onClick={expand} aria-expanded={false}>
      <Microphone size={24} /><span><strong>{t("说句话，安排、记录或查找", "Say it. Plan, save or find.", "Habla para planear, guardar o buscar")}</strong><small><LockKey size={14} />{t("你的私密助手", "Your private assistant", "Tu asistente privado")}</small></span><ArrowRight size={22} />
    </button> : <>
      <header className="assistant-heading"><div><LockKey size={20} /><h2>{t("你的私密助手", "Your private assistant", "Tu asistente privado")}</h2></div><button data-testid="assistant-collapse" aria-label={t("收起助手并关闭麦克风", "Collapse assistant and stop microphone", "Cerrar asistente y micrófono")} onClick={collapse}><CaretDown size={21} /></button></header>
      <p className="assistant-boundary">{t("这里的话只对你可见。计划先存为草稿，分享与双方批准仍需明确确认。", "Only you can see this conversation. Plans stay drafts until you explicitly share them; joint approval stays separate.", "Solo tú puedes ver esta conversación. Los planes son borradores hasta que los compartas; la aprobación conjunta sigue siendo independiente.")}</p>
      <div className="assistant-controls">
        <button className={voice.listening ? "assistant-mic listening" : "assistant-mic"} data-testid="assistant-microphone" onClick={() => void toggleVoice()} disabled={opening && !voice.connecting}>
          {voice.listening || voice.connecting ? <StopCircle size={22} /> : <Microphone size={22} />}{voice.listening ? t("结束语音", "End voice", "Terminar voz") : voice.connecting ? t("取消连接", "Cancel connection", "Cancelar conexión") : opening ? t("准备中…", "Preparing…", "Preparando…") : t("开始语音", "Start voice", "Iniciar voz")}
        </button>
        <button aria-pressed={readAloud} onClick={() => { const next = !readAloud; readAloudRef.current = next; setReadAloud(next); if (!next) silence(); }}>{readAloud ? <SpeakerHigh size={20} /> : <SpeakerSlash size={20} />}{t("朗读回复", "Spoken replies", "Respuestas en voz alta")}</button>
        {speaking && <button onClick={silence}>{t("停止朗读", "Stop speaking", "Detener lectura")}</button>}
        <button className="assistant-fresh" onClick={fresh} disabled={Boolean(pending || failed || opening)}><Plus size={18} />{t("新对话", "New conversation", "Nueva conversación")}</button>
      </div>
      <p className="assistant-listening" role="status">{voice.listening ? t("正在听。可以接着说“改到九点”，说“结束语音”即可停止。", "Listening. Keep going with “make it nine”; say “stop listening” to finish.", "Escuchando. Continúa con «mejor a las nueve»; di «deja de escuchar» para terminar.") : t("麦克风已关闭，也可以直接输入。", "Microphone is off. You can also type.", "El micrófono está apagado. También puedes escribir.")}</p>
      <div className="assistant-conversation" aria-label={t("办事对话", "Assistant conversation", "Conversación con el asistente")}>
        {!session?.messages.length && <p className="assistant-example">{t("试着说：“周五晚上八点提醒我复盘”，或“记下今天的一个好时刻”。", "Try “Remind me to reflect on Friday at eight in the evening” or “Save a good moment from today.”", "Prueba «Recuérdame reflexionar el viernes a las ocho de la noche» o «Guarda un buen momento de hoy». ")}</p>}
        {session?.messages.map(message => <article className={`assistant-message assistant-message-${message.role}`} key={message.id}>
          <span className="assistant-speaker">{message.role === "user" ? t("你", "You", "Tú") : "AI"}</span><p>{message.text}</p>
          {message.cards?.map(card => <article className="assistant-result-card" key={`${card.kind}:${card.id}`}>
            <div><span>{kinds[card.kind]}</span><span>{statusLabel(card.status)}</span></div><strong>{card.title}</strong>{card.text && <p>{card.text}</p>}
            {card.date && <p>{card.date}</p>}
            {card.localDateTime && <p>{card.localDateTime.replace("T", " ")} · {card.timezone || session.timezone}{card.frequency === "weekly" && !card.nextOccurrenceOnly ? t(" · 每周", " · Weekly", " · Semanal") : ""}</p>}
            {card.nextOccurrenceOnly && <p>{t("仅下次使用上方时间；之后恢复原来的每周安排：", "The time above is for the next occurrence only; then the original weekly schedule resumes at ", "La hora anterior es solo para la próxima vez; después se retoma el horario semanal original a las ")}{card.weeklyTime}</p>}
            {card.status !== "unavailable" && <button onClick={() => openCard(card)}>{t("打开详情", "Open details", "Abrir detalles")}<ArrowRight size={17} /></button>}
          </article>)}
        </article>)}
        {voice.partial && <p className="assistant-partial" aria-live="polite">{voice.partial.text || t("正在听…", "Listening…", "Escuchando…")}</p>}
        {pending > 0 && <p role="status">{t("正在处理你的话…", "Working on your request…", "Procesando tu solicitud…")}</p>}
        <div ref={messagesEnd} />
      </div>
      {notice && <p role="alert" className="assistant-notice">{notice}</p>}
      {failed && <div className="assistant-retry"><blockquote>{failed.text}</blockquote><p>{t("这句话的结果尚未确认。重试会使用同一请求，避免重复创建。", "This turn is not confirmed. Retry uses the same request to avoid duplicates.", "Este turno no está confirmado. Reintentar usa la misma solicitud para evitar duplicados.")}</p><button data-testid="assistant-retry" disabled={pending > 0} onClick={() => { void enqueue(failed).catch(() => {}); }}>{t("重试上一句", "Retry last turn", "Reintentar último turno")}</button></div>}
      {unsent.length > 0 && <div className="assistant-retry"><p>{t("以下话语还没有执行。上一句确认后，可点选重新发送。", "These requests were not executed. Select one to resend after resolving the previous turn.", "Estas solicitudes no se ejecutaron. Selecciona una para reenviarla después de resolver el turno anterior.")}</p>{unsent.map((text, index) => <button key={`${index}:${text}`} disabled={Boolean(failed || pending)} onClick={() => { setDraft(text); setUnsent(previous => previous.filter((_, i) => i !== index)); }}>{text}</button>)}</div>}
      <form className="assistant-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
        <KeyboardTextarea data-testid="assistant-input" aria-label={t("告诉助手要做什么", "Tell the assistant what to do", "Dile al asistente qué hacer")} value={draft} onChange={event => setDraft(event.target.value)} rows={2} maxLength={2000} placeholder={t("也可以打字，说说你想完成什么…", "You can type what you want to do…", "También puedes escribir lo que quieres hacer…")} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
        <button type="submit" data-testid="assistant-send" aria-label={t("发送给私密助手", "Send to private assistant", "Enviar al asistente privado")} disabled={!draft.trim() || pending > 0 || Boolean(failed)}><PaperPlaneRight size={22} /></button>
      </form>
    </>}
  </section>;
}
