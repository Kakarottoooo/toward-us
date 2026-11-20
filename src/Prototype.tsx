import { ArrowLeft, ArrowRight, ChatCircleText, Eye, EyeSlash } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { KeyboardInput, MobileScroll, useKeyboard } from "./mobile";
import DemoFlow from "./DemoFlow";
import { PersonalHome } from "./features/private-agent/PersonalHome";
import { SettingsPage } from "./features/privacy/SettingsPage";
import { AiConsentScreen, LegalLinks, OfflineBanner } from "./features/privacy/AiConsent";
import { ReferralNotices, SignupReferral } from "./features/membership/ReferralPage";
import { clearReferral, referralCode, referralInstallId } from "./features/membership/referrals";
import { BETA_KEY, inIosApp } from "./features/membership/MembershipPage";
import { clearFeedbackForDeletedAccount } from "./features/feedback/feedbackQueue";
import { FeedbackEntry } from "./features/feedback/FeedbackEntry";
import { feedbackView, recentFeedbackActivity } from "./features/feedback/feedbackDiagnostics";
import { FeedbackPage } from "./features/feedback/FeedbackPage";
import { PasswordResetForm } from "./features/privacy/PasswordReset";
import { AccountRecovery } from "./features/privacy/AccountRecovery";
import { RelationshipHome } from "./features/relationship-home/RelationshipHome";
import { ConversationHome, PageHeader } from "./features/conversation/ConversationHome";
import { PartnerInvite } from "./features/conversation/PartnerInvite";
import { SpacePage } from "./features/spaces/SpacePage";
import { PeoplePage } from "./features/people/PeoplePage";
import { ImportsPage } from "./features/imports/ImportsPage";
import { CapabilitiesPage } from "./features/capabilities/CapabilitiesPage";
import { disableNativePush, listenNativeInviteLinks, listenNativePushTaps, restoreNativePush } from "./features/reminders/nativePush";
import { connectHomeWidget, disconnectHomeWidget } from "./features/widget/homeWidget";
import { disableWebPush, registerAppWorker, restoreWebPush } from "./features/reminders/webPush";
import { InstallHint } from "./features/reminders/InstallHint";
import { PlayCardArrival } from "./features/games/PlayCardArrival";
import { apiErrorText, brandLabel, currentLanguage, inInterfaceLanguage, initialLanguage, languageTag, languages, localized, pageTitle, type Language } from "./i18n";
import { autoSyncAlbum } from "./features/moments/photoAlbum";
import "./relationship.css";
import "./controls.css";
import "./ourever-plum.css";

type Screen = "booting" | "identity-error" | "invite-first" | "home" | "invite" | "conversation" | "space" | "import" | "people" | "capabilities" | "personal" | "privacy" | "feedback" | "recovery" | "auth" | "pairing" | "dashboard";
type AuthMode = "login" | "register";
type User = { id: string; email: string; name: string; createdAt: string; aiConsentAt?: string | null };
type PairMember = { id: string; name: string; role: "A" | "B"; joinedAt: string };
export type Pairing = { id: string; status: "pending" | "active"; role: "A" | "B"; members: PairMember[]; invitation: { code: string; createdAt: string; expiresAt: string; openedAt: string | null; sentAt?: string | null; cancelledAt?: string | null } | null };
type InvitePreview = { inviterName: string; status: "open" | "expired" | "used" | "cancelled" };

const copy = {
  zh: {
    homeLine: "不知道怎么回 TA，先问问 Ourever。", start: "开始", homeFooter: "看懂 · 回应 · 靠近", back: "返回",
    welcome: "欢迎回来", registerHint: "你可以先和 Ourever 私聊，想一起使用时再邀请伴侣。", email: "邮箱", password: "密码",
    displayName: "你的称呼", login: "登录", register: "创建账号", switchRegister: "还没有账号？创建一个",
    switchLogin: "已有账号？返回登录", passwordHint: "至少 10 个字符", invitePartner: "邀请伴侣", inviteHint: "一起建立你们的共同空间。",
    createInvite: "生成伴侣邀请", copyInvite: "复制邀请链接", copied: "已复制", waitingPartner: "等待对方加入",
    waitingHint: "对方用自己的账号接受后，共同空间才会打开。", acceptInvite: "接受邀请",
    inviteCode: "八位邀请码", logout: "退出登录",
    joinPartner: "加入伴侣", joinHint: "TA 邀请你一起用 Ourever。接受后，你们俩共同的对话“我们俩”就会打开。",
  },
  en: {
    homeLine: "Not sure how to reply to them? Ask Ourever first.", start: "Begin", homeFooter: "Understand · Reply · Get closer", back: "Back",
    welcome: "Welcome back", registerHint: "Start with a private chat. You can invite your partner whenever you’re ready.", email: "Email", password: "Password",
    displayName: "Your name", login: "Sign in", register: "Create account", switchRegister: "New here? Create an account",
    switchLogin: "Already registered? Sign in", passwordHint: "At least 10 characters", invitePartner: "Invite your partner", inviteHint: "Build your shared space together.",
    createInvite: "Create partner invite", copyInvite: "Copy invite link", copied: "Copied", waitingPartner: "Waiting for your partner",
    waitingHint: "They must accept with their own account before mediation and reviews are shared.", acceptInvite: "Accept invite",
    inviteCode: "Eight-character code", logout: "Sign out",
    joinPartner: "Join your partner", joinHint: "Your partner invited you to Ourever. Accept to open Us, the conversation the two of you share.",
  },
  es: {
    homeLine: "¿No sabes qué responderle? Pregúntale a Ourever.", start: "Comenzar", homeFooter: "Entender · Responder · Acercarse", back: "Volver",
    welcome: "Bienvenido de nuevo", registerHint: "Empieza con un chat privado. Puedes invitar a tu pareja cuando quieras.", email: "Correo electrónico", password: "Contraseña",
    displayName: "Tu nombre", login: "Iniciar sesión", register: "Crear cuenta", switchRegister: "¿Eres nuevo? Crea una cuenta",
    switchLogin: "¿Ya tienes cuenta? Inicia sesión", passwordHint: "Al menos 10 caracteres", invitePartner: "Invita a tu pareja", inviteHint: "Construyan juntos su espacio compartido.",
    createInvite: "Crear invitación", copyInvite: "Copiar enlace", copied: "Copiado", waitingPartner: "Esperando a tu pareja",
    waitingHint: "Debe aceptar con su propia cuenta antes de compartir mediaciones y revisiones.", acceptInvite: "Aceptar invitación",
    inviteCode: "Código de ocho caracteres", logout: "Cerrar sesión",
    joinPartner: "Únete a tu pareja", joinHint: "Tu pareja te invitó a Ourever. Acepta para abrir Nosotros, la conversación que comparten.",
  },
};

