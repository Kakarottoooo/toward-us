import { randomInt } from "node:crypto";
import { BOTH, matchError } from "./errors.mjs";

const SIZE = 7;
const COUNT = SIZE * SIZE;
const CELLS = Array.from({ length: COUNT }, (_, index) => index);
const adjacent = CELLS.map((index) => CELLS.filter((other) => other !== index &&
  Math.abs(index % SIZE - other % SIZE) <= 1 && Math.abs(Math.floor(index / SIZE) - Math.floor(other / SIZE)) <= 1));

function minefield(first, count) {
  const excluded = new Set([first, ...adjacent[first]]);
  const options = CELLS.filter((index) => !excluded.has(index));
  const mines = [];
  while (mines.length < count) mines.push(options.splice(randomInt(options.length), 1)[0]);
  return mines;
}

function openCells(start, mines, flags, opened) {
  const found = new Set(opened);
  const blocked = new Set(mines);
  const queue = [start];
  while (queue.length) {
    const index = queue.pop();
    if (found.has(index) || flags.includes(index) || blocked.has(index)) continue;
    found.add(index);
    if (!adjacent[index].some((cell) => blocked.has(cell))) queue.push(...adjacent[index]);
  }
  return [...found];
}

export const minesDuo = {
  id: "mines-duo",
  category: "puzzle",
  start({ players, previous }) {
    const variant = previous[0] ? (previous[0].state.variant + 1) % 3 : 0;
    return { players, variant, mines: [], count: 8 + variant, opened: [], flags: [], hints: 2, explosion: null, outcome: null, revision: 0 };
  },
  turn(state) { return state.outcome ? null : BOTH; },
  finished(state) { return Boolean(state.outcome); },
  act(state, { userId, action }) {
    if (!state.players.includes(userId)) throw matchError(404, "not_found");
    if (state.outcome) throw matchError(409, "match_over");
    if (action?.revision !== state.revision) throw matchError(409, "game_board_changed");
    const revision = state.revision + 1;
    const { index } = action;
    if (action.type === "hint") {
      if (!state.mines.length || state.hints < 1) throw matchError(400, "invalid_action");
      const target = CELLS.find((cell) => !state.mines.includes(cell) && !state.opened.includes(cell) && !state.flags.includes(cell));
      if (target === undefined) throw matchError(400, "invalid_action");
      const opened = openCells(target, state.mines, state.flags, state.opened);
      return { ...state, opened, hints: state.hints - 1, outcome: opened.length + state.count === COUNT ? "win" : null, revision };
    }
    if (!Number.isInteger(index) || index < 0 || index >= COUNT || state.opened.includes(index)) throw matchError(400, "invalid_action");
    if (action.type === "flag") {
      const flags = state.flags.includes(index) ? state.flags.filter((cell) => cell !== index) : [...state.flags, index];
      if (flags.length > state.count) throw matchError(400, "invalid_action");
      return { ...state, flags, revision };
    }
    if (action.type !== "open" || state.flags.includes(index)) throw matchError(400, "invalid_action");
    const mines = state.mines.length ? state.mines : minefield(index, state.count);
    if (mines.includes(index)) return { ...state, explosion: index, outcome: "loss", revision };
    const opened = openCells(index, mines, state.flags, state.opened);
    return { ...state, mines, opened, outcome: opened.length + state.count === COUNT ? "win" : null, revision };
  },
  view(state) {
    const opened = new Set(state.opened), flags = new Set(state.flags), mines = new Set(state.mines);
    const cells = CELLS.map((index) => {
      if (state.explosion === index) return { kind: "hit" };
      if (state.outcome && mines.has(index)) return { kind: "mine" };
      if (state.outcome && flags.has(index)) return { kind: "incorrect" };
      if (flags.has(index)) return { kind: "flag" };
      if (opened.has(index)) return { kind: "open", count: adjacent[index].filter((cell) => mines.has(cell)).length };
      return { kind: "hidden" };
    });
    return { cells, size: SIZE, count: state.count, flags: flags.size, opened: opened.size, safe: COUNT - state.count, hints: state.hints, outcome: state.outcome, revision: state.revision };
  },
  stats(matches) { return { played: matches.filter(({ status }) => status === "finished").length }; },
};
