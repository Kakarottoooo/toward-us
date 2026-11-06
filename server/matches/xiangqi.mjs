import { matchError } from "./errors.mjs";

// 象棋 (founder 11-06): standard xiangqi on the 9 x 10 board. Red moves first; a move that leaves your own general in check
// (the two generals facing each other on an open file counts) is not allowed; a side with no legal move loses (checkmate or
// stalemate); either player may resign; after 300 plies without a result it is a draw. Whoever did not play red in their last
// game plays red in the next one.
// The board is a 90-character string, row by row from black's back rank (y = 0) to red's (y = 9): red pieces are upper case,
// black lower case, "." is empty. K general, A advisor, E elephant, H horse, R chariot, C cannon, P soldier.
export const COLS = 9, ROWS = 10, PLY_LIMIT = 300;
export const START = [
  "rheakaehr",
  ".........",
  ".c.....c.",
  "p.p.p.p.p",
  ".........",
  ".........",
  "P.P.P.P.P",
  ".C.....C.",
  ".........",
  "RHEAKAEHR",
].join("");

const RED = "KAEHRCP";
export const colorOf = (piece) => piece === "." || piece === undefined ? null : RED.includes(piece) ? "red" : "black";
const other = (color) => color === "red" ? "black" : "red";
const on = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS;
const at = (x, y) => y * COLS + x;
const inPalace = (x, y, color) => x >= 3 && x <= 5 && (color === "red" ? y >= 7 && y <= 9 : y >= 0 && y <= 2);
const ownHalf = (y, color) => color === "red" ? y >= 5 : y <= 4;
const forward = (color) => color === "red" ? -1 : 1;
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]], DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const HORSE = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];

/** The squares the piece on `from` can reach, before asking whether its own general is left in check. */
function targets(board, from) {
  const piece = board[from], color = colorOf(piece), x = from % COLS, y = (from - x) / COLS, out = [];
  const add = (tx, ty) => { if (on(tx, ty) && colorOf(board[at(tx, ty)]) !== color) out.push(at(tx, ty)); };
  switch (piece.toUpperCase()) {
    case "K": for (const [dx, dy] of ORTHO) if (inPalace(x + dx, y + dy, color)) add(x + dx, y + dy); break;
    case "A": for (const [dx, dy] of DIAG) if (inPalace(x + dx, y + dy, color)) add(x + dx, y + dy); break;
    // Two points diagonally, never over the river, and not when the point in between (its "eye") is taken.
    case "E": for (const [dx, dy] of DIAG) if (on(x + 2 * dx, y + 2 * dy) && ownHalf(y + 2 * dy, color) && board[at(x + dx, y + dy)] === ".") add(x + 2 * dx, y + 2 * dy); break;
    // One point straight, then one diagonally outwards; a piece on that first point (its "leg") blocks both.
    case "H": for (const [dx, dy] of ORTHO) {
      if (!on(x + dx, y + dy) || board[at(x + dx, y + dy)] !== ".") continue;
      for (const side of [-1, 1]) add(x + 2 * dx + (dx ? 0 : side), y + 2 * dy + (dy ? 0 : side));
    } break;
    case "R": for (const [dx, dy] of ORTHO) for (let cx = x + dx, cy = y + dy; on(cx, cy); cx += dx, cy += dy) {
      const target = board[at(cx, cy)];
      if (target === ".") { out.push(at(cx, cy)); continue; }
      if (colorOf(target) !== color) out.push(at(cx, cy));
      break;
    } break;
    // Moves like a chariot, but captures only by jumping exactly one piece (its "screen").
    case "C": for (const [dx, dy] of ORTHO) {
      let screen = false;
      for (let cx = x + dx, cy = y + dy; on(cx, cy); cx += dx, cy += dy) {
        const target = board[at(cx, cy)];
        if (!screen) { if (target === ".") out.push(at(cx, cy)); else screen = true; continue; }
        if (target === ".") continue;
        if (colorOf(target) !== color) out.push(at(cx, cy));
        break;
      }
    } break;
    case "P": add(x, y + forward(color)); if (!ownHalf(y, color)) { add(x - 1, y); add(x + 1, y); } break;
  }
  return out;
}