export default function Prototype() {
  return <><OfflineBanner />{location.pathname.startsWith("/demo") || location.pathname.startsWith("/j/") ? <><DemoFlow /><FeedbackLink language={initialLanguage()} /></> : <AccountPrototype />}</>;
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
  const [settingsPage, setSettingsPage] = useState<"character" | "profile" | "membership" | "referrals" | undefined>(() => { const params = new URLSearchParams(location.search); const beta = params.get("beta"); if (beta && !inIosApp()) { try { localStorage.setItem(BETA_KEY, beta.trim().toUpperCase().slice(0, 20)); } catch { /* private mode */ } } return params.get("view") === "referrals" ? "referrals" : params.get("view") === "membership" ? "membership" : undefined; });
  const [resetToken, setResetToken] = useState(() => { const token = new URLSearchParams(window.location.search).get("reset") || ""; if (token) window.history.replaceState(null, "", window.location.pathname); return token; });
  const [user, setUser] = useState<User | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [joinedElsewhere, setJoinedElsewhere] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>(() => referralCode() ? "register" : "login");
  const keyboard = useKeyboard();
  const t = copy[language];

  useEffect(() => { try { localStorage.setItem("toward-us.language", language); } catch { /* keep the selection for this visit */ } document.documentElement.lang = languageTag(language); document.title = pageTitle(language); }, [language]);
  useEffect(() => {
    api<{ user: User | null; pairing: Pairing | null }>("/api/auth/me").then((state) => {
      setUser(state.user); setPairing(state.pairing);
      // Signed out with a partner's invite link: the page that says who invited them comes first, not the generic home.
      setScreen(state.user ? accountLanding(state.user, state.pairing) : hasInvite() ? "invite" : referralCode() || ["referrals", "feedback"].includes(new URLSearchParams(location.search).get("view") || "") ? "auth" : "home");
      if (state.user) { void restoreNativePush(); void restoreWebPush(); void connectHomeWidget(); if (state.pairing?.status === "active" && state.user.aiConsentAt) autoSyncAlbum(language); }
    }).catch(() => setScreen(hasInvite() ? "identity-error" : "home"));
    listenNativePushTaps();
    listenNativeInviteLinks();
    registerAppWorker();
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

  const openAuth = (mode: AuthMode) => {
    keyboard.hide();
    setNotice("");
    setAuthMode(mode);
    setScreen("auth");
  };
  const selectLanguage = (value: Language) => setLanguage(value);
  const acceptAuth = async (state: { user: User; pairing: Pairing | null }) => {
    if (referralCode()) clearReferral();
    const next = new URLSearchParams(location.search).get("next");
    if (next && /^\/m\/[a-z0-9]{12}$/.test(next)) { location.assign(next); return; }
    setUser(state.user); setPairing(state.pairing); setNotice("");
    setScreen(accountLanding(state.user, state.pairing));
    // A signed-in phone with existing permission can reconnect without a system prompt.
    void restoreNativePush();
    // Inside the iPhone App, the home-screen widget gets its own read-only token (a no-op in a browser).
    void connectHomeWidget();
  };
  const refreshPairing = async () => {
    const state = await api<{ user: User; pairing: Pairing | null }>("/api/auth/me");
    setPairing(state.pairing);
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
    return () => { active = false; clearInterval(interval); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("online", refresh); };
  }, [user?.id, user?.aiConsentAt, pairing?.status, screen]);
  useEffect(() => {
    if (!joinedElsewhere) return;
    const timer = window.setTimeout(() => setJoinedElsewhere(false), 7000);
    return () => clearTimeout(timer);
  }, [joinedElsewhere]);
  const logout = async () => { keyboard.hide(); await disableNativePush(); await disableWebPush(); await disconnectHomeWidget(); await api("/api/auth/logout", { method: "POST" }); forgetInvite(); setUser(null); setPairing(null); setScreen("home"); };

  const reloadIdentity = async () => { const state = await api<{ user: User | null; pairing: Pairing | null }>("/api/auth/me"); setUser(state.user); setPairing(state.pairing); setScreen(state.user ? landing(state.pairing) : "home"); };
  const fullScreen: Screen = pairing?.status === "active" ? "dashboard" : "personal";
  // The screen a page link opens on.
  const screenFor = (url: string): Screen => url.includes("game=") ? "conversation" : url.includes("view=space") ? "space" : url.includes("view=import") ? "import" : url.includes("view=people") ? "people" : url.includes("view=capabilities") ? "capabilities" : fullScreen;
  const backToConversation = () => { keyboard.hide(); window.history.replaceState(null, "", location.pathname); setScreen("conversation"); };
  // Pages hand a starting sentence back to the conversation, in the channel the page belongs to.
  const askPinky = (text: string, channel: "me" | "us") => { keyboard.hide(); window.history.replaceState(null, "", `/?channel=${channel}${channel === "us" ? "&recipient=assistant" : ""}&say=${encodeURIComponent(text)}`); setScreen("conversation"); };
  // No AI work for anyone who hasn't agreed to third-party AI yet: they see the consent screen first (accounts made before
  // sign-up asked for it). Declining signs them out; Settings can withdraw it later, which brings this screen back.
  const openFeedback = (from: string, image?: File) => {
    keyboard.hide(); setFeedbackFrom(feedbackView(from)); setFeedbackFile(image); setFeedbackReturn(screen);
    setScreen("feedback");
  };
  const closeFeedback = () => {
    keyboard.hide(); setFeedbackFile(undefined);
    if (new URLSearchParams(location.search).get("view") === "feedback") window.history.replaceState(null, "", location.pathname);
    setScreen(feedbackReturn);
  };
  const renderScreen = () => {
    if (screen === "feedback" && user) return <FeedbackPage key={user.id} userId={user.id} language={language} from={feedbackFrom}
      activity={recentFeedbackActivity(language) || localized(language, `正在使用的页面 · ${feedbackFrom}`, `Using screen · ${feedbackFrom}`, `Pantalla en uso · ${feedbackFrom}`)} initialFile={feedbackFile} onBack={closeFeedback} />;
    if (screen === "identity-error") return <InviteFrame language={language} onLanguage={selectLanguage} title={localized(language, "暂时无法打开邀请", "Your invitation couldn’t load", "No se pudo cargar tu invitación")}>
      <p className="pairing-lead" role="alert">{inviteNetworkMessage(language)}</p>
      <button className="primary-action" onClick={() => location.reload()}>{retryLabel(language)}</button>
    </InviteFrame>;
    if (screen === "invite-first" && user) {
      const paired = pairing?.status === "active";
      return <InviteFrame language={language} onLanguage={selectLanguage} title={paired ? localized(language, "你们的共同空间已开启", "Your shared space is ready", "Su espacio compartido está listo") : localized(language, "你们的共同空间", "A space for the two of you", "Un espacio para los dos")}>
        {paired ? <p className="pairing-lead" role="status">{localized(language, "你的伴侣已加入。欢迎你们！", "Your partner joined. Welcome to Us!", "Tu pareja se ha unido. ¡Bienvenidos a Nosotros!")}</p> : <PartnerInvite userId={user.id} language={language} pairing={pairing} onPairingChange={setPairing} onRefreshPairing={refreshPairing} />}
        <button className="secondary-action" onClick={() => { keyboard.hide(); if (paired) history.replaceState(null, "", "/?channel=us"); setScreen("conversation"); }}>{paired ? localized(language, "打开共同对话", "Open Us", "Abrir Nosotros") : localized(language, "进入我的私人空间", "Continue to my private space", "Ir a mi espacio privado")}</button>
      </InviteFrame>;
    }
    if (user && !user.aiConsentAt && !["booting", "home", "auth", "recovery", "privacy", "pairing"].includes(screen)) return <AiConsentScreen language={language} onAgreed={(at) => setUser({ ...user, aiConsentAt: at })} onDecline={() => { setSettingsPage(undefined); setScreen("privacy"); }} />;
    if (screen === "conversation" && user) return <><InstallHint language={language} userId={user.id} /><ConversationHome user={user} pairing={pairing} language={language} onPrivacy={(page) => { setSettingsPage(page); setScreen("privacy"); }} onFeedback={openFeedback} onLogout={logout} onOpen={(url) => { window.history.replaceState(null, "", url); setScreen(screenFor(url)); }} onPair={() => setScreen("pairing")} onRefreshPairing={refreshPairing} onPairingChange={setPairing} onAccessChanged={reloadIdentity} /></>;
    if (screen === "import" && user) return <ImportsPage key={location.search} id={new URLSearchParams(location.search).get("import") || ""} user={{ id: user.id, name: user.name }} paired={pairing?.status === "active"} language={language} onBack={backToConversation} onOpen={(url) => { window.history.replaceState(null, "", url); setScreen("import"); }} onAsk={askPinky} />;
    if (screen === "people" && user) return <PeoplePage key={location.search} language={language} initialPerson={new URLSearchParams(location.search).get("person") || ""} archived={new URLSearchParams(location.search).get("archived") === "1"} onBack={new URLSearchParams(location.search).get("archived") === "1" ? () => { window.history.replaceState(null, "", location.pathname); setScreen("privacy"); } : backToConversation} onAsk={askPinky} onChat={(personId) => { keyboard.hide(); window.history.replaceState(null, "", `/?channel=me&person=${encodeURIComponent(personId)}`); setScreen("conversation"); }} />;
    if (screen === "space" && user) return <SpacePage key={location.search} id={new URLSearchParams(location.search).get("space") || ""} language={language} onBack={backToConversation} onAsk={askPinky} />;
    if (screen === "booting" && !resetToken) return <div className="loading-screen" aria-busy="true" data-testid="booting" />;
    if (resetToken) return <MobileScroll className="paper-screen recovery-screen"><main className="recovery-content"><PasswordResetForm language={language} token={resetToken} onDone={() => { setResetToken(""); setNotice(localized(language, "密码已更新，请用新密码登录。", "Password updated. Sign in with your new password.", "Contraseña actualizada. Inicia sesión con la nueva.")); setScreen("auth"); }} /></main></MobileScroll>;
    if (screen === "recovery") return <MobileScroll className="paper-screen recovery-screen"><main className="recovery-content"><AccountRecovery language={language} onBack={() => setScreen("auth")} onRecovered={() => { setNotice(localized(language, "密码已更新，请重新登录并生成新的恢复码。", "Password updated. Sign in and generate a new recovery code.", "Contraseña actualizada. Inicia sesión y genera un nuevo código de recuperación.")); setScreen("auth"); }} /></main></MobileScroll>;
    if (screen === "personal" && user) return <PersonalHome user={user} relationshipId={pairing?.status === "active" ? pairing.id : null} language={language} onShared={() => setScreen("dashboard")} onBack={backToConversation} onAsk={askPinky} />;
    if (screen === "capabilities" && user) return <CapabilitiesPage language={language} paired={pairing?.status === "active"} onBack={backToConversation} onAsk={askPinky} onOpen={(url) => { window.history.replaceState(null, "", url); setScreen(screenFor(url)); }} onProfile={() => { setSettingsPage("profile"); setScreen("privacy"); }} />;
    if (screen === "privacy" && user) return <SettingsPage onName={name => setUser({ ...user, name })} key={settingsPage || "main"} onFeedback={() => openFeedback("settings")} initialPage={settingsPage} onAsk={(text) => askPinky(text, "me")} onEarlierPeople={() => { window.history.replaceState(null, "", "/?view=people&archived=1"); setScreen("people"); }} user={user}relationshipId={pairing?.status === "active" ? pairing.id : null} partnerName={pairing?.status === "active" ? pairing.members.find((member) => member.id !== user.id)?.name || null : null} language={language} onLanguage={selectLanguage} onBack={backToConversation} onLogout={logout} onLeft={reloadIdentity} onDeleted={async () => { try { await clearFeedbackForDeletedAccount(user.id); } finally { await reloadIdentity(); } }} onAiConsent={(at) => setUser({ ...user, aiConsentAt: at })} />;
    if (screen === "invite") return <PartnerJoin language={language} onLanguage={selectLanguage} onAuth={(mode) => { rememberInvite(); openAuth(mode); }} />;
    if (screen === "home") return <HomeScreen language={language} onLanguage={selectLanguage} onStart={() => user ? setScreen(landing(pairing)) : openAuth("register")} onSignIn={() => user ? setScreen(landing(pairing)) : openAuth("login")} t={t} />;
    if (screen === "auth") return <AuthScreen mode={authMode} onModeChange={setAuthMode} language={language} onLanguage={selectLanguage} onBack={() => setScreen(hasInvite() ? "invite" : "home")} onAuth={acceptAuth} onRecover={() => setScreen("recovery")} notice={notice} setNotice={setNotice} busy={busy} setBusy={setBusy} t={t} />;
    if (screen === "pairing" && user) return <PartnerJoin language={language} onLanguage={selectLanguage} account={{ pairing, onJoined: (next) => {
      forgetInvite(); history.replaceState(null, "", "/?channel=us"); setPairing(next); setScreen("conversation");
    }, onBack: () => { forgetInvite(); backToConversation(); } }} />;
    if (screen === "dashboard" && user && pairing) return <RelationshipHome user={{ id: user.id, name: user.name }} language={language} onNotice={setNotice} onAccessChanged={reloadIdentity} onBack={backToConversation} onAsk={askPinky} />;
    return <div className="loading-screen"><Wordmark language={language} /><p>{localized(language, "正在进入共同空间…", "Opening your shared space…", "Abriendo su espacio compartido…")}</p></div>;
  };
  const showArrivals = user?.aiConsentAt && pairing?.status === "active" && !resetToken &&
    !["booting", "home", "auth", "recovery", "invite", "pairing"].includes(screen);
  return <>{renderScreen()}{joinedElsewhere && user && <div className="partner-arrival-notice" role="status">{localized(language, "你的伴侣已加入，打开“我们俩”即可聊天。", "Your partner joined. Open Us to chat together.", "Tu pareja se ha unido. Abre Nosotros para conversar.")}</div>}{!user && screen === "home" && !resetToken && <FeedbackLink language={language} />}{user && !resetToken && <ReferralNotices key={user.id} userId={user.id} language={language} openPage={page => { keyboard.hide(); setSettingsPage(page); window.history.replaceState(null, "", "/?view=" + page); setScreen("privacy"); }} openFeedback={() => openFeedback("settings")} />}{user && <FeedbackEntry key={user.id} userId={user.id} language={language} hidden={screen === "feedback" || !!resetToken} open={image => openFeedback(screen, image)} />}{showArrivals && <PlayCardArrival key={`${user.id}:${pairing.id}`} language={language} />}</>;
}

function HomeScreen({ language, onLanguage, onStart, onSignIn, t }: { language: Language; onLanguage: (language: Language) => void; onStart: () => void; onSignIn: () => void; t: typeof copy.zh }) {
  return <div className="home-screen" data-testid="home-screen">
    <div className="mobile-home-composition plum-welcome">
      <LanguageSwitch language={language} onLanguage={onLanguage} />
      <img className="welcome-squirrel" src="/assets/brand/ourever-mascot.webp" alt="" draggable={false} />
      <h1>{language === "en" ? <>Not sure how to<br />reply to them?<br />Ask Ourever first.</> : t.homeLine}</h1>
      <div className="welcome-entry-actions">
        <button type="button" className="plum-primary" data-testid="start-button" onClick={onStart}>{t.start}</button>
        <button type="button" className="welcome-sign-in" onClick={onSignIn}>{t.login}</button>
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
          <button className="desktop-primary-cta" onClick={onStart}>{localized(language, "开始", "Get started", "Comenzar")}<ArrowRight size={24} /></button>
          <button className="desktop-secondary-cta" onClick={() => location.assign("/demo")}>{localized(language, "两个人当面试一次（不用注册）", "Try it together in person (no sign-up)", "Pruébenlo juntos en persona (sin registro)")}</button>
        </div>
      </main>
      <footer className="desktop-home-footer" id="how-it-works"><span>{localized(language, "看懂 TA 的话", "Read what they mean", "Entender lo que quiere decir")}</span><i /><span>{localized(language, "写一句能发的回复", "Get a reply you can send", "Una respuesta lista para enviar")}</span><i /><span>{localized(language, "两个人说好就算数", "It counts once you both agree", "Cuenta cuando los dos aceptan")}</span></footer>
    </div>
  </div>;
}

function AuthScreen({ mode, onModeChange, language, onLanguage, onBack, onAuth, onRecover, notice, setNotice, busy, setBusy, t }: {
  mode: AuthMode; onModeChange: (mode: AuthMode) => void; language: Language; onLanguage: (language: Language) => void; onBack: () => void; onRecover: () => void; onAuth: (state: { user: User; pairing: Pairing | null }) => Promise<void>;
  notice: string; setNotice: (value: string) => void; busy: boolean; setBusy: (value: boolean) => void; t: typeof copy.zh;
}) {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [ref, setRef] = useState(referralCode);
  const [ineligible, setIneligible] = useState(false);
  const removeRef = () => { clearReferral(); setRef(""); setIneligible(false); setNotice(""); };
  const [showPassword, setShowPassword] = useState(false);
  const keyboard = useKeyboard();
  const submit = async () => {
    keyboard.hide(); setBusy(true); setNotice("");
    try { await onAuth(await api(mode === "login" ? "/api/auth/login" : "/api/auth/register", { method: "POST", body: JSON.stringify(mode === "login" ? { name, email, password } : { name, email, password, adultConfirmed, ...(inviteCode() ? { partnerInviteCode: inviteCode() } : {}), installId: referralInstallId(), ...(ref ? { referralCode: ref } : {}) }) })); }
    catch (error) { if (ref && (error as { code?: string }).code === "referral_ineligible") { setIneligible(true); setNotice(localized(language, "这次注册无法获得邀请奖励。你仍可不使用邀请创建账号。", "This registration is ineligible for referral rewards. You can still create an account without the invitation.", "Este registro no cumple los requisitos de la invitación. Aún puedes crear una cuenta sin ella.")); } else setNotice(error instanceof TypeError ? inviteNetworkMessage(language) : accountError((error as Error).message, language)); } finally { setBusy(false); }
  };
  return <MobileScroll className="paper-screen auth-screen plum-auth" data-testid="auth-screen">
    <header className="editorial-top"><button onClick={onBack} aria-label={t.back}><ArrowLeft size={22} /></button><LanguageSwitch language={language} onLanguage={onLanguage} compact /></header>
    <div className="auth-art red-column" aria-hidden="true" />
    <main className="auth-content">{mode === "login" && <div className="auth-brand"><img src="/assets/brand/ourever-mascot.webp" alt="" />Ourever</div>}<div className="vertical-title"><h1>{mode === "login" ? t.welcome : t.register}</h1><PauseMark /></div><Wordmark language={language} />
      {mode === "register" && (ref ? <SignupReferral code={ref} language={language} remove={removeRef} /> : <p className="auth-hint">{t.registerHint}</p>)}
      {mode === "register" && <label className="editorial-field"><span>{t.displayName}</span><KeyboardInput value={name} onChange={(event) => setName(event.target.value)} maxLength={24} data-testid="register-name" /></label>}
      <label className="editorial-field"><span>{t.email}</span><KeyboardInput type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" data-testid="auth-email" /></label>
      <div className="editorial-field auth-password-field">
        <label htmlFor="auth-password">{t.password}</label>
        <div className="password-input-wrap"><KeyboardInput id="auth-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} data-testid="auth-password" />
          <button type="button" aria-label={localized(language, "显示密码", "Show password", "Mostrar contraseña")} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeSlash size={20} /> : <Eye size={20} />}</button>
        </div>{mode === "register" && <small>{t.passwordHint}</small>}
      </div>
      {notice && <p className="form-notice" role="alert">{notice}</p>}
      {mode === "register" && ineligible && <button type="button" className="auth-switch" onClick={removeRef}>{localized(language, "不使用邀请注册", "Register without the invitation", "Registrarme sin invitación")}</button>}
      {mode === "register" && <p className="auth-consent" data-testid="register-consent">{localized(language, "创建账号前请阅读", "Before creating an account, read the", "Antes de crear tu cuenta, lee la")} <LegalLinks language={language} />{localized(language, "。", ".", ".")}</p>}
      {mode === "register" && <label className="auth-consent"><input type="checkbox" checked={adultConfirmed} onChange={(event) => setAdultConfirmed(event.target.checked)} /> {localized(language, "我确认已满 18 岁。", "I confirm that I am 18 or older.", "Confirmo que tengo al menos 18 años.")}</label>}
      <SplitButton label={mode === "login" ? t.login : t.register} onClick={submit} disabled={busy || !email || password.length < 10 || (mode === "register" && (!name.trim() || !adultConfirmed))} testId="auth-submit" />
      <button className="auth-switch" type="button" onClick={() => { keyboard.hide(); setShowPassword(false); onModeChange(mode === "login" ? "register" : "login"); setNotice(""); }}>{mode === "login" ? t.switchRegister : t.switchLogin}</button>
      {mode === "login" && <button className="auth-switch" type="button" onClick={onRecover}>{localized(language, "忘记密码？", "Forgot password?", "¿Olvidaste tu contraseña?")}</button>}
    </main>
  </MobileScroll>;
}

