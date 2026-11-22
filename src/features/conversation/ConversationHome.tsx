import type { Pairing } from "../../Prototype";
import { InviteBar, InvitePanel, usePartnerInvite } from "./PartnerInvite";
import { ReportReply } from "../feedback/ReportReply";
import { Fragment, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Copy, PawPrint, GameController, Sparkle, UserCircle, Drop, ChatCircleText, Lightbulb, WhatsappLogo, ForkKnife, ShoppingCart, ArrowLeft, ArrowRight, ArrowSquareOut, CalendarPlus, EnvelopeSimple, MapPin, Phone, CalendarBlank, ChatCircleDots, ChatsCircle, CheckCircle, Heart, ClockCounterClockwise, GearSix, HandHeart, ImageSquare, Images, List, ListBullets, ListChecks, LockKey, Microphone, NotePencil, PaperPlaneRight, StopCircle, ShareNetwork, UserPlus, UsersThree, X } from "@phosphor-icons/react";
import { PendingAgreementTools, PlanTerms } from "../agreements/PendingAgreement";
import { apiErrorText, counted, isolate, languageTag, localized, bareName, type Language } from "../../i18n";
import { KeyboardTextarea, MobileScroll, useKeyboard } from "../../mobile";
import { BottomSheet, useLayerOpen, useModalFocus, useSheetHistory } from "../navigation/Sheet";
import { useRealtimeTranscription } from "../../useRealtimeTranscription";
import { browserSpeechAvailable, useBrowserSpeech } from "../../useBrowserSpeech";
import { jsonBody, relationshipApi } from "../relationship/api";
import type { GraphRecord } from "../relationship/types";
import { ImportCard } from "../imports/ImportCard";
import { useImportDisclosure } from "../imports/ImportDisclosure";
import { importAction, importPastedChat, isChatFile, listImports, looksLikePastedChat, uploadChatFile } from "../imports/imports";
import { CallPanel, CallRecord } from "../call/CallPanel";
import { togetherStats } from "../moments/together";
import { StoryCard, StoryView, type Story } from "../story/StoryCard";
import { CharacterOffer, characterOwed } from "./OnboardingTour";
import { DailyQuestionCard, type DailyAnswerInput, type DailyAnswers, type DailyPlay } from "./DailyQuestionCard";
import { QuickReply } from "./QuickReply";
import { WatchCheckCard } from "../moments/WatchedShelf";
import { GameCard, type GameAnswers, type GameRound } from "./GameCard";
import { DistanceBar } from "./DistanceBar";
import { FloatingPet, PetRoom, petHiddenKey, type PetView } from "../character/PetPanel";
import { defaultMascot, useCoupleCharacter } from "../character/character";
import { AgentStatusPill, AgentTyping, type AgentActivity } from "./AgentWorking";
import { PromiseNudge } from "../promises/PromiseNudge";
import { promiseToMention, type PromiseItem } from "../promises/promises";
// The games open on demand, so their code loads after the conversation is on screen (fetched in the background once it
// is, so opening one is still instant).
const GameHall = lazyScreen(() => import("../games/GameHall").then((module) => module.GameHall));
const PlayTogether = lazyScreen(() => import("../games/PlayTogether").then((module) => module.PlayTogether));
const PlayDistance = lazyScreen(() => import("../games/PlayDistance").then((module) => module.PlayDistance));
const PlayPlans = lazyScreen(() => import("../games/PlayPlans").then((module) => module.PlayPlans));
import { MatchInviteCard } from "../games/MatchInviteCard";
import { PeopleRow, TogetherSheet, plainName, usePeople, type Person } from "../people/People";
import { RecallLinks, useConversationRecall, type ConversationSource } from "./RecallHistory";
import { OlderWindow } from "./OlderWindow";
import "./conversation.css";
import { lazyScreen } from "../../lazyScreen";
import { outbox } from "./outbox";
import { relationshipEvents } from "../relationship/events";

type Channel = "me" | "us";
type Card = { id: string; kind: string; title: string; text?: string | null; status: string; version: number; digest?: string; url?: string; localDateTime?: string; openOn?: string; shareKind?: "date" | "agreement" };
type SpaceSummary = { id: string; title: string; layout: string; visibility: string; system?: string };
type CallTranscript = { minutes: number; rows: Array<{ role: string; text: string }> };
type PrivateMessage = { stopped?: boolean; copyableReply?: string; screenshotPending?: boolean; sources?: ConversationSource[]; id: string; role: "user" | "assistant"; kind?: string; text: string; createdAt: string; cards?: Card[]; photoIds?: string[]; call?: CallTranscript; dateCheck?: { title: string; date: string }; dateAnswer?: { rating: "great" | "ok" | "meh"; told: boolean }; personId?: string };
type Attachment = { key: string; preview: string; id: string | null; failed?: boolean };
type Session = { id: string; language: Language; timezone: string; version: number; messages: PrivateMessage[]; earlierPages?: number };
type Ref = Partial<ConversationSource> & { type: string; id: string; version?: number; title?: string; url?: string; requestFor?: string; system?: string; openOn?: string };
type SharedMessage = { removedAt?: string; deliveredAt?: string; readAt?: string; replyTo?: string; id: string; role: "member" | "agent"; actorUserId: string | null; recordedByUserId?: string; kind: "text" | "relay" | "agreement_card" | "reminder" | "review" | "call" | "story" | "daily_question" | "nudge" | "letter_sealed" | "letter" | "game" | "match_invite" | "watch_check"; watch?: { title: string; date: string }; watchAnswer?: { by: string; finished: boolean } | null; game?: GameRound; match?: { id: string; game: string; invitedBy: string }; call?: CallTranscript; story?: Story; answers?: DailyAnswers & GameAnswers; dailyPlay?: DailyPlay; day?: string; text: string; i18n?: Partial<Record<Language, string>>; translations?: Partial<Record<Language, { text: string; options?: string[] }>>; refs: Ref[]; createdAt: string; photoIds?: string[] };
type Draft = { title: string; summary: string; terms: string[]; unresolvedPoints?: string[] };
type Together = { pet?: PetView | null; care?: { name: string } | null; nextMeeting?: { id: string; date: string; title: string } | null; conversation: { id: string; version?: number; messages: SharedMessage[]; draftAgreement: Draft | null; zones?: Record<string, string>; archived?: { chunks: number; messages: number } }; pendingAgreement: (Draft & { id: string; version: number; status: string; approvedBy?: string[] }) | null; readOnly: boolean; members: Array<{ id: string; name: string }> };
type ApiError = Error & { status?: number; code?: string };
type SharedRecipient = "partner" | "assistant";
type SharedSend = { text: string; itemId: string; photoIds: string[]; speaker: "me" | "partner"; recipient?: SharedRecipient };
type Unsent = { text: string; itemId: string; photoIds?: string[] };
const DRAFT_LIMIT = 2000;
const AGENT_CALL = /(?:^|[^\p{L}\p{N}_.@+-])@(?:ourever|pinky|agent)(?![a-z0-9_])|^\s*(?:ourever|pinky)(?:\s*[,，:：、]|\s+(?:help|please|can you|could you|ayuda|ayúda|por favor|puedes)\b|[， ]*(?:帮我们|帮我|请问|请帮))/iu;
const sharedRecipient = (text: string, ask: boolean | null): SharedRecipient => (ask ?? AGENT_CALL.test(text)) ? "assistant" : "partner";
const STOP_VOICE = /^(暂停|先停下|停止聆听|结束语音|stop listening|stop voice|pause|deja de escuchar|pausa)[。.!！]?$/i;

/** The App's default screen: one private channel ("Just me", the member's assistant session) and one shared channel ("Us",
 * the couple's together conversation). Every rule lives on the server; this screen only renders and forwards explicit taps. */
/** Us is there by default; each member may hide it on their own screen (founder 11-06, "不一定用户喜欢这个界面"). Only this
 * device's view changes: the relationship, TA's side and everything shared stay as they are. */
export const usHiddenKey = (userId: string) => `pinky-us-hidden:${userId}`;
export const readUsHidden = (userId: string) => { try { return localStorage.getItem(usHiddenKey(userId)) === "1"; } catch { return false; } };

// Private records Ourever made that one tap can take back (server: assistant-router UNDOABLE).
const UNDOABLE = new Set(["reminder", "checkin", "memory", "space_item"]);
// Back after this long away counts as opening the app again, so the fresh-start suggestions may show once more.
const REOPEN_AFTER = 30 * 60_000;

