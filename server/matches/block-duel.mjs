const WIDTH = 10;
const HEIGHT = 20;
const EMPTY_ROW = () => Array(WIDTH).fill(0);
const LOCK_DELAY = 0.45;
const LOCK_RESETS = 6;
const COMMANDS = new Set(["left", "right", "rotate", "down", "drop"]);

const SHAPES = [
  null,
  { center: 1.5, points: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  { center: null, points: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { center: 1, points: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  { center: 1, points: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  { center: 1, points: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  { center: 1, points: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  { center: 1, points: [[2, 0], [0, 1], [1, 1], [2, 1]] },
];

const TURNS = SHAPES.map((shape) => {
  if (!shape) return null;
  const turns = [shape.points];
  for (let turn = 1; turn < 4; turn += 1) {
    turns.push(shape.center === null ? shape.points : turns.at(-1).map(([x, y]) => [2 * shape.center - y, x]));
  }
  return turns;
});

function random(board) {
  let value = board.rng;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  board.rng = value >>> 0;
  return board.rng;
}

function refill(board) {
  if (board.queue.length >= 3) return;
  const bag = [1, 2, 3, 4, 5, 6, 7];
  for (let index = bag.length - 1; index > 0; index -= 1) {
    const other = random(board) % (index + 1);
    [bag[index], bag[other]] = [bag[other], bag[index]];
  }
  board.queue.push(...bag);
}

function positions(piece) {
  return TURNS[piece.kind][piece.rotation].map(([x, y]) => [x + piece.x, y + piece.y]);
}

function canPlace(grid, piece) {
  return positions(piece).every(([x, y]) => x >= 0 && x < WIDTH && y < HEIGHT && (y < 0 || !grid[y][x]));
}

function spawn(board) {
  refill(board);
  const kind = board.queue.shift();
  board.serial += 1;
  board.piece = { kind, x: kind === 2 ? 4 : 3, y: -1, rotation: 0 };
  board.gravity = 0;
  board.lock = 0;
  board.resets = 0;
  if (!canPlace(board.grid, board.piece)) board.topped = true;
}

function makeBoard(rng) {
  const board = { grid: Array.from({ length: HEIGHT }, EMPTY_ROW), queue: [], rng, serial: 0, lines: 0, incoming: 0,
    topped: false, piece: null, gravity: 0, lock: 0, resets: 0 };
  spawn(board);
  return board;
}

function tryMove(board, next, reset = false) {
  if (!canPlace(board.grid, next)) return false;
  board.piece = next;
  if (reset && board.lock > 0 && board.resets < LOCK_RESETS) {
    board.lock = 0;
    board.resets += 1;
  }
  return true;
}

function rotate(board) {
  const piece = board.piece;
  const rotation = (piece.rotation + 1) % 4;
  for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1], [-1, -1], [1, -1], [0, -2]]) {
    if (tryMove(board, { ...piece, rotation, x: piece.x + dx, y: piece.y + dy }, true)) return true;
  }
  return false;
}

function landing(board) {
  const piece = { ...board.piece };
  while (canPlace(board.grid, { ...piece, y: piece.y + 1 })) piece.y += 1;
  return piece;
}

function rise(board) {
  let inserted = 0;
  while (board.incoming > 0 && !board.topped) {
    board.incoming -= 1;
    if (board.grid.shift().some(Boolean)) board.topped = true;
    const row = Array(WIDTH).fill(8);
    row[((board.serial * 3) + inserted * 7) % WIDTH] = 0;
    board.grid.push(row);
    inserted += 1;
  }
}

function lockPiece(board) {
  const filled = positions(board.piece);
  if (filled.some(([, y]) => y < 0)) {
    board.topped = true;
    return 0;
  }
  for (const [x, y] of filled) board.grid[y][x] = board.piece.kind;
  const surviving = board.grid.filter((row) => !row.every(Boolean));
  const cleared = HEIGHT - surviving.length;
  board.lines += cleared;
  board.grid = [...Array.from({ length: cleared }, EMPTY_ROW), ...surviving];
  let attack = cleared === 4 ? 4 : Math.max(0, cleared - 1);
  const countered = Math.min(attack, board.incoming);
  attack -= countered;
  board.incoming -= countered;
  if (cleared === 0) rise(board);
  if (!board.topped) spawn(board);
  return attack;
}

function sendRows(state, seat, count) {
  const opponent = state.boards[1 - seat];
  opponent.incoming = Math.min(16, opponent.incoming + count);
}

function height(board) {
  const first = board.grid.findIndex((row) => row.some(Boolean));
  return first < 0 ? 0 : HEIGHT - first;
}

function finalScore(state, winner, reason) {
  return { winner, reason, lines: state.boards.map((board) => board.lines), heights: state.boards.map(height) };
}

function finishIfTopped(state) {
  const [one, two] = state.boards.map((board) => board.topped);
  if (one || two) state.result = finalScore(state, one === two ? null : one ? 1 : 0, "top-out");
}

function advance(board, elapsed, dt) {
  if (board.topped) return 0;
  const next = { ...board.piece, y: board.piece.y + 1 };
  if (!canPlace(board.grid, next)) {
    board.lock += dt;
    return board.lock >= LOCK_DELAY ? lockPiece(board) : 0;
  }
  board.gravity += dt;
  const interval = Math.max(0.12, 0.72 - board.lines * 0.019 - elapsed * 0.0026);
  if (board.gravity >= interval) {
    board.gravity -= interval;
    board.piece = next;
    board.lock = 0;
  }
  return 0;
}

function drawBoard(board, ghost) {
  const cells = board.grid.flat();
  if (!board.topped) {
    if (ghost) {
      for (const [x, y] of positions(landing(board))) if (y >= 0) cells[y * WIDTH + x] = 9;
    }
    for (const [x, y] of positions(board.piece)) if (y >= 0) cells[y * WIDTH + x] = board.piece.kind;
  }
  return cells.join("");
}

export const blockDuel = {
  id: "block-duel",
  category: "casual",
  durationMs: 150_000,
  boot({ variant = 0 } = {}) {
    const seed = (Math.imul((Number(variant) || 0) + 1, 0x9e3779b9) ^ 0x62d7a30d) >>> 0;
    return { boards: [makeBoard(seed || 1), makeBoard(seed || 1)], elapsed: 0, result: null };
  },
  input(state, seat, action) {
    if (state.result || (seat !== 0 && seat !== 1)) return false;
    const board = state.boards[seat];
    if (!COMMANDS.has(action?.type) || !Number.isInteger(action.piece) || action.piece < 1 || action.piece > board.serial) return false;
    // A delayed input belongs to the earlier piece, even if the player already sees the next one.
    if (board.topped || action.piece < board.serial) return true;
    const piece = board.piece;
    if (action.type === "left" || action.type === "right") {
      tryMove(board, { ...piece, x: piece.x + (action.type === "left" ? -1 : 1) }, true);
      return true;
    }
    if (action.type === "rotate") {
      rotate(board);
      return true;
    }
    if (action.type === "down") {
      tryMove(board, { ...piece, y: piece.y + 1 });
      return true;
    }
    board.piece = landing(board);
    sendRows(state, seat, lockPiece(board));
    finishIfTopped(state);
    return true;
  },
  tick(state, dt) {
    if (state.result) return;
    state.elapsed += dt;
    const outgoing = state.boards.map((board) => advance(board, state.elapsed, dt));
    for (const [seat, count] of outgoing.entries()) sendRows(state, seat, count);
    finishIfTopped(state);
  },
  view(state, seat) {
    const own = state.boards[seat], other = state.boards[1 - seat];
    const next = own.queue[0];
    return {
      own: drawBoard(own, true), other: drawBoard(other, false), piece: own.serial,
      lines: [own.lines, other.lines], incoming: own.incoming,
      next: { kind: next, cells: TURNS[next][0] },
    };
  },
  timeout(state) {
    const [one, two] = state.boards;
    const score = one.lines - two.lines || height(two) - height(one);
    return finalScore(state, score === 0 ? null : score > 0 ? 0 : 1, "time");
  },
};