function retryLabel(language: Language) { return localized(language, "重试", "Try again", "Reintentar"); }
function inviteNetworkMessage(language: Language) {
  return localized(language, "暂时无法连接 Ourever。请检查网络后重试。", "Can’t reach Ourever. Check your connection and try again.", "No se pudo conectar con Ourever. Revisa tu conexión y vuelve a intentarlo.");
}

function InviteFrame({ language, onLanguage, title, children, signedOut }: {
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

type JoinAccount = { pairing: Pairing | null; onJoined: (pairing: Pairing) => void; onBack: () => void };
type InviteLookup = InvitePreview | "missing" | "unavailable";
function PartnerJoin({ language, onLanguage, account, onAuth }: {
  language: Language; onLanguage: (value: Language) => void; account?: JoinAccount; onAuth?: (mode: AuthMode) => void;
}) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [code, setCode] = useState(inviteCode);
  const malformedLink = hasInvite() && !inviteCode() && !code;
  const [lookup, setLookup] = useState<{ code: string; value: InviteLookup } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const keyboard = useKeyboard();
  const paired = account?.pairing?.status === "active";
  const own = !!code && account?.pairing?.invitation?.code === code;
  const valid = /^[A-Z0-9]{8}$/.test(code);
  const readPreview = valid && !paired && !own;
  useEffect(() => {
    if (!readPreview) return;
    const request = new AbortController();
    api<{ invitation: InvitePreview }>("/api/partner/invitations/" + code, { signal: request.signal })
      .then(result => { if (!request.signal.aborted) setLookup({ code, value: result.invitation }); })
      .catch(reason => { if (!request.signal.aborted) setLookup({ code, value: reason.status === 404 ? "missing" : "unavailable" }); });
    return () => request.abort();
  }, [code, readPreview, attempt]);
  const preview = lookup?.code === code ? lookup.value : null;
  const retry = () => { setError(""); setLookup(null); setAttempt(value => value + 1); };
  const found = typeof preview === "object" ? preview : null;
  const name = found?.inviterName;
  const loading = readPreview && !preview;
  const unusable = own || (!valid && (!account || malformedLink)) || preview === "missing" || (!!found && found.status !== "open");
  const title = paired ? t("你已经与伴侣配对", "You’re already paired", "Ya tienes pareja vinculada")
    : name && !unusable ? t("加入" + name + "的共同空间", "Join " + name, "Únete a " + name)
    : t("伴侣邀请", "Partner invitation", "Invitación de pareja");
  const problem = own ? t("这是你自己的邀请。把它发给伴侣，或输入对方发给你的邀请码。", "This is your own invitation. Share it with your partner, or enter their code below.", "Esta es tu invitación. Envíala a tu pareja o escribe aquí su código.")
    : preview === "missing" || (!valid && (!account || malformedLink)) ? t("没有找到这份邀请。请向伴侣索取新链接。", "We couldn’t find that invite. Ask your partner for a new link.", "No encontramos esa invitación. Pide un enlace nuevo a tu pareja.")
    : found?.status === "cancelled" ? t("邀请已被取消。请让伴侣重新发送。", "This invite was cancelled. Ask your partner to send a new one.", "Se canceló esta invitación. Pide a tu pareja que envíe otra.")
    : found?.status === "expired" ? t("邀请已过期。请让伴侣发送新链接。", "This invite has expired. Ask your partner for a new link.", "La invitación caducó. Pide un enlace nuevo a tu pareja.")
    : found?.status === "used" ? t("邀请已被使用。已加入可登录原账号，否则请向伴侣索取新链接。", "This invite has already been used. Sign in to the account you joined with, or ask your partner for a new link.", "Esta invitación ya se usó. Entra con la cuenta con la que te uniste o pide un enlace nuevo a tu pareja.") : "";
  const accept = async () => {
    if (!account || joining || found?.status !== "open" || own || paired) return;
    keyboard.hide(); setJoining(true); setError("");
    try {
      const result = await api<{ pairing: Pairing }>("/api/partner/accept", { method: "POST", body: JSON.stringify({ code, language }) });
      account.onJoined(result.pairing);
    } catch (reason) {
      setError(reason instanceof TypeError ? inviteNetworkMessage(language) : accountError((reason as Error).message, language));
      setAttempt(value => value + 1);
    } finally { setJoining(false); }
  };
  return <InviteFrame language={language} onLanguage={onLanguage} title={title} signedOut={!account}>
    {paired ? <>
      <p className="pairing-lead">{t("你已有共同空间。若要与其他人配对，请先在设置中退出当前关系。", "You already share a space with your partner. To pair with someone else, first leave your current relationship in Settings.", "Ya compartes un espacio con tu pareja. Para vincularte con otra persona, sal primero de tu relación actual en Ajustes.")}</p>
      <button className="primary-action" onClick={account!.onBack}>{t("返回我的空间", "Back to my space", "Volver a mi espacio")}</button>
    </> : <>
      <p className="pairing-lead">{account ? t("接受后就能一起使用“我们俩”，你们各自的私人对话仍然保密。", "Accept to open your shared chat. Each person’s private conversations stay private.", "Acepta para abrir el chat compartido. Las conversaciones privadas de cada persona seguirán siendo privadas.")
        : t("创建账号或登录，就能加入你们两个人在 Ourever 的共同空间。", "Create an account or sign in to join your partner in your private Ourever space.", "Crea una cuenta o inicia sesión para unirte a tu pareja en su espacio privado de Ourever.")}</p>
      {account && (!hasInvite() || !valid || unusable || code !== inviteCode()) && <label className="editorial-field code-field"><span>{copy[language].inviteCode}</span>
        <KeyboardInput value={code} onChange={event => { setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)); setError(""); }} maxLength={8} autoComplete="off" data-testid="invite-code" />
      </label>}
      {loading && <p role="status" aria-live="polite">{t("正在查看邀请…", "Checking invitation…", "Comprobando la invitación…")}</p>}
      {(problem || error || preview === "unavailable") && <p className="form-notice" role="alert">{error || problem || inviteNetworkMessage(language)}</p>}
      {preview === "unavailable" && <button className="primary-action" onClick={retry}>{retryLabel(language)}</button>}
      {account ? <>
        {preview !== "unavailable" && !unusable && <button className="primary-action" onClick={() => void accept()} disabled={joining || loading || !valid} data-testid="invite-accept">
          {joining ? t("正在加入…", "Joining…", "Uniéndote…") : copy[language].acceptInvite}
        </button>}
        <button className="secondary-action" disabled={joining} onClick={() => { keyboard.hide(); account.onBack(); }}>{t("返回我的空间", "Back to my space", "Volver a mi espacio")}</button>
      </> : <>
        <button className="primary-action" onClick={() => onAuth?.("register")} data-testid="invite-join">{copy[language].register}</button>
        <button className="secondary-action" onClick={() => onAuth?.("login")} data-testid="invite-sign-in">{copy[language].login}</button>
      </>}
    </>}
  </InviteFrame>;
}

