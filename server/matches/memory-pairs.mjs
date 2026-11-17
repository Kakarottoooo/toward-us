import { randomInt } from "node:crypto";
import { matchError } from "./errors.mjs";

const FACES = ["moon", "sun", "heart", "cloud", "flower", "star", "butterfly", "diamond", "umbrella", "leaf", "flame", "coffee"];
const PAIRS = 8;

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = randomInt(index + 1);
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return shuffled;
}

export const memoryPairs = {
  id: "memory-pairs",
  category: "puzzle",
  start({ players, inviterUserId, previous = [] }) {
    const lastStarter = previous[0]?.state.first;
    const first = players.includes(lastStarter) ? players.find((id) => id !== lastStarter) : inviterUserId;
    const faces = shuffle(FACES).slice(0, PAIRS);
    const best = previous.reduce((fewest, match) => Math.min(fewest, match.state.attempts), Infinity);
    return {
      players, first, next: first, deck: shuffle([...faces, ...faces]), matched: [], open: [],
      attempts: 0, revision: 0, last: null, best: Number.isFinite(best) ? best : null,
    };
  },
  turn(state) { return state.next; },
  finished(state) { return state.next === null; },
  act(state, { userId, action }) {
    if (memoryPairs.finished(state)) throw matchError(409, "match_over");
    if (state.next !== userId || !state.players.includes(userId)) throw matchError(409, "not_your_turn");
    if (action?.revision !== state.revision) throw matchError(409, "invalid_action");
    const revision = state.revision + 1;
    if (state.open.length === 2) {
      if (action.type !== "continue") throw matchError(409, "invalid_action");
      return { ...state, open: [], revision, last: null };
    }

    const { index } = action;
    if (action.type !== "flip" || !Number.isInteger(index) || index < 0 || index >= state.deck.length ||
        state.matched.includes(index) || state.open.includes(index)) throw matchError(400, "invalid_action");
    if (!state.open.length) return { ...state, open: [index], revision, last: null };

    const open = [...state.open, index];
    const equal = state.deck[open[0]] === state.deck[index];
    const matched = equal ? [...state.matched, ...open] : state.matched;
    const next = matched.length === state.deck.length ? null : state.players.find((id) => id !== userId);
    return {
      ...state, next, matched, open: equal ? [] : open, revision,
      attempts: state.attempts + 1, last: equal ? "match" : "miss",
    };
  },
  view(state, userId) {
    if (!state.players.includes(userId)) return null;
    const matched = new Set(state.matched);
    const open = new Set(state.open);
    return {
      tiles: state.deck.map((face, index) => matched.has(index) ? { face, status: "matched" } :
        open.has(index) ? { face, status: "open" } : { face: null, status: "hidden" }),
      found: state.matched.length / 2, pairs: PAIRS, attempts: state.attempts, best: state.best,
      revision: state.revision, last: state.last, needsDismiss: state.open.length === 2,
      secondCard: state.open.length === 1,
    };
  },
  stats(matches) { return { played: matches.filter(({ status }) => status === "finished").length }; },
  announce(state) {
    return {
      zh: `你们用了 ${state.attempts} 次翻牌，找齐了 ${PAIRS} 对。`,
      en: `You found all ${PAIRS} pairs together in ${state.attempts} tries.`,
      es: `Encontraron las ${PAIRS} parejas en ${state.attempts} intentos.`,
    };
  },
};
