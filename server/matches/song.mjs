import { matchError } from "./errors.mjs";

const BEATS = 8;
const ALL_DRUMS = 7;
const NOTES = 5;

function pattern(value, low, high) {
  if (!Array.isArray(value) || value.length !== BEATS ||
    value.some((step) => !Number.isInteger(step) || step < low || step > high) ||
    value.every((step) => step === low)) {
    throw matchError(400, "invalid_action");
  }
  return [...value];
}

export const song = {
  id: "song",
  category: "casual",
  start({ players, inviterUserId, previous }) {
    const last = previous?.[0]?.state;
    const drummer = last ? players.find((id) => id !== last.drummer) : inviterUserId;
    return { players, drummer, drums: null, melody: null };
  },
  turn(state) {
    if (state.melody) return null;
    if (!state.drums) return state.drummer;
    return state.players.find((id) => id !== state.drummer);
  },
  act(state, { userId, action }) {
    if (this.turn(state) !== userId) throw matchError(409, "not_your_turn");
    if (!state.drums && action.type === "drums") return { ...state, drums: pattern(action.steps, 0, ALL_DRUMS) };
    if (state.drums && action.type === "melody") return { ...state, melody: pattern(action.steps, -1, NOTES - 1) };
    throw matchError(400, "invalid_action");
  },
  finished(state) { return state.melody !== null; },
  view(state) { return state; },
  stats(matches) { return { played: matches.filter((match) => match.status === "finished").length }; },
  announce() {
    return {
      zh: "你们的歌写好了。回到这局，随时都能再听。",
      en: "Your song is ready. Open this game anytime to listen again.",
      es: "Su canción está lista. Abran esta partida cuando quieran volver a escucharla.",
    };
  },
};
