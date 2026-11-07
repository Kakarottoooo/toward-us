import { createRelationshipRecord } from "../relationship-domain.mjs";
import { appendTogetherMessage, memberLanguage, togetherI18n } from "../together-domain.mjs";
import { drawGuess } from "./draw-guess.mjs";
import { asAiUser } from "../ai-budget.mjs";
import { BOTH, HOST, matchError, PET } from "./errors.mjs";
import { gomoku } from "./gomoku.mjs";
import { reversi } from "./reversi.mjs";
import { connectFour } from "./connect-four.mjs";
import { twoTruths } from "./two-truths.mjs";
import { rps } from "./rps.mjs";
import { xiangqi } from "./xiangqi.mjs";
import { ludo } from "./ludo.mjs";
import { soup } from "./soup.mjs";

// 游戏大厅 (founder 11-06): games with a screen of their own, played by the two of them in turns. Each game is a module with
// the same shape, so adding one is adding a module here and its screen in src/features/games:
//   id, category              which game, and the hall section it is listed under
//   start({ players, inviterUserId, matchId, previous }) -> state
//   act(state, { userId, action }) -> state        throws matchError for a move that isn't allowed
//   turn(state) -> userId | null                   whose move it is (null once nobody needs to move)
//   finished(state) -> boolean
//   view(state, userId) -> what this player may see (hidden words, hands, ships... stay with their owner)
//   stats(matches) -> the line the hall shows for this game
//   petActions({ state, mediator, language }) -> the moves 小家伙 makes when it is its turn (petInstant: no model, answer now)
// Optional, for games Pinky hosts (海龟汤) or that end with something to say:
//   hostPending(state) -> true while Pinky has something to do (write the puzzle, answer a question)
//   hostActions({ state, mediator, language, languages }) -> what Pinky does, applied as player HOST; `languages` are the
//     players' interface languages, so text both read can be written in each of them
//   announce(state, { name }) -> { zh, en, es } said in Us when a game between the two of them ends (name(id) -> their name)
//   said(before, after, { name }) -> [{ zh, en, es }] said in Us after a move of a game between the two of them
// turn(state) may be BOTH when either player may act.
// A match is a shared record of the couple (collection "matches"); its invitation is a card in Us. A match with 小家伙 (their
// pet, player id PET) is private to the one playing: no card, no push, and it doesn't count in the couple's stats.
export const GAMES = Object.freeze({ gomoku, draw: drawGuess, reversi, connect4: connectFour, truths: twoTruths, rps, xiangqi, ludo, soup });
export const COLLECTION = "matches";
const NAMES = { gomoku: ["五子棋", "Gomoku", "Gomoku"], draw: ["你画我猜", "Draw & guess", "Dibuja y adivina"], reversi: ["黑白棋", "Reversi", "Reversi"], connect4: ["四子棋", "Four in a row", "Cuatro en raya"], truths: ["两个真相一个谎言", "Two truths and a lie", "Dos verdades y una mentira"], rps: ["石头剪刀布", "Rock paper scissors", "Piedra, papel o tijera"], xiangqi: ["象棋", "Chinese chess", "Ajedrez chino"], ludo: ["情侣飞行棋", "Couples' ludo", "Parchís de pareja"], soup: ["海龟汤", "Lateral puzzles", "Acertijos laterales"] };
export const gameName = (game, language) => { const names = NAMES[game] || [game, game, game]; return language === "en" ? names[1] : language === "es" ? names[2] : names[0]; };

export const withPet = (match) => match.players.includes(PET);
const activePair = (context) => context?.relationship.status === "active" && context.members.length === 2;

export function viewMatch(match, userId) {
  const module = GAMES[match.game];
  return { id: match.id, game: match.game, status: match.status, players: match.players, turn: match.turn, createdByUserId: match.createdByUserId, createdAt: match.createdAt, updatedAt: match.updatedAt, finishedAt: match.finishedAt || null, endedBy: match.endedBy || null, version: match.version, state: module ? module.view(match.state, userId) : null };
}

export async function listMatches(store, userId) {
  const context = await store.getRelationshipContext(userId);
  if (!context) return [];
  // The store hands every record of the couple to either member; a game with 小家伙 is only for the one playing it.
  return (await store.listRelationshipRecordsForUser(COLLECTION, userId)).filter((match) => match.relationshipId === context.relationship.id && GAMES[match.game] && match.players.includes(userId));
}

