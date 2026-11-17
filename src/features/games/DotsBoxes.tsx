import { useRef, useState, type CSSProperties } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react";
import { localized } from "../../i18n";
import type { ScreenProps } from "./MatchScreen";
import "./dots-boxes.css";

type Axis = "h" | "v";
type DotsState = {
  size: number;
  players: string[];
  horizontal: number[];
  vertical: number[];
  boxes: number[];
  scores: number[];
  last: { axis: Axis; x: number; y: number; claimed: number[] } | null;
};

const markers = ["", "●", "◆"];
const coordinates = (x: number, y: number) => `${String.fromCharCode(65 + x)}${y + 1}`;

export function DotsBoxes({ match, language, userId, partnerName, act, onRematch }: ScreenProps<DotsState>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const { state } = match;
  const { size, players, horizontal, vertical, boxes, scores } = state;
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const mine = match.status === "active" && match.turn === userId;
  const me = players.indexOf(userId), them = me === 0 ? 1 : 0;
  const names = players.map((player) => player === userId ? t("你", "You", "Tú") : partnerName);
  const earned = state.last?.claimed.length || 0;
  const width = size * 2 + 1;

  let status: string;
  if (match.status === "finished") {
    status = scores[me] > scores[them]
      ? t("你赢了！", "You win!", "¡Ganaste!")
      : scores[me] < scores[them]
        ? t(`${partnerName} 赢了这局。`, `${partnerName} wins!`, `¡${partnerName} ganó!`)
        : t("平局！", "It's a tie!", "¡Empate!");
  } else if (mine && earned) {
    status = t(`你围了 ${earned} 格，再连一条线。`,
      `You claimed ${earned} ${earned === 1 ? "box" : "boxes"}. Draw another line.`,
      `Cerraste ${earned} ${earned === 1 ? "cuadro" : "cuadros"}. Traza otra línea.`);
  } else if (mine) {
    status = t("轮到你了，点一条线。", "Your turn. Tap a line.", "Te toca. Toca una línea.");
  } else {
    status = t(`等 ${partnerName} 连线。`, `Waiting for ${partnerName}.`, `Esperando a ${partnerName}.`);
  }

  async function draw(axis: Axis, x: number, y: number) {
    if (!mine || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try { await act({ type: "draw", axis, x, y }); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <section className="dots-game" aria-label={t("连点占格", "Dots and Boxes", "Puntos y cajas")}>
    <div className="dots-scores">
      {players.map((player, index) => (
        <div className={`dots-score${match.turn === player ? " is-turn" : ""}`} data-owner={index + 1} key={player}>
          <span className="dots-marker" aria-hidden="true">{markers[index + 1]}</span>
          <span>{names[index]}</span><strong data-testid="dots-score">{scores[index]}</strong>
        </div>
      ))}
    </div>
    <p className="dots-status" role="status" data-testid="dots-status">{status}</p>
    <div className="dots-board" role="group" aria-label={t("连点占格棋盘", "Dots and Boxes board", "Tablero de Puntos y cajas")}
      data-testid="dots-board" style={{ "--dots-size": size } as CSSProperties}>
      {Array.from({ length: width * width }, (_, cell) => {
        const gridX = cell % width, gridY = Math.floor(cell / width);
        const x = Math.floor(gridX / 2), y = Math.floor(gridY / 2);
        const place = { gridColumnStart: gridX + 1, gridRowStart: gridY + 1 };
        if (gridX % 2 === 0 && gridY % 2 === 0) {
          return <span key={cell} className="dots-joint" style={place} aria-hidden="true" />;
        }
        if (gridX % 2 === 1 && gridY % 2 === 1) {
          const owner = boxes[y * size + x];
          return <span key={cell} className="dots-box" data-owner={owner} style={place} aria-hidden="true">
            {markers[owner]}
          </span>;
        }

        const axis = gridY % 2 === 0 ? "h" : "v";
        const owner = axis === "h" ? horizontal[y * size + x] : vertical[y * (size + 1) + x];
        const start = coordinates(x, y);
        const end = axis === "h" ? coordinates(x + 1, y) : coordinates(x, y + 1);
        const last = state.last?.axis === axis && state.last.x === x && state.last.y === y;
        const name = owner ? names[owner - 1] : null;
        const label = name ? t(`${start} 到 ${end}，${name}的线`, `${start} to ${end}, drawn by ${name}`, `${start} a ${end}, trazada por ${name}`)
          : t(`连接 ${start} 和 ${end}`, `Connect ${start} and ${end}`, `Une ${start} y ${end}`);
        return <button key={cell} type="button" style={place} className="dots-edge" data-testid="dots-edge"
          data-axis={axis} data-x={x} data-y={y} data-owner={owner} data-last={last || undefined}
          aria-label={label} disabled={!mine || busy || owner > 0} onClick={() => void draw(axis, x, y)} />;
      })}
    </div>
    {match.status === "finished" ? (
      <div className="game-actions">
        <button type="button" className="game-primary" onClick={onRematch} data-testid="game-rematch">
          <ArrowsClockwise size={16} />{t("再玩一局", "Play again", "Otra partida")}
        </button>
      </div>
    ) : (
      <p className="dots-rule">{t("围成一格得一分，再连一条线。", "Close a box to score and draw again.", "Cierra un cuadro para sumar un punto y volver a trazar.")}</p>
    )}
  </section>;
}
