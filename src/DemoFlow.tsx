import {
  ArrowLeft, ArrowRight, CheckCircle, Copy, DeviceMobile, HandHeart, LinkSimple, LockKey,
  Microphone, PaperPlaneRight, QrCode, Sparkle, StopCircle, UsersThree, WarningCircle, Waveform,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardInput, KeyboardTextarea, MobileScroll, useKeyboard, useKeyboardInsets } from "./mobile";
import "./demo.css";

type Language = "zh" | "en";
type DemoStep = "entry" | "join" | "invite" | "consent" | "room" | "analysis";
type RoomMode = "remote" | "shared";
type Participant = { id: string; name: string; role: "A" | "B"; consentAt: string | null; joinedAt: string };
type Message = { id: string; participantId: string; text: string; source: "text" | "voice"; createdAt: string };
type Feedback = { validation: string; reflection: string; suggestion: string };
type SharedAnalysis = {
  title: string; overview: string; category: string;
  perspectives: Array<{ participantId: string; name: string; view: string }>;
  responsibility: Array<{ side: string; behavior: string; assessment: string }>;
  commonGround: string[]; differences: string[]; nextSteps: string[];
};
type DemoRoom = {
  demo: true; code: string; mode: RoomMode; language: Language; personality: string; status: "active" | "converted";
  participants: Participant[]; messages: Message[]; analyzing: boolean; safety: { level: number; message: string };
  sharedAnalysis: SharedAnalysis | null; privateFeedback: Record<string, Feedback> | null;
  analysisMeta: { source: string; model: string; generatedAt: string; notice: string } | null;
  currentParticipantId: string; canControlAllSpeakers: boolean;
  consents: Array<{ participantId: string; consented: boolean }>; allConsented: boolean; joinOpen: boolean;
  joinExpiresAt: string; expiresAt: string; claimCount: number; claimedByCurrent: boolean;
  convertedRoomCode: string | null; conversionAvailable: boolean;
};
type Preview = { code: string; mode: RoomMode; language: Language; participantCount: number; joinExpiresAt: string; joinOpen: boolean };
type Account = { id: string; email: string; name: string };
type Health = { ok: boolean; aiReady: boolean; model: string };

