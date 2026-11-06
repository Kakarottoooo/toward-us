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
