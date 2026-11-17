import { randomInt } from "node:crypto";
import { matchError } from "./errors.mjs";

const SUITS = ["hearts", "diamonds", "clubs", "spades"];
const DECK = SUITS.flatMap((suit) => Array.from({ length: 13 }, (_, index) => ({ suit, rank: index + 1, id: `${suit}-${index + 1}` })));
const possible = (card, top, suit) => card.rank === 8 || card.rank === top.rank || card.suit === suit;

function shuffle(values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = randomInt(index + 1);
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

function awardByCards(hands, players) {
  const points = hands.map((hand) => hand.reduce((previous, item) => previous + (item.rank === 8 ? 50 : Math.min(10, item.rank)), 0));
  return points[0] === points[1] ? "tie" : players[points[0] < points[1] ? 0 : 1];
}

export const crazyEights = {
  id: "crazy-eights",
  category: "board",
  start({ players, inviterUserId, previous }) {
    const previousFirst = previous[0]?.state.players[0];
    const first = previousFirst ? players.find((id) => id !== previousFirst) : inviterUserId;
    const deck = shuffle(DECK);
    const hands = [deck.splice(0, 7), deck.splice(0, 7)];
    const [top] = deck.splice(deck.findIndex((card) => card.rank !== 8), 1);
    return { players: [first, players.find((id) => id !== first)], hands, deck, pile: [top], suit: top.suit, next: first, drawn: false, passes: 0, last: null, winner: null, revision: 0 };
  },
  turn(state) { return state.winner ? null : state.next; },
  finished(state) { return state.winner !== null; },
  act(state, { userId, action }) {
    const seat = state.players.indexOf(userId);
    if (seat < 0) throw matchError(404, "not_found");
    if (state.winner) throw matchError(409, "match_over");
    if (state.next !== userId) throw matchError(409, "not_your_turn");
    if (action?.revision !== state.revision) throw matchError(409, "game_board_changed");
    const hand = state.hands[seat], next = state.players[1 - seat], top = state.pile.at(-1), revision = state.revision + 1;
    const replaceHand = (replacement) => state.hands.map((cards, index) => index === seat ? replacement : cards);
    if (action.type === "play") {
      const card = hand.find((item) => item.id === action.cardId);
      if (!card || !possible(card, top, state.suit) || (card.rank === 8 && !SUITS.includes(action.suit))) throw matchError(400, "invalid_action");
      const replacement = hand.filter((item) => item !== card);
      return { ...state, hands: replaceHand(replacement), pile: [...state.pile, card], suit: card.rank === 8 ? action.suit : card.suit,
        drawn: false, passes: 0, next, winner: replacement.length ? null : userId, last: { type: "play", by: userId }, revision };
    }
    if (action.type === "draw") {
      if (state.drawn || !state.deck.length && state.pile.length === 1) throw matchError(400, "invalid_action");
      const supply = state.deck.length ? state.deck : shuffle(state.pile.slice(0, -1));
      const [card, ...deck] = supply;
      return { ...state, hands: replaceHand([...hand, card]), deck, pile: state.deck.length ? state.pile : [top], drawn: true,
        last: { type: "draw", by: userId }, revision };
    }
    if (action.type === "pass" && (state.drawn || !state.deck.length && state.pile.length === 1)) {
      const passes = state.passes + 1;
      return { ...state, passes, drawn: false, next, last: { type: "pass", by: userId }, revision,
        winner: passes >= 2 && !state.deck.length && state.pile.length === 1 ? awardByCards(state.hands, state.players) : null };
    }
    throw matchError(400, "invalid_action");
  },
  view(state, userId) {
    const seat = state.players.indexOf(userId);
    if (seat < 0) return null;
    const top = state.pile.at(-1);
    return { hand: state.hands[seat], other: state.winner ? state.hands[1 - seat] : null, otherCount: state.hands[1 - seat].length,
      top, suit: state.suit, stack: state.deck.length || state.pile.length - 1, canDraw: !state.drawn && (state.deck.length > 0 || state.pile.length > 1),
      canPass: state.drawn || !state.deck.length && state.pile.length === 1, legal: state.hands[seat].filter((item) => possible(item, top, state.suit)).map((item) => item.id),
      last: state.last, winner: state.winner, revision: state.revision };
  },
  stats(matches) {
    const wins = {};
    const completed = matches.filter(({ status }) => status === "finished");
    for (const { state } of completed) if (state.winner !== "tie") wins[state.winner] = (wins[state.winner] || 0) + 1;
    return { wins, played: completed.length };
  },
};
