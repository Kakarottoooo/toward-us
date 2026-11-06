import { matchError } from "./errors.mjs";

// 四子棋 (founder 11-06, batch 2): 7 columns x 6 rows. Discs drop to the lowest free spot of the chosen column; four in a row
// (any direction) wins; a full board is a draw. Red goes first; whoever did not go first last time goes first next time.
export const COLUMNS = 7, ROWS = 6;
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const cell = (grid, x, y) => grid[y * COLUMNS + x];
const dropRow = (grid, column) => { for (let y = ROWS - 1; y >= 0; y -= 1) if (cell(grid, column, y) === ".") return y; return -1; };

/** The four (or more) through x, y for `color`, or null. */
export function fourFrom(grid, x, y, color) {
  for (const [dx, dy] of DIRECTIONS) {
    const run = [[x, y]];
    for (const sign of [1, -1]) {
      let cx = x + dx * sign, cy = y + dy * sign;
      while (cx >= 0 && cy >= 0 && cx < COLUMNS && cy < ROWS && cell(grid, cx, cy) === color) { run.push([cx, cy]); cx += dx * sign; cy += dy * sign; }
    }
    if (run.length >= 4) return run;
  }
  return null;
}
const place = (grid, column, color) => { const y = dropRow(grid, column); if (y < 0) return null; const cells = grid.split(""); cells[y * COLUMNS + column] = color; return { grid: cells.join(""), y }; };

export const connectFour = {
  id: "connect4",
  category: "board",
  start({ players, inviterUserId, previous = [] }) {
    const last = previous.find((match) => match.game === "connect4");
    const red = last ? players.find((id) => id !== last.state.red) || inviterUserId : inviterUserId;
    return { grid: ".".repeat(COLUMNS * ROWS), red, yellow: players.find((id) => id !== red), next: "r", last: null, winner: null, line: null, draw: false, resignedBy: null };
  },
  turn(state) { return state.winner || state.draw ? null : state.next === "r" ? state.red : state.yellow; },
  act(state, { userId, action }) {
    if (state.winner || state.draw) throw matchError(409, "match_over");
    if (action?.type === "resign") return { ...state, resignedBy: userId, winner: userId === state.red ? state.yellow : state.red };
    if (action?.type !== "drop") throw matchError(400, "invalid_action");
    if (connectFour.turn(state) !== userId) throw matchError(409, "not_your_turn");
    const column = action.column;
    if (!Number.isInteger(column) || column < 0 || column >= COLUMNS) throw matchError(400, "invalid_action");
    const placed = place(state.grid, column, state.next);
    if (!placed) throw matchError(409, "occupied");
    const line = fourFrom(placed.grid, column, placed.y, state.next);
    return { ...state, grid: placed.grid, last: [column, placed.y], next: state.next === "r" ? "y" : "r", winner: line ? userId : null, line, draw: !line && !placed.grid.includes(".") };
  },
  finished(state) { return Boolean(state.winner || state.draw); },
  view(state) { return state; },
  stats(matches) {
    const wins = {}; let draws = 0;
    for (const match of matches) { if (match.state.winner) wins[match.state.winner] = (wins[match.state.winner] || 0) + 1; else if (match.state.draw) draws += 1; }
    return { wins, draws, played: matches.length };
  },
  petInstant: true,
  // 小家伙: takes a win, blocks one, never drops where the other side wins right on top of it, and likes the middle.
  async petActions({ state }) {
    const me = state.next, them = me === "r" ? "y" : "r";
    const open = [3, 2, 4, 1, 5, 0, 6].filter((column) => dropRow(state.grid, column) >= 0);
    if (!open.length) return [];
    const wins = (grid, column, color) => { const placed = place(grid, column, color); return placed && fourFrom(placed.grid, column, placed.y, color); };
    const pick = open.find((column) => wins(state.grid, column, me)) ?? open.find((column) => wins(state.grid, column, them))
      ?? open.find((column) => { const placed = place(state.grid, column, me); return !open.concat(column).some((next) => wins(placed.grid, next, them)); }) ?? open[0];
    return [{ type: "drop", column: pick }];
  },
};
