import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Lightbulb, ArrowLeft, ArrowRight, ArrowSquareOut, At, CalendarPlus, EnvelopeSimple, MapPin, Phone, CalendarBlank, ChatCircleDots, ChatsCircle, CheckCircle, Heart, ClockCounterClockwise, Copy, GearSix, HandHeart, Handshake, ImageSquare, Images, LinkSimple, List, ListBullets, ListChecks, LockKey, Microphone, NotePencil, PaperPlaneRight, SignOut, StopCircle, UserPlus, UsersThree, X } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { KeyboardTextarea, MobileScroll, useKeyboard } from "../../mobile";
import { useRealtimeTranscription } from "../../useRealtimeTranscription";
import { browserSpeechAvailable, useBrowserSpeech } from "../../useBrowserSpeech";
import { jsonBody, relationshipApi } from "../relationship/api";
import type { GraphRecord } from "../relationship/types";
import { ImportCard } from "../imports/ImportCard";
import { importAction, importPastedChat, isChatFile, listImports, looksLikePastedChat, uploadChatFile } from "../imports/imports";
import { CallPanel, CallRecord } from "../call/CallPanel";
import { togetherStats } from "../moments/together";
import { StoryCard, StoryView, type Story } from "../story/StoryCard";
import { OnboardingTour, tourSeen } from "./OnboardingTour";
import { DailyQuestionCard, type DailyAnswers } from "./DailyQuestionCard";
import "./conversation.css";

