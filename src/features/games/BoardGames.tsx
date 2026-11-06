import { useState } from "react";
import { ArrowsClockwise, Flag } from "@phosphor-icons/react";
import { localized } from "../../i18n";
import type { ScreenProps } from "./MatchScreen";
import "./small-games.css";

// 黑白棋 and 四子棋 (game batch 2): boards where a tap is the move. Shared: the two players, whose turn, resign and play again.
type ReversiState = { board: string; black: string; white: string; next: "b" | "w"; last: [number, number] | null; flipped?: number[]; passed: string | null; winner: string | null; draw: boolean; resignedBy: string | null; legal: Array<[number, number]>; counts: { b: number; w: number } };
type FourState = { grid: string; red: string; yellow: string; next: "r" | "y"; last: [number, number] | null; winner: string | null; line: Array<[number, number]> | null; draw: boolean; resignedBy: string | null };

function Footer({ props, mine, resign }: { props: ScreenProps; mine: boolean; resign: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(props.language, zh, en, es);
  const [confirming, setConfirming] = useState(false);
  if (props.match.status !== "active") return <div className="game-actions"><button type="button" className="game-primary" onClick={props.onRematch} data-testid="game-rematch"><ArrowsClockwise size={16} />{t("再来一盘", "Play again", "Otra partida")}</button></div>;
  return <>
    <div className="game-actions"><button type="button" className={`game-quiet ${confirming ? "is-confirm" : ""}`} onClick={() => { if (!confirming) { setConfirming(true); return; } setConfirming(false); resign(); }} onBlur={() => setConfirming(false)} data-testid="game-resign"><Flag size={16} />{confirming ? t("确定认输", "Really resign", "Rendirme de verdad") : t("认输", "Resign", "Rendirse")}</button></div>
    <p className="game-note">{mine || props.opponent.pet ? t("点一下就落子。", "Tap to play.", "Toca para jugar.") : t("不用一直等着，轮到你时会提醒你。", "No need to wait here: you'll be told when it's your move.", "No hace falta esperar: te avisamos cuando te toque.")}</p>
  </>;
}

function result(props: ScreenProps, state: { winner: string | null; draw: boolean; resignedBy: string | null }, turnLabel: string) {
  const t = (zh: string, en: string, es: string) => localized(props.language, zh, en, es);
  if (props.match.status === "active") return props.match.turn === props.userId ? turnLabel : t(`等 ${props.partnerName} 下…`, `Waiting for ${props.partnerName}…`, `Esperando a ${props.partnerName}…`);
  if (state.draw) return t("平局！", "A draw!", "¡Empate!");
  if (state.winner === props.userId) return state.resignedBy ? t(`${props.partnerName} 认输了，你赢了！`, `${props.partnerName} resigned. You win!`, `${props.partnerName} se rindió. ¡Ganaste!`) : t("你赢了！", "You win!", "¡Ganaste!");
  return state.resignedBy ? t("你认输了，下一盘再来。", "You resigned. Next game!", "Te rendiste. ¡A la próxima!") : t(`${props.partnerName} 赢了这盘。`, `${props.partnerName} won this one.`, `${props.partnerName} ganó esta.`);
}

export function Reversi(props: ScreenProps<ReversiState>) {
  const { match, userId, act, partnerName } = props;
  const t = (zh: string, en: string, es: string) => localized(props.language, zh, en, es);
  const state = match.state, [busy, setBusy] = useState(false);
  const mine = match.turn === userId && match.status === "active";
  const legal = new Set(state.legal.map(([x, y]) => `${x},${y}`)), flipped = new Set(state.flipped || []);
  const me = state.black === userId ? "b" : "w";
  const play = async (x: number, y: number) => { if (!mine || busy || !legal.has(`${x},${y}`)) return; setBusy(true); await act({ type: "move", x, y }); setBusy(false); };
  const status = result(props, state, t(`轮到你了（${me === "b" ? "黑" : "白"}）`, `Your move (${me === "b" ? "black" : "white"})`, `Te toca (${me === "b" ? "negras" : "blancas"})`));
  return <div className="small-game">
    <div className="gomoku-players">
      <span className={state.next === "b" && match.status === "active" ? "is-turn" : ""}><i className="stone is-black" />{state.black === userId ? t("你", "You", "Tú") : partnerName} · {state.counts.b}</span>
      <span className={state.next === "w" && match.status === "active" ? "is-turn" : ""}><i className="stone is-white" />{state.white === userId ? t("你", "You", "Tú") : partnerName} · {state.counts.w}</span>
    </div>
    <p className={`gomoku-status ${match.status !== "active" && state.winner === userId ? "is-win" : ""}`} role="status" data-testid="reversi-status">{status}</p>
    {state.passed && match.status === "active" && <p className="game-note">{state.passed === userId ? t("你没地方下，这一手跳过了。", "You had no move, so your turn was skipped.", "No tenías jugada; se saltó tu turno.") : t(`${partnerName} 没地方下，又轮到你。`, `${partnerName} had no move; your turn again.`, `${partnerName} no tenía jugada; te toca otra vez.`)}</p>}
    <div className="reversi-board" role="grid" aria-label={t("黑白棋棋盘", "Reversi board", "Tablero de Reversi")} data-testid="reversi-board">
      {state.board.split("").map((cell, index) => {
        const x = index % 8, y = Math.floor(index / 8), can = mine && legal.has(`${x},${y}`), last = state.last?.[0] === x && state.last?.[1] === y;
        return <button key={index} type="button" role="gridcell" className={`reversi-cell ${can ? "is-legal" : ""}`} disabled={!can || busy} onClick={() => void play(x, y)} aria-label={`${String.fromCharCode(65 + x)}${y + 1}`}>
          {cell !== "." && <i className={`reversi-disc is-${cell} ${flipped.has(index) ? "is-flipped" : ""} ${last ? "is-last" : ""}`} />}
        </button>;
      })}
    </div>
    <Footer props={props as ScreenProps} mine={mine} resign={() => void act({ type: "resign" })} />
  </div>;
}

export function ConnectFour(props: ScreenProps<FourState>) {
  const { match, userId, act, partnerName } = props;
  const t = (zh: string, en: string, es: string) => localized(props.language, zh, en, es);
  const state = match.state, [busy, setBusy] = useState(false);
  const mine = match.turn === userId && match.status === "active";
  const four = new Set((state.line || []).map(([x, y]) => `${x},${y}`));
  const me = state.red === userId ? "r" : "y";
  const drop = async (column: number) => { if (!mine || busy || state.grid[column] !== ".") return; setBusy(true); await act({ type: "drop", column }); setBusy(false); };
  const status = result(props, state, t("轮到你了，点一列投下去", "Your move: tap a column", "Te toca: toca una columna"));
  return <div className="small-game">
    <div className="gomoku-players">
      <span className={state.next === "r" && match.status === "active" ? "is-turn" : ""}><i className="four-dot is-r" />{state.red === userId ? t("你", "You", "Tú") : partnerName}</span>
      <span className={state.next === "y" && match.status === "active" ? "is-turn" : ""}><i className="four-dot is-y" />{state.yellow === userId ? t("你", "You", "Tú") : partnerName}</span>
    </div>
    <p className={`gomoku-status ${match.status !== "active" && state.winner === userId ? "is-win" : ""}`} role="status" data-testid="four-status">{status}</p>
    <div className={`four-board ${mine ? "is-mine" : ""}`} data-testid="four-board">
      {Array.from({ length: 7 }, (_, column) => <button key={column} type="button" className="four-column" disabled={!mine || busy || state.grid[column] !== "."} onClick={() => void drop(column)} aria-label={t(`第 ${column + 1} 列`, `Column ${column + 1}`, `Columna ${column + 1}`)} data-testid="four-column">
        {Array.from({ length: 6 }, (_, y) => { const cell = state.grid[y * 7 + column], last = state.last?.[0] === column && state.last?.[1] === y; return <i key={y} className={`four-slot ${cell !== "." ? `is-${cell}` : ""} ${four.has(`${column},${y}`) ? "is-four" : ""} ${last ? "is-last" : ""} ${mine && cell === "." ? `can-${me}` : ""}`} />; })}
      </button>)}
    </div>
    <Footer props={props as ScreenProps} mine={mine} resign={() => void act({ type: "resign" })} />
  </div>;
}
