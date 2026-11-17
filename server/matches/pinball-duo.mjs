const WIDTH = 100;
const HEIGHT = 154;
const BALL_RADIUS = 3;
const TARGET = 1000;
const STARTING_BALLS = 3;
const MAX_STEP = 1 / 150;
const MAX_SPEED = 166;
const GRAVITY = 80;
const FLIP_LENGTH = 14;
const FLIP_PULSE = 0.23;
const BUMPERS = [
  { x: 34, y: 47, radius: 9, points: 125 },
  { x: 66, y: 47, radius: 9, points: 125 },
  { x: 50, y: 78, radius: 8, points: 175 },
  { x: 25, y: 90, radius: 4.5, points: 75 },
  { x: 75, y: 90, radius: 4.5, points: 75 },
];

const RAILS = [
  { x1: 5, y1: 42, x2: 19, y2: 17 },
  { x1: 95, y1: 42, x2: 81, y2: 17 },
  { x1: 6, y1: 104, x2: 29, y2: 135 },
  { x1: 94, y1: 104, x2: 71, y2: 135 },
  { x1: 5, y1: 139, x2: 28, y2: 152 },
  { x1: 95, y1: 139, x2: 72, y2: 152 },
];

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const round = (value) => Math.round(value * 10) / 10;

function flipper(phase, seat) {
  const direction = seat === 0 ? 1 : -1;
  const angle = phase > 0 ? -0.62 : 0.34;
  const x1 = seat === 0 ? 32 : 68;
  const y1 = 132;
  return { x1, y1, x2: x1 + direction * FLIP_LENGTH * Math.cos(angle), y2: y1 + FLIP_LENGTH * Math.sin(angle) };
}

function bounce(ball, x, y, reach, fallback, restitution) {
  const dx = ball.x - x;
  const dy = ball.y - y;
  const distance = Math.hypot(dx, dy);
  if (distance >= reach) return false;
  const nx = distance > 0.001 ? dx / distance : fallback.x;
  const ny = distance > 0.001 ? dy / distance : fallback.y;
  ball.x = x + nx * reach;
  ball.y = y + ny * reach;
  const impact = ball.vx * nx + ball.vy * ny;
  if (impact >= 0) return false;
  ball.vx -= (1 + restitution) * impact * nx;
  ball.vy -= (1 + restitution) * impact * ny;
  return true;
}

function hitRail(ball, rail, flipperIsUp = false) {
  const dx = rail.x2 - rail.x1;
  const dy = rail.y2 - rail.y1;
  const length = Math.hypot(dx, dy);
  const along = clamp(((ball.x - rail.x1) * dx + (ball.y - rail.y1) * dy) / (length * length), 0, 1);
  const bounced = bounce(ball, rail.x1 + dx * along, rail.y1 + dy * along, BALL_RADIUS + 1.5,
    { x: Math.sign(dx) * dy / length, y: -Math.abs(dx) / length }, 0.77);
  if (bounced && flipperIsUp && ball.y <= rail.y1 + 3) boost(ball, Math.sign(dx), along);
}

function boost(ball, direction, along) {
  ball.vx = direction * (24 + 32 * along) + 0.14 * ball.vx;
  ball.vy = Math.min(ball.vy, -(90 + 33 * along));
}

function addScore(state, bumper, index) {
  state.score += bumper.points;
  state.hits += 1;
  state.lit[index] = 0.26;
  if (state.score >= TARGET) state.result = resultFor(state);
}

function resultFor(state) {
  return { winner: null, score: state.score, target: TARGET, cleared: state.score >= TARGET, ballsRemaining: state.ballsRemaining, hits: state.hits };
}

function launch(state) {
  const direction = (state.variant + STARTING_BALLS - state.ballsRemaining) % 2 === 0 ? 1 : -1;
  state.ball = { x: 50 + direction * 29, y: 107, vx: -direction * 16, vy: -102 };
}

