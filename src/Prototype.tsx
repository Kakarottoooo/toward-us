import {
  ArrowLeft, ArrowRight, CheckCircle, ClockCounterClockwise, Copy, DeviceMobile, HandHeart, House,
  LinkSimple, LockKey, Microphone, PaperPlaneRight, SignOut, Sparkle, StopCircle, UserCircle, UsersThree,
  WarningCircle, Waveform,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardInput, KeyboardTextarea, MobileScroll, useKeyboard } from "./mobile";
import DemoFlow from "./DemoFlow";

type Language = "zh" | "en";
type Screen = "home" | "auth" | "pairing" | "dashboard" | "setup" | "room" | "history" | "historyDetail";
type RoomMode = "remote" | "shared";
type Personality = "friend" | "counselor" | "direct";
type User = { id: string; email: string; name: string; createdAt: string };
type PairMember = { id: string; name: string; role: "A" | "B"; joinedAt: string };
type Pairing = { id: string; status: "pending" | "active"; role: "A" | "B"; members: PairMember[]; invitation: { code: string; expiresAt: string } | null };
type Participant = { id: string; name: string; role: "A" | "B"; joinedAt: string };
type Message = { id: string; participantId: string; text: string; source: "text" | "voice"; createdAt: string };
type Feedback = { validation: string; reflection: string; suggestion: string };
type SharedAnalysis = {
  title: string; overview: string; category: string;
  perspectives: Array<{ participantId: string; name: string; view: string }>;
  responsibility: Array<{ side: string; behavior: string; assessment: string }>;
  commonGround: string[]; differences: string[]; nextSteps: string[];
};
type Room = {
  code: string; mode: RoomMode; language: Language; personality: Personality; status: "active" | "archived";
  participants: Participant[]; messages: Message[]; analyzing: boolean; safety: { level: number; message: string };
  sharedAnalysis: SharedAnalysis | null; privateFeedback: Record<string, Feedback> | null;
  analysisMeta: { source: string; model: string; generatedAt: string; notice: string } | null;
  currentParticipantId: string | null; canControlAllSpeakers: boolean;
  confirmation: { confirmedByCurrent: boolean; confirmedCount: number; requiredCount: number; complete: boolean };
  createdAt: string; updatedAt: string; archivedAt: string | null;
};
type RoomSummary = { code: string; mode: RoomMode; status: string; participantCount: number; title: string; updatedAt: string; joined: boolean };
type HistoryItem = { code: string; title: string; category: string; overview: string; archivedAt: string; commonGroundCount: number; differenceCount: number };
type HistoryDetail = HistoryItem & { participants: Participant[]; messages: Message[]; sharedAnalysis: SharedAnalysis; analysisMeta: Room["analysisMeta"] };
type Health = { ok: boolean; aiReady: boolean; model: string; audioPersistence: string; storage: string };

