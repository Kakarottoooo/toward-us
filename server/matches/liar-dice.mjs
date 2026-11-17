import { randomInt } from "node:crypto";
import { matchError } from "./errors.mjs";

const DICE_PER_PLAYER = 3;
const SIDES = 6;

function roll(count) {
  return Array.from({ length: count }, () => randomInt(1, SIDES + 1)).sort((a, b) => a - b);
}

export const liarDice = {
  id: "liar-dice",
  category: "board",
  start({ players, inviterUserId, previous = [] }) {
    const lastStarter = previous[0]?.state.first;
    const first = players.includes(lastStarter) ? players.find((id) => id !== lastStarter) : inviterUserId;
    return {
      players, first, next: first, revision: 0, round: 1,
      hands: players.map(() => roll(DICE_PER_PLAYER)), remaining: players.map(() => DICE_PER_PLAYER),
      bid: null, result: null, winner: null,
    };
  },
  turn(state) { return state.next; },
  finished(state) { return state.winner !== null; },
  act(state, { userId, action }) {
    if (liarDice.finished(state)) throw matchError(409, "match_over");
    const seat = state.players.indexOf(userId);
    if (seat < 0 || state.next !== userId) throw matchError(409, "not_your_turn");
    if (action?.revision !== state.revision) throw matchError(409, "invalid_action");
    const revision = state.revision + 1;
    if (state.result) {
      if (action.type !== "next") throw matchError(409, "invalid_action");
      return {
        ...state, round: state.round + 1, revision, hands: state.remaining.map(roll), bid: null, result: null,
      };
    }

    if (action.type === "bid") {
      const { quantity, face } = action;
      const highest = state.remaining[0] + state.remaining[1];
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > highest || !Number.isInteger(face) || face < 1 || face > SIDES ||
          (state.bid && (quantity < state.bid.quantity || (quantity === state.bid.quantity && face <= state.bid.face)))) {
        throw matchError(400, "invalid_action");
      }
      return { ...state, revision, next: state.players[1 - seat], bid: { quantity, face, by: userId } };
    }

    if (action.type !== "call" || !state.bid) throw matchError(400, "invalid_action");
    const { face, quantity } = state.bid;
    const actual = state.hands.flat().filter((die) => die === face).length;
    const held = actual >= quantity;
    const loserSeat = held ? seat : 1 - seat;
    const remaining = [...state.remaining];
    remaining[loserSeat] -= 1;
    const loser = state.players[loserSeat];
    const winner = remaining[loserSeat] === 0 ? state.players[1 - loserSeat] : null;
    return {
      ...state, remaining, revision, winner, next: winner ? null : loser,
      result: { caller: userId, loser, actual, held },
    };
  },
  view(state, userId) {
    const seat = state.players.indexOf(userId);
    if (seat < 0) return null;
    return {
      hand: state.hands[seat], opponentHand: state.result ? state.hands[1 - seat] : null,
      diceLeft: state.remaining[seat], partnerDiceLeft: state.remaining[1 - seat],
      round: state.round, bid: state.bid, result: state.result, revision: state.revision, winner: state.winner,
    };
  },
  stats(matches) {
    const wins = {};
    let played = 0;
    for (const { state, status } of matches) {
      if (status !== "finished" || !state.winner) continue;
      wins[state.winner] = (wins[state.winner] || 0) + 1;
      played += 1;
    }
    return { wins, played };
  },
};