function DesktopBrandHeader({ language, onLanguage, onLogin }: { language: Language; onLanguage: (language: Language) => void; onLogin: () => void }) { return <header className="desktop-brand-header"><Wordmark language={language} /><nav aria-label={localized(language, "主导航", "Main navigation", "Navegación principal")}><a href="#how-it-works">{localized(language, "如何工作", "How it works", "Cómo funciona")}</a><button onClick={() => location.assign("/demo")}>{localized(language, "两人快速体验", "Try it together", "Probar juntos")}</button></nav><div className="desktop-header-actions"><LanguageSwitch language={language} onLanguage={onLanguage} compact /><button className="desktop-login" onClick={onLogin}>{localized(language, "登录", "Sign in", "Iniciar sesión")}<ArrowRight size={17} /></button></div></header>; }
function LanguageSwitch({ language, onLanguage, compact = false }: { language: Language; onLanguage: (language: Language) => void; compact?: boolean }) { return <div className={`language-switch ${compact ? "compact" : ""}`} role="group" aria-label={localized(language, "选择界面语言", "Choose display language", "Elegir idioma de la interfaz")}>{languages.map((item, index) => <span key={item}>{index > 0 && <i>/</i>}<button type="button" className={language === item ? "active" : ""} onClick={() => onLanguage(item)} aria-pressed={language === item}>{item.toUpperCase()}</button></span>)}</div>; }
function Wordmark({ language }: { language: Language }) { return <div className="home-wordmark" aria-label={brandLabel(language)}><strong>Ourever</strong>{language === "zh" && <span>两个人的关系助手</span>}</div>; }
function PauseMark() { return <div className="pause-mark" aria-hidden="true"><i /><i /><i /></div>; }
function SplitButton({ label, onClick, disabled, testId }: { label: string; onClick: () => void; disabled?: boolean; testId?: string }) { return <button className="split-cta" type="button" onClick={onClick} disabled={disabled} data-testid={testId}><img src="/assets/brand/split-cta-background-tight.png" alt="" aria-hidden="true" draggable={false} /><span>{label}</span><i><ArrowRight size={25} /></i></button>; }
// After sign-in the App opens on the conversation; invite links and deep links into a feature page keep their target.
function landing(pairing: Pairing | null): Screen { const params = new URLSearchParams(location.search); return hasInvite() ? "pairing" : params.get("view") === "feedback" ? "feedback" : params.get("view") === "space" ? "space" : params.get("view") === "import" ? "import" : params.get("view") === "people" ? "people" : params.get("view") === "capabilities" ? "capabilities" : ["membership", "referrals"].includes(params.get("view") || "") ? "privacy" : params.has("view") ? pairing?.status === "active" ? "dashboard" : "personal" : "conversation"; }
function accountLanding(user: User, pairing: Pairing | null): Screen {
  const screen = landing(pairing);
  return screen === "conversation" && !user.aiConsentAt && pairing?.status !== "active" ? "invite-first" : screen;
}

