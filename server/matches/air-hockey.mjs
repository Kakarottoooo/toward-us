const WIDTH = 100;
const HEIGHT = 154;
const MID = HEIGHT / 2;
const PADDLE_RADIUS = 8;
const PUCK_RADIUS = 3.4;
const GOAL = { left: 30, right: 70 };
const TARGET = 5;
const POSSESSION_LIMIT = 8;
const PADDLE_SPEED = 215;
const PUCK_SPEED = 170;
const MAX_STEP = 1 / 120;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const round = (value) => Math.round(value * 10) / 10;

function home(seat) {
  const y = seat === 0 ? HEIGHT - 26 : 26;
  return { x: WIDTH / 2, y, targetX: WIDTH / 2, targetY: y, vx: 0, vy: 0 };
}

function movePaddle(paddle, dt) {
  const dx = paddle.targetX - paddle.x;
  const dy = paddle.targetY - paddle.y;
  const distance = Math.hypot(dx, dy);
  const scale = distance ? Math.min(1, PADDLE_SPEED * dt / distance) : 0;
  paddle.x += dx * scale;
  paddle.y += dy * scale;
  paddle.vx = dx * scale / dt;
  paddle.vy = dy * scale / dt;
}

function limitPuckSpeed(puck) {
  const speed = Math.hypot(puck.vx, puck.vy);
  if (speed <= PUCK_SPEED) return;
  puck.vx *= PUCK_SPEED / speed;
  puck.vy *= PUCK_SPEED / speed;
}

function strike(puck, paddle) {
  const dx = puck.x - paddle.x;
  const dy = puck.y - paddle.y;
  const distance = Math.hypot(dx, dy);
  const reach = PADDLE_RADIUS + PUCK_RADIUS;
  if (distance >= reach) return;

  const nx = distance > 0.001 ? dx / distance : 0;
  const ny = distance > 0.001 ? dy / distance : 1;
  puck.x = paddle.x + nx * reach;
  puck.y = paddle.y + ny * reach;
  const incoming = (puck.vx - paddle.vx) * nx + (puck.vy - paddle.vy) * ny;
  if (incoming >= 0) return;
  puck.vx -= 1.80 * incoming * nx;
  puck.vy -= 1.80 * incoming * ny;
  limitPuckSpeed(puck);
}

function resultFor(state) {
  const [bottom, top] = state.score;
  return { winner: bottom === top ? null : bottom > top ? 0 : 1, score: [...state.score], target: TARGET };
}

function serve(state) {
  const y = MID + (state.recipient === 0 ? 4 : -4);
  state.puck = { x: WIDTH / 2, y, vx: 0, vy: 0 };
  state.paddles = [home(0), home(1)];
  state.possession = 0;
  state.holder = state.recipient;
}

function goal(state, scored) {
  state.score[scored] += 1;
  state.puck.vx = 0;
  state.puck.vy = 0;
  if (state.score[scored] >= TARGET) {
    state.result = resultFor(state);
    return;
  }
  state.recipient = 1 - scored;
  state.delay = 0.85;
  state.resetReason = "goal";
}

function step(state, dt) {
  const { puck, paddles } = state;
  for (const paddle of paddles) movePaddle(paddle, dt);
  puck.x += puck.vx * dt;
  puck.y += puck.vy * dt;

  if (puck.x < PUCK_RADIUS || puck.x > WIDTH - PUCK_RADIUS) {
    puck.vx = puck.x < PUCK_RADIUS ? Math.abs(puck.vx) * 0.91 : -Math.abs(puck.vx) * 0.91;
    puck.x = clamp(puck.x, PUCK_RADIUS, WIDTH - PUCK_RADIUS);
  }

  const inGoal = puck.x >= GOAL.left + PUCK_RADIUS && puck.x <= GOAL.right - PUCK_RADIUS;
  if (inGoal) {
    if (puck.y <= 0 || puck.y >= HEIGHT) {
      goal(state, puck.y <= 0 ? 0 : 1);
      return;
    }
  } else if (puck.y < PUCK_RADIUS || puck.y > HEIGHT - PUCK_RADIUS) {
    puck.vy = puck.y < PUCK_RADIUS ? Math.abs(puck.vy) * 0.89 : -Math.abs(puck.vy) * 0.89;
    puck.y = clamp(puck.y, PUCK_RADIUS, HEIGHT - PUCK_RADIUS);
  }

  for (const paddle of paddles) strike(puck, paddle);
  const drag = Math.pow(0.73, dt);
  puck.vx *= drag;
  puck.vy *= drag;

  const holder = puck.y > MID ? 0 : 1;
  if (holder !== state.holder) {
    state.holder = holder;
    state.possession = 0;
  }
  state.possession += dt;
  if (state.possession >= POSSESSION_LIMIT) {
    state.recipient = 1 - holder;
    state.delay = 0.55;
    state.resetReason = "possession";
  }
}

export const airHockey = {
  id: "air-hockey",
  category: "casual",
  durationMs: 100_000,

  boot({ variant = 0 } = {}) {
    const state = { score: [0, 0], recipient: variant % 2, delay: 0, resetReason: null, result: null };
    serve(state);
    return state;
  },

  input(state, seat, action) {
    if (state.result || (seat !== 0 && seat !== 1) || action?.type !== "move" ||
        !Number.isFinite(action.x) || !Number.isFinite(action.y)) return false;
    const paddle = state.paddles[seat];
    paddle.targetX = clamp(action.x, PADDLE_RADIUS, WIDTH - PADDLE_RADIUS);
    paddle.targetY = seat === 0
      ? clamp(action.y, MID + PADDLE_RADIUS, HEIGHT - PADDLE_RADIUS)
      : clamp(action.y, PADDLE_RADIUS, MID - PADDLE_RADIUS);
    return true;
  },

  neutral(state, seat) {
    const paddle = state.paddles[seat];
    paddle.targetX = paddle.x;
    paddle.targetY = paddle.y;
    paddle.vx = 0;
    paddle.vy = 0;
  },

  tick(state, dt) {
    if (state.result || !Number.isFinite(dt) || dt <= 0) return;
    if (state.delay > 0) {
      state.delay = Math.max(0, state.delay - dt);
      if (!state.delay) {
        state.resetReason = null;
        serve(state);
      }
      return;
    }
    const steps = Math.ceil(dt / MAX_STEP);
    for (let index = 0; index < steps && !state.result && !state.delay; index += 1) step(state, dt / steps);
  },

  view(state) {
    const point = ({ x, y }) => ({ x: round(x), y: round(y) });
    return {
      width: WIDTH, height: HEIGHT, paddleRadius: PADDLE_RADIUS, puckRadius: PUCK_RADIUS, goal: GOAL,
      puck: point(state.puck), paddles: state.paddles.map(point), score: [...state.score], target: TARGET,
      resetReason: state.resetReason,
    };
  },

  timeout: resultFor,
};