/** True when `color`'s general is attacked, or faces the other general on an open file. */
export function inCheck(board, color) {
  const king = board.indexOf(color === "red" ? "K" : "k");
  if (king < 0) return true;
  const enemy = other(color), kind = (piece) => colorOf(piece) === enemy ? piece.toUpperCase() : null;
  const kx = king % COLS, ky = (king - kx) / COLS;
  for (const [dx, dy] of ORTHO) {
    let screens = 0;
    for (let cx = kx + dx, cy = ky + dy; on(cx, cy); cx += dx, cy += dy) {
      const piece = board[at(cx, cy)];
      if (piece === ".") continue;
      const found = kind(piece);
      if (!screens && (found === "R" || (found === "K" && !dx))) return true;
      if (screens === 1 && found === "C") return true;
      if (++screens > 1) break;
    }
  }
  for (const [dx, dy] of HORSE) {
    const hx = kx - dx, hy = ky - dy;
    if (!on(hx, hy) || kind(board[at(hx, hy)]) !== "H") continue;
    if (board[at(hx + (Math.abs(dx) === 2 ? Math.sign(dx) : 0), hy + (Math.abs(dy) === 2 ? Math.sign(dy) : 0))] === ".") return true;
  }
  if (on(kx, ky - forward(enemy)) && kind(board[at(kx, ky - forward(enemy))]) === "P") return true;
  if (!ownHalf(ky, enemy)) for (const sx of [kx - 1, kx + 1]) if (on(sx, ky) && kind(board[at(sx, ky)]) === "P") return true;
  return false;
}

/** Every legal move of `color` as [from, to] (square indexes). */
export function legalMoves(board, color) {
  const cells = typeof board === "string" ? board.split("") : board, moves = [];
  for (let from = 0; from < cells.length; from += 1) {
    if (colorOf(cells[from]) !== color) continue;
    for (const to of targets(cells, from)) {
      const taken = cells[to]; cells[to] = cells[from]; cells[from] = ".";
      if (!inCheck(cells, color)) moves.push([from, to]);
      cells[from] = cells[to]; cells[to] = taken;
    }
  }
  return moves;
}

export function play(board, from, to) { const cells = board.split(""); cells[to] = cells[from]; cells[from] = "."; return cells.join(""); }
const toMove = (state) => state.moves.length % 2 === 0 ? "red" : "black";
const square = (value) => Number.isInteger(value) && value >= 0 && value < COLS * ROWS;

export const xiangqi = {
  id: "xiangqi",
  category: "board",
  start({ players, inviterUserId, previous = [] }) {
    const last = previous.find((match) => match.game === "xiangqi");
    const red = last ? players.find((id) => id !== last.state.red) || inviterUserId : inviterUserId;
    return { red, black: players.find((id) => id !== red), board: START, moves: [], check: false, winner: null, draw: false, ending: null, resignedBy: null };
  },
  turn(state) {
    if (state.winner || state.draw) return null;
    return toMove(state) === "red" ? state.red : state.black;
  },
  act(state, { userId, action }) {
    if (action?.type === "resign") {
      if (state.winner || state.draw) throw matchError(409, "match_over");
      if (userId !== state.red && userId !== state.black) throw matchError(400, "invalid_action");
      return { ...state, resignedBy: userId, ending: "resign", winner: userId === state.red ? state.black : state.red };
    }
    if (action?.type !== "move") throw matchError(400, "invalid_action");
    if (state.winner || state.draw) throw matchError(409, "match_over");
    if (xiangqi.turn(state) !== userId) throw matchError(409, "not_your_turn");
    const { from, to } = action, color = toMove(state);
    if (!square(from) || !square(to) || !legalMoves(state.board, color).some(([f, t]) => f === from && t === to)) throw matchError(400, "invalid_action");
    const board = play(state.board, from, to), moves = [...state.moves, [from, to]];
    const check = inCheck(board, other(color)), stuck = legalMoves(board, other(color)).length === 0;
    if (stuck) return { ...state, board, moves, check, winner: userId, ending: check ? "checkmate" : "stalemate" };
    if (moves.length >= PLY_LIMIT) return { ...state, board, moves, check, draw: true, ending: "limit" };
    return { ...state, board, moves, check };
  },
  finished(state) { return Boolean(state.winner || state.draw); },
  /** Everything is public; the player to move also gets their legal moves, { from: [to, ...] }, to light up on the board. */
  view(state, userId) {
    if (xiangqi.turn(state) !== userId) return state;
    const legal = {};
    for (const [from, to] of legalMoves(state.board, toMove(state))) (legal[from] ||= []).push(to);
    return { ...state, legal };
  },
  /** Wins of each player over their finished games, like 五子棋. */
  stats(matches) {
    const wins = {}; let draws = 0, played = 0;
    for (const match of matches) {
      if (match.status !== "finished") continue;
      played += 1;
      if (match.state.winner) wins[match.state.winner] = (wins[match.state.winner] || 0) + 1; else if (match.state.draw) draws += 1;
    }
    return { wins, draws, played };
  },
};