const copy = {
  zh: {
    homeLine: "在争执之外，我们选择彼此。", start: "开始", homeFooter: "暂停 · 倾听 · 修复", back: "返回",
    welcome: "欢迎回来", authHint: "你们共同经历的内容，只属于你们两个人。", email: "邮箱", password: "密码",
    displayName: "你的称呼", login: "登录", register: "创建账号", switchRegister: "还没有账号？创建一个",
    switchLogin: "已有账号？返回登录", passwordHint: "至少 10 个字符", invitePartner: "邀请伴侣", inviteHint: "一起建立你们的共同空间。",
    createInvite: "生成伴侣邀请", copyInvite: "复制邀请链接", copied: "已复制", waitingPartner: "等待对方加入",
    waitingHint: "邀请已发出。对方用自己的账号接受后，你们才会共享调解与复盘。", acceptInvite: "接受邀请",
    inviteCode: "八位邀请码", ownSpace: "共同空间", paired: "已经和伴侣建立连接", startMediation: "开始一次调解",
    activeRooms: "正在进行", noActive: "没有正在进行的调解。", joinRoom: "加入调解", roomCode: "六位房间码",
    history: "我们的复盘", settings: "设置", logout: "退出登录", setupTitle: "今天，怎么坐到一起", remote: "两台设备",
    remoteHint: "各用自己的账号和麦克风。", shared: "同一台设备", sharedHint: "面对面共用一个麦克风。",
    tone: "AI 调解风格", friend: "温和朋友", counselor: "专业咨询师", direct: "直接但尊重", createRoom: "创建房间",
    room: "调解房间", connected: "已连接", waiting: "等待伴侣加入", emptyTitle: "先把发生的事说出来",
    emptyBody: "AI 会保持安静，直到你们主动请它加入；安全边界除外。", textPlaceholder: "说说你看到的事实、感受或需要…",
    send: "发送", aiJoin: "请 AI 加入", aiWorking: "AI 正在分别理解你们…", viewAnalysis: "查看这次调解",
    speakingAs: "现在由谁表达", record: "开始共同录音", stop: "停止并转录", transcribing: "正在转录当前发言人…", speakerSelectedHint: "本次文字和整段录音都会记在已选中的人名下，无需模仿不同声音。",
    audioNote: "不保存原始录音，只保存转录。", voiceUnavailable: "当前浏览器或服务不支持语音，仍可使用文字。",
    privateTitle: "先只对你说", sharedTitle: "共同反馈", private: "给我的话", sharedFeedback: "共同结论", perspective: "双方视角",
    responsibility: "行为与责任", commonGround: "已经形成的共识", differences: "仍然不同的地方", nextSteps: "下一步",
    validation: "先接住你的感受", reflection: "值得独自想一想", suggestion: "现在可以这样做", category: "本次议题",
    returnRoom: "回到对话", modelFallback: "本地复盘框架", modelReady: "AI 调解已连接",
    notVerdict: "这不是输赢裁决，而是一份可以共同修改的第三方视角。", confirmArchive: "确认保存为共同复盘",
    confirmedWaiting: "我已确认，等待伴侣", archived: "双方已确认并归档", confirmHint: "只有双方分别确认后，才会进入共同历史。",
    noHistory: "共同复盘会在双方确认后出现在这里。", agreements: "共同结论", stillDifferent: "仍有分歧", next: "下一步",
    open: "查看", accountBoundary: "每个账号只能访问自己所属共同空间的数据。",
  },
  en: {
    homeLine: "Beyond the argument, we choose each other.", start: "Begin", homeFooter: "Pause · Listen · Repair", back: "Back",
    welcome: "Welcome back", authHint: "What you share belongs only to the two of you.", email: "Email", password: "Password",
    displayName: "Your name", login: "Sign in", register: "Create account", switchRegister: "New here? Create an account",
    switchLogin: "Already registered? Sign in", passwordHint: "At least 10 characters", invitePartner: "Invite your partner", inviteHint: "Build your shared space together.",
    createInvite: "Create partner invite", copyInvite: "Copy invite link", copied: "Copied", waitingPartner: "Waiting for your partner",
    waitingHint: "They must accept with their own account before mediation and reviews are shared.", acceptInvite: "Accept invite",
    inviteCode: "Eight-character code", ownSpace: "Our space", paired: "Your shared space is connected", startMediation: "Start a mediation",
    activeRooms: "In progress", noActive: "No active mediations.", joinRoom: "Join mediation", roomCode: "Six-character room code",
    history: "Our reviews", settings: "Settings", logout: "Sign out", setupTitle: "How will you sit together today?", remote: "Two devices",
    remoteHint: "Each person uses their own account and microphone.", shared: "One device", sharedHint: "Share one microphone in person.",
    tone: "Mediator style", friend: "Warm friend", counselor: "Counselor", direct: "Direct, respectful", createRoom: "Create room",
    room: "Mediation room", connected: "Connected", waiting: "Waiting for partner", emptyTitle: "Start with what happened",
    emptyBody: "AI stays quiet until you invite it in, except when a safety boundary is crossed.", textPlaceholder: "Share facts, feelings, or needs…",
    send: "Send", aiJoin: "Invite AI", aiWorking: "AI is hearing each of you…", viewAnalysis: "View this mediation", speakingAs: "Speaking as",
    record: "Start shared recording", stop: "Stop and transcribe", transcribing: "Transcribing the selected speaker…", speakerSelectedHint: "Text and the whole recording are assigned to the selected person—no voice imitation needed.", audioNote: "Raw audio is not saved; only the transcript remains.",
    voiceUnavailable: "Voice is unavailable here. Text still works.", privateTitle: "First, just for you", sharedTitle: "Shared feedback", private: "For me",
    sharedFeedback: "Shared view", perspective: "Both perspectives", responsibility: "Behavior and responsibility", commonGround: "Common ground",
    differences: "What remains different", nextSteps: "Next steps", validation: "What deserves care", reflection: "Something to reflect on",
    suggestion: "What you can do now", category: "Topic", returnRoom: "Back to conversation", modelFallback: "Local reflection framework",
    modelReady: "AI mediator connected", notVerdict: "This is not a winner/loser verdict. It is a third-party view you can revise together.",
    confirmArchive: "Confirm and save as shared review", confirmedWaiting: "Confirmed — waiting for partner", archived: "Both confirmed and archived",
    confirmHint: "The review enters shared history only after both partners confirm.", noHistory: "Shared reviews appear here after both partners confirm.",
    agreements: "Agreements", stillDifferent: "Differences", next: "Next step", open: "Open", accountBoundary: "Each account can access only its own shared-space data.",
  },
};

export default function Prototype() {
  return location.pathname.startsWith("/demo") || location.pathname.startsWith("/j/") ? <DemoFlow /> : <AccountPrototype />;
}

