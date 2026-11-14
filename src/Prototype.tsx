import { ArrowLeft, ArrowRight } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { KeyboardInput, MobileScroll, useKeyboard } from "./mobile";
import DemoFlow from "./DemoFlow";
import { PersonalHome } from "./features/private-agent/PersonalHome";
import { SettingsPage } from "./features/privacy/SettingsPage";
import { AiConsentScreen, LegalLinks, OfflineBanner, aiDisclosure } from "./features/privacy/AiConsent";
import { BETA_KEY, listenAppleTransactions } from "./features/membership/MembershipPage";
import { FeedbackPage } from "./features/feedback/FeedbackPage";
import { PasswordResetForm } from "./features/privacy/PasswordReset";
import { AccountRecovery } from "./features/privacy/AccountRecovery";
import { RelationshipHome } from "./features/relationship-home/RelationshipHome";
import { ConversationHome, PageHeader } from "./features/conversation/ConversationHome";
import { SpacePage } from "./features/spaces/SpacePage";
import { PeoplePage } from "./features/people/PeoplePage";
import { ImportsPage } from "./features/imports/ImportsPage";
import { CapabilitiesPage } from "./features/capabilities/CapabilitiesPage";
import { disableNativePush, enableNativePush, listenNativePushTaps, restoreNativePush } from "./features/reminders/nativePush";
import { connectHomeWidget, disconnectHomeWidget } from "./features/widget/homeWidget";
import { disableWebPush, registerAppWorker, restoreWebPush } from "./features/reminders/webPush";
import { InstallHint } from "./features/reminders/InstallHint";
import { brandLabel, inInterfaceLanguage, initialLanguage, isLanguage, languageTag, languages, localized, pageTitle, type Language } from "./i18n";
import { autoSyncAlbum } from "./features/moments/photoAlbum";
import "./relationship.css";
import "./controls.css";

type Screen = "booting" | "home" | "invite" | "conversation" | "space" | "import" | "people" | "capabilities" | "personal" | "privacy" | "feedback" | "recovery" | "auth" | "pairing" | "dashboard";
type User = { id: string; email: string; name: string; createdAt: string; aiConsentAt?: string | null };
type PairMember = { id: string; name: string; role: "A" | "B"; joinedAt: string };
type Pairing = { id: string; status: "pending" | "active"; role: "A" | "B"; members: PairMember[]; invitation: { code: string; createdAt: string; expiresAt: string; openedAt: string | null } | null };
type InvitePreview = { inviterName: string; status: "open" | "expired" | "used" };

const copy = {
  zh: {
    homeLine: "不知道怎么回 TA，先问问 Pinky。", start: "开始", homeFooter: "看懂 · 回应 · 靠近", back: "返回",
    welcome: "欢迎回来", authHint: "它属于你们两个人，但任何一方都不能单独控制它。", email: "邮箱", password: "密码",
    displayName: "你的称呼", login: "登录", register: "创建账号", switchRegister: "还没有账号？创建一个",
    switchLogin: "已有账号？返回登录", passwordHint: "至少 10 个字符", invitePartner: "邀请伴侣", inviteHint: "一起建立你们的共同空间。",
    createInvite: "生成伴侣邀请", copyInvite: "复制邀请链接", copied: "已复制", waitingPartner: "等待对方加入",
    waitingHint: "对方用自己的账号接受后，共同空间才会打开。", acceptInvite: "接受邀请",
    inviteCode: "八位邀请码", logout: "退出登录",
    joinPartner: "加入伴侣", joinHint: "TA 邀请你一起用 Pinky。接受后，你们俩共同的对话“我们俩”就会打开。",
  },
  en: {
    homeLine: "Not sure how to reply to them? Ask Pinky first.", start: "Begin", homeFooter: "Understand · Reply · Get closer", back: "Back",
    welcome: "Welcome back", authHint: "It belongs to both of you, but neither person controls it alone.", email: "Email", password: "Password",
    displayName: "Your name", login: "Sign in", register: "Create account", switchRegister: "New here? Create an account",
    switchLogin: "Already registered? Sign in", passwordHint: "At least 10 characters", invitePartner: "Invite your partner", inviteHint: "Build your shared space together.",
    createInvite: "Create partner invite", copyInvite: "Copy invite link", copied: "Copied", waitingPartner: "Waiting for your partner",
    waitingHint: "They must accept with their own account before mediation and reviews are shared.", acceptInvite: "Accept invite",
    inviteCode: "Eight-character code", logout: "Sign out",
    joinPartner: "Join your partner", joinHint: "Your partner invited you to Pinky. Accept to open Us, the conversation the two of you share.",
  },
  es: {
    homeLine: "¿No sabes qué responderle? Pregúntale a Pinky.", start: "Comenzar", homeFooter: "Entender · Responder · Acercarse", back: "Volver",
    welcome: "Bienvenido de nuevo", authHint: "Les pertenece a ambos, pero ninguno lo controla por sí solo.", email: "Correo electrónico", password: "Contraseña",
    displayName: "Tu nombre", login: "Iniciar sesión", register: "Crear cuenta", switchRegister: "¿Eres nuevo? Crea una cuenta",
    switchLogin: "¿Ya tienes cuenta? Inicia sesión", passwordHint: "Al menos 10 caracteres", invitePartner: "Invita a tu pareja", inviteHint: "Construyan juntos su espacio compartido.",
    createInvite: "Crear invitación", copyInvite: "Copiar enlace", copied: "Copiado", waitingPartner: "Esperando a tu pareja",
    waitingHint: "Debe aceptar con su propia cuenta antes de compartir mediaciones y revisiones.", acceptInvite: "Aceptar invitación",
    inviteCode: "Código de ocho caracteres", logout: "Cerrar sesión",
    joinPartner: "Únete a tu pareja", joinHint: "Tu pareja te invitó a Pinky. Acepta para abrir Nosotros, la conversación que comparten.",
  },
};

