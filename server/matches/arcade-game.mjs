import { BOTH, matchError } from "./errors.mjs";

/** The regular match is the durable invitation, checkpoint, and outcome for a live arcade round. */
export function arcadeGame(rules) {
  return {
    id: rules.id,
    category: rules.category,
    live: rules,
    start({ players, inviterUserId, previous }) {
      const prior = previous[0]?.state;
      const first = prior?.players?.[0] || inviterUserId;
      return {
        players: [first, players.find((id) => id !== first)],
        variant: prior ? prior.variant + 1 : 0,
        checkpoint: null,
        result: null,
      };
    },
    view({ players, variant, result }) { return { players, variant, result }; },
    turn(state) { return state.result ? null : BOTH; },
    finished(state) { return state.result !== null; },
    act(state, { action, arcadeInternal }) {
      if (!arcadeInternal) throw matchError(400, "invalid_action");
      if (action.type === "arcade_checkpoint") return { ...state, checkpoint: action.checkpoint };
      if (action.type === "arcade_complete") return { ...state, checkpoint: null, result: action.result };
      throw matchError(400, "invalid_action");
    },
    stats(matches) {
      const wins = {};
      const finished = matches.filter(({ state }) => state.result);
      for (const { state } of finished) {
        const winner = state.players[state.result.winner];
        if (winner) wins[winner] = (wins[winner] || 0) + 1;
      }
      return Object.keys(wins).length ? { wins, played: finished.length } : { played: finished.length };
    },
  };
}
