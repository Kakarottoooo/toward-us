// Every screen's stylesheet loads up front, in the order the screens used to be imported, even though their code now loads
// on demand: the cascade stays exactly as before and a screen never appears before its styles. Keep these first.
import "./features/feedback/report-reply.css";
import "./features/privacy/ai-consent.css";
import "./demo.css";
import "./features/spaces/spaces.css";
import "./features/private-agent/private-agent.css";
import "./features/reminders/reminders.css";
import "./features/upcoming/upcoming.css";
import "./features/moments/moments.css";
import "./features/conversation/partner-invite.css";
import "./features/agreements/agreements.css";
import "./features/imports/imports.css";
import "./features/membership/membership.css";
import "./features/call/call.css";
import "./features/story/story.css";
import "./features/games/play-drawing.css";
import "./features/conversation/daily-drawing.css";
import "./features/conversation/agent-working.css";
import "./features/promises/promises.css";
import "./features/games/small-games.css";
import "./features/games/xiangqi.css";
import "./features/games/ludo.css";
import "./features/games/soup.css";
import "./features/games/games.css";
import "./features/games/play-together.css";
import "./features/games/play-distance.css";
import "./features/games/play-plans.css";
import "./features/people/people.css";
import "./features/conversation/conversation.css";
import "./features/private-agent/personal.css";
import "./features/memories/memory.css";
import "./features/games/play-week.css";
import "./features/profile/profile.css";
import "./features/character/character.css";
import "./features/membership/referrals.css";
import "./features/privacy/settings.css";
import "./features/feedback/feedback-entry.css";
import "./features/feedback/feedback.css";
import "./features/privacy/privacy.css";
import "./features/decisions/decisions.css";
import "./features/conversation/first-run.css";
import "./features/people/people-page.css";
import "./features/capabilities/capabilities.css";
import "./features/games/play-card-arrival.css";
import { AppleLogo, ArrowLeft, ArrowRight, ChatCircleText, EnvelopeSimple, Eye, EyeSlash, SpinnerGap } from "@phosphor-icons/react";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { lazyScreen, ScreenBoundary } from "./lazyScreen";
import { accountError, api, forgetInvite, hasInvite, inviteCode, inviteNetworkMessage, rememberInvite, retryLabel } from "./accountApi";
import { KeyboardInput, MobileScroll, useKeyboard } from "./mobile";
import { AiConsentScreen, LegalLinks, OfflineBanner } from "./features/privacy/AiConsent";
import { clearReferral, referralCode, referralInstallId } from "./features/membership/referrals";
import { BETA_KEY, inIosApp } from "./features/membership/platform";
import { FeedbackEntry } from "./features/feedback/FeedbackEntry";
import { feedbackView, recentFeedbackActivity } from "./features/feedback/feedbackDiagnostics";
import { providerSignInAvailable, restoreSignInNavigation, startProviderSignIn, type SignInProvider } from "./features/privacy/providerSignIn";
import { firstRunInProgress } from "./features/conversation/firstRunDraft";
import { disableNativePush, inNativeApp, listenNativeInviteLinks, listenNativePushTaps, restoreNativePush } from "./features/reminders/nativePush";
import { connectHomeWidget, disconnectHomeWidget } from "./features/widget/homeWidget";
import { closeRelationshipEvents, relationshipEvents } from "./features/relationship/events";
import { disableWebPush, registerAppWorker, restoreWebPush } from "./features/reminders/webPush";
import { apiErrorText, brandLabel, currentLanguage, inInterfaceLanguage, initialLanguage, languageTag, languages, localized, pageTitle, type Language } from "./i18n";
import "./relationship.css";
import "./controls.css";
import "./ourever-plum.css";

// Screens load on demand so opening Ourever only downloads and parses what the first screen needs. The boot sequence
// fetches the landing screen while it waits for the server and shows it in one step; the rest arrive in the background.
const DemoFlow = lazyScreen(() => import("./DemoFlow").then((module) => module.default));
const ConversationHome = lazyScreen(() => import("./features/conversation/ConversationHome").then((module) => module.ConversationHome));
const PersonalHome = lazyScreen(() => import("./features/private-agent/PersonalHome").then((module) => module.PersonalHome));
const SettingsPage = lazyScreen(() => import("./features/privacy/SettingsPage").then((module) => module.SettingsPage));
const FeedbackPage = lazyScreen(() => import("./features/feedback/FeedbackPage").then((module) => module.FeedbackPage));
const PasswordResetForm = lazyScreen(() => import("./features/privacy/PasswordReset").then((module) => module.PasswordResetForm));
const AccountRecovery = lazyScreen(() => import("./features/privacy/AccountRecovery").then((module) => module.AccountRecovery));
const RelationshipHome = lazyScreen(() => import("./features/relationship-home/RelationshipHome").then((module) => module.RelationshipHome));
const SpacePage = lazyScreen(() => import("./features/spaces/SpacePage").then((module) => module.SpacePage));
const PeoplePage = lazyScreen(() => import("./features/people/PeoplePage").then((module) => module.PeoplePage));
const ImportsPage = lazyScreen(() => import("./features/imports/ImportsPage").then((module) => module.ImportsPage));
const CapabilitiesPage = lazyScreen(() => import("./features/capabilities/CapabilitiesPage").then((module) => module.CapabilitiesPage));
const FirstRun = lazyScreen(() => import("./features/conversation/FirstRun").then((module) => module.FirstRun));
const ReferralNotices = lazyScreen(() => import("./features/membership/ReferralPage").then((module) => module.ReferralNotices));
const SignupReferral = lazyScreen(() => import("./features/membership/ReferralPage").then((module) => module.SignupReferral));
// Not needed to draw the first screen: the install hint appears 1.5s after the conversation settles, if ever.
const InstallHint = lazyScreen(() => import("./features/reminders/InstallHint").then((module) => module.InstallHint));
// Only invitation links open it, so its code is fetched on demand (opening-JS budget, QA round 7).
const PartnerJoin = lazyScreen(() => import("./features/conversation/PartnerJoin").then((module) => module.PartnerJoin));
const PlayCardArrival = lazyScreen(() => import("./features/games/PlayCardArrival").then((module) => module.PlayCardArrival));
const screenCode: Partial<Record<Screen, { preload: () => Promise<void> }>> = {
  "invite-first": FirstRun, conversation: ConversationHome, personal: PersonalHome, privacy: SettingsPage, feedback: FeedbackPage, recovery: AccountRecovery,
  invite: PartnerJoin, pairing: PartnerJoin, dashboard: RelationshipHome, space: SpacePage, people: PeoplePage, import: ImportsPage, capabilities: CapabilitiesPage,
};
/** Fetches the code a screen needs, so it can be shown without a loading step. */
const preloadScreen = (screen: Screen) => screenCode[screen]?.preload() ?? Promise.resolve();

// The plum welcome and sign-in design applies on phones and everywhere inside the native app, including a full-screen iPad.
const narrowScreen = window.matchMedia("(max-width: 899px)");
const syncEntryDesign = () => document.documentElement.classList.toggle("plum-entry", inNativeApp() || narrowScreen.matches);
syncEntryDesign();
narrowScreen.addEventListener("change", syncEntryDesign);

type Screen = "booting" | "identity-error" | "invite-first" | "home" | "invite" | "conversation" | "space" | "import" | "people" | "capabilities" | "personal" | "privacy" | "feedback" | "recovery" | "auth" | "pairing" | "dashboard";
export type AuthMode = "login" | "register";
type User = { id: string; email: string; name: string; nameSet?: boolean; createdAt: string; aiConsentAt?: string | null; passwordless?: boolean };
type PairMember = { id: string; name: string; role: "A" | "B"; joinedAt: string };
export type Pairing = { id: string; status: "pending" | "active"; role: "A" | "B"; members: PairMember[]; invitation: { code: string; createdAt: string; expiresAt: string; openedAt: string | null; prepared?: boolean; sentAt?: string | null; cancelledAt?: string | null; declinedAt?: string | null } | null };
export type InvitePreview = { inviterName: string; status: "open" | "expired" | "used" | "cancelled" | "declined" };

