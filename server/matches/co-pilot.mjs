const courses = [
  {
    name: "harbor",
    turns: [["lighthouse", "left", 5.2], ["market", "straight", 5.4], ["fountain", "right", 5.1], ["windmill", "left", 5.5], ["bridge", "straight", 5.4]],
  },
  {
    name: "mountain",
    turns: [["windmill", "right", 5.1], ["bridge", "left", 5.2], ["market", "right", 5.0], ["lighthouse", "straight", 5.2], ["fountain", "right", 5.2]],
  },
  {
    name: "desert",
    turns: [["fountain", "straight", 4.9], ["lighthouse", "right", 5.0], ["bridge", "right", 4.9], ["market", "left", 5.1], ["windmill", "left", 5.0]],
  },
];

const directions = new Set(["left", "straight", "right"]);
const MAX_WRONG_TURNS = 3;
const RECOVERY_SECONDS = 1.35;
const currentTurn = (state) => courses[state.course].turns[state.junction];

function receipt(state, outcome) {
  return {
    winner: null,
    outcome,
    course: courses[state.course].name,
    reached: state.junction,
    total: courses[state.course].turns.length,
    wrongTurns: state.wrongTurns,
  };
}

export const coPilot = {
  id: "co-pilot",
  category: "casual",
  durationMs: 95_000,

  boot({ variant = 0 } = {}) {
    return {
      course: variant % courses.length,
      driver: variant % 2,
      junction: 0,
      progress: 0,
      recovery: 0,
      wrongTurns: 0,
      choice: null,
      signal: null,
      last: null,
      result: null,
    };
  },

  input(state, seat, action) {
    if (state.result || (seat !== 0 && seat !== 1) || !action ||
      !directions.has(action.direction) || action.junction !== state.junction) return false;
    if (seat === state.driver && action.type === "steer") {
      state.choice = action.direction;
      return true;
    }
    if (seat !== state.driver && action.type === "signal") {
      state.signal = action.direction;
      return true;
    }
    return false;
  },

  tick(state, dt) {
    if (state.result) return;
    if (state.recovery > 0) {
      state.recovery = Math.max(0, state.recovery - dt);
      return;
    }

    const [, direction, seconds] = currentTurn(state);
    state.progress += dt / seconds;
    if (state.progress < 1) return;

    const choice = state.choice ?? "straight";
    const correct = choice === direction;
    state.last = { correct, choice };
    state.choice = null;
    state.signal = null;

    if (correct) {
      state.junction += 1;
      state.progress = 0;
      if (!currentTurn(state)) state.result = receipt(state, "arrived");
    } else {
      state.wrongTurns += 1;
      state.progress = 0.30;
      state.recovery = RECOVERY_SECONDS;
      if (state.wrongTurns >= MAX_WRONG_TURNS) state.result = receipt(state, "lost");
    }
  },

  view(state, seat) {
    const course = courses[state.course];
    const navigator = seat !== state.driver;
    return {
      role: navigator ? "navigator" : "driver",
      course: course.name,
      junction: state.junction,
      total: course.turns.length,
      landmark: currentTurn(state)?.[0] ?? null,
      progress: Math.round(Math.min(1, state.progress) * 1000) / 1000,
      recovery: state.recovery > 0,
      attemptsLeft: MAX_WRONG_TURNS - state.wrongTurns,
      choice: state.choice,
      signal: state.signal,
      last: state.last,
      map: navigator ? course.turns.map(([landmark, direction]) => ({ landmark, direction })) : null,
    };
  },

  timeout(state) {
    return receipt(state, "time");
  },
};
