import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PawPrint, GameController, Sparkle, UserCircle, Drop, ShareNetwork, ChatCircleText, Lightbulb, WhatsappLogo, ForkKnife, ShoppingCart, ArrowLeft, ArrowRight, ArrowSquareOut, At, CalendarPlus, EnvelopeSimple, MapPin, Phone, CalendarBlank, ChatCircleDots, ChatsCircle, CheckCircle, Heart, ClockCounterClockwise, Copy, GearSix, HandHeart, ImageSquare, Images, LinkSimple, List, ListBullets, ListChecks, LockKey, Microphone, NotePencil, PaperPlaneRight, StopCircle, UserPlus, UsersThree, X } from "@phosphor-icons/react";
import { PendingAgreementTools, PlanTerms } from "../agreements/PendingAgreement";
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
import { OnboardingTour, characterOwed, tourSeen } from "./OnboardingTour";
import { DailyQuestionCard, type DailyAnswers } from "./DailyQuestionCard";
import { WatchCheckCard } from "../moments/WatchedShelf";
import { GameCard, type GameAnswers, type GameRound } from "./GameCard";
import { DistanceBar } from "./DistanceBar";
import { DiscoveryCard, type DiscoverKey } from "./DiscoveryCard";
import { FloatingPet, PetRoom, petHiddenKey, type PetView } from "../character/PetPanel";
import { useCoupleCharacter } from "../character/character";
import { AgentStatusPill, AgentTyping, type AgentActivity } from "./AgentWorking";
import { PromiseNudge } from "../promises/PromiseNudge";
import { promiseToMention, type PromiseItem } from "../promises/promises";
import { GameHall } from "../games/GameHall";
import { MatchInviteCard } from "../games/MatchInviteCard";
import "./conversation.css";

type Channel = "me" | "us";
type Card = { id: string; kind: string; title: string; text?: string | null; status: string; version: number; digest?: string; url?: string; localDateTime?: string; openOn?: string; shareKind?: "date" | "agreement" };
type SpaceSummary = { id: string; title: string; layout: string; visibility: string; system?: string };
type CallTranscript = { minutes: number; rows: Array<{ role: string; text: string }> };
type PrivateMessage = { id: string; role: "user" | "assistant"; kind?: string; text: string; createdAt: string; cards?: Card[]; photoIds?: string[]; call?: CallTranscript; dateCheck?: { title: string; date: string }; dateAnswer?: { rating: "great" | "ok" | "meh"; told: boolean } };
type Attachment = { key: string; preview: string; id: string | null; failed?: boolean };
type Session = { id: string; language: Language; timezone: string; version: number; messages: PrivateMessage[] };
type Ref = { type: string; id: string; version?: number; title?: string; url?: string; requestFor?: string; system?: string; openOn?: string };
type SharedMessage = { id: string; role: "member" | "agent"; actorUserId: string | null; recordedByUserId?: string; kind: "text" | "relay" | "agreement_card" | "reminder" | "review" | "call" | "story" | "daily_question" | "nudge" | "letter_sealed" | "letter" | "game" | "match_invite" | "watch_check"; watch?: { title: string; date: string }; watchAnswer?: { by: string; finished: boolean } | null; game?: GameRound; match?: { id: string; game: string; invitedBy: string }; call?: CallTranscript; story?: Story; answers?: DailyAnswers & GameAnswers; day?: string; text: string; i18n?: Partial<Record<Language, string>>; translations?: Partial<Record<Language, { text: string; options?: string[] }>>; refs: Ref[]; createdAt: string; photoIds?: string[] };
type Draft = { title: string; summary: string; terms: string[]; unresolvedPoints?: string[] };
type Together = { pet?: PetView | null; care?: { name: string } | null; nextMeeting?: { id: string; date: string; title: string } | null; conversation: { id: string; messages: SharedMessage[]; draftAgreement: Draft | null; zones?: Record<string, string>; archived?: { chunks: number; messages: number } }; pendingAgreement: (Draft & { id: string; version: number; status: string; approvedBy?: string[] }) | null; readOnly: boolean; members: Array<{ id: string; name: string }> };
type Pairing = { status: "pending" | "active"; invitation: { code: string } | null } | null;
type ApiError = Error & { status?: number; code?: string };
const AGENT_CALL = /\bpinky\b|@agent/i;
const STOP_VOICE = /^(暂停|先停下|停止聆听|结束语音|stop listening|stop voice|pause|deja de escuchar|pausa)[。.!！]?$/i;

/** The App's default screen: one private channel ("Just me", the member's assistant session) and one shared channel ("Us",
 * the couple's together conversation). Every rule lives on the server; this screen only renders and forwards explicit taps. */
/** Us is there by default; each member may hide it on their own screen (founder 11-06, "不一定用户喜欢这个界面"). Only this
 * device's view changes: the relationship, TA's side and everything shared stay as they are. */
export const usHiddenKey = (userId: string) => `pinky-us-hidden:${userId}`;
export const readUsHidden = (userId: string) => { try { return localStorage.getItem(usHiddenKey(userId)) === "1"; } catch { return false; } };

// Private records Pinky made that one tap can take back (server: assistant-router UNDOABLE).
const UNDOABLE = new Set(["reminder", "checkin", "memory", "space_item"]);

