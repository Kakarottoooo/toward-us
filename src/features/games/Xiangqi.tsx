import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { ArrowsClockwise, Flag } from "@phosphor-icons/react";
import { localized } from "../../i18n";
import type { ScreenProps } from "./MatchScreen";
import "./xiangqi.css";

// server/matches/xiangqi.mjs: the board is 90 characters, row by row from black's back rank; red upper case, black lower case.
export type XiangqiState = {
  red: string; black: string; board: string; moves: Array<[number, number]>; check: boolean;
  winner: string | null; draw: boolean; ending: "checkmate" | "stalemate" | "resign" | "limit" | null; resignedBy: string | null;
  legal?: Record<string, number[]>;
};

const COLS = 9, ROWS = 10, STEP = 40, WIDTH = COLS * STEP, HEIGHT = ROWS * STEP;
// Traditional characters in Chinese; elsewhere the letters the rules explain (no Chinese in English or Spanish).
const ZH: Record<string, string> = { K: "帥", A: "仕", E: "相", R: "俥", H: "傌", C: "炮", P: "兵", k: "將", a: "士", e: "象", r: "車", h: "馬", c: "砲", p: "卒" };
const isRed = (piece: string) => piece !== "." && piece === piece.toUpperCase();
const moved = (board: string, from: number, to: number) => { const cells = board.split(""); cells[to] = cells[from]; cells[from] = "."; return cells.join(""); };