function AccountPrototype() {
  const [language, setLanguage] = useState<Language>(() => localStorage.getItem("toward-us.language") === "en" ? "en" : "zh");
  const [screen, setScreen] = useState<Screen>("home");
  const [user, setUser] = useState<User | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [activeRooms, setActiveRooms] = useState<RoomSummary[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const keyboard = useKeyboard();
  const t = copy[language];

  useEffect(() => { localStorage.setItem("toward-us.language", language); document.documentElement.lang = language === "zh" ? "zh-CN" : "en"; }, [language]);
  useEffect(() => {
    api<{ user: User | null; pairing: Pairing | null }>("/api/auth/me").then((state) => {
      setUser(state.user); setPairing(state.pairing);
      if (state.user) setScreen(state.pairing?.status === "active" ? "dashboard" : "pairing");
    }).catch(() => {});
    api<Health>("/api/health").then(setHealth).catch(() => setHealth(null));
  }, []);
  useEffect(() => { if (screen === "dashboard" && user) loadActiveRooms(); }, [screen, user]);
  useEffect(() => {
    if (!room || screen !== "room") return;
    let active = true;
    const events = new EventSource(`/api/rooms/${room.code}/events`);
    events.addEventListener("room", (event) => { if (active) setRoom(JSON.parse((event as MessageEvent).data)); });
    events.onerror = () => setNotice(language === "en" ? "Reconnecting…" : "正在重新连接…");
    return () => { active = false; events.close(); };
  }, [room?.code, screen, language]);

  const toggleLanguage = () => setLanguage((value) => value === "zh" ? "en" : "zh");
  const acceptAuth = (state: { user: User; pairing: Pairing | null }) => {
    setUser(state.user); setPairing(state.pairing); setNotice(""); setScreen(state.pairing?.status === "active" ? "dashboard" : "pairing");
  };
  const refreshPairing = async () => {
    const state = await api<{ user: User; pairing: Pairing | null }>("/api/auth/me");
    setPairing(state.pairing); if (state.pairing?.status === "active") setScreen("dashboard");
  };
  const logout = async () => { keyboard.hide(); await api("/api/auth/logout", { method: "POST" }); setUser(null); setPairing(null); setRoom(null); setScreen("home"); };
  const loadActiveRooms = async () => { const result = await api<{ rooms: RoomSummary[] }>("/api/rooms"); setActiveRooms(result.rooms); };
  const openRoom = async (code: string, join = false) => {
    setBusy(true); setNotice("");
    try {
      if (join) await api(`/api/rooms/${code}/join`, { method: "POST" });
      const result = await api<{ room: Room }>(`/api/rooms/${code}`); setRoom(result.room); setLanguage(result.room.language); setScreen("room");
    } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };
  const openHistory = async () => { const result = await api<{ items: HistoryItem[] }>("/api/history"); setHistory(result.items); setScreen("history"); };
  const openHistoryDetail = async (code: string) => {
    const [detailResult, listResult] = await Promise.all([api<{ item: HistoryDetail }>(`/api/history/${code}`), api<{ items: HistoryItem[] }>("/api/history")]);
    setDetail(detailResult.item); setHistory(listResult.items); setScreen("historyDetail");
  };

  if (screen === "home") return <HomeScreen language={language} onLanguage={toggleLanguage} onStart={() => setScreen(user ? pairing?.status === "active" ? "dashboard" : "pairing" : "auth")} t={t} />;
  if (screen === "auth") return <AuthScreen language={language} onLanguage={toggleLanguage} onBack={() => setScreen("home")} onAuth={acceptAuth} notice={notice} setNotice={setNotice} busy={busy} setBusy={setBusy} t={t} />;
  if (screen === "pairing" && user) return <PairingScreen user={user} pairing={pairing} language={language} onLanguage={toggleLanguage} onRefresh={refreshPairing} onLogout={logout} notice={notice} setNotice={setNotice} busy={busy} setBusy={setBusy} t={t} />;
  if (screen === "dashboard" && user && pairing) return <DashboardScreen user={user} pairing={pairing} rooms={activeRooms} language={language} onLanguage={toggleLanguage} onSetup={() => setScreen("setup")} onJoin={openRoom} onHistory={openHistory} onLogout={logout} notice={notice} setNotice={setNotice} busy={busy} t={t} />;
  if (screen === "setup") return <SetupScreen language={language} onBack={() => setScreen("dashboard")} onLanguage={toggleLanguage} onRoom={(next) => { setRoom(next); setScreen("room"); }} notice={notice} setNotice={setNotice} busy={busy} setBusy={setBusy} t={t} />;
  if (screen === "history") return <HistoryScreen items={history} language={language} onBack={() => setScreen("dashboard")} onOpen={openHistoryDetail} t={t} />;
  if (screen === "historyDetail" && detail) return <HistoryDetailScreen detail={detail} language={language} onBack={() => setScreen("history")} t={t} />;
  return <RoomScreen room={room} language={language} health={health} notice={notice} setNotice={setNotice} onHistory={async () => { if (room) await openHistoryDetail(room.code); }} onRoomUpdate={setRoom} onLeave={() => { setRoom(null); setScreen("dashboard"); }} t={t} />;
}

function HomeScreen({ language, onLanguage, onStart, t }: { language: Language; onLanguage: () => void; onStart: () => void; t: typeof copy.zh }) {
  return <div className="home-screen" data-testid="home-screen">
    <div className="mobile-home-composition">
      <img className="home-art" src="/assets/brand/editorial-columns-background.png" alt="" aria-hidden="true" draggable={false} />
      <LanguageSwitch language={language} onLanguage={onLanguage} />
      <div className={`home-statement ${language === "en" ? "english" : "chinese"}`}><h1>{t.homeLine}</h1><PauseMark /></div>
      <Wordmark />
      <div className="home-actions"><SplitButton label={t.start} onClick={onStart} testId="start-button" /><p>{t.homeFooter}</p></div>
    </div>
    <div className="desktop-home-composition" data-testid="desktop-home">
      <DesktopBrandHeader language={language} onLanguage={onLanguage} onLogin={onStart} />
      <div className="desktop-color-field desktop-color-field-red" aria-hidden="true" />
      <div className="desktop-color-field desktop-color-field-blue" aria-hidden="true" />
      <main className="desktop-home-hero">
        <p className="desktop-kicker">TOWARD UNDERSTANDING, TOWARD US</p>
        <h1>{t.homeLine}</h1>
        <PauseMark />
        <p className="desktop-home-support">{language === "zh" ? "不是争输赢，而是把彼此听清楚。" : "Not to win the argument, but to hear each other clearly."}</p>
        <div className="desktop-home-actions">
          <button className="desktop-primary-cta" onClick={() => location.assign("/demo")}>{language === "zh" ? "开始一次对话" : "Start a conversation"}<ArrowRight size={24} /></button>
          <button className="desktop-secondary-cta" onClick={onStart}>{language === "zh" ? "登录共同空间" : "Enter your shared space"}</button>
        </div>
      </main>
      <footer className="desktop-home-footer" id="how-it-works"><span>{language === "zh" ? "双人表达" : "Two voices"}</span><i /><span>{language === "zh" ? "私下反馈" : "Private reflection"}</span><i /><span>{language === "zh" ? "共同复盘" : "Shared review"}</span></footer>
    </div>
  </div>;
}

function AuthScreen({ language, onLanguage, onBack, onAuth, notice, setNotice, busy, setBusy, t }: {
  language: Language; onLanguage: () => void; onBack: () => void; onAuth: (state: { user: User; pairing: Pairing | null }) => void;
  notice: string; setNotice: (value: string) => void; busy: boolean; setBusy: (value: boolean) => void; t: typeof copy.zh;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const keyboard = useKeyboard();
  const submit = async () => {
    keyboard.hide(); setBusy(true); setNotice("");
    try { onAuth(await api(mode === "login" ? "/api/auth/login" : "/api/auth/register", { method: "POST", body: JSON.stringify({ name, email, password }) })); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };
  return <MobileScroll className="paper-screen auth-screen" data-testid="auth-screen">
    <header className="editorial-top"><button onClick={onBack} aria-label={t.back}><ArrowLeft size={22} /></button><LanguageSwitch language={language} onLanguage={onLanguage} compact /></header>
    <div className="auth-art red-column" aria-hidden="true" />
    <main className="auth-content"><div className="vertical-title"><h1>{mode === "login" ? t.welcome : t.register}</h1><PauseMark /></div><Wordmark />
      <p className="auth-hint">{t.authHint}</p>
      {mode === "register" && <label className="editorial-field"><span>{t.displayName}</span><KeyboardInput value={name} onChange={(event) => setName(event.target.value)} maxLength={24} data-testid="register-name" /></label>}
      <label className="editorial-field"><span>{t.email}</span><KeyboardInput type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" data-testid="auth-email" /></label>
      <label className="editorial-field"><span>{t.password}</span><KeyboardInput type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} data-testid="auth-password" /><small>{t.passwordHint}</small></label>
      {notice && <p className="form-notice" role="alert">{notice}</p>}
      <SplitButton label={mode === "login" ? t.login : t.register} onClick={submit} disabled={busy || !email || password.length < 10 || (mode === "register" && !name.trim())} testId="auth-submit" />
      <button className="auth-switch" type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setNotice(""); }}>{mode === "login" ? t.switchRegister : t.switchLogin}</button>
    </main>
  </MobileScroll>;
}

