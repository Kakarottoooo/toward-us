import { BOTH, matchError } from "./errors.mjs";

const MAX_STROKES = 8;
const COURSES = [
  { start: [16, 82], hole: [83, 19], par: 2, walls: [], sand: [[54, 61, 26, 19]], water: [] },
  { start: [18, 82], hole: [82, 20], par: 3, walls: [[36, 39, 31, 8], [65, 72, 25, 7]], sand: [[19, 32, 15, 17]], water: [[68, 40, 18, 17]] },
  { start: [16, 78], hole: [82, 20], par: 3, walls: [[45, 20, 9, 44], [63, 64, 27, 8]], sand: [[62, 37, 21, 16]], water: [[24, 16, 14, 24]] },
];

const inside = ([x, y], [left, top, width, height]) => x >= left && x <= left + width && y >= top && y <= top + height;
const distance = ([x, y], [a, b]) => Math.hypot(x - a, y - b);
const round = ([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10];

function putt(course, origin, aim, power) {
  let [x, y] = origin;
  const ratio = (0.26 + power * 0.0245) / distance(origin, aim);
  let dx = (aim[0] - x) * ratio, dy = (aim[1] - y) * ratio;
  const trace = [origin];
  for (let step = 0; step < 178 && Math.hypot(dx, dy) > 0.085; step += 1) {
    const nx = x + dx, ny = y + dy;
    if (nx < 3 || nx > 97 || course.walls.some((shape) => inside([nx, y], shape))) dx *= -0.77;
    else x = nx;
    if (ny < 3 || ny > 97 || course.walls.some((shape) => inside([x, ny], shape))) dy *= -0.77;
    else y = ny;
    const point = [x, y];
    if (distance(point, course.hole) < 3.2) return { trace: [...trace, course.hole], point: course.hole, sunk: true, water: false };
    if (course.water.some((shape) => inside(point, shape))) return { trace: [...trace, round(point)], point: origin, sunk: false, water: true };
    if (step % 5 === 0) trace.push(round(point));
    const decay = course.sand.some((shape) => inside(point, shape)) ? 0.87 : 0.973;
    dx *= decay;
    dy *= decay;
  }
  const point = round([x, y]);
  return { trace: [...trace, point], point, sunk: false, water: false };
}

function startHole(index) {
  return [0, 1].map(() => ({ point: COURSES[index].start, strokes: 0, sunk: false, done: false }));
}

const score = (state, seat) => state.cards.reduce((sum, shots) => sum + shots[seat], 0);

export const miniGolf = {
  id: "mini-golf",
  category: "casual",
  start({ players, inviterUserId, previous }) {
    const last = previous[0]?.state.players[0];
    const first = last ? players.find((id) => id !== last) : inviterUserId;
    return { players: [first, players.find((id) => id !== first)], hole: 0, balls: startHole(0), seat: 0, cards: [], revision: 0, lastShot: null };
  },
  turn(state) { return state.cards.length === COURSES.length ? null : state.balls.every((ball) => ball.done) ? BOTH : state.players[state.seat]; },
  finished(state) { return state.cards.length === COURSES.length; },
  act(state, { action, userId }) {
    const seat = state.players.indexOf(userId);
    if (seat < 0) throw matchError(404, "not_found");
    if (action?.revision !== state.revision) throw matchError(409, "game_board_changed");
    const revision = state.revision + 1;
    if (action.type === "next" && state.balls.every((ball) => ball.done) && state.hole < COURSES.length - 1) {
      const hole = state.hole + 1;
      return { ...state, hole, balls: startHole(hole), seat: hole % 2, lastShot: null, revision };
    }
    if (seat !== state.seat) throw matchError(409, "not_your_turn");
    const ball = state.balls[seat];
    const { aim, power } = action;
    if (action.type !== "shoot" || ball.done || !Array.isArray(aim) || aim.length !== 2 ||
        !aim.every((value) => Number.isFinite(value) && value >= -100 && value <= 200) || distance(aim, ball.point) < 1 ||
        !Number.isInteger(power) || power < 10 || power > 100) throw matchError(400, "invalid_action");
    const stroke = putt(COURSES[state.hole], ball.point, aim, power);
    const strokes = Math.min(MAX_STROKES, ball.strokes + (stroke.water ? 2 : 1));
    const balls = state.balls.map((item, index) => index === seat
      ? { point: stroke.point, strokes, sunk: stroke.sunk, done: stroke.sunk || strokes === MAX_STROKES } : item);
    const cards = balls.every((item) => item.done) ? [...state.cards, balls.map((item) => item.strokes)] : state.cards;
    return { ...state, balls, seat: balls[1 - seat].done ? seat : 1 - seat, cards, revision, lastShot: { seat, trace: stroke.trace, water: stroke.water, sunk: stroke.sunk } };
  },
  view(state) {
    const totals = state.players.map((_, seat) => score(state, seat));
    const winner = miniGolf.finished(state) && totals[0] !== totals[1] ? state.players[totals[0] < totals[1] ? 0 : 1] : null;
    return { ...state, course: COURSES[state.hole], totals, winner, holeCount: COURSES.length, maxStrokes: MAX_STROKES };
  },
  stats(matches) {
    const wins = {};
    const finished = matches.filter(({ state }) => miniGolf.finished(state));
    for (const { state } of finished) {
      const { winner } = miniGolf.view(state);
      if (winner) wins[winner] = (wins[winner] || 0) + 1;
    }
    return { wins, played: finished.length };
  },
};