const words = {
  zh: {
    back: "返回", quick: "快速体验", entryTitle: "在争执之外，我们选择彼此。", choose: "选择进入方式",
    shared: "共用一台手机", sharedHint: "一起使用，简单快捷", remote: "各用一台手机", remoteHint: "扫码加入，更私密",
    privacy: "原始录音不保存。临时转录与分析将在一小时后自动删除。", yourName: "你的称呼", partnerName: "对方的称呼",
    create: "创建临时房间", joinTitle: "加入这次体验", joinHint: "输入称呼后，你将作为第二位参与者加入。", join: "加入房间",
    expired: "这个临时房间已满或已经过期。", invite: "邀请你的另一半", inviteHint: "把这封邀请发给 TA，打开链接即可加入；如果就在身边，也可以显示二维码。",
    shareCode: "备用房间码", valid: "15 分钟内有效", sendInvite: "发送邀请", copyLink: "复制链接", showQr: "对方在身边？显示二维码", hideQr: "收起二维码", ready: "我已准备好", connected: "你们已连接",
    consentHint: "开始前，请两个人分别确认录音与转录同意。", consent: "我同意录音与转录", consented: "已同意录音",
    localOnly: "原始音频只用于本次转录，不会保存。", start: "开始表达", room: "临时调解房间", waiting: "等待另一位加入",
    emptyTitle: "先把发生的事说出来", emptyBody: "AI 会保持安静，直到你们主动请它加入；安全边界除外。",
    placeholder: "说说你看到的事实、感受或需要…", speakingAs: "现在由谁表达", record: "开始共同录音", stop: "停止并转录",
    transcribing: "正在区分说话人并转录…", audioNote: "不保存原始录音，只保存一小时内的临时转录。", aiJoin: "请 AI 加入", viewAnalysis: "查看 AI 分析",
    aiWorking: "AI 正在分别理解你们…", private: "先只对你说", sharedFeedback: "共同反馈", validation: "先接住你的感受",
    reflection: "值得独自想一想", suggestion: "现在可以这样做", noVerdict: "这不是输赢裁决，而是一份可以共同修改的第三方视角。",
    common: "已经形成的共识", different: "仍然不同的地方", next: "下一步", saveTitle: "想把这次体验留下来吗？",
    saveHint: "两个人分别登录或创建账号并确认后，这次复盘才会进入你们的共同历史。", login: "登录", register: "创建账号",
    name: "你的称呼", email: "邮箱", password: "密码（至少 10 个字符）", claim: "确认保存我的这一侧", claimed: "我已确认，等待对方",
    saved: "双方已确认，这次体验已经进入共同历史。", goAccount: "进入正式空间", switchRegister: "还没有账号？创建一个",
    switchLogin: "已有账号？返回登录", exit: "退出快速体验", shareText: "我不想和你争输赢，想和你好好把这件事说清楚。点击链接加入我们这次的 Toward Us 对话（15 分钟内有效）。",
  },
  en: {
    back: "Back", quick: "Quick demo", entryTitle: "Beyond the argument, we choose each other.", choose: "Choose how to enter",
    shared: "Share one phone", sharedHint: "Together, simple and quick", remote: "Use two phones", remoteHint: "Scan to join, more private",
    privacy: "Raw audio is never saved. Temporary transcripts and analysis are deleted after one hour.", yourName: "Your name", partnerName: "Partner name",
    create: "Create temporary room", joinTitle: "Join this demo", joinHint: "Enter your name to join as the second participant.", join: "Join room",
    expired: "This temporary room is full or has expired.", invite: "Invite your other half", inviteHint: "Send this invitation so they can join from the link, or show a QR code if you are together.",
    shareCode: "Backup room code", valid: "Valid for 15 minutes", sendInvite: "Send invitation", copyLink: "Copy link", showQr: "Together in person? Show QR", hideQr: "Hide QR", ready: "I’m ready", connected: "You’re connected",
    consentHint: "Before you begin, each person confirms recording and transcription consent.", consent: "I consent to recording and transcription", consented: "Recording consented",
    localOnly: "Raw audio is used only for this transcription and is not stored.", start: "Start expressing", room: "Temporary mediation room", waiting: "Waiting for the other person",
    emptyTitle: "Start with what happened", emptyBody: "AI stays quiet until you invite it in, except when a safety boundary is crossed.",
    placeholder: "Share facts, feelings, or needs…", speakingAs: "Speaking as", record: "Start shared recording", stop: "Stop and transcribe",
    transcribing: "Separating speakers and transcribing…", audioNote: "Raw audio is not saved; temporary transcripts last one hour.", aiJoin: "Invite AI", viewAnalysis: "View AI analysis",
    aiWorking: "AI is hearing each of you…", private: "First, just for you", sharedFeedback: "Shared feedback", validation: "What deserves care",
    reflection: "Something to reflect on", suggestion: "What you can do now", noVerdict: "This is not a winner/loser verdict. It is a third-party view you can revise together.",
    common: "Common ground", different: "What remains different", next: "Next steps", saveTitle: "Keep this experience?",
    saveHint: "It enters shared history only after both people sign in or register and confirm.", login: "Sign in", register: "Create account",
    name: "Your name", email: "Email", password: "Password (10+ characters)", claim: "Confirm and save my side", claimed: "Confirmed — waiting for partner",
    saved: "Both confirmed. This experience is now in your shared history.", goAccount: "Open formal space", switchRegister: "New here? Create an account",
    switchLogin: "Already registered? Sign in", exit: "Exit quick demo", shareText: "I don’t want this to be about winning. I want us to understand each other. Join our Toward Us conversation with this 15-minute invitation.",
  },
};

