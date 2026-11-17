import { matchError } from "./errors.mjs";

const SIZE = 3;

function scores(boxes) {
  const result = [0, 0];
  for (const owner of boxes) {
    if (owner) result[owner - 1] += 1;
  }
  return result;
}

const horizontalIndex = (size, x, y) => y * size + x;
const verticalIndex = (size, x, y) => y * (size + 1) + x;

function boxIsClosed(size, horizontal, vertical, x, y) {
  return horizontal[horizontalIndex(size, x, y)] && horizontal[horizontalIndex(size, x, y + 1)] &&
    vertical[verticalIndex(size, x, y)] && vertical[verticalIndex(size, x + 1, y)];
}

export const dotsBoxes = {
  id: "dots",
  category: "board",
  start({ players, inviterUserId, previous = [] }) {
    const priorStarter = previous[0]?.state.first;
    const first = players.includes(priorStarter) ? players.find((id) => id !== priorStarter) : inviterUserId;
    return {
      size: SIZE,
      players: [...players],
      first,
      next: first,
      horizontal: Array((SIZE + 1) * SIZE).fill(0),
      vertical: Array(SIZE * (SIZE + 1)).fill(0),
      boxes: Array(SIZE * SIZE).fill(0),
      last: null,
    };
  },
  turn(state) { return state.next; },
  finished(state) { return state.next === null; },
  act(state, { userId, action }) {
    if (dotsBoxes.finished(state)) throw matchError(409, "match_over");
    if (state.next !== userId || !state.players.includes(userId)) throw matchError(409, "not_your_turn");
    const { axis, x, y } = action || {};
    const { size } = state;
    if (action?.type !== "draw" || (axis !== "h" && axis !== "v") ||
      !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 ||
      x > size || y > size || (axis === "h" ? x === size : y === size)) {
      throw matchError(400, "invalid_action");
    }

    const owner = state.players.indexOf(userId) + 1;
    const horizontal = [...state.horizontal], vertical = [...state.vertical];
    const edges = axis === "h" ? horizontal : vertical;
    const index = axis === "h" ? horizontalIndex(size, x, y) : verticalIndex(size, x, y);
    if (edges[index]) throw matchError(409, "occupied");
    edges[index] = owner;

    const adjacent = axis === "h" ? [[x, y - 1], [x, y]] : [[x - 1, y], [x, y]];
    const boxes = [...state.boxes];
    const claimed = [];
    for (const [bx, by] of adjacent) {
      if (bx < 0 || bx >= size || by < 0 || by >= size) continue;
      const box = by * size + bx;
      if (!boxes[box] && boxIsClosed(size, horizontal, vertical, bx, by)) {
        boxes[box] = owner;
        claimed.push(box);
      }
    }
    const next = boxes.every(Boolean) ? null : claimed.length ? userId : state.players.find((id) => id !== userId);
    return { ...state, horizontal, vertical, boxes, next, last: { axis, x, y, claimed } };
  },
  view(state) { return { ...state, scores: scores(state.boxes) }; },
  stats(matches) {
    const wins = {};
    let played = 0;
    for (const { state, status } of matches) {
      if (status !== "finished") continue;
      played += 1;
      const [first, second] = scores(state.boxes);
      if (first === second) continue;
      const winner = state.players[first > second ? 0 : 1];
      wins[winner] = (wins[winner] || 0) + 1;
    }
    return { wins, played };
  },
};