function PairingScreen({ user, pairing, language, onLanguage, onRefresh, onLogout, notice, setNotice, busy, setBusy, t }: {
  user: User; pairing: Pairing | null; language: Language; onLanguage: () => void; onRefresh: () => Promise<void>; onLogout: () => void;
  notice: string; setNotice: (value: string) => void; busy: boolean; setBusy: (value: boolean) => void; t: typeof copy.zh;
}) {
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get("invite")?.toUpperCase() || "");
  const [copied, setCopied] = useState(false); const keyboard = useKeyboard();
  const createInvite = async () => { setBusy(true); setNotice(""); try { await api("/api/partner/invitations", { method: "POST" }); await onRefresh(); } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); } };
  const accept = async () => { keyboard.hide(); setBusy(true); setNotice(""); try { await api("/api/partner/accept", { method: "POST", body: JSON.stringify({ code }) }); history.replaceState({}, "", location.pathname); await onRefresh(); } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); } };
  const inviteUrl = pairing?.invitation ? `${location.origin}${location.pathname}?invite=${pairing.invitation.code}` : "";
  const copyInvite = async () => { await navigator.clipboard.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return <MobileScroll className="paper-screen pairing-screen" data-testid="pairing-screen"><header className="simple-header"><button onClick={onLogout} aria-label={t.logout}><SignOut size={20} /></button><span>Toward Us / 彼此</span><button className="compact-language" onClick={onLanguage}>{language === "zh" ? "EN" : "中"}</button></header>
    <div className="pairing-columns" aria-hidden="true"><i /><i /></div><main className="pairing-content"><div className="vertical-title"><h1>{pairing ? t.waitingPartner : t.invitePartner}</h1><PauseMark /></div>
      <p className="pairing-lead">{pairing ? t.waitingHint : t.inviteHint}</p>
      {!pairing ? <><button className="primary-action" onClick={createInvite} disabled={busy}><LinkSimple size={20} />{t.createInvite}</button><div className="join-divider"><span>OR</span></div>
        <label className="editorial-field code-field"><span>{t.inviteCode}</span><KeyboardInput value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))} maxLength={8} data-testid="invite-code" /></label><button className="secondary-action" onClick={accept} disabled={busy || code.length !== 8}>{t.acceptInvite}</button></> :
        <><div className="invite-code-panel"><span>{t.inviteCode}</span><strong>{pairing.invitation?.code}</strong><button onClick={copyInvite}><Copy size={18} />{copied ? t.copied : t.copyInvite}</button></div><div className="waiting-pair"><span>{user.name.slice(0, 1)}</span><i>＋</i><span>?</span></div><button className="secondary-action" onClick={onRefresh}>{language === "zh" ? "检查是否已加入" : "Check connection"}</button></>}
      {notice && <p className="form-notice" role="alert">{notice}</p>}
    </main></MobileScroll>;
}

