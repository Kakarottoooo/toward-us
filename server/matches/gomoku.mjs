import { matchError } from "./errors.mjs";

// 五子棋 (founder 11-06): free-style gomoku on a 15 x 15 board. Black moves first; five or more in a row wins; a full board is
// a draw; either player may resign. Whoever did not play black in their last game plays black in the next one.
export const SIZE = 15;
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];

export const gomoku = {
  id: "gomoku",
  category: "board",
  start({ players, inviterUserId, previous = [] }) {
    const last = previous.find((match) => match.game === "gomoku");
    const black = last ? players.find((id) => id !== last.state.black) || inviterUserId : inviterUserId;
    return { size: SIZE, black, white: players.find((id) => id !== black), moves: [], winner: null, line: null, draw: false, resignedBy: null };
  },
  turn(state) {
    if (state.winner || state.draw) return null;
    return state.moves.length % 2 === 0 ? state.black : state.white;
  },
  act(state, { userId, action }) {
    if (action?.type === "resign") {
      if (state.winner || state.draw) throw matchError(409, "match_over");
      return { ...state, resignedBy: userId, winner: userId === state.black ? state.white : state.black };
    }
    if (action?.type !== "move") throw matchError(400, "invalid_action");
    if (state.winner || state.draw) throw matchError(409, "match_over");
    if (gomoku.turn(state) !== userId) throw matchError(409, "not_your_turn");
    const { x, y } = action;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= state.size || y >= state.size) throw matchError(400, "invalid_action");
    if (state.moves.some(([mx, my]) => mx === x && my === y)) throw matchError(409, "occupied");
    const moves = [...state.moves, [x, y]];
    const line = fiveFrom(moves, x, y, state.size);
    return { ...state, moves, winner: line ? userId : null, line, draw: !line && moves.length === state.size * state.size };
  },
  finished(state) { return Boolean(state.winner || state.draw); },
  view(state) { return state; },
  /** Wins of each player over their finished games; the hall shows it as "3 : 2". */
  stats(matches) {
    const wins = {}; let draws = 0;
    for (const match of matches) { if (match.state.winner) wins[match.state.winner] = (wins[match.state.winner] || 0) + 1; else if (match.state.draw) draws += 1; }
    return { wins, draws, played: matches.length };
  },
};

/** The run of five or more (at most the whole run) through the stone just placed at x, y, or null. */
export function fiveFrom(moves, x, y, size = SIZE) {
  const mine = new Set(moves.filter((_, index) => index % 2 === (moves.length - 1) % 2).map(([mx, my]) => `${mx},${my}`));
  for (const [dx, dy] of DIRECTIONS) {
    const run = [[x, y]];
    for (const sign of [1, -1]) {
      let cx = x + dx * sign, cy = y + dy * sign;
      while (cx >= 0 && cy >= 0 && cx < size && cy < size && mine.has(`${cx},${cy}`)) { run.push([cx, cy]); cx += dx * sign; cy += dy * sign; }
    }
    if (run.length >= 5) return run.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }
  return null;
}

// 小家伙 as the other player (founder 11-06): a quick local evaluator, no model. Every empty point near the stones is scored
// by the lines it would make for itself (attack) and break for the other side (defence); it wins when it can, blocks a five
// or an open four, and otherwise plays the best score. Strong enough to play a real game, never instant-perfect.
const LINE_SCORE = (length, open) => length >= 5 ? 1_000_000 : length === 4 ? (open === 2 ? 100_000 : open === 1 ? 12_000 : 0) : length === 3 ? (open === 2 ? 6_000 : open === 1 ? 500 : 0) : length === 2 ? (open === 2 ? 300 : open === 1 ? 40 : 0) : open === 2 ? 10 : open === 1 ? 2 : 0;

function pointScore(board, size, x, y, color) {
  let total = 0;
  for (const [dx, dy] of DIRECTIONS) {
    let length = 1, open = 0;
    for (const sign of [1, -1]) {
      let cx = x + dx * sign, cy = y + dy * sign;
      while (cx >= 0 && cy >= 0 && cx < size && cy < size && board.get(`${cx},${cy}`) === color) { length += 1; cx += dx * sign; cy += dy * sign; }
      if (cx >= 0 && cy >= 0 && cx < size && cy < size && !board.has(`${cx},${cy}`)) open += 1;
    }
    total += LINE_SCORE(length, open);
  }
  return total;
}

/** The point the player to move should take: [x, y]. */
export function bestMove(state) {
  const size = state.size, me = state.moves.length % 2, board = new Map(state.moves.map(([x, y], index) => [`${x},${y}`, index % 2]));
  if (!state.moves.length) return [Math.floor(size / 2), Math.floor(size / 2)];
  let best = null, bestScore = -1;
  for (let x = 0; x < size; x += 1) for (let y = 0; y < size; y += 1) {
    if (board.has(`${x},${y}`)) continue;
    let near = false;
    for (let dx = -2; dx <= 2 && !near; dx += 1) for (let dy = -2; dy <= 2 && !near; dy += 1) if (board.has(`${x + dx},${y + dy}`)) near = true;
    if (!near) continue;
    // Its own line counts a little more than the same line of the other side: finishing beats blocking.
    const score = pointScore(board, size, x, y, me) * 1.1 + pointScore(board, size, x, y, 1 - me) + (7 - Math.max(Math.abs(x - 7), Math.abs(y - 7))) * 0.5;
    if (score > bestScore) { bestScore = score; best = [x, y]; }
  }
  return best;
}

gomoku.petActions = async ({ state }) => { const point = bestMove(state); return point ? [{ type: "move", x: point[0], y: point[1] }] : []; };
gomoku.petInstant = true;
