import { randomInt } from "node:crypto";

const HEATS = 5;
const DEAD_HEAT_MS = 50;
const GREEN_WINDOW_MS = 2200;
const RESULT_MS = 1250;

function newHeat(state) {
  state.round += 1;
  state.signal = "red";
  state.switchAt = state.clock + randomInt(1150, 3400);
  state.greenAt = null;
  state.judgeAt = null;
  state.presses = [null, null];
}

function scorecard(state) {
  const [one, two] = state.points;
  return {
    winner: one === two ? null : one > two ? 0 : 1,
    points: [...state.points],
    heats: [...state.heats],
  };
}

function settleHeat(state) {
  const [first, second] = state.presses;
  let winner = null;
  let reason = "miss";
  if (first?.early || second?.early) {
    reason = first?.early && second?.early ? "double-start" : "false-start";
    if (reason === "false-start") winner = first?.early ? 1 : 0;
  } else if (first && second) {
    const difference = first.at - second.at;
    reason = Math.abs(difference) <= DEAD_HEAT_MS ? "tie" : "fastest";
    if (reason === "fastest") winner = difference < 0 ? 0 : 1;
  } else if (first || second) {
    reason = "fastest";
    winner = first ? 0 : 1;
  }

  if (winner !== null) state.points[winner] += 1;
  const times = state.presses.map((press) => press && !press.early && state.greenAt !== null
    ? Math.max(0, Math.round(press.at - state.greenAt)) : null);
  state.heats.push({ winner, reason, times });
  state.signal = "result";
  state.switchAt = state.clock + RESULT_MS;
}

export const greenLight = {
  id: "green-light",
  category: "casual",
  durationMs: 45_000,
  boot() {
    const state = { clock: 0, round: 0, points: [0, 0], heats: [], result: null };
    newHeat(state);
    return state;
  },
  input(state, seat, action) {
    if (state.result || (seat !== 0 && seat !== 1) || action?.type !== "tap" ||
        !Number.isInteger(action.round) || action.round < 1 || action.round > state.round ||
        (action.signal !== "red" && action.signal !== "green")) return false;
    if (action.round < state.round || state.signal === "result" || state.presses[seat]) return true;

    // A player can still see the previous red frame while the green update is in flight.
    const early = state.signal === "red" || action.signal === "red";
    state.presses[seat] = { at: state.clock, early };
    if (state.presses.every(Boolean)) settleHeat(state);
    else state.judgeAt = state.clock + DEAD_HEAT_MS;
    return true;
  },
  tick(state, dt) {
    if (state.result) return;
    state.clock += dt * 1000;
    if (state.signal === "result") {
      if (state.clock < state.switchAt) return;
      if (state.round === HEATS) state.result = scorecard(state);
      else newHeat(state);
      return;
    }
    if (state.judgeAt !== null) {
      if (state.clock >= state.judgeAt) settleHeat(state);
      return;
    }
    if (state.signal === "red" && state.clock >= state.switchAt) {
      state.signal = "green";
      state.greenAt = state.clock;
      state.switchAt = state.clock + GREEN_WINDOW_MS;
    } else if (state.signal === "green" && state.clock >= state.switchAt) {
      settleHeat(state);
    }
  },
  view(state, seat) {
    return {
      signal: state.signal,
      round: state.round,
      total: HEATS,
      points: [...state.points],
      pressed: Boolean(state.presses[seat]),
      heats: [...state.heats],
    };
  },
  timeout: scorecard,
};
