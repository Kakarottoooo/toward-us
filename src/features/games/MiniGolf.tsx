import { ArrowClockwise, ArrowLeft, ArrowRight, Flag, Golf, Target } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { localized } from "../../i18n";
import type { ScreenProps } from "./MatchScreen";
import "./two-player-arcade.css";

type Point = [number, number];
type Rect = [number, number, number, number];
type Ball = { point: Point; strokes: number; sunk: boolean; done: boolean };
type Course = { start: Point; hole: Point; par: number; walls: Rect[]; sand: Rect[]; water: Rect[] };
type GolfState = { players: string[]; hole: number; holeCount: number; maxStrokes: number; balls: Ball[]; cards: number[][];
  revision: number; lastShot: { seat: number; trace: Point[]; water: boolean; sunk: boolean } | null; course: Course; totals: number[]; winner: string | null };

const position = ([left, top]: Point) => ({ left: `${left}%`, top: `${top}%` });
const rectangle = ([left, top, width, height]: Rect) => ({ ...position([left, top]), width: `${width}%`, height: `${height}%` });
const degree = (value: number) => value * 180 / Math.PI;

export function MiniGolf({ match, language, userId, partnerName, act, onRematch }: ScreenProps<GolfState>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const state = match.state;
  const seat = state.players.indexOf(userId), [own, other] = [state.balls[seat], state.balls[1 - seat]];
  const finished = match.status === "finished", holeDone = own.done && other.done;
  const myTurn = match.turn === userId && !own.done && !finished;
  const [aim, setAim] = useState<{ revision: number; point: Point } | null>(null), [power, setPower] = useState(55);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const lastRevision = useRef(state.revision);
  const balls = useRef<(HTMLElement | null)[]>([]);
  const target = aim?.revision === state.revision ? aim.point : state.course.hole;
  const angle = Math.atan2(target[1] - own.point[1], target[0] - own.point[0]);
  const title = [t("海边果岭", "Seaside green", "Campo junto al mar"), t("绕过水湾", "Around the cove", "Rodea la cala"), t("花园回转", "Garden dogleg", "Curva del jardín")][state.hole];

  useEffect(() => {
    if (lastRevision.current === state.revision) return;
    lastRevision.current = state.revision;
    const shot = state.lastShot, element = shot && balls.current[shot.seat];
    if (!shot || !element?.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = element.animate(shot.trace.map((point) => ({ ...position(point), visibility: "visible" })), { duration: Math.min(790, Math.max(280, shot.trace.length * 26)), easing: "ease-out" });
    return () => animation.cancel();
  }, [state.revision, state.lastShot]);

  async function move(type: "shoot" | "next") {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try { await act({ type, revision: state.revision, ...(type === "shoot" ? { aim: target, power } : {}) }); }
    finally { pending.current = false; setBusy(false); }
  }

  function aimAt(event: MouseEvent<HTMLButtonElement>) {
    if (!event.detail) { setAim(null); return; }
    const area = event.currentTarget.getBoundingClientRect();
    const point: Point = [(event.clientX - area.left) * 100 / area.width, (event.clientY - area.top) * 100 / area.height];
    if (Math.hypot(point[0] - own.point[0], point[1] - own.point[1]) > 1) setAim({ revision: state.revision, point });
  }

  function adjust(by: number) {
    const next = angle + by * Math.PI / 180;
    setAim({ revision: state.revision, point: [own.point[0] + 25 * Math.cos(next), own.point[1] + 25 * Math.sin(next)] });
  }

  return <section className="arcade-game mini-golf" data-testid="mini-golf">
    <header className="arcade-heading"><div><span><Flag size={15} weight="fill" />{t(`第 ${state.hole + 1}/${state.holeCount} 洞 · 标准 ${state.course.par} 杆`, `Hole ${state.hole + 1}/${state.holeCount} · Par ${state.course.par}`, `Hoyo ${state.hole + 1}/${state.holeCount} · Par ${state.course.par}`)}</span><strong>{title}</strong></div><Golf size={28} weight="duotone" aria-hidden="true" /></header>
    <div className="golf-course">
      <div className="golf-patches" aria-hidden="true">
        {state.course.water.map((shape, index) => <i key={`water-${index}`} className="golf-water" style={rectangle(shape)} />)}
        {state.course.sand.map((shape, index) => <i key={`sand-${index}`} className="golf-sand" style={rectangle(shape)} />)}
        {state.course.walls.map((shape, index) => <i key={`wall-${index}`} className="golf-wall" style={rectangle(shape)} />)}
        <i className="golf-tee" style={position(state.course.start)} />
        <i className="golf-hole" style={position(state.course.hole)}><Flag size={22} weight="fill" /></i>
        {state.lastShot?.trace.filter((_, index) => index % 2 === 0).map((point, index) => <i key={index} className="golf-trace" style={position(point)} />)}
        {myTurn && <><i className="golf-aim" style={{ ...position(own.point), transform: `rotate(${degree(angle)}deg)` }} /><i className="golf-target" style={position(target)} /></>}
        {state.balls.map((ball, index) => <i key={index} ref={(element) => { balls.current[index] = element; }} className={`golf-ball ${index === seat ? "is-own" : "is-partner"}${ball.sunk ? " is-sunk" : ""}`} style={position(ball.point)} />)}
      </div>
      {myTurn && <button type="button" className="golf-aim-plane" onClick={aimAt} disabled={busy}
        aria-label={t("点球场瞄准，按键瞄向球洞", "Tap the course to aim, or press to aim at the hole", "Toca el campo para apuntar, o pulsa para apuntar al hoyo")} data-testid="golf-aim" />}
    </div>
    <div className="arcade-scores">
      {[own, other].map((ball, index) => <div key={index} className={index ? "is-partner" : "is-own"}>
        <span>{index ? partnerName : t("你", "You", "Tú")}</span><strong>{ball.strokes}</strong>
        <small>{ball.sunk ? t("进洞", "Holed", "Embocada") : ball.done ? t(`${state.maxStrokes} 杆封顶`, `${state.maxStrokes}-stroke limit`, `Límite de ${state.maxStrokes}`) : t("本洞杆数", "Strokes this hole", "Golpes en este hoyo")}</small>
      </div>)}
    </div>
    {!finished && state.lastShot?.water && <p className="arcade-feedback" role="status">{t("球落水，回到击球点并加罚一杆。", "Into the water. The ball returns with a one-stroke penalty.", "Al agua. La bola vuelve con un golpe de penalización.")}</p>}
    {myTurn && <>
      <p className="arcade-instruction">{t("点球场瞄准，调好力度再推杆。沙地会让球慢下来。", "Tap to aim, set the power, then putt. Sand slows the ball.", "Toca para apuntar, ajusta la fuerza y golpea. La arena frena la bola.")}</p>
      <div className="arcade-aim-controls">
        <button type="button" className="arcade-icon-button" disabled={busy} onClick={() => adjust(-4)} aria-label={t("向左瞄一点", "Aim a little left", "Apunta un poco a la izquierda")}><ArrowLeft size={18} /></button>
        <button type="button" className="arcade-icon-button" disabled={busy} onClick={() => setAim(null)} aria-label={t("瞄准球洞", "Aim at the hole", "Apunta al hoyo")}><Target size={19} /></button>
        <button type="button" className="arcade-icon-button" disabled={busy} onClick={() => adjust(4)} aria-label={t("向右瞄一点", "Aim a little right", "Apunta un poco a la derecha")}><ArrowRight size={18} /></button>
        <label>{t("力度", "Power", "Fuerza")} <strong>{power}%</strong><input type="range" min="10" max="100" value={power} onChange={(event) => setPower(Number(event.currentTarget.value))} disabled={busy} data-scroll-drag="ignore" data-testid="golf-power" /></label>
      </div>
      <button type="button" className="game-primary" onClick={() => void move("shoot")} disabled={busy} data-testid="golf-putt"><Golf size={19} />{t("推杆", "Putt", "Golpear")}</button>
    </>}
    {!myTurn && !holeDone && !finished && <p className="arcade-instruction" role="status">{t(`等 ${partnerName} 推杆。`, `Waiting for ${partnerName} to putt.`, `Esperando el golpe de ${partnerName}.`)}</p>}
    {holeDone && <div className="arcade-result" role="status">
      <strong>{finished ? state.winner ? state.winner === userId ? t("你赢了！", "You won!", "¡Ganaste!") : t(`${partnerName} 赢了！`, `${partnerName} won!`, `¡Ganó ${partnerName}!`) : t("打成平手！", "It's a tie!", "¡Empate!") : t("这一洞打完了", "Hole complete", "Hoyo completado")}</strong>
      <span>{t(`总杆数 · 你 ${state.totals[seat]} 比 ${state.totals[1 - seat]} ${partnerName}`, `Total strokes · You ${state.totals[seat]} : ${state.totals[1 - seat]} ${partnerName}`, `Golpes totales · Tú ${state.totals[seat]} : ${state.totals[1 - seat]} ${partnerName}`)}</span>
      <button type="button" className="game-primary" onClick={() => finished ? onRematch() : void move("next")} disabled={busy} data-testid={finished ? "golf-rematch" : "golf-next"}>
        {finished ? <ArrowClockwise size={18} /> : <ArrowRight size={18} />}{finished ? t("再打一轮", "Play again", "Otra partida") : t("下一洞", "Next hole", "Siguiente hoyo")}
      </button>
    </div>}
  </section>;
}