function DashboardScreen({ user, pairing, rooms, language, onLanguage, onSetup, onJoin, onHistory, onLogout, notice, setNotice, busy, t }: {
  user: User; pairing: Pairing; rooms: RoomSummary[]; language: Language; onLanguage: () => void; onSetup: () => void; onJoin: (code: string, join: boolean) => void;
  onHistory: () => void; onLogout: () => void; notice: string; setNotice: (value: string) => void; busy: boolean; t: typeof copy.zh;
}) {
  const [code, setCode] = useState(""); const partner = pairing.members.find((member) => member.id !== user.id);
  return <div className="paper-screen dashboard-screen" data-testid="dashboard-screen"><header className="dashboard-header"><Wordmark /><LanguageSwitch language={language} onLanguage={onLanguage} compact /></header>
    <MobileScroll className="dashboard-scroll"><main className="dashboard-content"><section className="shared-space"><p>{t.ownSpace}</p><h1>{user.name}<i>＋</i>{partner?.name}</h1><span>{t.paired}</span><div className="paired-circles"><b>{user.name.slice(0, 1)}</b><i>＋</i><b>{partner?.name.slice(0, 1)}</b></div></section>
      <SplitButton label={t.startMediation} onClick={onSetup} />
      <section className="join-rail"><label className="editorial-field code-field"><span>{t.joinRoom}</span><KeyboardInput value={code} onChange={(event) => { setNotice(""); setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)); }} placeholder={t.roomCode} maxLength={6} /></label><button onClick={() => onJoin(code, true)} disabled={busy || code.length !== 6} aria-label={t.joinRoom} data-testid="join-active-room"><ArrowRight size={20} /></button></section>
      {notice && <p className="form-notice" role="alert">{notice}</p>}
      <section className="active-list"><header><h2>{t.activeRooms}</h2><span>{rooms.length}</span></header>{!rooms.length ? <p>{t.noActive}</p> : rooms.map((item) => <button key={item.code} onClick={() => onJoin(item.code, !item.joined)}><span>{new Date(item.updatedAt).toLocaleDateString(language === "zh" ? "zh-CN" : "en-US")}</span><strong>{item.title}</strong><i>{item.code}</i><ArrowRight size={18} /></button>)}</section>
      <p className="boundary-note"><LockKey size={15} />{t.accountBoundary}</p>
    </main></MobileScroll><BottomNav current="home" onHome={() => {}} onHistory={onHistory} onLogout={onLogout} t={t} /></div>;
}

function SetupScreen({ language, onBack, onLanguage, onRoom, notice, setNotice, busy, setBusy, t }: {
  language: Language; onBack: () => void; onLanguage: () => void; onRoom: (room: Room) => void; notice: string; setNotice: (value: string) => void;
  busy: boolean; setBusy: (value: boolean) => void; t: typeof copy.zh;
}) {
  const [mode, setMode] = useState<RoomMode>("remote"); const [personality, setPersonality] = useState<Personality>("friend"); const keyboard = useKeyboard();
  const createRoom = async () => { keyboard.hide(); setBusy(true); setNotice(""); try { const result = await api<{ room: Room }>("/api/rooms", { method: "POST", body: JSON.stringify({ mode, language, personality }) }); onRoom(result.room); } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); } };
  return <MobileScroll className="paper-screen setup-screen"><header className="simple-header"><button onClick={onBack}><ArrowLeft size={22} /></button><span>Toward Us / 彼此</span><button className="compact-language" onClick={onLanguage}>{language === "zh" ? "EN" : "中"}</button></header><main className="setup-content"><h1>{t.setupTitle}</h1>
    <div className="mode-selector"><button className={mode === "remote" ? "selected" : ""} onClick={() => setMode("remote")}><DeviceMobile size={25} /><strong>{t.remote}</strong><span>{t.remoteHint}</span></button><button className={mode === "shared" ? "selected" : ""} onClick={() => setMode("shared")}><UsersThree size={25} /><strong>{t.shared}</strong><span>{t.sharedHint}</span></button></div>
    <section className="tone-section"><span>{t.tone}</span><div>{(["friend", "counselor", "direct"] as Personality[]).map((option) => <button key={option} className={personality === option ? "selected" : ""} onClick={() => setPersonality(option)}>{option === "friend" ? t.friend : option === "counselor" ? t.counselor : t.direct}</button>)}</div></section>
    {notice && <p className="form-notice">{notice}</p>}<SplitButton label={t.createRoom} onClick={createRoom} disabled={busy} /></main></MobileScroll>;
}