/** 象棋: tap one of your pieces to light up where it may go, then tap one of those points. Your side is always at the bottom. */
export function Xiangqi({ match, language, userId, partnerName, opponent, act, onRematch }: ScreenProps<XiangqiState>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const state = match.state;
  // 小家伙's answer comes back with my move; my move shows first and its answer a beat later, as if it thought about it.
  const before = useRef({ board: state.board, plies: state.moves.length }), [thinking, setThinking] = useState<string | null>(null);
  const plies = state.moves.length, mineBefore = state.moves[plies - 2];
  useLayoutEffect(() => {
    const previous = before.current; before.current = { board: state.board, plies };
    if (opponent.pet && plies - previous.plies === 2 && mineBefore) setThinking(moved(previous.board, mineBefore[0], mineBefore[1]));
  }, [state.board, plies, mineBefore, opponent.pet]);
  // Its own timer, so a reload of the same position (the open App is told about every move) doesn't leave it thinking.
  useEffect(() => { if (!thinking) return; const timer = setTimeout(() => setThinking(null), 650); return () => clearTimeout(timer); }, [thinking]);
  const [pick, setPick] = useState<number | null>(null), [sent, setSent] = useState<[number, number] | null>(null), [resigning, setResigning] = useState(false);
  const red = state.red === userId, flip = !red;
  const active = match.status === "active";
  const mine = match.turn === userId && active && !thinking && !sent;
  const board = thinking ?? (sent ? moved(state.board, sent[0], sent[1]) : state.board);
  const last = sent ?? (thinking ? state.moves[state.moves.length - 2] : state.moves[state.moves.length - 1]);
  const legal = mine ? state.legal || {} : {};
  const targets = new Set(pick !== null ? legal[pick] || [] : []);
  const point = (index: number) => { const x = index % COLS, y = (index - x) / COLS; return { cx: ((flip ? COLS - 1 - x : x) + 0.5) * STEP, cy: ((flip ? ROWS - 1 - y : y) + 0.5) * STEP }; };
  const checked = active && state.check && !thinking && !sent ? board.indexOf(match.turn === state.red ? "K" : "k") : -1;

  const move = async (from: number, to: number) => { setPick(null); setSent([from, to]); await act({ type: "move", from, to }); setSent(null); };
  const tap = (event: MouseEvent<SVGSVGElement>) => {
    if (!mine) return;
    const box = event.currentTarget.getBoundingClientRect();
    const dx = Math.min(COLS - 1, Math.max(0, Math.floor((event.clientX - box.left) / box.width * COLS)));
    const dy = Math.min(ROWS - 1, Math.max(0, Math.floor((event.clientY - box.top) / box.height * ROWS)));
    const index = (flip ? ROWS - 1 - dy : dy) * COLS + (flip ? COLS - 1 - dx : dx);
    if (pick !== null && targets.has(index)) { void move(pick, index); return; }
    const piece = board[index];
    setPick(piece !== "." && isRed(piece) === red && index !== pick ? index : null);
  };

  const won = state.winner === userId;
  const status = thinking ? t(`${partnerName} 在想…`, `${partnerName} is thinking…`, `${partnerName} está pensando…`) : !active
    ? state.draw ? t("和棋：各走 150 步还没分出胜负。", "A draw: no result after 150 moves each.", "Empate: sin resultado tras 150 movimientos cada uno.")
      : state.ending === "resign" ? won ? t(`${partnerName} 认输了，你赢了！`, `${partnerName} resigned. You win!`, `${partnerName} se rindió. ¡Ganaste!`) : t("你认输了，下一盘再来。", "You resigned. Next game!", "Te rendiste. ¡A la próxima!")
      : state.ending === "stalemate" ? won ? t(`${partnerName} 无棋可走，你赢了！`, `${partnerName} has no legal move. You win!`, `${partnerName} no tiene movimientos. ¡Ganaste!`) : t(`你无棋可走，${partnerName} 赢了这盘。`, `You have no legal move. ${partnerName} won this one.`, `No tienes movimientos. ${partnerName} ganó esta.`)
      : won ? t("将死！你赢了！", "Checkmate. You win!", "¡Jaque mate! ¡Ganaste!") : t(`被将死了，${partnerName} 赢了这盘。`, `Checkmate. ${partnerName} won this one.`, `Jaque mate. ${partnerName} ganó esta.`)
    : mine ? t(`轮到你了（${red ? "红" : "黑"}）`, `Your move (${red ? "red" : "black"})`, `Te toca (${red ? "rojas" : "negras"})`) : t(`等 ${partnerName} 走…`, `Waiting for ${partnerName}…`, `Esperando a ${partnerName}…`);
  const face = (id: string) => id === userId ? t("你", "You", "Tú") : <>{opponent.picture && <img src={opponent.picture} alt="" className="gomoku-face" />}{partnerName}</>;
  const redTurn = thinking ? !red : match.turn === state.red;
  const label = (piece: string) => language === "zh" ? ZH[piece] : piece.toUpperCase();
  const line = (x1: number, y1: number, x2: number, y2: number, key: string) => <line key={key} x1={(x1 + 0.5) * STEP} y1={(y1 + 0.5) * STEP} x2={(x2 + 0.5) * STEP} y2={(y2 + 0.5) * STEP} />;

  return <div className="xiangqi">
    <div className="gomoku-players">
      <span className={active && redTurn ? "is-turn" : ""}><i className="xiangqi-dot is-red" />{face(state.red)}</span>
      <span className={active && !redTurn ? "is-turn" : ""}><i className="xiangqi-dot is-black" />{face(state.black)}</span>
    </div>
    <p className={`gomoku-status ${!active && won ? "is-win" : ""}`} role="status" data-testid="xiangqi-status">{status}</p>
    {checked >= 0 && <p className="xiangqi-check" role="alert" data-testid="xiangqi-check">{t("将军！", "Check!", "¡Jaque!")}</p>}
    <svg className={`xiangqi-board ${mine ? "is-mine" : ""}`} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} onClick={tap} role="img" aria-label={t(`象棋棋盘，已走 ${state.moves.length} 步`, `Chinese chess board, ${state.moves.length} moves played`, `Tablero de ajedrez chino, ${state.moves.length} jugadas`)} data-testid="xiangqi-board">
      <rect x="0" y="0" width={WIDTH} height={HEIGHT} rx="10" className="xiangqi-wood" />
      <g className="xiangqi-lines">
        {Array.from({ length: ROWS }, (_, y) => line(0, y, COLS - 1, y, `r${y}`))}
        {Array.from({ length: COLS }, (_, x) => x === 0 || x === COLS - 1 ? line(x, 0, x, ROWS - 1, `c${x}`) : [line(x, 0, x, 4, `t${x}`), line(x, 5, x, ROWS - 1, `b${x}`)])}
        {line(3, 0, 5, 2, "p1")}{line(5, 0, 3, 2, "p2")}{line(3, 7, 5, 9, "p3")}{line(5, 7, 3, 9, "p4")}
      </g>
      <text x={WIDTH / 2} y={HEIGHT / 2} className="xiangqi-river">{t("楚 河　　　漢 界", "river", "río")}</text>
      {last && <circle cx={point(last[0]).cx} cy={point(last[0]).cy} r="6" className="xiangqi-from" />}
      {Array.from(board).map((piece, index) => {
        if (piece === ".") return null;
        const { cx, cy } = point(index), classes = ["xiangqi-piece", isRed(piece) ? "is-red" : "is-black", index === pick ? "is-pick" : "", last && index === last[1] ? "is-last" : "", index === checked ? "is-checked" : "", targets.has(index) ? "is-target" : ""].filter(Boolean).join(" ");
        return <g key={index} className={classes} data-testid="xiangqi-piece" data-square={index}>
          <circle cx={cx} cy={cy} r="17.5" /><circle cx={cx} cy={cy} r="14.5" className="xiangqi-ring" />
          <text x={cx} y={cy} className={language === "zh" ? "is-zh" : ""}>{label(piece)}</text>
        </g>;
      })}
      {[...targets].filter((index) => board[index] === ".").map((index) => <circle key={`d${index}`} cx={point(index).cx} cy={point(index).cy} r="6.5" className="xiangqi-dest" data-testid="xiangqi-dest" />)}
    </svg>
    {active || thinking ? <div className="game-actions">
      <button type="button" className={`game-quiet ${resigning ? "is-confirm" : ""}`} onClick={() => { if (!resigning) { setResigning(true); return; } setResigning(false); void act({ type: "resign" }); }} onBlur={() => setResigning(false)} data-testid="xiangqi-resign"><Flag size={16} />{resigning ? t("确定认输", "Really resign", "Rendirme de verdad") : t("认输", "Resign", "Rendirse")}</button>
    </div> : <div className="game-actions"><button type="button" className="game-primary" onClick={onRematch} data-testid="game-rematch"><ArrowsClockwise size={16} />{t("再来一盘", "Play again", "Otra partida")}</button></div>}
    {active && <p className="game-note">{mine || opponent.pet ? t("点自己的棋子，再点亮起的位置。", "Tap your piece, then a lit-up spot.", "Toca tu pieza y luego un punto iluminado.") : t("不用一直等着，轮到你时会提醒你。", "No need to wait here: you'll be told when it's your move.", "No hace falta esperar: te avisamos cuando te toque.")}</p>}
  </div>;
}