export default function Prototype() {
  return <><OfflineBanner />{location.pathname.startsWith("/demo") || location.pathname.startsWith("/j/") ? <DemoFlow /> : <AccountPrototype />}</>;
}

function AccountPrototype() {
  // A partner opening an invite link on a new device sees it in their phone's language, not the default Chinese.
  const [language, setLanguage] = useState<Language>(() => { try { if (!isLanguage(localStorage.getItem("toward-us.language")) && inviteCode()) { const tag = navigator.language.toLowerCase(); return tag.startsWith("zh") ? "zh" : tag.startsWith("es") ? "es" : "en"; } } catch { /* private mode */ } return initialLanguage(); });
  // Until the server says who this is, show only the plain paper background (founder 11-08: opening Pinky flashed the
  // signed-out landing page, then an empty chat, before the real conversation).
  const [screen, setScreen] = useState<Screen>("booting");
  // A password-reset link opens straight into the reset form; the token leaves the address bar at once.
  const [feedbackFrom, setFeedbackFrom] = useState("conversation");
  // Settings can open straight on one page, such as the couple's character from the welcome tour.
  const [settingsPage, setSettingsPage] = useState<"character" | "profile" | "membership" | undefined>(() => { const params = new URLSearchParams(location.search); const beta = params.get("beta"); if (beta) { try { localStorage.setItem(BETA_KEY, beta.trim().toUpperCase().slice(0, 20)); } catch { /* private mode */ } } return params.get("view") === "membership" ? "membership" : undefined; });
  const [resetToken, setResetToken] = useState(() => { const token = new URLSearchParams(window.location.search).get("reset") || ""; if (token) window.history.replaceState(null, "", window.location.pathname); return token; });
  const [user, setUser] = useState<User | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  // From the invite landing page, "I already have an account" opens sign-in instead of sign-up.
  const [authMode, setAuthMode] = useState<"login" | "register" | undefined>();
  const keyboard = useKeyboard();
  const t = copy[language];

  useEffect(() => { localStorage.setItem("toward-us.language", language); document.documentElement.lang = languageTag(language); document.title = pageTitle(language); }, [language]);
  useEffect(() => {
    api<{ user: User | null; pairing: Pairing | null }>("/api/auth/me").then((state) => {
      setUser(state.user); setPairing(state.pairing);
      // Signed out with a partner's invite link: the page that says who invited them comes first, not the generic home.
      setScreen(state.user ? landing(state.pairing) : inviteCode() ? "invite" : "home");
      if (state.user) { void restoreNativePush(); void restoreWebPush(); void connectHomeWidget(); if (state.pairing?.status === "active" && state.user.aiConsentAt) autoSyncAlbum(language); }
    }).catch(() => setScreen("home"));
    listenNativePushTaps();
    listenAppleTransactions();
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

  const selectLanguage = (value: Language) => setLanguage(value);
  const acceptAuth = async (state: { user: User; pairing: Pairing | null }) => {
    const next = new URLSearchParams(location.search).get("next");
    if (next && /^\/m\/[a-z0-9]{12}$/.test(next)) { location.assign(next); return; }
    setUser(state.user); setPairing(state.pairing); setNotice("");
    // Arriving from a partner's invite link, signing up or in is the "join" tap: they land in the shared space without typing
    // the code. If joining fails (expired, already paired), the code screen shows why, with the code filled in.
    const code = inviteCode();
    if (code && state.pairing?.status !== "active" && state.pairing?.invitation?.code !== code) {
      try {
        await api("/api/partner/accept", { method: "POST", body: JSON.stringify({ code }) });
        history.replaceState({}, "", `${location.pathname}?channel=us`);
        const joined = await api<{ user: User; pairing: Pairing | null }>("/api/auth/me");
        setUser(joined.user); setPairing(joined.pairing); setScreen("conversation");
      } catch (error) { setNotice(accountError((error as Error).message, language)); setScreen("pairing"); }
    } else setScreen(landing(state.pairing));
    // Signing in is the user action that may ask, once, for App notification permission (a no-op in a browser).
    void enableNativePush();
    // Inside the iPhone App, the home-screen widget gets its own read-only token (a no-op in a browser).
    void connectHomeWidget();
  };
  const refreshPairing = async () => {
    const state = await api<{ user: User; pairing: Pairing | null }>("/api/auth/me");
    setPairing(state.pairing); if (state.pairing?.status === "active") setScreen("conversation");
  };
  const logout = async () => { keyboard.hide(); await disableNativePush(); await disableWebPush(); await disconnectHomeWidget(); await api("/api/auth/logout", { method: "POST" }); setUser(null); setPairing(null); setScreen("home"); };

  const reloadIdentity = async () => { const state = await api<{ user: User | null; pairing: Pairing | null }>("/api/auth/me"); setUser(state.user); setPairing(state.pairing); setScreen(state.user ? landing(state.pairing) : "home"); };
  const fullScreen: Screen = pairing?.status === "active" ? "dashboard" : "personal";
  // The screen a page link opens on.
  const screenFor = (url: string): Screen => url.includes("game=") ? "conversation" : url.includes("view=space") ? "space" : url.includes("view=import") ? "import" : url.includes("view=people") ? "people" : url.includes("view=capabilities") ? "capabilities" : fullScreen;
  const backToConversation = () => { keyboard.hide(); window.history.replaceState(null, "", location.pathname); setScreen("conversation"); };
  // Pages hand a starting sentence back to the conversation, in the channel the page belongs to.
  const askPinky = (text: string, channel: "me" | "us") => { keyboard.hide(); window.history.replaceState(null, "", `/?channel=${channel}&say=${encodeURIComponent(text)}`); setScreen("conversation"); };
  // No AI work for anyone who hasn't agreed to third-party AI yet: they see the consent screen first (accounts made before
  // sign-up asked for it). Declining signs them out; Settings can withdraw it later, which brings this screen back.
  if (user && !user.aiConsentAt && !["booting", "home", "auth", "recovery"].includes(screen)) return <AiConsentScreen language={language} onAgreed={(at) => setUser({ ...user, aiConsentAt: at })} onDecline={() => void logout()} />;
  if (screen === "conversation" && user) return <><InstallHint language={language} userId={user.id} /><ConversationHome user={user} pairing={pairing} language={language} onPrivacy={(page) => { setSettingsPage(page); setScreen("privacy"); }} onFeedback={(from) => { setFeedbackFrom(from); setScreen("feedback"); }} onLogout={logout} onOpen={(url) => { window.history.replaceState(null, "", url); setScreen(screenFor(url)); }} onPair={() => setScreen("pairing")} onRefreshPairing={refreshPairing} onAccessChanged={reloadIdentity} /></>;
  if (screen === "import" && user) return <ImportsPage key={location.search} id={new URLSearchParams(location.search).get("import") || ""} user={{ id: user.id, name: user.name }} paired={pairing?.status === "active"} language={language} onBack={backToConversation} onOpen={(url) => { window.history.replaceState(null, "", url); setScreen("import"); }} onAsk={askPinky} />;
  if (screen === "people" && user) return <PeoplePage key={location.search} language={language} initialPerson={new URLSearchParams(location.search).get("person") || ""} archived={new URLSearchParams(location.search).get("archived") === "1"} onBack={new URLSearchParams(location.search).get("archived") === "1" ? () => { window.history.replaceState(null, "", location.pathname); setScreen("privacy"); } : backToConversation} onAsk={askPinky} onChat={(personId) => { keyboard.hide(); window.history.replaceState(null, "", `/?channel=me&person=${encodeURIComponent(personId)}`); setScreen("conversation"); }} />;
  if (screen === "space" && user) return <SpacePage key={location.search} id={new URLSearchParams(location.search).get("space") || ""} language={language} onBack={backToConversation} onAsk={askPinky} />;
  if (screen === "booting" && !resetToken) return <div className="loading-screen" aria-busy="true" data-testid="booting" />;
  if (resetToken) return <MobileScroll className="paper-screen recovery-screen"><main className="recovery-content"><PasswordResetForm language={language} token={resetToken} onDone={() => { setResetToken(""); setNotice(localized(language, "密码已更新，请用新密码登录。", "Password updated. Sign in with your new password.", "Contraseña actualizada. Inicia sesión con la nueva.")); setScreen("auth"); }} /></main></MobileScroll>;
  if (screen === "recovery") return <MobileScroll className="paper-screen recovery-screen"><main className="recovery-content"><AccountRecovery language={language} onBack={() => setScreen("auth")} onRecovered={() => { setNotice(localized(language, "密码已更新，请重新登录并生成新的恢复码。", "Password updated. Sign in and generate a new recovery code.", "Contraseña actualizada. Inicia sesión y genera un nuevo código de recuperación.")); setScreen("auth"); }} /></main></MobileScroll>;
  if (screen === "personal" && user) return <PersonalHome user={user} relationshipId={pairing?.status === "active" ? pairing.id : null} language={language} onShared={() => setScreen("dashboard")} onBack={backToConversation} onAsk={askPinky} />;
  if (screen === "capabilities" && user) return <CapabilitiesPage language={language} paired={pairing?.status === "active"} onBack={backToConversation} onAsk={askPinky} onOpen={(url) => { window.history.replaceState(null, "", url); setScreen(screenFor(url)); }} onProfile={() => { setSettingsPage("profile"); setScreen("privacy"); }} />;
  if (screen === "feedback" && user) return <FeedbackPage language={language} from={feedbackFrom} onBack={backToConversation} />;
  if (screen === "privacy" && user) return <SettingsPage initialPage={settingsPage} onAsk={(text) => askPinky(text, "me")} onEarlierPeople={() => { window.history.replaceState(null, "", "/?view=people&archived=1"); setScreen("people"); }} user={user}relationshipId={pairing?.status === "active" ? pairing.id : null} partnerName={pairing?.status === "active" ? pairing.members.find((member) => member.id !== user.id)?.name || null : null} language={language} onLanguage={selectLanguage} onBack={backToConversation} onLogout={logout} onLeft={reloadIdentity} onDeleted={reloadIdentity} onAiConsent={(at) => setUser({ ...user, aiConsentAt: at })} />;
  if (screen === "invite") return <InviteLanding code={inviteCode()} language={language} onLanguage={selectLanguage} onJoin={() => { setAuthMode("register"); setScreen("auth"); }} onSignIn={() => { setAuthMode("login"); setScreen("auth"); }} />;
  if (screen === "home") return <HomeScreen language={language} onLanguage={selectLanguage} onStart={() => setScreen(user ? landing(pairing) : "auth")} t={t} />;
  if (screen === "auth") return <AuthScreen key={authMode} initialMode={authMode} language={language} onLanguage={selectLanguage} onBack={() => setScreen(inviteCode() ? "invite" : "home")} onAuth={acceptAuth} onRecover={() => setScreen("recovery")} notice={notice} setNotice={setNotice} busy={busy} setBusy={setBusy} t={t} />;
  if (screen === "pairing" && user) return <PairingScreen pairing={pairing} language={language} onLanguage={selectLanguage} onRefresh={refreshPairing} onBack={() => setScreen("conversation")} notice={notice} setNotice={setNotice} busy={busy} setBusy={setBusy} t={t} />;
  if (screen === "dashboard" && user && pairing) return <RelationshipHome user={{ id: user.id, name: user.name }} language={language} onNotice={setNotice} onAccessChanged={reloadIdentity} onBack={backToConversation} onAsk={askPinky} />;
  return <div className="loading-screen"><Wordmark language={language} /><p>{localized(language, "正在进入共同空间…", "Opening your shared space…", "Abriendo su espacio compartido…")}</p></div>;
}

function HomeScreen({ language, onLanguage, onStart, t }: { language: Language; onLanguage: (language: Language) => void; onStart: () => void; t: typeof copy.zh }) {
  return <div className="home-screen" data-testid="home-screen">
    <div className="mobile-home-composition">
      <img className="home-art" src="/assets/brand/editorial-columns-background.png" alt="" aria-hidden="true" draggable={false} />
      <LanguageSwitch language={language} onLanguage={onLanguage} />
      <div className={`home-statement ${language === "zh" ? "chinese" : "english"}`}><h1>{t.homeLine}</h1><PauseMark /></div>
      <Wordmark language={language} />
      <div className="home-actions"><SplitButton label={t.start} onClick={onStart} testId="start-button" /><p>{t.homeFooter}</p></div>
    </div>
    <div className="desktop-home-composition" data-testid="desktop-home">
      <DesktopBrandHeader language={language} onLanguage={onLanguage} onLogin={onStart} />
      <div className="desktop-color-field desktop-color-field-red" aria-hidden="true" />
      <div className="desktop-color-field desktop-color-field-blue" aria-hidden="true" />
      <main className="desktop-home-hero">
        <p className="desktop-kicker">{localized(language, "拉钩，说好就算数", "A PINKY PROMISE FOR TWO", "UNA PROMESA DE MEÑIQUE PARA DOS")}</p>
        <h1>{t.homeLine}</h1>
        <PauseMark />
        <p className="desktop-home-support">{localized(language, "把 TA 的话或聊天截图发给 Pinky，它帮你看懂 TA 的意思，写一句你可以直接发的回复。一个人就能用；想两个人一起用时，再邀请 TA。", "Send Pinky what they said, or a screenshot of the chat. It helps you read what they mean and writes a reply you can send as is. It works on your own; invite your partner when you want to use it together.", "Envía a Pinky lo que te dijo, o una captura del chat. Te ayuda a entender lo que quiere decir y escribe una respuesta que puedes enviar tal cual. Funciona a solas; invita a tu pareja cuando quieran usarlo juntos.")}</p>
        <div className="desktop-home-actions">
          <button className="desktop-primary-cta" onClick={onStart}>{localized(language, "开始", "Get started", "Comenzar")}<ArrowRight size={24} /></button>
          <button className="desktop-secondary-cta" onClick={() => location.assign("/demo")}>{localized(language, "两个人当面试一次（不用注册）", "Try it together in person (no sign-up)", "Pruébenlo juntos en persona (sin registro)")}</button>
        </div>
      </main>
      <footer className="desktop-home-footer" id="how-it-works"><span>{localized(language, "看懂 TA 的话", "Read what they mean", "Entender lo que quiere decir")}</span><i /><span>{localized(language, "写一句能发的回复", "Get a reply you can send", "Una respuesta lista para enviar")}</span><i /><span>{localized(language, "两个人说好就算数", "It counts once you both agree", "Cuenta cuando los dos aceptan")}</span></footer>
    </div>
  </div>;
}

function AuthScreen({ initialMode, language, onLanguage, onBack, onAuth, onRecover, notice, setNotice, busy, setBusy, t }: {
  initialMode?: "login" | "register"; language: Language; onLanguage: (language: Language) => void; onBack: () => void; onRecover: () => void; onAuth: (state: { user: User; pairing: Pairing | null }) => Promise<void>;
  notice: string; setNotice: (value: string) => void; busy: boolean; setBusy: (value: boolean) => void; t: typeof copy.zh;
}) {
  // Someone arriving from an invite link is almost always new: they start on sign-up, with sign-in one tap away.
  const [mode, setMode] = useState<"login" | "register">(() => initialMode || (new URLSearchParams(location.search).has("invite") ? "register" : "login"));
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const keyboard = useKeyboard();
  const submit = async () => {
    keyboard.hide(); setBusy(true); setNotice("");
    // Creating an account right under the AI disclosure is the explicit consent to third-party AI (recorded by the server).
    try { await onAuth(await api(mode === "login" ? "/api/auth/login" : "/api/auth/register", { method: "POST", body: JSON.stringify(mode === "login" ? { name, email, password } : { name, email, password, aiConsent: true }) })); }
    catch (error) { setNotice(accountError((error as Error).message, language)); } finally { setBusy(false); }
  };
  return <MobileScroll className="paper-screen auth-screen" data-testid="auth-screen">
    <header className="editorial-top"><button onClick={onBack} aria-label={t.back}><ArrowLeft size={22} /></button><LanguageSwitch language={language} onLanguage={onLanguage} compact /></header>
    <div className="auth-art red-column" aria-hidden="true" />
    <main className="auth-content"><div className="vertical-title"><h1>{mode === "login" ? t.welcome : t.register}</h1><PauseMark /></div><Wordmark language={language} />
      <p className="auth-hint">{t.authHint}</p>
      {mode === "register" && <label className="editorial-field"><span>{t.displayName}</span><KeyboardInput value={name} onChange={(event) => setName(event.target.value)} maxLength={24} data-testid="register-name" /></label>}
      <label className="editorial-field"><span>{t.email}</span><KeyboardInput type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" data-testid="auth-email" /></label>
      <label className="editorial-field"><span>{t.password}</span><KeyboardInput type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} data-testid="auth-password" /><small>{t.passwordHint}</small></label>
      {notice && <p className="form-notice" role="alert">{notice}</p>}
      {mode === "register" && <p className="auth-consent" data-testid="register-consent">{aiDisclosure(language)} {localized(language, "点“创建账号”即表示你同意这一点，以及", "By tapping Create account you agree to this and to the", "Al tocar Crear cuenta aceptas esto y la")} <LegalLinks language={language} />{localized(language, "。", ".", ".")}</p>}
      <SplitButton label={mode === "login" ? t.login : t.register} onClick={submit} disabled={busy || !email || password.length < 10 || (mode === "register" && !name.trim())} testId="auth-submit" />
      <button className="auth-switch" type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setNotice(""); }}>{mode === "login" ? t.switchRegister : t.switchLogin}</button>
      {mode === "login" && <button className="auth-switch" type="button" onClick={onRecover}>{localized(language, "使用恢复码找回账号", "Recover with a recovery code", "Recuperar con un código")}</button>}
    </main>
  </MobileScroll>;
}