function RoomScreen({ room, language, health, notice, setNotice, onHistory, onRoomUpdate, onLeave, t }: { room: Room | null; language: Language; health: Health | null; notice: string; setNotice: (value: string) => void; onHistory: () => void; onRoomUpdate: (room: Room) => void; onLeave: () => void; t: typeof copy.zh }) {
  const [draft, setDraft] = useState(""); const [speakerId, setSpeakerId] = useState(""); const [copied, setCopied] = useState(false);
  const [recording, setRecording] = useState(false); const [transcribing, setTranscribing] = useState(false); const [seconds, setSeconds] = useState(0);
  const [composerHeight, setComposerHeight] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null); const chunksRef = useRef<Blob[]>([]); const analysisRef = useRef<HTMLElement | null>(null); const composerRef = useRef<HTMLElement | null>(null); const keyboard = useKeyboard();
  useEffect(() => { if (room?.currentParticipantId && !speakerId) setSpeakerId(room.currentParticipantId); }, [room?.currentParticipantId, speakerId]);
  useEffect(() => { if (!recording) return; const id = setInterval(() => setSeconds((value) => value + 1), 1000); return () => clearInterval(id); }, [recording]);
  useEffect(() => { if (room?.analysisMeta) analysisRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [room?.analysisMeta?.generatedAt]);
  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    const updateHeight = () => setComposerHeight(Math.ceil(composer.getBoundingClientRect().height));
    updateHeight();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateHeight);
    observer?.observe(composer);
    window.addEventListener("resize", updateHeight);
    return () => { observer?.disconnect(); window.removeEventListener("resize", updateHeight); };
  }, [room?.code, room?.canControlAllSpeakers]);
  const participantMap = useMemo(() => new Map(room?.participants.map((participant) => [participant.id, participant]) || []), [room?.participants]);
  if (!room) return <div className="loading-screen"><Wordmark /><p>{language === "zh" ? "正在进入共同空间…" : "Opening your shared space…"}</p></div>;
  const send = async () => { if (!draft.trim()) return; const text = draft; setDraft(""); keyboard.hide(); try { await api(`/api/rooms/${room.code}/messages`, { method: "POST", body: JSON.stringify({ text, speakerId }) }); setNotice(""); } catch (error) { setDraft(text); setNotice((error as Error).message); } };
  const analyze = async () => { keyboard.hide(); setNotice(""); try { const result = await api<{ room: Room }>(`/api/rooms/${room.code}/analyze`, { method: "POST" }); onRoomUpdate(result.room); } catch (error) { setNotice((error as Error).message); } };
  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return setNotice(t.voiceUnavailable);
    try { keyboard.hide(); const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((value) => MediaRecorder.isTypeSupported(value)); const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined); chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = async () => { setRecording(false); setTranscribing(true); stream.getTracks().forEach((track) => track.stop()); const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }); chunksRef.current = []; try { const response = await fetch(`/api/rooms/${room.code}/audio`, { method: "POST", headers: { "content-type": blob.type, "x-toward-us-speaker-id": speakerId }, body: blob }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || t.voiceUnavailable); setNotice(""); } catch (error) { setNotice((error as Error).message); } finally { setTranscribing(false); setSeconds(0); } };
      recorderRef.current = recorder; recorder.start(1000); setRecording(true); setSeconds(0); setNotice("");
    } catch { setNotice(t.voiceUnavailable); }
  };
  const copyCode = async () => { await navigator.clipboard.writeText(room.code); setCopied(true); setTimeout(() => setCopied(false), 1400); };
  const measuredComposerHeight = composerHeight || (room.canControlAllSpeakers ? 214 : 142);
  return <div className="room-shell" data-testid="room-screen" style={{ "--message-bottom": `${measuredComposerHeight}px` } as React.CSSProperties}><header className="room-header"><button onClick={onLeave} aria-label={t.back}><ArrowLeft size={20} /></button><div><span>{t.room}</span><strong>{room.code}</strong></div><button onClick={copyCode} aria-label={t.copyInvite}>{copied ? <CheckCircle size={21} weight="fill" /> : <Copy size={21} />}</button></header>
    <div className="room-presence"><div className="participant-pair">{room.participants.map((participant) => <span key={participant.id} className={participant.role === "A" ? "red-person" : "blue-person"}>{participant.name.slice(0, 1)}</span>)}{room.participants.length < 2 && <span className="empty-person">?</span>}</div><p>{room.participants.length < 2 ? t.waiting : t.connected}<i /></p><span className={`ai-status ${health?.aiReady ? "ready" : "fallback"}`}><Sparkle size={13} weight="fill" />{health?.aiReady ? t.modelReady : t.modelFallback}</span></div>
    <MobileScroll className="message-scroll"><main className="message-content">{room.safety.level > 0 && <aside className={`safety-banner level-${room.safety.level}`}><WarningCircle size={22} weight="fill" /><p>{room.safety.message}</p></aside>}
      {!room.messages.length ? <section className="empty-conversation"><HandHeart size={40} /><h2>{t.emptyTitle}</h2><p>{t.emptyBody}</p></section> : room.messages.map((message) => { const participant = participantMap.get(message.participantId); return <article key={message.id} className={`message ${participant?.role === "A" ? "side-a" : "side-b"}`}><header>{participant?.name}{message.source === "voice" && <Waveform size={14} />}</header><p>{message.text}</p></article>; })}
      {(room.analyzing || room.analysisMeta) && <AnalysisScreen analysisRef={analysisRef} room={room} language={language} onHistory={onHistory} onRoomUpdate={onRoomUpdate} setNotice={setNotice} t={t} />}
      <section className="voice-panel"><div className={`record-orbit ${recording ? "recording" : ""}`}><button onClick={recording ? () => recorderRef.current?.stop() : startRecording} disabled={transcribing} aria-label={recording ? t.stop : t.record}>{recording ? <StopCircle size={31} weight="fill" /> : <Microphone size={29} weight="fill" />}</button></div><div><strong>{transcribing ? t.transcribing : recording ? `${t.stop} · ${formatSeconds(seconds)}` : t.record}</strong><p>{t.audioNote}</p></div></section>{notice && <p className="room-notice">{notice}</p>}</main></MobileScroll>
    <footer ref={composerRef} className="composer">{room.canControlAllSpeakers && <div className="speaker-control"><div className="speaker-toggle"><span>{t.speakingAs}</span>{room.participants.map((participant) => <button key={participant.id} type="button" onClick={() => setSpeakerId(participant.id)} disabled={recording || transcribing} aria-pressed={speakerId === participant.id} className={speakerId === participant.id ? `selected ${participant.role === "A" ? "red" : "blue"}` : ""}>{participant.name}</button>)}</div><p className="speaker-selection-note">{t.speakerSelectedHint}</p></div>}<div className="composer-row"><KeyboardTextarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t.textPlaceholder} rows={1} maxLength={1200} /><button className="send-button" onClick={send} disabled={!draft.trim()} aria-label={t.send}><PaperPlaneRight size={21} weight="fill" /></button></div><button className="invite-ai" disabled={room.messages.length < 2 || room.analyzing || room.participants.length < 2} onClick={analyze}><Sparkle size={17} weight="fill" />{room.analyzing ? t.aiWorking : t.aiJoin}</button></footer>
  </div>;
}

