import { randomInt } from "node:crypto";
import { BOTH, matchError } from "./errors.mjs";

const pictures = ["yosemite", "autumn", "reef"];
const pieceCount = 16;
const isPiece = (value) => Number.isInteger(value) && value >= 0 && value < pieceCount;
const isComplete = (state) => state.placed.every((owner) => owner !== null);

function shufflePieces() {
  const order = Array.from({ length: pieceCount }, (_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return order;
}

export const jigsaw = {
  id: "jigsaw",
  category: "puzzle",
  start({ previous = [] }) {
    const recent = new Set(previous.slice(0, pictures.length - 1).map((match) => match.state.picture));
    const next = pictures.filter((picture) => !recent.has(picture));
    return {
      picture: next[randomInt(next.length)],
      photoId: null,
      layout: 0,
      order: shufflePieces(),
      placed: Array(pieceCount).fill(null),
    };
  },
  turn(state) {
    return isComplete(state) ? null : BOTH;
  },
  act(state, { userId, action }) {
    if (isComplete(state)) throw matchError(409, "match_over");
    if (action?.type === "photo") {
      if (typeof action.photoId !== "string" || !action.photoId) throw matchError(400, "invalid_action");
      if (state.photoId === action.photoId) return state;
      if (state.photoId || state.placed.some((owner) => owner !== null)) throw matchError(409, "match_changed");
      return { ...state, photoId: action.photoId, layout: state.layout + 1, order: shufflePieces() };
    }
    if (action?.type !== "place" || !isPiece(action.piece) || !isPiece(action.slot)) {
      throw matchError(400, "invalid_action");
    }
    if (action.layout !== state.layout) throw matchError(409, "match_changed");
    if (action.piece !== action.slot) throw matchError(400, "invalid_action");
    if (state.placed[action.slot] !== null) return state;
    const placed = [...state.placed];
    placed[action.slot] = userId;
    return { ...state, placed };
  },
  finished: isComplete,
  view(state) {
    return state;
  },
  stats(matches) {
    return { assembled: matches.filter(({ state }) => isComplete(state)).length, played: matches.length };
  },
};
