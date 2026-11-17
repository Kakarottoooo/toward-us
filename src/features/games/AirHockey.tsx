import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "@phosphor-icons/react";
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { localized, type Language } from "../../i18n";
import { ArcadeStage, type ArcadeMatchState } from "./ArcadeStage";
import type { ScreenProps } from "./MatchScreen";
import "./arcade-sports.css";

type Point = { x: number; y: number };
type HockeyResult = { winner: 0 | 1 | null; score: [number, number]; target: number };
type HockeyView = {
  width: number;
  height: number;
  paddleRadius: number;
  puckRadius: number;
  goal: { left: number; right: number };
  puck: Point;
  paddles: [Point, Point];
  score: [number, number];
  target: number;
  resetReason: "goal" | "possession" | null;
};
type Send = (action: Record<string, unknown>, mode?: "continuous") => void;

const arrowKeys = [["ArrowLeft", -8, 0], ["ArrowUp", 0, -8], ["ArrowDown", 0, 8], ["ArrowRight", 8, 0]] as const;
const arrowIcons = [ArrowLeft, ArrowUp, ArrowDown, ArrowRight];

function HockeyRink({ data, seat, active, send, language, partnerName }: {
  data: HockeyView; seat: 0 | 1; active: boolean; send: Send; language: Language; partnerName: string;
}) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const pointer = useRef<number | null>(null);
  const { width, height, paddleRadius } = data;
  const you = t("你", "You", "Tú");
  const theirName = partnerName || t("对方", "Partner", "Tu pareja");

  function local({ x, y }: Point): Point {
    return seat === 0 ? { x, y } : { x: width - x, y: height - y };
  }

  function position(point: Point) {
    const { x, y } = local(point);
    return { left: `${x / width * 100}%`, top: `${y / height * 100}%` };
  }

  function move(point: Point) {
    const confined = {
      x: Math.min(width - paddleRadius, Math.max(paddleRadius, point.x)),
      y: Math.min(height - paddleRadius, Math.max(height / 2 + paddleRadius, point.y)),
    };
    send({ type: "move", ...local(confined) }, "continuous");
  }

  function pointerPosition(event: PointerEvent<HTMLDivElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) / bounds.width * width, y: (event.clientY - bounds.top) / bounds.height * height };
  }

  function begin(event: PointerEvent<HTMLDivElement>) {
    if (!active || pointer.current !== null || event.button !== 0) return;
    const point = pointerPosition(event);
    if (point.y < height / 2) return;
    pointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    move(point);
  }

  function end(event: PointerEvent<HTMLDivElement>) {
    if (pointer.current === event.pointerId) pointer.current = null;
  }

  function nudge(dx: number, dy: number) {
    const current = local(data.paddles[seat]);
    move({ x: current.x + dx, y: current.y + dy });
  }

  function steer(event: KeyboardEvent<HTMLDivElement>) {
    const direction = active && arrowKeys.find(([key]) => key === event.key);
    if (!direction) return;
    event.preventDefault();
    nudge(direction[1], direction[2]);
  }

  const labels = [t("向左移", "Move left", "Mueve a la izquierda"), t("向上移", "Move up", "Mueve hacia arriba"), t("向下移", "Move down", "Mueve hacia abajo"), t("向右移", "Move right", "Mueve a la derecha")];
  const goal = { left: `${data.goal.left / width * 100}%`, width: `${(data.goal.right - data.goal.left) / width * 100}%` };
  const paddleSize = `${paddleRadius * 2 / width * 100}%`;

  return <section className="sports-game" data-testid="air-hockey">
    <div className="sports-score hockey-score" role="status">
      <div><small><i className="sports-seat sports-seat-you" />{you}</small><strong data-testid="air-hockey-score-you">{data.score[seat]}</strong></div>
      <span>{t(`先到 ${data.target}`, `First to ${data.target}`, `Primero a ${data.target}`)}</span>
      <div><small><i className="sports-seat sports-seat-partner" />{theirName}</small><strong data-testid="air-hockey-score-partner">{data.score[1 - seat]}</strong></div>
    </div>
    <div className={`sports-board hockey-rink${active ? " hockey-rink-active" : ""}`} style={{ aspectRatio: `${width} / ${height}` }}
      tabIndex={0} role="group" data-scroll-drag={active ? "ignore" : undefined} data-testid="air-hockey-rink"
      aria-label={t("冰球场，你的球拍在下半场。可拖动或用方向键。", "Air hockey rink. Drag the lower paddle or use arrow keys.", "Pista de hockey. Arrastra la paleta inferior o usa las flechas.")}
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown" onKeyDown={steer}
      onPointerDown={begin} onPointerMove={(event) => { if (active && pointer.current === event.pointerId) move(pointerPosition(event)); }}
      onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
      <i className="hockey-center-line" aria-hidden="true" />
      <i className="hockey-center-circle" aria-hidden="true" />
      <i className="hockey-goal hockey-goal-away" style={goal} aria-hidden="true" />
      <i className="hockey-goal hockey-goal-home" style={goal} aria-hidden="true" />
      <i className="sports-disc hockey-paddle hockey-paddle-away" style={{ ...position(data.paddles[1 - seat]), width: paddleSize }} aria-hidden="true" data-testid="air-hockey-paddle-partner" />
      <i className="sports-disc hockey-paddle hockey-paddle-home" style={{ ...position(data.paddles[seat]), width: paddleSize }} aria-hidden="true" data-testid="air-hockey-paddle-you" />
      <i className="sports-disc hockey-puck" style={{ ...position(data.puck), width: `${data.puckRadius * 2 / width * 100}%` }} aria-hidden="true" data-testid="air-hockey-puck" />
      {data.resetReason && <span className="hockey-reset" role="status">{data.resetReason === "goal"
        ? t("进球！", "Goal!", "¡Gol!") : t("交换发球", "Switching serve", "Cambio de saque")}</span>}
    </div>
    <div className="hockey-directions" role="group" aria-label={t("移动球拍", "Move the paddle", "Mueve la paleta")}>
      {arrowKeys.map(([key, dx, dy], index) => {
        const Icon = arrowIcons[index];
        return <button key={key} type="button" className="sports-control" disabled={!active} onClick={() => nudge(dx, dy)} aria-label={labels[index]} data-testid={`air-hockey-${key.slice(5).toLowerCase()}`}>
          <Icon size={19} weight="bold" aria-hidden="true" />
        </button>;
      })}
    </div>
  </section>;
}

export function AirHockey(props: ScreenProps<ArcadeMatchState<HockeyResult>>) {
  const { language, partnerName } = props;
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  return <ArcadeStage<HockeyView, HockeyResult> {...props}
    instructions={t("拖动下方球拍，利用边墙反弹，把球打进对方球门。", "Drag the lower paddle. Use the side rails to bank the puck into your partner’s goal.", "Arrastra la paleta inferior. Rebota el disco en los bordes para marcar.")}
    summary={(result, seat) => <div className="sports-outcome"><strong>{result.winner === null
      ? t("平局", "Draw", "Empate") : result.winner === seat ? t("你赢了！", "You won!", "¡Ganaste!") : t("对方赢了！", "Your partner won!", "¡Ganó tu pareja!")}</strong>
      <span>{result.score[seat]} : {result.score[1 - seat]}</span></div>}>
    {({ data, seat, phase, send }) => <HockeyRink data={data} seat={seat} active={phase === "playing"} send={send} language={language} partnerName={partnerName} />}
  </ArcadeStage>;
}
