import { ArrowLeft, ArrowRight, Copy, LinkSimple, SignOut } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { KeyboardInput, MobileScroll, useKeyboard } from "./mobile";
import DemoFlow from "./DemoFlow";
import { PersonalHome } from "./features/private-agent/PersonalHome";
import { SettingsPage } from "./features/privacy/SettingsPage";
import { FeedbackPage } from "./features/feedback/FeedbackPage";
import { PasswordResetForm } from "./features/privacy/PasswordReset";
import { AccountRecovery } from "./features/privacy/AccountRecovery";
import { RelationshipHome } from "./features/relationship-home/RelationshipHome";
import { ConversationHome, PageHeader } from "./features/conversation/ConversationHome";
import { SpacePage } from "./features/spaces/SpacePage";
import { ImportsPage } from "./features/imports/ImportsPage";
import { disableNativePush, enableNativePush, listenNativePushTaps, restoreNativePush } from "./features/reminders/nativePush";
import { disableWebPush, registerAppWorker, restoreWebPush } from "./features/reminders/webPush";
import { InstallHint } from "./features/reminders/InstallHint";
import { brandLabel, initialLanguage, languageTag, languages, localized, pageTitle, type Language } from "./i18n";
import "./relationship.css";
import "./controls.css";

type Screen = "home" | "conversation" | "space" | "import" | "personal" | "privacy" | "feedback" | "recovery" | "auth" | "pairing" | "dashboard";
type User = { id: string; email: string; name: string; createdAt: string };
type PairMember = { id: string; name: string; role: "A" | "B"; joinedAt: string };
type Pairing = { id: string; status: "pending" | "active"; role: "A" | "B"; members: PairMember[]; invitation: { code: string; expiresAt: string } | null };

