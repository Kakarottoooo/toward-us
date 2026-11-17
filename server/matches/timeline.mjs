import { randomInt } from "node:crypto";
import { BOTH, matchError } from "./errors.mjs";
import { requireGameMoment } from "./photo-game-media.mjs";

const PICK_COUNT = 2;
const PRACTICE_DATES = [
  ["2025-02-06", "2025-03-12", "2025-03-21", "2025-03-24"],
  ["2024-05-02", "2024-05-16", "2024-05-29", "2024-06-04"],
  ["2025-06-03", "2025-06-14", "2025-07-11", "2025-07-13"],
  ["2024-08-09", "2024-08-25", "2024-09-12", "2024-09-29"],
  ["2025-05-07", "2025-06-08", "2025-06-23", "2025-07-31"],
  ["2024-04-01", "2024-04-15", "2024-05-03", "2024-05-06"],
];

function chronological(cards) {
  return [...cards].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

function shuffleOrder(cards) {
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  if (shuffled.every((card, i) => !i || shuffled[i - 1].date <= card.date) && shuffled[0].date !== shuffled.at(-1).date) {
    shuffled.reverse();
  }
  return shuffled.map((card) => card.key);
}

function sorting(state, cards, practice) {
  return { ...state, phase: "sort", cards, practice, order: shuffleOrder(cards) };
}

function assertChoice(state, userId) {
  if (state.phase !== "pick" || !state.players.includes(userId)) throw matchError(409, "invalid_action");
}

function assertAvailable(state, userId, photoId) {
  assertChoice(state, userId);
  if (state.cards.some((card) => card.photoId === photoId) ||
    state.cards.filter((card) => card.addedBy === userId).length >= PICK_COUNT) {
    throw matchError(409, "timeline_photo_used");
  }
}

function shownCard(card, reveal) {
  const { key, photoId, example, date } = card;
  return { key, photoId, example, ...(reveal ? { date } : {}) };
}

export const timeline = {
  id: "timeline",
  category: "puzzle",
  start({ players, previous }) {
    const practiceDeck = previous.filter((match) => match.state.practice).length % PRACTICE_DATES.length;
    return { players, phase: "pick", cards: [], practice: false, practiceDeck, order: [], revision: 0, confirmed: [] };
  },
  async prepareAction({ tx, match, userId, action }) {
    if (action?.type !== "select") return action;
    assertAvailable(match.state, userId, action.photoId);
    const { item } = await requireGameMoment(tx, { userId, relationshipId: match.relationshipId, photoId: action.photoId });
    // The album displays its saved date or, when unspecified, the date the memory was added.
    const date = item.date || item.createdAt.slice(0, 10);
    return { type: "select", photoId: item.photoId, date };
  },
  act(state, { userId, action }) {
    if (!state.players.includes(userId) || !action) throw matchError(400, "invalid_action");
    if (state.phase === "pick") {
      if (action.type === "practice") {
        const practiceCards = PRACTICE_DATES[state.practiceDeck].map((date, example) => ({ key: `sample-${example}`, example, date }));
        return sorting(state, practiceCards, true);
      }
      if (action.type === "remove" && state.cards.some((card) => card.addedBy === userId && card.key === action.key)) {
        return { ...state, cards: state.cards.filter((card) => card.key !== action.key) };
      }
      if (action.type === "select") {
        assertAvailable(state, userId, action.photoId);
        if (typeof action.photoId !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(action.date)) throw matchError(400, "invalid_action");
        const cards = [...state.cards, { key: action.photoId, photoId: action.photoId, date: action.date, addedBy: userId }];
        return cards.length === state.players.length * PICK_COUNT ? sorting(state, cards, false) : { ...state, cards };
      }
    }
    if (state.phase === "sort") {
      if (action.revision !== state.revision) throw matchError(409, "timeline_changed");
      if (action.type === "swap") {
        const from = state.order.indexOf(action.from), to = state.order.indexOf(action.to);
        if (from < 0 || to < 0 || from === to) throw matchError(400, "invalid_action");
        const order = [...state.order];
        [order[from], order[to]] = [order[to], order[from]];
        return { ...state, order, revision: state.revision + 1, confirmed: [] };
      }
      if (action.type === "unlock") return { ...state, confirmed: state.confirmed.filter((id) => id !== userId) };
      if (action.type === "confirm") {
        const confirmed = [...new Set([...state.confirmed, userId])];
        return { ...state, confirmed, phase: confirmed.length === state.players.length ? "reveal" : "sort" };
      }
    }
    throw matchError(400, "invalid_action");
  },
  turn(state) {
    if (state.phase === "reveal") return null;
    const available = state.players.filter((id) => state.phase === "pick"
      ? state.cards.filter((card) => card.addedBy === id).length < PICK_COUNT : !state.confirmed.includes(id));
    return available.length > 1 ? BOTH : available[0] || null;
  },
  finished(state) { return state.phase === "reveal"; },
  view(state, userId) {
    const reveal = state.phase === "reveal";
    const mine = state.cards.filter((card) => card.addedBy === userId);
    const ordered = state.order.map((key) => state.cards.find((card) => card.key === key));
    const correct = reveal ? chronological(state.cards) : [];
    return {
      phase: state.phase,
      practice: state.practice,
      practiceDeck: state.practice ? state.practiceDeck : null,
      cards: (state.phase === "pick" ? mine : reveal ? correct : ordered).map((card) => shownCard(card, reveal)),
      partnerCount: state.phase === "pick" ? state.cards.length - mine.length : null,
      myConfirmation: state.confirmed.includes(userId),
      partnerConfirmation: state.confirmed.some((id) => id !== userId),
      revision: state.revision,
      correctCount: reveal ? correct.filter((card, index) => card.date === ordered[index].date).length : null,
    };
  },
  stats(matches) { return { played: matches.filter((match) => match.state.phase === "reveal").length }; },
};