export default function DemoFlow() {
  const [language, setLanguage] = useState<Language>(() => localStorage.getItem("toward-us.language") === "en" ? "en" : "zh");
  const [step, setStep] = useState<DemoStep>(() => initialRoomCode() ? "join" : "entry");
  const [mode, setMode] = useState<RoomMode>("remote");
  const [nameA, setNameA] = useState(""); const [nameB, setNameB] = useState(""); const [joinName, setJoinName] = useState("");
  const [room, setRoom] = useState<DemoRoom | null>(null); const [preview, setPreview] = useState<Preview | null>(null);
  const [health, setHealth] = useState<Health | null>(null); const [account, setAccount] = useState<Account | null>(null);
  const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false); const [qrUrl, setQrUrl] = useState("");
  const keyboard = useKeyboard();
  const t = words[language];
  const roomCode = room?.code || initialRoomCode();
  const joinUrl = room ? `${location.origin}/j/${room.code}` : "";

  useEffect(() => { localStorage.setItem("toward-us.language", language); }, [language]);
  useEffect(() => { api<Health>("/api/health").then(setHealth).catch(() => {}); api<{ user: Account | null }>("/api/auth/me").then((value) => setAccount(value.user)).catch(() => {}); }, []);
  useEffect(() => {
    const code = initialRoomCode();
    if (!code) return;
    api<{ room: DemoRoom }>(`/api/demo/rooms/${code}`).then(({ room: existing }) => {
      setRoom(existing); setLanguage(existing.language);
      setStep(existing.participants.length < 2 ? "invite" : existing.allConsented ? existing.sharedAnalysis ? "analysis" : "room" : "consent");
    }).catch(() => api<{ room: Preview }>(`/api/demo/rooms/${code}/preview`).then(({ room: next }) => { setPreview(next); setLanguage(next.language); setStep("join"); }).catch((error) => setNotice((error as Error).message)));
  }, []);
  useEffect(() => {
    if (!room?.code) return;
    const events = new EventSource(`/api/demo/rooms/${room.code}/events`);
    events.addEventListener("room", (event) => setRoom(JSON.parse((event as MessageEvent).data)));
    return () => events.close();
  }, [room?.code]);
  useEffect(() => { if (step === "invite" && room && room.participants.length === 2) setStep("consent"); }, [room?.participants.length, step]);
  useEffect(() => {
    if (!joinUrl) return;
    import("qrcode").then(({ default: QRCode }) => QRCode.toDataURL(joinUrl, { width: 560, margin: 2, color: { dark: "#252525", light: "#fbf7ef" } })).then(setQrUrl);
  }, [joinUrl]);

  const toggleLanguage = () => setLanguage((value) => value === "zh" ? "en" : "zh");
  const leave = () => { history.replaceState(null, "", "/"); location.reload(); };
  const create = async () => {
    keyboard.hide(); setBusy(true); setNotice("");
    try {
      const result = await api<{ room: DemoRoom }>("/api/demo/rooms", { method: "POST", body: JSON.stringify({ mode, language, nameA, nameB }) });
      setRoom(result.room); history.replaceState(null, "", `/demo?room=${result.room.code}`); setStep(mode === "remote" ? "invite" : "consent");
    } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };
  const join = async () => {
    keyboard.hide(); setBusy(true); setNotice("");
    try { const result = await api<{ room: DemoRoom }>(`/api/demo/rooms/${roomCode}/join`, { method: "POST", body: JSON.stringify({ name: joinName }) }); setRoom(result.room); setStep("consent"); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };
  const consent = async (participantId: string) => {
    setBusy(true); setNotice("");
    try { const result = await api<{ room: DemoRoom }>(`/api/demo/rooms/${roomCode}/consent`, { method: "POST", body: JSON.stringify({ participantId }) }); setRoom(result.room); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };

  if (step === "entry") return <DemoEntry language={language} mode={mode} nameA={nameA} nameB={nameB} notice={notice} busy={busy} t={t} onLanguage={toggleLanguage} onMode={setMode} onNameA={setNameA} onNameB={setNameB} onCreate={create} onExit={leave} />;
  if (step === "join") return <DemoJoin language={language} preview={preview} name={joinName} notice={notice} busy={busy} t={t} onLanguage={toggleLanguage} onName={setJoinName} onJoin={join} onExit={leave} />;
  if (step === "invite" && room) return <DemoInvite language={language} room={room} qrUrl={qrUrl} joinUrl={joinUrl} t={t} onLanguage={toggleLanguage} onExit={leave} />;
  if (step === "consent" && room) return <DemoConsent language={language} room={room} notice={notice} busy={busy} t={t} onLanguage={toggleLanguage} onConsent={consent} onStart={() => setStep("room")} onExit={leave} />;
  if (step === "analysis" && room) return <DemoAnalysis room={room} account={account} language={language} notice={notice} t={t} onRoom={setRoom} onAccount={setAccount} onNotice={setNotice} onBack={() => setStep("room")} onExit={leave} />;
  return <DemoRoomScreen room={room} health={health} language={language} notice={notice} t={t} onNotice={setNotice} onRoom={setRoom} onAnalyze={() => setStep("analysis")} onExit={leave} />;
}

function DemoEntry(props: { language: Language; mode: RoomMode; nameA: string; nameB: string; notice: string; busy: boolean; t: typeof words.zh; onLanguage: () => void; onMode: (mode: RoomMode) => void; onNameA: (value: string) => void; onNameB: (value: string) => void; onCreate: () => void; onExit: () => void }) {
  const { language, mode, nameA, nameB, notice, busy, t, onLanguage, onMode, onNameA, onNameB, onCreate, onExit } = props;
  return <MobileScroll className="paper-screen demo-screen demo-entry" data-testid="demo-entry"><DemoHeader language={language} onLanguage={onLanguage} onBack={onExit} />
    <div className="demo-red-rail" /><div className="demo-blue-rail" />
    <main className="demo-entry-content"><div className={`demo-vertical-statement ${language === "en" ? "english" : ""}`}><h1>{t.entryTitle}</h1><PauseMark /></div>
      <section className="demo-choice"><h2>{t.choose}</h2><button className={mode === "shared" ? "selected red" : ""} onClick={() => onMode("shared")}><DeviceMobile size={29} /><span><strong>{t.shared}</strong><small>{t.sharedHint}</small></span><ArrowRight size={20} /></button><button className={mode === "remote" ? "selected blue" : ""} onClick={() => onMode("remote")}><UsersThree size={29} /><span><strong>{t.remote}</strong><small>{t.remoteHint}</small></span><ArrowRight size={20} /></button></section>
      <section className="demo-names"><label><span>{t.yourName}</span><KeyboardInput value={nameA} onChange={(event) => onNameA(event.target.value)} maxLength={24} /></label>{mode === "shared" && <label><span>{t.partnerName}</span><KeyboardInput value={nameB} onChange={(event) => onNameB(event.target.value)} maxLength={24} /></label>}</section>
      {notice && <p className="form-notice">{notice}</p>}<SplitButton label={t.create} onClick={onCreate} disabled={busy || !nameA.trim() || (mode === "shared" && !nameB.trim())} />
      <p className="demo-privacy"><LockKey size={16} weight="fill" />{t.privacy}</p>
    </main></MobileScroll>;
}

function DemoJoin({ language, preview, name, notice, busy, t, onLanguage, onName, onJoin, onExit }: { language: Language; preview: Preview | null; name: string; notice: string; busy: boolean; t: typeof words.zh; onLanguage: () => void; onName: (value: string) => void; onJoin: () => void; onExit: () => void }) {
  const unavailable = preview && !preview.joinOpen;
  return <MobileScroll className="paper-screen demo-screen demo-join" data-testid="demo-join"><DemoHeader language={language} onLanguage={onLanguage} onBack={onExit} /><div className="demo-red-corner" /><div className="demo-blue-corner" /><main className="demo-centered"><Wordmark /><h1>{unavailable ? t.expired : t.joinTitle}</h1><PauseMark /><p>{unavailable ? t.privacy : t.joinHint}</p>{!unavailable && <><label className="demo-line-field"><span>{t.yourName}</span><KeyboardInput value={name} onChange={(event) => onName(event.target.value)} maxLength={24} autoFocus /></label>{notice && <p className="form-notice">{notice}</p>}<SplitButton label={t.join} onClick={onJoin} disabled={busy || !name.trim() || !preview?.joinOpen} /></>}</main></MobileScroll>;
}

function DemoInvite({ language, room, qrUrl, joinUrl, t, onLanguage, onExit }: { language: Language; room: DemoRoom; qrUrl: string; joinUrl: string; t: typeof words.zh; onLanguage: () => void; onExit: () => void }) {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(joinUrl); setCopied(true); setTimeout(() => setCopied(false), 1400); };
  const share = async () => {
    if (!navigator.share) return copy();
    try { await navigator.share({ title: "Toward Us / 彼此", text: t.shareText, url: joinUrl }); }
    catch (error) { if ((error as DOMException).name !== "AbortError") await copy(); }
  };
  return <MobileScroll className="paper-screen demo-screen demo-invite" data-testid="demo-invite"><DemoHeader language={language} onLanguage={onLanguage} onBack={onExit} /><div className="demo-red-corner" /><div className="demo-blue-side" /><main className="demo-centered"><Wordmark /><h1>{t.invite}</h1><PauseMark /><p>{t.inviteHint}</p>
    <SplitButton label={t.sendInvite} onClick={share} />
    <div className="demo-invite-secondary"><button onClick={copy}>{copied ? <CheckCircle size={18} weight="fill" /> : <Copy size={18} />}{copied ? (language === "zh" ? "已复制" : "Copied") : t.copyLink}</button><button onClick={() => setShowQr((value) => !value)}><QrCode size={18} />{showQr ? t.hideQr : t.showQr}</button></div>
    {showQr && qrUrl && <div className="demo-qr-panel"><img className="demo-qr" src={qrUrl} alt={`${t.invite} ${room.code}`} /></div>}
    <div className="demo-code"><span>{t.shareCode}</span><strong>{room.code}</strong><small>{t.valid}</small></div><p className="demo-waiting"><i />{t.waiting}</p></main></MobileScroll>;
}

