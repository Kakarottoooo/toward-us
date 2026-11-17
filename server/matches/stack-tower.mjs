import { matchError } from "./errors.mjs";

const GOAL = 12;
const PATTERN = [[48, 0], [39, -7], [45, 10], [34, -6], [40, 7], [31, 0], [35, -7], [26, 5], [29, -5], [22, 0], [24, 4], [17, -3]];
const WINDS = [0, 0, 1.2, -2.0, 0.0, 2.4, -2.2, 0.8, -2.9, 3.0, -1.8, 2.5];
const FLOOR = { center: 50, width: 60, bias: 0 };

function nextPiece(state) {
  const height = state.blocks.length;
  const [width, weight] = PATTERN[height] || PATTERN.at(-1);
  const reverse = state.variant % 2 ? -1 : 1;
  return { width, bias: weight * reverse, wind: WINDS[height] * reverse || 0 };
}

// For every joint, the weight above it must stay over the actual overlap.
function supportMargin(blocks, wind) {
  let worst = Infinity, weight = 0, moment = 0;
  const all = [FLOOR, ...blocks];
  for (let index = all.length - 1; index > 0; index -= 1) {
    const upper = all[index], lower = all[index - 1];
    weight += upper.width;
    moment += upper.width * (upper.center + upper.bias);
    const centerOfMass = moment / weight + wind * Math.sqrt(all.length - index);
    const left = Math.max(upper.center - upper.width / 2, lower.center - lower.width / 2);
    const right = Math.min(upper.center + upper.width / 2, lower.center + lower.width / 2);
    worst = Math.min(worst, centerOfMass - left, right - centerOfMass);
  }
  return Math.round(worst * 10) / 10;
}

export const stackTower = {
  id: "stack-tower",
  category: "casual",
  start({ players, inviterUserId, previous }) {
    const last = previous[0]?.state;
    const first = last ? players.find((id) => id !== last.players[0]) : inviterUserId;
    return { players: [first, players.find((id) => id !== first)], blocks: [], variant: last ? 1 - last.variant : 0, revision: 0, margin: null, fallen: null };
  },
  turn(state) { return stackTower.finished(state) ? null : state.players[state.blocks.length % 2]; },
  finished(state) { return Boolean(state.fallen) || state.blocks.length === GOAL; },
  act(state, { userId, action }) {
    if (stackTower.turn(state) !== userId) throw matchError(409, "not_your_turn");
    if (action?.revision !== state.revision) throw matchError(409, "game_board_changed");
    const { center } = action;
    const { width, bias, wind } = nextPiece(state);
    if (action.type !== "drop" || !Number.isInteger(center) || center - width / 2 < 0 || center + width / 2 > 100) throw matchError(400, "invalid_action");
    const piece = { center, width, bias };
    const blocks = [...state.blocks, piece];
    const margin = supportMargin(blocks, wind);
    const revision = state.revision + 1;
    return margin > 0 ? { ...state, blocks, margin, revision } : { ...state, margin, revision, fallen: piece };
  },
  view(state) { return { ...state, next: stackTower.finished(state) ? null : nextPiece(state), goal: GOAL, floor: FLOOR }; },
  stats(matches) { return { played: matches.filter(({ state }) => stackTower.finished(state)).length }; },
};