function PairingScreen({ pairing, language, onLanguage, onRefresh, onBack, notice, setNotice, busy, setBusy, t }: {
  pairing: Pairing | null; language: Language; onLanguage: (language: Language) => void; onRefresh: () => Promise<void>; onBack: () => void;
  notice: string; setNotice: (value: string) => void; busy: boolean; setBusy: (value: boolean) => void; t: typeof copy.zh;
}) {
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get("invite")?.toUpperCase() || "");
  // Opened from a partner's link: name who sent it.
  const [inviter, setInviter] = useState("");
  useEffect(() => { const linked = inviteCode(); if (linked) api<{ invitation: InvitePreview }>(`/api/partner/invitations/${linked}`).then((result) => setInviter(result.invitation.inviterName)).catch(() => {}); }, []);
  const keyboard = useKeyboard();
  // Joining stays available after making an invite; the server reconciles the two pending spaces.
  const accept = async () => { keyboard.hide(); setBusy(true); setNotice(""); try { await api("/api/partner/accept", { method: "POST", body: JSON.stringify({ code }) }); history.replaceState({}, "", `${location.pathname}?channel=us`); await onRefresh(); } catch (error) { setNotice(accountError((error as Error).message, language)); } finally { setBusy(false); } };
  return <MobileScroll className="paper-screen pairing-screen" data-testid="pairing-screen"><header className="simple-header"><span /><span>{brandLabel(language)}</span><LanguageSwitch language={language} onLanguage={onLanguage} compact /></header>
    <div className="pairing-columns" aria-hidden="true"><i /><i /></div><main className="pairing-content"><div className="vertical-title"><h1>{t.joinPartner}</h1><PauseMark /></div>
      <p className="pairing-lead">{inviter ? localized(language, `${inviter} 邀请你一起用 Pinky。接受后，你们俩共同的对话“我们俩”就会打开。`, `${inviter} invited you to Pinky. Accept to open Us, the conversation the two of you share.`, `${inviter} te invitó a Pinky. Acepta para abrir Nosotros, la conversación que comparten.`) : t.joinHint}</p>
      <label className="editorial-field code-field"><span>{t.inviteCode}</span><KeyboardInput value={code} onChange={(event) => { setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)); setNotice(""); }} maxLength={8} autoComplete="off" data-testid="invite-code" /></label>
      <div className="pairing-actions"><button className="primary-action" onClick={accept} disabled={busy || code.length !== 8 || code === pairing?.invitation?.code}>{t.acceptInvite}</button>
        <button className="secondary-action" disabled={busy} onClick={() => { keyboard.hide(); onBack(); }}>{localized(language, "先使用我的私人空间", "Use my private space first", "Usar primero mi espacio privado")}</button></div>
      {notice && <p className="form-notice" role="alert">{notice}</p>}
    </main></MobileScroll>;
}

