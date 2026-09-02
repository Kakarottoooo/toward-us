import { ArrowRight, CheckCircle, LockKey, Microphone, PaperPlaneRight, Plus, Sparkle, StopCircle } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { localized, type Language } from "../../i18n";
import { useRealtimeTranscription } from "../../useRealtimeTranscription";
import { jsonBody, relationshipApi } from "../relationship/api";
import type { GraphRecord } from "../relationship/types";

type AgentMessage = { id: string; role: "user" | "assistant"; text: string; createdAt: string };
type AgentDraft = { title?: string; shareableSummary?: string; date?: string; category?: string };
type PrivateThread = GraphRecord & { intentType: "decision" | "plan"; issueId?: string | null; sharedObjectId?: string | null; messages?: AgentMessage[]; draft?: AgentDraft; readyToShare?: boolean };

export function PrivateAgentWorkspace({ language, userId, intentType, threads, issueId, initialPrompt, onShared, onChanged }: { language: Language; userId: string; intentType: "decision" | "plan"; threads: GraphRecord[]; issueId?: string; initialPrompt?: { text: string; nonce: number } | null; onShared?: (id: string) => Promise<void> | void; onChanged: () => Promise<void> }) {
  const available = useMemo(() => (threads as PrivateThread[]).filter((item) => item.intentType === intentType && item.ownerUserId === userId), [threads, intentType, userId]);
  const [thread, setThread] = useState<PrivateThread | null>(available[0] || null); const [draft, setDraft] = useState(""); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(""); const seeded = useRef(0);
  useEffect(() => {
    if (issueId) {
      const matching = available.find((item) => item.issueId === issueId || item.sharedObjectId === issueId) || null;
      if (thread?.id !== matching?.id) setThread(matching);
      return;
    }
    if (!thread && available[0]) setThread(available[0]);
  }, [available, issueId, thread]);

  const create = async () => {
    const result = await relationshipApi<{ thread: PrivateThread }>("/api/private-agent/threads", jsonBody({ intentType, issueId: issueId || null, language }));
    setThread(result.thread); await onChanged(); return result.thread;
  };
  const sendText = async (text: string) => {
    if (!text.trim() || busy) return; setBusy(true); setNotice("");
    try {
      const current = thread || await create();
      const result = await relationshipApi<{ thread: PrivateThread }>(`/api/private-agent/threads/${current.id}/messages`, jsonBody({ text, language }));
      setThread(result.thread); setDraft(""); await onChanged();
    } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!initialPrompt?.text || seeded.current === initialPrompt.nonce) return;
    seeded.current = initialPrompt.nonce; void sendText(initialPrompt.text);
  // sendText intentionally follows the prompt event rather than each render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt?.nonce]);

  const voice = useRealtimeTranscription<{ thread: PrivateThread }>({
    endpoint: thread ? `/api/private-agent/threads/${thread.id}/realtime` : "",
    speakerId: userId,
    onCommitted: (payload) => { if (payload.thread) setThread(payload.thread); setNotice(""); void onChanged(); },
    onError: setNotice,
  });
  const toggleVoice = async () => {
    if (voice.listening) { voice.stop(); return; }
    if (!thread) { try { await create(); } catch (error) { setNotice((error as Error).message); return; } }
  };
  useEffect(() => { if (thread && !voice.listening && !voice.connecting && voiceStartRequested.current) { voiceStartRequested.current = false; void voice.start(); } }, [thread, voice]);
  const voiceStartRequested = useRef(false);
  const startVoice = async () => { if (voice.listening) return voice.stop(); if (!thread) { voiceStartRequested.current = true; await toggleVoice(); return; } await voice.start(); };

  const share = async () => {
    if (!thread || busy) return; setBusy(true); setNotice("");
    try {
      const endpoint = intentType === "decision" ? "share-decision" : "apply-plan";
      const result = await relationshipApi<{ thread: PrivateThread; issue?: GraphRecord; milestone?: GraphRecord }>(`/api/private-agent/threads/${thread.id}/${endpoint}`, jsonBody({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
      setThread(result.thread); const id = result.issue?.id || result.milestone?.id; await onChanged(); if (id) await onShared?.(id);
    } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };
  const messages = thread?.messages || []; const agentDraft = thread?.draft || {};
  return <section className={`private-agent-workspace ${intentType}`} aria-label={localized(language, "我的私人 Agent", "My private Agent", "Mi agente privado")}>
    <header className="private-agent-heading"><div><LockKey size={19} weight="fill" /><span>{localized(language, "只属于你的私密空间", "Private to you", "Privado para ti")}</span></div><p>{localized(language, "对方不会知道你在讨论什么，甚至不会知道这个话题存在，直到你亲自分享。", "Your partner cannot see the topic—or even that it exists—until you choose to share it.", "Tu pareja no verá el tema, ni siquiera que existe, hasta que decidas compartirlo.")}</p></header>
    <div className="private-agent-body">
      <aside className="private-thread-rail"><button type="button" onClick={() => { voice.stop(); setThread(null); setDraft(""); }}><Plus size={16} />{localized(language, "新的私密思考", "New private thought", "Nuevo pensamiento privado")}</button>{available.map((item) => <button type="button" key={item.id} className={thread?.id === item.id ? "active" : ""} onClick={() => { voice.stop(); setThread(item); }}><span>{String((item.draft as AgentDraft | undefined)?.title || localized(language, "未命名想法", "Untitled thought", "Pensamiento sin título"))}</span><small>{item.status === "shared" ? localized(language, "已分享", "Shared", "Compartido") : localized(language, "仅我可见", "Only me", "Solo yo")}</small></button>)}</aside>
      <div className="private-agent-conversation">
        <div className="private-agent-messages" aria-live="polite">{messages.length ? messages.map((message) => <article key={message.id} className={message.role === "assistant" ? "agent-message" : "owner-message"}><span>{message.role === "assistant" ? "AI" : localized(language, "我", "Me", "Yo")}</span><p>{message.text}</p></article>) : <div className="private-agent-empty"><Sparkle size={28} weight="fill" /><h3>{intentType === "decision" ? localized(language, "先把自己的想法讲清楚", "Think it through in private", "Piénsalo en privado") : localized(language, "直接告诉我你想安排什么", "Tell me what you want to plan", "Dime qué quieres planear")}</h3><p>{intentType === "decision" ? localized(language, "不用填写表格。像和一个可信任的人说话一样开始。", "No form. Start as if you were talking to someone you trust.", "Sin formularios. Empieza como si hablaras con alguien de confianza.") : localized(language, "日期、提醒和细节，我会从对话里替你整理。", "I’ll organize dates, reminders, and details from the conversation.", "Organizaré fechas, recordatorios y detalles a partir de la conversación.")}</p></div>}</div>
        {voice.partial && <div className="private-agent-live"><Microphone size={16} weight="fill" /><span>{voice.partial.text || localized(language, "正在听…", "Listening…", "Escuchando…")}</span></div>}
        {agentDraft.title && <aside className="agent-draft"><span>{intentType === "decision" ? localized(language, "AI 整理出的可分享观点", "Shareable view prepared by AI", "Opinión compartible preparada por la IA") : localized(language, "AI 整理出的计划", "Plan prepared by AI", "Plan preparado por la IA")}</span><strong>{agentDraft.title}</strong>{agentDraft.shareableSummary && <p>{agentDraft.shareableSummary}</p>}{agentDraft.date && <time>{agentDraft.date}</time>}{thread?.status === "shared" ? <p className="completed-line"><CheckCircle size={17} weight="fill" />{intentType === "decision" ? localized(language, "你已主动分享；现在等待对方独立思考。", "You shared it. Your partner can now think privately.", "Lo compartiste. Tu pareja ahora puede pensarlo en privado.") : localized(language, "计划已加入共同空间。", "The plan is now in your shared space.", "El plan ya está en su espacio compartido.")}</p> : <button type="button" onClick={share} disabled={busy || !thread?.readyToShare}><span>{intentType === "decision" ? localized(language, "分享给另一半，问问 TA 的意见", "Share with my partner", "Compartir con mi pareja") : localized(language, "加入我们的共同计划", "Add to our shared plans", "Añadir a nuestros planes")}</span><ArrowRight size={18} /></button>}</aside>}
        <div className="private-agent-composer"><button type="button" className={voice.listening ? "listening" : ""} onClick={() => void startVoice()} disabled={voice.connecting || busy} aria-label={voice.listening ? localized(language, "停止倾听", "Stop listening", "Dejar de escuchar") : localized(language, "用语音和 Agent 说", "Talk to Agent", "Hablar con el agente")}>{voice.listening ? <StopCircle size={22} weight="fill" /> : <Microphone size={22} weight="fill" />}</button><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={localized(language, "说说你正在想什么…", "Say what you’re thinking…", "Cuéntame qué estás pensando…")} rows={1} maxLength={2000} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendText(draft); } }} /><button type="button" onClick={() => void sendText(draft)} disabled={!draft.trim() || busy} aria-label={localized(language, "发送", "Send", "Enviar")}><PaperPlaneRight size={20} weight="fill" /></button></div>
        {notice && <p role="alert" className="relationship-notice">{notice}</p>}
      </div>
    </div>
  </section>;
}