function DemoConsent({ language, room, notice, busy, t, onLanguage, onConsent, onStart, onExit }: { language: Language; room: DemoRoom; notice: string; busy: boolean; t: typeof words.zh; onLanguage: () => void; onConsent: (id: string) => void; onStart: () => void; onExit: () => void }) {
  return <MobileScroll className="paper-screen demo-screen demo-consent" data-testid="demo-consent"><DemoHeader language={language} onLanguage={onLanguage} onBack={onExit} /><div className="demo-red-corner" /><div className="demo-blue-corner right" /><main className="demo-centered"><Wordmark /><h1>{t.connected}</h1><PauseMark /><p>{t.consentHint}</p><div className="demo-consent-pair">{room.participants.map((participant) => { const agreed = room.consents.find((item) => item.participantId === participant.id)?.consented; const canConfirm = room.canControlAllSpeakers || room.currentParticipantId === participant.id; return <article key={participant.id} className={participant.role === "A" ? "red" : "blue"}><div>{participant.name.slice(0, 2)}</div><strong>{participant.name}</strong>{agreed ? <span><CheckCircle size={17} weight="fill" />{t.consented}</span> : <button onClick={() => onConsent(participant.id)} disabled={!canConfirm || busy}>{t.consent}</button>}</article>; })}</div><p className="demo-local-note"><LockKey size={16} />{t.localOnly}</p>{notice && <p className="form-notice">{notice}</p>}<SplitButton label={t.start} onClick={onStart} disabled={!room.allConsented} /></main></MobileScroll>;
}

