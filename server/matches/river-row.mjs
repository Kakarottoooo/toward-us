const courses = [
  {
    name: "willow", current: 1.5, gates: [[11, 49, 38], [24, 57, 38], [37, 45, 36], [50, 56, 37], [64, 48, 35], [78, 53, 35], [91, 50, 34]],
    rocks: [[17, 23, 7], [31, 75, 7], [43, 21, 8], [58, 78, 8], [70, 27, 8], [84, 79, 8]],
  },
  {
    name: "canyon", current: 2.8, gates: [[11, 45, 35], [24, 61, 34], [37, 43, 33], [50, 39, 32], [64, 62, 33], [78, 49, 32], [91, 55, 31]],
    rocks: [[18, 26, 8], [29, 78, 9], [44, 72, 8], [58, 25, 8], [72, 74, 9], [86, 21, 8]],
  },
  {
    name: "glow", current: 3.3, gates: [[11, 57, 35], [24, 39, 32], [37, 44, 31], [50, 65, 32], [64, 42, 31], [78, 59, 31], [91, 47, 30]],
    rocks: [[18, 76, 8], [31, 23, 8], [43, 73, 9], [58, 23, 8], [71, 71, 8], [85, 78, 8]],
  },
];

const TARGET = 5;
const FINISH = 100;
const MIN_STROKES = 3;
const MAX_SPEED = 6.9;
const STROKE_INTERVAL = 0.42;
const SYNC_WINDOW = 0.36;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function receipt(state, outcome) {
  return {
    winner: null,
    outcome,
    course: courses[state.course].name,
    gates: state.gates.filter((gate) => gate === "passed").length,
    target: TARGET,
    synced: state.synced,
    strokes: [...state.strokes],
    hits: 3 - state.hull,
  };
}

export const riverRow = {
  id: "river-row",
  category: "casual",
  durationMs: 72_000,

  boot({ variant = 0 } = {}) {
    const course = variant % courses.length;
    return {
      course,
      x: 50,
      drift: 0,
      distance: 0,
      speed: 2.1,
      time: 0,
      lastStroke: [-10, -10],
      handledStroke: [-10, -10],
      strokes: [0, 0],
      synced: 0,
      flash: 0,
      hull: 3,
      gates: courses[course].gates.map(() => "ahead"),
      result: null,
    };
  },

  input(state, seat, action) {
    if (state.result || (seat !== 0 && seat !== 1) || action?.type !== "stroke" ||
      state.time - state.lastStroke[seat] < STROKE_INTERVAL) return false;

    const other = 1 - seat;
    state.lastStroke[seat] = state.time;
    state.strokes[seat] += 1;
    state.speed = Math.min(MAX_SPEED, state.speed + 0.7);
    if (state.time - state.lastStroke[other] <= SYNC_WINDOW && state.lastStroke[other] > state.handledStroke[other]) {
      state.handledStroke = [...state.lastStroke];
      state.synced += 1;
      state.speed = Math.min(MAX_SPEED, state.speed + 0.52);
      state.drift *= 0.34;
      state.flash = 0.75;
    }
    return true;
  },

  tick(state, dt) {
    if (state.result) return;
    const course = courses[state.course];
    const lastDistance = state.distance;
    state.time += dt;
    // A matching stroke cancels the yaw even if the second command took longer to reach the server.
    for (let seat = 0; seat < 2; seat += 1) {
      if (state.lastStroke[seat] > state.handledStroke[seat] && state.time - state.lastStroke[seat] > SYNC_WINDOW) {
        state.handledStroke[seat] = state.lastStroke[seat];
        state.drift = clamp(state.drift + (seat === 0 ? 21 : -21), -38, 38);
      }
    }
    state.flash = Math.max(0, state.flash - dt);
    state.distance = Math.min(FINISH, state.distance + state.speed * dt);
    state.speed = 2.1 + (state.speed - 2.1) * Math.exp(-1.45 * dt);
    state.x = clamp(state.x + (state.drift + course.current * Math.sin(state.distance / 9)) * dt, 12, 88);
    state.drift *= Math.exp(-2.25 * dt);

    for (let index = 0; index < course.rocks.length; index += 1) {
      const [distance, x, radius] = course.rocks[index];
      if (lastDistance < distance && state.distance >= distance && Math.abs(state.x - x) <= radius + 3) {
        state.hull -= 1;
        state.speed = Math.max(1.1, state.speed * 0.55);
        state.drift = state.x < 50 ? 15 : -15;
        if (state.hull === 0) {
          state.result = receipt(state, "rocks");
          return;
        }
      }
    }

    for (let index = 0; index < course.gates.length; index += 1) {
      const [distance, x, width] = course.gates[index];
      if (lastDistance < distance && state.distance >= distance) {
        const passed = Math.abs(state.x - x) <= width / 2;
        state.gates[index] = passed ? "passed" : "missed";
      }
    }

    if (state.distance === FINISH) {
      const enoughGates = state.gates.filter((gate) => gate === "passed").length >= TARGET;
      const enoughStrokes = state.strokes.every((count) => count >= MIN_STROKES);
      state.result = receipt(state, enoughGates && enoughStrokes ? "finished" : enoughStrokes ? "gates" : "paddles");
    }
  },

  view(state) {
    const course = courses[state.course];
    return {
      course: course.name,
      x: Math.round(state.x * 100) / 100,
      distance: Math.round(state.distance * 100) / 100,
      drift: Math.round(state.drift),
      hull: state.hull,
      synced: state.synced,
      boost: state.flash > 0,
      recentStroke: state.lastStroke.map((time) => state.time - time < 0.24),
      strokeReady: state.lastStroke.map((time) => state.time - time >= STROKE_INTERVAL),
      gates: course.gates.map(([at, x, width], index) => ({ at, x, width, status: state.gates[index] })),
      rocks: course.rocks.map(([at, x, radius]) => ({ at, x, radius })),
      passed: state.gates.filter((gate) => gate === "passed").length,
      target: TARGET,
    };
  },

  timeout(state) {
    return receipt(state, "time");
  },
};