/** Where a partner's invite link lands when signed out: who invited them, what Pinky is for the two of them in three lines,
 * then sign-up (or sign-in) that joins the shared space in the same flow, without typing the code. A link that no longer
 * works says so; signing up still works, and the code screen afterwards lets them try another code or go on alone. */
function InviteLanding({ code, language, onLanguage, onJoin, onSignIn }: { code: string; language: Language; onLanguage: (language: Language) => void; onJoin: () => void; onSignIn: () => void }) {
  const [preview, setPreview] = useState<InvitePreview | "missing" | null>(null);
  useEffect(() => { api<{ invitation: InvitePreview }>(`/api/partner/invitations/${code}`).then((result) => setPreview(result.invitation)).catch(() => setPreview("missing")); }, [code]);
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const found = preview && preview !== "missing" ? preview : null;
  const name = found?.inviterName || "";
  const usable = found?.status === "open";
  const problem = preview === "missing" ? t("找不到这个邀请。请让对方在 Pinky 里再发一次。", "This invite could not be found. Ask them to send it again from Pinky.", "No se encontró esta invitación. Pide que te la envíen de nuevo desde Pinky.")
    : found?.status === "expired" ? t(`这个邀请已经过期了。请让${name || "对方"}在 Pinky 里再发一次。`, `This invite has expired. Ask ${name || "them"} to send it again from Pinky.`, `Esta invitación caducó. Pide a ${name || "tu pareja"} que la envíe de nuevo desde Pinky.`)
    : found?.status === "used" ? t("这个邀请已经用过了。已经加入的话，直接登录就好。", "This invite has already been used. If you joined, just sign in.", "Esta invitación ya se usó. Si ya te uniste, solo inicia sesión.") : "";
  return <MobileScroll className="paper-screen pairing-screen invite-landing" data-testid="invite-landing"><header className="simple-header"><span /><span>{brandLabel(language)}</span><LanguageSwitch language={language} onLanguage={onLanguage} compact /></header>
    <div className="pairing-columns" aria-hidden="true"><i /><i /></div><main className="pairing-content">
      <div className="vertical-title"><h1 data-testid="invite-landing-title">{name ? t(`${name} 邀请你一起用 Pinky`, `${name} invited you to Pinky`, `${name} te invitó a Pinky`) : t("有人邀请你一起用 Pinky", "You're invited to Pinky", "Te invitaron a Pinky")}</h1><PauseMark /></div>
      <ul className="invite-landing-points">
        <li>{t("Pinky 帮你们两个人好好说话：不知道怎么回对方的时候，先问问它。", "Pinky helps the two of you talk well: when you're not sure how to reply, ask it first.", "Pinky les ayuda a hablar bien: cuando no sepas qué responder, pregúntale primero.")}</li>
        <li>{t(`你有自己的私人对话，只有你能看到，${name || "对方"}也看不到。`, `You get your own private chat that only you can see, not even ${name || "them"}.`, `Tienes tu propio chat privado que solo tú ves, ni siquiera ${name || "tu pareja"}.`)}</li>
        <li>{t("“我们俩”是你们和 Pinky 的共同对话；两个人都同意的事才算数。", "Us is the chat you two share with Pinky; something counts only once you both agree.", "Nosotros es el chat que comparten con Pinky; algo cuenta solo cuando los dos están de acuerdo.")}</li>
      </ul>
      {problem && <p className="form-notice" role="alert">{problem}</p>}
      <div className="pairing-actions"><button className="primary-action" disabled={preview === null} onClick={onJoin} data-testid="invite-join">{usable ? t("创建账号并加入", "Create an account and join", "Crear una cuenta y unirme") : t("创建账号", "Create an account", "Crear una cuenta")}</button>
        <button className="secondary-action" disabled={preview === null} onClick={onSignIn} data-testid="invite-sign-in">{usable ? t("我已有账号，登录并加入", "I have an account: sign in and join", "Ya tengo cuenta: entrar y unirme") : t("我已有账号，登录", "I have an account: sign in", "Ya tengo cuenta: iniciar sesión")}</button></div>
    </main></MobileScroll>;
}

