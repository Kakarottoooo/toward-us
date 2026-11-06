// What /api/matches sends (server/matches/index.mjs viewMatch); `state` is each game's own view of itself.
export type MatchView<State = unknown> = { id: string; game: string; status: "active" | "finished"; players: string[]; turn: string | null; createdByUserId: string; createdAt: string; updatedAt: string; finishedAt: string | null; version: number; state: State };
export type Member = { id: string; name: string };
export type Hall = {
  games: string[]; matches: MatchView[]; members: Member[]; readOnly: boolean;
  stats: { gomoku?: { wins: Record<string, number>; draws: number; played: number }; draw?: { guessed: number; played: number } };
};

export type GomokuState = { size: number; black: string; white: string; moves: Array<[number, number]>; winner: string | null; line: Array<[number, number]> | null; draw: boolean; resignedBy: string | null };

export type Stroke = { c: number; w: number; p: number[] };
export type Word = { category: string; zh: string; en: string; es: string };
export type DrawRound = { drawer: string; word: Word | null; hint: { category: string; length: { zh: number; en: number; es: number } }; strokes: Stroke[] | null; guesses: Array<{ text: string; correct: boolean; at: string }>; outcome: "guessed" | "missed" | null };
export type DrawState = { players: string[]; rounds: DrawRound[]; guessed?: number; played?: number; ended?: boolean; endedBy?: string };