/** Starts a game of `game` with the partner (announced in Us) or with 小家伙, or returns the one of those still being played. */
export async function createMatch({ store, userId, game, pet = false }) {
  const module = GAMES[game];
  if (!module || (pet && !module.petActions)) throw matchError(400, "unknown_game");
  const initial = await store.getRelationshipContext(userId);
  if (!activePair(initial)) throw matchError(409, "pairing_required");
  const relationshipId = initial.relationship.id;
  return store.transaction(`relationship:${relationshipId}`, async (tx) => {
    const context = await tx.getRelationshipContext(userId);
    if (!activePair(context) || context.relationship.id !== relationshipId) throw matchError(409, "pairing_required");
    const mine = (await tx.listRelationshipRecordsForUser(COLLECTION, userId)).filter((match) => match.relationshipId === relationshipId && match.game === game && withPet(match) === pet && match.players.includes(userId));
    const open = mine.find((match) => match.status === "active");
    if (open) return { match: open, created: false };
    const previous = mine.filter((match) => match.status === "finished").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const players = pet ? [userId, PET] : context.members.map((member) => member.userId);
    const record = createRelationshipRecord({ relationshipId, userId, visibility: pet ? "private" : "shared", aiAccessScope: "none", approvalPolicy: "both", status: "active", game, players, state: null, turn: null, finishedAt: null });
    record.state = module.start({ players, inviterUserId: userId, matchId: record.id, previous });
    record.turn = module.turn(record.state);
    await tx.createRelationshipRecord(COLLECTION, record);
    if (pet) return { match: record, created: true, conversation: null };
    const inviter = context.members.find((member) => member.userId === userId)?.user?.name || "";
    const i18n = togetherI18n((language) => language === "en" ? `${inviter} started a game of ${gameName(game, language)}` : language === "es" ? `${inviter} empezó una partida de ${gameName(game, language)}` : `${inviter} 开了一局${gameName(game, language)}`);
    const posted = await appendTogetherMessage(tx, { relationshipId, actorUserId: null, userId, source: "app", kind: "match_invite", text: i18n.zh, i18n, handle: `match:${record.id}` });
    const conversation = await tx.updateRelationshipRecordForUser("togetherConversations", posted.conversation.id, userId, (draft) => { draft.messages = draft.messages.map((item) => item.id === posted.message.id ? { ...item, match: { id: record.id, game, invitedBy: userId } } : item); draft.version += 1; });
    return { match: record, created: true, conversation };
  });
}

/** One move (or resign, end, ...) by a player. Returns the match and whose turn it was before. `as` is PET for 小家伙's moves,
 * made in the name of the member playing with it. */
export async function actOnMatch({ store, userId, matchId, action, as = userId }) {
  const initial = await store.getRelationshipContext(userId);
  if (!initial) throw matchError(409, "pairing_required");
  return store.transaction(`relationship:${initial.relationship.id}`, async (tx) => {
    const match = await tx.getRelationshipRecordForUser(COLLECTION, matchId, userId);
    const module = match && GAMES[match.game];
    if (!match || !module || match.relationshipId !== initial.relationship.id || !match.players.includes(userId) || !(match.players.includes(as) || (as === HOST && module.hostActions))) throw matchError(404, "not_found");
    if (match.status !== "active") throw matchError(409, "match_over");
    const context = await tx.getRelationshipContext(userId);
    if (!activePair(context)) throw matchError(409, "pairing_required");
    // "abandon", not "end": 你画我猜, 两个真相 and 石头剪刀布 finish normally with their own "end".
    if (action?.type === "abandon") return endMatch(tx, { match, userId, as, context });
    const state = module.act(match.state, { userId: as, action });
    const finished = module.finished(state);
    const updated = await tx.updateRelationshipRecordForUser(COLLECTION, match.id, userId, (draft) => {
      draft.state = state; draft.turn = module.turn(state); draft.version += 1;
      if (finished) { draft.status = "finished"; draft.finishedAt = new Date().toISOString(); }
    });
    // A game between the two of them may end with a line in Us (石头剪刀布: who lost the bet).
    let conversation = null;
    const said = finished && !withPet(updated) && module.announce?.(state, { name: (id) => context.members.find((member) => member.userId === id)?.user?.name || "" });
    if (said?.zh && said.en && said.es) {
      const posted = await appendTogetherMessage(tx, { relationshipId: updated.relationshipId, actorUserId: null, userId, source: "app", kind: "text", text: said.zh, i18n: said, handle: `match-end:${updated.id}` });
      if (!posted.duplicate) conversation = posted.conversation;
    }
    // And lines a move itself asks for (飞行棋: a rent paid with a little promise).
    const lines = withPet(updated) ? [] : module.said?.(match.state, state, { name: (id) => context.members.find((member) => member.userId === id)?.user?.name || "" }) || [];
    for (const [index, line] of lines.entries()) {
      if (!line?.zh || !line.en || !line.es) continue;
      const posted = await appendTogetherMessage(tx, { relationshipId: updated.relationshipId, actorUserId: null, userId, source: "app", kind: "text", text: line.zh, i18n: line, handle: `match-say:${updated.id}:${updated.version}:${index}` });
      if (!posted.duplicate) conversation = posted.conversation;
    }
    return { match: updated, before: match.turn, conversation };
  });
}

