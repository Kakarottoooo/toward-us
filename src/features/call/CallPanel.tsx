import { useEffect, useRef, useState } from "react";
import { Microphone, MicrophoneSlash, PhoneDisconnect, SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { jsonBody, relationshipApi } from "../relationship/api";
import { LiveCall, type CallState, type CaptionRow } from "./liveCall";
import "./call.css";

type Started = { channel: "me" | "us"; sessionId: string | null };
const ERRORS: Record<string, [string, string, string]> = {
  voice_not_configured: ["通话还没开通：服务器还没有配置语音服务。", "Calls aren't set up yet: the voice service isn't configured on the server.", "Las llamadas aún no están activadas: falta configurar el servicio de voz."],
  microphone_denied: ["需要麦克风权限才能通话。可以在手机设置里给 Pinky 打开麦克风。", "Pinky needs the microphone for calls. Turn it on for Pinky in your phone's settings.", "Pinky necesita el micrófono para llamar. Actívalo para Pinky en los ajustes del teléfono."],
  voice_already_active: ["已经有一通电话在进行中。", "A call is already in progress.", "Ya hay una llamada en curso."],
  voice_daily_limit: ["今天的通话时长用完了，明天再来。", "Today's call time is used up. Try again tomorrow.", "Se acabó el tiempo de llamada de hoy. Prueba mañana."],
  pairing_required: ["先邀请另一半加入，才能在“我们俩”里通话。", "Invite your partner before calling in Us.", "Invita a tu pareja antes de llamar en Nosotros."],
  connection_lost: ["通话断开了。", "The call dropped.", "La llamada se cortó."],
  time_limit: ["已到本次通话时长上限。", "The call reached its time limit.", "La llamada llegó a su límite de tiempo."],
};

/** The call bar shown in place of the composer: who is talking, live captions, mute, speaker and hang up. */
export function CallPanel({ language, started, partnerName, onEnded }: { language: Language; started: Started; partnerName: string; onEnded: (message: string) => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [state, setState] = useState<CallState>("idle");
  const [rows, setRows] = useState<CaptionRow[]>([]);
  const [pending, setPending] = useState(0);
  const [muted, setMuted] = useState(false), [speakerMuted, setSpeakerMuted] = useState(false), [blocked, setBlocked] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const call = useRef<LiveCall | null>(null);
  const reason = useRef("");
  useEffect(() => {
    // Unmounting (or React's dev double-run of effects) hangs up quietly instead of reporting the call as ended.
    let disposed = false;
    const live = new LiveCall({
      start: (body) => relationshipApi(`/api/voice/start`, jsonBody({ ...body, channel: started.channel, sessionId: started.sessionId, language })),
      post: (path, body) => relationshipApi(path, jsonBody(body)),
      onState: (next, detail) => { setState(next); if (detail === "playback_blocked") setBlocked(true); else if (detail) reason.current = detail; },
      onCaptions: setRows, onTask: setPending,
      onEnd: (final) => {
        if (disposed) return;
        const why = reason.current;
        const save = live.id && final.length ? relationshipApi("/api/voice/transcript", jsonBody({ id: live.id, rows: final.map(({ role, text }) => ({ role, text })) })).catch(() => {}) : Promise.resolve();
        void save.then(() => onEnded(ERRORS[why] ? localized(language, ...ERRORS[why]) : why && !["ended", "user"].includes(why) && !final.length ? localized(language, "通话没能接通，请稍后再试。", "The call couldn't connect. Try again soon.", "No se pudo conectar la llamada. Inténtalo pronto.") : ""));
      },
    });
    call.current = live; void live.start();
    const tick = window.setInterval(() => setSeconds((value) => live.state === "connected" ? value + 1 : value), 1000);
    return () => { disposed = true; clearInterval(tick); void live.end("user"); };
  }, []);
  const captions = rows.slice(-4);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const status = state === "connecting" || state === "idle" ? t("正在接通 Pinky…", "Connecting to Pinky…", "Conectando con Pinky…") : state === "connected" ? pending ? t("Pinky 正在办…", "Pinky is on it…", "Pinky está en ello…") : clock : t("正在挂断…", "Hanging up…", "Colgando…");
  return <section className="call-panel" data-testid="call-panel" aria-live="polite">
    <header><span className={`call-dot is-${state}`} aria-hidden="true" /><strong>{started.channel === "us" ? t("你们和 Pinky 通话中", "On a call with Pinky", "En llamada con Pinky") : t("和 Pinky 私下通话", "Private call with Pinky", "Llamada privada con Pinky")}</strong><span>{status}</span></header>
    {started.channel === "us" && state === "connected" && !rows.length && <p className="call-hint">{t(`把手机放在你们中间。Pinky 会先问每个人的名字，之后谁说话它都能听到。旁边有第三个人也可以一起说。`, `Put the phone between you. Pinky will ask everyone's name first; after that it hears whoever speaks. A third person can join in too.`, `Pon el teléfono entre ustedes. Pinky preguntará primero el nombre de cada uno; después oye a quien hable. Una tercera persona también puede participar.`)}</p>}
    {!!captions.length && <ol className="call-captions">{captions.map((row) => <li key={row.id} className={row.role === "agent" ? "from-agent" : ""}><span>{row.role === "agent" ? "Pinky" : started.channel === "us" ? t("你们", "You", "Ustedes") : t("你", "You", "Tú")}</span>{row.text}</li>)}</ol>}
    {blocked && <p className="call-hint">{t("点一下扬声器按钮，打开 Pinky 的声音。", "Tap the speaker button to hear Pinky.", "Toca el altavoz para oír a Pinky.")}</p>}
    <div className="call-controls">
      <button type="button" className={muted ? "on" : ""} aria-pressed={muted} onClick={() => setMuted(call.current?.mute() ?? false)}>{muted ? <MicrophoneSlash size={24} /> : <Microphone size={24} />}<span>{muted ? t("已静音", "Muted", "Silenciado") : t("静音", "Mute", "Silenciar")}</span></button>
      <button type="button" className="call-hangup" onClick={() => void call.current?.end("user")} aria-label={t("挂断", "Hang up", "Colgar")} data-testid="call-hangup"><PhoneDisconnect size={28} weight="fill" /></button>
      <button type="button" className={speakerMuted ? "on" : ""} aria-pressed={speakerMuted} onClick={() => { setBlocked(false); setSpeakerMuted(call.current?.speaker() ?? false); }}>{speakerMuted ? <SpeakerSlash size={24} /> : <SpeakerHigh size={24} />}<span>{speakerMuted ? t("已关声音", "Sound off", "Sin sonido") : t("扬声器", "Speaker", "Altavoz")}</span></button>
    </div>
    {partnerName && started.channel === "us" && <small className="call-note">{t(`通话结束后，字幕会存进“我们俩”，你和 ${partnerName} 都能看到。`, `When the call ends, the captions are saved in Us for you and ${partnerName}.`, `Al terminar, los subtítulos se guardan en Nosotros para ti y ${partnerName}.`)}</small>}
  </section>;
}

/** A finished call in the conversation: its length, and the captions on demand. */
export function CallRecord({ language, title, call }: { language: Language; title: string; call: { minutes: number; rows: Array<{ role: string; text: string }> } }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  return <details className="call-record" data-testid="call-record"><summary>{title || t(`和 Pinky 通话 · ${call.minutes} 分钟`, `Call with Pinky · ${call.minutes} min`, `Llamada con Pinky · ${call.minutes} min`)}<span>{t("看字幕", "Captions", "Subtítulos")}</span></summary>
    <ol>{call.rows.map((row, index) => <li key={index} className={row.role === "agent" ? "from-agent" : ""}><span>{row.role === "agent" ? "Pinky" : t("说话的人", "Speaker", "Persona")}</span>{row.text}</li>)}</ol></details>;
}
