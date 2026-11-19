import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Microphone, Stop } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { startFeedbackCapture } from "./feedbackCapture";
import {
  discardVoiceTake, keepVoiceTake, listVoiceTakes, retryVoiceTake, transcribingId, voiceEvent, type VoiceTake,
} from "./feedbackVoiceQueue";

type CaptureSession = { signal: AbortController; controls?: Awaited<ReturnType<typeof startFeedbackCapture>> };

type Props = {
  owner: string; language: Language; online: boolean;
  position: () => { base: string; position: number };
  insert: (takes: VoiceTake[]) => Promise<void>;
  onBusy: (pending: boolean) => void;
  beforeBack: MutableRefObject<((leave: () => void) => void) | null>;
};

export function FeedbackVoice({ owner, language, online, position, insert, onBusy, beforeBack }: Props) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [mode, setMode] = useState<"idle" | "permission" | "recording" | "saving">("idle");
  const [error, setError] = useState<"" | "denied" | "unavailable" | "empty" | "storage">("");
  const [meter, setMeter] = useState({ elapsed: 0, level: 0 });
  const [takes, setTakes] = useState<VoiceTake[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState("");
  const [unsaved, setUnsaved] = useState<{ take: VoiceTake; audio: Blob } | null>(null);
  const alive = useRef(false);
  const leaveAfterSave = useRef<(() => void) | null>(null);
  const [, tick] = useState(0);
  const capture = useRef<CaptureSession | null>(null);
  const insertCurrent = useRef(insert);
  insertCurrent.current = insert;
  const pending = mode !== "idle" || !!unsaved || !!takes.length || !loaded;
  useEffect(() => { onBusy(pending); }, [onBusy, pending]);
  useEffect(() => {
    const next = Math.min(...takes.map(row => row.retryAt || 0).filter(at => at > Date.now()));
    if (Number.isFinite(next)) {
      const timer = setTimeout(() => tick(n => n + 1), Math.max(1, next - Date.now()));
      return () => clearTimeout(timer);
    }
  }, [takes]);

  useEffect(() => {
    alive.current = true;
    let revision = 0;
    const refresh = async () => {
      const version = ++revision;
      try {
        const rows = await listVoiceTakes(owner);
        if (!alive.current || version !== revision) return;
        setLoaded(true); setActive(transcribingId(owner) || ""); setTakes(rows);
        const ready: VoiceTake[] = [];
        for (const take of rows) {
          if (!take.transcript) break;
          ready.push(take);
        }
        if (ready.length) {
          await insertCurrent.current(ready);
          if (alive.current && version === revision) setTakes(current => current.filter(row => !ready.some(done => done.id === row.id)));
        }
      } catch {
        if (alive.current && version === revision) { setLoaded(true); setError("storage"); }
      }
    };
    const changed = (event: Event) => { if ((event as CustomEvent).detail === owner) void refresh(); };
    void refresh();
    window.addEventListener(voiceEvent, changed);
    return () => {
      alive.current = false;
      capture.current?.signal.abort();
      capture.current = null;
      window.removeEventListener(voiceEvent, changed);
    };
  }, [owner]);
  const store = async (take: VoiceTake, audio: Blob) => {
    setMode("saving"); setError("");
    try {
      await keepVoiceTake(owner, take, audio);
      if (alive.current) {
        setUnsaved(null);
        setTakes(current => current.some(row => row.id === take.id) ? current : [...current, take]);
        leaveAfterSave.current?.();
      }
    } catch {
      leaveAfterSave.current = null;
      if (alive.current) { setUnsaved({ take, audio }); setError("storage"); }
    } finally { if (alive.current) setMode("idle"); }
  };
  const begin = async () => {
    if (capture.current || unsaved || mode !== "idle") return;
    const take = { id: crypto.randomUUID(), created: Date.now(), language, ...position() };
    const session: CaptureSession = { signal: new AbortController() };
    capture.current = session;
    setMode("permission"); setError(""); setMeter({ elapsed: 0, level: 0 });
    try {
      const controls = await startFeedbackCapture({
        signal: session.signal.signal,
        onMeter: (elapsed, level) => { if (capture.current === session) setMeter({ elapsed, level }); },
        onStop: audio => {
          if (capture.current !== session) return;
          capture.current = null;
          void store(take, audio);
        },
        onError: () => {
          if (capture.current !== session) return;
          capture.current = null; setMode("idle"); setError("empty");
          leaveAfterSave.current?.();
        },
      });
      if (capture.current !== session) { controls.cancel(); return; }
      session.controls = controls;
      setMode("recording");
    } catch (reason) {
      if (capture.current !== session) return;
      capture.current = null; setMode("idle");
      const name = (reason as Error)?.name;
      setError(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
    }
  };
  const cancel = () => {
    const session = capture.current;
    capture.current = null;
    session?.signal.abort(); setMode("idle"); setError("");
  };
  useEffect(() => {
    beforeBack.current = leave => {
      if (unsaved) { setError("storage"); return; }
      if (mode === "saving" || capture.current?.controls) {
        leaveAfterSave.current = leave;
        capture.current?.controls?.stop();
        return;
      }
      capture.current?.signal.abort();
      leave();
    };
    return () => { beforeBack.current = null; };
  }, [beforeBack, mode, unsaved]);
  const action = async (promise: Promise<void>) => {
    try { await promise; } catch { if (alive.current) setError("storage"); }
  };
  const seconds = Math.floor(meter.elapsed / 1000);
  const timer = Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  const recording = mode === "recording";
  const choose = t("语音输入", "Dictate feedback", "Dictar comentario");
  const stop = t("停止录音", "Stop recording", "Detener grabación");
  const cancelLabel = t("取消", "Cancel", "Cancelar");
  const retry = t("重试", "Retry", "Reintentar");
  const discard = t("丢弃录音", "Discard recording", "Descartar grabación");
  const failures = {
    consent: t("请先在 AI 功能中同意第三方 AI 处理，再重试。你也可以继续打字。", "Open an AI feature to review third-party AI consent, then retry. You can also keep typing.", "Abre una función de IA para revisar el consentimiento de IA de terceros y reintenta. También puedes seguir escribiendo."),
    session: t("请重新登录录音时的账号，再重试。", "Sign back into the account that recorded this take, then retry.", "Vuelve a entrar en la cuenta que hizo esta grabación y reintenta."),
    rate: t("转写次数已达上限。", "Transcription limit reached.", "Has alcanzado el límite de transcripciones."),
    network: t("连接中断，录音已保留。", "Connection interrupted. Your recording is saved.", "Conexión interrumpida. Tu grabación está guardada."),
    failed: t("转写失败，录音已保留。", "Transcription failed. Your recording is saved.", "No se pudo transcribir. Tu grabación está guardada."),
  };
  return <div className="feedback-voice">
    <div className="feedback-voice-actions">
      <button type="button" disabled={mode === "permission" || mode === "saving" || !!unsaved}
        onClick={recording ? () => capture.current?.controls?.stop() : () => void begin()} data-testid="feedback-voice">
        {recording ? <Stop weight="fill" size={17} /> : <Microphone size={18} />} {recording ? stop : choose}
      </button>
      {recording && <><span className="feedback-voice-time" role="timer">{timer}</span>
        <meter aria-label={t("录音音量", "Microphone level", "Nivel del micrófono")} min={0} max={1} value={meter.level} /></>}
      {(recording || mode === "permission") && <button type="button" onClick={cancel}>{cancelLabel}</button>}
    </div>
    <div role="status" aria-live="polite">
      {mode === "idle" && !error && !takes.length && <p>{t("麦克风用来把反馈转成文字，转写后即删除录音。", "The microphone turns your feedback into text. Audio is deleted after transcription.", "El micrófono convierte tus comentarios en texto. El audio se elimina tras la transcripción.")}</p>}
      {mode === "permission" && <p>{t("请允许使用麦克风，把你说的反馈转成可编辑的文字。录音在转写后删除。", "Allow microphone access to turn what you say into editable feedback. Audio is deleted after transcription.", "Permite el acceso al micrófono para dictar comentarios editables. El audio se elimina tras la transcripción.")}</p>}
      {mode === "saving" && <p>{t("正在保存录音…", "Saving recording…", "Guardando grabación…")}</p>}
      {error === "denied" && <p>{t("麦克风权限已关闭。请在系统设置中允许 Ourever 使用麦克风；使用浏览器时，请在网站设置中允许麦克风。也可以继续打字。", "Microphone access is off. Allow Ourever to use the microphone in device settings, or allow it in this site’s browser settings. You can keep typing.", "El micrófono está bloqueado. Permite que Ourever lo use en los ajustes del dispositivo, o autorízalo en los ajustes del sitio del navegador. Puedes seguir escribiendo.")}</p>}
      {error === "unavailable" && <p>{t("无法打开麦克风。请检查麦克风后重试，或继续打字。", "Couldn’t open the microphone. Check it and try again, or keep typing.", "No se pudo abrir el micrófono. Compruébalo y reintenta, o sigue escribiendo.")}</p>}
      {error === "empty" && <p>{t("没有录到声音，请再说一次。", "No sound was recorded. Try again.", "No se grabó sonido. Inténtalo de nuevo.")}</p>}
      {error === "storage" && <p>{t("设备无法保存语音草稿。请释放空间后重试。", "Couldn’t save this voice draft. Free up space and retry.", "No se pudo guardar el borrador de voz. Libera espacio y reintenta.")}</p>}
    </div>
    {unsaved && <div className="feedback-voice-actions"><button type="button" disabled={mode === "saving"} onClick={() => void store(unsaved.take, unsaved.audio)}>{retry}</button>
      <button type="button" disabled={mode === "saving"} onClick={() => { setUnsaved(null); setError(""); }}>{discard}</button></div>}
    {takes.map((take, index) => {
      const minutes = Math.max(1, Math.ceil(((take.retryAt || 0) - Date.now()) / 60000));
      return <div className="feedback-voice-take" key={take.id}>
        <p role="status">{takes.length > 1 && <strong>{index + 1}. </strong>}{!online && !take.transcript
          ? t("录音已存入草稿，联网后自动转写。", "Recording saved with your draft. It will transcribe when you reconnect.", "Grabación guardada con el borrador. Se transcribirá al volver a conectarte.")
          : take.failure ? failures[take.failure] : active === take.id ? t("正在转写…", "Transcribing…", "Transcribiendo…")
            : take.transcript ? t("正在插入文字…", "Inserting text…", "Insertando texto…") : t("等待转写…", "Waiting to transcribe…", "Esperando la transcripción…")}
          {online && take.failure === "rate" && (take.retryAt || 0) > Date.now() && " " + t(`约 ${minutes} 分钟后再试。`, `Try again in about ${minutes} min.`, `Reintenta en unos ${minutes} min.`)}
        </p>
        {!take.transcript && <div className="feedback-voice-actions">
          {take.failure && <button type="button" disabled={!online || (take.retryAt || 0) > Date.now()} onClick={() => void action(retryVoiceTake(owner, take.id))}>{retry}</button>}
          <button type="button" onClick={() => void action(discardVoiceTake(owner, take.id))}>{discard}</button>
        </div>}
      </div>;
    })}
  </div>;
}
