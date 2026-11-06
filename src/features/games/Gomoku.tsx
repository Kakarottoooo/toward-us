import { useState, type MouseEvent } from "react";
import { ArrowsClockwise, Flag } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import type { Act } from "./MatchScreen";
import type { GomokuState, MatchView } from "./types";

const STEP = 20, EDGE = 20;
const at = (index: number) => EDGE + index * STEP;
const STARS = [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];

/** 五子棋: the board. Tap a point to pick it (a faint stone), tap it again or press 落子 to place it. */
export function Gomoku({ match, language, userId, partnerName, act, onRematch }: { match: MatchView<GomokuState>; language: Language; userId: string; partnerName: string; act: Act; onRematch: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const { state } = match;
  const [pick, setPick] = useState<[number, number] | null>(null), [busy, setBusy] = useState(false), [resigning, setResigning] = useState(false);
  const size = state.size, span = EDGE * 2 + STEP * (size - 1);
  const mine = match.turn === userId && match.status === "active";
  const myColor = state.black === userId ? "black" : "white";
  const taken = new Map(state.moves.map(([x, y], index) => [`${x},${y}`, index % 2 === 0 ? "black" : "white"]));
  const winning = new Set((state.line || []).map(([x, y]) => `${x},${y}`));
  const last = state.moves.at(-1);
  const place = async (point: [number, number]) => { if (busy) return; setBusy(true); if (await act({ type: "move", x: point[0], y: point[1] })) setPick(null); setBusy(false); };
  const tap = (event: MouseEvent<SVGSVGElement>) => {
    if (!mine || busy) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = Math.round(((event.clientX - box.left) / box.width * span - EDGE) / STEP), y = Math.round(((event.clientY - box.top) / box.height * span - EDGE) / STEP);
    if (x < 0 || y < 0 || x >= size || y >= size || taken.has(`${x},${y}`)) return;
    if (pick && pick[0] === x && pick[1] === y) void place(pick); else setPick([x, y]);
  };
  const status = match.status !== "active"
    ? state.draw ? t("和棋！棋盘下满了。", "A draw: the board is full.", "Empate: el tablero está lleno.")
      : state.winner === userId ? (state.resignedBy ? t(`${partnerName} 认输了，你赢了！`, `${partnerName} resigned. You win!`, `${partnerName} se rindió. ¡Ganaste!`) : t("五子连珠，你赢了！", "Five in a row. You win!", "¡Cinco en línea! ¡Ganaste!"))
      : state.resignedBy ? t("你认输了，下一盘再来。", "You resigned. Next game!", "Te rendiste. ¡A la próxima!") : t(`${partnerName} 赢了这盘。`, `${partnerName} won this one.`, `${partnerName} ganó esta.`)
    : mine ? t(`轮到你了（${myColor === "black" ? "黑" : "白"}）`, `Your move (${myColor})`, `Te toca (${myColor === "black" ? "negras" : "blancas"})`) : t(`等 ${partnerName} 下…`, `Waiting for ${partnerName}…`, `Esperando a ${partnerName}…`);
  return <div className="gomoku">
    <div className="gomoku-players">
      <span className={match.turn === state.black && match.status === "active" ? "is-turn" : ""}><i className="stone is-black" />{state.black === userId ? t("你", "You", "Tú") : partnerName}</span>
      <span className={match.turn === state.white && match.status === "active" ? "is-turn" : ""}><i className="stone is-white" />{state.white === userId ? t("你", "You", "Tú") : partnerName}</span>
    </div>
    <p className={`gomoku-status ${match.status !== "active" && state.winner === userId ? "is-win" : ""}`} role="status" data-testid="gomoku-status">{status}</p>
    <svg className={`gomoku-board ${mine ? "is-mine" : ""}`} viewBox={`0 0 ${span} ${span}`} onClick={tap} role="img" aria-label={t(`五子棋棋盘，已下 ${state.moves.length} 手`, `Gomoku board, ${state.moves.length} moves played`, `Tablero de Gomoku, ${state.moves.length} jugadas`)} data-testid="gomoku-board">
      <rect x="0" y="0" width={span} height={span} rx="10" className="gomoku-wood" />
      {Array.from({ length: size }, (_, index) => <g key={index}><line x1={at(0)} y1={at(index)} x2={at(size - 1)} y2={at(index)} /><line x1={at(index)} y1={at(0)} x2={at(index)} y2={at(size - 1)} /></g>)}
      {STARS.map(([x, y]) => <circle key={`${x},${y}`} cx={at(x)} cy={at(y)} r="2.2" className="gomoku-star" />)}
      {state.moves.map(([x, y], index) => <circle key={`${x},${y}`} cx={at(x)} cy={at(y)} r="8.6" className={`gomoku-stone is-${index % 2 === 0 ? "black" : "white"} ${winning.has(`${x},${y}`) ? "is-five" : ""}`} data-testid="gomoku-stone" />)}
      {last && <circle cx={at(last[0])} cy={at(last[1])} r="2.6" className="gomoku-last" />}
      {pick && mine && <circle cx={at(pick[0])} cy={at(pick[1])} r="8.6" className={`gomoku-stone is-${myColor} is-pick`} />}
    </svg>
    {match.status === "active" ? <div className="game-actions">
      <button type="button" className="game-primary" disabled={!mine || !pick || busy} onClick={() => pick && void place(pick)} data-testid="gomoku-place">{t("落子", "Place", "Colocar")}</button>
      <button type="button" className={`game-quiet ${resigning ? "is-confirm" : ""}`} onClick={() => { if (!resigning) { setResigning(true); return; } setResigning(false); void act({ type: "resign" }); }} onBlur={() => setResigning(false)} data-testid="gomoku-resign"><Flag size={16} />{resigning ? t("确定认输", "Really resign", "Rendirme de verdad") : t("认输", "Resign", "Rendirse")}</button>
    </div> : <div className="game-actions"><button type="button" className="game-primary" onClick={onRematch} data-testid="game-rematch"><ArrowsClockwise size={16} />{t("再来一盘", "Play again", "Otra partida")}</button></div>}
    {match.status === "active" && <p className="game-note">{mine ? t("点一下选位置，再点一次落子。", "Tap to pick a spot, tap again to place.", "Toca para elegir, toca otra vez para colocar.") : t("不用一直等着，轮到你时会提醒你。", "No need to wait here: you'll be told when it's your move.", "No hace falta esperar: te avisamos cuando te toque.")}</p>}
  </div>;
}