const copy = {
  zh: {
    homeLine: "在争执之外，我们选择彼此。", start: "开始", homeFooter: "暂停 · 倾听 · 修复", back: "返回",
    welcome: "欢迎回来", authHint: "它属于你们两个人，但任何一方都不能单独控制它。", email: "邮箱", password: "密码",
    displayName: "你的称呼", login: "登录", register: "创建账号", switchRegister: "还没有账号？创建一个",
    switchLogin: "已有账号？返回登录", passwordHint: "至少 10 个字符", invitePartner: "邀请伴侣", inviteHint: "一起建立你们的共同空间。",
    createInvite: "生成伴侣邀请", copyInvite: "复制邀请链接", copied: "已复制", waitingPartner: "等待对方加入",
    waitingHint: "邀请已发出。对方用自己的账号接受后，你们才会共享调解与复盘。", acceptInvite: "接受邀请",
    inviteCode: "八位邀请码", logout: "退出登录",
    joinPartner: "加入伴侣", joinHint: "TA 邀请你一起用 Pinky。接受后，你们俩共同的对话“我们俩”就会打开。",
  },
  en: {
    homeLine: "Beyond the argument, we choose each other.", start: "Begin", homeFooter: "Pause · Listen · Repair", back: "Back",
    welcome: "Welcome back", authHint: "It belongs to both of you, but neither person controls it alone.", email: "Email", password: "Password",
    displayName: "Your name", login: "Sign in", register: "Create account", switchRegister: "New here? Create an account",
    switchLogin: "Already registered? Sign in", passwordHint: "At least 10 characters", invitePartner: "Invite your partner", inviteHint: "Build your shared space together.",
    createInvite: "Create partner invite", copyInvite: "Copy invite link", copied: "Copied", waitingPartner: "Waiting for your partner",
    waitingHint: "They must accept with their own account before mediation and reviews are shared.", acceptInvite: "Accept invite",
    inviteCode: "Eight-character code", logout: "Sign out",
    joinPartner: "Join your partner", joinHint: "Your partner invited you to Pinky. Accept to open Us, the conversation the two of you share.",
  },
  es: {
    homeLine: "Más allá de la discusión, nos elegimos.", start: "Comenzar", homeFooter: "Pausar · Escuchar · Reparar", back: "Volver",
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
  return location.pathname.startsWith("/demo") || location.pathname.startsWith("/j/") ? <DemoFlow /> : <AccountPrototype />;
}

function AccountPrototype() {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [screen, setScreen] = useState<Screen>("home");
  // A password-reset link opens straight into the reset form; the token leaves the address bar at once.
  const [feedbackFrom, setFeedbackFrom] = useState("conversation");
  // Settings can open straight on one page, such as the couple's character from the welcome tour.
  const [settingsPage, setSettingsPage] = useState<"character" | undefined>(undefined);
  const [resetToken, setResetToken] = useState(() => { const token = new URLSearchParams(window.location.search).get("reset") || ""; if (token) window.history.replaceState(null, "", window.location.pathname); return token; });
  const [user, setUser] = useState<User | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const keyboard = useKeyboard();
  const t = copy[language];

  useEffect(() => { localStorage.setItem("toward-us.language", language); document.documentElement.lang = languageTag(language); document.title = pageTitle(language); }, [language]);
  useEffect(() => {
    api<{ user: User | null; pairing: Pairing | null }>("/api/auth/me").then((state) => {
      setUser(state.user); setPairing(state.pairing);
      if (state.user) { setScreen(landing(state.pairing)); void restoreNativePush(); void restoreWebPush(); }
    }).catch(() => {});
    listenNativePushTaps();
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

  const selectLanguage = (value: Language) => setLanguage(value);
  const acceptAuth = (state: { user: User; pairing: Pairing | null }) => {
    const next = new URLSearchParams(location.search).get("next");
    if (next && /^\/m\/[a-z0-9]{12}$/.test(next)) { location.assign(next); return; }
    setUser(state.user); setPairing(state.pairing); setNotice(""); setScreen(landing(state.pairing));
    // Signing in is the user action that may ask, once, for App notification permission (a no-op in a browser).
    void enableNativePush();
  };
  const refreshPairing = async () => {
    const state = await api<{ user: User; pairing: Pairing | null }>("/api/auth/me");
    setPairing(state.pairing); if (state.pairing?.status === "active") setScreen("conversation");
  };
  const logout = async () => { keyboard.hide(); await disableNativePush(); await disableWebPush(); await api("/api/auth/logout", { method: "POST" }); setUser(null); setPairing(null); setScreen("home"); };

  const reloadIdentity = async () => { const state = await api<{ user: User | null; pairing: Pairing | null }>("/api/auth/me"); setUser(state.user); setPairing(state.pairing); setScreen(state.user ? landing(state.pairing) : "home"); };
  const fullScreen: Screen = pairing?.status === "active" ? "dashboard" : "personal";
  const backToConversation = () => { keyboard.hide(); window.history.replaceState(null, "", location.pathname); setScreen("conversation"); };
  // Pages hand a starting sentence back to the conversation, in the channel the page belongs to.
  const askPinky = (text: string, channel: "me" | "us") => { keyboard.hide(); window.history.replaceState(null, "", `/?channel=${channel}&say=${encodeURIComponent(text)}`); setScreen("conversation"); };
  if (screen === "conversation" && user) return <><InstallHint language={language} userId={user.id} /><ConversationHome user={user} pairing={pairing} language={language} onPrivacy={(page) => { setSettingsPage(page); setScreen("privacy"); }} onFeedback={(from) => { setFeedbackFrom(from); setScreen("feedback"); }} onLogout={logout} onOpen={(url) => { window.history.replaceState(null, "", url); setScreen(url.includes("view=space") ? "space" : url.includes("view=import") ? "import" : fullScreen); }} onPair={() => setScreen("pairing")} onRefreshPairing={refreshPairing} onAccessChanged={reloadIdentity} /></>;
  if (screen === "import" && user) return <ImportsPage key={location.search} id={new URLSearchParams(location.search).get("import") || ""} user={{ id: user.id, name: user.name }} paired={pairing?.status === "active"} language={language} onBack={backToConversation} onOpen={(url) => { window.history.replaceState(null, "", url); setScreen("import"); }} onAsk={askPinky} />;
  if (screen === "space" && user) return <SpacePage key={location.search} id={new URLSearchParams(location.search).get("space") || ""} language={language} onBack={backToConversation} onAsk={askPinky} />;
  if (resetToken) return <MobileScroll className="paper-screen recovery-screen"><main className="recovery-content"><PasswordResetForm language={language} token={resetToken} onDone={() => { setResetToken(""); setNotice(localized(language, "密码已更新，请用新密码登录。", "Password updated. Sign in with your new password.", "Contraseña actualizada. Inicia sesión con la nueva.")); setScreen("auth"); }} /></main></MobileScroll>;
  if (screen === "recovery") return <MobileScroll className="paper-screen recovery-screen"><main className="recovery-content"><AccountRecovery language={language} onBack={() => setScreen("auth")} onRecovered={() => { setNotice(localized(language, "密码已更新，请重新登录并生成新的恢复码。", "Password updated. Sign in and generate a new recovery code.", "Contraseña actualizada. Inicia sesión y genera un nuevo código de recuperación.")); setScreen("auth"); }} /></main></MobileScroll>;
  if (screen === "personal" && user) return <PersonalHome user={user} relationshipId={pairing?.status === "active" ? pairing.id : null} language={language} onShared={() => setScreen("dashboard")} onBack={backToConversation} onAsk={askPinky} />;
  if (screen === "feedback" && user) return <FeedbackPage language={language} from={feedbackFrom} onBack={backToConversation} />;
  if (screen === "privacy" && user) return <SettingsPage initialPage={settingsPage} user={user}relationshipId={pairing?.status === "active" ? pairing.id : null} partnerName={pairing?.status === "active" ? pairing.members.find((member) => member.id !== user.id)?.name || null : null} language={language} onLanguage={selectLanguage} onBack={backToConversation} onLogout={logout} onLeft={reloadIdentity} onDeleted={reloadIdentity} />;
  if (screen === "home") return <HomeScreen language={language} onLanguage={selectLanguage} onStart={() => setScreen(user ? landing(pairing) : "auth")} t={t} />;
  if (screen === "auth") return <AuthScreen language={language} onLanguage={selectLanguage} onBack={() => setScreen("home")} onAuth={acceptAuth} onRecover={() => setScreen("recovery")} notice={notice} setNotice={setNotice} busy={busy} setBusy={setBusy} t={t} />;
  if (screen === "pairing" && user) return <PairingScreen user={user} pairing={pairing} language={language} onLanguage={selectLanguage} onRefresh={refreshPairing} onBack={() => setScreen("conversation")} onLogout={logout} notice={notice} setNotice={setNotice} busy={busy} setBusy={setBusy} t={t} />;
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
        <p className="desktop-home-support">{localized(language, "属于两个人的共同关系 Agent。帮助你们一起沟通、决定、计划、记住，并把说过的话真正做到。", "A shared relationship agent for two people. It helps you communicate, decide, plan, remember, and follow through together.", "Un agente de relación compartido para dos personas. Les ayuda a comunicarse, decidir, planear, recordar y cumplir juntos.")}</p>
        <div className="desktop-home-actions">
          <button className="desktop-primary-cta" onClick={() => location.assign("/demo")}>{localized(language, "开始一次对话", "Start a conversation", "Iniciar una conversación")}<ArrowRight size={24} /></button>
          <button className="desktop-secondary-cta" onClick={onStart}>{localized(language, "登录共同空间", "Enter your shared space", "Entrar al espacio compartido")}</button>
        </div>
      </main>
      <footer className="desktop-home-footer" id="how-it-works"><span>{localized(language, "一起沟通", "Communicate", "Comunicarse")}</span><i /><span>{localized(language, "一起决定与计划", "Decide & plan", "Decidir y planear")}</span><i /><span>{localized(language, "共同履行与复盘", "Follow through & review", "Cumplir y revisar")}</span></footer>
    </div>
  </div>;
}

function AuthScreen({ language, onLanguage, onBack, onAuth, onRecover, notice, setNotice, busy, setBusy, t }: {
  language: Language; onLanguage: (language: Language) => void; onBack: () => void; onRecover: () => void; onAuth: (state: { user: User; pairing: Pairing | null }) => void;
  notice: string; setNotice: (value: string) => void; busy: boolean; setBusy: (value: boolean) => void; t: typeof copy.zh;
}) {
  // Someone arriving from an invite link is almost always new: they start on sign-up, with sign-in one tap away.
  const [mode, setMode] = useState<"login" | "register">(() => new URLSearchParams(location.search).has("invite") ? "register" : "login");
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const keyboard = useKeyboard();
  const submit = async () => {
    keyboard.hide(); setBusy(true); setNotice("");
    try { onAuth(await api(mode === "login" ? "/api/auth/login" : "/api/auth/register", { method: "POST", body: JSON.stringify({ name, email, password }) })); }
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
      <SplitButton label={mode === "login" ? t.login : t.register} onClick={submit} disabled={busy || !email || password.length < 10 || (mode === "register" && !name.trim())} testId="auth-submit" />
      <button className="auth-switch" type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setNotice(""); }}>{mode === "login" ? t.switchRegister : t.switchLogin}</button>
      {mode === "login" && <button className="auth-switch" type="button" onClick={onRecover}>{localized(language, "使用恢复码找回账号", "Recover with a recovery code", "Recuperar con un código")}</button>}
    </main>
  </MobileScroll>;
}

function PairingScreen({ user, pairing, language, onLanguage, onRefresh, onBack, onLogout, notice, setNotice, busy, setBusy, t }: {
  user: User; pairing: Pairing | null; language: Language; onLanguage: (language: Language) => void; onRefresh: () => Promise<void>; onBack: () => void; onLogout: () => void;
  notice: string; setNotice: (value: string) => void; busy: boolean; setBusy: (value: boolean) => void; t: typeof copy.zh;
}) {
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get("invite")?.toUpperCase() || "");
  const [copied, setCopied] = useState(false); const keyboard = useKeyboard();
  // Opened from a partner's invite link: accepting is the one thing to do, even for someone who already made an invite of
  // their own (accepting ends their solo space on the server).
  const [invited] = useState(() => pairing?.status !== "active" && code.length === 8 && code !== pairing?.invitation?.code);
  const createInvite = async () => { setBusy(true); setNotice(""); try { await api("/api/partner/invitations", { method: "POST" }); await onRefresh(); } catch (error) { setNotice(accountError((error as Error).message, language)); } finally { setBusy(false); } };
  // Joining is about the two of them: the conversation opens on Us (the channel is read once, then leaves the URL).
  const accept = async () => { keyboard.hide(); setBusy(true); setNotice(""); try { await api("/api/partner/accept", { method: "POST", body: JSON.stringify({ code }) }); history.replaceState({}, "", `${location.pathname}?channel=us`); await onRefresh(); } catch (error) { setNotice(accountError((error as Error).message, language)); } finally { setBusy(false); } };
  const inviteUrl = pairing?.invitation ? `${location.origin}${location.pathname}?invite=${pairing.invitation.code}` : "";
  const copyInvite = async () => { await navigator.clipboard.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return <MobileScroll className="paper-screen pairing-screen" data-testid="pairing-screen"><header className="simple-header"><button onClick={onLogout} aria-label={t.logout}><SignOut size={20} /></button><span>{brandLabel(language)}</span><LanguageSwitch language={language} onLanguage={onLanguage} compact /></header>
    <div className="pairing-columns" aria-hidden="true"><i /><i /></div><main className="pairing-content"><div className="vertical-title"><h1>{invited ? t.joinPartner : pairing ? t.waitingPartner : t.invitePartner}</h1><PauseMark /></div>
      <button className="text-action" onClick={onBack}>{localized(language, "先使用我的私人空间", "Use my private space first", "Usar primero mi espacio privado")}</button><p className="pairing-lead">{invited ? t.joinHint : pairing ? t.waitingHint : t.inviteHint}</p>
      {invited || !pairing ? <>{!invited && <><button className="primary-action" onClick={createInvite} disabled={busy}><LinkSimple size={20} />{t.createInvite}</button><div className="join-divider"><span>OR</span></div></>}
        <label className="editorial-field code-field"><span>{t.inviteCode}</span><KeyboardInput value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))} maxLength={8} data-testid="invite-code" /></label><button className={invited ? "primary-action" : "secondary-action"} onClick={accept} disabled={busy || code.length !== 8}>{t.acceptInvite}</button></> :
        <><div className="invite-code-panel"><span>{t.inviteCode}</span><strong>{pairing.invitation?.code}</strong><button onClick={copyInvite}><Copy size={18} />{copied ? t.copied : t.copyInvite}</button></div><div className="waiting-pair"><span>{user.name.slice(0, 1)}</span><i>＋</i><span>?</span></div><button className="secondary-action" onClick={onRefresh}>{localized(language, "检查是否已加入", "Check connection", "Comprobar conexión")}</button></>}
      {notice && <p className="form-notice" role="alert">{notice}</p>}
    </main></MobileScroll>;
}

