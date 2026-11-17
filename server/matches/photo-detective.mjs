import { matchError } from "./errors.mjs";

const questions = new Set(["where", "when", "what"]);
const text = (input, limit) => typeof input === "string" ? input.trim().replace(/\0/g, "").slice(0, limit) : "";

export const photoDetective = {
  id: "detective",
  category: "puzzle",
  start({ players, inviterUserId, previous }) {
    const lastHost = previous[0]?.state.host;
    const host = players.find((id) => lastHost && id !== lastHost) || inviterUserId;
    return { host, detective: players.find((id) => id !== host), photoId: null, crop: null, question: null, answer: null, guess: null };
  },
  turn(state) {
    return state.guess ? null : state.photoId ? state.detective : state.host;
  },
  act(state, { userId, action }) {
    if (state.guess) throw matchError(409, "match_over");
    if (action?.type === "create_clue") {
      if (userId !== state.host || state.photoId) throw matchError(409, "not_your_turn");
      const answer = text(action.answer, 160);
      if (typeof action.photoId !== "string" || !Number.isInteger(action.crop) || action.crop < 0 || action.crop > 8 ||
        !questions.has(action.question) || !answer) throw matchError(400, "invalid_action");
      return { ...state, photoId: action.photoId, crop: action.crop, question: action.question, answer };
    }
    if (action?.type === "guess") {
      if (userId !== state.detective || !state.photoId) throw matchError(409, "not_your_turn");
      const guess = text(action.text, 160);
      if (!guess) throw matchError(400, "invalid_action");
      return { ...state, guess };
    }
    throw matchError(400, "invalid_action");
  },
  finished(state) { return Boolean(state.guess); },
  view(state, userId) {
    return {
      hosting: userId === state.host, hasClue: Boolean(state.photoId), question: state.question,
      answer: userId === state.host || state.guess ? state.answer : null,
      guess: state.guess,
    };
  },
  stats(matches) { return { played: matches.filter((match) => Boolean(match.state.guess)).length }; },
};