export const copy = {
  zh: {
    homeLine: "不知道怎么回 TA，先问问 Ourever。", start: "开始", homeFooter: "看懂 · 回应 · 靠近", back: "返回",
    welcome: "欢迎回来", registerHint: "你可以先和 Ourever 私聊，想一起使用时再邀请伴侣。", email: "邮箱", password: "密码",
    displayName: "你的称呼", login: "登录", register: "创建账号", switchRegister: "还没有账号？创建一个",
    switchLogin: "已有账号？登录", passwordHint: "至少 10 个字符", invitePartner: "邀请伴侣", inviteHint: "一起建立你们的共同空间。",
    createInvite: "生成伴侣邀请", copyInvite: "复制邀请链接", copied: "已复制", waitingPartner: "等待对方加入",
    waitingHint: "对方用自己的账号接受后，共同空间才会打开。", acceptInvite: "接受邀请",
    inviteCode: "八位邀请码", logout: "退出登录",
    joinPartner: "加入伴侣", joinHint: "TA 邀请你一起用 Ourever。接受后，你们俩共同的对话“我们俩”就会打开。",
  },
  en: {
    homeLine: "Not sure how to reply to them? Ask Ourever first.", start: "Begin", homeFooter: "Understand · Reply · Get closer", back: "Back",
    welcome: "Welcome back", registerHint: "Start with a private chat. You can invite your partner whenever you’re ready.", email: "Email", password: "Password",
    displayName: "Your name", login: "Sign in", register: "Create account", switchRegister: "New here? Create an account",
    switchLogin: "Already have an account? Sign in", passwordHint: "At least 10 characters", invitePartner: "Invite your partner", inviteHint: "Build your shared space together.",
    createInvite: "Create partner invite", copyInvite: "Copy invite link", copied: "Copied", waitingPartner: "Waiting for your partner",
    waitingHint: "They must accept with their own account before mediation and reviews are shared.", acceptInvite: "Accept invite",
    inviteCode: "Eight-character code", logout: "Sign out",
    joinPartner: "Join your partner", joinHint: "Your partner invited you to Ourever. Accept to open Us, the conversation the two of you share.",
  },
  es: {
    homeLine: "¿No sabes qué responderle? Pregúntale a Ourever.", start: "Comenzar", homeFooter: "Entender · Responder · Acercarse", back: "Volver",
    welcome: "Bienvenido de nuevo", registerHint: "Empieza con un chat privado. Puedes invitar a tu pareja cuando quieras.", email: "Correo electrónico", password: "Contraseña",
    displayName: "Tu nombre", login: "Iniciar sesión", register: "Crear cuenta", switchRegister: "¿Eres nuevo? Crea una cuenta",
    switchLogin: "¿Ya tienes una cuenta? Inicia sesión", passwordHint: "Al menos 10 caracteres", invitePartner: "Invita a tu pareja", inviteHint: "Construyan juntos su espacio compartido.",
    createInvite: "Crear invitación", copyInvite: "Copiar enlace", copied: "Copiado", waitingPartner: "Esperando a tu pareja",
    waitingHint: "Debe aceptar con su propia cuenta antes de compartir mediaciones y revisiones.", acceptInvite: "Aceptar invitación",
    inviteCode: "Código de ocho caracteres", logout: "Cerrar sesión",
    joinPartner: "Únete a tu pareja", joinHint: "Tu pareja te invitó a Ourever. Acepta para abrir Nosotros, la conversación que comparten.",
  },
};

export default function Prototype() {
  return <><OfflineBanner />{location.pathname.startsWith("/demo") || location.pathname.startsWith("/j/") ? <><Suspense fallback={<BootSplash />}><DemoFlow /></Suspense><FeedbackLink language={initialLanguage()} /></> : <AccountPrototype />}</>;
}

// Asked once, while the app is still opening, so the welcome screen appears with its final buttons instead of
// growing Apple and Google a moment later (founder 11-21: opening Ourever "moved").
let welcomeProviders: Promise<boolean> | null = null;
// The squirrel is fetched and decoded while the app opens too; until it arrives its box keeps its square size, so
// nothing below it moves (founder 11-21: the welcome screen still "jumped" when the picture landed and pushed it down).
let welcomeArt: Promise<void> | null = null;
function welcomeArtReady() {
  if (!welcomeArt) { const art = new Image(); art.src = "/assets/brand/ourever-mascot.webp"; welcomeArt = art.decode().catch(() => {}); }
  return welcomeArt;
}
let welcomeProvidersKnown = false;
function welcomeProvidersReady() {
  if (!welcomeProviders) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    welcomeProviders = providerSignInAvailable(controller.signal).catch(() => false).then((ready) => {
      welcomeProvidersKnown = ready;
      if (!ready) welcomeProviders = null;
      return ready;
    }).finally(() => clearTimeout(timeout));
  }
  return welcomeProviders;
}

function FeedbackLink({ language }: { language: Language }) {
  return <a className="feedback-launch" href="/?view=feedback" aria-label={localized(language, "反馈", "Feedback", "Comentarios")}><ChatCircleText size={19} /></a>;
}