export function ConversationHome({ user, pairing, language, onOpen, onPrivacy, onFeedback, onPair, onRefreshPairing, onAccessChanged }: { user: { id: string; name: string }; pairing: Pairing; language: Language; onPrivacy: (page?: "character" | "profile" | "membership") => void; onFeedback: (from: string) => void; onLogout: () => void; onOpen: (url: string) => void; onPair: () => void; onRefreshPairing: () => Promise<void>; onAccessChanged: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const paired = pairing?.status === "active";
  const channelKey = `toward-us:conversation-channel:${user.id}`, sessionKey = `toward-us:conversation-session:${user.id}`;
  // A channel named in the URL (a page handing a sentence back) wins over the one remembered from last time.
  // Just me is the main entry (founder 11-06): the App opens there unless a link asks for Us; Pinky brings what concerns both of
  // them over to Us with a card to confirm.
  const [usHidden] = useState(() => readUsHidden(user.id));
  const [channel, setChannel] = useState<Channel>(() => { if (usHidden) return "me"; try { const asked = new URLSearchParams(location.search).get("channel"); return asked === "us" ? "us" : "me"; } catch { return "me"; } });
  const [session, setSession] = useState<Session | null>(null);
  const [together, setTogether] = useState<Together | null>(null);
  // 想你了 (founder 11-06): hearts float up when one is sent from here or arrives from the partner while Us is open.
  const [hearts, setHearts] = useState(0);
  const heartsSeen = useRef<string | null>(null);
  const [approved, setApproved] = useState<string[]>([]);
  // Pages of earlier Us messages the member asked for, kept apart from the live working set. `anchor` is the working set's
  // first message when the first page was fetched: if the working set moves on (older lines archived), the pages are dropped
  // rather than shown with a gap.
  const [older, setOlder] = useState<{ anchor: string; messages: SharedMessage[]; more: boolean } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const olderRef = useRef<HTMLDivElement>(null);
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
  // The couple's own character, shared by both; it floats under the top row once one of them has made it.
  const { character: mascot, refresh: refreshMascot, loaded: mascotLoaded } = useCoupleCharacter(paired);
  // Whoever took the tour before their partner joined never saw "make your character" with a button: once paired, and while
  // the couple has no character yet, that card comes once on its own.
  const [offerCharacter, setOfferCharacter] = useState(false);
  useEffect(() => { if (paired && !touring && mascotLoaded && !mascot && characterOwed(user.id)) setOfferCharacter(true); }, [paired, touring, mascotLoaded, mascot, user.id]);
  // 小家伙 (11-06): floats at the side of the chat; its room opens over the conversation. It can be tucked away from the room.
  const [petRoom, setPetRoom] = useState(false);
  // 游戏大厅 (11-06): opened from the drawer, from a game card in Us, or from a "轮到你了" notice (?game=<id>).
  const [gameHall, setGameHall] = useState<{ match: string | null } | null>(() => { const game = new URLSearchParams(location.search).get("game"); return game ? { match: game === "hall" ? null : game } : null; });
  const openGames = (match: string | null = null) => { keyboard.hide(); setGameHall({ match }); };
  const closeGames = () => { setGameHall(null); const params = new URLSearchParams(location.search); if (params.has("game")) { params.delete("game"); history.replaceState(history.state, "", `${location.pathname}${params.toString() ? `?${params}` : ""}`); } };
  const [petHidden, setPetHidden] = useState(() => { try { return localStorage.getItem(petHiddenKey(user.id)) === "1"; } catch { return false; } });
  const hidePet = (hidden: boolean) => { setPetHidden(hidden); try { if (hidden) localStorage.setItem(petHiddenKey(user.id), "1"); else localStorage.removeItem(petHiddenKey(user.id)); } catch { /* private mode */ } };
  const openPetRoom = () => { keyboard.hide(); setPetRoom(true); };
  // A few fresh things to say, made by Pinky from where the couple is; they change as the conversation moves on.
  const [ideas, setIdeas] = useState<Record<Channel, string[]>>({ me: [], us: [] });
  // Why each suggestion was made, in a few words (founder 11-07: trust you can see).
  const [reasons, setReasons] = useState<Record<Channel, string[]>>({ me: [], us: [] });
  // At most one open promise Pinky brings up in Us, only where suggestions may show (11-03); the server picks which.
  const [nudge, setNudge] = useState<PromiseItem | null>(null);
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
  // A 503 from Pinky already says what happened in the language the member writes in; only a bare status or code falls back.
  const serverWords = (message: string) => Boolean(message) && !/^Request failed \(\d+\)$/.test(message) && !/^[a-z_]+$/.test(message);
  const errorText = (error: ApiError) => error.code === "ai_daily_limit" ? error.message : error.status === 429 ? t("已达到使用上限，请稍后再试。", "A usage limit was reached. Try again later.", "Se alcanzó un límite de uso. Inténtalo más tarde.") : error.status === 503 && !serverWords(error.message) ? t("助手暂时不可用，什么都没有改动。请稍后重试。", "The assistant is unavailable right now. Nothing was changed; try again soon.", "El asistente no está disponible. No se cambió nada; inténtalo pronto.") : error.message;

  const store = (id: string | null) => { try { if (id) localStorage.setItem(sessionKey, id); else localStorage.removeItem(sessionKey); } catch { /* The session still works in memory. */ } };
  const current = (next: Session) => { sessionRef.current = next; setSession(next); };
  // One assistant session per member for this channel: reopen the remembered one, otherwise create it once.
  const restore = async () => {
    let id: string | null = null; try { id = localStorage.getItem(sessionKey); } catch { /* No stored session. */ }
    if (!id) { try { const result = await relationshipApi<{ session: Session }>("/api/assistant/sessions/latest"); current(result.session); store(result.session.id); return result.session; } catch { return null; } }
    try { const result = await relationshipApi<{ session: Session }>(`/api/assistant/sessions/${encodeURIComponent(id)}?opened=1`); current(result.session); return result.session; } catch { store(null); return null; }
  };
  const create = async (opened = false) => { const result = await relationshipApi<{ session: Session }>("/api/assistant/sessions", jsonBody({ language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", ...(opened ? { opened: true } : {}) })); current(result.session); store(result.session.id); return result.session; };
  const ensureSession = async (allowCreate = true, opened = false): Promise<Session | null> => {
    if (sessionRef.current) return sessionRef.current;
    const restored = await (restoring.current ||= restore().finally(() => { restoring.current = null; }));
    if (restored || !allowCreate) return restored;
    return creating.current ||= create(opened).finally(() => { creating.current = null; });
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
  const firstUsId = together?.conversation.messages[0]?.id;
  useEffect(() => { if (older && older.anchor !== firstUsId) setOlder(null); }, [firstUsId]);
  // After a page lands above, keep the line the member was looking at where it was instead of jumping to the top.
  useEffect(() => { if (older) olderRef.current?.scrollIntoView({ block: "start" }); }, [older?.messages.length]);
  // "更早的消息": the server keeps everything that moved out of the working set; each tap brings the previous page in.
  const loadOlder = async () => {
    const before = (older?.messages[0] || together?.conversation.messages[0])?.id;
    if (!before || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await relationshipApi<{ messages: SharedMessage[]; more: boolean }>(`/api/together/history?before=${encodeURIComponent(before)}&limit=50`);
      setOlder((current) => ({ anchor: current?.anchor || firstUsId || "", messages: [...page.messages, ...(current?.messages || [])], more: page.more }));
    } catch (error) { setNotice(errorText(error as ApiError)); } finally { setLoadingOlder(false); }
  };

  // Connected members always get a conversation on open, so Pinky can speak first to someone it barely knows (founder 11-08).
  useEffect(() => { void ensureSession(paired, true).catch(() => {}); }, [user.id, paired]);
  useEffect(() => { void loadTogether(); }, [loadTogether]);
  useEffect(() => {
    if (!paired) return;
    const events = new EventSource("/api/relationship/events");
    events.addEventListener("relationship", (event) => { try {
      const { eventType, objectId } = JSON.parse((event as MessageEvent).data);
      if (/^(together|agreement)/.test(eventType)) void loadTogether();
      // The partner made (or is making) the couple's character: show it here too.
      if (eventType === "character.updated") void refreshMascot();
      // Pinky started, moved on or finished a step in Us, possibly for the partner's question.
      if (eventType === "agent.activity") void checkActivity("us");
      // A question Pinky asked privately on behalf of Us: refresh this conversation and mark "Just me" if it is not in view.
      if (eventType === "assistant.updated" && (!sessionRef.current || sessionRef.current.id === objectId)) { void relationshipApi<{ session: Session }>(`/api/assistant/sessions/${encodeURIComponent(objectId)}`).then((result) => { current(result.session); store(result.session.id); if (channelRef.current !== "me") setUnreadMe(true); }).catch(() => {}); }
    } catch { /* Ignore malformed events. */ } });
    events.addEventListener("access-ended", () => { events.close(); accessChanged.current(); });
    return () => events.close();
  }, [paired, loadTogether, refreshMascot]);
  // While the invite waits, look every few seconds, so Us opens by itself once the partner joins (as the invite says).
  const refreshPairing = useRef(onRefreshPairing); refreshPairing.current = onRefreshPairing;
  useEffect(() => {
    if (pairing?.status !== "pending") return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refreshPairing.current().catch(() => {}); }, 4000);
    return () => window.clearInterval(timer);
  }, [pairing?.status]);
  useEffect(() => { setNotice(""); }, [language]);
  // Which step Pinky is on while it answers: asked every moment while this phone waits for a reply or Us shows a step, and on
  // each nudge from Us. Only the newest answer per channel counts, so a slow, older one cannot bring back an ended step.
  const [activity, setActivity] = useState<Record<Channel, AgentActivity>>({ me: null, us: null });
  const activityAsked = useRef<Record<Channel, number>>({ me: 0, us: 0 });
  const checkActivity = useCallback(async (target: Channel) => {
    const asked = ++activityAsked.current[target];
    try { const result = await relationshipApi<{ activity: AgentActivity }>(`/api/agent/activity?channel=${target}`); if (asked === activityAsked.current[target]) setActivity((current) => ({ ...current, [target]: result.activity })); }
    catch { /* The bubble keeps its last words; the reply ends it. */ }
  }, []);
  const waitingMe = pending.me > 0, waitingUs = agentWorking > 0, watchUs = paired && (waitingUs || Boolean(activity.us));
  useEffect(() => {
    if (!waitingMe && !watchUs) return;
    const look = () => { if (waitingMe) void checkActivity("me"); if (watchUs) void checkActivity("us"); };
    look(); const timer = window.setInterval(look, 800);
    return () => window.clearInterval(timer);
  }, [waitingMe, watchUs, checkActivity]);
  useEffect(() => { if (!waitingMe) { activityAsked.current.me++; setActivity((current) => ({ ...current, me: null })); } }, [waitingMe]);
  useEffect(() => { if (!waitingUs && paired) void checkActivity("us"); }, [waitingUs, paired, checkActivity]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.has("say") || params.has("channel")) window.history.replaceState(null, "", location.pathname);
    // A prefill from another page (Memories' Add / Find) waits for a tap on a phone: focusing while the page is still
    // changing opened the iPhone keyboard over the input (11-06). A computer with a mouse gets the cursor right away.
    if (params.has("say") && window.matchMedia?.("(pointer: fine)").matches) composerRef.current?.querySelector("textarea")?.focus();
  }, []);
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
  const missYou = async () => {
    setHearts((count) => count + 1);
    try {
      const result = await relationshipApi<{ message: { id: string } }>("/api/together/nudge", jsonBody({ language }));
      heartsSeen.current = result.message.id;
      await loadTogether();
    } catch (caught) { setNotice((caught as Error).message); }
  };
  // A 想你了 from the partner that arrives while Us is open floats the hearts too (once per nudge; not for old ones on open).
  useEffect(() => {
    if (!together) return;
    const latest = together.conversation.messages.filter((item) => item.kind === "nudge" && item.actorUserId !== user.id).at(-1);
    // The first load only notes what is already there (none counts too), so the first new one floats the hearts.
    if (heartsSeen.current === null) { heartsSeen.current = latest?.id || ""; return; }
    if (latest && heartsSeen.current !== latest.id) { heartsSeen.current = latest.id; if (channel === "us") setHearts((count) => count + 1); }
  }, [together, channel, user.id]);
  const startCall = async () => {
    keyboard.hide(); voice.stop(); setNotice("");
    if (channel === "us") { setCall({ channel: "us", sessionId: null }); return; }
    try { const active = await ensureSession(); setCall({ channel: "me", sessionId: active?.id || null }); } catch (error) { setNotice((error as Error).message); }
  };
  // 约会之后问一句: one tap answers privately; "tell them" sends the member's own words in Us.
  const answerDate = async (messageId: string, rating: "great" | "ok" | "meh") => {
    const active = sessionRef.current; if (!active) return; setBusy(true); setNotice("");
    try { current((await relationshipApi<{ session: Session }>(`/api/assistant/sessions/${encodeURIComponent(active.id)}/date-check`, jsonBody({ messageId, rating }))).session); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };
  const tellPartner = async (message: PrivateMessage) => {
    const active = sessionRef.current; if (!active || !message.dateCheck) return;
    await sendShared(t(`「${message.dateCheck.title}」我很开心，谢谢你 ❤️`, `I loved "${message.dateCheck.title}". Thank you ❤️`, `Me encantó «${message.dateCheck.title}». Gracias ❤️`));
    try { current((await relationshipApi<{ session: Session }>(`/api/assistant/sessions/${encodeURIComponent(active.id)}/date-check`, jsonBody({ messageId: message.id, told: true }))).session); } catch { /* The button stays; the message went. */ }
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
  // Voice input can also fill a daily-question answer: then what is heard goes into that card, not the composer.
  const dictation = useRef<((text: string) => void) | null>(null);
  const [dictating, setDictating] = useState("");
  const heard = async (text: string, itemId: string) => {
    if (STOP_VOICE.test(text.trim())) { voice.stop(); return null; }
    if (dictation.current) { dictation.current(text); return null; }
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
  const voiceActive = voice.listening || voice.connecting;
  const wasActive = useRef(false);
  useEffect(() => { if (wasActive.current && !voiceActive) { dictation.current = null; setDictating(""); } wasActive.current = voiceActive; }, [voiceActive]);
  const dictate = (id: string, append: ((text: string) => void) | null) => {
    keyboard.hide(); window.speechSynthesis?.cancel();
    dictation.current = append; setDictating(append ? id : "");
    if (!append) voice.stop(); else if (!voiceActive) void startVoice();
  };
  const toggleVoice = async () => {
    keyboard.hide(); window.speechSynthesis?.cancel();
    dictation.current = null; setDictating("");
    if (voice.listening || voice.connecting) { voice.stop(); return; }
    await startVoice();
  };
  const startVoice = async () => {
    setNotice("");
    if (phoneSpeech.current) { speech.start(); return; }
    try { const active = await ensureSession(); await realtime.start(`/api/assistant/sessions/${active!.id}/realtime`); }
    catch (error) { if (browserSpeechAvailable()) { phoneSpeech.current = true; speech.start(); } else setNotice(errorText(error as ApiError)); }
  };
  const switchChannel = (next: Channel) => { if (next === channel || (next === "us" && usHidden)) return; keyboard.hide(); voice.stop(); setNotice(""); setRevising(false); setAttachments([]); if (next === "me") setUnreadMe(false); setChannel(next); };
  // The drawer is modal navigation: dismiss the keyboard and voice before it covers the conversation.
  const openDrawer = () => { keyboard.hide(); voice.stop(); setDrawer(true); };
  const open = (url: string) => { keyboard.hide(); voice.stop(); onOpen(url); };

  const share = async (card: Card) => {
    if (!session) return; setBusy(true); setNotice("");
    try { const result = await relationshipApi<{ session: Session }>(`/api/assistant/sessions/${session.id}/share-confirm`, jsonBody({ cardId: card.id, digest: card.digest, confirm: true })); current(result.session); void loadTogether(); }
    catch (error) { setNotice(errorText(error as ApiError)); } finally { setBusy(false); }
  };
  // One tap takes back a private record Pinky just made (founder 11-07); it is archived and the card says "undone".
  const undo = async (card: Card) => {
    if (!session) return; setBusy(true); setNotice("");
    try { const result = await relationshipApi<{ session: Session }>(`/api/assistant/sessions/${session.id}/undo`, jsonBody({ cardId: card.id, kind: card.kind })); current(result.session); }
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
  // The partner who has not joined is the one to win over (founder 11-08, user research): the copied invite says in two lines
  // what is in it for them and that their own chat stays private, then the link.
  const inviteText = () => `${t("我在用 Pinky 帮我们记日子、出主意、把说好的事落实。你也有自己的私人对话，只有你能看到，我也看不到；我们俩的事要两个人都同意才算数。点这里加入：", "I'm using Pinky to keep our dates, ideas and agreements in one place. You get your own private chat that only you can see (I can't); anything about us only counts once we both agree. Join here: ", "Uso Pinky para nuestras fechas, ideas y acuerdos. Tú tienes tu propio chat privado que solo tú ves (yo no); lo nuestro solo cuenta si ambos estamos de acuerdo. Únete aquí: ")}${inviteUrl}`;
  const copyInvite = async () => { try { await navigator.clipboard.writeText(inviteText()); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setNotice(inviteText()); } };

  // A letter's opening day, written out ("2027年3月5日", "March 5, 2027").
  const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(languageTag(language), { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const partnerName = together?.members.find((member) => member.id !== user.id)?.name || t("TA", "Your partner", "Tu pareja");
  const pendingAgreement = together?.pendingAgreement;
  // Recommend Pinky to friends: the phone's own share sheet when it has one, else the link is copied.
  const sharePinky = async () => {
    const url = "https://agentcert.app/";
    const text = t("我在用 Pinky：两个人的 AI，帮我们好好说话、说到做到、记住在一起的日子。你们也试试：", "I'm using Pinky, an AI for two that helps us talk, keep our promises and remember our days together. Try it:", "Uso Pinky, una IA para dos que nos ayuda a hablar, cumplir lo que prometemos y recordar nuestros días. Pruébala:");
    try { if (navigator.share) { await navigator.share({ title: "Pinky", text, url }); return; } } catch (error) { if ((error as Error).name === "AbortError") return; }
    try { await navigator.clipboard.writeText(`${text} ${url}`); setNotice(t("链接已复制，发给朋友吧。", "Link copied. Send it to a friend.", "Enlace copiado. Envíaselo a alguien.")); }
    catch { setNotice(`${text} ${url}`); }
  };
  // 小游戏: answer a round, or start another ("再来一局").
  const answerWatch = async (id: string, finished: boolean) => {
    setNotice("");
    try { await relationshipApi(`/api/together/watched/${encodeURIComponent(id)}/answer`, jsonBody({ finished, language })); await loadTogether(); }
    catch (error) { setNotice((error as Error).message); }
  };
  const answerGame = async (id: string, answer: { choice?: number; text?: string }) => {
    setNotice("");
    try { await relationshipApi(`/api/together/games/${encodeURIComponent(id)}/answer`, jsonBody({ ...answer, language })); await loadTogether(); return true; }
    catch (error) { setNotice((error as Error).message); return false; }
  };
  const playAgain = async (type?: "choice" | "guess" | "truth") => { setNotice(""); try { await relationshipApi("/api/together/games", jsonBody({ language, ...(type ? { type } : {}) })); await loadTogether(); } catch (error) { setNotice((error as Error).message); } };
  // 主动展示功能: what the "try this" card does when tapped.
  const discover = (key: DiscoverKey) => {
    const say = (text: string, target: Channel) => { setDraft(text, target); composerRef.current?.querySelector("textarea")?.focus(); };
    if (key === "games") openGames();
    else if (key === "miss_you") void missYou();
    else if (key === "pet") void relationshipApi<{ pet: PetView }>("/api/together/pet", jsonBody({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", language })).then((result) => { setHearts((count) => count + 1); setTogether((current) => current && { ...current, pet: result.pet }); }).catch(() => {});
    else if (key === "profile") { keyboard.hide(); onPrivacy("profile"); }
    else if (key === "photos") open("/?view=moments");
    else if (key === "ideas") open("/?view=moments&ideas=1");
    else say({ meetup: t("Pinky，我们下次见面是 ", "Pinky, we next meet on ", "Pinky, nos vemos el "), recap: t("Pinky，给我们做一张最近的回顾", "Pinky, make us a recap of lately", "Pinky, haznos un resumen de estos días"), agreement: t("Pinky，把我们说好的写下来：", "Pinky, write down what we agreed: ", "Pinky, anota lo que acordamos: "), letter: t("帮我给 TA 写一封信，在这天打开：", "Help me write my partner a letter to open on ", "Ayúdame a escribir una carta para abrir el "), hard_words: t("我有句话不知道怎么跟 TA 说：", "There's something I don't know how to tell my partner: ", "Hay algo que no sé cómo decirle a mi pareja: "), reminder: t("提醒我 ", "Remind me to ", "Recuérdame ") }[key as "meetup"] || "", ["meetup", "ledger", "recap", "agreement"].includes(key) ? "us" : "me");
  };
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
  const placeholder = channel === "me" ? revising ? t("说说想怎么改…", "Tell me what to change…", "Dime qué cambiar…") : t("跟我说说…", "Talk to me…", "Cuéntame…") : askAgent ? t("问 Pinky…", "Ask Pinky…", "Pregúntale a Pinky…") : t("发给你们俩…", "Write to both…", "Para los dos…");

  const privateCard = (card: Card) => {
    if (card.kind === "chat_import") return <ImportCard key={card.id} id={card.id} language={language} onOpen={open} onFinished={() => void reloadSession()} />;
    if (card.kind === "partner_message") return <article key={card.id} className={`conversation-card partner-card is-${card.status}`} data-testid="partner-message-card">
      <header>{card.openOn ? <><EnvelopeSimple size={16} />{t(`一封信 · ${longDay(card.openOn)} 发给 TA`, `A letter · for ${longDay(card.openOn)}`, `Una carta · para el ${longDay(card.openOn)}`)}</> : <><LockKey size={16} />{t("想对 TA 说的话", "For your partner", "Para tu pareja")}</>}</header><p className={card.openOn ? "letter-text" : undefined}>{card.text}</p>
      {card.status === "draft" ? <><small>{card.openOn ? t(`确认后先替你存着，TA 完全不知道。${longDay(card.openOn)}那天 Pinky 会提醒你，一键用你自己的短信或邮件发给 TA。`, `Once you confirm, Pinky keeps it and your partner won't know. On ${longDay(card.openOn)} it reminds you, and you send it yourself in one tap by text or email.`, `Al confirmar, Pinky la guarda y tu pareja no lo sabrá. El ${longDay(card.openOn)} te avisa y la envías tú con un toque por mensaje o correo.`) : t("确认之前不会分享，你的原话也不会。", "Nothing is shared until you confirm, and your own words never are.", "No se comparte nada hasta que lo confirmes, y tus palabras originales nunca.")}</small><div className="card-actions">
        {paired ? <button className="card-primary" disabled={busy} onClick={() => void share(card)}>{card.openOn ? <><EnvelopeSimple size={18} weight="fill" />{t("存好，到那天提醒我", "Keep it and remind me", "Guárdala y avísame")}</> : <><PaperPlaneRight size={18} weight="fill" />{t("发送给 TA", "Send to partner", "Enviar a mi pareja")}</>}</button> : <button className="card-primary" onClick={() => switchChannel("us")}><UsersThree size={18} />{t("先邀请 TA", "Invite your partner first", "Invita primero a tu pareja")}</button>}
        <button disabled={busy} onClick={revise}>{t("再改改", "Edit", "Editar")}</button></div></> :
        <small className="card-state">{card.status === "shared" ? <><CheckCircle size={16} weight="fill" />{card.openOn ? t(`已存好，${longDay(card.openOn)}提醒你发给 TA`, `Kept; Pinky reminds you to send it on ${longDay(card.openOn)}`, `Guardada; Pinky te avisa para enviarla el ${longDay(card.openOn)}`) : t("已发到“我们俩”", "Sent to Us", "Enviado a Nosotros")}</> : t("已有更新的版本", "A newer version replaced this", "Una versión más nueva la reemplazó")}</small>}
    </article>;
    if (card.kind === "space_share") return <article key={card.id} className={`conversation-card partner-card is-${card.status}`} data-testid="space-share-card">
      <header>{card.shareKind === "agreement" ? <><UsersThree size={16} />{t("在“我们俩”起草约定", "Draft an agreement in Us", "Redactar un acuerdo en Nosotros")}</> : card.shareKind === "date" ? <><CalendarBlank size={16} />{t("放进你们俩的日历", "Put on your shared calendar", "Al calendario compartido")}</> : <><UsersThree size={16} />{t(`放进共同的“${card.title}”`, `Add to shared "${card.title}"`, `Añadir a «${card.title}» compartido`)}</>}</header><p>{card.text}</p>
      {card.status === "draft" ? <><small>{card.shareKind === "agreement" ? t("确认后放进“我们俩”，你们俩都点了同意才算数。", "Once you confirm it goes into Us; it counts when you both agree.", "Al confirmar pasa a Nosotros; cuenta cuando los dos estén de acuerdo.") : card.shareKind === "date" ? t("确认后你们俩的日历上都会有，前一天 Pinky 提醒你们。", "Once you confirm it's on both your calendars, with a reminder the day before.", "Al confirmar estará en el calendario de los dos, con aviso un día antes.") : t("确认后你们俩都能看到。", "Once you confirm, both of you can see it.", "Cuando lo confirmes, los dos podrán verlo.")}</small><div className="card-actions"><button className="card-primary" disabled={busy} onClick={() => void confirmSpace(card)}><CheckCircle size={18} weight="fill" />{t("确认放进去", "Confirm", "Confirmar")}</button></div></> :
        card.status === "shared" ? <small className="card-state"><CheckCircle size={16} weight="fill" />{card.shareKind === "agreement" ? t("已放进“我们俩”，等你们俩点头", "In Us, waiting for you both to agree", "En Nosotros, esperando que los dos acepten") : card.shareKind === "date" ? t("已放进你们俩的日历", "On your shared calendar", "En su calendario compartido") : t("已放进共同空间", "Added to the shared space", "Añadido al espacio compartido")}</small> : null}
    </article>;
    if (card.kind === "link" && card.url) return <div key={card.id} className="message-handoffs"><Handoff title={card.title} url={card.url} language={language} onOpen={open} /></div>;
    if (card.kind === "space_group") return <article key={card.id} className="conversation-card space-card"><header><ListBullets size={16} />{card.title || t("已放进空间", "Added to a space", "Añadido a un espacio")}</header>{card.text && <ul>{card.text.split("\n").map((line, index) => <li key={index}>{line}</li>)}</ul>}<div className="card-actions"><button onClick={() => open(card.url!)}>{t("打开", "Open", "Abrir")}<ArrowRight size={16} /></button></div></article>;
    return <article key={`${card.kind}:${card.id}`} className="conversation-card"><header>{card.title}</header>{card.text && <p>{card.text}</p>}{card.localDateTime && <small className="card-when">{card.localDateTime.replace("T", " ")}</small>}{card.status !== "unavailable" && card.status !== "undone" && (card.url || UNDOABLE.has(card.kind)) && <div className="card-actions">{card.url && <button onClick={() => open(card.url!)}>{t("打开详情", "Open details", "Abrir detalles")}<ArrowRight size={16} /></button>}{UNDOABLE.has(card.kind) && <button disabled={busy} onClick={() => void undo(card)} data-testid="card-undo">{t("撤销", "Undo", "Deshacer")}</button>}</div>}</article>;
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
  const sharedMessage = (message: SharedMessage, index: number) => {
    const mine = message.role === "member" && message.actorUserId === user.id;
    // Like a group chat: the avatar and name show once at the start of each run of lines from the same speaker.
    const previous = sharedMessages[index - 1];
    const continued = Boolean(previous && ["text", "relay"].includes(previous.kind) && previous.role === message.role && previous.actorUserId === message.actorUserId && !previous.recordedByUserId === !message.recordedByUserId);
    const recorder = message.recordedByUserId ? (message.recordedByUserId === user.id ? user.name : partnerName) : "";
    const author = message.role === "agent" ? "Pinky" : recorder ? `${message.actorUserId === user.id ? user.name : partnerName}${t(`（在 ${recorder} 的手机上说）`, ` (spoken on ${recorder}'s phone)`, ` (dicho en el teléfono de ${recorder})`)}` : mine ? "" : partnerName;
    // System copy is stored in every language; Pinky's own lines come with a translation into this member's language when
    // they were written in another one (shared-translate.mjs); members' own words are shown as written.
    const translated = message.translations?.[language];
    const text = message.i18n?.[language] ?? translated?.text ?? message.text;
    if (message.kind === "letter_sealed") {
      const openOn = String((message.refs || []).find((ref) => ref.type === "letter")?.openOn || "");
      const days = openOn ? Math.max(0, Math.round((Date.parse(`${openOn}T12:00:00`) - Date.now()) / 86_400_000)) : 0;
      return <article key={message.id} className="conversation-card letter-sealed" data-testid="letter-sealed"><EnvelopeSimple size={30} weight="fill" /><div><strong>{message.actorUserId === user.id ? t(`你给 ${partnerName} 写了一封信`, `You wrote ${partnerName} a letter`, `Le escribiste una carta a ${partnerName}`) : t(`${partnerName} 给你写了一封信`, `${partnerName} wrote you a letter`, `${partnerName} te escribió una carta`)}</strong><small>{openOn && t(`${longDay(openOn)} 打开 · 还有 ${days} 天`, `Opens ${longDay(openOn)} · ${days} days to go`, `Se abre el ${longDay(openOn)} · faltan ${days} días`)}</small></div></article>;
    }
    if (message.kind === "letter") return <article key={message.id} className="conversation-card letter-card" data-testid="letter"><header><EnvelopeSimple size={18} weight="fill" />{message.actorUserId === user.id ? t(`你写给 ${partnerName} 的信`, `Your letter to ${partnerName}`, `Tu carta para ${partnerName}`) : t(`${partnerName} 写给你的信`, `A letter from ${partnerName}`, `Una carta de ${partnerName}`)}</header><p className="letter-text">{message.text}</p></article>;
    if (message.kind === "nudge") return <p key={message.id} className="conversation-nudge" data-testid="nudge"><Heart size={15} weight="fill" />{message.actorUserId === user.id ? t(`你想 ${partnerName} 了`, `You're thinking of ${partnerName}`, `Estás pensando en ${partnerName}`) : t(`${partnerName} 想你了`, `${partnerName} is thinking of you`, `${partnerName} está pensando en ti`)}<time>{new Date(message.createdAt).toLocaleTimeString(languageTag(language), { hour: "numeric", minute: "2-digit" })}</time></p>;
    if (message.kind === "agreement_card") {
      const ref = message.refs.find((item) => item.type === "agreement");
      const live = ref && pendingAgreement && pendingAgreement.id === ref.id && pendingAgreement.version === ref.version && !together?.readOnly;
      const version = ref?.version || 1;
      return <article key={message.id} className={`conversation-card agreement-card ${live ? "is-live" : ""}`} data-testid="agreement-card"><header><UsersThree size={16} />{t("约定", "Agreement", "Acuerdo")}</header>{live ? <AgreementBody agreement={pendingAgreement!} language={language} onChanged={loadTogether} /> : <p>{text}</p>}
        {live && (approved.includes(`${ref!.id}:${version}`) || pendingAgreement!.approvedBy?.includes(user.id) ? <small className="card-state"><CheckCircle size={16} weight="fill" />{t(`你同意了，等 ${partnerName} 点头`, `You said yes. Waiting for ${partnerName}.`, `Dijiste que sí. Esperando a ${partnerName}.`)}</small> : <>
          {pendingAgreement!.approvedBy?.some((id) => id !== user.id) && <small className="card-state">{t(`${partnerName} 已经同意了，就差你`, `${partnerName} already said yes. It's up to you.`, `${partnerName} ya dijo que sí. Falta tu respuesta.`)}</small>}
          <div className="card-actions"><button className="card-primary" disabled={busy} onClick={() => void decide(ref!.id, version, "approve")}><CheckCircle size={18} weight="fill" />{t("我同意", "I agree", "Estoy de acuerdo")}</button><button disabled={busy} onClick={() => void decide(ref!.id, version, "request-change")}>{t("我想改一下", "I'd change something", "Quiero cambiar algo")}</button></div></>)}
      </article>;
    }
    if (message.kind === "match_invite" && message.match) return <MatchInviteCard key={message.id} match={message.match} userId={user.id} partnerName={partnerName} language={language} onOpen={openGames} />;
    if (message.kind === "game" && message.game) return <GameCard key={message.id} prompt={text} game={translated?.options?.length === message.game.options.length ? { ...message.game, options: translated.options } : message.game} answers={message.answers || {}} userId={user.id} members={together?.members || []} language={language} onAnswer={(answer) => answerGame(message.id, answer)} onAgain={() => void playAgain()} />;
    if (message.kind === "watch_check") return <WatchCheckCard key={message.id} language={language} text={text} answer={message.watchAnswer} members={together?.members || []} onAnswer={(finished) => void answerWatch(message.id, finished)} />;
    if (message.kind === "daily_question") return <DailyQuestionCard key={message.id} questionId={message.id} question={text} answers={message.answers || {}} userId={user.id} members={together?.members || []} language={language} current={message.id === todayQuestion?.id && Date.now() - Date.parse(message.createdAt) < 86_400_000} askedAt={message.createdAt} listening={dictating === message.id && voiceActive} onVoice={(append) => dictate(message.id, append)} onAnswer={(answer) => answerDaily(message.id, answer)} />;
    if (message.kind === "story" && message.story) { const story = message.story; return <div key={message.id} className="conversation-turn"><StoryCard language={language} story={story} onOpen={() => { keyboard.hide(); setOpenStory(story); }} /></div>; }
    if (message.kind === "call" && message.call) return <CallRecord key={message.id} language={language} title={text} call={message.call} />;
    if (message.kind === "reminder" || message.kind === "review") {
      const outcome = message.refs.find((item) => item.type === "outcome");
      // An agreement's check-in is answered in one tap (save time, not kill time, 11-07): the answer goes to Pinky as this
      // member's reply, within the check-in's 12 hours and until they have said something after it.
      const checkIn = message.kind === "review" && message.refs.some((item) => item.type === "agreement") && !together?.readOnly && Date.now() - Date.parse(message.createdAt) < 12 * 3_600_000 && !sharedMessages.slice(index + 1).some((item) => item.role === "member" && item.actorUserId === user.id);
      const quick = (zh: string, en: string, es: string) => <button key={en} disabled={busy} onClick={() => sendShared(t(zh, en, es))}>{t(zh, en, es)}</button>;
      return <article key={message.id} className="conversation-card notice-card"><header>{message.kind === "review" ? t("该复盘了", "Time to review", "Hora de revisar") : t("提醒", "Reminder", "Recordatorio")}</header><p>{text}</p>{outcome && <div className="card-actions"><button onClick={() => open(`/?view=decide&outcome=${encodeURIComponent(outcome.id)}`)}>{t("去复盘", "Start review", "Empezar revisión")}<ArrowRight size={16} /></button></div>}{checkIn && <div className="card-actions" data-testid="check-in-answers">{quick("这周做到了", "Kept it this week", "Lo cumplimos esta semana")}{quick("做到了一部分", "Partly", "En parte")}{quick("这周没做到", "Not this week", "Esta semana no")}</div>}</article>;
    }
    const links = message.role === "agent" ? message.refs.filter((ref) => ref.type === "space" || ref.type === "milestone") : [];
    const chatRequest = message.refs.find((ref) => ref.type === "chat_import_request"), chatShared = message.refs.find((ref) => ref.type === "chat_import");
    const handoffs = message.role === "agent" ? message.refs.filter((ref) => ref.type === "link" && ref.url) : [];
    const from = message.role === "agent" ? "from-agent" : mine ? "from-me" : "from-partner";
    const article = <article className={`conversation-message ${from}`}>{!continued && (author || message.kind === "relay") && <span>{author}{message.kind === "relay" && <em><LockKey size={13} />{t("本人确认后分享", "Shared after review", "Compartido tras revisarlo")}</em>}</span>}{!!message.photoIds?.length && <Photos ids={message.photoIds} />}{text && <p>{message.role === "agent" ? <Linked text={text} /> : text}</p>}
      {!!links.length && <div className="message-links">{links.map((ref) => <button key={`${ref.type}:${ref.id}`} onClick={() => open(ref.system === "watched" ? "/?view=moments&watched=1" : ref.system === "moments" ? "/?view=moments" : ref.type === "space" ? `/?view=space&space=${encodeURIComponent(ref.id)}` : "/?view=upcoming")}>{ref.system === "watched" ? t("一起看过的", "Watched together", "Vistos juntos") : ref.system === "moments" ? t("回忆", "Moments", "Momentos") : ref.type === "space" ? ref.title || t("打开空间", "Open space", "Abrir espacio") : t(`日期：${ref.title || ""}`, `Date: ${ref.title || ""}`, `Fecha: ${ref.title || ""}`)}<ArrowRight size={15} /></button>)}</div>}
      {!!handoffs.length && <div className="message-handoffs">{handoffs.map((ref) => <Handoff key={ref.id} title={ref.title || ""} url={ref.url!} language={language} onOpen={open} />)}</div>}
      {chatRequest && <div className="card-actions">{approvedImports.has(chatRequest.id) ? <small className="card-state"><CheckCircle size={16} weight="fill" />{t("已同意一起看", "Agreed to look together", "Aceptado para verlo juntos")}</small> : mine ? <small className="card-state">{t("等 TA 同意", "Waiting for your partner", "Esperando a tu pareja")}</small> : <button className="card-primary" disabled={busy} onClick={() => void approveImport(chatRequest.id)}><CheckCircle size={18} weight="fill" />{t("同意一起看", "Agree to look together", "Aceptar verlo juntos")}</button>}</div>}
      {chatShared && <div className="message-links"><button onClick={() => open(`/?view=import&import=${encodeURIComponent(chatShared.id)}`)}><ChatsCircle size={16} />{t("查看聊天记录分析", "See the chat history analysis", "Ver el análisis del historial")}<ArrowRight size={15} /></button></div>}
    </article>;
    if (mine) return <div key={message.id} className="us-row from-me">{article}</div>;
    // Partner and Pinky sit on the left, each with their own avatar so the two are told apart at a glance.
    return <div key={message.id} className={`us-row ${from}${continued ? " is-continued" : ""}`}><i className={`us-avatar${message.role === "agent" ? " is-pinky" : ""}`} aria-hidden="true">{continued ? "" : message.role === "agent" ? "P" : (partnerName || "?").slice(0, 1).toUpperCase()}</i>{article}</div>;
  };

  // B: the partner approves looking at the other's chat-history analysis together; only then does a shared copy exist.
  const approveImport = async (id: string) => {
    setBusy(true); setNotice("");
    try { await importAction(id, "share-approve", { language }); } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };
  const suggest = (items: string[], target: Channel) => <div className="conversation-suggestions" data-testid="composer-ideas">{items.map((text, index) => <button key={text} onClick={() => { setDraft(text, target); composerRef.current?.querySelector("textarea")?.focus(); }}>{text}{reasons[target][index] && <small className="suggestion-why" data-testid="suggestion-why">{reasons[target][index]}</small>}</button>)}<button type="button" className="conversation-suggestions-all" onClick={() => open("/?view=capabilities")} data-testid="see-capabilities">{t("Pinky 还能做什么 →", "More Pinky can do →", "Más cosas de Pinky →")}</button></div>;
  const meEmpty = <section className="conversation-empty"><h1>{t("想说什么都可以", "Say anything", "Di lo que quieras")}</h1><p>{t("这里只有你能看到。想记的、想查的、难开口的，都可以跟 Pinky 说；要给 TA 的话，你确认后才会发出。", "Only you can see this. Tell Pinky what to remember, look up or plan, or what is hard to say; nothing reaches your partner until you confirm.", "Solo tú puedes ver esto. Dile a Pinky qué recordar, buscar o planear, o lo que te cuesta decir; nada llega a tu pareja hasta que lo confirmes.")}</p><button type="button" className="conversation-empty-link" onClick={() => open("/?view=capabilities")} data-testid="empty-capabilities">{t("看看 Pinky 能做什么", "See what Pinky can do", "Mira lo que puede hacer Pinky")}</button></section>;
  const usEmpty = <section className="conversation-empty"><h1>{t("你们俩和 Pinky", "The two of you, plus Pinky", "Ustedes dos y Pinky")}</h1><p>{t("你们两人都能看到这里。Pinky 平时不插话；叫一声“Pinky”或点 @，它就来帮忙。", "You both see everything here. Pinky stays quiet until you say “Pinky” or tap @.", "Los dos ven todo aquí. Pinky no interviene hasta que digan «Pinky» o toquen @.")}</p></section>;
  const invite = <section className="conversation-empty conversation-invite" data-testid="conversation-invite"><h1>{t("邀请 TA 一起来", "Invite your partner", "Invita a tu pareja")}</h1><p>{t("“我们俩”是你们两个人和 Pinky 的共同对话。TA 用自己的账号加入后，这里就会打开。", "Us is the shared conversation for the two of you and Pinky. It opens once your partner joins with their own account.", "Nosotros es la conversación compartida entre ustedes dos y Pinky. Se abre cuando tu pareja se une con su propia cuenta.")}</p>
    {pairing?.invitation ? <><div className="invite-code"><span>{t("邀请码", "Invite code", "Código de invitación")}</span><strong>{pairing.invitation.code}</strong></div><div className="card-actions"><button className="card-primary" onClick={() => void copyInvite()}><Copy size={18} />{copied ? t("已复制", "Copied", "Copiado") : t("复制邀请链接", "Copy invite link", "Copiar enlace")}</button><button disabled={busy} onClick={() => void onRefreshPairing()}>{t("检查是否已加入", "Check connection", "Comprobar conexión")}</button></div></> :
      <div className="card-actions"><button className="card-primary" disabled={busy} onClick={() => void createInvite()}><LinkSimple size={18} />{t("生成邀请链接", "Create invite link", "Crear enlace de invitación")}</button><button onClick={() => { keyboard.hide(); onPair(); }}>{t("我有邀请码", "I have a code", "Tengo un código")}</button></div>}
  </section>;

  const privateMessages = session?.messages || [];
  // An import is reported twice (received, then read); its live card shows only on the latest of those messages.
  const importAt = new Map(privateMessages.flatMap((message, index) => (message.cards || []).filter((card) => card.kind === "chat_import").map((card) => [card.id, index] as const)));
  // Earlier pages sit above the live working set; one list keeps the group-chat run detection working across the seam.
  const olderMessages = older?.messages || [], sharedMessages = [...olderMessages, ...(together?.conversation.messages || [])];
  const hasOlder = Boolean(paired && together) && (older ? older.more : (together?.conversation.archived?.messages || 0) > 0);
  const lastSeen = channel === "me" ? privateMessages.at(-1)?.id || "" : sharedMessages.at(-1)?.id || "";
  const lastAt = Date.parse((channel === "me" ? privateMessages.at(-1)?.createdAt : sharedMessages.at(-1)?.createdAt) || "") || 0;
  const QUIET = 4 * 3_600_000;
  const wantIdeas = summoned === channel || (Date.now() - lastAt >= QUIET && Date.now() - dismissedAt[channel] >= QUIET);
  const showIdeas = wantIdeas && !draft.trim() && !voice.listening && !!ideas[channel].length && !readOnly && !(channel === "us" && !paired);
  const dismissIdeas = () => { setSummoned(null); setDismissedAt((current) => ({ ...current, [channel]: Date.now() })); };
  useEffect(() => { if (draft.trim() && wantIdeas) dismissIdeas(); }, [Boolean(draft.trim())]);
  const showNudge = channel === "us" && paired && wantIdeas && !draft.trim() && !voice.listening && !readOnly && Boolean(nudge);
  useEffect(() => { if (showIdeas || showNudge) endRef.current?.scrollIntoView({ block: "end" }); }, [showIdeas, showNudge, ideas[channel].length]);
  useEffect(() => {
    if (channel !== "us" || !paired || !wantIdeas) return;
    let alive = true;
    promiseToMention(language).then((item) => { if (alive) setNudge(item); }).catch(() => {});
    return () => { alive = false; };
  }, [channel, language, paired, wantIdeas]);
  // Fresh ideas only when they would be shown, so a busy conversation does not ask the model after every message.
  useEffect(() => {
    if ((channel === "us" && !paired) || !wantIdeas) return;
    let alive = true;
    relationshipApi<{ suggestions: string[]; reasons?: string[] }>(`/api/suggestions?channel=${channel}&language=${language}`).then((result) => { if (alive) { setIdeas((current) => ({ ...current, [channel]: result.suggestions })); setReasons((current) => ({ ...current, [channel]: result.reasons || [] })); } }).catch(() => {});
    return () => { alive = false; };
  }, [channel, language, lastSeen, paired, wantIdeas]);
  // In Just me only this phone's own wait counts; in Us also a reply Pinky is preparing for the partner.
  const working: AgentActivity = channel === "me" ? (waitingMe ? activity.me || { step: "thinking" } : null) : paired ? activity.us || (waitingUs ? { step: "thinking" } : null) : null;
  const draftCard = channel === "us" && paired && together?.conversation.draftAgreement && !pendingAgreement && !together.readOnly ? together.conversation.draftAgreement : null;
  return <div className={`paper-screen conversation-home ${working ? "is-agent-working" : ""}`} data-testid="conversation-screen">
    {!!hearts && <div key={hearts} className="miss-you-hearts" aria-hidden="true">{Array.from({ length: 7 }, (_, index) => <Heart key={index} size={22 + (index % 3) * 8} weight="fill" style={{ left: `${12 + index * 12}%`, animationDelay: `${index * 0.09}s` }} />)}</div>}
    <header className="conversation-header">
      {/* One row: menu, the two channels, and a live voice call with Pinky (privately in Just me, for everyone in the room in Us). */}
      <div className="conversation-topline">
        <button className="conversation-menu" onClick={openDrawer} aria-label={t("打开菜单", "Open menu", "Abrir menú")} aria-expanded={drawer} data-testid="open-drawer"><List size={24} /></button>
        {usHidden ? <div className="conversation-segments single"><button type="button" className="active" aria-current="page"><LockKey size={17} />{t("只有我", "Just me", "Solo yo")}</button></div> : <div className="conversation-segments" role="tablist" aria-label={t("对话频道", "Conversation channel", "Canal de conversación")}>
          <button role="tab" aria-selected={channel === "me"} className={channel === "me" ? "active" : ""} onClick={() => switchChannel("me")}><LockKey size={17} />{t("只有我", "Just me", "Solo yo")}{unreadMe && <i className="tab-dot" aria-label={t("有新消息", "New message", "Mensaje nuevo")} />}</button>
          <button role="tab" aria-selected={channel === "us"} className={channel === "us" ? "active" : ""} onClick={() => switchChannel("us")}><UsersThree size={17} />{t("我们俩", "Us", "Nosotros")}{unreadUs && <i className="tab-dot" aria-label={t("有新消息", "New message", "Mensaje nuevo")} />}</button>
        </div>}
        {channel === "us" && paired && <button className="conversation-call conversation-heart" onClick={() => void missYou()} aria-label={t("想你了", "Thinking of you", "Pienso en ti")} data-testid="miss-you"><Heart size={22} weight="fill" /></button>}
        <button className="conversation-call" onClick={() => void startCall()} disabled={Boolean(call) || (channel === "us" && !paired)} aria-label={t("和 Pinky 通话", "Call Pinky", "Llamar a Pinky")} data-testid="start-call"><Phone size={22} /></button>
      </div>
      {channel === "us" && paired && together && (() => { const partner = together.members.find((member) => member.id !== user.id); return partner ? <DistanceBar language={language} partnerName={partner.name || t("TA", "Your partner", "Tu pareja")} partnerZone={together.conversation.zones?.[partner.id] || null} nextMeeting={together.nextMeeting || null} care={Boolean(together.care)} /> : null; })()}
      {working && <div className="agent-status-top"><AgentStatusPill activity={working} language={language} /></div>}
    </header>
    <div className="conversation-stream"><MobileScroll className="conversation-scroll"><main className="conversation-thread" aria-live="polite">
      {channel === "me" ? <>{!privateMessages.length && !queued.length && meEmpty}{privateMessages.map((message, index) => message.kind === "noted" ? <button key={message.id} type="button" className="conversation-noted" onClick={() => { keyboard.hide(); onPrivacy("profile"); }} data-testid="profile-noted"><Heart size={14} weight="fill" /><span>{message.text}</span></button> : <div key={message.id} className="conversation-turn"><article className={`conversation-message ${message.role === "user" ? "from-me" : "from-agent"}`}>{message.call && <CallRecord language={language} title="" call={message.call} />}{message.role === "assistant" && !message.call && <span>Pinky</span>}{!!message.photoIds?.length && <Photos ids={message.photoIds} />}{message.text && <p>{message.role === "assistant" ? <Linked text={message.text} /> : message.text}</p>}</article>{groupCards((message.cards || []).filter((card) => card.kind !== "chat_import" || importAt.get(card.id) === index)).map(privateCard)}{message.dateCheck && !message.dateAnswer && <div className="card-actions date-check-answers" data-testid="date-check-answers">{([["great", "很开心", "Loved it", "Me encantó"], ["ok", "还行", "It was okay", "Estuvo bien"], ["meh", "不太行", "Not great", "No tanto"]] as const).map(([rating, zh, en, es]) => <button key={rating} disabled={busy} onClick={() => void answerDate(message.id, rating)}>{t(zh, en, es)}</button>)}</div>}{message.dateCheck && message.dateAnswer?.rating === "great" && !message.dateAnswer.told && paired && <div className="card-actions date-check-answers"><button disabled={busy} onClick={() => void tellPartner(message)} data-testid="date-check-tell"><Heart size={16} weight="fill" />{t(`也告诉 ${partnerName || "TA"}`, `Tell ${partnerName || "them"} too`, `Díselo a ${partnerName || "tu pareja"}`)}</button></div>}</div>)}</> :
        !paired ? invite : <>{!sharedMessages.length && usEmpty}
          {hasOlder && <button type="button" className="conversation-earlier" disabled={loadingOlder} onClick={() => void loadOlder()} data-testid="earlier-messages">{loadingOlder ? t("正在找…", "Loading…", "Cargando…") : t("更早的消息", "Earlier messages", "Mensajes anteriores")}</button>}
          {sharedMessages.slice(0, olderMessages.length).map(sharedMessage)}<div ref={olderRef} className="conversation-seam" aria-hidden="true" />{sharedMessages.slice(olderMessages.length).map((message, index) => sharedMessage(message, index + olderMessages.length))}
          {draftCard && <article className="conversation-card draft-card" data-testid="agreement-draft"><header><ChatCircleDots size={16} />{t("Pinky 起草的约定", "Agreement drafted by Pinky", "Acuerdo redactado por Pinky")}</header><strong>{draftCard.title}</strong><p>{draftCard.summary}</p><ol>{draftCard.terms.map((term) => <li key={term}>{term}</li>)}</ol>{!!draftCard.unresolvedPoints?.length && <div className="agreement-open"><small>{t("还没定的", "Still open", "Pendiente")}</small><ul>{draftCard.unresolvedPoints.map((point, index) => <li key={index}>{point}</li>)}</ul></div>}<small>{t("发出后，你们俩都要批准同一版本才生效。", "Once sent, it takes effect only when both of you approve the same version.", "Una vez enviado, solo entra en vigor cuando ambos aprueben la misma versión.")}</small><div className="card-actions"><button className="card-primary" disabled={busy} onClick={() => void draftAgreement()}>{t("发给你们俩批准", "Send for both to approve", "Enviar para que ambos aprueben")}</button></div></article>}
        </>}
      {voice.partial && <p className="conversation-partial">{voice.partial.text || t("正在听…", "Listening…", "Escuchando…")}</p>}
      {channel === "me" && queued.map((item) => <article key={item.itemId} className="conversation-message from-me is-sending"><p>{item.text}</p></article>)}
      {working && <AgentTyping activity={working} language={language} inUs={channel === "us"} />}
      {!readOnly && <DiscoveryCard userId={user.id} channel={channel} paired={paired} language={language} partnerName={partnerName} refreshKey={(together?.conversation.messages.length || 0) + privateMessages.length} onAction={discover} />}
      {showNudge && <PromiseNudge item={nudge!} partnerName={partnerName} language={language} onSettled={() => setNudge(null)} onOpenAll={() => open("/?view=upcoming")} />}
      {showIdeas && suggest(ideas[channel], channel)}
      <div ref={endRef} />
    </main></MobileScroll></div>
    {call && <footer className="conversation-composer conversation-call-footer"><CallPanel language={language} started={call} partnerName={partnerName} onEnded={(message) => { setCall(null); if (message) setNotice(message); void reloadSession(); }} /></footer>}
    {!call && !(channel === "us" && !paired) && <footer className="conversation-composer" ref={composerRef}>
      {notice && <p className="conversation-notice" role="alert">{notice}</p>}
      {failed && channel === "me" && <div className="conversation-retry"><span>{t("这句话还没确认送达。", "This message was not confirmed.", "Este mensaje no se confirmó.")}</span><button disabled={pending.me > 0} onClick={() => void sendPrivate(failed.text, failed.itemId, false, failed.photoIds)}>{t("重试", "Retry", "Reintentar")}</button></div>}
      {voice.listening && channel === "me" && <p className="conversation-listening">{t("正在听。说“结束语音”即可停止。", "Listening. Say “stop listening” to finish.", "Escuchando. Di «deja de escuchar» para terminar.")}</p>}
      {voice.listening && channel === "us" && !dictating && <div className="together-voice" data-testid="together-voice">
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
    {touring && <OnboardingTour language={language} userId={user.id} paired={paired} onInvite={() => switchChannel("us")} onCharacter={() => { keyboard.hide(); onPrivacy("character"); }} onDone={() => setTouring(false)} />}
    {offerCharacter && !touring && !mascot && <OnboardingTour characterOnly language={language} userId={user.id} paired={paired} onInvite={() => switchChannel("us")} onCharacter={() => { keyboard.hide(); onPrivacy("character"); }} onDone={() => setOfferCharacter(false)} />}
    {openStory && <StoryView language={language} story={openStory} onClose={() => setOpenStory(null)} />}
    {paired && together?.pet && !petHidden && !petRoom && !gameHall && <FloatingPet userId={user.id} language={language} pet={together.pet} character={mascot} onOpen={openPetRoom} />}
    {petRoom && together?.pet && <PetRoom language={language} pet={together.pet} character={mascot} members={together.members} userId={user.id} hidden={petHidden} onHiddenChange={hidePet} onPetted={(pet) => { setHearts((count) => count + 1); setTogether((current) => current && { ...current, pet }); }} onMakeCharacter={() => { setPetRoom(false); onPrivacy("character"); }} onMembership={() => { setPetRoom(false); onPrivacy("membership"); }} onClose={() => setPetRoom(false)} />}
    {gameHall && paired && <GameHall language={language} userId={user.id} initialMatch={gameHall.match} petPicture={mascot?.image && mascot.visible ? mascot.image.still : null} onClose={closeGames} onPlayCard={(type) => { closeGames(); switchChannel("us"); void playAgain(type); }} />}
    {drawer && <ConversationDrawer user={user} paired={paired} language={language} onPet={together?.pet ? () => { setDrawer(false); openPetRoom(); } : undefined} onClose={() => setDrawer(false)} onOpen={(url) => { setDrawer(false); open(url); }} onInvite={() => { setDrawer(false); switchChannel("us"); }} onPrivacy={() => { setDrawer(false); onPrivacy(); }} onProfile={() => { setDrawer(false); keyboard.hide(); onPrivacy("profile"); }} onGame={() => { setDrawer(false); openGames(); }} onShare={() => { setDrawer(false); void sharePinky(); }} onFeedback={() => { setDrawer(false); onFeedback(channel === "us" ? "conversation-us" : "conversation-me"); }} />}
  </div>;
}

/** The top of every page opened from the drawer: the way back to the conversation and the page title, nothing else. */
// The back button names where it goes: the conversation, unless a page returns to another page (`backLabel`).
export function PageHeader({ language, title, onBack, backLabel }: { language: Language; title: string; onBack: () => void; backLabel?: string }) {
  return <header className="page-header"><button className="page-back" onClick={onBack} data-testid="back-to-conversation"><ArrowLeft size={20} />{backLabel || localized(language, "对话", "Chat", "Chat")}</button><h1>{title}</h1></header>;
}

type DrawerItem = { key: string; icon: ReactNode; label: string; badge?: number; onClick: () => void };
/** Left drawer: only places to look at what Pinky has done. Doing things happens in the conversation. */
function ConversationDrawer({ user, paired, language, onPet, onClose, onOpen, onInvite, onPrivacy, onProfile, onGame, onShare, onFeedback }: { user: { id: string; name: string }; paired: boolean; language: Language; onPet?: () => void; onClose: () => void; onOpen: (url: string) => void; onInvite: () => void; onPrivacy: () => void; onProfile: () => void; onGame: () => void; onShare: () => void; onFeedback: () => void }) {
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
  const moments: DrawerItem = { key: "moments", icon: <HandHeart size={22} />, label: t("回忆", "Moments", "Momentos"), onClick: () => onOpen("/?view=moments") };
  // Agreements live at the top of Coming up (founder 11-06), so one waiting for approval shows as Coming up's badge.
  const upcoming: DrawerItem = { key: "upcoming", icon: <CalendarBlank size={22} />, label: t("即将到来", "Coming up", "Próximamente"), badge: home?.pending, onClick: () => onOpen("/?view=upcoming") };
  const fixed: DrawerItem[] = paired ? [upcoming, moments] : [
    { key: "invite", icon: <UserPlus size={22} />, label: t("邀请 TA 一起来", "Invite your partner", "Invita a tu pareja"), onClick: onInvite },
    { key: "upcoming", icon: <CalendarBlank size={22} />, label: t("即将到来", "Coming up", "Próximamente"), onClick: () => onOpen("/?view=reminders") },
  ];
  const fixedSpaces: DrawerItem[] = [
    ...(paired ? [] : [moments]),
    // Entries for features that otherwise only start by talking (founder 11-06: "我不知道怎么用，去哪里用").
    ...(paired ? [
      { key: "profile", icon: <UserCircle size={22} />, label: t("关于我们", "About us", "Sobre nosotros"), onClick: onProfile },
      { key: "games", icon: <GameController size={22} />, label: t("小游戏", "Little games", "Juegos"), onClick: onGame },
      { key: "ideas", icon: <Sparkle size={22} weight="fill" />, label: t("100 件小事", "100 little things", "100 cosas"), onClick: () => onOpen("/?view=moments&ideas=1") },
      ...(onPet ? [{ key: "pet", icon: <PawPrint size={22} />, label: t("小家伙", "Little one", "Pequeño"), onClick: onPet }] : []),
    ] : []),
  ];
  const cycleRow: DrawerItem = { key: "cycle", icon: <Drop size={22} />, label: t("经期记录", "Period", "Periodo"), onClick: () => onOpen(`/?view=${paired ? "upcoming" : "reminders"}&focus=cycle`) };
  const layoutIcon: Record<string, ReactNode> = { checklist: <ListChecks size={22} />, timeline: <ClockCounterClockwise size={22} />, gallery: <Images size={22} />, notes: <NotePencil size={22} />, list: <ListBullets size={22} /> };
  const spaceRow = (space: SpaceSummary): DrawerItem => ({ key: `space-${space.id}`, icon: layoutIcon[space.layout] || layoutIcon.list, label: space.title, onClick: () => onOpen(`/?view=space&space=${encodeURIComponent(space.id)}`) });
  const ours = spaces.filter((space) => space.visibility === "shared").map(spaceRow);
  const mine = [...spaces.filter((space) => space.visibility === "private").map(spaceRow), ...(chats ? [{ key: "imports", icon: <ChatsCircle size={22} />, label: t("聊天记录", "Chat history", "Historial de chat"), onClick: () => onOpen("/?view=import") }] : []), cycleRow];
  const together = home?.since ? togetherStats(home.since, new Date().toLocaleDateString("en-CA")) : null;
  const row = (item: DrawerItem) => <button key={item.key} className="drawer-row" onClick={item.onClick} data-testid={`drawer-${item.key}`}>{item.icon}<span>{item.label}</span>{!!item.badge && <em aria-label={t(`${item.badge} 件待处理`, `${item.badge} waiting`, `${item.badge} pendientes`)}>{item.badge}</em>}</button>;
  return <div className="conversation-drawer-layer" data-testid="conversation-drawer">
    <button className="conversation-drawer-scrim" aria-label={t("关闭菜单", "Close menu", "Cerrar menú")} onClick={onClose} />
    <nav className="conversation-drawer" aria-label={t("菜单", "Menu", "Menú")} onPointerDown={(event) => { start.current = event.clientX; }} onPointerUp={(event) => { if (start.current !== null && event.clientX - start.current < -60) onClose(); start.current = null; }}>
      <header><div><strong>PINKY</strong><span>{user.name}</span>{together && <em className="drawer-together"><Heart size={12} weight="fill" />{t(`在一起 ${together.days} 天`, `Together ${together.days} days`, `Juntos ${together.days} días`)}</em>}</div><button onClick={onClose} aria-label={t("关闭菜单", "Close menu", "Cerrar menú")}><X size={22} /></button></header>
      <div className="drawer-group">{fixed.map(row)}</div>
      <div className="drawer-group"><h2>{paired ? t("我们俩的", "Ours", "Nuestro") : t("只有我的", "Just mine", "Solo mío")}</h2>{(paired ? ours : mine).map(row)}{fixedSpaces.map(row)}</div>
      {paired && !!mine.length && <div className="drawer-group"><h2>{t("只有我的", "Just mine", "Solo mío")}</h2>{mine.map(row)}</div>}
      <footer className="drawer-group">{row({ key: "capabilities", icon: <Lightbulb size={22} />, label: t("Pinky 能做什么", "What Pinky can do", "Qué puede hacer Pinky"), onClick: () => onOpen("/?view=capabilities") })}{row({ key: "share", icon: <ShareNetwork size={22} />, label: t("推荐给朋友", "Recommend to friends", "Recomendar a amigos"), onClick: onShare })}{row({ key: "feedback", icon: <ChatCircleText size={22} />, label: t("反馈", "Feedback", "Comentarios"), onClick: onFeedback })}{row({ key: "settings", icon: <GearSix size={22} />, label: t("设置", "Settings", "Ajustes"), onClick: onPrivacy })}</footer>
    </nav>
  </div>;
}

/** A hand-off: tapping finishes the thing on the phone (Maps, Messages, Mail, Phone, Calendar, a website). */
function Handoff({ title, url, language, onOpen }: { title: string; url: string; language: Language; onOpen?: (url: string) => void }) {
  // A page inside Pinky opens in place rather than in a new window.
  if (url.startsWith("/?view=") && onOpen) return <button className="handoff" onClick={() => onOpen(url)}><ArrowRight size={18} weight="bold" /><span>{title}</span></button>;
  const icon = url.startsWith("sms:") ? <ChatCircleDots size={18} weight="fill" /> : url.startsWith("tel:") ? <Phone size={18} weight="fill" /> : url.startsWith("mailto:") ? <EnvelopeSimple size={18} weight="fill" /> : url.includes("/api/handoff/event.ics") ? <CalendarPlus size={18} weight="fill" /> : url.includes("maps.apple.com") || url.includes("google.com/maps") ? <MapPin size={18} weight="fill" />
    : /\/\/(www\.)?wa\.me\//.test(url) ? <WhatsappLogo size={18} weight="fill" /> : /opentable\.com|resy\.com|yelp\.com|doordash\.com|ubereats\.com|dianping\.com/.test(url) ? <ForkKnife size={18} weight="fill" /> : /amazon\.com|instacart\.com|taobao\.com|google\.com\/search\?tbm=shop/.test(url) ? <ShoppingCart size={18} weight="fill" /> : <ArrowSquareOut size={18} weight="bold" />;
  const label = url.includes("/api/handoff/event.ics") ? `${localized(language, "加入日历", "Add to calendar", "Añadir al calendario")} · ${title}` : title;
  const link = <a className="handoff" href={url} target={/^(https?:|\/)/.test(url) ? "_blank" : undefined} rel="noopener noreferrer">{icon}<span>{label}</span></a>;
  // A message to someone else shows exactly what will go out, and to whom, before the person taps to send it themselves.
  const message = outgoing(url);
  if (!message) return link;
  return <div className="handoff-preview" data-testid="outgoing-preview">
    <small>{message.to ? localized(language, `发给 ${message.to}`, `To ${message.to}`, `Para ${message.to}`) : localized(language, "发送时选收件人", "Pick who it goes to when sending", "Elige a quién al enviar")}</small>
    {message.subject && <strong>{message.subject}</strong>}
    <p>{message.body}</p>
    {link}
  </div>;
}

/** A prepared text, WhatsApp or email to someone else, read back from its hand-off link. */
function outgoing(url: string): { to: string; subject?: string; body: string } | null {
  try {
    const sms = /^sms:([^?&]*)[?&]body=([\s\S]*)$/.exec(url);
    if (sms) return { to: decodeURIComponent(sms[1]), body: decodeURIComponent(sms[2]) };
    const parsed = new URL(url);
    if (parsed.protocol === "mailto:") { const body = parsed.searchParams.get("body") || ""; return body ? { to: decodeURIComponent(parsed.pathname), subject: parsed.searchParams.get("subject") || undefined, body } : null; }
    if (/^(www\.)?wa\.me$/.test(parsed.hostname)) { const body = parsed.searchParams.get("text") || ""; return body ? { to: parsed.pathname.replace(/\//g, "") ? `+${parsed.pathname.replace(/\D/g, "")}` : "", body } : null; }
  } catch { /* Not a message link. */ }
  return null;
}

/** Photos in a message: one large, or a tidy grid; each opens full size. */
function Photos({ ids }: { ids: string[] }) {
  return <div className={`message-photos count-${Math.min(ids.length, 3)}`}>{ids.map((id) => <a key={id} href={`/api/photos/${encodeURIComponent(id)}`} target="_blank" rel="noopener noreferrer"><img src={`/api/photos/${encodeURIComponent(id)}`} alt="" loading="lazy" draggable={false} /></a>)}</div>;
}

/** Shrinks a picked photo to at most 1600px on its long side as JPEG, so uploads stay small on mobile data. */
export async function shrink(file: File): Promise<Blob> {
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
function AgreementBody({ agreement, language, onChanged }: { agreement: Draft & { id: string; version: number; status: string }; language: Language; onChanged: () => void | Promise<void> }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const showTitle = agreement.title && agreement.title !== agreement.terms[0];
  // Settled here, in Us (founder 11-06: Coming up is for the whole relationship): the plan by day, the points still open to
  // answer in place, and a one-off plan's way onto the calendar.
  return <>
    {showTitle && <strong>{agreement.title}</strong>}
    <PlanTerms terms={agreement.terms} language={language} />
    <PendingAgreementTools agreement={agreement} language={language} onChanged={onChanged} />
    <small>{t("两个人都同意才算数。", "It counts once you both agree.", "Cuenta cuando los dos aceptan.")}</small>
  </>;
}
