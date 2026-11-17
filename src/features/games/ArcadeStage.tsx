import { ArrowClockwise, Hourglass, Pause, Play, WifiSlash } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { localized } from "../../i18n";
import { jsonBody, relationshipApi } from "../relationship/api";
import type { ScreenProps } from "./MatchScreen";
import "./arcade-stage.css";

type Seat = 0 | 1;
type Phase = "lobby" | "countdown" | "playing" | "paused" | "finished";
type Action = Record<string, unknown>;
type ArcadeResult = { winner: Seat | null };
export type ArcadeMatchState<Result> = { players: string[]; variant: number; result: Result | null };
type Frame<Data, Result> = { phase: Phase; seat: Seat; ready: boolean[]; present: boolean[]; data: Data; countdownMs: number; remainingMs: number; elapsedMs: number; result: Result | null };
type Board<Data> = { data: Data; seat: Seat; phase: Phase; send: (action: Action, mode?: "continuous") => void };
type Props<Data, Result extends ArcadeResult> = ScreenProps<ArcadeMatchState<Result>> & {
  instructions: string;
  summary: (result: Result, seat: Seat) => ReactNode;
  children: (board: Board<Data>) => ReactNode;
};

export function ArcadeStage<Data, Result extends ArcadeResult>({ match, language, userId, partnerName, visible = true, onRematch, instructions, summary, children }: Props<Data, Result>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [frame, setFrame] = useState<Frame<Data, Result> | null>(null);
  const [connected, setConnected] = useState(false), [interrupted, setInterrupted] = useState(false);
  const [foreground, setForeground] = useState(() => !document.hidden);
  const [pending, setPending] = useState(false), [retry, setRetry] = useState(0), [error, setError] = useState("");
  const endpoint = `/api/matches/${encodeURIComponent(match.id)}/live?language=${language}`;
  const available = match.status === "active" && foreground && visible;
  const nextAnalog = useRef<Action | null>(null), analogBusy = useRef(false), timer = useRef<number | null>(null);
  const discrete = useRef<Action[]>([]), discreteBusy = useRef(false);
  const alive = useRef(false);

  useEffect(() => {
    const syncVisibility = () => setForeground(!document.hidden);
    document.addEventListener("visibilitychange", syncVisibility);
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, []);

  useEffect(() => {
    if (!available) return;
    alive.current = true;
    const events = new EventSource(endpoint);
    const reconnect = window.setTimeout(() => setInterrupted(true), 6500);
    events.addEventListener("frame", (event) => {
      try {
        setFrame(JSON.parse((event as MessageEvent<string>).data) as Frame<Data, Result>);
        setConnected(true);
        setInterrupted(false);
        window.clearTimeout(reconnect);
      } catch { /* Wait for the next complete frame. */ }
    });
    events.onerror = () => { setConnected(false); setInterrupted(true); };
    return () => {
      events.close();
      window.clearTimeout(reconnect);
      alive.current = false;
      setConnected(false);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      nextAnalog.current = null;
      discrete.current = [];
    };
  }, [available, endpoint, retry]);

  const post = useCallback(async (action: Action, mode?: "continuous") => {
    try { await relationshipApi(endpoint, jsonBody({ action, mode })); return true; }
    catch (reason) {
      if (!mode && alive.current) setError((reason as Error).message);
      return false;
    }
  }, [endpoint]);

  // Keep only the most recent drag position when the network is slower than touch input.
  const flushAnalog = useCallback(function flush() {
    if (!alive.current || analogBusy.current || !nextAnalog.current || timer.current !== null) return;
    const action = nextAnalog.current;
    nextAnalog.current = null;
    analogBusy.current = true;
    void post(action, "continuous").finally(() => {
      analogBusy.current = false;
      if (alive.current && nextAnalog.current) timer.current = window.setTimeout(() => { timer.current = null; flush(); }, 32);
    });
  }, [post]);

  const flushDiscrete = useCallback(function flush() {
    if (!alive.current || discreteBusy.current) return;
    const action = discrete.current.shift();
    if (!action) return;
    discreteBusy.current = true;
    void post(action).finally(() => { discreteBusy.current = false; flush(); });
  }, [post]);

  useEffect(() => {
    if (frame?.phase !== "playing") { discrete.current = []; nextAnalog.current = null; }
  }, [frame?.phase]);

  const send = useCallback((action: Action, mode?: "continuous") => {
    if (!available || !connected || frame?.phase !== "playing") return;
    if (mode === "continuous") { nextAnalog.current = action; flushAnalog(); }
    else if (discrete.current.length < 12) { setError(""); discrete.current.push(action); flushDiscrete(); }
  }, [available, connected, flushAnalog, flushDiscrete, frame?.phase]);

  async function control(type: "ready" | "pause") {
    if (pending || !connected) return;
    setPending(true);
    setError("");
    await post({ type });
    setPending(false);
  }

  const result = match.state.result || frame?.result;
  const seat: Seat = match.state.players[0] === userId ? 0 : 1;
  const phase = result ? "finished" : connected && available ? frame?.phase || "lobby" : "paused";
  const partnerHere = frame?.present[1 - seat] && connected;
  const ready = Boolean(frame?.ready[seat]);
  const seconds = Math.ceil((frame?.remainingMs || 0) / 1000);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return <section className="arcade-stage" data-testid="arcade-stage" data-phase={phase}>
    {!result && <div className="arcade-stage-status">
      <span role="status">{phase === "playing" ? t("正在玩", "In play", "En juego") : phase === "countdown" ? t("准备开局", "Get ready", "Prepárense") :
        interrupted ? t("连接断开了", "Connection paused", "Conexión en pausa") : !connected ? t("正在连线…", "Connecting…", "Conectando…") :
        !partnerHere ? t(`等 ${partnerName} 加入`, `Waiting for ${partnerName}`, `Esperando a ${partnerName}`) : phase === "paused" ? t("已暂停", "Paused", "En pausa") : t("两人都到了", "You're both here", "Ya están los dos")}</span>
      {phase === "playing" && <time aria-label={t("剩余时间", "Time left", "Tiempo restante")}>{clock}</time>}
      {(phase === "playing" || phase === "countdown") && <button type="button" className="game-quiet arcade-stage-pause" disabled={pending} onClick={() => void control("pause")} data-testid="arcade-pause">
        <Pause size={15} weight="fill" aria-hidden="true" />{t("暂停", "Pause", "Pausa")}</button>}
    </div>}
    {frame && <div className="arcade-stage-board">
      {children({ data: frame.data, seat, phase, send })}
      {phase === "countdown" && <span className="arcade-stage-count" aria-hidden="true">{Math.max(1, Math.ceil(frame.countdownMs / 1000))}</span>}
    </div>}
    {!result && phase !== "playing" && phase !== "countdown" && <>
      <p className="arcade-stage-instructions">{instructions}</p>
      {connected && <button type="button" className="game-primary" disabled={pending || ready} onClick={() => void control("ready")} data-testid="arcade-ready">
        {ready ? <Hourglass size={18} aria-hidden="true" /> : <Play size={18} weight="fill" aria-hidden="true" />}
        {ready ? t("已准备，等 TA", "Ready. Waiting for your partner", "Ya estás listo. Esperando a tu pareja") : phase === "paused" ? t("准备继续", "Ready to resume", "Listo para continuar") : t("我准备好了", "I'm ready", "Ya estoy listo")}</button>}
      {interrupted && !connected && <button type="button" className="game-quiet" onClick={() => { setError(""); setRetry((value) => value + 1); }}>
        <WifiSlash size={18} aria-hidden="true" />{t("重新连接", "Reconnect", "Volver a conectar")}</button>}
    </>}
    {error && !result && <p className="space-error" role="alert">{error}</p>}
    {result && <div className="arcade-stage-result" data-testid="arcade-result" role="status">
      {summary(result, seat)}
      <button type="button" className="game-primary" disabled={match.status !== "finished"} onClick={onRematch} data-testid="arcade-rematch">
        <ArrowClockwise size={18} aria-hidden="true" />{match.status === "finished" ? t("再玩一次", "Play again", "Otra partida") : t("正在保存结果…", "Saving result…", "Guardando el resultado…")}</button>
    </div>}
  </section>;
}
