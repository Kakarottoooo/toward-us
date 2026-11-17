import { matchError } from "./errors.mjs";

const rooms = [
  [
    "#######",
    "#..#..#",
    "#.A#..#",
    "#.CD.G#",
    "#..#+B#",
    "#..#..#",
    "#######",
  ],
  [
    "########",
    "#A..#..#",
    "#...#..#",
    "#.C.D.G#",
    "#...#.+#",
    "#...#C.#",
    "#...#GB#",
    "########",
  ],
  [
    "########",
    "#A...G.#",
    "#..C.C.#",
    "#.#...##",
    "###D####",
    "#...+B.#",
    "#.....G#",
    "#......#",
    "########",
  ],
].map((rows) => {
  const width = rows[0].length;
  const map = rows.join("");
  const cellsOf = (tile) => Array.from(map, (value, index) => value === tile ? index : -1).filter((index) => index !== -1);
  return {
    width,
    walls: cellsOf("#"),
    doors: cellsOf("D"),
    plates: cellsOf("+"),
    goals: cellsOf("G"),
    initialCrates: cellsOf("C"),
    initialPositions: [map.indexOf("A"), map.indexOf("B")],
    size: map.length,
  };
});

const directions = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const stepsPerTurn = 3;

function adjacent(room, cell, direction) {
  if (!Object.hasOwn(directions, direction)) return -1;
  const [dx, dy] = directions[direction];
  const x = cell % room.width + dx;
  const y = Math.floor(cell / room.width) + dy;
  return x < 0 || x >= room.width || y < 0 || y >= room.size / room.width ? -1 : y * room.width + x;
}

function hasOpenDoor(room, state) {
  return state.positions.some((cell) => room.plates.includes(cell));
}

function legalMove(state, direction) {
  const room = rooms[state.room];
  const opened = hasOpenDoor(room, state);
  const clear = (cell) => cell !== -1 && !room.walls.includes(cell) && !state.positions.includes(cell)
    && (opened || !room.doors.includes(cell));
  const tile = adjacent(room, state.positions[state.activeMover], direction);
  if (!clear(tile)) return null;
  if (!state.crates.includes(tile)) return { tile, beyond: null };
  const beyond = adjacent(room, tile, direction);
  return clear(beyond) && !state.crates.includes(beyond) ? { tile, beyond } : null;
}

function roomStart(room, players, revision = 0) {
  return {
    room,
    players,
    positions: [...rooms[room].initialPositions],
    crates: [...rooms[room].initialCrates],
    activeMover: 0,
    remaining: stepsPerTurn,
    moves: 0,
    revision,
  };
}

const complete = (state) => state.crates.every((cell) => rooms[state.room].goals.includes(cell));

export const sokoban = {
  id: "sokoban",
  category: "puzzle",
  start({ players, inviterUserId, previous = [] }) {
    const last = previous[0]?.state;
    const first = last ? players.find((player) => player !== last.players[0]) : inviterUserId;
    const room = last ? (last.room + 1) % rooms.length : 0;
    return roomStart(room, [first, players.find((player) => player !== first)]);
  },
  turn(state) {
    return complete(state) ? null : state.players[state.activeMover];
  },
  finished: complete,
  act(state, { userId, action }) {
    if (complete(state)) throw matchError(409, "match_over");
    if (!state.players.includes(userId)) throw matchError(404, "not_found");
    if (action?.revision !== state.revision) throw matchError(409, "match_changed");
    const revision = state.revision + 1;
    if (action.type === "reset") return roomStart(state.room, state.players, revision);
    if (userId !== state.players[state.activeMover]) throw matchError(409, "not_your_turn");
    if (action.type === "pass") return { ...state, revision, activeMover: 1 - state.activeMover, remaining: stepsPerTurn };
    if (action.type !== "move") throw matchError(400, "invalid_action");

    const move = legalMove(state, action.direction);
    if (!move) throw matchError(409, "invalid_action");
    const positions = [...state.positions];
    positions[state.activeMover] = move.tile;
    const crates = move.beyond === null ? state.crates : state.crates.map((cell) => cell === move.tile ? move.beyond : cell);
    const remaining = state.remaining - 1;
    return {
      ...state,
      positions,
      crates,
      revision,
      moves: state.moves + 1,
      activeMover: remaining ? state.activeMover : 1 - state.activeMover,
      remaining: remaining || stepsPerTurn,
    };
  },
  view(state, userId) {
    const { width, size, walls, doors, plates, goals } = rooms[state.room];
    const legal = sokoban.turn(state) === userId ? Object.keys(directions).filter((direction) => legalMove(state, direction)) : [];
    return { ...state, width, size, walls, doors, plates, goals, legal, doorOpen: hasOpenDoor(rooms[state.room], state) };
  },
  stats(matches) {
    return { played: matches.length };
  },
};
