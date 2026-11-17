import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowsClockwise, Check, MusicNote, PaperPlaneRight, Play, SpeakerHigh, Stop, StopCircle } from "@phosphor-icons/react";
import { localized } from "../../i18n";
import type { ScreenProps } from "./MatchScreen";
import "./song-relay.css";

const STEPS = 8;
const BEAT = 0.5;
const LENGTH = BEAT * STEPS;
const DRUMS = [
  { bit: 1, kind: "kick", words: ["底鼓", "Kick", "Bombo"] },
  { bit: 2, kind: "clap", words: ["拍手", "Clap", "Palmas"] },
  { bit: 4, kind: "hat", words: ["踩镲", "Hi-hat", "Platillo"] },
] as const;
const NOTES = [
  { hz: 523.25, letters: "C", solfege: "Do" },
  { hz: 587.33, letters: "D", solfege: "Re" },
  { hz: 659.25, letters: "E", solfege: "Mi" },
  { hz: 783.99, letters: "G", solfege: "Sol" },
  { hz: 880, letters: "A", solfege: "La" },
];
const silence = (drums: boolean) => Array<number>(STEPS).fill(drums ? 0 : -1);
type SongState = { drummer: string; drums: number[] | null; melody: number[] | null };
type SongProps = ScreenProps<SongState> & { visible?: boolean };
type SongTracks = { drums: number[]; melody: number[] };
type Player = { output: GainNode; sources: AudioScheduledSourceNode[]; frame: number };

function readDraft(key: string, drums: boolean) {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "null");
    const [min, max] = drums ? [0, 7] : [-1, NOTES.length - 1];
    if (Array.isArray(value) && value.length === STEPS && value.every((step) => Number.isInteger(step) && step >= min && step <= max)) return value as number[];
  } catch { /* Editing still works when local storage is unavailable. */ }
  return silence(drums);
}

function oscillator(context: AudioContext, output: GainNode, at: number, hz: number, drum: boolean) {
  const source = context.createOscillator();
  const gain = context.createGain();
  source.type = drum ? "sine" : "triangle";
  source.frequency.setValueAtTime(hz, at);
  if (drum) source.frequency.exponentialRampToValueAtTime(42, at + 0.16);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(drum ? 0.54 : 0.21, at + 0.007);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + (drum ? 0.25 : 0.39));
  source.connect(gain).connect(output);
  source.start(at);
  source.stop(at + (drum ? 0.26 : 0.4));
  return source;
}