function DemoRoomScreen({ room, health, language, notice, t, onNotice, onRoom, onAnalyze, onExit }: { room: DemoRoom | null; health: Health | null; language: Language; notice: string; t: typeof words.zh; onNotice: (value: string) => void; onRoom: (room: DemoRoom) => void; onAnalyze: () => void; onExit: () => void }) {
  const [draft, setDraft] = useState(""); const [speakerId, setSpeakerId] = useState(""); const [recording, setRecording] = useState(false); const [transcribing, setTranscribing] = useState(false); const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null); const chunksRef = useRef<Blob[]>([]); const keyboard = useKeyboard(); const { bottomInset } = useKeyboardInsets();
  useEffect(() => { if (room?.currentParticipantId && !speakerId) setSpeakerId(room.currentParticipantId); }, [room?.currentParticipantId, speakerId]);
  useEffect(() => { if (!recording) return; const timer = setInterval(() => setSeconds((value) => value + 1), 1000); return () => clearInterval(timer); }, [recording]);
  const participants = useMemo(() => new Map(room?.participants.map((participant) => [participant.id, participant]) || []), [room?.participants]);
  if (!room) return <div className="loading-screen"><Wordmark /></div>;
  const send = async () => { if (!draft.trim()) return; const text = draft; setDraft(""); keyboard.hide(); try { const result = await api<{ room: DemoRoom }>(`/api/demo/rooms/${room.code}/messages`, { method: "POST", body: JSON.stringify({ text, speakerId }) }); onRoom(result.room); onNotice(""); } catch (error) { setDraft(text); onNotice((error as Error).message); } };
  const analyze = async () => { keyboard.hide(); onNotice(""); try { const result = await api<{ room: DemoRoom }>(`/api/demo/rooms/${room.code}/analyze`, { method: "POST" }); onRoom(result.room); onAnalyze(); } catch (error) { onNotice((error as Error).message); } };
  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return onNotice(language === "zh" ? "当前浏览器不支持语音，请使用文字。" : "Voice is unavailable; please use text.");
    try { keyboard.hide(); const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((value) => MediaRecorder.isTypeSupported(value)); const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined); chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = async () => { setRecording(false); setTranscribing(true); stream.getTracks().forEach((track) => track.stop()); const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }); chunksRef.current = []; try { const response = await fetch(`/api/demo/rooms/${room.code}/audio`, { method: "POST", headers: { "content-type": blob.type }, body: blob }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Transcription failed"); onRoom(payload.room); onNotice(""); } catch (error) { onNotice((error as Error).message); } finally { setTranscribing(false); setSeconds(0); } };
      recorderRef.current = recorder; recorder.start(1000); setRecording(true); setSeconds(0); onNotice("");
    } catch { onNotice(language === "zh" ? "没有获得麦克风权限，仍可使用文字。" : "Microphone permission was not granted. Text still works."); }
  };
  const composerHeight = room.canControlAllSpeakers ? 176 : 142;
  return <div className="room-shell" data-testid="demo-room" style={{ "--message-bottom": `${composerHeight + bottomInset}px` } as React.CSSProperties}><header className="room-header"><button onClick={onExit}><ArrowLeft size={20} /></button><div><span>{t.room}</span><strong>{room.code}</strong></div><span className="demo-expiry">{Math.max(1, Math.ceil((new Date(room.expiresAt).getTime() - Date.now()) / 60000))}m</span></header>
    <div className="room-presence"><div className="participant-pair">{room.participants.map((participant) => <span key={participant.id} className={participant.role === "A" ? "red-person" : "blue-person"}>{participant.name.slice(0, 1)}</span>)}</div><p>{t.connected}<i /></p><span className={`ai-status ${health?.aiReady ? "ready" : "fallback"}`}><Sparkle size={13} weight="fill" />{health?.aiReady ? health.model : "Local"}</span></div>
    <MobileScroll className="message-scroll"><main className="message-content">{room.safety.level > 0 && <aside className={`safety-banner level-${room.safety.level}`}><WarningCircle size={22} weight="fill" /><p>{room.safety.message}</p></aside>}{!room.messages.length ? <section className="empty-conversation"><HandHeart size={40} /><h2>{t.emptyTitle}</h2><p>{t.emptyBody}</p></section> : room.messages.map((message) => { const person = participants.get(message.participantId); return <article key={message.id} className={`message ${person?.role === "A" ? "side-a" : "side-b"}`}><header>{person?.name}{message.source === "voice" && <Waveform size={14} />}</header><p>{message.text}</p></article>; })}
      {room.analysisMeta && <button className="analysis-ready" onClick={onAnalyze}><Sparkle size={20} weight="fill" /><span>{t.viewAnalysis}</span><ArrowRight size={18} /></button>}
      <section className="voice-panel"><div className={`record-orbit ${recording ? "recording" : ""}`}><button onClick={recording ? () => recorderRef.current?.stop() : startRecording} disabled={transcribing}>{recording ? <StopCircle size={31} weight="fill" /> : <Microphone size={29} weight="fill" />}</button></div><div><strong>{transcribing ? t.transcribing : recording ? `${t.stop} · ${formatSeconds(seconds)}` : t.record}</strong><p>{t.audioNote}</p></div></section>{notice && <p className="room-notice">{notice}</p>}</main></MobileScroll>
    <footer className="composer" style={{ bottom: bottomInset }}>{room.canControlAllSpeakers && <div className="speaker-toggle"><span>{t.speakingAs}</span>{room.participants.map((participant) => <button key={participant.id} onClick={() => setSpeakerId(participant.id)} className={speakerId === participant.id ? `selected ${participant.role === "A" ? "red" : "blue"}` : ""}>{participant.name}</button>)}</div>}<div className="composer-row"><KeyboardTextarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t.placeholder} rows={1} maxLength={1200} /><button className="send-button" onClick={send} disabled={!draft.trim()}><PaperPlaneRight size={21} weight="fill" /></button></div><button className="invite-ai" disabled={room.messages.length < 2 || room.analyzing} onClick={analyze}><Sparkle size={17} weight="fill" />{room.analyzing ? t.aiWorking : t.aiJoin}</button></footer>
  </div>;
}