function AnalysisScreen({ room, language, analysisRef, onHistory, onRoomUpdate, setNotice, t }: { room: Room; language: Language; analysisRef: React.RefObject<HTMLElement | null>; onHistory: () => void; onRoomUpdate: (room: Room) => void; setNotice: (value: string) => void; t: typeof copy.zh }) {
  const [tab, setTab] = useState<"private" | "shared">("private"); const feedback = room.privateFeedback?.[room.currentParticipantId || ""]; const analysis = room.sharedAnalysis;
  const confirm = async () => { try { const result = await api<{ room: Room }>(`/api/rooms/${room.code}/confirm-archive`, { method: "POST" }); onRoomUpdate(result.room); } catch (error) { setNotice((error as Error).message); } };
  return <section ref={analysisRef} className="demo-inline-analysis formal-inline-analysis" data-testid="room-ai-panel"><header className="inline-analysis-header"><div><Sparkle size={20} weight="fill" /><span>{tab === "private" ? t.privateTitle : t.sharedTitle}</span></div></header><main className="analysis-content"><div className="analysis-tabs"><button className={tab === "private" ? "selected" : ""} onClick={() => setTab("private")}><LockKey size={17} />{t.private}</button><button className={tab === "shared" ? "selected" : ""} onClick={() => setTab("shared")}><UsersThree size={17} />{t.sharedFeedback}</button></div>
    {!analysis ? <section className="analysis-loading"><Sparkle size={34} weight="fill" /><h1>{t.aiWorking}</h1></section> : tab === "private" ? <section>{feedback && <div className="private-letter"><span className="letter-mark">私 / PRIVATE</span><FeedbackBlock number="01" title={t.validation} body={feedback.validation} /><FeedbackBlock number="02" title={t.reflection} body={feedback.reflection} /><FeedbackBlock number="03" title={t.suggestion} body={feedback.suggestion} /></div>}<button className="primary-action" onClick={() => setTab("shared")}>{t.sharedFeedback}<ArrowRight size={20} /></button></section> : <section className="shared-analysis"><SharedAnalysisContent analysis={analysis} t={t} />
      <section className="confirmation-panel"><p><LockKey size={17} />{t.confirmHint}</p><div className="confirmation-progress"><i className={room.confirmation.confirmedCount > 0 ? "done" : ""} /><i className={room.confirmation.confirmedCount > 1 ? "done" : ""} /><span>{room.confirmation.confirmedCount}/{room.confirmation.requiredCount}</span></div>{room.confirmation.complete ? <button className="primary-action" onClick={onHistory}><CheckCircle size={20} weight="fill" />{t.archived}</button> : <button className="primary-action" onClick={confirm} disabled={room.confirmation.confirmedByCurrent}>{room.confirmation.confirmedByCurrent ? t.confirmedWaiting : t.confirmArchive}</button>}</section>
      {room.analysisMeta && <p className="analysis-meta"><Sparkle size={14} />{room.analysisMeta.source === "openai" ? `${room.analysisMeta.model} · ${new Date(room.analysisMeta.generatedAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}` : t.modelFallback}<br />{room.analysisMeta.notice}</p>}</section>}
    </main></section>;
}

function HistoryScreen({ items, language, onBack, onOpen, t }: { items: HistoryItem[]; language: Language; onBack: () => void; onOpen: (code: string) => void; t: typeof copy.zh }) {
  return <div className="paper-screen history-screen"><header className="simple-header"><button onClick={onBack}><ArrowLeft size={22} /></button><span>{t.history}</span><i /></header><MobileScroll className="history-scroll"><main className="history-content"><div className="vertical-title"><h1>{t.history}</h1><PauseMark /></div><div className="history-tabs"><span className="active">{t.agreements}</span><span>{t.stillDifferent}</span></div>{!items.length ? <p className="empty-history">{t.noHistory}</p> : items.map((item) => <button className="history-row" key={item.code} onClick={() => onOpen(item.code)}><time>{new Date(item.archivedAt).toLocaleDateString(language === "zh" ? "zh-CN" : "en-US")}</time><div><strong>{item.title}</strong><p>{item.overview}</p><span>{t.agreements} {item.commonGroundCount} · {t.stillDifferent} {item.differenceCount}</span></div><ArrowRight size={18} /></button>)}</main></MobileScroll></div>;
}