function step(state, dt) {
  for (const seat of [0, 1]) state.pulse[seat] = Math.max(0, state.pulse[seat] - dt);
  for (let index = 0; index < BUMPERS.length; index += 1) state.lit[index] = Math.max(0, state.lit[index] - dt);

  const ball = state.ball;
  if (!ball) return;
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed > MAX_SPEED) {
    ball.vx *= MAX_SPEED / speed;
    ball.vy *= MAX_SPEED / speed;
  }
  ball.vy += GRAVITY * dt;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  const side = BALL_RADIUS + 4;
  if (ball.x < side || ball.x > WIDTH - side) {
    ball.vx = ball.x < side ? Math.abs(ball.vx) * 0.86 : -Math.abs(ball.vx) * 0.86;
    ball.x = clamp(ball.x, side, WIDTH - side);
  }
  if (ball.y < side) {
    ball.vy = Math.abs(ball.vy) * 0.86;
    ball.y = side;
  }
  if (ball.y > HEIGHT + BALL_RADIUS) {
    state.ballsRemaining -= 1;
    state.ball = null;
    if (state.ballsRemaining === 0) state.result = resultFor(state);
    return;
  }

  for (const rail of RAILS) hitRail(ball, rail);
  for (const seat of [0, 1]) hitRail(ball, flipper(state.pulse[seat], seat), state.pulse[seat] > 0);
  for (let index = 0; index < BUMPERS.length && !state.result; index += 1) {
    const bumper = BUMPERS[index];
    if (bounce(ball, bumper.x, bumper.y, BALL_RADIUS + bumper.radius, { x: 0, y: -1 }, 1.10) && !state.lit[index]) {
      addScore(state, bumper, index);
    }
  }
}

export const pinballDuo = {
  id: "pinball-duo",
  category: "casual",
  durationMs: 125_000,

  boot({ variant = 0 } = {}) {
    return { variant, score: 0, hits: 0, ballsRemaining: STARTING_BALLS, ball: null, pulse: [0, 0], lit: BUMPERS.map(() => 0), result: null };
  },

  input(state, seat, action) {
    if (state.result || (seat !== 0 && seat !== 1)) return false;
    if (action?.type === "launch" && state.ballsRemaining > 0) {
      if (!state.ball) launch(state);
      return true;
    }
    if (action?.type !== "flip") return false;
    if (!state.ball || state.pulse[seat] > 0.1) return true;
    state.pulse[seat] = FLIP_PULSE;
    const pivot = seat === 0 ? 32 : 68;
    const direction = seat === 0 ? 1 : -1;
    const along = (state.ball.x - pivot) * direction / FLIP_LENGTH;
    if (along >= -0.12 && along <= 1.2 && state.ball.y >= 118 && state.ball.y <= 135) {
      state.ball.y = Math.min(state.ball.y, 124);
      boost(state.ball, direction, clamp(along, 0, 1));
    }
    return true;
  },

  neutral(state, seat) {
    state.pulse[seat] = 0;
  },

  tick(state, dt) {
    if (state.result || !Number.isFinite(dt) || dt <= 0) return;
    const steps = Math.ceil(dt / MAX_STEP);
    for (let index = 0; index < steps && !state.result; index += 1) step(state, dt / steps);
  },

  view(state) {
    const ball = state.ball ? { x: round(state.ball.x), y: round(state.ball.y) } : null;
    const bumpers = BUMPERS.map((bumper, index) => ({ ...bumper, lit: state.lit[index] > 0 }));
    const flippers = [0, 1].map((seat) => ({ ...flipper(state.pulse[seat], seat), raised: state.pulse[seat] > 0 }));
    return { width: WIDTH, height: HEIGHT, ballRadius: BALL_RADIUS, ball, bumpers, rails: RAILS, flippers, score: state.score, target: TARGET, ballsRemaining: state.ballsRemaining };
  },

  timeout: resultFor,
};