function AccountPrototype() {
  // A partner opening an invite link on a new device sees it in their phone's language, not the default Chinese.
  const [language, setLanguage] = useState<Language>(initialLanguage);
  // Until the server says who this is, show only the plain paper background (founder 11-08: opening Ourever flashed the
  // signed-out landing page, then an empty chat, before the real conversation).
  const [screen, setScreen] = useState<Screen>("booting");
  // A password-reset link opens straight into the reset form; the token leaves the address bar at once.
  const [feedbackFrom, setFeedbackFrom] = useState("conversation");
  const [feedbackFile, setFeedbackFile] = useState<File>();
  const [feedbackReturn, setFeedbackReturn] = useState<Screen>("conversation");
  // Settings can open straight on one page, such as the couple's character from the welcome tour.
  const [settingsPage, setSettingsPage] = useState<"character" | "profile" | "membership" | "referrals" | "processors" | undefined>(() => { const params = new URLSearchParams(location.search); const beta = params.get("beta"); if (beta && !inIosApp()) { try { localStorage.setItem(BETA_KEY, beta.trim().toUpperCase().slice(0, 20)); } catch { /* private mode */ } } return params.get("view") === "referrals" ? "referrals" : params.get("view") === "membership" ? "membership" : undefined; });
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(location.hash.slice(1)).get("reset") || new URLSearchParams(location.search).get("reset") || "");
  const [signInReturn, setSignInReturn] = useState(() => new URLSearchParams(location.search).get("signin") || "");
  const [user, setUser] = useState<User | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [joinedElsewhere, setJoinedElsewhere] = useState(false);
  const [refNotice, setRefNotice] = useState(false);
  useEffect(() => { if (!refNotice) return; const timer = window.setTimeout(() => setRefNotice(false), 8000); return () => clearTimeout(timer); }, [refNotice]);
  const [authMode, setAuthMode] = useState<AuthMode>(() => referralCode() ? "register" : "login");
  const [autoProvider, setAutoProvider] = useState<SignInProvider | null>(null);
  // Bumped when Back or Forward moves through history, so pages keyed by the address show the one it now names.
  const [, setVisit] = useState(0);
  const keyboard = useKeyboard();
  const t = copy[language];

  // The device chrome (src/mobile, protected) names itself in English; give its two labels the interface language from here
  // (QA round 4).
  useEffect(() => {
    const picker = document.querySelector<HTMLElement>("[data-testid=device-picker]");
    if (picker) picker.setAttribute("aria-label", localized(language, `预览设备：${picker.innerText.trim()}`, `Preview device: ${picker.innerText.trim()}`, `Dispositivo de vista previa: ${picker.innerText.trim()}`));
    document.querySelector(".status-bar")?.setAttribute("aria-label", localized(language, "设备状态栏", "Device status bar", "Barra de estado del dispositivo"));
  }, [language, screen]);
  useEffect(() => { try { localStorage.setItem("toward-us.language", language); } catch { /* keep the selection for this visit */ } document.documentElement.lang = languageTag(language); document.title = pageTitle(language); }, [language]);
  useEffect(() => {
    const returning = restoreSignInNavigation();
    if (returning) {
      const view = new URLSearchParams(location.search).get("view");
      if (view === "membership" || view === "referrals") setSettingsPage(view);
    }
    if (resetToken || signInReturn) {
      const url = new URL(location.href);
      url.searchParams.delete("reset");
      url.searchParams.delete("signin");
      if (new URLSearchParams(url.hash.slice(1)).has("reset")) url.hash = "";
      history.replaceState(history.state, "", url);
    }
    const providersAsked = welcomeProvidersReady();
    api<{ user: User | null; pairing: Pairing | null }>("/api/auth/me", { signal: AbortSignal.timeout(12000) }).then(async (state) => {
      setUser(state.user); setPairing(state.pairing);
      // Signed in here last time and nobody signed out here: the session was ended elsewhere (QA round 7).
      const revoked = !state.user && signedInHere();
      signedInHere(!!state.user);
      if (revoked) setNotice(localized(language, "你已退出登录，请重新登录。", "You were signed out. Sign in again to continue.", "Se cerró tu sesión. Vuelve a iniciar sesión para continuar."));
      // Signed in already: an invitation code is for new sign-ups. Say so once and drop it from the address (QA round 3).
      if (state.user && !returning && referralCode()) { clearReferral(); setRefNotice(true); }
      if (returning && state.user && !resetToken) {
        if (referralCode()) clearReferral();
        const next = new URLSearchParams(location.search).get("next");
        if (next && /^\/m\/[a-z0-9]{12}$/.test(next)) { location.assign(next); return; }
      }
      // Signed out with a partner's invite link: the page that says who invited them comes first, not the generic home.
      if (!state.user && (signInReturn === "adult_required" || signInReturn === "referral_ineligible")) setAuthMode("register");
      // A reload keeps the page its history entry names (a page opened from the app has its own entry), not the chat.
      const kept = (history.state as { ourever?: Screen } | null)?.ourever;
      const first: Screen = state.user ? kept && ["privacy", "feedback", "people", "space", "import", "capabilities", "personal"].includes(kept) && (state.user.aiConsentAt || kept === "privacy") ? kept : accountLanding(state.user, state.pairing) : signInReturn || revoked ? "auth" : hasInvite() ? "invite" : referralCode() || ["referrals", "feedback"].includes(new URLSearchParams(location.search).get("view") || "") ? "auth" : "home";
      if (first === "home") await Promise.race([Promise.all([providersAsked, welcomeArtReady()]), new Promise((done) => setTimeout(done, 3000))]);
      else await Promise.all([preloadScreen(first), resetToken ? PasswordResetForm.preload() : null]);
      // An invitation-code sign-up shows its referral card on the sign-in screen from the first frame.
      if (referralCode()) await SignupReferral.preload();
      setScreen(first);
      if (state.user) { void restoreNativePush(); void restoreWebPush(); void connectHomeWidget(); if (state.pairing?.status === "active" && state.user.aiConsentAt) void import("./features/moments/photoAlbum").then((album) => album.autoSyncAlbum(language)).catch(() => {}); }
    }).catch(() => setScreen(signInReturn ? "auth" : "identity-error"));
    listenNativePushTaps();
    listenNativeInviteLinks();
    registerAppWorker();
  }, []);
  useEffect(() => {
    const openReset = () => {
      const url = new URL(location.href);
      const token = new URLSearchParams(url.hash.slice(1)).get("reset");
      if (!token) return;
      setResetToken(token); url.hash = "";
      history.replaceState(history.state, "", url);
    };
    window.addEventListener("hashchange", openReset);
    return () => window.removeEventListener("hashchange", openReset);
  }, []);
  // The server keeps the signed-in member's interface language for copy the Agent posts on their behalf.
  // The installed web app stays open for days: when it comes back to the front and the server runs a newer build,
  // reload so fixes show up, unless something is being typed.
  useEffect(() => {
    let loaded = "";
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const { commit } = await fetch("/api/health", { cache: "no-store" }).then((response) => response.json());
        if (!commit) return;
        if (!loaded) { loaded = commit; return; }
        const typing = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input:not([type=hidden]):not([type=file])")].some((field) => field.value.trim());
        if (commit !== loaded && !typing) location.reload();
      } catch { /* offline: try again next time */ }
    };
    void check();
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);
  // Once the first screen is up, fetch the other screens' code in the background so moving between them stays instant.
  // On the sign-in screen only the conversation, which comes next.
  const booted = screen !== "booting";
  useEffect(() => {
    if (!booted || (!user && screen !== "auth")) return;
    const preloadAll = () => {
      if (!user) { void ConversationHome.preload(); return; }
      void Object.values(screenCode).reduce<Promise<void>>((previous, code) => previous.then(() => code.preload()), Promise.resolve());
      void PlayCardArrival.preload();
    };
    const timer = window.setTimeout(preloadAll, 2500);
    // Screens that failed to arrive while offline are fetched again once the connection is back.
    window.addEventListener("online", preloadAll);
    return () => { clearTimeout(timer); window.removeEventListener("online", preloadAll); };
  }, [booted, user?.id, screen === "auth"]);
  useEffect(() => { if (user) api("/api/me/language", { method: "POST", body: JSON.stringify({ language }) }).catch(() => {}); }, [language, user?.id]);
  // Opened from a push (its link carries from=push): count the open, content-free, then drop the marker from the address.
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(location.search);
    if (params.get("from") !== "push") return;
    params.delete("from");
    history.replaceState(history.state, "", `${location.pathname}${params.toString() ? `?${params}` : ""}${location.hash}`);
    void api("/api/usage/push-opened", { method: "POST" }).catch(() => {});
  }, [user?.id]);

  const openAuth = (mode: AuthMode, provider: SignInProvider | null = null) => {
    keyboard.hide();
    setAutoProvider(provider);
    setNotice("");
    setSignInReturn("");
    setAuthMode(mode);
    setScreen("auth");
  };
  const selectLanguage = (value: Language) => setLanguage(value);
  const acceptAuth = async (state: { user: User; pairing: Pairing | null }) => {
    if (referralCode()) clearReferral();
    const next = new URLSearchParams(location.search).get("next");
    if (next && /^\/m\/[a-z0-9]{12}$/.test(next)) { location.assign(next); return; }
    const landingScreen = accountLanding(state.user, state.pairing);
    await preloadScreen(landingScreen);
    setUser(state.user); setPairing(state.pairing); setNotice(""); signedInHere(true);
    setScreen(landingScreen);
    // A signed-in phone with existing permission can reconnect without a system prompt.
    void restoreNativePush();
    // Inside the iPhone App, the home-screen widget gets its own read-only token (a no-op in a browser).
    void connectHomeWidget();
  };
  const refreshPairing = async () => {
    const state = await api<{ user: User; pairing: Pairing | null }>("/api/auth/me", { signal: AbortSignal.timeout(12000) });
    // A poll started before a newer share/cancel response or sign-out must not replace it.
    setPairing(current => current === pairing && state.user?.id === user?.id ? state.pairing : current);
  };
  // The share sheet or Settings may still be open when the other person joins.
  useEffect(() => {
    if (!user || pairing?.status !== "pending" || screen === "invite-first" || (screen === "conversation" && user.aiConsentAt)) return;
    let active = true;
    let reading = false;
    const refresh = async () => {
      if (reading || document.hidden || !navigator.onLine) return;
      reading = true;
      try {
        const state = await api<{ user: User | null; pairing: Pairing | null }>("/api/auth/me");
        if (active && state.user?.id === user.id && state.pairing?.status === "active") {
          setPairing(state.pairing); setJoinedElsewhere(true);
        }
      } catch { /* The next foreground poll retries. */ }
      finally { reading = false; }
    };
    const interval = window.setInterval(refresh, 4000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    // The server says the moment the partner joins or declines, so the invite screen changes at once rather than at the next poll.
    const events = relationshipEvents();
    events.addEventListener("relationship", (event) => {
      try {
        const { eventType, status } = JSON.parse((event as MessageEvent).data);
        if (eventType !== "pairing.updated") return;
        // The open stream belongs to the space this account had before; a new one opens for the shared space.
        if (status === "active") { closeRelationshipEvents(); void refresh(); } else void refreshPairing().catch(() => {});
      } catch { /* the poll still catches it */ }
    });
    return () => { active = false; clearInterval(interval); events.close(); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("online", refresh); };
  }, [user?.id, user?.aiConsentAt, pairing?.status, screen]);
  useEffect(() => {
    if (!joinedElsewhere) return;
    const timer = window.setTimeout(() => setJoinedElsewhere(false), 7000);
    return () => clearTimeout(timer);
  }, [joinedElsewhere]);
  const logout = async () => { keyboard.hide(); signedInHere(false); await disableNativePush(); await disableWebPush(); await disconnectHomeWidget(); await api("/api/auth/logout", { method: "POST" }); closeRelationshipEvents(); forgetInvite(); setUser(null); setPairing(null); setScreen("home"); };

  const reloadIdentity = async () => { const state = await api<{ user: User | null; pairing: Pairing | null }>("/api/auth/me"); setUser(state.user); setPairing(state.pairing); setScreen(state.user ? landing(state.pairing) : "home"); };
  const fullScreen: Screen = pairing?.status === "active" ? "dashboard" : "personal";
  // The screen a page link opens on.
  const screenFor = (url: string): Screen => url.includes("game=") || url.startsWith("/?channel=") ? "conversation" : url.includes("view=space") ? spaceOrList(new URLSearchParams(url.slice(url.indexOf("?")))) : url.includes("view=import") ? "import" : url.includes("view=people") ? "people" : url.includes("view=capabilities") ? "capabilities" : fullScreen;
  // Pages with a Back get their own history entry, so the phone's or browser's Back returns inside Ourever (popstate below)
  // instead of leaving it. The address a page set for itself stays; the page it came from keeps its own entry beneath.
  const fromHistory = useRef(false);
  const returnTo = useRef("");
  const shownScreen = useRef(screen);
  // The address before this step's setUrl calls: the page being left keeps it in its own entry.
  const urlBefore = useRef<string | null>(null);
  const setUrl = (url: string) => { urlBefore.current ??= location.href; history.replaceState(history.state, "", url); };
  useEffect(() => {
    const previous = shownScreen.current;
    const before = urlBefore.current ?? location.href;
    shownScreen.current = screen; urlBefore.current = null;
    if (fromHistory.current) { fromHistory.current = false; return; }
    if (previous === screen) return;
    // A link opened in a fresh tab straight onto a page (/?view=moments, a notification): put the conversation under it, so
    // Back stays in Ourever as it does after ?game=hall (QA round 4). A reload keeps its entries as they are.
    if (previous === "booting" && user && screen !== "pairing" && signedInScreens.includes(screen) && !historyDepth(history.state) && location.search) {
      const url = location.href;
      history.replaceState(null, "", location.pathname);
      history.pushState({ ourever: screen, depth: 1 }, "", url);
      return;
    }
    if (stackedScreens.includes(screen) && !["booting", "identity-error"].includes(previous)) {
      const url = location.href;
      history.replaceState(history.state, "", before);
      history.pushState({ ourever: screen, depth: historyDepth(history.state) + 1 }, "", url);
    } else if (!stackedScreens.includes(screen) && historyDepth(history.state)) history.replaceState(null, "", location.href);
  });
  // A new screen (QA round 5): unless a field already took focus, its page heading does, so a keyboard or screen-reader
  // user starts at the top of what just opened instead of on the body. Lazy screens get a moment to arrive.
  // The page is plum until the app first draws (index.html #boot-plum); after that the screens paint their own background.
  useEffect(() => { document.getElementById("boot-plum")?.remove(); }, []);
  const screenShown = useRef(false);
  useEffect(() => {
    if (screen === "booting") return;
    const first = !screenShown.current; screenShown.current = true;
    if (first || screen === "conversation") return;
    let tries = 0, timer = 0;
    const look = () => {
      const at = document.activeElement;
      if (at && at !== document.body && at.isConnected) return;
      const heading = document.querySelector<HTMLElement>(".device-screen h1");
      if (!heading) { if (++tries < 15) timer = window.setTimeout(look, 100); return; }
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    };
    timer = window.setTimeout(look, 0);
    return () => window.clearTimeout(timer);
  }, [screen]);
  useEffect(() => {
    const pop = (event: PopStateEvent) => {
      keyboard.hide();
      fromHistory.current = true;
      const stacked = (event.state as { ourever?: Screen } | null)?.ourever;
      // Back from Settings after AI was turned on there: the sentence the member had tapped waits in the conversation.
      if (returnTo.current) { history.replaceState(history.state, "", returnTo.current); returnTo.current = ""; }
      setScreen(stacked && stackedScreens.includes(stacked) && (user || !signedInScreens.includes(stacked)) ? stacked : user ? accountLanding(user, pairing) : hasInvite() ? "invite" : "home");
      setVisit((value) => value + 1);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [user, pairing]);
  /** Back from a page: step back through history when the page below is ours, otherwise go where the page's Back leads. */
  const goBack = (fallback: () => void) => { keyboard.hide(); if (historyDepth(history.state)) history.back(); else fallback(); };
  const backToConversation = () => goBack(() => { setUrl(location.pathname); setScreen("conversation"); });
  // Pages hand a starting sentence back to the conversation, in the channel the page belongs to.
  const askPinky = (text: string, channel: "me" | "us") => {
    keyboard.hide();
    // AI off (QA round 4): whatever needed Ourever lands on Just me's "Turn on AI" card with the reason, not on a composer
    // that sends nowhere. The sentence is kept for when AI is turned on there.
    if (aiOff) { aiAsk.current = `/?channel=${channel}${channel === "us" ? "&recipient=assistant" : ""}&say=${encodeURIComponent(text)}`; setAiOffReason(localized(language, "这件事要用到 Ourever 的 AI。", "This needs Ourever's AI.", "Esto necesita la IA de Ourever.")); setUrl("/?channel=me"); setScreen("conversation"); return; }
    setUrl(`/?channel=${channel}${channel === "us" ? "&recipient=assistant" : ""}&say=${encodeURIComponent(text)}`); setScreen("conversation"); };
  // No AI work for anyone who hasn't agreed to third-party AI yet: they see the consent screen first (accounts made before
  // sign-up asked for it). Declining signs them out; Settings can withdraw it later, which brings this screen back.
  const openFeedback = (from: string, image?: File) => {
    keyboard.hide(); setFeedbackFrom(feedbackView(from)); setFeedbackFile(image); setFeedbackReturn(screen);
    setScreen("feedback");
  };
  const closeFeedback = () => {
    setFeedbackFile(undefined);
    goBack(() => {
      if (new URLSearchParams(location.search).get("view") === "feedback") setUrl(location.pathname);
      setScreen(feedbackReturn);
    });
  };
  // Declining third-party AI opens the app with AI off (Just me explains it; Us works); Settings can turn it on later.
  const [, setAiChoice] = useState(0);
  const aiOff = !!user && !user.aiConsentAt && aiDeclined(user.id);
  // What a tap that needed AI wanted to say, and where to go back to once AI is turned on from the AI-off card (QA round 4).
  const [aiOffReason, setAiOffReason] = useState("");
  const aiAsk = useRef("");
  const aiReturn = useRef<string | null>(null);
  const declineAi = () => { if (!user) return; keyboard.hide(); rememberAiDeclined(user.id, true); setAiChoice((value) => value + 1); setScreen("conversation"); };
  const feedbackEntry = user && <FeedbackEntry key={user.id} userId={user.id} language={language} hidden={screen === "feedback" || !!resetToken} open={image => openFeedback(screen, image)} />;
  const renderScreen = () => {
    if (resetToken) return <MobileScroll className="paper-screen recovery-screen"><main className="recovery-content"><PasswordResetForm language={language} token={resetToken} onRequestLink={() => { setResetToken(""); setScreen("recovery"); }} onDone={() => { setUser(null); setPairing(null); setResetToken(""); setSignInReturn(""); setNotice(localized(language, "密码已更新，请用新密码登录。", "Password updated. Sign in with your new password.", "Contraseña actualizada. Inicia sesión con la nueva.")); setScreen("auth"); }} /></main></MobileScroll>;
    if (screen === "feedback" && user) return <FeedbackPage key={user.id} userId={user.id} language={language} from={feedbackFrom}
      activity={recentFeedbackActivity(language) || localized(language, `正在使用的页面 · ${feedbackFrom}`, `Using screen · ${feedbackFrom}`, `Pantalla en uso · ${feedbackFrom}`)} initialFile={feedbackFile} onBack={closeFeedback} backLabel={feedbackReturn === "privacy" ? settingsLabel(language) : ["conversation", "invite-first"].includes(feedbackReturn) ? undefined : t.back} />;
    if (screen === "identity-error") return <InviteFrame language={language} onLanguage={selectLanguage} title={hasInvite() ? localized(language, "暂时无法打开邀请", "Your invitation couldn’t load", "No se pudo cargar tu invitación") : localized(language, "暂时连不上 Ourever", "Ourever couldn’t connect", "No se pudo conectar con Ourever")}>
      <p className="pairing-lead" role="alert">{inviteNetworkMessage(language)}</p>
      <button className="primary-action" onClick={() => { if (navigator.onLine !== false) location.reload(); }}>{retryLabel(language)}</button>
    </InviteFrame>;
    if (screen === "invite-first" && user) return <FirstRun key={user.id} feedback={feedbackEntry} user={user} language={language} pairing={pairing}
      onPairingChange={setPairing} onRefreshPairing={refreshPairing}
      onAgreed={at => { setUser({ ...user, aiConsentAt: at }); setScreen("conversation"); }}
      onDecline={() => { setSettingsPage(undefined); setScreen("privacy"); }} onDeclineAi={declineAi} />;
    if (user && !user.aiConsentAt && !aiOff && !["booting", "home", "auth", "recovery", "privacy", "pairing"].includes(screen)) return <AiConsentScreen language={language} onAgreed={(at) => setUser({ ...user, aiConsentAt: at })} onDecline={declineAi} />;
    if (screen === "conversation" && user) return <><ScreenBoundary fallback={null}><Suspense fallback={null}><InstallHint language={language} userId={user.id} /></Suspense></ScreenBoundary><ConversationHome user={user} pairing={pairing} language={language} aiOff={aiOff} aiOffReason={aiOffReason} onPrivacy={(page) => { aiReturn.current = page === "processors" && aiOff ? aiAsk.current : null; setSettingsPage(page); setScreen("privacy"); }} onFeedback={openFeedback} onLogout={logout} onOpen={(url) => { setUrl(url); setScreen(screenFor(url)); }} onPair={() => setScreen("pairing")} onRefreshPairing={refreshPairing} onPairingChange={setPairing} onAccessChanged={reloadIdentity} /></>;
    if (screen === "import" && user) return <ImportsPage key={location.search} id={new URLSearchParams(location.search).get("import") || ""} user={{ id: user.id, name: user.name }} paired={pairing?.status === "active"} language={language} onBack={backToConversation} onOpen={(url) => { setUrl(url); setScreen("import"); }} onAsk={askPinky} />;
    if (screen === "people" && user) return <PeoplePage key={location.search} language={language} initialPerson={new URLSearchParams(location.search).get("person") || ""} archived={new URLSearchParams(location.search).get("archived") === "1"} backLabel={new URLSearchParams(location.search).get("archived") === "1" ? settingsLabel(language) : undefined} onBack={new URLSearchParams(location.search).get("archived") === "1" ? () => goBack(() => { setUrl(location.pathname); setScreen("privacy"); }) : backToConversation} onAsk={askPinky} onChat={(personId) => { keyboard.hide(); setUrl(`/?channel=me&person=${encodeURIComponent(personId)}`); setScreen("conversation"); }} onInvite={() => { if (pairing?.status === "active") { setUrl("/?channel=us"); setScreen("conversation"); } else setScreen("pairing"); }} />;
    if (screen === "space" && user) return <SpacePage key={location.search} id={new URLSearchParams(location.search).get("space") || ""} language={language} onBack={backToConversation} onAsk={askPinky} />;
    if (screen === "booting") return <BootSplash language={language} testId="booting" />;
    if (screen === "recovery") return <MobileScroll className="paper-screen recovery-screen plum-auth"><header className="editorial-top"><button onClick={() => goBack(() => setScreen("auth"))} aria-label={t.back}><ArrowLeft size={22} /></button><LanguageSwitch language={language} onLanguage={selectLanguage} compact /></header><main className="recovery-content"><AccountRecovery language={language} onBack={() => goBack(() => setScreen("auth"))} onRecovered={() => { setNotice(localized(language, "密码已更新，请重新登录并生成新的恢复码。", "Password updated. Sign in and generate a new recovery code.", "Contraseña actualizada. Inicia sesión y genera un nuevo código de recuperación.")); setScreen("auth"); }} /></main></MobileScroll>;
    if (screen === "personal" && user) return <PersonalHome user={user} relationshipId={pairing?.status === "active" ? pairing.id : null} language={language} aiOff={aiOff} onShared={() => setScreen("dashboard")} onBack={backToConversation} onAsk={askPinky} />;
    if (screen === "capabilities" && user) return <CapabilitiesPage language={language} paired={pairing?.status === "active"} onBack={backToConversation} onAsk={askPinky} onOpen={(url) => { setUrl(url); setScreen(screenFor(url)); }} onProfile={() => { setSettingsPage("profile"); setScreen("privacy"); }} />;
    if (screen === "privacy" && user) return <SettingsPage onName={(name, addedPassword) => setUser({ ...user, name, passwordless: addedPassword ? false : user.passwordless })} key={settingsPage || "main"} onFeedback={() => openFeedback("settings")} initialPage={settingsPage} onAsk={(text) => askPinky(text, "me")} onEarlierPeople={() => { setUrl("/?view=people&archived=1"); setScreen("people"); }} user={user}relationshipId={pairing?.status === "active" ? pairing.id : null} partnerName={pairing?.status === "active" ? pairing.members.find((member) => member.id !== user.id)?.name || null : null} language={language} onLanguage={selectLanguage} onBack={backToConversation} onLogout={logout} onLeft={reloadIdentity} onDeleted={async () => { try { await (await import("./features/feedback/feedbackQueue")).clearFeedbackForDeletedAccount(user.id); } finally { signedInHere(false); await reloadIdentity(); setNotice(localized(language, "你的账号已删除。", "Your account was deleted.", "Tu cuenta se eliminó.")); setScreen("auth"); } }} onAiConsent={(at) => { rememberAiDeclined(user.id, !at); setUser({ ...user, aiConsentAt: at }); if (at && aiReturn.current !== null) { const say = aiReturn.current; aiReturn.current = null; aiAsk.current = ""; setAiOffReason(""); returnTo.current = say; goBack(() => { returnTo.current = ""; setUrl(say || location.pathname); setScreen("conversation"); }); } }} />;
    if (screen === "invite") return <PartnerJoin Frame={InviteFrame} labels={t} language={language} onLanguage={selectLanguage} onAuth={(mode) => { rememberInvite(); openAuth(mode); }} />;
    if (screen === "home") return <HomeScreen language={language} onLanguage={selectLanguage} onProvider={(provider) => user ? setScreen(landing(pairing)) : openAuth("register", provider)} onEmail={() => user ? setScreen(landing(pairing)) : openAuth("register")} onSignIn={() => user ? setScreen(landing(pairing)) : openAuth("login")} t={t} />;
    if (screen === "auth") return <AuthScreen key={autoProvider || "form"} autoProvider={autoProvider} onAutoCancel={() => { setAutoProvider(null); setScreen(hasInvite() ? "invite" : "home"); }} initialError={signInReturn} mode={authMode} onModeChange={setAuthMode} language={language} onLanguage={selectLanguage} onBack={() => goBack(() => setScreen(hasInvite() ? "invite" : "home"))} onAuth={acceptAuth} onRecover={() => setScreen("recovery")} notice={notice} setNotice={setNotice} busy={busy} setBusy={setBusy} t={t} />;
    if (screen === "pairing" && user) return <PartnerJoin Frame={InviteFrame} labels={t} language={language} onLanguage={selectLanguage} account={{ pairing, onJoined: (next) => {
      forgetInvite(); setUrl("/?channel=us"); setPairing(next); setScreen("conversation");
    }, onBack: () => { forgetInvite(); backToConversation(); } }} />;
    if (screen === "dashboard" && user && pairing) return <RelationshipHome user={{ id: user.id, name: user.name }} language={language} aiOff={aiOff} onNotice={setNotice} onAccessChanged={reloadIdentity} onBack={backToConversation} onAsk={askPinky} />;
    return <div className="loading-screen"><Wordmark language={language} /><p>{localized(language, "正在进入共同空间…", "Opening your shared space…", "Abriendo su espacio compartido…")}</p></div>;
  };
  const showArrivals = user?.aiConsentAt && pairing?.status === "active" && !resetToken &&
    !["booting", "home", "auth", "recovery", "invite", "pairing"].includes(screen);
  // A screen whose code hasn't arrived yet: try loading it again in place, never by reloading the page (offline, that shows
  // the browser's error page). Coming back online retries by itself.
  const unavailable = (retry: () => void) => <InviteFrame language={language} onLanguage={selectLanguage} title={localized(language, "暂时连不上 Ourever", "Ourever couldn’t connect", "No se pudo conectar con Ourever")}>
    <p className="pairing-lead" role="alert">{inviteNetworkMessage(language)}</p>
    <button className="primary-action" onClick={retry}>{retryLabel(language)}</button>
  </InviteFrame>;
  return <><ScreenBoundary fallback={unavailable} resetKey={screen}><Suspense fallback={<BootSplash language={language} />}>{renderScreen()}</Suspense></ScreenBoundary>{refNotice && user && <div className="partner-arrival-notice" role="status" data-testid="ref-signed-in">{localized(language, "你已经有账号了。邀请码只用于新用户注册。", "You already have an account. Invitation codes are for new sign-ups.", "Ya tienes una cuenta. Los códigos de invitación son para registros nuevos.")}</div>}{joinedElsewhere && user && <div className="partner-arrival-notice" role="status">{localized(language, "你的伴侣已加入，打开“我们俩”即可聊天。", "Your partner joined. Open Us to chat together.", "Tu pareja se ha unido. Abre Nosotros para conversar.")}</div>}{!user && screen === "home" && !resetToken && <FeedbackLink language={language} />}{user && !resetToken && <ScreenBoundary fallback={null}><Suspense fallback={null}><ReferralNotices key={user.id} userId={user.id} language={language} openPage={page => { keyboard.hide(); setSettingsPage(page); setUrl("/?view=" + page); setScreen("privacy"); }} openFeedback={() => openFeedback("settings")} /></Suspense></ScreenBoundary>}{screen !== "invite-first" && feedbackEntry}{showArrivals && <ScreenBoundary fallback={null}><Suspense fallback={null}><PlayCardArrival key={`${user.id}:${pairing.id}`} language={language} userId={user.id} /></Suspense></ScreenBoundary>}</>;
}

/** The plain paper shown while Ourever opens, and while a screen's code is still arriving. */
// Screens reached with a Back of their own; each gets a history entry (see AccountPrototype).
const stackedScreens: Screen[] = ["privacy", "feedback", "people", "space", "import", "capabilities", "personal", "dashboard", "pairing", "auth", "recovery"];
const signedInScreens: Screen[] = ["privacy", "feedback", "people", "space", "import", "capabilities", "personal", "dashboard", "pairing"];
const historyDepth = (state: unknown) => Number((state as { depth?: number } | null)?.depth) || 0;

function BootSplash({ language = initialLanguage(), testId }: { language?: Language; testId?: string }) {
  return <div className="loading-screen boot-splash" aria-busy="true" data-testid={testId} role="status"><span className="visually-hidden">{localized(language, "正在打开 Ourever…", "Opening Ourever…", "Abriendo Ourever…")}</span></div>;
}

function HomeScreen({ language, onLanguage, onProvider, onEmail, onSignIn, t }: { language: Language; onLanguage: (language: Language) => void; onProvider: (provider: SignInProvider) => void; onEmail: () => void; onSignIn: () => void; t: typeof copy.zh }) {
  // Like Mengmoon: the welcome screen is the sign-in screen. Apple and Google show once the server confirms they work;
  // that answer is normally already in before this screen opens.
  const [providersReady, setProvidersReady] = useState(welcomeProvidersKnown);
  useEffect(() => {
    let open = true;
    if (!welcomeProvidersKnown) void welcomeProvidersReady().then((ready) => { if (open) setProvidersReady(ready); });
    return () => { open = false; };
  }, []);
  return <div className="home-screen" data-testid="home-screen">
    <div className="mobile-home-composition plum-welcome">
      <LanguageSwitch language={language} onLanguage={onLanguage} />
      <img className="welcome-squirrel" src="/assets/brand/ourever-mascot.webp" width={384} height={384} alt="" draggable={false} />
      <h1>{language === "en" ? <>Not sure how to<br />reply to them?<br />Ask Ourever first.</> : t.homeLine}</h1>
      <div className="welcome-entry-actions">
        {providersReady && <>
          <button type="button" className="entry-method entry-apple" data-testid="welcome-apple" onClick={() => onProvider("apple")}><AppleLogo weight="fill" />{localized(language, "使用 Apple 继续", "Continue with Apple", "Continuar con Apple")}</button>
          <button type="button" className="entry-method entry-google" data-testid="welcome-google" onClick={() => onProvider("google")}><GoogleMark />{localized(language, "使用 Google 继续", "Continue with Google", "Continuar con Google")}</button>
        </>}
        <button type="button" className="entry-method entry-email" data-testid="start-button" onClick={onEmail}><EnvelopeSimple weight="bold" />{localized(language, "使用邮箱继续", "Continue with email", "Continuar con correo")}</button>
        <p className="entry-consent">{localized(language, "继续即表示你已满 18 岁，并同意", "By continuing, you confirm you are 18 or older and agree to the", "Al continuar, confirmas que tienes 18 años o más y aceptas la")} <LegalLinks language={language} />{localized(language, "。", ".", ".")}</p>
        <button type="button" className="welcome-sign-in" onClick={onSignIn}>{localized(language, "已有邮箱账号？登录", "Have an email account? Sign in", "¿Ya tienes cuenta con correo? Inicia sesión")}</button>
      </div>
    </div>
    <div className="desktop-home-composition" data-testid="desktop-home">
      <DesktopBrandHeader language={language} onLanguage={onLanguage} onLogin={onSignIn} />
      <div className="desktop-color-field desktop-color-field-red" aria-hidden="true" />
      <div className="desktop-color-field desktop-color-field-blue" aria-hidden="true" />
      <main className="desktop-home-hero">
        <p className="desktop-kicker">{localized(language, "两个人的关系助手", "YOUR RELATIONSHIP ASSISTANT", "SU ASISTENTE DE PAREJA")}</p>
        <h1>{t.homeLine}</h1>
        <PauseMark />
        <p className="desktop-home-support">{localized(language, "把 TA 的话或聊天截图发给 Ourever，它帮你看懂 TA 的意思，写一句你可以直接发的回复。一个人就能用；想两个人一起用时，再邀请 TA。", "Send Ourever what they said, or a screenshot of the chat. It helps you read what they mean and writes a reply you can send as is. It works on your own; invite your partner when you want to use it together.", "Envía a Ourever lo que te dijo, o una captura del chat. Te ayuda a entender lo que quiere decir y escribe una respuesta que puedes enviar tal cual. Funciona a solas; invita a tu pareja cuando quieran usarlo juntos.")}</p>
        <div className="desktop-home-actions">
          <button className="desktop-primary-cta" onClick={onEmail}>{localized(language, "开始", "Get started", "Comenzar")}<ArrowRight size={24} /></button>
          <button className="desktop-secondary-cta" onClick={() => location.assign("/demo")}>{localized(language, "两个人当面试一次（不用注册）", "Try it together in person (no sign-up)", "Pruébenlo juntos en persona (sin registro)")}</button>
        </div>
      </main>
      <footer className="desktop-home-footer" id="how-it-works"><span>{localized(language, "看懂 TA 的话", "Read what they mean", "Entender lo que quiere decir")}</span><i /><span>{localized(language, "写一句能发的回复", "Get a reply you can send", "Una respuesta lista para enviar")}</span><i /><span>{localized(language, "两个人说好就算数", "It counts once you both agree", "Cuenta cuando los dos aceptan")}</span></footer>
    </div>
  </div>;
}

function AuthScreen({ autoProvider, onAutoCancel, initialError, mode, onModeChange, language, onLanguage, onBack, onAuth, onRecover, notice, setNotice, busy, setBusy, t }: {
  autoProvider: SignInProvider | null; onAutoCancel: () => void; initialError: string; mode: AuthMode; onModeChange: (mode: AuthMode) => void; language: Language; onLanguage: (language: Language) => void; onBack: () => void; onRecover: () => void; onAuth: (state: { user: User; pairing: Pairing | null }) => Promise<void>;
  notice: string; setNotice: (value: string) => void; busy: boolean; setBusy: (value: boolean) => void; t: typeof copy.zh;
}) {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  // Set (to the code typed so far) once the server asks this sign-in to prove the mailbox (QA round 7).
  const [emailCode, setEmailCode] = useState<string | null>(null);
  // Continuing confirms the person is 18+ and accepts the terms; that is stated beside every sign-in button.
  const adultConfirmed = true;
  const [ref, setRef] = useState(referralCode);
  const [ineligible, setIneligible] = useState(initialError === "referral_ineligible");
  const removeRef = () => { clearReferral(); setRef(""); setIneligible(false); setProviderError(""); setNotice(""); };
  const [providerError, setProviderError] = useState(initialError);
  const [providers, setProviders] = useState<"checking" | "ready" | "unconfigured" | "failed">("checking");
  const [providerCheck, setProviderCheck] = useState(0);
  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    providerSignInAvailable(controller.signal).then(available => {
      if (mounted) setProviders(available ? "ready" : "unconfigured");
    }).catch(() => { if (mounted) setProviders("failed"); }).finally(() => clearTimeout(timeout));
    const refresh = () => { if (!document.hidden) setProviderCheck(last => last + 1); };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted = false; clearTimeout(timeout); controller.abort();
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [providerCheck]);
  const [working, setWorking] = useState<SignInProvider | "email" | null>(null);
  const submitting = useRef(false);
  const [showPassword, setShowPassword] = useState(false);
  const keyboard = useKeyboard();
  const begin = (method: SignInProvider | "email") => {
    if (submitting.current) return false;
    keyboard.hide(); setNotice(""); setProviderError("");
    if (!navigator.onLine) { setProviderError("offline"); return false; }
    submitting.current = true; setWorking(method); setBusy(true); return true;
  };
  const finish = () => { submitting.current = false; setWorking(null); setBusy(false); };
  const social = async (provider: SignInProvider) => {
    if (!begin(provider)) return;
    let redirecting = false;
    try {
      const result = await startProviderSignIn(provider, {
        adultConfirmed, installId: referralInstallId(), referralCode: ref || undefined, partnerInviteCode: inviteCode() || undefined, language,
      });
      if (result === "redirect") { redirecting = true; return; }
      if (result === "success") { await onAuth(await api("/api/auth/me")); return; }
      if (result === "adult_required" || result === "referral_ineligible") onModeChange("register");
      if (result === "referral_ineligible") setIneligible(true);
      if (result === "link_required") { setPassword(""); onModeChange("login"); }
      setProviderError(result);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 503) setProviderCheck(last => last + 1);
      setProviderError(!navigator.onLine ? "offline" : status === 503 ? "unavailable" : status === 429 ? "throttled" : "failed");
    } finally { if (!redirecting) finish(); }
  };
  // A provider chosen on the welcome screen starts as soon as this screen knows providers are available.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoProvider || autoStarted.current || providers !== "ready") return;
    autoStarted.current = true;
    void social(autoProvider);
  }, [autoProvider, providers]);
  useEffect(() => { if (autoProvider && autoStarted.current && providerError === "cancelled") onAutoCancel(); }, [providerError]);
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => { if (event.persisted) finish(); };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);
  const submit = async () => {
    if (!begin("email")) return;
    try { const state = await api<{ user: User; pairing: Pairing | null; code?: string; error?: string }>(mode === "login" ? "/api/auth/login" : "/api/auth/register", { method: "POST", body: JSON.stringify(mode === "login" ? { email, password, language, ...(emailCode === null ? {} : { emailCode }) } : { name, email, password, adultConfirmed, language, ...(inviteCode() ? { partnerInviteCode: inviteCode() } : {}), installId: referralInstallId(), ...(ref ? { referralCode: ref } : {}) }) });
      if (state.code === "verify_email") { setEmailCode(""); setNotice(state.error || ""); } else await onAuth(state); }
    catch (error) { if (ref && (error as { code?: string }).code === "referral_ineligible") { setIneligible(true); setNotice(localized(language, "这次注册无法获得邀请奖励。你仍可不使用邀请创建账号。", "This registration is ineligible for referral rewards. You can still create an account without the invitation.", "Este registro no cumple los requisitos de la invitación. Aún puedes crear una cuenta sin ella.")); } else setNotice(error instanceof TypeError ? inviteNetworkMessage(language) : accountError((error as Error).message, language)); } finally { finish(); }
  };
  // Instead of the old password, a six-digit code sent to the account's mailbox can confirm the link.
  const [linkCode, setLinkCode] = useState("");
  const [linkCodeSent, setLinkCodeSent] = useState(false);
  const sendLinkCode = async () => {
    if (submitting.current) return;
    if (!navigator.onLine) { setNotice(inviteNetworkMessage(language)); return; }
    keyboard.hide(); submitting.current = true; setBusy(true); setWorking("email"); setNotice("");
    try {
      await api("/api/auth/oauth/confirm-link/email", { method: "POST", body: JSON.stringify({ language }) });
      setLinkCodeSent(true); setLinkCode("");
      setNotice(localized(language, "确认码已发到这个邮箱，10 分钟内有效。", "We emailed a code to this address. It expires in 10 minutes.", "Enviamos un código a este correo. Caduca en 10 minutos."));
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 410) setProviderError("expired");
      else setNotice(!navigator.onLine ? inviteNetworkMessage(language) : signInMessage(status === 429 ? "throttled" : "failed", language));
    } finally { finish(); }
  };
  const confirmLinkCode = async () => {
    if (submitting.current || !/^\d{6}$/.test(linkCode)) return;
    keyboard.hide(); submitting.current = true; setBusy(true); setWorking("email"); setNotice("");
    try {
      await api("/api/auth/oauth/confirm-link", { method: "POST", body: JSON.stringify({ code: linkCode }) });
      setLinkCode(""); setLinkCodeSent(false);
      await onAuth(await api("/api/auth/me"));
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 410) { setProviderError("expired"); setLinkCodeSent(false); }
      else if (status === 401) setNotice(localized(language, "确认码不正确或已过期，请重试。", "That code is wrong or has expired. Try again.", "El código no es correcto o caducó. Inténtalo de nuevo."));
      else setNotice(!navigator.onLine ? inviteNetworkMessage(language) : signInMessage(status === 429 ? "throttled" : "failed", language));
    } finally { finish(); }
  };
  const confirmLink = async () => {
    if (submitting.current || !password) return;
    if (!navigator.onLine) { setNotice(inviteNetworkMessage(language)); return; }
    keyboard.hide(); submitting.current = true; setBusy(true); setWorking("email"); setNotice("");
    try {
      await api("/api/auth/oauth/confirm-link", { method: "POST", body: JSON.stringify({ password }) });
      setPassword("");
      await onAuth(await api("/api/auth/me"));
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 410) { setProviderError("expired"); setPassword(""); }
      else if (status === 401) setNotice(localized(language, "密码不正确，请重试。", "Incorrect password. Try again.", "La contraseña es incorrecta. Inténtalo de nuevo."));
      else setNotice(!navigator.onLine ? inviteNetworkMessage(language) : signInMessage(status === 429 ? "throttled" : "failed", language));
    } finally { finish(); }
  };
  return <MobileScroll className="paper-screen auth-screen plum-auth" data-testid="auth-screen">
    <header className="editorial-top"><button disabled={busy} onClick={onBack} aria-label={t.back}><ArrowLeft size={22} /></button><LanguageSwitch language={language} onLanguage={onLanguage} compact /></header>
    <div className="auth-art red-column" aria-hidden="true" />
    <main className="auth-content">{mode === "login" && <div className="auth-brand"><img src="/assets/brand/ourever-mascot.webp" alt="" />Ourever</div>}<div className="vertical-title"><h1>{mode === "login" ? t.welcome : t.register}</h1><PauseMark /></div><Wordmark language={language} />
      {mode === "register" && (ref ? <SignupReferral code={ref} language={language} remove={removeRef} /> : <p className="auth-hint">{hasInvite() ? localized(language, "创建账号后就能加入伴侣的共同空间，你的私人对话只有你自己能看到。", "Create your account to join your partner. Your private chats stay yours alone.", "Crea tu cuenta para unirte a tu pareja. Tus chats privados siguen siendo solo tuyos.") : t.registerHint}</p>)}
      {mode === "register" && <p className="auth-consent" data-testid="register-consent">{localized(language, "继续即表示你已满 18 岁，并同意", "By continuing, you confirm you are 18 or older and agree to the", "Al continuar, confirmas que tienes 18 años o más y aceptas la")} <LegalLinks language={language} />{localized(language, "。", ".", ".")}</p>}
      {providerError === "link_required" ? <div className="signin-link">
        <p role="status">{signInMessage("link_required", language)}</p>
        {linkCodeSent ? <form onSubmit={event => { event.preventDefault(); void confirmLinkCode(); }}>
          <label className="editorial-field"><span>{localized(language, "邮箱确认码", "Code from your email", "Código del correo")}</span><KeyboardInput inputMode="numeric" autoComplete="one-time-code" required maxLength={6} value={linkCode} onChange={e => setLinkCode(e.target.value.replace(/\D/g, "").slice(0, 6))} onBlur={() => keyboard.hide()} data-testid="link-code" /></label>
          <button className="signin-method" type="submit" disabled={busy || linkCode.length !== 6}>{localized(language, "确认并关联账号", "Confirm and link account", "Confirmar y vincular cuenta")}</button>
        </form> : <form onSubmit={event => { event.preventDefault(); void confirmLink(); }}>
          <label className="editorial-field"><span>{t.password}</span><KeyboardInput type="password" required autoComplete="current-password" maxLength={128} value={password} onChange={e => setPassword(e.target.value)} onBlur={() => keyboard.hide()} /></label>
          <button className="signin-method" type="submit" disabled={busy || !password}>{localized(language, "确认并关联账号", "Confirm and link account", "Confirmar y vincular cuenta")}</button>
        </form>}
        {notice && <p className="form-notice" role="alert">{notice}</p>}
        <button className="auth-switch" type="button" disabled={busy} onClick={() => void sendLinkCode()} data-testid="link-send-code">{linkCodeSent
          ? localized(language, "重新发送确认码", "Send the code again", "Enviar el código de nuevo")
          : localized(language, "忘了密码？改用邮箱验证码", "Use a code from my email instead", "Usar un código de mi correo")}</button>
        <button className="auth-switch" type="button" disabled={busy} onClick={() => { keyboard.hide(); setPassword(""); setNotice(""); setProviderError(""); }}>{t.back}</button>
      </div> : <>
      {autoProvider && providers === "checking" && <p className="auth-hint" role="status">{localized(language, "正在检查其他登录方式…", "Checking other sign-in options…", "Comprobando otros métodos de acceso…")}</p>}
      {autoProvider && providers === "failed" && <button type="button" className="auth-switch" disabled={busy} onClick={() => { setProviders("checking"); setProviderCheck(last => last + 1); }}>
        {localized(language, "未能加载其他登录方式，点此重试", "Couldn’t load other sign-in options. Try again", "No se pudieron cargar otros métodos de acceso. Reintentar")}
      </button>}
      {autoProvider && providers === "ready" && <div className="signin-providers">
        {(["apple", "google"] as const).map(provider => {
          const brand = provider === "apple" ? "Apple" : "Google";
          return <button className="signin-method" type="button" key={provider} disabled={busy} aria-busy={working === provider} onClick={() => void social(provider)} data-testid={`auth-${provider}`}>
            {working === provider ? <SpinnerGap className="signin-spinner" /> : provider === "apple" ? <AppleLogo weight="fill" /> : <GoogleMark />}
            {localized(language, `使用 ${brand} 继续`, `Continue with ${brand}`, `Continuar con ${brand}`)}
          </button>;
        })}
      </div>}
      {providerError && providerError !== "cancelled" && <p className="form-notice" role="alert">{signInMessage(providerError, language)}</p>}
      <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      {mode === "register" && <label className="editorial-field"><span>{t.displayName}</span><KeyboardInput required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={24} aria-describedby="register-name-count" data-testid="register-name" /><small id="register-name-count" className="field-count" aria-live="polite">{name.length >= 18 ? `${name.length}/24` : ""}</small></label>}
      <label className="editorial-field"><span>{t.email}</span><KeyboardInput type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" data-testid="auth-email" /></label>
      <div className="editorial-field auth-password-field">
        <label htmlFor="auth-password">{t.password}</label>
        <div className="password-input-wrap"><KeyboardInput id="auth-password" required minLength={10} maxLength={128} type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} data-testid="auth-password" />
          <button type="button" aria-label={localized(language, "显示密码", "Show password", "Mostrar contraseña")} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeSlash size={20} /> : <Eye size={20} />}</button>
        </div>{mode === "register" && <small>{t.passwordHint}</small>}
      </div>
      {mode === "login" && emailCode !== null && <label className="editorial-field"><span>{localized(language, "邮箱验证码", "Code from your email", "Código del correo")}</span><KeyboardInput inputMode="numeric" autoComplete="one-time-code" required maxLength={6} value={emailCode} onChange={e => setEmailCode(e.target.value.replace(/\D/g, "").slice(0, 6))} data-testid="auth-email-code" /></label>}
      {notice && <p className="form-notice" role="alert">{notice}</p>}
      {mode === "register" && ineligible && <button type="button" className="auth-switch" onClick={removeRef}>{localized(language, "不使用邀请注册", "Register without the invitation", "Registrarme sin invitación")}</button>}
      <button className="signin-method" type="submit" disabled={busy || !email || password.length < 10 || (mode === "register" && !name.trim()) || (mode === "login" && emailCode !== null && emailCode.length < 6)} aria-busy={working === "email"} data-testid="auth-submit">
        {working === "email" ? <SpinnerGap className="signin-spinner" /> : <EnvelopeSimple weight="bold" />}
        {mode === "login" ? localized(language, "使用邮箱登录", "Sign in with email", "Entrar con correo") : localized(language, "使用邮箱注册", "Create account with email", "Crear cuenta con correo")}
      </button>
      </form>
      <button className="auth-switch" type="button" disabled={busy} onClick={() => { keyboard.hide(); setProviderError(""); setShowPassword(false); onModeChange(mode === "login" ? "register" : "login"); setNotice(""); }}>{mode === "login" ? t.switchRegister : t.switchLogin}</button>
      {mode === "login" && <button className="auth-switch" type="button" disabled={busy} onClick={() => { keyboard.hide(); onRecover(); }}>{localized(language, "忘记密码？", "Forgot password?", "¿Olvidaste tu contraseña?")}</button>}
      </>}
    </main>
  </MobileScroll>;
}