type Channel = "me" | "us";
type Card = { id: string; kind: string; title: string; text?: string | null; status: string; version: number; digest?: string; url?: string; localDateTime?: string };
type SpaceSummary = { id: string; title: string; layout: string; visibility: string; system?: string };
type CallTranscript = { minutes: number; rows: Array<{ role: string; text: string }> };
type PrivateMessage = { id: string; role: "user" | "assistant"; text: string; createdAt: string; cards?: Card[]; photoIds?: string[]; call?: CallTranscript };
type Attachment = { key: string; preview: string; id: string | null; failed?: boolean };
type Session = { id: string; language: Language; timezone: string; version: number; messages: PrivateMessage[] };
type Ref = { type: string; id: string; version?: number; title?: string; url?: string; requestFor?: string; system?: string };
type SharedMessage = { id: string; role: "member" | "agent"; actorUserId: string | null; recordedByUserId?: string; kind: "text" | "relay" | "agreement_card" | "reminder" | "review" | "call" | "story" | "daily_question"; call?: CallTranscript; story?: Story; answers?: DailyAnswers; day?: string; text: string; i18n?: Partial<Record<Language, string>>; refs: Ref[]; createdAt: string; photoIds?: string[] };
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
  // A channel named in the URL (a page handing a sentence back) wins over the one remembered from last time.
  const [channel, setChannel] = useState<Channel>(() => { try { const asked = new URLSearchParams(location.search).get("channel"); return asked === "us" || asked === "me" ? asked : localStorage.getItem(channelKey) === "us" ? "us" : "me"; } catch { return "me"; } });
  const [session, setSession] = useState<Session | null>(null);
  const [together, setTogether] = useState<Together | null>(null);
  const [approved, setApproved] = useState<string[]>([]);
  // A page can hand a starting sentence back ("Add to …: "); it lands in that channel's box once, then leaves the URL.
  const [drafts, setDrafts] = useState<Record<Channel, string>>(() => { const params = new URLSearchParams(location.search); const say = (params.get("say") || "").slice(0, 300); return { me: params.get("channel") !== "us" ? say : "", us: params.get("channel") === "us" ? say : "" }; });
  const [askAgent, setAskAgent] = useState(false);
  const [revising, setRevising] = useState(false);
  const [pending, setPending] = useState<Record<Channel, number>>({ me: 0, us: 0 });
  const [agentWorking, setAgentWorking] = useState(0);
  const [unreadMe, setUnreadMe] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // Talking together in Us: each finished sentence goes straight to Us, from whoever is picked as speaking on this phone.
  const [talkTogether, setTalkTogether] = useState(false);
  const [speaker, setSpeaker] = useState<"me" | "partner">("me");
  const talking = useRef({ on: false, speaker: "me" as "me" | "partner" }); talking.current = { on: talkTogether, speaker };
  const fileRef = useRef<HTMLInputElement>(null);
  const [queued, setQueued] = useState<Array<{ text: string; itemId: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ text: string; itemId: string; photoIds?: string[] } | null>(null);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [call, setCall] = useState<{ channel: Channel; sessionId: string | null } | null>(null);
  const [openStory, setOpenStory] = useState<Story | null>(null);
  const [touring, setTouring] = useState(() => !tourSeen(user.id));
  // A few fresh things to say, made by Pinky from where the couple is; they change as the conversation moves on.
  const [ideas, setIdeas] = useState<Record<Channel, string[]>>({ me: [], us: [] });
  // Suggestions are a fresh-start aid, not fixed chrome: they show at the end of a channel that is empty or has been quiet
  // for a while, or when asked for with the bulb, and fold away once the person starts typing or sends.
  const [summoned, setSummoned] = useState<Channel | null>(null);
  const [dismissedAt, setDismissedAt] = useState<Record<Channel, number>>({ me: 0, us: 0 });
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
    if (!id) { try { const result = await relationshipApi<{ session: Session }>("/api/assistant/sessions/latest"); current(result.session); store(result.session.id); return result.session; } catch { return null; } }
    try { const result = await relationshipApi<{ session: Session }>(`/api/assistant/sessions/${encodeURIComponent(id)}?opened=1`); current(result.session); return result.session; } catch { store(null); return null; }
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
      const result = await relationshipApi<Together>(`/api/together?language=${language}&timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")}`); setTogether(result);
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
    events.addEventListener("relationship", (event) => { try {
      const { eventType, objectId } = JSON.parse((event as MessageEvent).data);
      if (/^(together|agreement)/.test(eventType)) void loadTogether();
      // A question Pinky asked privately on behalf of Us: refresh this conversation and mark "Just me" if it is not in view.
      if (eventType === "assistant.updated" && (!sessionRef.current || sessionRef.current.id === objectId)) { void relationshipApi<{ session: Session }>(`/api/assistant/sessions/${encodeURIComponent(objectId)}`).then((result) => { current(result.session); store(result.session.id); if (channelRef.current !== "me") setUnreadMe(true); }).catch(() => {}); }
    } catch { /* Ignore malformed events. */ } });
    events.addEventListener("access-ended", () => { events.close(); accessChanged.current(); });
    return () => events.close();
  }, [paired, loadTogether]);
  useEffect(() => { setNotice(""); }, [language]);
  useEffect(() => { if (new URLSearchParams(location.search).has("say")) { window.history.replaceState(null, "", location.pathname); composerRef.current?.querySelector("textarea")?.focus(); } }, []);
  useEffect(() => { try { localStorage.setItem(channelKey, channel); } catch { /* Channel memory is a convenience. */ } }, [channel, channelKey]);
  // When Us was last looked at on this device, so "Us" can show a dot for what the partner or Pinky said since.
  const seenKey = `toward-us:us-seen:${user.id}`;
  const [seenUs, setSeenUs] = useState(() => { try { return localStorage.getItem(seenKey) || ""; } catch { return ""; } });
  const latestUs = together?.conversation.messages.at(-1);
  useEffect(() => {
    if (channel !== "us" || !latestUs) return;
    setSeenUs(latestUs.createdAt); try { localStorage.setItem(seenKey, latestUs.createdAt); } catch { /* The dot just shows again. */ }
  }, [channel, latestUs?.createdAt, seenKey]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [channel, session?.version, together?.conversation.messages.length, pending.me, queued.length]);

  const say = (text: string) => {
    if (!("speechSynthesis" in window) || !text) return;
    window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = languageTag(language); window.speechSynthesis.speak(utterance);
  };
  // Turns run strictly in order per channel, typed and spoken alike (one queue per channel): the server rejects a turn that
  // races the previous one, so a second utterance waits for the first answer instead of failing with a version conflict.
  const queues = useRef<Record<Channel, Promise<unknown>>>({ me: Promise.resolve(), us: Promise.resolve() });
  const failedRef = useRef<{ text: string; itemId: string; photoIds?: string[] } | null>(null);
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
  const sendPrivate = (text: string, itemId: string, spoken = false, photoIds: string[] = []) => {
    setNotice(""); setQueued((items) => [...items.filter((item) => item.itemId !== itemId), { text, itemId }]);
    return enqueue("me", async () => {
      try {
        if (failedRef.current && failedRef.current.itemId !== itemId) { keep(text, "me"); setNotice(t("上一句还没确认送达，请先重试它。", "The previous message was not confirmed. Retry it first.", "El mensaje anterior no se confirmó. Reinténtalo primero.")); return null; }
        const active = await ensureSession();
        const result = await relationshipApi<{ session: Session }>(`/api/assistant/sessions/${active!.id}/${spoken ? "transcripts" : "messages"}`, jsonBody({ text, itemId, ...(photoIds.length ? { photoIds } : {}) }));
        current(result.session); failedRef.current = null; setFailed(null); setRevising(false);
        window.dispatchEvent(new Event("toward-us:assistant-changed"));
        if (spoken) say(result.session.messages.filter((message) => message.role === "assistant").at(-1)?.text || "");
        return result;
      } catch (error) {
        const status = (error as ApiError).status;
        if (!status || status >= 500 && status !== 503) { failedRef.current = { text, itemId, photoIds }; setFailed(failedRef.current); } else keep(text, "me");
        setNotice(errorText(error as ApiError)); return null;
      } finally { setQueued((items) => items.filter((item) => item.itemId !== itemId)); }
    });
  };
  // Sending the same text again after a failure reuses its itemId, so a retry can never post the message twice.
  const failedSharedRef = useRef<{ text: string; body: string; itemId: string } | null>(null);
  const sendShared = (text: string, photoIds: string[] = [], spokenBy: "me" | "partner" = "me") => {
    const retry = failedSharedRef.current?.text === text ? failedSharedRef.current : null;
    const body = retry ? retry.body : askAgent && !AGENT_CALL.test(text) ? `@Pinky ${text}` : text, itemId = retry ? retry.itemId : crypto.randomUUID();
    setNotice(""); setAskAgent(false);
    const calling = AGENT_CALL.test(body);
    return enqueue("us", async () => {
      // Show the member's words at once; the Agent's reply follows when it is ready.
      const shown = calling ? setTimeout(() => void loadTogether(), 600) : null;
      if (calling) setAgentWorking((count) => count + 1);
      try { await relationshipApi("/api/together/messages", jsonBody({ text: body, itemId, language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", ...(photoIds.length ? { photoIds } : {}), ...(spokenBy === "partner" ? { speaker: "partner" } : {}) })); failedSharedRef.current = null; await loadTogether(); }
      catch (error) { failedSharedRef.current = { text, body, itemId }; keep(text, "us"); setNotice(errorText(error as ApiError)); }
      finally { if (shown) clearTimeout(shown); if (calling) setAgentWorking((count) => count - 1); }
    });
  };
  const ready = attachments.filter((item) => item.id).map((item) => item.id!);
  const uploading = attachments.some((item) => !item.id && !item.failed);
  // The import posts its own note into this conversation; reload it so the card shows up right away.
  const startCall = async () => {
    keyboard.hide(); voice.stop(); setNotice("");
    if (channel === "us") { setCall({ channel: "us", sessionId: null }); return; }
    try { const active = await ensureSession(); setCall({ channel: "me", sessionId: active?.id || null }); } catch (error) { setNotice((error as Error).message); }
  };
  const reloadSession = async () => { const active = sessionRef.current; if (!active) return; try { current((await relationshipApi<{ session: Session }>(`/api/assistant/sessions/${encodeURIComponent(active.id)}`)).session); } catch { /* The next event or poll refreshes it. */ } };
  const importChat = async (run: (session: string | null) => Promise<unknown>) => {
    setNotice(""); setPending((count) => ({ ...count, me: count.me + 1 }));
    try { const active = await ensureSession(); await run(active?.id || null); await reloadSession(); }
    catch (error) { setNotice((error as Error).message); } finally { setPending((count) => ({ ...count, me: count.me - 1 })); }
  };
  const send = () => {
    const text = draft.trim(); if ((!text && !ready.length) || uploading) return;
    // A long pasted conversation (for example copied WeChat messages) becomes a chat-history import, not one message.
    if (channel === "me" && !ready.length && looksLikePastedChat(text)) { setDraft(""); void importChat((session) => importPastedChat(text, { language, session })); return; }
    setDraft(""); setAttachments([]);
    if (channel === "me") void sendPrivate(text, crypto.randomUUID(), false, ready); else void sendShared(text, ready);
  };
  // Photos are shrunk on the phone, then uploaded: private in Just me, shared in Us (sending there is the share).
  const pickPhotos = async (files: FileList | null) => {
    const all = [...(files || [])];
    const picked = all.filter((file) => file.type.startsWith("image/")).slice(0, 6 - attachments.length);
    if (fileRef.current) fileRef.current.value = "";
    // Exported chat files are imported privately from Just me; Us only gets an analysis both of you agreed to share.
    const chats = all.filter((file) => !file.type.startsWith("image/") && isChatFile(file));
    if (chats.length && channelRef.current === "us") setNotice(t("聊天记录请在“只有我”里导入，只有你能看到；之后可以邀请 TA 一起看。", "Import chat history in Just me, where only you see it; you can invite your partner to look together later.", "Importa el historial en Solo yo, donde solo tú lo ves; luego puedes invitar a tu pareja a verlo."));
    else for (const file of chats.slice(0, 1)) void importChat((session) => uploadChatFile(file, { name: file.name, language, session }));
    const scope = channel === "us" ? "shared" : "private";
    for (const file of picked) {
      const key = crypto.randomUUID(), preview = URL.createObjectURL(file);
      setAttachments((items) => [...items, { key, preview, id: null }]);
      try {
        const blob = await shrink(file);
        const response = await fetch(`/api/photos?scope=${scope}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "image/jpeg" }, body: blob });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || t("照片没传上去。", "The photo did not upload.", "La foto no se subió."));
        setAttachments((items) => items.map((item) => item.key === key ? { ...item, id: payload.photo.id } : item));
      } catch (error) { setAttachments((items) => items.map((item) => item.key === key ? { ...item, failed: true } : item)); setNotice((error as Error).message); }
    }
  };

  const channelRef = useRef(channel); channelRef.current = channel;
  const heard = async (text: string, itemId: string) => {
    if (STOP_VOICE.test(text.trim())) { voice.stop(); return null; }
    // In "Us" speech only fills the box: nothing reaches the partner until the member taps send.
    if (channelRef.current === "us") { if (talking.current.on) void sendShared(text, [], talking.current.speaker); else setDraft((value) => value ? `${value} ${text}` : text, "us"); return null; }
    return sendPrivate(text, itemId, true);
  };
  const voiceUnavailable = (message: string) => setNotice(t(message, "Voice is unavailable right now. You can still type.", "La voz no está disponible ahora. Puedes seguir escribiendo."));
  // Realtime voice first; when that service is unavailable, the phone's own speech recognition takes over.
  const phoneSpeech = useRef(false);
  const speech = useBrowserSpeech({ lang: languageTag(language), onTranscript: heard, onError: voiceUnavailable });
  const realtime = useRealtimeTranscription<unknown>({
    endpoint: session ? `/api/assistant/sessions/${session.id}/realtime` : "", speakerId: user.id,
    onSpeechStarted: () => window.speechSynthesis?.cancel(),
    onTranscript: heard,
    onCommitted: () => {},
    onError: (message) => { realtime.stop(); if (browserSpeechAvailable()) { phoneSpeech.current = true; speech.start(); } else voiceUnavailable(message); },
  });
  const voice = { listening: realtime.listening || speech.listening, connecting: realtime.connecting, partial: speech.partial ? { text: speech.partial } : realtime.partial, stop: () => { realtime.stop(); speech.stop(); } };
  const toggleVoice = async () => {
    keyboard.hide(); window.speechSynthesis?.cancel();
    if (voice.listening || voice.connecting) { voice.stop(); return; }
    setNotice("");
    if (phoneSpeech.current) { speech.start(); return; }
    try { const active = await ensureSession(); await realtime.start(`/api/assistant/sessions/${active!.id}/realtime`); }
    catch (error) { if (browserSpeechAvailable()) { phoneSpeech.current = true; speech.start(); } else setNotice(errorText(error as ApiError)); }
  };
  const switchChannel = (next: Channel) => { if (next === channel) return; keyboard.hide(); voice.stop(); setNotice(""); setRevising(false); setAttachments([]); if (next === "me") setUnreadMe(false); setChannel(next); };
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
  const answerDaily = async (id: string, text: string) => {
    setNotice("");
    try { await relationshipApi(`/api/together/daily/${encodeURIComponent(id)}/answer`, jsonBody({ text, language })); await loadTogether(); return true; }
    catch (error) { setNotice(errorText(error as ApiError)); await loadTogether(); return false; }
  };
  // Today's question still waits for this member's answer.
  const todayQuestion = together?.conversation.messages.filter((message) => message.kind === "daily_question").at(-1);
  const dailyWaiting = Boolean(todayQuestion && Date.now() - Date.parse(todayQuestion.createdAt) < 86_400_000 && !todayQuestion.answers?.[user.id] && Object.keys(todayQuestion.answers || {}).length < 2);
  // Something in Us waits for this member: an agreement they have not approved yet, or a new line from the partner or Pinky.
  const unreadUs = channel !== "us" && (dailyWaiting || Boolean(pendingAgreement && !together?.readOnly && !approved.includes(`${pendingAgreement.id}:${pendingAgreement.version}`)) || Boolean(latestUs && latestUs.actorUserId !== user.id && latestUs.createdAt > seenUs));
  const readOnly = channel === "us" && (!paired || Boolean(together?.readOnly));
  const placeholder = channel === "me" ? revising ? t("说说想怎么改…", "Tell me what to change…", "Dime qué cambiar…") : t("跟我说说…", "Talk to me…", "Cuéntame…") : askAgent ? t("问 Pinky…", "Ask Pinky…", "Pregúntale a Pinky…") : t("发给你们俩…", "Message both of you…", "Escribe a los dos…");

  const privateCard = (card: Card) => {
    if (card.kind === "chat_import") return <ImportCard key={card.id} id={card.id} language={language} onOpen={open} onFinished={() => void reloadSession()} />;
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
    if (card.kind === "link" && card.url) return <div key={card.id} className="message-handoffs"><Handoff title={card.title} url={card.url} language={language} onOpen={open} /></div>;
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
  const approvedImports = new Set((together?.conversation.messages || []).flatMap((message) => message.refs.filter((ref) => ref.type === "chat_import" && ref.requestFor).map((ref) => ref.requestFor!)));
  const sharedMessage = (message: SharedMessage) => {
    const mine = message.role === "member" && message.actorUserId === user.id;
    const recorder = message.recordedByUserId ? (message.recordedByUserId === user.id ? user.name : partnerName) : "";
    const author = message.role === "agent" ? "Pinky" : recorder ? `${message.actorUserId === user.id ? user.name : partnerName}${t(`（在 ${recorder} 的手机上说）`, ` (spoken on ${recorder}'s phone)`, ` (dicho en el teléfono de ${recorder})`)}` : mine ? "" : partnerName;
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
    if (message.kind === "daily_question") return <DailyQuestionCard key={message.id} question={text} answers={message.answers || {}} userId={user.id} members={together?.members || []} language={language} onAnswer={(answer) => answerDaily(message.id, answer)} />;
    if (message.kind === "story" && message.story) { const story = message.story; return <div key={message.id} className="conversation-turn"><StoryCard language={language} story={story} onOpen={() => { keyboard.hide(); setOpenStory(story); }} /></div>; }
    if (message.kind === "call" && message.call) return <CallRecord key={message.id} language={language} title={text} call={message.call} />;
    if (message.kind === "reminder" || message.kind === "review") {
      const outcome = message.refs.find((item) => item.type === "outcome");
      return <article key={message.id} className="conversation-card notice-card"><header>{message.kind === "review" ? t("该复盘了", "Time to review", "Hora de revisar") : t("提醒", "Reminder", "Recordatorio")}</header><p>{text}</p>{outcome && <div className="card-actions"><button onClick={() => open(`/?view=decide&outcome=${encodeURIComponent(outcome.id)}`)}>{t("去复盘", "Start review", "Empezar revisión")}<ArrowRight size={16} /></button></div>}</article>;
    }
    const links = message.role === "agent" ? message.refs.filter((ref) => ref.type === "space" || ref.type === "milestone") : [];
    const chatRequest = message.refs.find((ref) => ref.type === "chat_import_request"), chatShared = message.refs.find((ref) => ref.type === "chat_import");
    const handoffs = message.role === "agent" ? message.refs.filter((ref) => ref.type === "link" && ref.url) : [];
    return <article key={message.id} className={`conversation-message ${message.role === "agent" ? "from-agent" : mine ? "from-me" : "from-partner"}`}>{(author || message.kind === "relay") && <span>{author}{message.kind === "relay" && <em><LockKey size={13} />{t("本人确认后分享", "Shared after review", "Compartido tras revisarlo")}</em>}</span>}{!!message.photoIds?.length && <Photos ids={message.photoIds} />}{text && <p>{message.role === "agent" ? <Linked text={text} /> : text}</p>}
      {!!links.length && <div className="message-links">{links.map((ref) => <button key={`${ref.type}:${ref.id}`} onClick={() => open(ref.system === "moments" ? "/?view=moments" : ref.type === "space" ? `/?view=space&space=${encodeURIComponent(ref.id)}` : "/?view=upcoming")}>{ref.system === "moments" ? t("回忆", "Moments", "Momentos") : ref.type === "space" ? ref.title || t("打开空间", "Open space", "Abrir espacio") : t(`日期：${ref.title || ""}`, `Date: ${ref.title || ""}`, `Fecha: ${ref.title || ""}`)}<ArrowRight size={15} /></button>)}</div>}
      {!!handoffs.length && <div className="message-handoffs">{handoffs.map((ref) => <Handoff key={ref.id} title={ref.title || ""} url={ref.url!} language={language} onOpen={open} />)}</div>}
      {chatRequest && <div className="card-actions">{approvedImports.has(chatRequest.id) ? <small className="card-state"><CheckCircle size={16} weight="fill" />{t("已同意一起看", "Agreed to look together", "Aceptado para verlo juntos")}</small> : mine ? <small className="card-state">{t("等 TA 同意", "Waiting for your partner", "Esperando a tu pareja")}</small> : <button className="card-primary" disabled={busy} onClick={() => void approveImport(chatRequest.id)}><CheckCircle size={18} weight="fill" />{t("同意一起看", "Agree to look together", "Aceptar verlo juntos")}</button>}</div>}
      {chatShared && <div className="message-links"><button onClick={() => open(`/?view=import&import=${encodeURIComponent(chatShared.id)}`)}><ChatsCircle size={16} />{t("查看聊天记录分析", "See the chat history analysis", "Ver el análisis del historial")}<ArrowRight size={15} /></button></div>}
    </article>;
  };

  // B: the partner approves looking at the other's chat-history analysis together; only then does a shared copy exist.
  const approveImport = async (id: string) => {
    setBusy(true); setNotice("");
    try { await importAction(id, "share-approve", { language }); } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };
  const suggest = (items: string[], target: Channel) => <div className="conversation-suggestions" data-testid="composer-ideas">{items.map((text) => <button key={text} onClick={() => { setDraft(text, target); composerRef.current?.querySelector("textarea")?.focus(); }}>{text}</button>)}</div>;
  const meEmpty = <section className="conversation-empty"><h1>{t("想说什么都可以", "Say anything", "Di lo que quieras")}</h1><p>{t("这里只有你能看到。想记的、想查的、难开口的，都可以跟 Pinky 说；要给 TA 的话，你确认后才会发出。", "Only you can see this. Tell Pinky what to remember, look up or plan, or what is hard to say; nothing reaches your partner until you confirm.", "Solo tú puedes ver esto. Dile a Pinky qué recordar, buscar o planear, o lo que te cuesta decir; nada llega a tu pareja hasta que lo confirmes.")}</p></section>;
  const usEmpty = <section className="conversation-empty"><h1>{t("你们俩和 Pinky", "The two of you, plus Pinky", "Ustedes dos y Pinky")}</h1><p>{t("你们两人都能看到这里。Pinky 平时不插话；叫一声“Pinky”或点 @，它就来帮忙。", "You both see everything here. Pinky stays quiet until you say “Pinky” or tap @.", "Los dos ven todo aquí. Pinky no interviene hasta que digan «Pinky» o toquen @.")}</p></section>;
  const invite = <section className="conversation-empty conversation-invite" data-testid="conversation-invite"><h1>{t("邀请 TA 一起来", "Invite your partner", "Invita a tu pareja")}</h1><p>{t("“我们俩”是你们两个人和 Pinky 的共同对话。TA 用自己的账号加入后，这里就会打开。", "Us is the shared conversation for the two of you and Pinky. It opens once your partner joins with their own account.", "Nosotros es la conversación compartida entre ustedes dos y Pinky. Se abre cuando tu pareja se une con su propia cuenta.")}</p>
    {pairing?.invitation ? <><div className="invite-code"><span>{t("邀请码", "Invite code", "Código de invitación")}</span><strong>{pairing.invitation.code}</strong></div><div className="card-actions"><button className="card-primary" onClick={() => void copyInvite()}><Copy size={18} />{copied ? t("已复制", "Copied", "Copiado") : t("复制邀请链接", "Copy invite link", "Copiar enlace")}</button><button disabled={busy} onClick={() => void onRefreshPairing()}>{t("检查是否已加入", "Check connection", "Comprobar conexión")}</button></div></> :
      <div className="card-actions"><button className="card-primary" disabled={busy} onClick={() => void createInvite()}><LinkSimple size={18} />{t("生成邀请链接", "Create invite link", "Crear enlace de invitación")}</button><button onClick={() => { keyboard.hide(); onPair(); }}>{t("我有邀请码", "I have a code", "Tengo un código")}</button></div>}
  </section>;

  const privateMessages = session?.messages || [];
  // An import is reported twice (received, then read); its live card shows only on the latest of those messages.
  const importAt = new Map(privateMessages.flatMap((message, index) => (message.cards || []).filter((card) => card.kind === "chat_import").map((card) => [card.id, index] as const)));
  const sharedMessages = together?.conversation.messages || [];
  const lastSeen = channel === "me" ? privateMessages.at(-1)?.id || "" : sharedMessages.at(-1)?.id || "";
  const lastAt = Date.parse((channel === "me" ? privateMessages.at(-1)?.createdAt : sharedMessages.at(-1)?.createdAt) || "") || 0;
  const QUIET = 4 * 3_600_000;
  const wantIdeas = summoned === channel || (Date.now() - lastAt >= QUIET && Date.now() - dismissedAt[channel] >= QUIET);
  const showIdeas = wantIdeas && !draft.trim() && !voice.listening && !!ideas[channel].length && !readOnly && !(channel === "us" && !paired);
  const dismissIdeas = () => { setSummoned(null); setDismissedAt((current) => ({ ...current, [channel]: Date.now() })); };
  useEffect(() => { if (draft.trim() && wantIdeas) dismissIdeas(); }, [Boolean(draft.trim())]);
  useEffect(() => { if (showIdeas) endRef.current?.scrollIntoView({ block: "end" }); }, [showIdeas, ideas[channel].length]);
  // Fresh ideas only when they would be shown, so a busy conversation does not ask the model after every message.
  useEffect(() => {
    if ((channel === "us" && !paired) || !wantIdeas) return;
    let alive = true;
    relationshipApi<{ suggestions: string[] }>(`/api/suggestions?channel=${channel}&language=${language}`).then((result) => { if (alive) setIdeas((current) => ({ ...current, [channel]: result.suggestions })); }).catch(() => {});
    return () => { alive = false; };
  }, [channel, language, lastSeen, paired, wantIdeas]);
  const draftCard = channel === "us" && paired && together?.conversation.draftAgreement && !pendingAgreement && !together.readOnly ? together.conversation.draftAgreement : null;
  return <div className="paper-screen conversation-home" data-testid="conversation-screen">
    <header className="conversation-header">
      <div className="conversation-topline">
        {/* A live voice call with Pinky in this channel: privately in Just me, for everyone in the room in Us. */}
        <button className="conversation-call" onClick={() => void startCall()} disabled={Boolean(call) || (channel === "us" && !paired)} aria-label={t("和 Pinky 通话", "Call Pinky", "Llamar a Pinky")} data-testid="start-call"><Phone size={22} /></button>
        <button className="conversation-menu" onClick={openDrawer} aria-label={t("打开菜单", "Open menu", "Abrir menú")} aria-expanded={drawer} data-testid="open-drawer"><List size={24} /></button>
      </div>
      <div className="conversation-segments" role="tablist" aria-label={t("对话频道", "Conversation channel", "Canal de conversación")}>
        <button role="tab" aria-selected={channel === "me"} className={channel === "me" ? "active" : ""} onClick={() => switchChannel("me")}><LockKey size={18} />{t("只有我", "Just me", "Solo yo")}{unreadMe && <i className="tab-dot" aria-label={t("有新消息", "New message", "Mensaje nuevo")} />}</button>
        <button role="tab" aria-selected={channel === "us"} className={channel === "us" ? "active" : ""} onClick={() => switchChannel("us")}><UsersThree size={18} />{t("我们俩", "Us", "Nosotros")}{unreadUs && <i className="tab-dot" aria-label={t("有新消息", "New message", "Mensaje nuevo")} />}</button>
      </div>
    </header>
    <div className="conversation-stream"><MobileScroll className="conversation-scroll"><main className="conversation-thread" aria-live="polite">
      {channel === "me" ? <>{!privateMessages.length && !queued.length && meEmpty}{privateMessages.map((message, index) => <div key={message.id} className="conversation-turn"><article className={`conversation-message ${message.role === "user" ? "from-me" : "from-agent"}`}>{message.call && <CallRecord language={language} title="" call={message.call} />}{message.role === "assistant" && !message.call && <span>Pinky</span>}{!!message.photoIds?.length && <Photos ids={message.photoIds} />}{message.text && <p>{message.role === "assistant" ? <Linked text={message.text} /> : message.text}</p>}</article>{groupCards((message.cards || []).filter((card) => card.kind !== "chat_import" || importAt.get(card.id) === index)).map(privateCard)}</div>)}</> :
        !paired ? invite : <>{!sharedMessages.length && usEmpty}{sharedMessages.map(sharedMessage)}
          {draftCard && <article className="conversation-card draft-card" data-testid="agreement-draft"><header><ChatCircleDots size={16} />{t("Pinky 起草的约定", "Agreement drafted by Pinky", "Acuerdo redactado por Pinky")}</header><strong>{draftCard.title}</strong><p>{draftCard.summary}</p><ol>{draftCard.terms.map((term) => <li key={term}>{term}</li>)}</ol>{!!draftCard.unresolvedPoints?.length && <div className="agreement-open"><small>{t("还没定的", "Still open", "Pendiente")}</small><ul>{draftCard.unresolvedPoints.map((point, index) => <li key={index}>{point}</li>)}</ul></div>}<small>{t("发出后，你们俩都要批准同一版本才生效。", "Once sent, it takes effect only when both of you approve the same version.", "Una vez enviado, solo entra en vigor cuando ambos aprueben la misma versión.")}</small><div className="card-actions"><button className="card-primary" disabled={busy} onClick={() => void draftAgreement()}>{t("发给你们俩批准", "Send for both to approve", "Enviar para que ambos aprueben")}</button></div></article>}
        </>}
      {voice.partial && <p className="conversation-partial">{voice.partial.text || t("正在听…", "Listening…", "Escuchando…")}</p>}
      {channel === "me" && queued.map((item) => <article key={item.itemId} className="conversation-message from-me is-sending"><p>{item.text}</p></article>)}
      {pending.me > 0 && channel === "me" && <p className="conversation-status" role="status">{t("正在想…", "Thinking…", "Pensando…")}</p>}
      {agentWorking > 0 && channel === "us" && <p className="conversation-status" role="status">{t("Pinky 正在想…", "Pinky is thinking…", "Pinky está pensando…")}</p>}
      {showIdeas && suggest(ideas[channel], channel)}
      <div ref={endRef} />
    </main></MobileScroll></div>
    {call && <footer className="conversation-composer conversation-call-footer"><CallPanel language={language} started={call} partnerName={partnerName} onEnded={(message) => { setCall(null); if (message) setNotice(message); void reloadSession(); }} /></footer>}
    {!call && !(channel === "us" && !paired) && <footer className="conversation-composer" ref={composerRef}>
      {notice && <p className="conversation-notice" role="alert">{notice}</p>}
      {failed && channel === "me" && <div className="conversation-retry"><span>{t("这句话还没确认送达。", "This message was not confirmed.", "Este mensaje no se confirmó.")}</span><button disabled={pending.me > 0} onClick={() => void sendPrivate(failed.text, failed.itemId, false, failed.photoIds)}>{t("重试", "Retry", "Reintentar")}</button></div>}
      {voice.listening && channel === "me" && <p className="conversation-listening">{t("正在听。说“结束语音”即可停止。", "Listening. Say “stop listening” to finish.", "Escuchando. Di «deja de escuchar» para terminar.")}</p>}
      {voice.listening && channel === "us" && <div className="together-voice" data-testid="together-voice">
        <label className="together-switch"><input type="checkbox" checked={talkTogether} onChange={(event) => setTalkTogether(event.target.checked)} /><span>{t("一起说：每句直接发到“我们俩”", "Talk together: each sentence goes straight to Us", "Hablar juntos: cada frase va directo a Nosotros")}</span></label>
        {talkTogether ? <div className="together-speakers" role="group" aria-label={t("谁在说", "Who is speaking", "Quién habla")}><span>{t("谁在说", "Speaking", "Habla")}</span>{(["me", "partner"] as const).map((who) => <button key={who} type="button" className={speaker === who ? "active" : ""} aria-pressed={speaker === who} onClick={() => setSpeaker(who)}>{who === "me" ? user.name : partnerName}</button>)}</div>
          : <p>{t("说完的话会先放进输入框，确认后再发。", "What you say goes into the box first; send it when ready.", "Lo que digas va primero al cuadro; envíalo cuando quieras.")}</p>}
      </div>}
      {!!attachments.length && <div className="composer-photos">{attachments.map((item) => <figure key={item.key} className={item.failed ? "failed" : item.id ? "" : "uploading"}><img src={item.preview} alt="" draggable={false} /><button type="button" onClick={() => setAttachments((items) => items.filter((entry) => entry.key !== item.key))} aria-label={t("移除照片", "Remove photo", "Quitar foto")}><X size={14} weight="bold" /></button></figure>)}</div>}
      {readOnly ? <p className="conversation-notice">{t("你们的共同空间已结束，这里只能查看。", "Your shared space has ended; this conversation is read-only.", "Su espacio compartido terminó; esta conversación es de solo lectura.")}</p> :
        <div className="conversation-input">
          {channel === "us" && <button type="button" className={`conversation-mention ${askAgent ? "active" : ""}`} aria-pressed={askAgent} onClick={() => setAskAgent(!askAgent)} aria-label={t("叫 Pinky 来帮忙", "Ask Pinky to help", "Pedir ayuda a Pinky")}><At size={20} weight="bold" /></button>}
          <button type="button" className="conversation-photo" onClick={() => { keyboard.hide(); fileRef.current?.click(); }} disabled={attachments.length >= 6} aria-label={t("发照片", "Send a photo", "Enviar una foto")} data-testid="conversation-photo"><ImageSquare size={22} /></button>
          {!draft.trim() && <button type="button" className={`conversation-ideas ${showIdeas ? "active" : ""}`} aria-pressed={showIdeas} onClick={() => showIdeas ? dismissIdeas() : setSummoned(channel)} aria-label={t("给我一些建议", "Show suggestions", "Mostrar sugerencias")} data-testid="show-ideas"><Lightbulb size={22} /></button>}
          <input ref={fileRef} type="file" accept="image/*,.txt,.zip,.json,.csv,.xml,.html" multiple hidden onChange={(event) => void pickPhotos(event.target.files)} data-testid="conversation-photo-input" />
          <KeyboardTextarea data-testid="conversation-input" aria-label={placeholder} value={draft} onChange={(event) => setDraft(event.target.value)} rows={1} maxLength={2000} placeholder={placeholder} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} />
          <button type="button" className={`conversation-mic ${voice.listening ? "listening" : ""}`} onClick={() => void toggleVoice()} aria-pressed={voice.listening} aria-label={voice.listening || voice.connecting ? t("结束语音", "End voice", "Terminar voz") : t("开始语音", "Start voice", "Iniciar voz")}>{voice.listening || voice.connecting ? <StopCircle size={22} weight="fill" /> : <Microphone size={22} />}</button>
          <button type="button" className="conversation-send" onClick={send} disabled={(!draft.trim() && !ready.length) || uploading} aria-label={t("发送", "Send", "Enviar")} data-testid="conversation-send"><PaperPlaneRight size={20} weight="fill" /></button>
        </div>}
    </footer>}
    {touring && <OnboardingTour language={language} userId={user.id} paired={paired} onInvite={() => switchChannel("us")} onDone={() => setTouring(false)} />}
    {openStory && <StoryView language={language} story={openStory} onClose={() => setOpenStory(null)} />}
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
  const [home, setHome] = useState<{ pending: number; since: string | null } | null>(null);
  const [spaces, setSpaces] = useState<SpaceSummary[]>([]);
  const start = useRef<number | null>(null);
  useEffect(() => {
    if (!paired) return;
    relationshipApi<{ home: { pending: unknown[] }; graph: { milestones: Array<{ type?: string; date?: string; archivedAt?: string | null }> } }>("/api/relationship/home")
      .then((result) => setHome({ pending: result.home.pending.length, since: result.graph.milestones.find((item) => item.type === "relationship_started" && !item.archivedAt)?.date || null })).catch(() => {});
  }, [paired]);
  useEffect(() => { relationshipApi<{ spaces: SpaceSummary[] }>("/api/spaces").then((result) => setSpaces(result.spaces.filter((space) => !space.system))).catch(() => {}); }, []);
  const [chats, setChats] = useState(0);
  useEffect(() => { listImports().then((items) => setChats(items.length)).catch(() => {}); }, []);
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
  ];
  const layoutIcon: Record<string, ReactNode> = { checklist: <ListChecks size={22} />, timeline: <ClockCounterClockwise size={22} />, gallery: <Images size={22} />, notes: <NotePencil size={22} />, list: <ListBullets size={22} /> };
  const spaceRow = (space: SpaceSummary): DrawerItem => ({ key: `space-${space.id}`, icon: layoutIcon[space.layout] || layoutIcon.list, label: space.title, onClick: () => onOpen(`/?view=space&space=${encodeURIComponent(space.id)}`) });
  const ours = spaces.filter((space) => space.visibility === "shared").map(spaceRow);
  const mine = [...spaces.filter((space) => space.visibility === "private").map(spaceRow), ...(chats ? [{ key: "imports", icon: <ChatsCircle size={22} />, label: t("聊天记录", "Chat history", "Historial de chat"), onClick: () => onOpen("/?view=import") }] : [])];
  const together = home?.since ? togetherStats(home.since, new Date().toLocaleDateString("en-CA")) : null;
  const row = (item: DrawerItem) => <button key={item.key} className="drawer-row" onClick={item.onClick} data-testid={`drawer-${item.key}`}>{item.icon}<span>{item.label}</span>{!!item.badge && <em aria-label={t(`${item.badge} 件待处理`, `${item.badge} waiting`, `${item.badge} pendientes`)}>{item.badge}</em>}</button>;
  return <div className="conversation-drawer-layer" data-testid="conversation-drawer">
    <button className="conversation-drawer-scrim" aria-label={t("关闭菜单", "Close menu", "Cerrar menú")} onClick={onClose} />
    <nav className="conversation-drawer" aria-label={t("菜单", "Menu", "Menú")} onPointerDown={(event) => { start.current = event.clientX; }} onPointerUp={(event) => { if (start.current !== null && event.clientX - start.current < -60) onClose(); start.current = null; }}>
      <header><div><strong>PINKY</strong><span>{user.name}</span>{together && <em className="drawer-together"><Heart size={12} weight="fill" />{t(`在一起 ${together.days} 天`, `Together ${together.days} days`, `Juntos ${together.days} días`)}</em>}</div><button onClick={onClose} aria-label={t("关闭菜单", "Close menu", "Cerrar menú")}><X size={22} /></button></header>
      <div className="drawer-group">{fixed.map(row)}</div>
      <div className="drawer-group"><h2>{paired ? t("我们俩的", "Ours", "Nuestro") : t("只有我的", "Just mine", "Solo mío")}</h2>{(paired ? ours : mine).map(row)}{fixedSpaces.map(row)}</div>
      {paired && !!mine.length && <div className="drawer-group"><h2>{t("只有我的", "Just mine", "Solo mío")}</h2>{mine.map(row)}</div>}
      <footer className="drawer-group">{row({ key: "settings", icon: <GearSix size={22} />, label: t("设置", "Settings", "Ajustes"), onClick: onPrivacy })}{row({ key: "logout", icon: <SignOut size={22} />, label: t("退出登录", "Sign out", "Cerrar sesión"), onClick: onLogout })}</footer>
    </nav>
  </div>;
}

/** A hand-off: tapping finishes the thing on the phone (Maps, Messages, Mail, Phone, Calendar, a website). */
function Handoff({ title, url, language, onOpen }: { title: string; url: string; language: Language; onOpen?: (url: string) => void }) {
  // A page inside Pinky opens in place rather than in a new window.
  if (url.startsWith("/?view=") && onOpen) return <button className="handoff" onClick={() => onOpen(url)}><ArrowRight size={18} weight="bold" /><span>{title}</span></button>;
  const icon = url.startsWith("sms:") ? <ChatCircleDots size={18} weight="fill" /> : url.startsWith("tel:") ? <Phone size={18} weight="fill" /> : url.startsWith("mailto:") ? <EnvelopeSimple size={18} weight="fill" /> : url.includes("/api/handoff/event.ics") ? <CalendarPlus size={18} weight="fill" /> : url.includes("maps.apple.com") || url.includes("google.com/maps") ? <MapPin size={18} weight="fill" /> : <ArrowSquareOut size={18} weight="bold" />;
  const label = url.includes("/api/handoff/event.ics") ? `${localized(language, "加入日历", "Add to calendar", "Añadir al calendario")} · ${title}` : title;
  return <a className="handoff" href={url} target={/^(https?:|\/)/.test(url) ? "_blank" : undefined} rel="noopener noreferrer">{icon}<span>{label}</span></a>;
}

/** Photos in a message: one large, or a tidy grid; each opens full size. */
function Photos({ ids }: { ids: string[] }) {
  return <div className={`message-photos count-${Math.min(ids.length, 3)}`}>{ids.map((id) => <a key={id} href={`/api/photos/${encodeURIComponent(id)}`} target="_blank" rel="noopener noreferrer"><img src={`/api/photos/${encodeURIComponent(id)}`} alt="" loading="lazy" draggable={false} /></a>)}</div>;
}

/** Shrinks a picked photo to at most 1600px on its long side as JPEG, so uploads stay small on mobile data. */
async function shrink(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = () => reject(new Error("This photo could not be read.")); element.src = url; });
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas"); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("This photo could not be read.")), "image/jpeg", 0.82));
  } finally { URL.revokeObjectURL(url); }
}

/** Plain text with its web addresses turned into links that open outside the app; nothing else is interpreted. */
function Linked({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>()（）「」"'，。]+)/g);
  return <>{parts.map((part, index) => index % 2 ? <a key={index} href={part} target="_blank" rel="noopener noreferrer">{part.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").slice(0, 48)}{part.replace(/^https?:\/\/(www\.)?/, "").length > 48 ? "…" : ""}</a> : part)}</>;
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