export function ConversationHome({ user, pairing, language, aiOff = false, aiOffReason = "", onOpen, onPrivacy, onFeedback, onPair, onRefreshPairing, onPairingChange, onAccessChanged }: { user: { id: string; name: string }; pairing: Pairing | null; language: Language; aiOff?: boolean; aiOffReason?: string; onPrivacy: (page?: "character" | "profile" | "membership" | "referrals" | "processors") => void; onFeedback: (from: string) => void; onLogout: () => void; onOpen: (url: string) => void; onPair: () => void; onRefreshPairing: () => Promise<void>; onPairingChange: (next: Pairing | null) => void; onAccessChanged: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const paired = pairing?.status === "active";
  const channelKey = `toward-us:conversation-channel:${user.id}`, sessionKey = `toward-us:conversation-session:${user.id}`;
  // A channel named in the URL (a page handing a sentence back) wins over the one remembered from last time.
  // Just me is the main entry (founder 11-06): the App opens there unless a link asks for Us; Ourever brings what concerns both of
  // them over to Us with a card to confirm.
  const [usHidden] = useState(() => readUsHidden(user.id));
  // Why the AI-off card is showing, when a tap on something that needs AI brought the member here (QA round 4).
  const [aiOffWhy, setAiOffWhy] = useState(aiOffReason);
  useEffect(() => { if (aiOffReason) setAiOffWhy(aiOffReason); }, [aiOffReason]);
  // The invite bar in Just me can be put away; the menu still invites (QA round 4).
  const inviteBarKey = `ourever:invite-bar-hidden:${user.id}`;
  const [inviteBarHidden, setInviteBarHidden] = useState(() => { try { return localStorage.getItem(inviteBarKey) === "1"; } catch { return false; } });
  const hideInviteBar = () => { setInviteBarHidden(true); try { localStorage.setItem(inviteBarKey, "1"); } catch { /* hidden for this visit */ } };
  const [channel, setChannel] = useState<Channel>(() => { if (usHidden) return "me"; try { const asked = new URLSearchParams(location.search).get("channel"); return asked === "us" || (!asked && (history.state as { channel?: string } | null)?.channel === "us") ? "us" : "me"; } catch { return "me"; } });
  const [session, setSession] = useState<Session | null>(null);
  const [noSavedSession, setNoSavedSession] = useState(false);
  const [sessionLoadFailed, setSessionLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [salutation, setSalutation] = useState(isolate(user.name));
  useEffect(() => {
    let active = true;
    relationshipApi<{ preferredName: string }>("/api/privacy/first-run", { signal: AbortSignal.timeout(12000) })
      .then(prefs => { if (active && prefs.preferredName) setSalutation(isolate(prefs.preferredName)); }).catch(() => {});
    return () => { active = false; };
  }, [user.id]);
  const [together, setTogether] = useState<Together | null>(null);
  // A partner who deleted their account leaves their shared Us history to this member, read-only, with a one-time note.
  const [former, setFormer] = useState<{ name: string; seen: boolean; messages: Array<{ id: string; role: string; mine: boolean; text: string }> } | null>(null);
  const [formerOpen, setFormerOpen] = useState(false);
  useEffect(() => { if (!paired) void relationshipApi<{ former: typeof former }>(`/api/privacy/former-us?language=${language}`).then((result) => setFormer(result.former)).catch(() => {}); }, [paired, language]);
  const seeFormer = () => { setFormer((current) => current && { ...current, seen: true }); void relationshipApi("/api/privacy/former-us/seen", jsonBody({})).catch(() => {}); };
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
  const draftKey = `ourever:conversation-drafts:${user.id}`;
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    let saved: Record<string, string> = {};
    try { saved = JSON.parse(localStorage.getItem(draftKey) || "{}") || {}; } catch { /* storage unavailable */ }
    const params = new URLSearchParams(location.search);
    const text = params.get("say")?.slice(0, 300);
    if (text) saved[params.get("channel") === "us" ? "us:" + (pairing?.id || "") : `me:${params.get("person") || ""}`] = text;
    return saved;
  });
  useEffect(() => { try { localStorage.setItem(draftKey, JSON.stringify(drafts)); } catch { /* keep editing in memory */ } }, [drafts, draftKey]);
  const [askAgent, setAskAgent] = useState<boolean | null>(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("channel") !== "us" || !params.get("say")?.trim()) return null;
    const requested = params.get("recipient");
    return requested === "assistant" ? true : requested === "partner" ? false : null;
  });
  // With third-party AI declined, everything said in Us goes to the partner: nothing is sent to a model.
  const recipientFor = (text: string): SharedRecipient => aiOff ? "partner" : sharedRecipient(text, askAgent);
  // Unconfirmed messages survive a reload on this device, each with its Retry and Delete; they go out again once online.
  const sharedOutbox = useMemo(() => outbox<SharedSend>(`ourever:unsent-us:${user.id}:${pairing?.id || ""}`), [user.id, pairing?.id]);
  const privateOutbox = useMemo(() => outbox<Unsent>(`ourever:unsent-me:${user.id}`), [user.id]);
  const [unconfirmedShared, setUnconfirmedShared] = useState<SharedSend[]>(() => paired ? sharedOutbox.read() : []);
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
  const { ask: confirmImport, dialog: importDialog } = useImportDisclosure(language);
  const pastedDraft = useRef<Record<Channel, boolean>>({ me: false, us: false });
  const [queued, setQueued] = useState<Array<{ text: string; itemId: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<Unsent[]>(() => privateOutbox.read());
  const [notice, setNotice] = useState("");
  const invitation = usePartnerInvite({ userId: user.id, language, pairing, onPairingChange, onRefreshPairing });
  // A link to the spaces without naming one opens the menu, where the spaces are listed.
  const [drawer, setDrawer] = useState(() => { const params = new URLSearchParams(location.search); return params.get("view") === "space" && !params.get("space"); });
  const [call, setCall] = useState<{ channel: Channel; sessionId: string | null } | null>(null);
  const [openStory, setOpenStory] = useState<Story | null>(null);
  // The couple's own character, shared by both; it floats under the top row once one of them has made it.
  const { character: mascot, refresh: refreshMascot, loaded: mascotLoaded } = useCoupleCharacter(paired);
  // Whoever took the tour before their partner joined never saw "make your character" with a button: once paired, and while
  // the couple has no character yet, that card comes once on its own.
  const [offerCharacter, setOfferCharacter] = useState(false);
  useEffect(() => { if (paired && mascotLoaded && !mascot && characterOwed(user.id)) setOfferCharacter(true); }, [paired, mascotLoaded, mascot, user.id]);
  // 小家伙 (11-06): floats at the side of the chat; its room opens over the conversation. It can be tucked away from the room.
  const [petRoom, setPetRoom] = useState(false);
  // 游戏大厅 (11-06): opened from the drawer, from a game card in Us, or from a "轮到你了" notice (?game=<id>).
  const [gameHall, setGameHall] = useState<{ match: string | null } | null>(() => { const game = new URLSearchParams(location.search).get("game"); return game ? { match: game === "hall" ? null : game } : null; });
  const [playTogether, setPlayTogether] = useState<{ cardId?: string; fromGames?: boolean } | null>(() => {
    const params = new URLSearchParams(location.search);
    return params.get("play") === "today" ? {} : null;
  });
  const [interaction, setInteraction] = useState<"touch" | "cards" | null>(() =>
    paired && !usHidden && new URLSearchParams(location.search).get("distance") === "1" ? "cards" : null);
  const [openQuestionId, setOpenQuestionId] = useState<string | null>(null);
  const [planQuestionId, setPlanQuestionId] = useState<string | null>(null);
  const openGames = (match: string | null = null) => {
    keyboard.hide();
    if (paired) setGameHall({ match });
    else setPlayTogether({});
  };
  const closeGames = () => { setGameHall(null); const params = new URLSearchParams(location.search); if (params.has("game")) { params.delete("game"); history.replaceState(history.state, "", `${location.pathname}${params.toString() ? `?${params}` : ""}`); } };
  const [petHidden, setPetHidden] = useState(() => { try { return localStorage.getItem(petHiddenKey(user.id)) === "1"; } catch { return false; } });
  const hidePet = (hidden: boolean) => { setPetHidden(hidden); try { if (hidden) localStorage.setItem(petHiddenKey(user.id), "1"); else localStorage.removeItem(petHiddenKey(user.id)); } catch { /* private mode */ } };
  const openPetRoom = () => { keyboard.hide(); setPetRoom(true); };
  // A link can open a game straight away; otherwise the games' code is fetched once the conversation has settled.
  useEffect(() => {
    const timer = window.setTimeout(() => { void GameHall.preload(); void PlayTogether.preload(); void PlayDistance.preload(); void PlayPlans.preload(); }, gameHall || playTogether || interaction ? 0 : 3000);
    return () => clearTimeout(timer);
  }, []);
  // Present the restored conversation and its character together, with a bounded wait.
  const [firstLook, setFirstLook] = useState({ session: false, together: !paired, grace: false, cap: false });
  const shown = useRef(false);
  useEffect(() => { const grace = window.setTimeout(() => setFirstLook((current) => ({ ...current, grace: true })), 1500), cap = window.setTimeout(() => setFirstLook((current) => ({ ...current, cap: true })), 5000); return () => { window.clearTimeout(grace); window.clearTimeout(cap); }; }, []);
  // The drawer's rows and counts are fetched with the conversation, so opening the menu shows them at once (11-08).
  const [drawerData, setDrawerData] = useState<DrawerData>(() => drawerCache?.key === `${user.id}:${paired}` ? drawerCache.data : { home: null, spaces: [], chats: 0 });
  useEffect(() => { void loadDrawerData(paired, user.id, 30_000).then(setDrawerData); }, [paired]);
  // At most one open promise Ourever brings up in Us, only where suggestions may show (11-03); the server picks which.
  const [nudge, setNudge] = useState<PromiseItem | null>(null);
  // Suggestions show only when the app has just been opened, and are gone once the person starts using it (founder 11-09:
  // "一般刚打开 APP 的时候可以出现，只要开始使用了之后就会消失掉建议。或者用户可以主动问有什么建议"). No button calls them back.
  const [started, setStarted] = useState(false);
  const [reopenedAt, setReopenedAt] = useState(0);
  // Coming back after a long time away counts as opening the app again; a quick switch away and back does not.
  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else if (hiddenAt) {
        if (Date.now() - hiddenAt >= REOPEN_AFTER) {
          setStarted(false);
          setReopenedAt(Date.now());
        }
        hiddenAt = 0;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  const sessionRef = useRef<Session | null>(null);
  const creating = useRef<Promise<Session> | null>(null);
  const restoring = useRef<Promise<Session | null> | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  // 我的 TA 们 (founder 11-09): reloaded as the private chat grows, since a new note may have filed someone new.
  const [peopleTick, setPeopleTick] = useState(0);
  const peopleState = usePeople(`${session?.messages.length || 0}:${peopleTick}`, language);
  const people = peopleState.people;
  // One Ourever, three stages (founder 11-09): what the home shows follows where the member is.
  // Someone who has already sent their partner an invite is on the couple path, so Us stays (pairing tests, 11-09).
  const stage = paired ? "together" : invitation.sent && invitation.usable && peopleState.stage === "dating" ? "inviting" : peopleState.stage;
  const [settledOn, setTogetherPerson] = useState<Person | null>(null);
  const [putAway, setPutAway] = useState(0);
  const [answered, setAnswered] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(`pinky-together-asked:${user.id}`) || "[]"); } catch { return []; } });
  const answerTogether = async (messageId: string, personId: string, yes: boolean) => {
    const next = [...answered, messageId]; setAnswered(next);
    try { localStorage.setItem(`pinky-together-asked:${user.id}`, JSON.stringify(next)); } catch { /* the buttons simply show again */ }
    try {
      await relationshipApi(`/api/people/${encodeURIComponent(personId)}/choose`, jsonBody({ chosen: yes }));
      if (yes) { setPutAway(Math.max(0, people.length - 1)); setTogetherPerson(people.find((item) => item.id === personId) || null); }
      setPeopleTick((value) => value + 1);
    } catch (error) { setNotice((error as Error).message); }
  };
  // Which conversation Just me shows (founder 11-09): null is Ourever, the brain that knows everyone; else one person's own.
  // A person's page sends "和 Ourever 聊 X" here as ?person=, opening that person's own conversation.
  const [earlierMe, setEarlierMe] = useState<{ sessionId: string; page: number; messages: PrivateMessage[] }>({ sessionId: "", page: 0, messages: [] });
  const [loadingEarlierMe, setLoadingEarlierMe] = useState(false);
  const [thread, setThread] = useState<string | null>(() => { try { return new URLSearchParams(location.search).get("person"); } catch { return null; } });
  const threadRef = useRef<string | null>(thread);
  const [brainUnread, setBrainUnread] = useState(false);
  const threadSeenKey = `pinky-thread-seen:${user.id}`;
  const [seen, setSeen] = useState<Record<string, string>>(() => { try { return JSON.parse(localStorage.getItem(threadSeenKey) || "{}"); } catch { return {}; } });
  const markSeen = (id: string) => setSeen((currentSeen) => { const next = { ...currentSeen, [id]: new Date().toISOString() }; try { localStorage.setItem(threadSeenKey, JSON.stringify(next)); } catch { /* the dot may show again */ } return next; });
  const audienceId = useId();
  const conversationContent = useRef<HTMLElement>(null);
  const followingLatest = useRef(true);
  const keyboard = useKeyboard();
  const recall = useConversationRecall({ channel, sessionId: session?.id, language, userId: user.id, members: together?.members || [], photos: (ids) => <Photos ids={ids} language={language} />, importCard: (id) => <ImportCard key={id} id={id} language={language} onOpen={(url) => open(url)} /> });
  const accessChanged = useRef(onAccessChanged); accessChanged.current = onAccessChanged;
  const draftScope = (target: Channel) => target === "us" ? "us:" + (pairing?.id || "") : "me:" + (thread || "");
  const draft = drafts[draftScope(channel)] || "";
  const setDraft = (value: string | ((current: string) => string), target: Channel = channel) => setDrafts((current) => ({ ...current, [draftScope(target)]: typeof value === "function" ? value(current[draftScope(target)] || "") : value }));
  // A 503 from Ourever already says what happened in the language the member writes in; only a bare status or code falls back.
  const serverWords = (message: string) => Boolean(message) && !/^Request failed \(\d+\)$/.test(message) && !/^[a-z_]+$/.test(message);
  const errorText = (error: ApiError) => error.name === "TimeoutError" ? t("连接超时，请重试。", "Connection timed out. Try again.", "La conexión tardó demasiado. Inténtalo de nuevo.") : error.code === "ai_daily_limit" ? error.message : error.status === 429 ? t("已达到使用上限，请稍后再试。", "A usage limit was reached. Try again later.", "Se alcanzó un límite de uso. Inténtalo más tarde.") : error.status === 503 && !serverWords(error.message) ? t("助手暂时不可用，什么都没有改动。请稍后重试。", "The assistant is unavailable right now. Nothing was changed; try again soon.", "El asistente no está disponible. No se cambió nada; inténtalo pronto.") : error.message;

  const store = (id: string | null) => { if (threadRef.current) return; try { if (id) localStorage.setItem(sessionKey, id); else localStorage.removeItem(sessionKey); } catch { /* The session still works in memory. */ } };
  const current = (next: Session) => { setNoSavedSession(false); sessionRef.current = next; setSession(next); };
  // One assistant session per member for this channel: reopen the remembered one, otherwise create it once.
  const restore = async (latestOnly = false): Promise<Session | null> => {
    if (threadRef.current) { const result = await relationshipApi<{ session: Session }>("/api/assistant/sessions", jsonBody({ personId: threadRef.current, language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" })); current(result.session); return result.session; }
    let id: string | null = null; try { if (!latestOnly) id = localStorage.getItem(sessionKey); } catch { /* No stored session. */ }
    const path = id ? `/api/assistant/sessions/${encodeURIComponent(id)}?opened=1` : "/api/assistant/sessions/latest";
    try {
      const result = await relationshipApi<{ session: Session | null }>(path, { signal: AbortSignal.timeout(12000) });
      // A new account has no conversation yet: the server says so with an empty answer rather than a 404.
      if (!result.session) { setNoSavedSession(true); return null; }
      current(result.session); store(result.session.id); return result.session;
    } catch (error) {
      if ((error as ApiError).status !== 404) throw error;
      if (id) { store(null); return restore(true); }
      setNoSavedSession(true); return null;
    }
  };
  const create = async (opened = false) => { const result = await relationshipApi<{ session: Session }>("/api/assistant/sessions", { ...jsonBody({ language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", ...(opened ? { opened: true } : {}) }), signal: AbortSignal.timeout(12000) }); current(result.session); store(result.session.id); return result.session; };
  const ensureSession = async (allowCreate = true, opened = false): Promise<Session | null> => {
    if (sessionRef.current) return sessionRef.current;
    const restored = await (restoring.current ||= restore().finally(() => { restoring.current = null; }));
    if (restored || !allowCreate) return restored;
    return creating.current ||= create(opened).finally(() => { creating.current = null; });
  };

  const loadTogether = useCallback(async () => {
    if (!paired) return;
    try {
      const result = await relationshipApi<Together>(`/api/together?language=${language}&timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")}`); setTogether(previous => previous?.conversation.id === result.conversation.id && (previous.conversation.version ?? 0) > (result.conversation.version ?? 0) ? previous : result);
      if (result.pendingAgreement) {
        const home = await relationshipApi<{ graph: { approvals: GraphRecord[] } }>("/api/relationship/home");
        setApproved(home.graph.approvals.filter((item) => item.ownerUserId === user.id && !item.withdrawnAt).map((item) => `${item.agreementId}:${item.approvedVersion}`));
      }
    } catch (error) { setNotice(errorText(error as ApiError)); }
  }, [paired, language, user.id]);
  const firstUsId = together?.conversation.messages[0]?.id;
  useEffect(() => { if (older && older.anchor !== firstUsId) setOlder(null); }, [firstUsId]);
  // After a page lands above, keep the line the member was looking at where it was instead of jumping to the top (QA round
  // 5: it used to jump to the seam, far below, after every page). The first bubble on screen before the tap is the anchor.
  const olderAnchor = useRef<{ id: string; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!older) return;
    const anchor = olderAnchor.current; olderAnchor.current = null;
    const row = anchor && conversationContent.current?.querySelector<HTMLElement>(`[data-shared-id="${CSS.escape(anchor.id)}"]`);
    let scroller: HTMLElement | null = row ? row.parentElement : null;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    if (row && scroller) scroller.scrollTop += row.getBoundingClientRect().top - anchor.top;
    else olderRef.current?.scrollIntoView({ block: "start" });
  }, [older?.messages.length]);
  // "更早的消息": the server keeps everything that moved out of the working set; each tap brings the previous page in.
  const loadOlder = async () => {
    const before = (older?.messages[0] || together?.conversation.messages[0])?.id;
    if (!before || loadingOlder) return;
    followingLatest.current = false;
    setLoadingOlder(true);
    try {
      const page = await relationshipApi<{ messages: SharedMessage[]; more: boolean }>(`/api/together/history?before=${encodeURIComponent(before)}&limit=50`);
      const first = conversationContent.current?.querySelector<HTMLElement>(".conversation-older-chunk [data-shared-id], [data-shared-id]");
      olderAnchor.current = first ? { id: first.dataset.sharedId || "", top: first.getBoundingClientRect().top } : null;
      setOlder((current) => ({ anchor: current?.anchor || firstUsId || "", messages: [...page.messages, ...(current?.messages || [])], more: page.more }));
    } catch (error) { setNotice(errorText(error as ApiError)); } finally { setLoadingOlder(false); }
  };

  // Connected members always get a conversation on open, so Ourever can speak first to someone it barely knows (founder 11-08).
  // With AI off nothing is created: an earlier conversation is only restored to read (QA round 4).
  useEffect(() => {
    let active = true;
    setSessionLoadFailed(false);
    void ensureSession(paired && !aiOff, true).catch(() => { if (active) setSessionLoadFailed(true); })
      .finally(() => { if (active) setFirstLook(current => ({ ...current, session: true })); });
    return () => { active = false; };
  }, [user.id, paired, loadAttempt]);
  useEffect(() => { void loadTogether().finally(() => setFirstLook((current) => ({ ...current, together: true }))); }, [loadTogether]);
  useEffect(() => {
    if (!playTogether || !paired) return;
    const refreshVisible = () => { if (!document.hidden && navigator.onLine) void loadTogether(); };
    let date = new Date().toDateString();
    refreshVisible();
    const checkDay = window.setInterval(() => {
      if (document.hidden || !navigator.onLine) return;
      const next = new Date().toDateString();
      if (next !== date) { date = next; refreshVisible(); }
    }, 60_000);
    document.addEventListener("visibilitychange", refreshVisible);
    window.addEventListener("online", refreshVisible);
    return () => {
      window.clearInterval(checkDay);
      document.removeEventListener("visibilitychange", refreshVisible);
      window.removeEventListener("online", refreshVisible);
    };
  }, [playTogether, paired, loadTogether]);
  useEffect(() => {
    if (!paired) return;
    const events = relationshipEvents();
    events.addEventListener("relationship", (event) => { try {
      const { eventType, objectId } = JSON.parse((event as MessageEvent).data);
      if (/^(together|agreement)/.test(eventType)) void loadTogether();
      // The partner made (or is making) the couple's character: show it here too.
      if (eventType === "character.updated") void refreshMascot();
      // Ourever started, moved on or finished a step in Us, possibly for the partner's question.
      if (eventType === "agent.activity") void checkActivity("us");
      // A question Ourever asked privately on behalf of Us: refresh this conversation and mark "Just me" if it is not in view.
      if (eventType === "assistant.updated" && (!sessionRef.current || sessionRef.current.id === objectId)) { void relationshipApi<{ session: Session }>(`/api/assistant/sessions/${encodeURIComponent(objectId)}`).then((result) => { current(result.session); store(result.session.id); if (channelRef.current !== "me") setUnreadMe(true); }).catch(() => {}); }
      // Another of Just me's conversations moved: the row shows a dot on it.
      else if (eventType === "assistant.updated") { setPeopleTick((value) => value + 1); if (threadRef.current) setBrainUnread(true); }
    } catch { /* Ignore malformed events. */ } });
    events.addEventListener("access-ended", () => { events.close(); accessChanged.current(); });
    // Whatever arrived while the stream was down (a reconnect, offline, the phone asleep) is fetched again (QA round 3).
    let connected = false;
    events.addEventListener("open", () => { if (connected) void loadTogether(); connected = true; });
    const catchUp = () => { if (!document.hidden && navigator.onLine) void loadTogether(); };
    window.addEventListener("online", catchUp);
    document.addEventListener("visibilitychange", catchUp);
    return () => { events.close(); window.removeEventListener("online", catchUp); document.removeEventListener("visibilitychange", catchUp); };
  }, [paired, loadTogether, refreshMascot]);
  useEffect(() => { setNotice(""); }, [language]);
  // Which step Ourever is on while it answers: asked every moment while this phone waits for a reply or Us shows a step, and on
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
    if (params.has("say") || params.has("channel") || params.has("person") || params.get("view") === "space") window.history.replaceState(history.state, "", location.pathname);
    // A prefill from another page (Memories' Add / Find) waits for a tap on a phone: focusing while the page is still
    // changing opened the iPhone keyboard over the input (11-06). A computer with a mouse gets the cursor right away.
    if (params.has("say") && window.matchMedia?.("(pointer: fine)").matches) composerRef.current?.querySelector("textarea")?.focus();
  }, []);
  useEffect(() => { try { localStorage.setItem(channelKey, channel); } catch { /* Channel memory is a convenience. */ } }, [channel, channelKey]);
  // The channel stays in the address and in this history entry, so Back from a page and a reload return to it (QA round 3).
  useEffect(() => {
    const url = new URL(location.href);
    if (channel === "us") url.searchParams.set("channel", "us"); else url.searchParams.delete("channel");
    history.replaceState({ ...(history.state || {}), channel }, "", url);
  }, [channel]);
  // When Us was last looked at on this device, so "Us" can show a dot for what the partner or Ourever said since.
  const seenKey = `toward-us:us-seen:${user.id}`;
  const [seenUs, setSeenUs] = useState(() => { try { return localStorage.getItem(seenKey) || ""; } catch { return ""; } });
  const latestUs = together?.conversation.messages.at(-1);
  useEffect(() => {
    if (channel !== "us" || !latestUs) return;
    setSeenUs(latestUs.createdAt); try { localStorage.setItem(seenKey, latestUs.createdAt); } catch { /* The dot just shows again. */ }
  }, [channel, latestUs?.createdAt, seenKey]);

  const say = (text: string) => {
    if (!("speechSynthesis" in window) || !text) return;
    window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = languageTag(language); window.speechSynthesis.speak(utterance);
  };
  // Turns run strictly in order per channel, typed and spoken alike (one queue per channel): the server rejects a turn that
  // races the previous one, so a second utterance waits for the first answer instead of failing with a version conflict.
  const queues = useRef<Record<Channel, Promise<unknown>>>({ me: Promise.resolve(), us: Promise.resolve() });
  const running = useRef<Partial<Record<Channel, AbortController>>>({});
  const [generating, setGenerating] = useState({ me: false, us: false });
  const beginReply = (target: Channel) => {
    const controller = new AbortController();
    running.current[target] = controller;
    setGenerating(value => ({ ...value, [target]: true }));
    return controller;
  };
  const endReply = (target: Channel, controller: AbortController) => {
    if (running.current[target] !== controller) return;
    delete running.current[target];
    setGenerating(value => ({ ...value, [target]: false }));
  };
  const stopReply = (target: Channel) => {
    const controller = running.current[target];
    if (!controller) return;
    controller.abort();
    endReply(target, controller);
  };
  useEffect(() => () => { running.current.me?.abort(); running.current.us?.abort(); }, []);
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
    setFailed((items) => items.filter((item) => item.itemId !== itemId));
    privateOutbox.add({ text, itemId, ...(photoIds.length ? { photoIds } : {}) });
    return enqueue("me", async () => {
      const controller = beginReply("me");
      try {
        const active = await ensureSession();
        controller.signal.throwIfAborted();
        const result = await relationshipApi<{ session: Session }>(`/api/assistant/sessions/${active!.id}/${spoken ? "transcripts" : "messages"}`, { ...jsonBody({ text, itemId, ...(photoIds.length ? { photoIds } : {}) }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]) });
        if (sessionRef.current?.id === result.session.id) current(result.session);
        privateOutbox.remove(itemId); setRevising(false);
        window.dispatchEvent(new Event("toward-us:assistant-changed"));
        if (spoken) say(result.session.messages.filter((message) => message.role === "assistant").at(-1)?.text || "");
        return result;
      } catch (error) {
        if (controller.signal.aborted) { privateOutbox.remove(itemId); if (!spoken) keep(text, "me"); return null; }
        const status = (error as ApiError).status;
        if (!status || status === 429 || status >= 500) setFailed((items) => [...items.filter((item) => item.itemId !== itemId), { text, itemId, ...(photoIds.length ? { photoIds } : {}) }]);
        else { privateOutbox.remove(itemId); keep(text, "me"); }
        setNotice(errorText(error as ApiError)); return null;
      } finally { endReply("me", controller); setQueued((items) => items.filter((item) => item.itemId !== itemId)); }
    });
  };
  // A retry is the original delivery, including its recipient, speaker, attachments and idempotency key.
  const deliverShared = (message: SharedSend) => {
    const { text, itemId, photoIds, speaker, recipient } = message;
    const calling = recipient === "assistant";
    setNotice("");
    sharedOutbox.add(message);
    return enqueue("us", async () => {
      const shown = calling ? setTimeout(() => void loadTogether(), 600) : null;
      const controller = calling ? beginReply("us") : null;
      if (calling) setAgentWorking((count) => count + 1);
      try {
        await relationshipApi("/api/together/messages", { ...jsonBody({ text, itemId, recipient, language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          ...(photoIds.length ? { photoIds } : {}), ...(speaker === "partner" ? { speaker } : {}) }), signal: controller?.signal });
        sharedOutbox.remove(itemId);
        setUnconfirmedShared((items) => items.filter((item) => item.itemId !== itemId));
        await loadTogether();
        if (calling) window.dispatchEvent(new Event("toward-us:assistant-changed"));
        return true;
      } catch (error) {
        if (controller?.signal.aborted) { sharedOutbox.remove(itemId); void loadTogether(); return false; }
        setUnconfirmedShared((items) => items.some((item) => item.itemId === itemId) ? items : [...items, message]);
        setNotice(errorText(error as ApiError));
        return false;
      } finally {
        if (controller) endReply("us", controller);
        if (shown) clearTimeout(shown);
        if (calling) setAgentWorking((count) => count - 1);
      }
    });
  };
  const discardPrivate = (itemId: string) => { privateOutbox.remove(itemId); setFailed((items) => items.filter((item) => item.itemId !== itemId)); };
  const discardShared = (itemId: string) => { sharedOutbox.remove(itemId); setUnconfirmedShared((items) => items.filter((item) => item.itemId !== itemId)); };
  // Back online (or opened again with messages still waiting): each unconfirmed message goes out again under its own key,
  // so one the server already has is not stored twice.
  const resend = useRef(() => {});
  resend.current = () => {
    if (navigator.onLine === false) return;
    for (const item of failed) if (!queued.some((entry) => entry.itemId === item.itemId)) void sendPrivate(item.text, item.itemId, false, item.photoIds || []);
    if (paired && !together?.readOnly && !pending.us) for (const item of unconfirmedShared) void deliverShared(item);
  };
  useEffect(() => {
    const online = () => resend.current();
    const opened = window.setTimeout(online, 1500);
    window.addEventListener("online", online);
    return () => { clearTimeout(opened); window.removeEventListener("online", online); };
  }, []);
  const sendShared = (text: string, photoIds: string[] = [], speaker: SharedSend["speaker"] = "me", recipient?: SharedRecipient) =>
    deliverShared({ text, itemId: crypto.randomUUID(), photoIds, speaker, recipient });
  const regenerate = async (target: Channel, messageId: string) => {
    if (running.current[target] || (target === "me" && !session)) return;
    const controller = beginReply(target);
    setNotice("");
    try {
      const options = { ...jsonBody({ messageId, language }), signal: controller.signal };
      if (target === "me") {
        const result = await relationshipApi<{ session: Session }>(`/api/assistant/sessions/${session!.id}/regenerate`, options);
        if (sessionRef.current?.id === result.session.id) current(result.session);
      } else {
        await relationshipApi("/api/together/regenerate", options);
        await loadTogether();
      }
    } catch (error) { if (!controller.signal.aborted) setNotice(errorText(error as ApiError)); }
    finally { endReply(target, controller); }
  };
  const unsend = async (id: string) => {
    try { await relationshipApi(`/api/together/messages/${encodeURIComponent(id)}/unsend`, jsonBody({ language })); await loadTogether(); }
    catch (error) { setNotice(errorText(error as ApiError)); }
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
    // AI off: no call and no assistant session; Just me's card says why and how to turn AI on (QA round 4).
    if (aiOff) { setAiOffWhy(t("和 Ourever 通话需要用到 AI。", "Calling Ourever needs AI.", "Llamar a Ourever necesita la IA.")); switchChannel("me"); return; }
    if (channel === "us") { setCall({ channel: "us", sessionId: null }); return; }
    try { const active = await ensureSession(); setCall({ channel: "me", sessionId: active?.id || null }); } catch (error) { setNotice((error as Error).message); }
  };
  // "Call Ourever" on What Ourever can do (QA round 5) arrives with call=1: start the call here (or show why it needs AI),
  // once. Read on the first render, before the effect above cleans the address, so a reload doesn't call again.
  const callAsked = useRef(new URLSearchParams(location.search).get("call") === "1");
  useEffect(() => {
    if (!callAsked.current) return;
    callAsked.current = false;
    void startCall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 约会之后问一句: one tap answers privately; "tell them" sends the member's own words in Us.
  const answerDate = async (messageId: string, rating: "great" | "ok" | "meh") => {
    const active = sessionRef.current; if (!active) return; setBusy(true); setNotice("");
    try { current((await relationshipApi<{ session: Session }>(`/api/assistant/sessions/${encodeURIComponent(active.id)}/date-check`, jsonBody({ messageId, rating }))).session); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };
  const tellPartner = async (message: PrivateMessage) => {
    const active = sessionRef.current; if (!active || !message.dateCheck) return;
    const delivered = await sendShared(t(`「${message.dateCheck.title}」我很开心，谢谢你 ❤️`, `I loved "${message.dateCheck.title}". Thank you ❤️`, `Me encantó «${message.dateCheck.title}». Gracias ❤️`), [], "me", "partner");
    if (!delivered) return;
    try { current((await relationshipApi<{ session: Session }>(`/api/assistant/sessions/${encodeURIComponent(active.id)}/date-check`, jsonBody({ messageId: message.id, told: true }))).session); } catch { /* The button stays; the message went. */ }
  };
  const [stoppingScreenshot, setStoppingScreenshot] = useState<string | null>(null);
  const pendingScreenshot = session?.messages.find(message => message.screenshotPending && message.id !== stoppingScreenshot)?.id;
  const stopScreenshot = async () => {
    if (!session || !pendingScreenshot) return;
    setStoppingScreenshot(pendingScreenshot);
    try {
      const result = await relationshipApi<{ session: Session }>(`/api/assistant/sessions/${session.id}/stop-screenshot`, jsonBody({ messageId: pendingScreenshot, language }));
      if (sessionRef.current?.id === result.session.id) current(result.session);
    } catch (error) { setNotice(errorText(error as ApiError)); }
    finally { setStoppingScreenshot(null); }
  };
  useEffect(() => {
    const id = sessionRef.current?.id;
    if (!id || !pendingScreenshot || channel !== "me") return;
    // A solo account has no shared SSE stream. Check for the completed reply only while it is needed.
    const controller = new AbortController();
    const deadline = Date.now() + 15 * 60_000;
    let delay = 2_000, timer = 0, fetching = false;
    const refresh = async () => {
      window.clearTimeout(timer);
      if (controller.signal.aborted || fetching || document.hidden || !navigator.onLine) return;
      fetching = true;
      try {
        const { session: fresh } = await relationshipApi<{ session: Session }>(`/api/assistant/sessions/${encodeURIComponent(id)}`, { signal: controller.signal });
        const active = sessionRef.current;
        if (controller.signal.aborted || active?.id !== id) return;
        if (fresh.version >= active.version) current(fresh);
        if (!sessionRef.current?.messages.some(message => message.screenshotPending)) return;
      } catch { /* A transient connection failure leaves the current reply on screen. */ }
      finally { fetching = false; }
      if (!controller.signal.aborted && Date.now() < deadline) {
        delay = Math.min(15_000, delay * 2);
        timer = window.setTimeout(refresh, delay);
      }
    };
    timer = window.setTimeout(refresh, delay);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort(); window.clearTimeout(timer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [channel, session?.id, pendingScreenshot]);
  const reloadSession = async () => { const active = sessionRef.current; if (!active) return; try { current((await relationshipApi<{ session: Session }>(`/api/assistant/sessions/${encodeURIComponent(active.id)}`)).session); } catch { /* The next event or poll refreshes it. */ } };
  const importChat = async (run: (session: string | null) => Promise<unknown>) => {
    setNotice(""); setPending((count) => ({ ...count, me: count.me + 1 }));
    try { const active = await ensureSession(); await run(active?.id || null); await reloadSession(); }
    catch (error) { setNotice((error as Error).message); } finally { setPending((count) => ({ ...count, me: count.me - 1 })); }
  };
  const openThread = (id: string | null) => {
    if (id === threadRef.current) return;
    keyboard.hide(); voice.stop(); setNotice(""); setRevising(false); setAttachments([]);
    setNoSavedSession(false); threadRef.current = id; sessionRef.current = null; setSession(null); setThread(id);
    if (id) markSeen(id); else setBrainUnread(false);
    if (channel !== "me") switchChannel("me");
    void ensureSession(true).catch(() => {});
  };
  // Together in Ourever: the people row is gone, so Just me is the one conversation again.
  useEffect(() => { if (stage === "together" && threadRef.current) openThread(null); }, [stage]);
  const send = async () => {
    const text = draft.trim(); if (generating[channel] || (!text && !ready.length) || uploading) return;
    if (pastedDraft.current[channel] || (channel === "me" && looksLikePastedChat(text))) {
      if (!await confirmImport(channel === "us" ? "shared" : "private")) return;
    }
    pastedDraft.current[channel] = false;
    // Long pasted conversations use the same import flow as a chat export.
    if (channel === "me" && !ready.length && looksLikePastedChat(text)) { setDraft(""); void importChat((session) => importPastedChat(text, { language, session })); return; }
    setDraft(""); setAttachments([]);
    if (channel === "me") void sendPrivate(text, crypto.randomUUID(), false, ready);
    else { setAskAgent(null); void sendShared(text, ready, "me", recipientFor(text)); }
  };
  // Photos are shrunk on the phone, then uploaded: private in Just me, shared in Us (sending there is the share).
  const pickPhotos = async (files: FileList | null) => {
    const all = [...(files || [])];
    const isImage = (file: File) => file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name);
    const picked = all.filter(isImage).slice(0, 6 - attachments.length);
    if (fileRef.current) fileRef.current.value = "";
    setNotice("");
    // Exported chat files are imported privately from Just me; Us only gets an analysis both of you agreed to share.
    const chats = all.filter((file) => !isImage(file) && isChatFile(file));
    // Anything else (a PDF, a document) is named rather than silently skipped.
    if (all.some((file) => !isImage(file) && !isChatFile(file))) setNotice(t("这里只能发照片（JPEG、PNG 等），其他文件没有发出。", "Only photos (JPEG, PNG…) can be sent here; other files were left out.", "Aquí solo se pueden enviar fotos (JPEG, PNG…); los demás archivos no se enviaron."));
    if ((picked.length || (chats.length && channel === "me")) && !await confirmImport(channel === "us" ? "photos" : "private")) return;
    if (chats.length && channelRef.current === "us") setNotice(t("聊天记录请在“只有我”里导入，只有你能看到；之后可以邀请 TA 一起看。", "Import chat history in Just me, where only you see it; you can invite your partner to look together later.", "Importa el historial en Solo yo, donde solo tú lo ves; luego puedes invitar a tu pareja a verlo."));
    else for (const file of chats.slice(0, 1)) void importChat((session) => uploadChatFile(file, { name: file.name, language, session }));
    const scope = channel === "us" ? "shared" : "private";
    for (const file of picked) {
      const key = crypto.randomUUID(), preview = URL.createObjectURL(file);
      setAttachments((items) => [...items, { key, preview, id: null }]);
      let opened = false;
      try {
        const blob = await shrink(file).catch(() => {
          // A photo this browser can't open (HEIC outside Safari, or a damaged file) says what to do instead of uploading.
          throw new Error(/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)
            ? t("这个浏览器打不开 HEIC 照片。请改发 JPEG 或 PNG（iPhone：设置 → 相机 → 格式 → 兼容性最佳）。", "This browser can't open HEIC photos. Send a JPEG or PNG instead (iPhone: Settings → Camera → Formats → Most Compatible).", "Este navegador no abre fotos HEIC. Envía un JPEG o PNG (iPhone: Ajustes → Cámara → Formatos → Más compatible).")
            : t("这张照片打不开，可能已损坏。请换一张试试。", "This photo couldn't be opened; it may be damaged. Try another one.", "No se pudo abrir esta foto; puede estar dañada. Prueba con otra."));
        });
        opened = true;
        const response = await fetch(`/api/photos?scope=${scope}&language=${language}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "image/jpeg" }, body: blob });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(apiErrorText(payload, response.status, language));
        setAttachments((items) => items.map((item) => item.key === key ? { ...item, id: payload.photo.id } : item));
      } catch (error) {
        // A photo that couldn't be opened leaves the tray; one the server refused stays, marked, so it can be removed.
        setAttachments((items) => opened ? items.map((item) => item.key === key ? { ...item, failed: true } : item) : items.filter((item) => item.key !== key));
        setNotice((error as Error).message);
      }
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
    if (channelRef.current === "us") { if (talking.current.on) { setAskAgent(null); void sendShared(text, [], talking.current.speaker, recipientFor(text)); } else setDraft((value) => value ? `${value} ${text}` : text, "us"); return null; }
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
  // One tap takes back a private record Ourever just made (founder 11-07); it is archived and the card says "undone".
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
  const previousPairing = useRef(pairing?.status);
  const joinedHere = useRef(false);
  const [welcomePartner, setWelcomePartner] = useState(false);
  useEffect(() => {
    const justJoined = previousPairing.current === "pending" && paired;
    previousPairing.current = pairing?.status;
    if (!justJoined) return;
    // A private draft, recording or upload keeps its audience until the author switches.
    joinedHere.current = true;
    const writingPrivately = channel === "me" && (keyboard.visible || draft || attachments.length || voiceActive || call || revising || queued.length || failed.length);
    if (!writingPrivately) switchChannel("us");
    setWelcomePartner(true);
  }, [pairing?.status, paired]);
  useEffect(() => {
    if (!welcomePartner) return;
    const timer = window.setTimeout(() => setWelcomePartner(false), 8000);
    return () => window.clearTimeout(timer);
  }, [welcomePartner]);
  const enterPartnerCode = () => { keyboard.hide(); onPair(); };

  // A letter's opening day, written out ("2027年3月5日", "March 5, 2027").
  const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(languageTag(language), { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const partnerRaw = together?.members.find((member) => member.id !== user.id)?.name || "";
  const partnerName = partnerRaw ? isolate(partnerRaw) : t("TA", "Your partner", "Tu pareja");
  const pendingAgreement = together?.pendingAgreement;
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
  const answerDaily = async (id: string, answer: DailyAnswerInput) => {
    setNotice("");
    try { await relationshipApi(`/api/together/daily/${encodeURIComponent(id)}/answer`, jsonBody({ ...answer, language })); await loadTogether(); return true; }
    catch (error) { setNotice(errorText(error as ApiError)); await loadTogether(); return false; }
  };
  // Today's question still waits for this member's answer.
  const latestDaily = together?.conversation.messages.filter((message) => message.kind === "daily_question").at(-1);
  const todayQuestion = latestDaily && Date.now() - Date.parse(latestDaily.createdAt) < 86_400_000 ? latestDaily : null;
  const leavePlayDaily = () => { if (dictating.startsWith("play-daily:")) dictate("", null); };
  const closePlayTogether = () => {
    leavePlayDaily();
    setPlayTogether(null);
    const params = new URLSearchParams(location.search);
    if (!params.has("play")) return;
    params.delete("play");
    history.replaceState(history.state, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
  };
  // Games, the little one's room and the question cards each get a history entry (QA round 3): Back closes them instead of
  // leaving the app. A ?game= link opens the games over the conversation, so Back from there lands in the conversation.
  useSheetHistory(Boolean(gameHall), closeGames);
  useSheetHistory(petRoom, () => setPetRoom(false));
  // The menu drawer gets a Back entry too (QA round 5): opened from /?view=space in a fresh tab, Back closes it onto the
  // conversation (whose address the effect above already cleaned) instead of leaving Ourever.
  useSheetHistory(drawer, () => setDrawer(false));
  useLayerOpen(drawer || Boolean(gameHall || playTogether || interaction || petRoom));
  useSheetHistory(Boolean(playTogether), closePlayTogether);
  const closeInteraction = () => {
    keyboard.hide();
    setInteraction(null);
    const params = new URLSearchParams(location.search);
    if (!params.has("distance")) return;
    params.delete("distance");
    history.replaceState(history.state, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
  };
  useEffect(() => {
    if (dictating.startsWith("play-daily:") && dictating !== `play-daily:${todayQuestion?.id}`) leavePlayDaily();
  }, [dictating, todayQuestion?.id]);
  const renderDaily = (message: SharedMessage, inPlay = false, offline = false) => {
    const voiceId = inPlay ? `play-daily:${message.id}` : message.id;
    const text = message.i18n?.[language] ?? message.translations?.[language]?.text ?? message.text;
    return <DailyQuestionCard key={message.id} questionId={message.id} question={text} answers={message.answers || {}} userId={user.id}
      members={together?.members || []} language={language} current={message.id === todayQuestion?.id}
      askedAt={message.createdAt} listening={dictating === voiceId && voiceActive} onVoice={(append) => dictate(voiceId, append)}
      dailyPlay={message.dailyPlay} openForAnswer={!inPlay} onAnswer={(answer) => answerDaily(message.id, answer)}
      onOpenPlan={paired && !together?.readOnly ? () => { if (!inPlay) closeQuestion(); keyboard.hide(); setPlanQuestionId(message.id); } : undefined}
      onContinue={inPlay && !usHidden ? (followup) => {
        closePlayTogether(); switchChannel("us"); setAskAgent(false);
        const prompt = followup || t(`刚才这道题「${text}」，我想和你接着聊聊。`, `I'd like to talk a little more about “${text}”.`, `Me gustaría seguir hablando de «${text}».`);
        setDraft((value) => value.trim() ? `${value}\n\n${prompt}` : prompt, "us");
      } : undefined} inPlay={inPlay} offline={offline} readOnly={together?.readOnly} />;
  };
  const dailyWaiting = Boolean(todayQuestion && !todayQuestion.answers?.[user.id] && Object.keys(todayQuestion.answers || {}).length < 2);
  // Something in Us waits for this member: an agreement they have not approved yet, or a new line from the partner or Ourever.
  const unreadUs = channel !== "us" && (dailyWaiting || Boolean(pendingAgreement && !together?.readOnly && !approved.includes(`${pendingAgreement.id}:${pendingAgreement.version}`)) || Boolean(latestUs && latestUs.actorUserId !== user.id && latestUs.createdAt > seenUs));
  const readOnly = channel === "us" && (!paired || Boolean(together?.readOnly));
  const askingInUs = channel === "us" && recipientFor(draft) === "assistant";
  // While dating, the second segment is a link to People, not a tab: then the pair is a plain group, not a tablist whose
  // children must all be tabs (QA round 5 axe aria-required-children).
  const peopleLink = stage === "dating" && channel !== "us";
  const placeholder = channel === "me" ? revising ? t("说说想怎么改…", "Tell me what to change…", "Dime qué cambiar…") : t("贴上 TA 的话，或问我…", "Paste their words or ask…", "Pega lo que dijo…") : askingInUs ? t("问 Ourever…", "Ask Ourever…", "Pregúntale a Ourever…") : t(`发消息给 ${partnerName}…`, `Message ${partnerName}…`, `Mensaje para ${partnerName}…`);
  const audience = channel === "me" ? t("只有我 · 与 Ourever 私聊", "Just me · Private with Ourever", "Solo yo · En privado con Ourever") : t(`我们俩 · ${partnerName} 也能看到`, `Us · ${partnerName} can see this too`, `Nosotros · ${partnerName} también lo verá`);
  const sendLabel = channel === "me" ? t("私下发送给 Ourever", "Send privately to Ourever", "Enviar en privado a Ourever") : askingInUs ? t("在我们俩问 Ourever", "Ask Ourever in Us", "Preguntar a Ourever en Nosotros") : t(`发送给 ${partnerName}`, `Send to ${partnerName}`, `Enviar a ${partnerName}`);

  const privateCard = (card: Card) => {
    if (card.kind === "chat_import") return <ImportCard key={card.id} id={card.id} language={language} onOpen={open} onFinished={() => void reloadSession()} />;
    if (card.kind === "partner_message") return <article key={card.id} className={`conversation-card partner-card is-${card.status}`} data-testid="partner-message-card">
      <header>{card.openOn ? <><EnvelopeSimple size={16} />{t(`一封信 · ${longDay(card.openOn)} 发给 TA`, `A letter · for ${longDay(card.openOn)}`, `Una carta · para el ${longDay(card.openOn)}`)}</> : <><LockKey size={16} />{t("想对 TA 说的话", "For your partner", "Para tu pareja")}</>}</header><p className={card.openOn ? "letter-text" : undefined}>{card.text}</p>
      {card.status === "draft" ? <><small>{card.openOn ? t(`确认后先替你存着，TA 完全不知道。${longDay(card.openOn)}那天 Ourever 会提醒你，一键用你自己的短信或邮件发给 TA。`, `Once you confirm, Ourever keeps it and your partner won't know. On ${longDay(card.openOn)} it reminds you, and you send it yourself in one tap by text or email.`, `Al confirmar, Ourever la guarda y tu pareja no lo sabrá. El ${longDay(card.openOn)} te avisa y la envías tú con un toque por mensaje o correo.`) : t("确认之前不会分享，你的原话也不会。", "Nothing is shared until you confirm, and your own words never are.", "No se comparte nada hasta que lo confirmes, y tus palabras originales nunca.")}</small><div className="card-actions">
        {paired ? <button className="card-primary" disabled={busy} onClick={() => void share(card)}>{card.openOn ? <><EnvelopeSimple size={18} weight="fill" />{t("存好，到那天提醒我", "Keep it and remind me", "Guárdala y avísame")}</> : <><PaperPlaneRight size={18} weight="fill" />{t("发送给 TA", "Send to partner", "Enviar a mi pareja")}</>}</button> : <button className="card-primary" onClick={() => switchChannel("us")}><UsersThree size={18} />{t("先邀请 TA", "Invite your partner first", "Invita primero a tu pareja")}</button>}
        <button disabled={busy} onClick={revise}>{t("再改改", "Edit", "Editar")}</button></div></> :
        <small className="card-state">{card.status === "shared" ? <><CheckCircle size={16} weight="fill" />{card.openOn ? t(`已存好，${longDay(card.openOn)}提醒你发给 TA`, `Kept; Ourever reminds you to send it on ${longDay(card.openOn)}`, `Guardada; Ourever te avisa para enviarla el ${longDay(card.openOn)}`) : t("已发到“我们俩”", "Sent to Us", "Enviado a Nosotros")}</> : t("已有更新的版本", "A newer version replaced this", "Una versión más nueva la reemplazó")}</small>}
    </article>;
    if (card.kind === "space_share") return <article key={card.id} className={`conversation-card partner-card is-${card.status}`} data-testid="space-share-card">
      <header>{card.shareKind === "agreement" ? <><UsersThree size={16} />{t("在“我们俩”起草约定", "Draft an agreement in Us", "Redactar un acuerdo en Nosotros")}</> : card.shareKind === "date" ? <><CalendarBlank size={16} />{t("放进你们俩的日历", "Put on your shared calendar", "Al calendario compartido")}</> : <><UsersThree size={16} />{t(`放进共同的“${card.title}”`, `Add to shared "${card.title}"`, `Añadir a «${card.title}» compartido`)}</>}</header><p>{card.text}</p>
      {card.status === "draft" ? <><small>{card.shareKind === "agreement" ? t("确认后放进“我们俩”，你们俩都点了同意才算数。", "Once you confirm it goes into Us; it counts when you both agree.", "Al confirmar pasa a Nosotros; cuenta cuando los dos estén de acuerdo.") : card.shareKind === "date" ? t("确认后你们俩的日历上都会有，前一天 Ourever 提醒你们。", "Once you confirm it's on both your calendars, with a reminder the day before.", "Al confirmar estará en el calendario de los dos, con aviso un día antes.") : t("确认后你们俩都能看到。", "Once you confirm, both of you can see it.", "Cuando lo confirmes, los dos podrán verlo.")}</small><div className="card-actions"><button className="card-primary" disabled={busy} onClick={() => void confirmSpace(card)}><CheckCircle size={18} weight="fill" />{t("确认放进去", "Confirm", "Confirmar")}</button></div></> :
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
  const closeQuestion = () => {
    if (openQuestionId && dictating === openQuestionId) dictate("", null);
    keyboard.hide();
    setOpenQuestionId(null);
  };
  const questionEntry = (message: SharedMessage, text: string) => {
    const source = message.role === "agent" ? "Ourever" : message.actorUserId === user.id ? t("你", "You", "Tú") :
      together?.members.find((member) => member.id === message.actorUserId)?.name || t("伴侣", "Your partner", "Tu pareja");
    const mine = Boolean(message.answers?.[user.id]);
    const revealed = Object.keys(message.answers || {}).length >= 2;
    const today = message.kind === "daily_question" && message.id === todayQuestion?.id;
    const label = today ? t("今日一问", "Today’s question", "Pregunta de hoy") : message.kind === "daily_question"
      ? t("往日问题", "Earlier question", "Pregunta anterior") : t("双人题卡", "Question card", "Tarjeta de preguntas");
    const status = revealed ? t("双方已回答", "Both answered", "Ambos respondieron") : mine ?
      t(`你已回答，等 ${partnerName}`, `You answered · Waiting for ${partnerName}`, `Ya respondiste · Falta ${partnerName}`) :
      t("你尚未回答", "You haven’t answered", "Aún no has respondido");
    const action = revealed ? t("查看双方答案", "View answers", "Ver respuestas") : mine ? t("查看我的答案", "View my answer", "Ver mi respuesta") :
      readOnly ? t("查看题目", "View question", "Ver pregunta") : t("去回答", "Answer", "Responder");
    return <button type="button" key={message.id} className="shared-question" onClick={() => { keyboard.hide(); setOpenQuestionId(message.id); }}>
      <span className="shared-question-meta">{source} · {label}</span><strong>{text}</strong>
      <span className="shared-question-footer"><span>{status}</span><b>{action}<ArrowRight size={14} aria-hidden="true" /></b></span>
    </button>;
  };
  const gameDetails = (message: SharedMessage) => {
    if (!message.game) return null;
    const translated = message.translations?.[language];
    const deckId = message.game.deckId;
    return <GameCard key={message.id} questionId={message.id} prompt={message.i18n?.[language] ?? translated?.text ?? message.text}
      game={translated?.options?.length === message.game.options.length ? { ...message.game, options: translated.options } : message.game}
      answers={message.answers || {}} userId={user.id} members={together?.members || []} language={language} readOnly={readOnly}
      onAnswer={(answer) => answerGame(message.id, answer)} onAgain={() => { closeQuestion(); void playAgain(); }}
      onOpenDeck={deckId ? () => { closeQuestion(); setPlayTogether({ cardId: deckId }); } : undefined} />;
  };
  // Times like iMessage (QA round 4): a line with the time where more than half an hour passed, and a tap on a message
  // shows when it was sent.
  const [timeOf, setTimeOf] = useState<string | null>(null);
  const stampLabel = (iso: string) => {
    const at = new Date(iso), now = new Date(), tag = languageTag(language);
    const clock = at.toLocaleTimeString(tag, { hour: "numeric", minute: "2-digit" });
    if (at.toDateString() === now.toDateString()) return clock;
    if (now.getTime() - at.getTime() < 6 * 86_400_000) return `${at.toLocaleDateString(tag, { weekday: "short" })} ${clock}`;
    return `${at.toLocaleDateString(tag, { month: "short", day: "numeric", ...(at.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) })} ${clock}`;
  };
  const timeGap = (previous: string | undefined, current: string | undefined) => current && !Number.isNaN(Date.parse(current)) && (!previous || Date.parse(current) - Date.parse(previous) > 30 * 60_000)
    ? <p className="conversation-time" role="separator" data-testid="message-time-gap"><time dateTime={current}>{stampLabel(current)}</time></p> : null;
  const showTime = (id: string) => (event: { target: EventTarget }) => { if ((event.target as HTMLElement).closest("button, a, input, textarea, select, [role=menu], [role=dialog]")) return; setTimeOf((shown) => shown === id ? null : id); };
  const sharedMessage = (message: SharedMessage, index: number) => {
    const body = sharedBody(message, index);
    const gap = timeGap(sharedMessages[index - 1]?.createdAt, message.createdAt);
    if (!body || !together || message.removedAt) return gap && body ? <Fragment key={message.id}>{gap}{body}</Fragment> : body;
    const own = message.role === "member" && message.actorUserId === user.id;
    const removable = own && !readOnly && !message.recordedByUserId && message.kind === "text" && Date.now() - Date.parse(message.createdAt) <= 120_000;
    const latest = together.conversation.messages.at(-1);
    const canRegenerate = !readOnly && !generating.us && latest?.id === message.id && message.kind === "text" && message.role === "agent" && sharedMessages.some(line => line.id === message.replyTo && line.actorUserId === user.id && !line.removedAt);
    return <Fragment key={message.id}>{gap}<div className={`shared-reportable${own ? " from-me" : ""}`} data-shared-id={message.id} onClick={showTime(message.id)}>
      {body}<ReportReply messageMenu photoIds={message.photoIds} canReport={message.role === "agent"} onUnsend={removable ? () => void unsend(message.id) : undefined} onRegenerate={canRegenerate ? () => void regenerate("us", message.id) : undefined} replyText={message.i18n?.[language] ?? message.translations?.[language]?.text ?? (message.text || message.call?.rows.map(row => row.text).join("\n"))} language={language} channel="us" conversationId={together.conversation.id} messageId={message.id} />
      {timeOf === message.id && <time className="message-time" dateTime={message.createdAt}>{stampLabel(message.createdAt)}</time>}
      {own && latestOwn?.id === message.id && <small className="message-receipt">{message.readAt ? t("已读", "Read", "Leído") : message.deliveredAt ? t("已送达", "Delivered", "Entregado") : t("已发送", "Sent", "Enviado")}</small>}
    </div></Fragment>;
  };
  const sharedBody = (message: SharedMessage, index: number) => {
    const mine = message.role === "member" && message.actorUserId === user.id;
    if (message.removedAt) return <p key={message.id} className="conversation-nudge">{t("消息已撤回", "Message removed", "Mensaje retirado")}</p>;
    // Like a group chat: the avatar and name show once at the start of each run of lines from the same speaker.
    const previous = sharedMessages[index - 1];
    const continued = Boolean(previous && ["text", "relay"].includes(previous.kind) && previous.role === message.role && previous.actorUserId === message.actorUserId && !previous.recordedByUserId === !message.recordedByUserId);
    const recorder = message.recordedByUserId ? (message.recordedByUserId === user.id ? user.name : partnerName) : "";
    const author = message.role === "agent" ? "Ourever" : recorder ? `${message.actorUserId === user.id ? user.name : partnerName}${t(`（在 ${recorder} 的手机上说）`, ` (spoken on ${recorder}'s phone)`, ` (dicho en el teléfono de ${recorder})`)}` : mine ? "" : partnerName;
    // System copy is stored in every language; Ourever's own lines come with a translation into this member's language when
    // they were written in another one (shared-translate.mjs); members' own words are shown as written.
    const translated = message.translations?.[language];
    const text = message.i18n?.[language] ?? translated?.text ?? message.text;
    if (message.kind === "letter_sealed") {
      const openOn = String((message.refs || []).find((ref) => ref.type === "letter")?.openOn || "");
      const days = openOn ? Math.max(0, Math.round((Date.parse(`${openOn}T12:00:00`) - Date.now()) / 86_400_000)) : 0;
      return <article key={message.id} className="conversation-card letter-sealed" data-testid="letter-sealed"><EnvelopeSimple size={30} weight="fill" /><div><strong>{message.actorUserId === user.id ? t(`你给 ${partnerName} 写了一封信`, `You wrote ${partnerName} a letter`, `Le escribiste una carta a ${partnerName}`) : t(`${partnerName} 给你写了一封信`, `${partnerName} wrote you a letter`, `${partnerName} te escribió una carta`)}</strong><small>{openOn && t(`${longDay(openOn)} 打开 · 还有 ${days} 天`, `Opens ${longDay(openOn)} · ${counted(days, "day", "days")} to go`, `Se abre el ${longDay(openOn)} · faltan ${counted(days, "día", "días")}`)}</small></div></article>;
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
    if (message.kind === "game" && message.game) return questionEntry(message, text);
    if (message.kind === "watch_check") return <WatchCheckCard key={message.id} language={language} text={text} answer={message.watchAnswer} members={together?.members || []} onAnswer={(finished) => void answerWatch(message.id, finished)} />;
    if (message.kind === "daily_question") return playTogether && message.id === todayQuestion?.id ? null : questionEntry(message, text);
    if (message.kind === "story" && message.story) { const story = message.story; return <div key={message.id} className="conversation-turn"><StoryCard language={language} story={story} onOpen={() => { keyboard.hide(); setOpenStory(story); }} /></div>; }
    if (message.kind === "call" && message.call) return <CallRecord key={message.id} language={language} title={text} call={message.call} />;
    if (message.kind === "reminder" || message.kind === "review") {
      const outcome = message.refs.find((item) => item.type === "outcome");
      // An agreement's check-in is answered in one tap (save time, not kill time, 11-07): the answer goes to Ourever as this
      // member's reply, within the check-in's 12 hours and until they have said something after it.
      const checkIn = message.kind === "review" && message.refs.some((item) => item.type === "agreement") && !together?.readOnly && Date.now() - Date.parse(message.createdAt) < 12 * 3_600_000 && !sharedMessages.slice(index + 1).some((item) => item.role === "member" && item.actorUserId === user.id);
      return <article key={message.id} className="conversation-card notice-card"><header>{message.kind === "review" ? t("该复盘了", "Time to review", "Hora de revisar") : t("提醒", "Reminder", "Recordatorio")}</header><p>{text}</p>{outcome && <div className="card-actions"><button onClick={() => open(`/?view=decide&outcome=${encodeURIComponent(outcome.id)}`)}>{t("去复盘", "Start review", "Empezar revisión")}<ArrowRight size={16} /></button></div>}{checkIn && <QuickReply language={language} busy={busy} testId="check-in-answers" options={[t("这周做到了", "Kept it this week", "Lo cumplimos esta semana"), t("做到了一部分", "Partly", "En parte"), t("这周没做到", "Not this week", "Esta semana no")].map((label) => ({ value: label, label }))} onAnswer={(answer) => sendShared(answer)} />}</article>;
    }
    const links = message.role === "agent" ? message.refs.filter((ref) => ref.type === "space" || ref.type === "milestone") : [];
    const chatRequest = message.refs.find((ref) => ref.type === "chat_import_request"), chatShared = message.refs.find((ref) => ref.type === "chat_import");
    const handoffs = message.role === "agent" ? message.refs.filter((ref) => ref.type === "link" && ref.url) : [];
    const from = message.role === "agent" ? "from-agent" : mine ? "from-me" : "from-partner";
    const article = <article className={`conversation-message ${from}`}>{!continued && (author || message.kind === "relay") && <span>{author}{message.kind === "relay" && <em><LockKey size={13} />{t("本人确认后分享", "Shared after review", "Compartido tras revisarlo")}</em>}</span>}{!!message.photoIds?.length && <Photos ids={message.photoIds} language={language} />}{text && <p dir="auto">{message.role === "agent" ? <Linked text={text} /> : text}</p>}
      <RecallLinks sources={message.refs.filter((ref) => ref.type === "conversation" && ref.channel === "us" && ref.conversationId && ref.messageId) as ConversationSource[]} language={language} busy={recall.busy} onJump={(source) => void recall.jump(source)} />
      {!!links.length && <div className="message-links">{links.map((ref) => <button key={`${ref.type}:${ref.id}`} onClick={() => open(ref.system === "watched" ? "/?view=moments&watched=1" : ref.system === "moments" ? "/?view=moments" : ref.type === "space" ? `/?view=space&space=${encodeURIComponent(ref.id)}` : "/?view=upcoming")}>{ref.system === "watched" ? t("一起看过的", "Watched together", "Vistos juntos") : ref.system === "moments" ? t("回忆", "Moments", "Momentos") : ref.type === "space" ? ref.title || t("打开空间", "Open space", "Abrir espacio") : t(`日期：${ref.title || ""}`, `Date: ${ref.title || ""}`, `Fecha: ${ref.title || ""}`)}<ArrowRight size={15} /></button>)}</div>}
      {!!handoffs.length && <div className="message-handoffs">{handoffs.map((ref) => <Handoff key={ref.id} title={ref.title || ""} url={ref.url!} language={language} onOpen={open} />)}</div>}
      {chatRequest && <div className="card-actions">{approvedImports.has(chatRequest.id) ? <small className="card-state"><CheckCircle size={16} weight="fill" />{t("已同意一起看", "Agreed to look together", "Aceptado para verlo juntos")}</small> : mine ? <small className="card-state">{t("等 TA 同意", "Waiting for your partner", "Esperando a tu pareja")}</small> : <button className="card-primary" disabled={busy} onClick={() => void approveImport(chatRequest.id)}><CheckCircle size={18} weight="fill" />{t("同意一起看", "Agree to look together", "Aceptar verlo juntos")}</button>}</div>}
      {chatShared && <div className="message-links"><button onClick={() => open(`/?view=import&import=${encodeURIComponent(chatShared.id)}`)}><ChatsCircle size={16} />{t("查看聊天记录分析", "See the chat history analysis", "Ver el análisis del historial")}<ArrowRight size={15} /></button></div>}
    </article>;
    if (mine) return <div key={message.id} className="us-row from-me">{article}</div>;
    // Partner and Ourever sit on the left, each with their own avatar so the two are told apart at a glance.
    return <div key={message.id} className={`us-row ${from}${continued ? " is-continued" : ""}`}><i className={`us-avatar${message.role === "agent" ? " is-pinky" : ""}`} aria-hidden="true">{continued || message.role === "agent" ? "" : (Array.from(partnerRaw)[0] || "?").toUpperCase()}</i>{article}</div>;
  };

  // B: the partner approves looking at the other's chat-history analysis together; only then does a shared copy exist.
  const approveImport = async (id: string) => {
    setBusy(true); setNotice("");
    try { await importAction(id, "share-approve", { language }); } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };
  // Ourever's core (founder 11-08): "I don't know how to reply to her" — a reply coach that works alone, before any pairing.
  const replyCoach = <div className="reply-coach-entry" data-testid="reply-coach-entry"><strong>{t("帮我回 TA 的消息", "Help me reply to a message", "Ayúdame a responder un mensaje")}</strong><p>{t("粘贴 TA 发来的话，或者发一张聊天截图，Ourever 帮你看懂并写好回复。", "Paste what they sent or add a chat screenshot; Ourever helps you read it and write a reply.", "Pega lo que te escribió o añade una captura del chat; Ourever te ayuda a entenderlo y a responder.")}</p><div className="card-actions"><button type="button" className="card-primary" onClick={() => { setDraft(t("TA 刚发来：", "They just sent me: ", "Me acaba de escribir: "), "me"); composerRef.current?.querySelector("textarea")?.focus(); }} data-testid="reply-coach-paste"><ChatCircleDots size={18} />{t("粘贴 TA 的话", "Paste their message", "Pegar su mensaje")}</button><button type="button" onClick={() => { keyboard.hide(); fileRef.current?.click(); }} data-testid="empty-screenshot"><ImageSquare size={18} />{t("发截图", "Send a screenshot", "Enviar captura")}</button></div></div>;
  const meEmpty = <section className="conversation-empty" data-testid="reply-coach-empty">{replyCoach}<h1>{t(`${salutation}，最近哪件小事让你觉得被在乎？`, `${salutation}, when did you last feel cared for?`, `${salutation}, ¿cuándo sentiste por última vez que te cuidaban?`)}</h1><p>{t("把那一刻写在这里；即使伴侣加入，这段对话也只有你能看到。", "Write about that moment here. This conversation stays private when your partner joins.", "Escribe aquí sobre ese momento. Esta conversación seguirá siendo privada cuando se una tu pareja.")}</p></section>;
  const usEmpty = <section className="conversation-empty"><h1>{t(`和 ${partnerName} 聊天`, `Chat with ${partnerName}`, `Habla con ${partnerName}`)}</h1><p>{t("你们俩都能看到这里的消息。", "You can both see messages here.", "Ambos pueden ver los mensajes aquí.")}</p><button type="button" className="conversation-empty-link" onClick={() => composerRef.current?.querySelector("textarea")?.focus()}>{t("写第一条消息", "Write the first message", "Escribir el primer mensaje")}</button></section>;
  const formerUs = former && !paired && <section className="former-us" data-testid="former-us">
    <button type="button" className="conversation-earlier" onClick={() => setFormerOpen(!formerOpen)} aria-expanded={formerOpen}><ClockCounterClockwise size={16} />{formerOpen ? t("收起以前的聊天", "Hide earlier chat", "Ocultar el chat anterior") : t(`你和 ${former.name || "TA"} 以前的聊天（只读）`, `Your chat with ${former.name || "your partner"} (read-only)`, `Tu chat con ${former.name || "tu pareja"} (solo lectura)`)}</button>
    {formerOpen && <>{former.messages.map((line) => <div key={line.id} className={`us-row ${line.mine ? "from-me" : line.role === "agent" ? "from-agent" : "from-partner"}`}><article className={`conversation-message ${line.mine ? "from-me" : line.role === "agent" ? "from-agent" : "from-partner"}`}>{!line.mine && <span>{line.role === "agent" ? "Ourever" : former.name}</span>}<p dir="auto">{line.text}</p></article></div>)}
      <p className="conversation-notice">{t("对方已删除账号，这里只能查看。", "They deleted their account; this chat is read-only.", "Borró su cuenta; este chat es de solo lectura.")}</p></>}
  </section>;
  const invite = <>{formerUs}<InvitePanel state={invitation} onEnterCode={enterPartnerCode} /></>;

  // A long conversation keeps its older messages in pages (memory plan, 11-09); they load on request, newest page first.
  const shownEarlier = earlierMe.sessionId === session?.id ? earlierMe : { sessionId: session?.id || "", page: 0, messages: [] as PrivateMessage[] };
  const privateMessages = [...shownEarlier.messages, ...(session?.messages || [])];
  const loadEarlierMe = async () => {
    if (!session || loadingEarlierMe) return;
    followingLatest.current = false;
    setLoadingEarlierMe(true);
    try { const result = await relationshipApi<{ messages: PrivateMessage[] }>(`/api/assistant/sessions/${encodeURIComponent(session.id)}/earlier?page=${shownEarlier.page + 1}`); setEarlierMe({ sessionId: session.id, page: shownEarlier.page + 1, messages: [...result.messages, ...shownEarlier.messages] }); }
    catch (error) { setNotice((error as Error).message); } finally { setLoadingEarlierMe(false); }
  };
  // An import is reported twice (received, then read); its live card shows only on the latest of those messages.
  const importAt = new Map(privateMessages.flatMap((message, index) => (message.cards || []).filter((card) => card.kind === "chat_import").map((card) => [card.id, index] as const)));
  // Earlier pages sit above the live working set; one list keeps the group-chat run detection working across the seam.
  const liveMessages = together?.conversation.messages || [];
  const liveMessageIds = new Set(liveMessages.map((message) => message.id));
  const olderMessages = (older?.messages || []).filter((message) => !liveMessageIds.has(message.id));
  const sharedMessages = [...olderMessages, ...liveMessages];
  const openQuestion = openQuestionId ? sharedMessages.find((message) => message.id === openQuestionId) : null;
  const hasOlder = Boolean(paired && together) && (older ? older.more : (together?.conversation.archived?.messages || 0) > 0);
  const wantIdeas = !started;
  const emptyPrivateChat = channel === "me" && (session || (!thread && noSavedSession))
    && !privateMessages.length && !session?.earlierPages && !queued.length && !failed.length && !waitingMe;
  const showStarters = emptyPrivateChat && !draft.trim() && !attachments.length && !voice.listening;
  // Typing, talking or sending anything (a photo included) is starting to use the app.
  useEffect(() => { if (draft.trim() || voice.listening || queued.length) setStarted(true); }, [Boolean(draft.trim()), voice.listening, queued.length]);
  const showNudge = channel === "us" && paired && wantIdeas && !draft.trim() && !voice.listening && !readOnly && Boolean(nudge);
  useEffect(() => {
    if (channel !== "us" || !paired || !wantIdeas) return;
    let alive = true;
    promiseToMention(language).then((item) => { if (alive) setNudge(item); }).catch(() => {});
    return () => { alive = false; };
  }, [channel, language, paired, wantIdeas]);
  // In Just me only this phone's own wait counts; in Us also a reply Ourever is preparing for the partner.
  const working: AgentActivity = channel === "me" ? (pendingScreenshot ? { step: "reading_screenshot" } : waitingMe ? activity.me || { step: "thinking" } : null) : paired ? activity.us || (waitingUs ? { step: "thinking" } : null) : null;
  const draftCard = channel === "us" && paired && together?.conversation.draftAgreement && !pendingAgreement && !together.readOnly ? together.conversation.draftAgreement : null;
  const extrasIn = !paired || mascotLoaded;
  if (!shown.current && (firstLook.cap || firstLook.session && firstLook.together && (extrasIn || firstLook.grace))) shown.current = true;
  const conversationVisible = shown.current;
  const currentThread = channel === "me" ? thread : null;
  const latestOwn = liveMessages.filter(line => line.role === "member" && !line.removedAt && line.actorUserId === user.id).at(-1);
  const incoming = liveMessages.filter(line => line.role === "member" && !line.removedAt && line.actorUserId !== user.id).at(-1);
  const showingMessages = conversationVisible && channel === "us" && !drawer && !call && !recall.active && !petRoom && !gameHall && !playTogether && !openQuestionId && !interaction;
  useEffect(() => {
    if (!incoming || incoming.readAt || together?.readOnly) return;
    const acknowledge = (state: "delivered" | "read") => relationshipApi(`/api/together/messages/${encodeURIComponent(incoming.id)}/receipt`, { ...jsonBody({ state, language }), keepalive: true }).catch(() => {});
    if (!incoming.deliveredAt) void acknowledge("delivered");
    if (!showingMessages) return;
    const row = conversationContent.current?.querySelector<HTMLElement>(`[data-shared-id="${CSS.escape(incoming.id)}"]`);
    if (!row) return;
    let visible = false;
    const mark = () => { if (visible && !document.hidden && document.hasFocus()) void acknowledge("read"); };
    const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting || false; mark(); });
    observer.observe(row);
    window.addEventListener("focus", mark);
    document.addEventListener("visibilitychange", mark);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", mark); window.removeEventListener("focus", mark); };
  }, [incoming?.id, incoming?.readAt, incoming?.deliveredAt, showingMessages, together?.readOnly, language]);

  useLayoutEffect(() => {
    const content = conversationContent.current;
    const viewport = content?.closest<HTMLElement>(".mobile-scroll");
    if (!conversationVisible || recall.active || !content || !viewport) return;

    // Show an empty conversation from its question, even when large text pushes the suggestions below the fold.
    if (emptyPrivateChat) { viewport.scrollTop = 0; return; }
    // The viewport does not exist while the opening screen is showing.
    followingLatest.current = true;
    const follow = () => {
      if (followingLatest.current) viewport.scrollTop = viewport.scrollHeight;
    };
    const trackScroll = () => {
      followingLatest.current = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 48;
    };
    follow();
    viewport.addEventListener("scroll", trackScroll, { passive: true });
    const observer = new ResizeObserver(follow);
    observer.observe(content);
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", trackScroll);
    };
  }, [conversationVisible, channel, currentThread, recall.active, reopenedAt, Boolean(emptyPrivateChat)]);

  if (!conversationVisible) return <div className="loading-screen" aria-busy="true" data-testid="booting" role="status">{t("正在打开对话…", "Opening your conversation…", "Abriendo tu conversación…")}</div>;
  return <div className={`paper-screen conversation-home ${working ? "is-agent-working" : ""}`} data-testid="conversation-screen" data-layer-open={gameHall || playTogether || interaction || petRoom ? "" : undefined} data-feedback-view={gameHall ? "games" : playTogether || openQuestionId ? "questions" : petRoom ? "pet" : call ? "call" : "conversation-" + channel}>
    {!!hearts && <div key={hearts} className="miss-you-hearts" aria-hidden="true">{Array.from({ length: 7 }, (_, index) => <Heart key={index} size={22 + (index % 3) * 8} weight="fill" style={{ left: `${12 + index * 12}%`, animationDelay: `${index * 0.09}s` }} />)}</div>}
    <header className="conversation-header">
      {/* One row: menu, the two channels, and a live voice call with Ourever (privately in Just me, for everyone in the room in Us). */}
      <div className="conversation-topline">
        <button className="conversation-menu" onClick={openDrawer} aria-label={t("打开菜单", "Open menu", "Abrir menú")} aria-expanded={drawer} data-testid="open-drawer"><List size={24} /></button>
        {usHidden ? <div className="conversation-segments single"><button type="button" className="active" aria-current="page"><LockKey size={17} />{t("只有我", "Just me", "Solo yo")}</button></div> : <div className="conversation-segments" role={peopleLink ? "group" : "tablist"} aria-label={t("对话频道", "Conversation channel", "Canal de conversación")}>
          <button type="button" role={peopleLink ? undefined : "tab"} aria-selected={peopleLink ? undefined : channel === "me"} aria-current={peopleLink && channel === "me" ? "page" : undefined} className={channel === "me" ? "active" : ""} onClick={() => switchChannel("me")}><LockKey size={17} />{t("只有我", "Just me", "Solo yo")}{unreadMe && <i className="tab-dot" aria-label={t("有新消息", "New message", "Mensaje nuevo")} />}</button>
          {peopleLink ? <button type="button" onClick={() => open("/?view=people")} data-testid="tab-people"><UsersThree size={17} />{t("在了解的人", "People", "Personas")}</button> : <button role="tab" aria-selected={channel === "us"} className={channel === "us" ? "active" : ""} onClick={() => switchChannel("us")}><UsersThree size={17} />{t("我们俩", "Us", "Nosotros")}{stage === "chosen" && peopleState.chosen && <small className="tab-sub">{t(` · 邀请${plainName(peopleState.chosen.name)}`, ` · invite ${plainName(peopleState.chosen.name)}`, ` · invitar`)}</small>}{unreadUs && <i className="tab-dot" aria-label={t("有新消息", "New message", "Mensaje nuevo")} />}</button>}
        </div>}
        {channel === "us" && paired && <button className="conversation-call conversation-heart" onClick={() => void missYou()} aria-label={t("想你了", "Thinking of you", "Pienso en ti")} data-testid="miss-you"><Heart size={22} weight="fill" /></button>}
        {recall.dateButton}
        <button className="conversation-call" onClick={() => void startCall()} disabled={Boolean(call) || (channel === "us" && !paired)} aria-label={t("和 Ourever 通话", "Call Ourever", "Llamar a Ourever")} data-testid="start-call"><Phone size={22} /></button>
      </div>
      {channel === "me" && stage !== "together" && <PeopleRow language={language} people={people} current={thread} unread={people.filter((item) => item.id !== thread && item.thread?.lastFrom === "assistant" && item.thread.updatedAt > (seen[item.id] || "")).map((item) => item.id)} brainUnread={brainUnread} onBrain={() => openThread(null)} onOpen={(item) => openThread(item.id)} onAdd={() => fileRef.current?.click()} />}
      {channel === "me" && !paired && !inviteBarHidden && <InviteBar state={invitation} onEnterCode={enterPartnerCode} onDismiss={hideInviteBar} />}
      {former && !former.seen && !paired && <p className="partner-joined" role="status" data-testid="former-notice">{t(`${former.name || "TA"} 删除了账号。你们以前在“我们俩”的聊天记录会在这里保留，只能查看。`, `${former.name || "Your partner"} deleted their account. Your shared history in Us is kept here, read-only.`, `${former.name || "Tu pareja"} borró su cuenta. Su historial compartido en Nosotros se conserva aquí, solo para leer.`)}<button type="button" onClick={() => { seeFormer(); if (!usHidden) { switchChannel("us"); setFormerOpen(true); } }}>{t("查看", "View", "Ver")}</button><button type="button" onClick={seeFormer}>{t("知道了", "OK", "Entendido")}</button></p>}
      {welcomePartner && <p className="partner-joined" role="status" data-testid="partner-joined"><Heart size={18} weight="fill" aria-hidden="true" />{t("你的伴侣加入了，你们的共同空间已开启。", "Your partner joined. Welcome to your shared space.", "Tu pareja se ha unido. Este es su espacio compartido.")}{channel === "me" && !usHidden && <button type="button" disabled={!!attachments.length || voiceActive || !!call} onClick={() => switchChannel("us")}>{t("打开我们俩", "Open Us", "Abrir Nosotros")}</button>}</p>}
      {channel === "me" && thread && (() => { const about = people.find((item) => item.id === thread); return about ? <div className="thread-bar" data-testid="thread-bar"><span>{t(`只聊${plainName(about.name)}`, `Just about ${plainName(about.name)}`, `Solo sobre ${plainName(about.name)}`)}</span><button type="button" onClick={() => open(`/?view=people&person=${encodeURIComponent(about.id)}`)}>{t("完整档案", "Full page", "Ficha")}</button></div> : null; })()}
      {channel === "us" && paired && together && (() => { const partner = together.members.find((member) => member.id !== user.id); return partner ? <DistanceBar language={language} partnerName={partner.name || t("TA", "Your partner", "Tu pareja")} partnerZone={together.conversation.zones?.[partner.id] || null} nextMeeting={together.nextMeeting || null} care={Boolean(together.care)} onInteract={() => { keyboard.hide(); setInteraction("touch"); }} /> : null; })()}
      {recall.controls}
      {working && <div className="agent-status-top"><AgentStatusPill activity={working} language={language} /></div>}
    </header>
    <div className="conversation-stream"><MobileScroll className="conversation-scroll"><main ref={conversationContent} className={`conversation-thread${channel === "me" && emptyPrivateChat && !aiOff ? " has-reply-coach" : ""}`} aria-live="polite">{recall.active ? recall.history : <>
      {channel === "me" ? <>{session && (session.earlierPages || 0) > shownEarlier.page && <button type="button" className="conversation-earlier" disabled={loadingEarlierMe} onClick={() => void loadEarlierMe()} data-testid="earlier-me">{loadingEarlierMe ? t("正在找…", "Loading…", "Cargando…") : t("更早的消息", "Earlier messages", "Mensajes anteriores")}</button>}{sessionLoadFailed && !session && <div role="alert" className="conversation-retry"><span>{t("暂时无法打开私人对话。", "Your private conversation couldn’t load.", "No se pudo abrir tu conversación privada.")}</span><button onClick={() => setLoadAttempt(n => n + 1)}>{t("重试", "Retry", "Reintentar")}</button></div>}{emptyPrivateChat && !aiOff && meEmpty}{privateMessages.map((message, index) => {
        const cards = groupCards((message.cards || []).filter((card) => card.kind !== "chat_import" || importAt.get(card.id) === index)).map(privateCard);
        if (message.role === "assistant" && !message.text?.trim() && !message.photoIds?.length && !message.call && !message.dateCheck && !message.kind) {
          return <Fragment key={message.id}><RecallLinks sources={message.sources} language={language} busy={recall.busy} onJump={(source) => void recall.jump(source)} />{cards}</Fragment>;
        }
        const canRegenerate = !generating.me && session?.messages.at(-1)?.id === message.id && message.role === "assistant" && (!session.messages.at(-2) || session.messages.at(-2)?.role === "user") && Boolean(message.text) && !message.screenshotPending && !message.stopped && !message.call && !message.kind;
        const actions = session ? <ReportReply messageMenu photoIds={message.photoIds} canReport={message.role === "assistant"} onRegenerate={canRegenerate ? () => void regenerate("me", message.id) : undefined} replyText={message.text || message.call?.rows.map(row => row.text).join("\n")} language={language} channel="me" conversationId={session.id} messageId={message.id} /> : null;
        return <Fragment key={message.id}>{timeGap(privateMessages[index - 1]?.createdAt, message.createdAt)}{message.kind === "together_ask" ? <article key={message.id} className="conversation-message from-pinky together-ask" data-testid="together-ask">{actions}<p>{message.text}</p>{stage === "dating" && message.personId && !answered.includes(message.id) && <div className="together-ask-actions"><button type="button" className="card-primary" onClick={() => void answerTogether(message.id, message.personId!, true)} data-testid="together-yes">{t("是的", "Yes", "Sí")}</button><button type="button" className="card-secondary" onClick={() => void answerTogether(message.id, message.personId!, false)} data-testid="together-no">{t("还没有", "Not yet", "Aún no")}</button></div>}</article> : message.kind === "noted" ? (() => { const about = message.personId ? people.find((item) => item.id === message.personId) : null; return <div className="private-note-actions">{actions}<button key={message.id} type="button" className={`conversation-noted ${about ? "person-noted" : ""}`} onClick={() => { keyboard.hide(); if (about && thread !== about.id) openThread(about.id); else if (about) open(`/?view=people&person=${encodeURIComponent(about.id)}`); else onPrivacy("profile"); }} data-testid={about ? "person-noted" : "profile-noted"}><Heart size={14} weight="fill" /><span>{message.text}</span>{about && <span className="noted-open">{thread !== about.id ? t("去对话", "Open chat", "Ir al chat") : t("档案", "Page", "Ficha")}</span>}</button></div>; })() : <div key={message.id} className={`conversation-turn${message.role === "user" ? " from-me" : ""}`} onClick={showTime(message.id)}><article className={`conversation-message ${message.role === "user" ? "from-me" : "from-agent"}`}>{actions}{message.call && <CallRecord language={language} title="" call={message.call} />}{message.role === "assistant" && !message.call && <span className="assistant-byline">Ourever</span>}{!!message.photoIds?.length && <Photos ids={message.photoIds} language={language} />}{message.text && <p>{message.role === "assistant" ? <Linked text={message.text} /> : message.text}</p>}
          {message.copyableReply && <button type="button" className="card-secondary" onClick={async () => {
            try { await navigator.clipboard.writeText(message.copyableReply!); setNotice(t("已复制建议回复", "Suggested reply copied", "Respuesta sugerida copiada")); }
            catch { setNotice(t("请长按回复文字并选择复制。", "Touch and hold the reply text, then choose Copy.", "Mantén pulsada la respuesta y elige Copiar.")); }
          }}><Copy size={16} />{t("复制建议回复", "Copy suggested reply", "Copiar respuesta sugerida")}</button>}</article>{timeOf === message.id && <time className="message-time" dateTime={message.createdAt}>{stampLabel(message.createdAt)}</time>}<RecallLinks sources={message.sources} language={language} busy={recall.busy} onJump={(source) => void recall.jump(source)} />{cards}{message.dateCheck && !message.dateAnswer && <QuickReply language={language} busy={busy} testId="date-check-answers" options={([["great", "很开心", "Loved it", "Me encantó"], ["ok", "还行", "It was okay", "Estuvo bien"], ["meh", "不太行", "Not great", "No tanto"]] as const).map(([value, zh, en, es]) => ({ value, label: t(zh, en, es) }))} onAnswer={(rating) => void answerDate(message.id, rating)} />}{message.dateCheck && message.dateAnswer?.rating === "great" && !message.dateAnswer.told && paired && <div className="card-actions date-check-answers"><button disabled={busy} onClick={() => void tellPartner(message)} data-testid="date-check-tell"><Heart size={16} weight="fill" />{t(`也告诉 ${partnerName || "TA"}`, `Tell ${partnerName || "them"} too`, `Díselo a ${partnerName || "tu pareja"}`)}</button></div>}</div>}</Fragment>; })}</> :
        !paired ? invite : <>{together && !sharedMessages.length && usEmpty}
          {hasOlder && <button type="button" className="conversation-earlier" disabled={loadingOlder} onClick={() => void loadOlder()} data-testid="earlier-messages">{loadingOlder ? t("正在找…", "Loading…", "Cargando…") : t("更早的消息", "Earlier messages", "Mensajes anteriores")}</button>}
          <OlderWindow count={olderMessages.length} keyOf={(index) => sharedMessages[index]?.id || String(index)} render={(start, end) => sharedMessages.slice(start, end).map((message, offset) => sharedMessage(message, start + offset))} /><div ref={olderRef} className="conversation-seam" aria-hidden="true" />{sharedMessages.slice(olderMessages.length).map((message, index) => sharedMessage(message, index + olderMessages.length))}
          {draftCard && <article className="conversation-card draft-card" data-testid="agreement-draft"><header><ChatCircleDots size={16} />{t("Ourever 起草的约定", "Agreement drafted by Ourever", "Acuerdo redactado por Ourever")}</header><strong>{draftCard.title}</strong><p>{draftCard.summary}</p><ol>{draftCard.terms.map((term) => <li key={term}>{term}</li>)}</ol>{!!draftCard.unresolvedPoints?.length && <div className="agreement-open"><small>{t("还没定的", "Still open", "Pendiente")}</small><ul>{draftCard.unresolvedPoints.map((point, index) => <li key={index}>{point}</li>)}</ul></div>}<small>{t("发出后，你们俩都要批准同一版本才生效。", "Once sent, it takes effect only when both of you approve the same version.", "Una vez enviado, solo entra en vigor cuando ambos aprueben la misma versión.")}</small><div className="card-actions"><button className="card-primary" disabled={busy} onClick={() => void draftAgreement()}>{t("发给你们俩批准", "Send for both to approve", "Enviar para que ambos aprueben")}</button></div></article>}
        </>}
      {voice.partial && <p className="conversation-partial">{voice.partial.text || t("正在听…", "Listening…", "Escuchando…")}</p>}
      {channel === "me" && queued.map((item) => <article key={item.itemId} className="conversation-message from-me is-sending"><p dir="auto">{item.text}</p></article>)}
      {working && <AgentTyping activity={working} language={language} inUs={channel === "us"} />}
      {showNudge && <PromiseNudge item={nudge!} partnerName={partnerName} language={language} onSettled={() => setNudge(null)} onOpenAll={() => open("/?view=upcoming")} />}
      {showStarters && !aiOff && <div className="conversation-suggestions" data-testid="private-chat-starters">
        {[t("最近让我觉得被在乎的一件事是…", "I felt cared for when…", "Sentí que me cuidaban cuando…"), t("我希望能和 TA 聊聊…", "I wish we could talk about…", "Me gustaría que habláramos de…")].map((text) =>
          <button type="button" key={text} onClick={() => { setDraft(text, "me"); composerRef.current?.querySelector("textarea")?.focus(); }}>{text}</button>)}
      </div>}
      <div aria-hidden="true" />
    </>}</main></MobileScroll></div>
    <TogetherSheet language={language} person={settledOn} others={putAway} onClose={() => setTogetherPerson(null)} onInvite={() => { setTogetherPerson(null); switchChannel("us"); }} />
    {call && <footer className="conversation-composer conversation-call-footer"><CallPanel language={language} started={call} partnerName={partnerName} onEnded={(message) => { setCall(null); if (message) setNotice(message); void reloadSession(); }} /></footer>}
    {aiOff && channel === "me" && <footer className="conversation-composer ai-off-card" data-testid="ai-off">
      <p>{aiOffWhy && <span className="ai-off-why" data-testid="ai-off-why">{aiOffWhy}</span>}<strong>{t("Ourever 的 AI 已关闭", "Ourever's AI is off", "La IA de Ourever está desactivada")}</strong>{paired
        ? t("你没有同意第三方 AI 处理，所以这里不会回复。“我们俩”照常可以和 TA 聊天。", "You haven't allowed third-party AI, so nothing replies here. You can still chat with your partner in Us.", "No has permitido la IA de terceros, así que aquí nadie responde. Puedes seguir hablando con tu pareja en Nosotros.")
        : t("你没有同意第三方 AI 处理，所以这里不会回复。邀请伴侣后，你们可以在“我们俩”里聊天。", "You haven't allowed third-party AI, so nothing replies here. Invite your partner to chat together in Us.", "No has permitido la IA de terceros, así que aquí nadie responde. Invita a tu pareja para hablar en Nosotros.")}</p>
      <button type="button" className="primary-action" onClick={() => { keyboard.hide(); onPrivacy("processors"); }} data-testid="ai-off-settings">{t("在设置里打开 AI", "Turn on AI in Settings", "Activar la IA en Ajustes")}</button>
    </footer>}
    {!recall.active && !call && !(channel === "us" && !paired) && !(aiOff && channel === "me") && <footer className="conversation-composer" ref={composerRef}>
      {notice && <p className="conversation-notice" role="alert">{notice}</p>}
      {channel === "me" && failed.map((item) => <div key={item.itemId} className="conversation-retry" data-testid="private-retry"><span>{t("这句话还没确认送达。", "This message was not confirmed.", "Este mensaje no se confirmó.")} <q>{item.text}</q></span><span className="conversation-retry-actions"><button type="button" onClick={() => discardPrivate(item.itemId)}>{t("删除", "Delete", "Eliminar")}</button><button type="button" disabled={queued.some((entry) => entry.itemId === item.itemId)} onClick={() => void sendPrivate(item.text, item.itemId, false, item.photoIds || [])}>{t("重试", "Retry", "Reintentar")}</button></span></div>)}
      {channel === "us" && unconfirmedShared.map((item) => <div key={item.itemId} className="conversation-retry shared-retry" role="status">
        <span><strong>{t("未确认送达", "Delivery unconfirmed", "Entrega sin confirmar")} · {item.recipient === "assistant" ? "Ourever" : partnerName}</strong>
          {item.text && <span>{item.text}</span>}{item.photoIds.length > 0 && <small>{t(`照片：${item.photoIds.length}`, `Photos: ${item.photoIds.length}`, `Fotos: ${item.photoIds.length}`)}</small>}</span>
        <span className="conversation-retry-actions"><button type="button" disabled={pending.us > 0} onClick={() => discardShared(item.itemId)}>{t("删除", "Delete", "Eliminar")}</button><button type="button" disabled={pending.us > 0} onClick={() => void deliverShared(item)}>{t("重试", "Retry", "Reintentar")}</button></span>
      </div>)}
      {voice.listening && channel === "me" && <p className="conversation-listening">{t("正在听。说“结束语音”即可停止。", "Listening. Say “stop listening” to finish.", "Escuchando. Di «deja de escuchar» para terminar.")}</p>}
      {voice.listening && channel === "us" && !dictating && <div className="together-voice" data-testid="together-voice">
        <label className="together-switch"><input type="checkbox" checked={talkTogether} onChange={(event) => setTalkTogether(event.target.checked)} /><span>{t("一起说：每句直接发到“我们俩”", "Talk together: each sentence goes straight to Us", "Hablar juntos: cada frase va directo a Nosotros")}</span></label>
        {talkTogether ? <div className="together-speakers" role="group" aria-label={t("谁在说", "Who is speaking", "Quién habla")}><span>{t("谁在说", "Speaking", "Habla")}</span>{(["me", "partner"] as const).map((who) => <button key={who} type="button" className={speaker === who ? "active" : ""} aria-pressed={speaker === who} onClick={() => setSpeaker(who)}>{who === "me" ? user.name : partnerName}</button>)}</div>
          : <p>{t("说完的话会先放进输入框，确认后再发。", "What you say goes into the box first; send it when ready.", "Lo que digas va primero al cuadro; envíalo cuando quieras.")}</p>}
      </div>}
      {!!attachments.length && <div className="composer-photos">{attachments.map((item) => <figure key={item.key} className={item.failed ? "failed" : item.id ? "" : "uploading"}><img src={item.preview} alt="" draggable={false} /><button type="button" onClick={() => setAttachments((items) => items.filter((entry) => entry.key !== item.key))} aria-label={t("移除照片", "Remove photo", "Quitar foto")}><X size={14} weight="bold" /></button></figure>)}</div>}
      {channel === "us" && !readOnly && !aiOff && <div className="shared-recipient">
        <button type="button" aria-pressed={askingInUs} onClick={() => { setAskAgent(!askingInUs); composerRef.current?.querySelector("textarea")?.focus(); }}>
          <Sparkle size={16} aria-hidden="true" />{askingInUs ? t(`改发给 ${partnerName}`, `Message ${partnerName} instead`, `Escribir a ${partnerName}`) : t("问 Ourever", "Ask Ourever", "Preguntar a Ourever")}
        </button>
        {askingInUs && <span role="status">{t("你们俩都能看到提问和回复。", "You can both see the question and reply.", "Ambos verán la pregunta y la respuesta.")}</span>}
      </div>}
      {/* Who sees this is explained once in the welcome tour and shown by the tabs; no standing line above the box (founder 11-08). Screen readers still hear it. */}
      {!readOnly && <span className="composer-audience-sr" id={audienceId}>{audience}</span>}
      {readOnly ? <p className="conversation-notice">{t("你们的共同空间已结束，这里只能查看。", "Your shared space has ended; this conversation is read-only.", "Su espacio compartido terminó; esta conversación es de solo lectura.")}</p> :
        <div className="conversation-input">
          <button type="button" className="conversation-photo" onClick={() => { keyboard.hide(); fileRef.current?.click(); }} disabled={attachments.length >= 6} aria-label={t("发照片", "Send a photo", "Enviar una foto")} data-testid="conversation-photo"><ImageSquare size={22} /></button>
          <input ref={fileRef} type="file" accept="image/*,.txt,.zip,.json,.csv,.xml,.html" multiple hidden onChange={(event) => void pickPhotos(event.target.files)} data-testid="conversation-photo-input" />
          {draft.length >= DRAFT_LIMIT - 200 && <small className="composer-count" aria-live="polite" data-testid="composer-count">{draft.length}/{DRAFT_LIMIT}</small>}
          <KeyboardTextarea dir="auto" onPaste={(event) => {
            const pasted = event.clipboardData.getData("text/plain");
            if (!pasted) return;
            pastedDraft.current[channel] = true;
            // The box holds 2,000 characters; a longer paste is cut, and says so instead of losing the rest silently.
            const field = event.currentTarget;
            if (draft.length - (field.selectionEnd - field.selectionStart) + pasted.length > DRAFT_LIMIT) setNotice(t("只放得下前 2000 个字，后面的部分没有贴进来。", "Only the first 2,000 characters fit; the rest wasn't pasted.", "Solo caben los primeros 2000 caracteres; el resto no se pegó."));
          }} data-testid="conversation-input" aria-label={placeholder} aria-describedby={audienceId} value={draft} onChange={(event) => setDraft(event.target.value)} rows={1} maxLength={DRAFT_LIMIT} placeholder={bareName(placeholder)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} />
          <button type="button" className={`conversation-mic ${voice.listening ? "listening" : ""}`} onClick={() => void toggleVoice()} aria-pressed={voice.listening} aria-label={voice.listening || voice.connecting ? t("结束语音", "End voice", "Terminar voz") : t("开始语音", "Start voice", "Iniciar voz")}>{voice.listening || voice.connecting ? <StopCircle size={22} weight="fill" /> : <Microphone size={22} />}</button>
          {generating[channel] || channel === "me" && pendingScreenshot ? <button type="button" className="conversation-send" onClick={() => generating[channel] ? stopReply(channel) : void stopScreenshot()} aria-label={t("停止生成", "Stop generating", "Detener respuesta")}><span aria-hidden="true">■</span></button> :
          <button type="button" className="conversation-send" onClick={send} disabled={(!draft.trim() && !ready.length) || uploading} aria-label={bareName(sendLabel)} title={bareName(sendLabel)} data-testid="conversation-send"><PaperPlaneRight size={20} weight="fill" /></button>}
        </div>}
    </footer>}
    {importDialog}
    {offerCharacter && !mascot && !joinedHere.current && <CharacterOffer language={language} userId={user.id} onCharacter={() => { keyboard.hide(); onPrivacy("character"); }} onDone={() => setOfferCharacter(false)} />}
    {openStory && <StoryView language={language} story={openStory} onClose={() => setOpenStory(null)} />}
    {paired && together?.pet && !petHidden && !petRoom && !gameHall && !playTogether && !interaction && <FloatingPet userId={user.id} language={language} pet={together.pet} character={mascot} onOpen={openPetRoom} />}
    {petRoom && together?.pet && <PetRoom language={language} pet={together.pet} character={mascot} members={together.members} userId={user.id} hidden={petHidden} onHiddenChange={hidePet} onPetted={(pet) => { setHearts((count) => count + 1); setTogether((current) => current && { ...current, pet }); }} onMakeCharacter={() => { setPetRoom(false); onPrivacy("character"); }} onMembership={() => { setPetRoom(false); onPrivacy("membership"); }} onClose={() => setPetRoom(false)} />}
    {gameHall && paired && <Suspense fallback={null}><GameHall language={language} userId={user.id} initialMatch={gameHall.match} petPicture={mascot?.image ? (mascot.visible ? mascot.image.still : null) : defaultMascot} onClose={closeGames} onPlayCard={(type) => { closeGames(); switchChannel("us"); void playAgain(type); }}
      onQuestions={() => { closeGames(); keyboard.hide(); setPlayTogether({ fromGames: true }); }} /></Suspense>}
    {interaction && paired && <BottomSheet open onOpenChange={(open) => { if (!open) closeInteraction(); }}
      title={t("互动", "Connect", "Conectar")} description={t("碰一下，或者留张小卡。", "Touch together or leave a little card.", "Tóquense o deja una tarjetita.")} snap={0.76}>
      <Suspense fallback={null}><PlayDistance key={together?.conversation.id || user.id} language={language} userId={user.id} revision={together?.conversation.version || 0}
        readOnly={together?.readOnly} conversationId={together?.conversation.id} incomingCard={interaction === "cards"} onClose={closeInteraction} /></Suspense>
      <button type="button" className="connect-poster" onClick={() => { closeInteraction(); open("/?view=moments&ideas=1"); }}>
        <Images size={18} aria-hidden="true" />{t("100 件小事海报", "100 little things poster", "Póster de 100 cosas")}<ArrowRight size={16} aria-hidden="true" />
      </button>
    </BottomSheet>}
    {channel === "us" && openQuestion && <BottomSheet open onOpenChange={(value) => { if (!value) closeQuestion(); }}
      title={t("双人题卡", "Question card", "Tarjeta de preguntas")} snap={0.82}>
      {openQuestion.kind === "daily_question" ? renderDaily(openQuestion) : gameDetails(openQuestion)}
    </BottomSheet>}
    {planQuestionId && paired && <BottomSheet open onOpenChange={(open) => { if (!open) { keyboard.hide(); setPlanQuestionId(null); } }}
      title={t("约会点子", "Date ideas", "Ideas para una cita")} snap={0.84}>
      <Suspense fallback={null}><PlayPlans key={planQuestionId} exactQuestion questionId={planQuestionId} language={language} userId={user.id}
        revision={together?.conversation.version || 0} readOnly={together?.readOnly}
        onOpenCalendar={(url) => { setPlanQuestionId(null); closePlayTogether(); open(url); }} /></Suspense>
    </BottomSheet>}
    {playTogether && <Suspense fallback={null}><PlayTogether key={`${user.id}:${paired}:${together?.conversation.id || ""}`} language={language} userId={user.id} partnerName={partnerName} paired={paired}
      readOnly={paired && together?.readOnly} conversationId={together?.conversation.id} revision={together?.conversation.version || 0}
      initialCardId={playTogether.cardId} fromGames={playTogether.fromGames} onLeaveDaily={leavePlayDaily}
      onClose={() => { closePlayTogether(); if (playTogether.fromGames) openGames(); }} onInvite={() => { closePlayTogether(); if (usHidden) invitation.primaryAction(); else switchChannel("us"); }}
      renderPlans={(questionId) => paired && !planQuestionId ? <Suspense fallback={null}><PlayPlans language={language} userId={user.id} questionId={questionId} revision={together?.conversation.version || 0}
        readOnly={together?.readOnly} onOpenCalendar={(url) => { closePlayTogether(); open(url); }} /></Suspense> : null}
      onRefreshDaily={() => void loadTogether()} renderDaily={(offline) => todayQuestion ? renderDaily(todayQuestion, true, offline) : null}
      // AI off (QA round 5): no "Ask Ourever for a plan" at all; with AI off every Us message goes to the partner, so the
      // prompt addressed to Ourever must never be put in the box.
      onAskPinky={usHidden || aiOff ? undefined : ({ question, own, partner: theirChoice }) => {
        const prompt = t(
          `Ourever，刚才一起玩的题是「${question}」。我选了「${own}」，TA 选了「${theirChoice}」。请给我们一个能一起试的小计划。`,
          `Ourever, we just played “${question}” I chose “${own}” and my partner chose “${theirChoice}”. Give us one small plan we could try together.`,
          `Ourever, acabamos de jugar «${question}». Yo elegí «${own}» y mi pareja «${theirChoice}». Danos un plan pequeño para probar juntos.`,
        );
        keyboard.hide(); closePlayTogether(); switchChannel("us"); setAskAgent(true);
        setDraft((current) => current.trim() ? `${current}\n\n${prompt}` : prompt, "us");
      }} /></Suspense>}
    {drawer && <ConversationDrawer user={user} paired={paired} language={language} data={drawerData} onData={setDrawerData} onPet={together?.pet ? () => { setDrawer(false); openPetRoom(); } : undefined} onClose={() => setDrawer(false)} onOpen={(url) => { setDrawer(false); open(url); }} onInvite={() => { setDrawer(false); if (usHidden) invitation.primaryAction(); else switchChannel("us"); }} onPrivacy={() => { setDrawer(false); onPrivacy(); }} onProfile={() => { setDrawer(false); keyboard.hide(); onPrivacy("profile"); }} onGame={() => { setDrawer(false); openGames(); }} onShare={() => { setDrawer(false); keyboard.hide(); onPrivacy("referrals"); }} onFeedback={() => { setDrawer(false); onFeedback(channel === "us" ? "conversation-us" : "conversation-me"); }} />}
  </div>;
}

/** The top of every page opened from the drawer: the way back to the conversation and the page title, nothing else. */
// The back button names where it goes: the conversation, unless a page returns to another page (`backLabel`).
export function PageHeader({ language, title, onBack, backLabel }: { language: Language; title: string; onBack: () => void; backLabel?: string }) {
  return <header className="page-header"><button className="page-back" onClick={onBack} data-testid="back-to-conversation"><ArrowLeft size={20} />{backLabel || localized(language, "对话", "Chat", "Chat")}</button><h1>{title}</h1></header>;
}

type DrawerItem = { key: string; icon: ReactNode; label: string; badge?: number; onClick: () => void };
type DrawerData = { home: { pending: number; since: string | null } | null; spaces: SpaceSummary[]; chats: number; alerts?: number };
// What the menu shows, kept briefly so coming back to the conversation from another screen doesn't fetch it all again.
let drawerCache: { key: string; at: number; data: DrawerData } | null = null;
async function loadDrawerData(paired: boolean, userId: string, maxAge = 0): Promise<DrawerData> {
  const key = `${userId}:${paired}`;
  if (drawerCache?.key === key && Date.now() - drawerCache.at < maxAge) return drawerCache.data;
  const [home, spaces, chats] = await Promise.all([
    paired ? relationshipApi<{ home: { pending: unknown[] }; graph: { milestones: Array<{ type?: string; date?: string; archivedAt?: string | null }> } }>("/api/relationship/home").then((result) => ({ pending: result.home.pending.length, since: result.graph.milestones.find((item) => item.type === "relationship_started" && !item.archivedAt)?.date || null })).catch(() => null) : Promise.resolve(null),
    relationshipApi<{ spaces: SpaceSummary[] }>("/api/spaces").then((result) => result.spaces.filter((space) => !space.system)).catch(() => [] as SpaceSummary[]),
    listImports().then((items) => items.length).catch(() => 0),
  ]);
  // Someone newly showing warning signs puts a dot on 我的 TA 们 until the page is opened.
  const alerts = await relationshipApi<{ alerts?: number }>("/api/people").then((result) => result.alerts || 0).catch(() => 0);
  drawerCache = { key, at: Date.now(), data: { home, spaces, chats, alerts } };
  return drawerCache.data;
}
/** Left drawer: only places to look at what Ourever has done. Doing things happens in the conversation. */
function ConversationDrawer({ user, paired, language, data, onData, onPet, onClose, onOpen, onInvite, onPrivacy, onProfile, onGame, onShare, onFeedback }: { user: { id: string; name: string }; paired: boolean; language: Language; data: DrawerData; onData: (data: DrawerData) => void; onPet?: () => void; onClose: () => void; onOpen: (url: string) => void; onInvite: () => void; onPrivacy: () => void; onProfile: () => void; onGame: () => void; onShare: () => void; onFeedback: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const layer = useRef<HTMLDivElement>(null);
  useModalFocus(layer, onClose);
  // Shown at once from what was fetched with the conversation; refreshed quietly while the drawer is open.
  const { home, spaces, chats } = data;
  const start = useRef<number | null>(null);
  useEffect(() => { void loadDrawerData(paired, user.id).then(onData); }, [paired]);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [onClose]);
  const moments: DrawerItem = { key: "moments", icon: <HandHeart size={22} />, label: t("回忆", "Moments", "Momentos"), onClick: () => onOpen("/?view=moments") };
  // Agreements live at the top of Coming up (founder 11-06), so one waiting for approval shows as Coming up's badge.
  const upcoming: DrawerItem = { key: "upcoming", icon: <CalendarBlank size={22} />, label: t("即将到来", "Coming up", "Próximamente"), badge: home?.pending, onClick: () => onOpen("/?view=upcoming") };
  const fixed: DrawerItem[] = paired ? [upcoming, moments] : [
    { key: "invite", icon: <UserPlus size={22} />, label: t("邀请 TA 一起来", "Invite your partner", "Invita a tu pareja"), onClick: onInvite },
    { key: "upcoming", icon: <CalendarBlank size={22} />, label: t("即将到来", "Coming up", "Próximamente"), onClick: () => onOpen("/?view=reminders") },
  ];
  const games: DrawerItem = { key: "games", icon: <GameController size={22} />, label: t("小游戏", "Little games", "Juegos"), onClick: onGame };
  if (!paired) fixed.push(games);
  const fixedSpaces: DrawerItem[] = [
    ...(paired ? [] : [moments]),
    // Entries for features that otherwise only start by talking (founder 11-06: "我不知道怎么用，去哪里用").
    ...(paired ? [
      { key: "profile", icon: <UserCircle size={22} />, label: t("关于我们", "About us", "Sobre nosotros"), onClick: onProfile },
      games,
      { key: "ideas", icon: <Sparkle size={22} weight="fill" />, label: t("100 件小事", "100 little things", "100 cosas"), onClick: () => onOpen("/?view=moments&ideas=1") },
      ...(onPet ? [{ key: "pet", icon: <PawPrint size={22} />, label: t("小家伙", "Little one", "Pequeño"), onClick: onPet }] : []),
    ] : []),
  ];
  // 我的 TA 们 (founder 11-09): everyone they are getting to know, on a page of its own.
  const peopleRow: DrawerItem = { key: "people", icon: <UsersThree size={22} />, label: t("在了解的人", "People I'm seeing", "Las personas que conozco"), badge: data.alerts, onClick: () => onOpen("/?view=people") };
  const cycleRow: DrawerItem = { key: "cycle", icon: <Drop size={22} />, label: t("经期记录", "Period", "Periodo"), onClick: () => onOpen(`/?view=${paired ? "upcoming" : "reminders"}&focus=cycle`) };
  const layoutIcon: Record<string, ReactNode> = { checklist: <ListChecks size={22} />, timeline: <ClockCounterClockwise size={22} />, gallery: <Images size={22} />, notes: <NotePencil size={22} />, list: <ListBullets size={22} /> };
  const spaceRow = (space: SpaceSummary): DrawerItem => ({ key: `space-${space.id}`, icon: layoutIcon[space.layout] || layoutIcon.list, label: space.title, onClick: () => onOpen(`/?view=space&space=${encodeURIComponent(space.id)}`) });
  const ours = spaces.filter((space) => space.visibility === "shared").map(spaceRow);
  const mine = [...(paired ? [] : [peopleRow]), ...spaces.filter((space) => space.visibility === "private").map(spaceRow), ...(chats ? [{ key: "imports", icon: <ChatsCircle size={22} />, label: t("聊天记录", "Chat history", "Historial de chat"), onClick: () => onOpen("/?view=import") }] : []), cycleRow];
  const together = home?.since ? togetherStats(home.since, new Date().toLocaleDateString("en-CA")) : null;
  const row = (item: DrawerItem) => <button key={item.key} className="drawer-row" onClick={item.onClick} data-testid={`drawer-${item.key}`}>{item.icon}<span>{item.label}</span>{!!item.badge && <em aria-label={t(`${item.badge} 件待处理`, `${item.badge} waiting`, `${item.badge} pendientes`)}>{item.badge}</em>}</button>;
  return <div ref={layer} className="conversation-drawer-layer" data-testid="conversation-drawer" role="dialog" aria-modal="true" aria-label={t("菜单", "Menu", "Menú")}>
    <button className="conversation-drawer-scrim" tabIndex={-1} aria-label={t("关闭菜单", "Close menu", "Cerrar menú")} onClick={onClose} />
    <nav className="conversation-drawer" aria-label={t("菜单", "Menu", "Menú")} onPointerDown={(event) => { start.current = event.clientX; }} onPointerUp={(event) => { if (start.current !== null && event.clientX - start.current < -60) onClose(); start.current = null; }}>
      <header><div><strong>OUREVER</strong><span>{user.name}</span>{together && <em className="drawer-together"><Heart size={12} weight="fill" />{t(`在一起 ${together.days} 天`, `Together ${counted(together.days, "day", "days")}`, `Juntos ${counted(together.days, "día", "días")}`)}</em>}</div><button onClick={onClose} aria-label={t("关闭菜单", "Close menu", "Cerrar menú")} data-autofocus><X size={22} /></button></header>
      <div className="drawer-group">{fixed.map(row)}</div>
      <div className="drawer-group"><h2>{paired ? t("我们俩的", "Ours", "Nuestro") : t("只有我的", "Just mine", "Solo mío")}</h2>{(paired ? ours : mine).map(row)}{fixedSpaces.map(row)}</div>
      {paired && !!mine.length && <div className="drawer-group"><h2>{t("只有我的", "Just mine", "Solo mío")}</h2>{mine.map(row)}</div>}
      <footer className="drawer-group"><h2>{t("更多", "More", "Más")}</h2>{row({ key: "capabilities", icon: <Lightbulb size={22} />, label: t("Ourever 能做什么", "What Ourever can do", "Qué puede hacer Ourever"), onClick: () => onOpen("/?view=capabilities") })}{row({ key: "share", icon: <ShareNetwork size={22} />, label: t("推荐给朋友", "Recommend to friends", "Recomendar a amigos"), onClick: onShare })}{row({ key: "feedback", icon: <ChatCircleText size={22} />, label: t("反馈", "Feedback", "Comentarios"), onClick: onFeedback })}{row({ key: "settings", icon: <GearSix size={22} />, label: t("设置", "Settings", "Ajustes"), onClick: onPrivacy })}</footer>
    </nav>
  </div>;
}

/** A hand-off: tapping finishes the thing on the phone (Maps, Messages, Mail, Phone, Calendar, a website). */
function Handoff({ title, url, language, onOpen }: { title: string; url: string; language: Language; onOpen?: (url: string) => void }) {
  // A page inside Ourever opens in place rather than in a new window.
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
function Photos({ ids, language }: { ids: string[]; language: Language }) {
  return <div className={`message-photos count-${Math.min(ids.length, 3)}`}>{ids.map((id, index) => <a key={id} href={`/api/photos/${encodeURIComponent(id)}`} target="_blank" rel="noopener noreferrer"><img src={`/api/photos/${encodeURIComponent(id)}`} alt={localized(language, "聊天照片 " + (index + 1), "Conversation photo " + (index + 1), "Foto de la conversación " + (index + 1))} loading="lazy" draggable={false} /></a>)}</div>;
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
