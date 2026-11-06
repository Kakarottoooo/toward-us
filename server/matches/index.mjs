import { createRelationshipRecord } from "../relationship-domain.mjs";
import { appendTogetherMessage, togetherI18n } from "../together-domain.mjs";
import { drawGuess } from "./draw-guess.mjs";
import { matchError } from "./errors.mjs";
import { gomoku } from "./gomoku.mjs";

// 游戏大厅 (founder 11-06): games with a screen of their own, played by the two of them in turns. Each game is a module with
// the same shape, so adding one is adding a module here and its screen in src/features/games:
//   id, category              which game, and the hall section it is listed under
//   start({ players, inviterUserId, matchId, previous }) -> state
//   act(state, { userId, action }) -> state        throws matchError for a move that isn't allowed
//   turn(state) -> userId | null                   whose move it is (null once nobody needs to move)
//   finished(state) -> boolean
//   view(state, userId) -> what this player may see (hidden words, hands, ships... stay with their owner)
//   stats(matches) -> the line the hall shows for this game
// A match is a shared record of the couple (collection "matches"); its invitation is a card in Us.
export const GAMES = Object.freeze({ gomoku, draw: drawGuess });
export const COLLECTION = "matches";
const NAMES = { gomoku: ["五子棋", "Gomoku", "Gomoku"], draw: ["你画我猜", "Draw & guess", "Dibuja y adivina"] };
export const gameName = (game, language) => { const names = NAMES[game] || [game, game, game]; return language === "en" ? names[1] : language === "es" ? names[2] : names[0]; };

const activePair = (context) => context?.relationship.status === "active" && context.members.length === 2;

export function viewMatch(match, userId) {
  const module = GAMES[match.game];
  return { id: match.id, game: match.game, status: match.status, players: match.players, turn: match.turn, createdByUserId: match.createdByUserId, createdAt: match.createdAt, updatedAt: match.updatedAt, finishedAt: match.finishedAt || null, version: match.version, state: module ? module.view(match.state, userId) : null };
}

export async function listMatches(store, userId) {
  const context = await store.getRelationshipContext(userId);
  if (!context) return [];
  return (await store.listRelationshipRecordsForUser(COLLECTION, userId)).filter((match) => match.relationshipId === context.relationship.id && GAMES[match.game]);
}

/** Starts a game of `game`, or returns the one of that game still being played. A new one is announced in Us. */
export async function createMatch({ store, userId, game }) {
  const module = GAMES[game];
  if (!module) throw matchError(400, "unknown_game");
  const initial = await store.getRelationshipContext(userId);
  if (!activePair(initial)) throw matchError(409, "pairing_required");
  const relationshipId = initial.relationship.id;
  return store.transaction(`relationship:${relationshipId}`, async (tx) => {
    const context = await tx.getRelationshipContext(userId);
    if (!activePair(context) || context.relationship.id !== relationshipId) throw matchError(409, "pairing_required");
    const mine = (await tx.listRelationshipRecordsForUser(COLLECTION, userId)).filter((match) => match.relationshipId === relationshipId && match.game === game);
    const open = mine.find((match) => match.status === "active");
    if (open) return { match: open, created: false };
    const previous = mine.filter((match) => match.status === "finished").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const players = context.members.map((member) => member.userId);
    const record = createRelationshipRecord({ relationshipId, userId, visibility: "shared", aiAccessScope: "none", approvalPolicy: "both", status: "active", game, players, state: null, turn: null, finishedAt: null });
    record.state = module.start({ players, inviterUserId: userId, matchId: record.id, previous });
    record.turn = module.turn(record.state);
    await tx.createRelationshipRecord(COLLECTION, record);
    const inviter = context.members.find((member) => member.userId === userId)?.user?.name || "";
    const i18n = togetherI18n((language) => language === "en" ? `${inviter} started a game of ${gameName(game, language)}` : language === "es" ? `${inviter} empezó una partida de ${gameName(game, language)}` : `${inviter} 开了一局${gameName(game, language)}`);
    const posted = await appendTogetherMessage(tx, { relationshipId, actorUserId: null, userId, source: "app", kind: "match_invite", text: i18n.zh, i18n, handle: `match:${record.id}` });
    const conversation = await tx.updateRelationshipRecordForUser("togetherConversations", posted.conversation.id, userId, (draft) => { draft.messages = draft.messages.map((item) => item.id === posted.message.id ? { ...item, match: { id: record.id, game, invitedBy: userId } } : item); draft.version += 1; });
    return { match: record, created: true, conversation };
  });
}

/** One move (or resign, end, ...) by a player. Returns the match and whose turn it was before. */
export async function actOnMatch({ store, userId, matchId, action }) {
  const initial = await store.getRelationshipContext(userId);
  if (!initial) throw matchError(409, "pairing_required");
  return store.transaction(`relationship:${initial.relationship.id}`, async (tx) => {
    const match = await tx.getRelationshipRecordForUser(COLLECTION, matchId, userId);
    if (!match || match.relationshipId !== initial.relationship.id || !match.players.includes(userId)) throw matchError(404, "not_found");
    const module = GAMES[match.game];
    if (!module) throw matchError(404, "not_found");
    if (match.status !== "active") throw matchError(409, "match_over");
    const context = await tx.getRelationshipContext(userId);
    if (!activePair(context)) throw matchError(409, "pairing_required");
    const state = module.act(match.state, { userId, action });
    const finished = module.finished(state);
    const updated = await tx.updateRelationshipRecordForUser(COLLECTION, match.id, userId, (draft) => {
      draft.state = state; draft.turn = module.turn(state); draft.version += 1;
      if (finished) { draft.status = "finished"; draft.finishedAt = new Date().toISOString(); }
    });
    return { match: updated, before: match.turn };
  });
}

/** What the hall shows per game, from all of this couple's matches of it. */
export function matchStats(matches) {
  return Object.fromEntries(Object.entries(GAMES).map(([id, module]) => [id, module.stats(matches.filter((match) => match.game === id && (id !== "gomoku" || match.status === "finished")))]));
}