/** Google's four-colour "G", as Google's sign-in branding asks for on light buttons. */
function GoogleMark() {
  return <svg className="google-mark" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>;
}

function signInMessage(reason: string, language: Language) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  switch (reason) {
    case "adult_required": return t("要创建账号，请确认已满 18 岁，再继续登录。", "To create your account, confirm you’re 18 or older and continue again.", "Para crear tu cuenta, confirma que tienes al menos 18 años y vuelve a continuar.");
    case "link_required": return t("此邮箱已有关联账号。输入原密码即可关联此次登录，继续使用原有的资料和伴侣空间。", "An account already uses this email. Enter its password to link this sign-in and keep your existing profile and shared space.", "Este correo ya tiene una cuenta. Introduce su contraseña para vincular este acceso y conservar tu perfil y espacio compartido.");
    case "expired": return t("本次关联已过期，请重新选择登录方式。", "This link request expired. Choose a sign-in method to try again.", "La solicitud de vinculación caducó. Elige un método de acceso para volver a intentarlo.");
    case "referral_ineligible": return t("本次注册不能使用此邀请奖励。你仍可不使用邀请注册。", "This account is ineligible for the referral reward. You can register without the invitation.", "Esta cuenta no puede recibir la recompensa. Puedes registrarte sin la invitación.");
    case "update_required": return t("当前版本请用邮箱登录，或在系统浏览器中继续。", "Sign in with email in this app version, or continue in your browser.", "En esta versión, entra con correo o continúa en tu navegador.");
    case "unavailable": return t("此登录方式暂时不可用。请用邮箱登录，或稍后重试。", "This sign-in method is unavailable. Use email or try again later.", "Este método no está disponible. Usa el correo o inténtalo más tarde.");
    case "throttled": return t("尝试过于频繁，请稍后重试。", "Too many attempts. Try again later.", "Demasiados intentos. Inténtalo más tarde.");
    case "offline": return inviteNetworkMessage(language);
    default: return t("登录未完成，请重试。", "Sign-in didn’t finish. Please try again.", "No se completó el inicio de sesión. Inténtalo de nuevo.");
  }
}
function settingsLabel(language: Language) { return localized(language, "设置", "Settings", "Ajustes"); }

