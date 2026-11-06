import { BOTH, matchError, PET } from "./errors.mjs";

// 石头剪刀布 (founder 11-06, batch 2): best of three, both pick in secret each round, and a tie is played again. Before the
// first pick either of them may set what the loser does ("输的人洗碗"); when a game between the two of them ends, Pinky says
// in Us who won and what the other owes. Each pick stays hidden from the other until both have picked.
export const CHOICES = ["rock", "paper", "scissors"];
const BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };
export const TARGET = 2;
const current = (state) => state.rounds.at(-1);

export const rps = {
  id: "rps",
  category: "casual",
  start({ players }) { return { players: [...players], stake: "", rounds: [{ picks: {}, winner: null }], wins: {}, winner: null, ended: false }; },
  turn(state) {
    if (state.winner || state.ended) return null;
    const missing = state.players.filter((id) => !current(state).picks[id]);
    return missing.length === 2 ? BOTH : missing[0] || null;
  },
  act(state, { userId, action }) {
    if (state.winner || state.ended) throw matchError(409, "match_over");
    if (action?.type === "end") return { ...state, ended: true, endedBy: userId };
    if (action?.type === "stake") {
      if (state.rounds.length > 1 || Object.keys(current(state).picks).length) throw matchError(409, "invalid_action");
      return { ...state, stake: String(action.text || "").trim().slice(0, 60), stakeBy: userId };
    }
    if (action?.type !== "pick") throw matchError(400, "invalid_action");
    const round = current(state);
    if (!CHOICES.includes(action.choice)) throw matchError(400, "invalid_action");
    if (round.picks[userId]) throw matchError(409, "not_your_turn");
    const picks = { ...round.picks, [userId]: action.choice };
    if (Object.keys(picks).length < 2) return { ...state, rounds: [...state.rounds.slice(0, -1), { ...round, picks }] };
    const [a, b] = state.players, winner = picks[a] === picks[b] ? "tie" : BEATS[picks[a]] === picks[b] ? a : b;
    const wins = winner === "tie" ? state.wins : { ...state.wins, [winner]: (state.wins[winner] || 0) + 1 };
    const champion = winner !== "tie" && wins[winner] >= TARGET ? winner : null;
    return { ...state, wins, winner: champion, rounds: [...state.rounds.slice(0, -1), { picks, winner }, ...(champion ? [] : [{ picks: {}, winner: null }])] };
  },
  finished(state) { return Boolean(state.winner || state.ended); },
  /** The other's pick of the round being played shows only as "picked". */
  view(state, userId) { return { ...state, rounds: state.rounds.map((round) => round.winner ? round : { ...round, picks: Object.fromEntries(Object.entries(round.picks).map(([id, choice]) => [id, id === userId ? choice : "picked"])) }) }; },
  stats(matches) {
    const wins = {};
    for (const match of matches) if (match.state.winner) wins[match.state.winner] = (wins[match.state.winner] || 0) + 1;
    return { wins, played: matches.filter((match) => match.state.winner).length };
  },
  announce(state, { name }) {
    if (!state.winner) return null;
    const winner = name(state.winner), loser = name(state.players.find((id) => id !== state.winner));
    if (state.stake) return { zh: `石头剪刀布：${winner} 赢了！${loser} 要兑现：${state.stake}`, en: `Rock paper scissors: ${winner} won! ${loser} owes: ${state.stake}`, es: `Piedra, papel o tijera: ¡ganó ${winner}! ${loser} debe cumplir: ${state.stake}` };
    return { zh: `石头剪刀布：${winner} 赢了 ${loser}！`, en: `Rock paper scissors: ${winner} beat ${loser}!`, es: `Piedra, papel o tijera: ¡${winner} le ganó a ${loser}!` };
  },
  petInstant: true,
  async petActions({ state }) {
    if (state.winner || state.ended || current(state).picks[PET]) return [];
    return [{ type: "pick", choice: CHOICES[Math.floor(Math.random() * 3)] }];
  },
};
