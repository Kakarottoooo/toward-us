import { randomInt } from "node:crypto";
import { BOTH, matchError } from "./errors.mjs";

const attempts = 3;
const size = 3;
const stamps = ["star", "moon", "heart"];
const scenes = {
  camp: ["tent", "lantern", "fire", "tree", "boot", "mug", "compass", "backpack", "map"],
  beach: ["shell", "kite", "sunhat", "bucket", "lantern", "lemon", "boat", "camera", "towel"],
  market: ["basket", "apple", "flowers", "baguette", "tea", "camera", "lemon", "jar", "book"],
  garden: ["flowers", "butterfly", "wateringcan", "bee", "tree", "basket", "lantern", "leaf", "mug"],
  station: ["ticket", "suitcase", "clock", "book", "umbrella", "camera", "compass", "mug", "map"],
  picnic: ["basket", "mug", "apple", "lemon", "baguette", "flowers", "kite", "book", "compass"],
};

function shuffled(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = randomInt(index + 1);
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

const rowOf = (index) => Math.floor(index / size);
const columnOf = (index) => index % size;
const adjacent = (a, b) => Math.abs(rowOf(a) - rowOf(b)) + Math.abs(columnOf(a) - columnOf(b)) === 1;

function makeClues(tiles, target) {
  const possibilities = [
    { kind: "row", value: rowOf(target) },
    { kind: "column", value: columnOf(target) },
    { kind: "stamp", value: tiles[target].stamp },
    ...tiles.flatMap((tile, index) => adjacent(index, target) ? [{ kind: "near", value: tile.item }] : []),
  ];
  const matches = (clue, tile, index) => {
    if (clue.kind === "row") return rowOf(index) === clue.value;
    if (clue.kind === "column") return columnOf(index) === clue.value;
    if (clue.kind === "stamp") return tile.stamp === clue.value;
    return adjacent(index, tiles.findIndex((entry) => entry.item === clue.value));
  };
  const pairs = [];
  possibilities.forEach((first, index) => {
    for (const second of possibilities.slice(index + 1)) {
      if (first.kind === "row" && second.kind === "column") continue;
      if (tiles.filter((tile, spot) => matches(first, tile, spot) && matches(second, tile, spot)).length === 1) pairs.push([first, second]);
    }
  });
  // A row and a column provide a valid fallback.
  return shuffled(pairs.length > 0 ? pairs[randomInt(pairs.length)] : possibilities.slice(0, 2));
}

export const treasureHunt = {
  id: "hunt",
  category: "puzzle",
  start({ players, previous }) {
    const recent = new Set(previous.slice(0, Object.keys(scenes).length - 1).map((match) => match.state.scene));
    const available = Object.keys(scenes).filter((name) => !recent.has(name));
    const scene = available[randomInt(available.length)];
    const marks = shuffled([...stamps, ...stamps, ...stamps]);
    const tiles = shuffled(scenes[scene]).map((item, index) => ({ item, stamp: marks[index] }));
    const target = randomInt(tiles.length);
    return { players: [...players], scene, tiles, target, clues: makeClues(tiles, target), shared: [], picks: {}, tried: [], result: null };
  },
  turn(state) {
    if (state.result) return null;
    const ready = Object.keys(state.picks);
    return ready.length === 1 ? state.players.find((id) => id !== ready[0]) : BOTH;
  },
  act(state, { userId, action }) {
    if (state.result) throw matchError(409, "match_over");
    if (action?.type === "share") {
      if (state.shared.includes(userId)) return state;
      return { ...state, shared: [...state.shared, userId] };
    }
    if (action?.type !== "pick" || !Number.isInteger(action.index) || !state.tiles[action.index] || state.tried.includes(action.index)) {
      throw matchError(400, "invalid_action");
    }
    if (action.attempt !== state.tried.length) throw matchError(409, "match_changed");
    const picks = { ...state.picks, [userId]: action.index };
    if (!state.players.every((id) => picks[id] === action.index)) return { ...state, picks };
    if (action.index === state.target) return { ...state, picks, result: "found" };
    const tried = [...state.tried, action.index];
    return { ...state, tried, picks: {}, result: tried.length >= attempts ? "missed" : null };
  },
  finished(state) { return Boolean(state.result); },
  view(state, userId) {
    const partnerId = state.players.find((id) => id !== userId);
    const shared = state.shared.includes(userId);
    const mine = state.picks[userId] ?? null, theirs = state.picks[partnerId] ?? null;
    return {
      scene: state.scene, tiles: state.tiles,
      clue: state.clues[state.players.indexOf(userId)],
      partnerClue: state.result || state.shared.includes(partnerId) ? state.clues[state.players.indexOf(partnerId)] : null,
      shared, mine, partnerReady: theirs !== null, partnerPick: mine !== null ? theirs : null,
      tried: state.tried, attempts, result: state.result,
      ...(state.result ? { answer: state.target } : {}),
    };
  },
  stats(matches) {
    return { found: matches.filter((match) => match.state.result === "found").length, played: matches.filter((match) => Boolean(match.state.result)).length };
  },
};