function DesktopBrandHeader({ language, onLanguage, onLogin }: { language: Language; onLanguage: (language: Language) => void; onLogin: () => void }) { return <header className="desktop-brand-header"><Wordmark language={language} /><nav aria-label={localized(language, "主导航", "Main navigation", "Navegación principal")}><button onClick={() => location.assign("/demo")}>{localized(language, "快速体验", "Quick demo", "Demostración rápida")}</button><a href="#how-it-works">{localized(language, "如何工作", "How it works", "Cómo funciona")}</a><button onClick={onLogin}>{localized(language, "我们的复盘", "Our reviews", "Nuestras revisiones")}</button></nav><div className="desktop-header-actions"><LanguageSwitch language={language} onLanguage={onLanguage} compact /><button className="desktop-login" onClick={onLogin}>{localized(language, "登录", "Sign in", "Iniciar sesión")}<ArrowRight size={17} /></button></div></header>; }
function LanguageSwitch({ language, onLanguage, compact = false }: { language: Language; onLanguage: (language: Language) => void; compact?: boolean }) { return <div className={`language-switch ${compact ? "compact" : ""}`} role="group" aria-label={localized(language, "选择界面语言", "Choose display language", "Elegir idioma de la interfaz")}>{languages.map((item, index) => <span key={item}>{index > 0 && <i>/</i>}<button type="button" className={language === item ? "active" : ""} onClick={() => onLanguage(item)} aria-pressed={language === item}>{item.toUpperCase()}</button></span>)}</div>; }
function Wordmark({ language }: { language: Language }) { return <div className="home-wordmark" aria-label={brandLabel(language)}><strong>P I N K Y</strong>{language === "zh" && <span>拉钩，说好就算数</span>}</div>; }
function PauseMark() { return <div className="pause-mark" aria-hidden="true"><i /><i /><i /></div>; }
function SplitButton({ label, onClick, disabled, testId }: { label: string; onClick: () => void; disabled?: boolean; testId?: string }) { return <button className="split-cta" type="button" onClick={onClick} disabled={disabled} data-testid={testId}><img src="/assets/brand/split-cta-background-tight.png" alt="" aria-hidden="true" draggable={false} /><span>{label}</span><i><ArrowRight size={25} /></i></button>; }
// After sign-in the App opens on the conversation; invite links and deep links into a feature page keep their target.
function landing(pairing: Pairing | null): Screen { const params = new URLSearchParams(location.search); return params.has("invite") && pairing?.status !== "active" ? "pairing" : params.get("view") === "space" ? "space" : params.get("view") === "import" ? "import" : params.has("view") ? pairing?.status === "active" ? "dashboard" : "personal" : "conversation"; }
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
function accountError(message: string, language: Language) { const known = ACCOUNT_ERRORS[message]; return known ? localized(language, message, known[0], known[1]) : message; }
async function api<T>(path: string, options: RequestInit = {}): Promise<T> { const response = await fetch(path, { ...options, credentials: "same-origin", headers: { ...(options.body && typeof options.body === "string" ? { "content-type": "application/json" } : {}), ...options.headers } }); const payload = response.status === 204 ? {} : await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`); return payload; }