function HistoryDetailScreen({ detail, language, onBack, t }: { detail: HistoryDetail; language: Language; onBack: () => void; t: typeof copy.zh }) {
  return <MobileScroll className="paper-screen history-detail"><header className="simple-header"><button onClick={onBack}><ArrowLeft size={22} /></button><span>{new Date(detail.archivedAt).toLocaleDateString(language === "zh" ? "zh-CN" : "en-US")}</span><i /></header><main className="analysis-content"><SharedAnalysisContent analysis={detail.sharedAnalysis} t={t} /><AnalysisSection title={language === "zh" ? "当时的表达" : "What was said"} index="06"><div className="history-transcript">{detail.messages.map((message) => <p key={message.id}><strong>{detail.participants.find((participant) => participant.id === message.participantId)?.name}</strong>{message.text}</p>)}</div></AnalysisSection></main></MobileScroll>;
}

function SharedAnalysisContent({ analysis, t }: { analysis: SharedAnalysis; t: typeof copy.zh }) { return <><div className="analysis-heading"><p>{t.category} · {analysis.category}</p><h1>{analysis.title}</h1><span>{t.notVerdict}</span></div><p className="analysis-overview">{analysis.overview}</p><AnalysisSection title={t.perspective} index="01"><div className="perspective-grid">{analysis.perspectives.map((item, index) => <article key={item.participantId} className={index ? "blue-edge" : "red-edge"}><strong>{item.name}</strong><p>{item.view}</p></article>)}</div></AnalysisSection><AnalysisSection title={t.responsibility} index="02">{analysis.responsibility.map((item, index) => <div className="responsibility-item" key={`${item.side}-${index}`}><strong>{item.behavior}</strong><p>{item.assessment}</p></div>)}</AnalysisSection><AnalysisSection title={t.commonGround} index="03"><BulletList items={analysis.commonGround} tone="common" /></AnalysisSection><AnalysisSection title={t.differences} index="04"><BulletList items={analysis.differences} tone="different" /></AnalysisSection><AnalysisSection title={t.nextSteps} index="05"><ol className="next-step-list">{analysis.nextSteps.map((item, index) => <li key={item}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></li>)}</ol></AnalysisSection></>; }

function BottomNav({ current, onHome, onHistory, onLogout, t }: { current: "home" | "history"; onHome: () => void; onHistory: () => void; onLogout: () => void; t: typeof copy.zh }) { return <nav className="bottom-nav"><button className={current === "history" ? "" : "active"} onClick={onHome}><House size={21} /><span>{t.ownSpace}</span></button><button className={current === "history" ? "active" : ""} onClick={onHistory}><ClockCounterClockwise size={21} /><span>{t.history}</span></button><button onClick={onLogout}><UserCircle size={21} /><span>{t.settings}</span></button></nav>; }
function DesktopBrandHeader({ language, onLanguage, onLogin }: { language: Language; onLanguage: () => void; onLogin: () => void }) { return <header className="desktop-brand-header"><Wordmark /><nav aria-label={language === "zh" ? "主导航" : "Main navigation"}><button onClick={() => location.assign("/demo")}>{language === "zh" ? "快速体验" : "Quick demo"}</button><a href="#how-it-works">{language === "zh" ? "如何工作" : "How it works"}</a><button onClick={onLogin}>{language === "zh" ? "我们的复盘" : "Our reviews"}</button></nav><div className="desktop-header-actions"><LanguageSwitch language={language} onLanguage={onLanguage} compact /><button className="desktop-login" onClick={onLogin}>{language === "zh" ? "登录" : "Sign in"}<ArrowRight size={17} /></button></div></header>; }
function LanguageSwitch({ language, onLanguage, compact = false }: { language: Language; onLanguage: () => void; compact?: boolean }) { return <button className={`language-switch ${compact ? "compact" : ""}`} onClick={onLanguage}><span className={language === "zh" ? "active" : ""}>中</span><i>/</i><span className={language === "en" ? "active" : ""}>EN</span></button>; }
function Wordmark() { return <div className="home-wordmark" aria-label="Toward Us 彼此"><strong>T O W A R D&nbsp;&nbsp;U S</strong><span>｜彼此｜</span></div>; }
function PauseMark() { return <div className="pause-mark" aria-hidden="true"><i /><i /><i /></div>; }
function SplitButton({ label, onClick, disabled, testId }: { label: string; onClick: () => void; disabled?: boolean; testId?: string }) { return <button className="split-cta" type="button" onClick={onClick} disabled={disabled} data-testid={testId}><img src="/assets/brand/split-cta-background-tight.png" alt="" aria-hidden="true" draggable={false} /><span>{label}</span><i><ArrowRight size={25} /></i></button>; }
function FeedbackBlock({ number, title, body }: { number: string; title: string; body: string }) { return <article className="feedback-block"><span>{number}</span><div><h2>{title}</h2><p>{body}</p></div></article>; }
function AnalysisSection({ title, index, children }: { title: string; index: string; children: React.ReactNode }) { return <section className="analysis-section"><header><span>{index}</span><h2>{title}</h2></header>{children}</section>; }
function BulletList({ items, tone }: { items: string[]; tone: "common" | "different" }) { return <ul className={`bullet-list ${tone}`}>{items.map((item) => <li key={item}>{tone === "common" ? <CheckCircle size={18} weight="fill" /> : <WarningCircle size={18} />}<span>{item}</span></li>)}</ul>; }
async function api<T>(path: string, options: RequestInit = {}): Promise<T> { const response = await fetch(path, { ...options, credentials: "same-origin", headers: { ...(options.body && typeof options.body === "string" ? { "content-type": "application/json" } : {}), ...options.headers } }); const payload = response.status === 204 ? {} : await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`); return payload; }
function formatSeconds(total: number) { return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`; }