function DemoAnalysis({ room, account, language, notice, t, onRoom, onAccount, onNotice, onBack, onExit }: { room: DemoRoom; account: Account | null; language: Language; notice: string; t: typeof words.zh; onRoom: (room: DemoRoom) => void; onAccount: (account: Account) => void; onNotice: (value: string) => void; onBack: () => void; onExit: () => void }) {
  const [tab, setTab] = useState<"private" | "shared">(room.mode === "shared" ? "shared" : "private"); const [authMode, setAuthMode] = useState<"login" | "register">("register"); const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false);
  const keyboard = useKeyboard();
  const feedback = room.privateFeedback?.[room.currentParticipantId]; const analysis = room.sharedAnalysis;
  const claim = async (knownAccount = account) => { if (!knownAccount) return; setBusy(true); onNotice(""); try { const result = await api<{ room: DemoRoom }>(`/api/demo/rooms/${room.code}/claim`, { method: "POST" }); onRoom(result.room); } catch (error) { onNotice((error as Error).message); } finally { setBusy(false); } };
  const authenticate = async () => { keyboard.hide(); setBusy(true); onNotice(""); try { const result = await api<{ user: Account }>(authMode === "login" ? "/api/auth/login" : "/api/auth/register", { method: "POST", body: JSON.stringify({ name, email, password }) }); onAccount(result.user); const claimed = await api<{ room: DemoRoom }>(`/api/demo/rooms/${room.code}/claim`, { method: "POST" }); onRoom(claimed.room); } catch (error) { onNotice((error as Error).message); } finally { setBusy(false); } };
  return <MobileScroll className="paper-screen analysis-screen demo-analysis" data-testid="demo-analysis"><header className="simple-header"><button onClick={onBack}><ArrowLeft size={22} /></button><span>{tab === "private" ? t.private : t.sharedFeedback}</span><button onClick={onExit}><LinkSimple size={19} /></button></header><main className="analysis-content"><div className="analysis-tabs"><button className={tab === "private" ? "selected" : ""} onClick={() => setTab("private")} disabled={room.mode === "shared"}><LockKey size={17} />{t.private}</button><button className={tab === "shared" ? "selected" : ""} onClick={() => setTab("shared")}><UsersThree size={17} />{t.sharedFeedback}</button></div>
    {!analysis ? <section className="analysis-loading"><Sparkle size={34} weight="fill" /><h1>{t.aiWorking}</h1></section> : tab === "private" ? <section>{feedback && <div className="private-letter"><span className="letter-mark">私 / PRIVATE</span><FeedbackBlock number="01" title={t.validation} body={feedback.validation} /><FeedbackBlock number="02" title={t.reflection} body={feedback.reflection} /><FeedbackBlock number="03" title={t.suggestion} body={feedback.suggestion} /></div>}<button className="primary-action" onClick={() => setTab("shared")}>{t.sharedFeedback}<ArrowRight size={20} /></button></section> : <section className="shared-analysis"><div className="analysis-heading"><p>{analysis.category}</p><h1>{analysis.title}</h1><span>{t.noVerdict}</span></div><p className="analysis-overview">{analysis.overview}</p><DemoList title={t.common} items={analysis.commonGround} /><DemoList title={t.different} items={analysis.differences} /><DemoList title={t.next} items={analysis.nextSteps} />
      <section className="demo-save"><h2>{room.convertedRoomCode ? t.saved : t.saveTitle}</h2><p>{room.convertedRoomCode ? `${t.saved} · ${room.convertedRoomCode}` : t.saveHint}</p>{room.convertedRoomCode ? <button className="primary-action" onClick={onExit}>{t.goAccount}<ArrowRight size={19} /></button> : room.claimedByCurrent ? <button className="primary-action" disabled><CheckCircle size={19} weight="fill" />{t.claimed} · {room.claimCount}/2</button> : account ? <button className="primary-action" onClick={() => claim()} disabled={busy}>{t.claim}</button> : <div className="demo-auth"><div className="demo-auth-tabs"><button className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>{t.register}</button><button className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>{t.login}</button></div>{authMode === "register" && <KeyboardInput value={name} onChange={(event) => setName(event.target.value)} placeholder={t.name} maxLength={24} />}<KeyboardInput value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t.email} type="email" /><KeyboardInput value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t.password} type="password" /><button className="primary-action" onClick={authenticate} disabled={busy || !email || password.length < 10 || (authMode === "register" && !name)}>{authMode === "register" ? t.register : t.login}</button></div>}{notice && <p className="form-notice">{notice}</p>}</section>
    </section>}</main></MobileScroll>;
}