// Keep only the current tab's explicit join intent across authentication and password recovery.
const inviteIntentKey = "ourever.partner-invite";
function linkedInvite(): string | null {
  const params = new URLSearchParams(location.search);
  if (params.has("invite")) return (params.get("invite") || "").toUpperCase();
  try { return sessionStorage.getItem(inviteIntentKey); } catch { return null; }
}
function hasInvite() { return linkedInvite() !== null; }
function inviteCode() { const code = linkedInvite() || ""; return /^[A-Z0-9]{8}$/.test(code) ? code : ""; }
function rememberInvite() { try { sessionStorage.setItem(inviteIntentKey, inviteCode()); } catch { /* URL remains available */ } }
function forgetInvite() { try { sessionStorage.removeItem(inviteIntentKey); } catch { /* storage unavailable */ } }
// The server words account errors in Chinese; English and Spanish screens show their own words instead.
const ACCOUNT_ERRORS: Record<string, [en: string, es: string]> = {
  "请输入有效邮箱。": ["Enter a valid email address.", "Introduce un correo electrónico válido."],
  "密码需要 10–128 个字符。": ["Passwords need 10 to 128 characters.", "La contraseña necesita entre 10 y 128 caracteres."],
  "这个邮箱已经注册。": ["This email is already registered. Sign in instead.", "Este correo ya está registrado. Inicia sesión."],
  "尝试次数过多，请稍后再试。": ["Too many attempts. Try again later.", "Demasiados intentos. Inténtalo más tarde."],
  "邮箱或密码不正确。": ["The email or password is not correct.", "El correo o la contraseña no son correctos."],
  "请先登录。": ["Sign in first.", "Inicia sesión primero."],
  "当前账号已经属于一个共同空间。": ["This account already belongs to a shared space.", "Esta cuenta ya pertenece a un espacio compartido."],
  "邀请无效、已过期，或当前账号已经绑定伴侣。": ["This invite is not valid or has expired, or this account is already linked to a partner.", "La invitación no es válida o ha caducado, o esta cuenta ya está vinculada a una pareja."],
};
function accountError(message: string, language: Language) { const known = ACCOUNT_ERRORS[message]; return known ? localized(language, message, known[0], known[1]) : inInterfaceLanguage(message, language); }
async function api<T>(path: string, options: RequestInit = {}): Promise<T> { const response = await fetch(path, { ...options, credentials: "same-origin", headers: { ...(options.body && typeof options.body === "string" ? { "content-type": "application/json" } : {}), ...options.headers } }); const payload = response.status === 204 ? {} : await response.json().catch(() => ({})); if (!response.ok) throw Object.assign(new Error(apiErrorText(payload, response.status, currentLanguage())), { code: payload.code, status: response.status }); return payload; }