export function InviteFrame({ language, onLanguage, title, children, signedOut }: {
  language: Language; onLanguage: (value: Language) => void; title: string; children: ReactNode; signedOut?: boolean;
}) {
  return <MobileScroll className="paper-screen pairing-screen invite-landing" data-testid={signedOut ? "invite-landing" : "pairing-screen"}>
    <header className="simple-header"><span /><span>{brandLabel(language)}</span><LanguageSwitch language={language} onLanguage={onLanguage} compact /></header>
    <main className="pairing-content">
      <div className="vertical-title"><h1 data-testid="invite-landing-title">{title}</h1><PauseMark /></div>
      <div className="pairing-actions">{children}</div>
    </main>
  </MobileScroll>;
}


function DesktopBrandHeader({ language, onLanguage, onLogin }: { language: Language; onLanguage: (language: Language) => void; onLogin: () => void }) { return <header className="desktop-brand-header"><Wordmark language={language} /><nav aria-label={localized(language, "主导航", "Main navigation", "Navegación principal")}><a href="#how-it-works">{localized(language, "如何工作", "How it works", "Cómo funciona")}</a><button onClick={() => location.assign("/demo")}>{localized(language, "两人快速体验", "Try it together", "Probar juntos")}</button></nav><div className="desktop-header-actions"><LanguageSwitch language={language} onLanguage={onLanguage} compact /><button className="desktop-login" onClick={onLogin}>{localized(language, "登录", "Sign in", "Iniciar sesión")}<ArrowRight size={17} /></button></div></header>; }
function LanguageSwitch({ language, onLanguage, compact = false }: { language: Language; onLanguage: (language: Language) => void; compact?: boolean }) { return <div className={`language-switch ${compact ? "compact" : ""}`} role="group" aria-label={localized(language, "选择界面语言", "Choose display language", "Elegir idioma de la interfaz")}>{languages.map((item, index) => <span key={item}>{index > 0 && <i>/</i>}<button type="button" className={language === item ? "active" : ""} onClick={() => onLanguage(item)} aria-pressed={language === item}>{item.toUpperCase()}</button></span>)}</div>; }
function Wordmark({ language }: { language: Language }) { return <div className="home-wordmark" aria-label={brandLabel(language)}><strong>Ourever</strong>{language === "zh" && <span>两个人的关系助手</span>}</div>; }
function PauseMark() { return <div className="pause-mark" aria-hidden="true"><i /><i /><i /></div>; }
// After sign-in the App opens on the conversation; invite links and deep links into a feature page keep their target.
function landing(pairing: Pairing | null): Screen { const params = new URLSearchParams(location.search); return hasInvite() ? "pairing" : params.get("view") === "feedback" ? "feedback" : params.get("view") === "space" ? spaceOrList(params) : params.get("view") === "import" ? "import" : params.get("view") === "people" ? "people" : params.get("view") === "capabilities" ? "capabilities" : ["membership", "referrals"].includes(params.get("view") || "") ? "privacy" : params.has("view") ? pairing?.status === "active" ? "dashboard" : "personal" : "conversation"; }
// A space link without a space opens the list of spaces, the conversation's menu, rather than a "no longer here" page.
function spaceOrList(params: URLSearchParams): Screen { return params.get("space") ? "space" : "conversation"; }
function accountLanding(user: User, pairing: Pairing | null): Screen {
  const screen = landing(pairing);
  return screen === "conversation" && !user.aiConsentAt && !aiDeclined(user.id) && (pairing?.status !== "active" || firstRunInProgress(user.id)) ? "invite-first" : screen;
}

const aiDeclinedKey = (userId: string) => "ourever:ai-declined:" + userId;
// Kept in memory too: when storage refuses the write (a full iPhone, a locked-down WebView), "Not now" must still let the
// person in for this session instead of showing the consent screen again and again (iPhone QA 11-22).
const aiDeclinedHere = new Set<string>();
function aiDeclined(userId: string) { if (aiDeclinedHere.has(userId)) return true; try { return localStorage.getItem(aiDeclinedKey(userId)) === "1"; } catch { return false; } }
function rememberAiDeclined(userId: string, declined: boolean) { if (declined) aiDeclinedHere.add(userId); else aiDeclinedHere.delete(userId); try { if (declined) localStorage.setItem(aiDeclinedKey(userId), "1"); else localStorage.removeItem(aiDeclinedKey(userId)); } catch { /* asked again next launch */ } }

function signedInHere(value?: boolean) { try { if (value === undefined) return localStorage.getItem("ourever.signed-in") === "1"; if (value) localStorage.setItem("ourever.signed-in", "1"); else localStorage.removeItem("ourever.signed-in"); } catch { /* not remembered */ } return false; }