function percussion(context: AudioContext, output: GainNode, samples: AudioBuffer, at: number, hat: boolean) {
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = samples;
  filter.type = hat ? "highpass" : "bandpass";
  filter.frequency.value = hat ? 6800 : 1150;
  filter.Q.value = 0.65;
  const duration = hat ? 0.075 : 0.16;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(hat ? 0.13 : 0.3, at + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  source.connect(filter).connect(gain).connect(output);
  source.start(at);
  source.stop(at + duration + 0.01);
  return source;
}

function playPattern(context: AudioContext, player: Player, tracks: SongTracks, startBeat: number, startAt: number) {
  const noise = context.createBuffer(1, Math.floor(context.sampleRate * 0.2), context.sampleRate);
  const samples = noise.getChannelData(0);
  for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;

  for (let index = startBeat; index < STEPS; index++) {
    const at = startAt + (index - startBeat) * BEAT;
    const drums = tracks.drums[index];
    const note = NOTES[tracks.melody[index]];
    if (drums & 1) player.sources.push(oscillator(context, player.output, at, 145, true));
    if (drums & 2) player.sources.push(percussion(context, player.output, noise, at, false));
    if (drums & 4) player.sources.push(percussion(context, player.output, noise, at, true));
    if (note) player.sources.push(oscillator(context, player.output, at, note.hz, false));
  }
}

export function SongRelay({ match, language, userId, partnerName, act, onRematch, visible = true }: SongProps) {
  const { drummer, drums, melody } = match.state;
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const isDrummer = userId === drummer;
  const canEdit = match.status === "active" && match.turn === userId;
  const draftKey = ["pinky-song", userId, match.id, isDrummer ? "drums" : "melody"].join(":");
  const [draft, setDraft] = useState(() => readDraft(draftKey, isDrummer));
  const [undoDraft, setUndoDraft] = useState<number[] | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [selected, setSelected] = useState(0);
  const [seek, setSeek] = useState(0);
  const [playHead, setPlayHead] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const actionPending = useRef(false);
  const contextRef = useRef<AudioContext | null>(null);
  const playerRef = useRef<Player | null>(null);
  const sessionId = useRef(0);
  const trackDrums = drums ?? (canEdit && isDrummer ? draft : silence(true));
  const trackMelody = melody ?? (canEdit && !isDrummer ? draft : silence(false));
  const canListen = trackDrums.some(Boolean) || trackMelody.some((note) => note >= 0);

  const killPlayback = useCallback(() => {
    sessionId.current += 1;
    const player = playerRef.current;
    if (!player) return;
    playerRef.current = null;
    window.cancelAnimationFrame(player.frame);
    player.output.disconnect();
    for (const source of player.sources) {
      try { source.stop(); } catch { /* The source may already have ended. */ }
      source.disconnect();
    }
  }, []);

  const stop = useCallback(() => {
    killPlayback();
    setPlaying(false);
    setPlayHead(null);
  }, [killPlayback]);
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState !== "visible") stop(); };
    window.addEventListener("pagehide", stop);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", stop);
      document.removeEventListener("visibilitychange", onVisibility);
      killPlayback();
      const context = contextRef.current;
      contextRef.current = null;
      if (context && context.state !== "closed") { context.onstatechange = null; void context.close().catch(() => {}); }
    };
  }, [killPlayback, stop]);
  useEffect(() => { if (!visible) stop(); }, [visible, stop]);

  const listen = async (beat: number) => {
    stop();
    if (!canListen || !visible) return;
    setAudioError(false);
    const generation = sessionId.current;
    try {
      const Audio = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Audio) throw new Error("AudioContext unavailable");
      const context = contextRef.current ?? new Audio();
      contextRef.current = context;
      setPlaying(true);
      if (context.state !== "running") await context.resume();
      if (generation !== sessionId.current) return;
      const output = context.createGain();
      output.gain.value = 0.62;
      output.connect(context.destination);
      const player: Player = { output, sources: [], frame: 0 };
      playerRef.current = player;
      context.onstatechange = () => {
        if (generation === sessionId.current && context.state !== "running") stop();
      };
      const startAt = context.currentTime + 0.035;
      playPattern(context, player, { drums: trackDrums, melody: trackMelody }, beat, startAt);
      const animate = () => {
        if (generation !== sessionId.current) return;
        const progress = Math.max(0, context.currentTime - startAt) + beat * BEAT;
        if (progress >= LENGTH) { stop(); setSeek(0); return; }
        setPlayHead(Math.floor(progress / BEAT));
        player.frame = window.requestAnimationFrame(animate);
      };
      animate();
    } catch {
      if (generation === sessionId.current) { stop(); setAudioError(true); }
    }
  };

  const change = (steps: number[]) => {
    setDraft(steps);
    try { localStorage.setItem(draftKey, JSON.stringify(steps)); } catch { /* The open card retains this draft. */ }
  };
  const apply = (value: number) => {
    stop();
    setUndoDraft(null);
    change(draft.map((step, index) => index !== selected ? step : isDrummer ? step ^ value : step === value ? -1 : value));
  };
  const send = async (type: string) => {
    if (actionPending.current) return;
    actionPending.current = true;
    setSaveError(false);
    setBusy(true);
    stop();
    try {
      const done = await act(type === "abandon" ? { type } : { type, steps: draft });
      setSaveError(!done);
      if (done) { try { localStorage.removeItem(draftKey); } catch { /* Already sent. */ } }
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  };
  const clear = () => { stop(); setAudioError(false); setSeek(0); setUndoDraft(draft); change(silence(isDrummer)); };
  const hasDraft = draft.some((step) => step !== (isDrummer ? 0 : -1));
  const beatLabel = (beat: number) => t("第 " + (beat + 1) + " 拍", "Beat " + (beat + 1), "Pulso " + (beat + 1));
  const noteLabel = (note: number) => language === "en" ? NOTES[note].letters : NOTES[note].solfege;

  return <section className="song-relay" data-testid="song-relay">
    <header className="song-relay-hero">
      <MusicNote size={31} weight="duotone" aria-hidden="true" />
      <div>
        <h3>{melody ? t("你们的歌写好了", "Your song is ready", "Su canción está lista") :
          canEdit ? isDrummer ? t("先做一段鼓点", "Make a drum beat", "Crea un ritmo de batería") :
            t("加上你的旋律", "Add your melody", "Añade tu melodía") :
            t("等 " + partnerName + " 接力", "Waiting for " + partnerName, "Esperando a " + partnerName)}</h3>
        <p>{melody ? t("回来打开这局，就能再听。", "Open this round anytime to listen together.", "Vuelvan a esta partida cuando quieran escucharla.") :
          canEdit ? t("选一拍，再点下方的声音。", "Pick a beat, then add a sound.", "Elige un pulso y añade un sonido.") :
            drums ? t("你的鼓点已发出，等 TA 加旋律。", "Your beat is sent. Your partner adds the melody next.", "Enviaste tu ritmo. Falta la melodía de tu pareja.") :
              t("等 TA 做好鼓点，就轮到你加旋律。", "When your partner sends a beat, you can add the melody.", "Cuando tu pareja envíe el ritmo, podrás añadir la melodía.")}</p>
      </div>
    </header>

    {(canEdit || drums) && <div className="song-relay-beats" aria-label={t("八拍作品", "Eight-beat pattern", "Patrón de ocho pulsos")}>
      {trackDrums.map((mask, step) => {
        const note = trackMelody[step];
        const active = selected === step && canEdit;
        const cells = <><span className="song-beat-number">{step + 1}</span>
          <span className="song-beat-indicators" aria-hidden="true">
            {DRUMS.map(({ bit, kind }) => <i key={bit} className={kind + (mask & bit ? " is-on" : "")} />)}
            <i className={"song-beat-note" + (note >= 0 ? " is-on" : "")}>{note >= 0 ? noteLabel(note) : null}</i>
          </span></>;
        const sounds = DRUMS.filter(({ bit }) => mask & bit).map(({ words }) => t(words[0], words[1], words[2]));
        if (note >= 0) sounds.push(noteLabel(note));
        const label = beatLabel(step) + (sounds.length ? " · " + sounds.join(", ") : "");
        const className = "song-beat" + (active ? " is-selected" : "") + (playHead === step ? " is-playing" : "");
        return canEdit ? <button key={step} type="button" className={className} aria-label={label} aria-pressed={active}
          onClick={() => setSelected(step)} disabled={busy}>{cells}</button>
          : <div key={step} className={className} aria-label={label}>{cells}</div>;
      })}
    </div>}

    {canEdit && <div className="song-relay-editor">
      <div className="song-relay-edit-head"><h4>{beatLabel(selected)}</h4>
        {hasDraft ? <button type="button" className="game-quiet" disabled={busy} onClick={clear}>{t("清空", "Clear", "Borrar")}</button>
          : undoDraft && <button type="button" className="game-quiet" disabled={busy} onClick={() => { change(undoDraft); setUndoDraft(null); }}>{t("撤销清空", "Undo clear", "Deshacer borrado")}</button>}
      </div>
      <div className={"song-sounds " + (isDrummer ? "song-sounds-drums" : "song-sounds-notes")}>
        {isDrummer ? DRUMS.map(({ bit, kind, words }) => {
          const active = Boolean(draft[selected] & bit);
          return <button type="button" key={bit} className={kind} aria-pressed={active} disabled={busy} onClick={() => apply(bit)}>
            <i aria-hidden="true" />{t(words[0], words[1], words[2])}{active && <Check size={12} weight="bold" aria-hidden="true" />}
          </button>;
        }) : NOTES.map((note, index) => <button type="button" key={note.hz} aria-pressed={draft[selected] === index}
          disabled={busy} onClick={() => apply(index)}>{noteLabel(index)}</button>)}
      </div>
    </div>}

    {canListen && <div className="song-transport">
      <button type="button" className="game-quiet" onClick={() => playing ? stop() : void listen(seek)}>
        {playing ? <Stop size={17} weight="fill" aria-hidden="true" /> : <Play size={17} weight="fill" aria-hidden="true" />}
        {playing ? t("停止", "Stop", "Detener") : melody ? t("听你们的歌", "Play your song", "Escuchar su canción") : t("试听", "Preview", "Escuchar")}
      </button>
      <div>
        <input type="range" data-scroll-drag="ignore" min={0} max={STEPS - 1} step={1} value={playHead ?? seek} aria-valuetext={beatLabel(playHead ?? seek)}
          aria-label={t("选择播放起点", "Choose a beat to play from", "Elige el pulso de inicio")}
          onChange={(event) => { const next = Number(event.target.value); setSeek(next); if (playing) void listen(next); }} />
        <span>{beatLabel(playHead ?? seek)}</span>
      </div>
    </div>}
    {audioError && <p className="song-audio-error" role="alert"><SpeakerHigh size={16} aria-hidden="true" />
      {t("声音暂时播不了，点试听重试。", "Audio couldn't play. Tap play to try again.", "No se pudo reproducir el audio. Toca reproducir para reintentar.")}</p>}

    {saveError && <p className="song-audio-error" role="alert">{t("这次操作没保存，请重试。", "This change could not be saved. Please try again.", "No se pudo guardar el cambio. Inténtalo de nuevo.")}</p>}

    {canEdit && <button type="button" className="game-primary" disabled={busy || !hasDraft} onClick={() => void send(isDrummer ? "drums" : "melody")}>
      {isDrummer ? <PaperPlaneRight size={17} weight="fill" aria-hidden="true" /> : <Check size={17} weight="bold" aria-hidden="true" />}
      {isDrummer ? t("交给 TA 加旋律", "Send the beat", "Enviar el ritmo") : t("保存你们的歌", "Save your song", "Guardar su canción")}
    </button>}
    {melody ? <div className="game-actions"><button type="button" className="game-primary" onClick={() => { stop(); onRematch(); }}>
      <ArrowsClockwise size={17} aria-hidden="true" />{t("换角色再写一首", "Swap roles and make another", "Cambiar de rol y crear otra")}
    </button></div> : <div className="game-actions song-end"><button type="button"
      className={"game-quiet" + (confirmEnd ? " is-confirm" : "")} disabled={busy} onBlur={() => setConfirmEnd(false)}
      onClick={() => { if (confirmEnd) { setConfirmEnd(false); void send("abandon"); } else setConfirmEnd(true); }}>
      <StopCircle size={17} aria-hidden="true" />{confirmEnd ? t("确定结束？", "End it?", "¿Terminar?") : t("结束这局", "End game", "Terminar partida")}
    </button></div>}
  </section>;
}
