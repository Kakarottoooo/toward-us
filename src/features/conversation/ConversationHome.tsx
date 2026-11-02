import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, At, CalendarBlank, ChatCircleDots, CheckCircle, ClockCounterClockwise, Copy, GearSix, HandHeart, Handshake, Images, LinkSimple, List, ListBullets, ListChecks, LockKey, Microphone, NotePencil, PaperPlaneRight, SignOut, StopCircle, UserPlus, UsersThree, X } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { KeyboardTextarea, MobileScroll, useKeyboard } from "../../mobile";
import { useRealtimeTranscription } from "../../useRealtimeTranscription";
import { jsonBody, relationshipApi } from "../relationship/api";
import type { GraphRecord } from "../relationship/types";
import "./conversation.css";

type Channel = "me" | "us";
type Card = { id: string; kind: string; title: string; text?: string | null; status: string; version: number; digest?: string; url?: string; localDateTime?: string };
type SpaceSummary = { id: string; title: string; layout: string; visibility: string };
type PrivateMessage = { id: string; role: "user" | "assistant"; text: string; createdAt: string; cards?: Card[] };
type Session = { id: string; language: Language; timezone: string; version: number; messages: PrivateMessage[] };
type Ref = { type: string; id: string; version?: number; title?: string };
type SharedMessage = { id: string; role: "member" | "agent"; actorUserId: string | null; kind: "text" | "relay" | "agreement_card" | "reminder" | "review"; text: string; i18n?: Partial<Record<Language, string>>; refs: Ref[]; createdAt: string };
type Draft = { title: string; summary: string; terms: string[]; unresolvedPoints?: string[] };
type Together = { conversation: { id: string; messages: SharedMessage[]; draftAgreement: Draft | null }; pendingAgreement: (Draft & { id: string; version: number; status: string }) | null; readOnly: boolean; members: Array<{ id: string; name: string }> };
type Pairing = { status: "pending" | "active"; invitation: { code: string } | null } | null;
type ApiError = Error & { status?: number };
const AGENT_CALL = /\bpinky\b|@agent/i;
const STOP_VOICE = /^(暂停|先停下|停止聆听|结束语音|stop listening|stop voice|pause|deja de escuchar|pausa)[。.!！]?$/i;

/** The App's default screen: one private channel ("Just me", the member's assistant session) and one shared channel ("Us",
 * the couple's together conversation). Every rule lives on the server; this screen only renders and forwards explicit taps. */