/** Either player stops a game that isn't over (founder 11-06: games left hanging kept saying "轮到你了"). It ends with no
 * winner and counts for nobody; a game with the partner gets a line in Us so they know where it went. 小家伙 and Pinky never
 * end a game. */
async function endMatch(tx, { match, userId, as, context }) {
  if (as !== userId) throw matchError(409, "invalid_action");
  const updated = await tx.updateRelationshipRecordForUser(COLLECTION, match.id, userId, (draft) => {
    draft.status = "ended"; draft.turn = null; draft.endedBy = userId; draft.finishedAt = new Date().toISOString(); draft.version += 1;
  });
  if (withPet(updated)) return { match: updated, before: match.turn, conversation: null };
  const me = context.members.find((member) => member.userId === userId)?.user?.name || "";
  const i18n = togetherI18n((language) => language === "en" ? `${me} ended your game of ${gameName(match.game, language)}. It doesn't count for anyone.` : language === "es" ? `${me} terminó su partida de ${gameName(match.game, language)}. No cuenta para nadie.` : `${me} 结束了这局${gameName(match.game, language)}，没下完，不算输赢。`);
  const posted = await appendTogetherMessage(tx, { relationshipId: updated.relationshipId, actorUserId: null, userId, source: "app", kind: "text", text: i18n.zh, i18n, handle: `match-end:${updated.id}` });
  return { match: updated, before: match.turn, conversation: posted.duplicate ? null : posted.conversation };
}

/** What the hall shows per game, from all of this couple's matches of it. */
export function matchStats(matches) {
  // Board games count finished games; the others count rounds played, also in games still going.
  const FINISHED_ONLY = new Set(["gomoku", "reversi", "connect4", "xiangqi"]);
  return Object.fromEntries(Object.entries(GAMES).map(([id, module]) => [id, module.stats(matches.filter((match) => match.game === id && (!FINISHED_ONLY.has(id) || match.status === "finished")))]));
}

const playing = new Set();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hosting = (module, match) => Boolean(module?.hostActions && module.hostPending?.(match.state));
/** True when Pinky (hosting) or 小家伙 (its turn) has something to do in this match; petPlays then does it. */
export const autoPending = (match) => match.status === "active" && (hosting(GAMES[match.game], match) || (withPet(match) && match.turn === PET));

/** Pinky's hosting and 小家伙's turn: they act until nothing is left for them. `onMove` sees every move (to tell the open App).
 * Never throws. */
export async function petPlays({ store, mediator, userId, matchId, language = "zh", onMove = () => {}, delay = 1200, again = 0 }) {
  if (playing.has(matchId)) return;
  playing.add(matchId);
  try {
    for (let turn = 0; turn < 8; turn += 1) {
      const match = await store.getRelationshipRecordForUser(COLLECTION, matchId, userId);
      if (!match || !autoPending(match)) return;
      const module = GAMES[match.game], host = hosting(module, match);
      const languages = host ? await Promise.all(match.players.filter((id) => id !== PET).map((id) => memberLanguage(store, id))) : [language];
      const actions = await asAiUser({ userId, language }, () => host ? module.hostActions({ state: match.state, mediator, language, languages }) : module.petActions({ state: match.state, mediator, language }));
      if (!actions.length) return;
      const round = match.state.rounds?.length;
      for (const [index, action] of actions.entries()) {
        if (index && delay) await pause(delay);
        const { match: moved, conversation } = await actOnMatch({ store, userId, matchId, action, as: host ? HOST : PET });
        onMove(moved, conversation);
        if (!autoPending(moved) || moved.state.rounds?.length !== round || (!host && moved.turn !== PET)) break;
      }
    }
  } catch (error) { console.error("auto move failed", error?.matchCode || error?.message || "error"); }
  finally { playing.delete(matchId); }
  // Something may have arrived while it was busy (a question asked just as it answered the last one): look once more.
  const latest = again < 3 ? await Promise.resolve().then(() => store.getRelationshipRecordForUser(COLLECTION, matchId, userId)).catch(() => null) : null;
  if (latest && autoPending(latest)) return petPlays({ store, mediator, userId, matchId, language, onMove, delay, again: again + 1 });
}
