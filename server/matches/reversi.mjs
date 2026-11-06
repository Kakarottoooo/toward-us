import { matchError } from "./errors.mjs";

// 黑白棋 (founder 11-06, batch 2): 8 x 8 Othello. Black moves first; a move must flip at least one line of the other colour;
// a player with no move passes automatically; when neither can move, the one with more discs wins. Whoever did not play
// black last time plays black next time.
export const SIZE = 8;
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const at = (board, x, y) => board[y * SIZE + x];

function flips(board, x, y, color) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || at(board, x, y) !== ".") return [];
  const other = color === "b" ? "w" : "b", all = [];
  for (const [dx, dy] of DIRECTIONS) {
    const line = []; let cx = x + dx, cy = y + dy;
    while (cx >= 0 && cy >= 0 && cx < SIZE && cy < SIZE && at(board, cx, cy) === other) { line.push(cy * SIZE + cx); cx += dx; cy += dy; }
    if (line.length && cx >= 0 && cy >= 0 && cx < SIZE && cy < SIZE && at(board, cx, cy) === color) all.push(...line);
  }
  return all;
}
export function legalMoves(board, color) {
  const moves = [];
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) { const flipped = flips(board, x, y, color); if (flipped.length) moves.push({ x, y, flipped }); }
  return moves;
}
const count = (board, color) => board.split("").filter((cell) => cell === color).length;
const colorOf = (state, userId) => state.black === userId ? "b" : "w";
const playerOf = (state, color) => color === "b" ? state.black : state.white;

function initialBoard() {
  const cells = Array(SIZE * SIZE).fill(".");
  cells[3 * SIZE + 3] = "w"; cells[3 * SIZE + 4] = "b"; cells[4 * SIZE + 3] = "b"; cells[4 * SIZE + 4] = "w";
  return cells.join("");
}

// 小家伙: corners are gold, the squares next to them are traps; among the rest, the move that flips most.
const WEIGHT = [
  100, -20, 10, 5, 5, 10, -20, 100, -20, -40, -2, -2, -2, -2, -40, -20, 10, -2, 1, 1, 1, 1, -2, 10, 5, -2, 1, 0, 0, 1, -2, 5,
  5, -2, 1, 0, 0, 1, -2, 5, 10, -2, 1, 1, 1, 1, -2, 10, -20, -40, -2, -2, -2, -2, -40, -20, 100, -20, 10, 5, 5, 10, -20, 100,
];

export const reversi = {
  id: "reversi",
  category: "board",
  start({ players, inviterUserId, previous = [] }) {
    const last = previous.find((match) => match.game === "reversi");
    const black = last ? players.find((id) => id !== last.state.black) || inviterUserId : inviterUserId;
    return { board: initialBoard(), black, white: players.find((id) => id !== black), next: "b", last: null, passed: null, winner: null, draw: false, resignedBy: null, moves: 0 };
  },
  turn(state) { return state.winner || state.draw ? null : playerOf(state, state.next); },
  act(state, { userId, action }) {
    if (state.winner || state.draw) throw matchError(409, "match_over");
    if (action?.type === "resign") return { ...state, resignedBy: userId, winner: userId === state.black ? state.white : state.black };
    if (action?.type !== "move") throw matchError(400, "invalid_action");
    if (reversi.turn(state) !== userId) throw matchError(409, "not_your_turn");
    const { x, y } = action, color = state.next;
    if (!Number.isInteger(x) || !Number.isInteger(y)) throw matchError(400, "invalid_action");
    const flipped = flips(state.board, x, y, color);
    if (!flipped.length) throw matchError(400, "invalid_action");
    const cells = state.board.split(""); cells[y * SIZE + x] = color; for (const index of flipped) cells[index] = color;
    const board = cells.join(""), other = color === "b" ? "w" : "b";
    // The other side moves next if it can; otherwise it passes, and if neither can move the game is over.
    let next = other, passed = null;
    if (!legalMoves(board, other).length) { if (legalMoves(board, color).length) { next = color; passed = playerOf(state, other); } else next = null; }
    const done = next === null, b = count(board, "b"), w = count(board, "w");
    return { ...state, board, next: next || color, last: [x, y], flipped, passed, moves: state.moves + 1, winner: done && b !== w ? playerOf(state, b > w ? "b" : "w") : null, draw: done && b === w };
  },
  finished(state) { return Boolean(state.winner || state.draw); },
  view(state, userId) { return { ...state, legal: reversi.turn(state) === userId ? legalMoves(state.board, colorOf(state, userId)).map(({ x, y }) => [x, y]) : [], counts: { b: count(state.board, "b"), w: count(state.board, "w") } }; },
  stats(matches) {
    const wins = {}; let draws = 0;
    for (const match of matches) { if (match.state.winner) wins[match.state.winner] = (wins[match.state.winner] || 0) + 1; else if (match.state.draw) draws += 1; }
    return { wins, draws, played: matches.length };
  },
  petInstant: true,
  async petActions({ state }) {
    const moves = legalMoves(state.board, state.next);
    if (!moves.length) return [];
    const best = moves.reduce((top, move) => { const score = WEIGHT[move.y * SIZE + move.x] * 10 + move.flipped.length; return !top || score > top.score ? { ...move, score } : top; }, null);
    return [{ type: "move", x: best.x, y: best.y }];
  },
};