export function ConversationHome({ user, pairing, language, onOpen, onPrivacy, onLogout, onPair, onRefreshPairing, onAccessChanged }: { user: { id: string; name: string }; pairing: Pairing; language: Language; onPrivacy: () => void; onLogout: () => void; onOpen: (url: string) => void; onPair: () => void; onRefreshPairing: () => Promise<void>; onAccessChanged: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const paired = pairing?.status === "active";
  const channelKey = `toward-us:conversation-channel:${user.id}`, sessionKey = `toward-us:conversation-session:${user.id}`;
  const [channel, setChannel] = useState<Channel>(() => { try { return new URLSearchParams(location.search).get("channel") === "us" || localStorage.getItem(channelKey) === "us" ? "us" : "me"; } catch { return "me"; } });
  const [session, setSession] = useState<Session | null>(null);
  const [together, setTogether] = useState<Together | null>(null);
  const [approved, setApproved] = useState<string[]>([]);
  // A page can hand a starting sentence back ("Add to …: "); it lands in that channel's box once, then leaves the URL.
  const [drafts, setDrafts] = useState<Record<Channel, string>>(() => { const params = new URLSearchParams(location.search); const say = (params.get("say") || "").slice(0, 300); return { me: params.get("channel") !== "us" ? say : "", us: params.get("channel") === "us" ? say : "" }; });
  const [askAgent, setAskAgent] = useState(false);
  const [revising, setRevising] = useState(false);
  const [pending, setPending] = useState<Record<Channel, number>>({ me: 0, us: 0 });
  const [queued, setQueued] = useState<Array<{ text: string; itemId: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ text: string; itemId: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  const creating = useRef<Promise<Session> | null>(null);
  const restoring = useRef<Promise<Session | null> | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const keyboard = useKeyboard();
  const accessChanged = useRef(onAccessChanged); accessChanged.current = onAccessChanged;
  const draft = drafts[channel];
  const setDraft = (value: string | ((current: string) => string), target: Channel = channel) => setDrafts((current) => ({ ...current, [target]: typeof value === "function" ? value(current[target]) : value }));
  const errorText = (error: ApiError) => error.status === 429 ? t("已达到使用上限，请稍后再试。", "A usage limit was reached. Try again later.", "Se alcanzó un límite de uso. Inténtalo más tarde.") : error.status === 503 ? t("助手暂时不可用，什么都没有改动。请稍后重试。", "The assistant is unavailable right now. Nothing was changed; try again soon.", "El asistente no está disponible. No se cambió nada; inténtalo pronto.") : error.message;

  const store = (id: string | null) => { try { if (id) localStorage.setItem(sessionKey, id); else localStorage.removeItem(sessionKey); } catch { /* The session still works in memory. */ } };
  const current = (next: Session) => { sessionRef.current = next; setSession(next); };
  // One assistant session per member for this channel: reopen the remembered one, otherwise create it once.
  const restore = async () => {
    let id: string | null = null; try { id = localStorage.getItem(sessionKey); } catch { /* No stored session. */ }
    if (!id) return null;
    try { const result = await relationshipApi<{ session: Session }>(`/api/assistant/sessions/${encodeURIComponent(id)}`); current(result.session); return result.session; } catch { store(null); return null; }
  };
  const create = async () => { const result = await relationshipApi<{ session: Session }>("/api/assistant/sessions", jsonBody({ language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" })); current(result.session); store(result.session.id); return result.session; };
  const ensureSession = async (allowCreate = true): Promise<Session | null> => {
    if (sessionRef.current) return sessionRef.current;
    const restored = await (restoring.current ||= restore().finally(() => { restoring.current = null; }));
    if (restored || !allowCreate) return restored;
    return creating.current ||= create().finally(() => { creating.current = null; });
  };

  const loadTogether = useCallback(async () => {
    if (!paired) return;
    try {
      const result = await relationshipApi<Together>(`/api/together?language=${language}`); setTogether(result);
      if (result.pendingAgreement) {
        const home = await relationshipApi<{ graph: { approvals: GraphRecord[] } }>("/api/relationship/home");
        setApproved(home.graph.approvals.filter((item) => item.ownerUserId === user.id && !item.withdrawnAt).map((item) => `${item.agreementId}:${item.approvedVersion}`));
      }
    } catch (error) { setNotice(errorText(error as ApiError)); }
  }, [paired, language, user.id]);

  useEffect(() => { void ensureSession(false).catch(() => {}); }, [user.id]);
  useEffect(() => { void loadTogether(); }, [loadTogether]);
  useEffect(() => {
    if (!paired) return;
    const events = new EventSource("/api/relationship/events");
    events.addEventListener("relationship", (event) => { try { const { eventType } = JSON.parse((event as MessageEvent).data); if (/^(together|agreement)/.test(eventType)) void loadTogether(); } catch { /* Ignore malformed events. */ } });
    events.addEventListener("access-ended", () => { events.close(); accessChanged.current(); });
    return () => events.close();
  }, [paired, loadTogether]);
  useEffect(() => { setNotice(""); }, [language]);
  useEffect(() => { if (new URLSearchParams(location.search).has("say")) { window.history.replaceState(null, "", location.pathname); composerRef.current?.querySelector("textarea")?.focus(); } }, []);
  useEffect(() => { try { localStorage.setItem(channelKey, channel); } catch { /* Channel memory is a convenience. */ } }, [channel, channelKey]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [channel, session?.version, together?.conversation.messages.length, pending.me, queued.length]);

  const say = (text: string) => {
    if (!("speechSynthesis" in window) || !text) return;
    window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = languageTag(language); window.speechSynthesis.speak(utterance);
  };
  // Turns run strictly in order per channel, typed and spoken alike (one queue per channel): the server rejects a turn that
  // races the previous one, so a second utterance waits for the first answer instead of failing with a version conflict.
  const queues = useRef<Record<Channel, Promise<unknown>>>({ me: Promise.resolve(), us: Promise.resolve() });
  const failedRef = useRef<{ text: string; itemId: string } | null>(null);
  const keep = (text: string, target: Channel) => setDraft((value) => value ? `${value}
${text}` : text, target);
  const enqueue = <T,>(target: Channel, run: () => Promise<T>): Promise<T> => {
    setPending((count) => ({ ...count, [target]: count[target] + 1 }));
    const next = queues.current[target].then(run);
    queues.current[target] = next.catch(() => {});
    void next.finally(() => setPending((count) => ({ ...count, [target]: count[target] - 1 }))).catch(() => {});
    return next;
  };
  // Failures resolve to null with their real error shown, so a failed turn never stops live voice.
  const sendPrivate = (text: string, itemId: string, spoken = false) => {
    setNotice(""); setQueued((items) => [...items.filter((item) => item.itemId !== itemId), { text, itemId }]);
    return enqueue("me", async () => {
      try {
        if (failedRef.current && failedRef.current.itemId !== itemId) { keep(text, "me"); setNotice(t("上一句还没确认送达，请先重试它。", "The previous message was not confirmed. Retry it first.", "El mensaje anterior no se confirmó. Reinténtalo primero.")); return null; }
        const active = await ensureSession();
        const result = await relationshipApi<{ session: Session }>(`/api/assistant/sessions/${active!.id}/${spoken ? "transcripts" : "messages"}`, jsonBody({ text, itemId }));
        current(result.session); failedRef.current = null; setFailed(null); setRevising(false);
        window.dispatchEvent(new Event("toward-us:assistant-changed"));
        if (spoken) say(result.session.messages.filter((message) => message.role === "assistant").at(-1)?.text || "");
        return result;
      } catch (error) {
        const status = (error as ApiError).status;
        if (!status || status >= 500 && status !== 503) { failedRef.current = { text, itemId }; setFailed(failedRef.current); } else keep(text, "me");
        setNotice(errorText(error as ApiError)); return null;
      } finally { setQueued((items) => items.filter((item) => item.itemId !== itemId)); }
    });
  };
  // Sending the same text again after a failure reuses its itemId, so a retry can never post the message twice.
  const failedSharedRef = useRef<{ text: string; body: string; itemId: string } | null>(null);
  const sendShared = (text: string) => {
    const retry = failedSharedRef.current?.text === text ? failedSharedRef.current : null;
    const body = retry ? retry.body : askAgent && !AGENT_CALL.test(text) ? `@Agent ${text}` : text, itemId = retry ? retry.itemId : crypto.randomUUID();
    setNotice(""); setAskAgent(false);
    return enqueue("us", async () => {
      try { await relationshipApi("/api/together/messages", jsonBody({ text: body, itemId, language })); failedSharedRef.current = null; await loadTogether(); }
      catch (error) { failedSharedRef.current = { text, body, itemId }; keep(text, "us"); setNotice(errorText(error as ApiError)); }
    });
  };
  const send = () => {
    const text = draft.trim(); if (!text) return;
    setDraft("");
    if (channel === "me") void sendPrivate(text, crypto.randomUUID()); else void sendShared(text);
  };

  const channelRef = useRef(channel); channelRef.current = channel;
  const voice = useRealtimeTranscription<unknown>({
    endpoint: session ? `/api/assistant/sessions/${session.id}/realtime` : "", speakerId: user.id,
    onSpeechStarted: () => window.speechSynthesis?.cancel(),
    onTranscript: async (text, itemId) => {
      if (STOP_VOICE.test(text.trim())) { voice.stop(); return null; }
      // In "Us" speech only fills the box: nothing reaches the partner until the member taps send.
      if (channelRef.current === "us") { setDraft((value) => value ? `${value} ${text}` : text, "us"); return null; }
      return sendPrivate(text, itemId, true);
    },
    onCommitted: () => {},
    onError: (message) => { voice.stop(); setNotice(t(message, "Voice is unavailable right now. You can still type.", "La voz no está disponible ahora. Puedes seguir escribiendo.")); },
  });
  const toggleVoice = async () => {
    keyboard.hide(); window.speechSynthesis?.cancel();
    if (voice.listening || voice.connecting) { voice.stop(); return; }
    setNotice("");
    try { const active = await ensureSession(); await voice.start(`/api/assistant/sessions/${active!.id}/realtime`); } catch (error) { setNotice(errorText(error as ApiError)); }
  };
  const switchChannel = (next: Channel) => { if (next === channel) return; keyboard.hide(); voice.stop(); setNotice(""); setRevising(false); setChannel(next); };
  // The drawer is modal navigation: dismiss the keyboard and voice before it covers the conversation.
  const openDrawer = () => { keyboard.hide(); voice.stop(); setDrawer(true); };
  const open = (url: string) => { keyboard.hide(); voice.stop(); onOpen(url); };

  const share = async (card: Card) => {
    if (!session) return; setBusy(true); setNotice("");
    try { const result = await relationshipApi<{ session: Session }>(`/api/assistant/sessions/${session.id}/share-confirm`, jsonBody({ cardId: card.id, digest: card.digest, confirm: true })); current(result.session); void loadTogether(); }
    catch (error) { setNotice(errorText(error as ApiError)); } finally { setBusy(false); }
  };
  const confirmSpace = async (card: Card) => {
    if (!session) return; setBusy(true); setNotice("");
    try { const result = await relationshipApi<{ session: Session }>(`/api/assistant/sessions/${session.id}/space-confirm`, jsonBody({ cardId: card.id, digest: card.digest })); current(result.session); }
    catch (error) { setNotice(errorText(error as ApiError)); } finally { setBusy(false); }
  };
  const revise = () => { setRevising(true); composerRef.current?.querySelector("textarea")?.focus(); };
  const decide = async (id: string, version: number, action: "approve" | "request-change") => {
    setBusy(true); setNotice("");
    try { await relationshipApi(`/api/together/agreements/${id}/${action}`, jsonBody({ version, language })); if (action === "approve") setApproved((items) => [...items, `${id}:${version}`]); await loadTogether(); }
    catch (error) { setNotice(errorText(error as ApiError)); await loadTogether(); } finally { setBusy(false); }
  };
  const draftAgreement = async () => {
    setBusy(true); setNotice("");
    try { await relationshipApi("/api/together/agreements/draft", jsonBody({ language })); await loadTogether(); }
    catch (error) { setNotice(errorText(error as ApiError)); } finally { setBusy(false); }
  };
  const createInvite = async () => {
    setBusy(true); setNotice("");
    try { await relationshipApi("/api/partner/invitations", jsonBody({})); await onRefreshPairing(); } catch (error) { setNotice(errorText(error as ApiError)); } finally { setBusy(false); }
  };
  const inviteUrl = pairing?.invitation ? `${location.origin}${location.pathname}?invite=${pairing.invitation.code}` : "";
  const copyInvite = async () => { try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setNotice(inviteUrl); } };

  const partnerName = together?.members.find((member) => member.id !== user.id)?.name || t("TA", "Your partner", "Tu pareja");
  const pendingAgreement = together?.pendingAgreement;
  const readOnly = channel === "us" && (!paired || Boolean(together?.readOnly));
  const placeholder = channel === "me" ? revising ? t("说说想怎么改…", "Tell me what to change…", "Dime qué cambiar…") : t("跟我说说…", "Talk to me…", "Cuéntame…") : askAgent ? t("问 Agent…", "Ask the Agent…", "Pregunta al Agent…") : t("发给你们俩…", "Message both of you…", "Escribe a los dos…");

  const privateCard = (card: Card) => {
    if (card.kind === "partner_message") return <article key={card.id} className={`conversation-card partner-card is-${card.status}`} data-testid="partner-message-card">
      <header><LockKey size={16} />{t("想对 TA 说的话", "For your partner", "Para tu pareja")}</header><p>{card.text}</p>
      {card.status === "draft" ? <><small>{t("确认之前不会分享，你的原话也不会。", "Nothing is shared until you confirm, and your own words never are.", "No se comparte nada hasta que lo confirmes, y tus palabras originales nunca.")}</small><div className="card-actions">
        {paired ? <button className="card-primary" disabled={busy} onClick={() => void share(card)}><PaperPlaneRight size={18} weight="fill" />{t("发送给 TA", "Send to partner", "Enviar a mi pareja")}</button> : <button className="card-primary" onClick={() => switchChannel("us")}><UsersThree size={18} />{t("先邀请 TA", "Invite your partner first", "Invita primero a tu pareja")}</button>}
        <button disabled={busy} onClick={revise}>{t("再改改", "Edit", "Editar")}</button></div></> :
        <small className="card-state">{card.status === "shared" ? <><CheckCircle size={16} weight="fill" />{t("已发到“我们俩”", "Sent to Us", "Enviado a Nosotros")}</> : t("已有更新的版本", "A newer version replaced this", "Una versión más nueva la reemplazó")}</small>}
    </article>;
    if (card.kind === "space_share") return <article key={card.id} className={`conversation-card partner-card is-${card.status}`} data-testid="space-share-card">
      <header><UsersThree size={16} />{t(`放进共同的“${card.title}”`, `Add to shared "${card.title}"`, `Añadir a «${card.title}» compartido`)}</header><p>{card.text}</p>
      {card.status === "draft" ? <><small>{t("确认后你们俩都能看到。", "Once you confirm, both of you can see it.", "Cuando lo confirmes, los dos podrán verlo.")}</small><div className="card-actions"><button className="card-primary" disabled={busy} onClick={() => void confirmSpace(card)}><CheckCircle size={18} weight="fill" />{t("确认放进去", "Confirm", "Confirmar")}</button></div></> :
        card.status === "shared" ? <small className="card-state"><CheckCircle size={16} weight="fill" />{t("已放进共同空间", "Added to the shared space", "Añadido al espacio compartido")}</small> : null}
    </article>;
    if (card.kind === "space_group") return <article key={card.id} className="conversation-card space-card"><header><ListBullets size={16} />{card.title || t("已放进空间", "Added to a space", "Añadido a un espacio")}</header>{card.text && <ul>{card.text.split("\n").map((line, index) => <li key={index}>{line}</li>)}</ul>}<div className="card-actions"><button onClick={() => open(card.url!)}>{t("打开", "Open", "Abrir")}<ArrowRight size={16} /></button></div></article>;
    return <article key={`${card.kind}:${card.id}`} className="conversation-card"><header>{card.title}</header>{card.text && <p>{card.text}</p>}{card.localDateTime && <small className="card-when">{card.localDateTime.replace("T", " ")}</small>}{card.status !== "unavailable" && card.url && <div className="card-actions"><button onClick={() => open(card.url!)}>{t("打开详情", "Open details", "Abrir detalles")}<ArrowRight size={16} /></button></div>}</article>;
  };
  // Several changes to one space in a turn read as one card: the space, what went in, one way to open it.
  const groupCards = (cards: Card[]) => cards.reduce<Card[]>((list, card) => {
    if (!["space", "space_item"].includes(card.kind) || !card.url || card.status === "unavailable") return [...list, card];
    const index = list.findIndex((entry) => entry.kind === "space_group" && entry.url === card.url);
    const entry = index >= 0 ? list[index] : { id: card.url, kind: "space_group", title: "", text: "", status: "active", version: 1, url: card.url };
    const next = card.kind === "space" ? { ...entry, title: card.title } : { ...entry, text: [entry.text, card.title].filter(Boolean).join("\n") };
    return index >= 0 ? list.map((item, position) => position === index ? next : item) : [...list, next];
  }, []);
  const sharedMessage = (message: SharedMessage) => {
    const mine = message.role === "member" && message.actorUserId === user.id;
    const author = message.role === "agent" ? "Agent" : mine ? "" : partnerName;
    // System copy is stored in every language; free-form model replies and member text are shown as written.
    const text = message.i18n?.[language] ?? message.text;
    if (message.kind === "agreement_card") {
      const ref = message.refs.find((item) => item.type === "agreement");
      const live = ref && pendingAgreement && pendingAgreement.id === ref.id && pendingAgreement.version === ref.version && !together?.readOnly;
      const version = ref?.version || 1;
      return <article key={message.id} className={`conversation-card agreement-card ${live ? "is-live" : ""}`} data-testid="agreement-card"><header><UsersThree size={16} />{t(`约定 v${version}`, `Agreement v${version}`, `Acuerdo v${version}`)}</header>{live ? <AgreementBody agreement={pendingAgreement!} language={language} /> : <p>{text}</p>}
        {live && (approved.includes(`${ref!.id}:${version}`) ? <small className="card-state"><CheckCircle size={16} weight="fill" />{t(`你已批准 v${version}，等 TA 批准`, `You approved v${version}. Waiting for your partner.`, `Aprobaste la v${version}. Esperando a tu pareja.`)}</small> :
          <div className="card-actions"><button className="card-primary" disabled={busy} onClick={() => void decide(ref!.id, version, "approve")}><CheckCircle size={18} weight="fill" />{t(`批准 v${version}`, `Approve v${version}`, `Aprobar v${version}`)}</button><button disabled={busy} onClick={() => void decide(ref!.id, version, "request-change")}>{t("要改", "Request change", "Pedir cambio")}</button></div>)}
      </article>;
    }
    if (message.kind === "reminder" || message.kind === "review") {
      const outcome = message.refs.find((item) => item.type === "outcome");
      return <article key={message.id} className="conversation-card notice-card"><header>{message.kind === "review" ? t("该复盘了", "Time to review", "Hora de revisar") : t("提醒", "Reminder", "Recordatorio")}</header><p>{text}</p>{outcome && <div className="card-actions"><button onClick={() => open(`/?view=decide&outcome=${encodeURIComponent(outcome.id)}`)}>{t("去复盘", "Start review", "Empezar revisión")}<ArrowRight size={16} /></button></div>}</article>;
    }
    const links = message.role === "agent" ? message.refs.filter((ref) => ref.type === "space" || ref.type === "milestone") : [];
    return <article key={message.id} className={`conversation-message ${message.role === "agent" ? "from-agent" : mine ? "from-me" : "from-partner"}`}>{(author || message.kind === "relay") && <span>{author}{message.kind === "relay" && <em><LockKey size={13} />{t("本人确认后分享", "Shared after review", "Compartido tras revisarlo")}</em>}</span>}<p>{text}</p>
      {!!links.length && <div className="message-links">{links.map((ref) => <button key={`${ref.type}:${ref.id}`} onClick={() => open(ref.type === "space" ? `/?view=space&space=${encodeURIComponent(ref.id)}` : "/?view=upcoming")}>{ref.type === "space" ? ref.title || t("打开空间", "Open space", "Abrir espacio") : t(`日期：${ref.title || ""}`, `Date: ${ref.title || ""}`, `Fecha: ${ref.title || ""}`)}<ArrowRight size={15} /></button>)}</div>}
    </article>;
  };

  const meEmpty = <section className="conversation-empty"><h1>{t("想说什么都可以", "Say anything", "Di lo que quieras")}</h1><p>{t("这里只有你能看到。难开口的话，我帮你整理成 TA 听得进去的版本，你确认后才会发出。", "Only you can see this. Tell me what is hard to say: I will shape a version your partner can hear, and nothing is sent until you confirm.", "Solo tú puedes ver esto. Cuéntame lo que te cuesta decir: prepararé una versión que tu pareja pueda escuchar y no se enviará nada hasta que lo confirmes.")}</p>
    <div className="conversation-suggestions">{[t("有句话想对 TA 说，但不知道怎么开口", "There is something I want to tell my partner, but I do not know how", "Quiero decirle algo a mi pareja, pero no sé cómo"), t("周五晚上八点提醒我早点回家", "Remind me on Friday at 8 pm to head home early", "Recuérdame el viernes a las 8 de la noche volver temprano"), t("记下今天的一个好时刻", "Save a good moment from today", "Guarda un buen momento de hoy")].map((text) => <button key={text} onClick={() => { setDraft(text); composerRef.current?.querySelector("textarea")?.focus(); }}>{text}</button>)}</div></section>;
  const usEmpty = <section className="conversation-empty"><h1>{t("你们俩和 Agent", "The two of you, plus your Agent", "Ustedes dos y su Agent")}</h1><p>{t("你们两人都能看到这里。Agent 平时不插话；想让它帮忙，就点 @Agent，比如“帮我们定下来”。", "You both see everything here. The Agent stays quiet unless you tap @Agent, for example to settle something together.", "Los dos ven todo aquí. El Agent no interviene a menos que toquen @Agent, por ejemplo para dejar algo acordado.")}</p></section>;
  const invite = <section className="conversation-empty conversation-invite" data-testid="conversation-invite"><h1>{t("邀请 TA 一起来", "Invite your partner", "Invita a tu pareja")}</h1><p>{t("“我们俩”是你们两个人和 Agent 的共同对话。TA 用自己的账号加入后，这里就会打开。", "Us is the shared conversation for the two of you and your Agent. It opens once your partner joins with their own account.", "Nosotros es la conversación compartida entre ustedes dos y su Agent. Se abre cuando tu pareja se une con su propia cuenta.")}</p>
    {pairing?.invitation ? <><div className="invite-code"><span>{t("邀请码", "Invite code", "Código de invitación")}</span><strong>{pairing.invitation.code}</strong></div><div className="card-actions"><button className="card-primary" onClick={() => void copyInvite()}><Copy size={18} />{copied ? t("已复制", "Copied", "Copiado") : t("复制邀请链接", "Copy invite link", "Copiar enlace")}</button><button disabled={busy} onClick={() => void onRefreshPairing()}>{t("检查是否已加入", "Check connection", "Comprobar conexión")}</button></div></> :
      <div className="card-actions"><button className="card-primary" disabled={busy} onClick={() => void createInvite()}><LinkSimple size={18} />{t("生成邀请链接", "Create invite link", "Crear enlace de invitación")}</button><button onClick={() => { keyboard.hide(); onPair(); }}>{t("我有邀请码", "I have a code", "Tengo un código")}</button></div>}
  </section>;

  const privateMessages = session?.messages || [];
  const sharedMessages = together?.conversation.messages || [];
  const draftCard = channel === "us" && paired && together?.conversation.draftAgreement && !pendingAgreement && !together.readOnly ? together.conversation.draftAgreement : null;
  return <div className="paper-screen conversation-home" data-testid="conversation-screen">
    <header className="conversation-header">
      <div className="conversation-topline">
        <button className="conversation-menu" onClick={openDrawer} aria-label={t("打开菜单", "Open menu", "Abrir menú")} aria-expanded={drawer} data-testid="open-drawer"><List size={24} /></button>
      </div>
      <div className="conversation-segments" role="tablist" aria-label={t("对话频道", "Conversation channel", "Canal de conversación")}>
        <button role="tab" aria-selected={channel === "me"} className={channel === "me" ? "active" : ""} onClick={() => switchChannel("me")}><LockKey size={18} />{t("只有我", "Just me", "Solo yo")}</button>
        <button role="tab" aria-selected={channel === "us"} className={channel === "us" ? "active" : ""} onClick={() => switchChannel("us")}><UsersThree size={18} />{t("我们俩", "Us", "Nosotros")}</button>
      </div>
    </header>
    <div className="conversation-stream"><MobileScroll className="conversation-scroll"><main className="conversation-thread" aria-live="polite">
      {channel === "me" ? <>{!privateMessages.length && !queued.length && meEmpty}{privateMessages.map((message) => <div key={message.id} className="conversation-turn"><article className={`conversation-message ${message.role === "user" ? "from-me" : "from-agent"}`}>{message.role === "assistant" && <span>Agent</span>}<p>{message.text}</p></article>{groupCards(message.cards || []).map(privateCard)}</div>)}</> :
        !paired ? invite : <>{!sharedMessages.length && usEmpty}{sharedMessages.map(sharedMessage)}
          {draftCard && <article className="conversation-card draft-card" data-testid="agreement-draft"><header><ChatCircleDots size={16} />{t("Agent 起草的约定", "Agreement drafted by the Agent", "Acuerdo redactado por el Agent")}</header><strong>{draftCard.title}</strong><p>{draftCard.summary}</p><ol>{draftCard.terms.map((term) => <li key={term}>{term}</li>)}</ol><small>{t("发出后，你们俩都要批准同一版本才生效。", "Once sent, it takes effect only when both of you approve the same version.", "Una vez enviado, solo entra en vigor cuando ambos aprueben la misma versión.")}</small><div className="card-actions"><button className="card-primary" disabled={busy} onClick={() => void draftAgreement()}>{t("发给你们俩批准", "Send for both to approve", "Enviar para que ambos aprueben")}</button></div></article>}
        </>}
      {voice.partial && <p className="conversation-partial">{voice.partial.text || t("正在听…", "Listening…", "Escuchando…")}</p>}
      {channel === "me" && queued.map((item) => <article key={item.itemId} className="conversation-message from-me is-sending"><p>{item.text}</p></article>)}
      {pending.me > 0 && channel === "me" && <p className="conversation-status" role="status">{t("正在想…", "Thinking…", "Pensando…")}</p>}
      <div ref={endRef} />
    </main></MobileScroll></div>
    {!(channel === "us" && !paired) && <footer className="conversation-composer" ref={composerRef}>
      {notice && <p className="conversation-notice" role="alert">{notice}</p>}
      {failed && channel === "me" && <div className="conversation-retry"><span>{t("这句话还没确认送达。", "This message was not confirmed.", "Este mensaje no se confirmó.")}</span><button disabled={pending.me > 0} onClick={() => void sendPrivate(failed.text, failed.itemId)}>{t("重试", "Retry", "Reintentar")}</button></div>}
      {voice.listening && <p className="conversation-listening">{channel === "us" ? t("说完的话会先放进输入框，确认后再发。", "What you say goes into the box first; send it when ready.", "Lo que digas va primero al cuadro; envíalo cuando quieras.") : t("正在听。说“结束语音”即可停止。", "Listening. Say “stop listening” to finish.", "Escuchando. Di «deja de escuchar» para terminar.")}</p>}
      {readOnly ? <p className="conversation-notice">{t("你们的共同空间已结束，这里只能查看。", "Your shared space has ended; this conversation is read-only.", "Su espacio compartido terminó; esta conversación es de solo lectura.")}</p> :
        <div className="conversation-input">
          {channel === "us" && <button type="button" className={`conversation-mention ${askAgent ? "active" : ""}`} aria-pressed={askAgent} onClick={() => setAskAgent(!askAgent)} aria-label={t("叫 Agent 来帮忙", "Ask the Agent to help", "Pedir ayuda al Agent")}><At size={20} weight="bold" /></button>}
          <KeyboardTextarea data-testid="conversation-input" aria-label={placeholder} value={draft} onChange={(event) => setDraft(event.target.value)} rows={1} maxLength={2000} placeholder={placeholder} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} />
          <button type="button" className={`conversation-mic ${voice.listening ? "listening" : ""}`} onClick={() => void toggleVoice()} aria-pressed={voice.listening} aria-label={voice.listening || voice.connecting ? t("结束语音", "End voice", "Terminar voz") : t("开始语音", "Start voice", "Iniciar voz")}>{voice.listening || voice.connecting ? <StopCircle size={22} weight="fill" /> : <Microphone size={22} />}</button>
          <button type="button" className="conversation-send" onClick={send} disabled={!draft.trim()} aria-label={t("发送", "Send", "Enviar")} data-testid="conversation-send"><PaperPlaneRight size={20} weight="fill" /></button>
        </div>}
    </footer>}
    {drawer && <ConversationDrawer user={user} paired={paired} language={language} onClose={() => setDrawer(false)} onOpen={(url) => { setDrawer(false); open(url); }} onInvite={() => { setDrawer(false); switchChannel("us"); }} onPrivacy={() => { setDrawer(false); onPrivacy(); }} onLogout={() => { setDrawer(false); onLogout(); }} />}
  </div>;
}

/** The top of every page opened from the drawer: the way back to the conversation and the page title, nothing else. */
export function PageHeader({ language, title, onBack }: { language: Language; title: string; onBack: () => void }) {
  return <header className="page-header"><button className="page-back" onClick={onBack} data-testid="back-to-conversation"><ArrowLeft size={20} />{localized(language, "对话", "Chat", "Chat")}</button><h1>{title}</h1></header>;
}

type DrawerItem = { key: string; icon: ReactNode; label: string; badge?: number; onClick: () => void };
/** Left drawer: only places to look at what Pinky has done. Doing things happens in the conversation. */
function ConversationDrawer({ user, paired, language, onClose, onOpen, onInvite, onPrivacy, onLogout }: { user: { id: string; name: string }; paired: boolean; language: Language; onClose: () => void; onOpen: (url: string) => void; onInvite: () => void; onPrivacy: () => void; onLogout: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [home, setHome] = useState<{ pending: number; lists: boolean } | null>(null);
  const [spaces, setSpaces] = useState<SpaceSummary[]>([]);
  const start = useRef<number | null>(null);
  useEffect(() => {
    if (!paired) return;
    relationshipApi<{ home: { pending: unknown[] }; graph: { lists: unknown[]; milestones: unknown[] } }>("/api/relationship/home")
      .then((result) => setHome({ pending: result.home.pending.length, lists: result.graph.lists.length + result.graph.milestones.length > 0 })).catch(() => {});
  }, [paired]);
  useEffect(() => { relationshipApi<{ spaces: SpaceSummary[] }>("/api/spaces").then((result) => setSpaces(result.spaces)).catch(() => {}); }, []);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [onClose]);
  const fixed: DrawerItem[] = paired ? [
    { key: "agreements", icon: <Handshake size={22} />, label: t("约定", "Agreements", "Acuerdos"), badge: home?.pending, onClick: () => onOpen("/?view=agreements") },
    { key: "upcoming", icon: <CalendarBlank size={22} />, label: t("即将到来", "Coming up", "Próximamente"), onClick: () => onOpen("/?view=upcoming") },
  ] : [
    { key: "invite", icon: <UserPlus size={22} />, label: t("邀请 TA 一起来", "Invite your partner", "Invita a tu pareja"), onClick: onInvite },
    { key: "upcoming", icon: <CalendarBlank size={22} />, label: t("即将到来", "Coming up", "Próximamente"), onClick: () => onOpen("/?view=reminders") },
  ];
  const fixedSpaces: DrawerItem[] = [
    { key: "moments", icon: <HandHeart size={22} />, label: t("回忆", "Moments", "Momentos"), onClick: () => onOpen("/?view=moments") },
    ...(paired && home?.lists ? [{ key: "lists", icon: <ListChecks size={22} />, label: t("日期与清单", "Dates & lists", "Fechas y listas"), onClick: () => onOpen("/?view=lists") }] : []),
    ...(paired ? [{ key: "talk", icon: <UsersThree size={22} />, label: t("调解与复盘", "Mediation & reviews", "Mediación y revisiones"), onClick: () => onOpen("/?view=talk") }] : []),
  ];
  const layoutIcon: Record<string, ReactNode> = { checklist: <ListChecks size={22} />, timeline: <ClockCounterClockwise size={22} />, gallery: <Images size={22} />, notes: <NotePencil size={22} />, list: <ListBullets size={22} /> };
  const spaceRow = (space: SpaceSummary): DrawerItem => ({ key: `space-${space.id}`, icon: layoutIcon[space.layout] || layoutIcon.list, label: space.title, onClick: () => onOpen(`/?view=space&space=${encodeURIComponent(space.id)}`) });
  const ours = spaces.filter((space) => space.visibility === "shared").map(spaceRow), mine = spaces.filter((space) => space.visibility === "private").map(spaceRow);
  const row = (item: DrawerItem) => <button key={item.key} className="drawer-row" onClick={item.onClick} data-testid={`drawer-${item.key}`}>{item.icon}<span>{item.label}</span>{!!item.badge && <em aria-label={t(`${item.badge} 件待处理`, `${item.badge} waiting`, `${item.badge} pendientes`)}>{item.badge}</em>}</button>;
  return <div className="conversation-drawer-layer" data-testid="conversation-drawer">
    <button className="conversation-drawer-scrim" aria-label={t("关闭菜单", "Close menu", "Cerrar menú")} onClick={onClose} />
    <nav className="conversation-drawer" aria-label={t("菜单", "Menu", "Menú")} onPointerDown={(event) => { start.current = event.clientX; }} onPointerUp={(event) => { if (start.current !== null && event.clientX - start.current < -60) onClose(); start.current = null; }}>
      <header><div><strong>PINKY</strong><span>{user.name}</span></div><button onClick={onClose} aria-label={t("关闭菜单", "Close menu", "Cerrar menú")}><X size={22} /></button></header>
      <div className="drawer-group">{fixed.map(row)}</div>
      <div className="drawer-group"><h2>{paired ? t("我们俩的", "Ours", "Nuestro") : t("只有我的", "Just mine", "Solo mío")}</h2>{(paired ? ours : mine).map(row)}{fixedSpaces.map(row)}</div>
      {paired && !!mine.length && <div className="drawer-group"><h2>{t("只有我的", "Just mine", "Solo mío")}</h2>{mine.map(row)}</div>}
      <footer className="drawer-group">{row({ key: "settings", icon: <GearSix size={22} />, label: t("设置", "Settings", "Ajustes"), onClick: onPrivacy })}{row({ key: "logout", icon: <SignOut size={22} />, label: t("退出登录", "Sign out", "Cerrar sesión"), onClick: onLogout })}</footer>
    </nav>
  </div>;
}

/** The live agreement drawn from its own fields: a distinct title, numbered terms, open points, then the status. */
function AgreementBody({ agreement, language }: { agreement: Draft & { status: string }; language: Language }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const showTitle = agreement.title && agreement.title !== agreement.terms[0];
  return <>
    {showTitle && <strong>{agreement.title}</strong>}
    <ol>{agreement.terms.map((term, index) => <li key={index}>{term}</li>)}</ol>
    {!!agreement.unresolvedPoints?.length && <div className="agreement-open"><small>{t("还没定的", "Still open", "Pendiente")}</small><ul>{agreement.unresolvedPoints.map((point, index) => <li key={index}>{point}</li>)}</ul></div>}
    <small>{t("等你们两人批准同一版本", "Waiting for both of you to approve this version", "Esperando que ambos aprueben esta versión")}</small>
  </>;
}