// 小家伙 as the other player: a small alpha-beta search, three plies deep plus captures, on material and a few positional
// terms (soldiers over the river, horses and cannons towards the centre). Local, no model, and stopped well under a second.
const VALUE = { K: 0, A: 200, E: 200, H: 400, R: 900, C: 450, P: 100 };
const MATE = 1_000_000;

function pieceScore(piece, index) {
  const kind = piece.toUpperCase(), color = colorOf(piece), x = index % COLS, y = (index - x) / COLS;
  const advance = color === "red" ? 9 - y : y, centre = 4 - Math.abs(x - 4);
  let score = VALUE[kind];
  if (kind === "P" && !ownHalf(y, color)) score += 70 + centre * 10 - (advance === 9 ? 50 : 0);
  if (kind === "H") score += centre * 8 + Math.min(advance, 6) * 4;
  if (kind === "C" && x === 4) score += 20;
  if (kind === "R") score += Math.min(advance, 6) * 3;
  return score;
}

/** The position's score for `color`. */
function evaluate(cells, color) {
  let score = 0;
  for (let index = 0; index < cells.length; index += 1) {
    const piece = cells[index];
    if (piece !== ".") score += colorOf(piece) === color ? pieceScore(piece, index) : -pieceScore(piece, index);
  }
  return score;
}

const victim = (cells, [from, to]) => cells[to] === "." ? 0 : VALUE[cells[to].toUpperCase()] * 10 - VALUE[cells[from].toUpperCase()] / 100 + 1;
const ordered = (cells, moves) => moves.map((move) => [victim(cells, move), move]).sort((a, b) => b[0] - a[0]).map(([, move]) => move);
const STOP = Symbol("stop");

function search(cells, color, depth, alpha, beta, ply, clock) {
  if (Date.now() > clock.deadline) throw STOP;
  const moves = legalMoves(cells, color);
  if (!moves.length) return -MATE + ply;
  let captures = false;
  if (depth <= 0) {
    // Only captures from here, a few plies at most, so a trade isn't judged halfway through.
    const stand = evaluate(cells, color);
    if (stand >= beta || depth <= -4) return stand;
    if (stand > alpha) alpha = stand;
    captures = true;
  }
  for (const [from, to] of ordered(cells, moves)) {
    if (captures && cells[to] === ".") break;
    const taken = cells[to]; cells[to] = cells[from]; cells[from] = ".";
    let score;
    try { score = -search(cells, other(color), depth - 1, -beta, -alpha, ply + 1, clock); }
    finally { cells[from] = cells[to]; cells[to] = taken; }
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return alpha;
}

/** The move the player to move should make, [from, to], or null when there is none. Three plies, deepened while time allows. */
export function bestMove(state, { depth = 3, budgetMs = 450 } = {}) {
  const cells = state.board.split(""), color = toMove(state), clock = { deadline: Date.now() + budgetMs };
  // A little shuffle first, so equal choices differ from game to game.
  let moves = ordered(cells, legalMoves(cells, color).sort(() => Math.random() - 0.5));
  if (!moves.length) return null;
  let best = moves[0];
  for (let level = 1; level <= depth; level += 1) {
    let alpha = -Infinity, choice = null;
    try {
      for (const [from, to] of moves) {
        const taken = cells[to]; cells[to] = cells[from]; cells[from] = ".";
        let score;
        try { score = -search(cells, other(color), level - 1, -Infinity, -alpha, 1, clock); }
        finally { cells[from] = cells[to]; cells[to] = taken; }
        if (score > alpha) { alpha = score; choice = [from, to]; }
      }
    } catch (error) { if (error === STOP) break; throw error; }
    best = choice || best;
    moves = [best, ...moves.filter((move) => move !== best && !(move[0] === best[0] && move[1] === best[1]))];
    if (alpha >= MATE - 10) break;
  }
  return best;
}

xiangqi.petActions = async ({ state }) => { const move = bestMove(state); return move ? [{ type: "move", from: move[0], to: move[1] }] : []; };
xiangqi.petInstant = true;