function DemoHeader({ language, onLanguage, onBack }: { language: Language; onLanguage: () => void; onBack: () => void }) { return <header className="demo-header"><button onClick={onBack}><ArrowLeft size={21} /></button><Wordmark /><button className="demo-language" onClick={onLanguage}><span className={language === "zh" ? "active" : ""}>中</span> / <span className={language === "en" ? "active" : ""}>EN</span></button></header>; }
function Wordmark() { return <div className="home-wordmark" aria-label="Toward Us 彼此"><strong>T O W A R D&nbsp;&nbsp;U S</strong><span>｜彼此｜</span></div>; }
function PauseMark() { return <div className="pause-mark" aria-hidden="true"><i /><i /><i /></div>; }
function SplitButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) { return <button className="split-cta" type="button" onClick={onClick} disabled={disabled}><img src="/assets/brand/split-cta-background-tight.png" alt="" aria-hidden="true" draggable={false} /><span>{label}</span><i><ArrowRight size={25} /></i></button>; }
function FeedbackBlock({ number, title, body }: { number: string; title: string; body: string }) { return <article className="feedback-block"><span>{number}</span><div><h2>{title}</h2><p>{body}</p></div></article>; }
function DemoList({ title, items }: { title: string; items: string[] }) { return <section className="analysis-section"><header><span>—</span><h2>{title}</h2></header><ul className="demo-analysis-list">{items.map((item) => <li key={item}>{item}</li>)}</ul></section>; }
async function api<T>(path: string, options: RequestInit = {}): Promise<T> { const response = await fetch(path, { ...options, credentials: "same-origin", headers: { ...(options.body && typeof options.body === "string" ? { "content-type": "application/json" } : {}), ...options.headers } }); const payload = response.status === 204 ? {} : await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`); return payload as T; }
function formatSeconds(total: number) { return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`; }
function initialRoomCode() {
  const pathMatch = location.pathname.match(/^\/j\/([A-Z0-9]{8})\/?$/i);
  return (pathMatch?.[1] || new URLSearchParams(location.search).get("room") || "").toUpperCase();
}
