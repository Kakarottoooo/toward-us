import { randomInt } from "node:crypto";
import { BOTH, matchError } from "./errors.mjs";

const size = 6;
const lengths = [3, 2, 2];

function shipCells({ x, y, orientation }, length) {
  const row = orientation === "row";
  return Array.from({ length }, (_, offset) => (y + (row ? 0 : offset)) * size + x + (row ? offset : 0));
}

function fits({ x, y, orientation }, length) {
  return (orientation === "row" || orientation === "column") && Number.isInteger(x) && Number.isInteger(y)
    && x >= 0 && y >= 0 && x + (orientation === "row" ? length : 1) <= size
    && y + (orientation === "column" ? length : 1) <= size;
}

function makeFleet() {
  const occupied = new Set();
  return lengths.map((length) => {
    const options = [];
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        for (const orientation of ["row", "column"]) {
          const place = { x, y, orientation };
          if (fits(place, length) && !shipCells(place, length).some((cell) => occupied.has(cell))) options.push(place);
        }
      }
    }
    const place = options[randomInt(options.length)];
    for (const cell of shipCells(place, length)) occupied.add(cell);
    return place;
  });
}

function owner(state, userId) {
  const seat = state.players.indexOf(userId);
  if (seat < 0) throw matchError(404, "not_found");
  return seat;
}

function burntShips(fleet, shots) {
  const hits = new Set(shots.map(({ cell }) => cell));
  return fleet.map((placement, index) => shipCells(placement, lengths[index]).every((cell) => hits.has(cell)));
}

function replace(values, index, value) {
  return values.map((item, current) => current === index ? value : item);
}

export const battleship = {
  id: "battleship",
  category: "board",
  start({ players, inviterUserId, previous = [] }) {
    const lastStarter = previous[0]?.state.first;
    const first = players.includes(lastStarter) ? players.find((player) => player !== lastStarter) : inviterUserId;
    return {
      players,
      first,
      next: first,
      fleets: players.map(() => makeFleet()),
      locked: players.map(() => false),
      revisions: players.map(() => 0),
      shots: players.map(() => []),
      shotCount: 0,
      winner: null,
    };
  },
  turn(state) {
    if (state.winner) return null;
    if (state.locked.every(Boolean)) return state.next;
    if (state.locked.some(Boolean)) return state.players[state.locked.indexOf(false)];
    return BOTH;
  },
  finished(state) { return state.winner !== null; },
  act(state, { userId, action }) {
    const seat = owner(state, userId);
    const opponent = 1 - seat;
    if (state.winner) throw matchError(409, "match_over");

    if (!state.locked[seat]) {
      if (action?.revision !== state.revisions[seat]) throw matchError(409, "match_changed");
      const revisions = replace(state.revisions, seat, state.revisions[seat] + 1);
      if (action.type === "lock") {
        return { ...state, revisions, locked: replace(state.locked, seat, true) };
      }
      if (action.type === "shuffle") {
        return { ...state, revisions, fleets: replace(state.fleets, seat, makeFleet()) };
      }

      const { index, x, y, orientation } = action;
      const place = { x, y, orientation };
      if (action.type !== "place" || !Number.isInteger(index) || index < 0 || index >= lengths.length
        || !fits(place, lengths[index])) throw matchError(400, "invalid_action");
      const cells = shipCells(place, lengths[index]);
      const overlap = state.fleets[seat].some((other, ship) =>
        ship !== index && shipCells(other, lengths[ship]).some((cell) => cells.includes(cell)));
      if (overlap) throw matchError(409, "invalid_action");
      const fleet = replace(state.fleets[seat], index, place);
      return { ...state, revisions, fleets: replace(state.fleets, seat, fleet) };
    }

    if (!state.locked[opponent] || state.next !== userId) throw matchError(409, "not_your_turn");
    if (action?.shotCount !== state.shotCount) throw matchError(409, "match_changed");
    const { cell } = action;
    if (action.type !== "fire" || !Number.isInteger(cell) || cell < 0 || cell >= size * size
      || state.shots[seat].some((shot) => shot.cell === cell)) throw matchError(400, "invalid_action");

    const enemyFleet = state.fleets[opponent];
    const hit = enemyFleet.some((ship, index) => shipCells(ship, lengths[index]).includes(cell));
    const salvo = [...state.shots[seat], { cell, hit }];
    const sunk = burntShips(enemyFleet, salvo);
    const previouslySunk = burntShips(enemyFleet, state.shots[seat]).filter(Boolean).length;
    const shots = replace(state.shots, seat, [...salvo.slice(0, -1), { cell, hit, sunk: sunk.filter(Boolean).length > previouslySunk }]);
    const winner = sunk.every(Boolean) ? userId : null;
    return {
      ...state,
      shots,
      shotCount: state.shotCount + 1,
      next: winner ? null : state.players[opponent],
      winner,
    };
  },
  view(state, userId) {
    const seat = owner(state, userId);
    const opponent = 1 - seat;
    return {
      size,
      lengths,
      fleet: state.fleets[seat],
      revealedFleet: state.winner ? state.fleets[opponent] : null,
      ready: state.locked[seat],
      partnerReady: state.locked[opponent],
      ownSunk: burntShips(state.fleets[seat], state.shots[opponent]).filter(Boolean).length,
      partnerSunk: burntShips(state.fleets[opponent], state.shots[seat]).filter(Boolean).length,
      sent: state.shots[seat],
      received: state.shots[opponent],
      revision: state.revisions[seat],
      shotCount: state.shotCount,
      winner: state.winner,
    };
  },
  stats(matches) {
    const wins = {};
    for (const { state } of matches) {
      if (state.winner) wins[state.winner] = (wins[state.winner] || 0) + 1;
    }
    return { wins, played: matches.length };
  },
};