function DesktopBrandHeader({ language, onLanguage, onLogin }: { language: Language; onLanguage: (language: Language) => void; onLogin: () => void }) { return <header className="desktop-brand-header"><Wordmark language={language} /><nav aria-label={localized(language, "主导航", "Main navigation", "Navegación principal")}><a href="#how-it-works">{localized(language, "如何工作", "How it works", "Cómo funciona")}</a><button onClick={() => location.assign("/demo")}>{localized(language, "两人快速体验", "Try it together", "Probar juntos")}</button></nav><div className="desktop-header-actions"><LanguageSwitch language={language} onLanguage={onLanguage} compact /><button className="desktop-login" onClick={onLogin}>{localized(language, "登录", "Sign in", "Iniciar sesión")}<ArrowRight size={17} /></button></div></header>; }
function LanguageSwitch({ language, onLanguage, compact = false }: { language: Language; onLanguage: (language: Language) => void; compact?: boolean }) { return <div className={`language-switch ${compact ? "compact" : ""}`} role="group" aria-label={localized(language, "选择界面语言", "Choose display language", "Elegir idioma de la interfaz")}>{languages.map((item, index) => <span key={item}>{index > 0 && <i>/</i>}<button type="button" className={language === item ? "active" : ""} onClick={() => onLanguage(item)} aria-pressed={language === item}>{item.toUpperCase()}</button></span>)}</div>; }
function Wordmark({ language }: { language: Language }) { return <div className="home-wordmark" aria-label={brandLabel(language)}><strong>P I N K Y</strong>{language === "zh" && <span>拉钩，说好就算数</span>}</div>; }
function PauseMark() { return <div className="pause-mark" aria-hidden="true"><i /><i /><i /></div>; }
function SplitButton({ label, onClick, disabled, testId }: { label: string; onClick: () => void; disabled?: boolean; testId?: string }) { return <button className="split-cta" type="button" onClick={onClick} disabled={disabled} data-testid={testId}><img src="/assets/brand/split-cta-background-tight.png" alt="" aria-hidden="true" draggable={false} /><span>{label}</span><i><ArrowRight size={25} /></i></button>; }
// After sign-in the App opens on the conversation; invite links and deep links into a feature page keep their target.
function landing(pairing: Pairing | null): Screen { const params = new URLSearchParams(location.search); return params.has("invite") && pairing?.status !== "active" ? "pairing" : params.get("view") === "space" ? "space" : params.get("view") === "import" ? "import" : params.get("view") === "people" ? "people" : params.get("view") === "capabilities" ? "capabilities" : params.get("view") === "membership" ? "privacy" : params.has("view") ? pairing?.status === "active" ? "dashboard" : "personal" : "conversation"; }
// The partner invite code in the address (`?invite=ABCD2345`), or "" without one.
function inviteCode() { const code = (new URLSearchParams(location.search).get("invite") || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); return code.length === 8 ? code : ""; }
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
async function api<T>(path: string, options: RequestInit = {}): Promise<T> { const response = await fetch(path, { ...options, credentials: "same-origin", headers: { ...(options.body && typeof options.body === "string" ? { "content-type": "application/json" } : {}), ...options.headers } }); const payload = response.status === 204 ? {} : await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`); return payload; }
