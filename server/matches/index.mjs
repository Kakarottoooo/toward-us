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
import { treasureHunt } from "./treasure-hunt.mjs";
import { photoDetective } from "./photo-detective.mjs";
import { requireGamePhoto, readGamePhoto } from "./photo-game-media.mjs";
import { dotsBoxes } from "./dots-boxes.mjs";
import { doodleRelay } from "./doodle-relay.mjs";
import { jigsaw } from "./jigsaw.mjs";
import { sokoban } from "./sokoban.mjs";
import { battleship } from "./battleship.mjs";
import { kitchen } from "./kitchen.mjs";
import { timeline } from "./timeline.mjs";
import { photoRelay } from "./photo-relay.mjs";
import { song } from "./song.mjs";
import { escapeRoom } from "./escape-room.mjs";
import { spotDifference } from "./spot-difference.mjs";
import { memoryPairs } from "./memory-pairs.mjs";
import { dateBudget } from "./date-budget.mjs";
import { liarDice } from "./liar-dice.mjs";
import { miniGolf } from "./mini-golf.mjs";
import { stackTower } from "./stack-tower.mjs";
import { forbiddenWords } from "./forbidden-words.mjs";
import { arcadeGame } from "./arcade-game.mjs";
import { airHockey } from "./air-hockey.mjs";
import { pinballDuo } from "./pinball-duo.mjs";
import { blockDuel } from "./block-duel.mjs";
import { coPilot } from "./co-pilot.mjs";
import { riverRow } from "./river-row.mjs";
import { greenLight } from "./green-light.mjs";
import { minesDuo } from "./mines-duo.mjs";
import { crazyEights } from "./crazy-eights.mjs";

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
export const GAMES = Object.freeze({
  gomoku, draw: drawGuess, reversi, connect4: connectFour, truths: twoTruths, rps, xiangqi, ludo, soup, hunt: treasureHunt,
  dots: dotsBoxes, doodle: doodleRelay, jigsaw, detective: photoDetective, sokoban, battleship, kitchen, timeline, "photo-relay": photoRelay, song,
  "escape-room": escapeRoom, "spot-difference": spotDifference, "memory-pairs": memoryPairs, "date-budget": dateBudget,
  "liar-dice": liarDice, "mini-golf": miniGolf, "stack-tower": stackTower, "forbidden-words": forbiddenWords,
  "air-hockey": arcadeGame(airHockey), "pinball-duo": arcadeGame(pinballDuo), "block-duel": arcadeGame(blockDuel),
  "co-pilot": arcadeGame(coPilot), "river-row": arcadeGame(riverRow), "green-light": arcadeGame(greenLight),
  "mines-duo": minesDuo, "crazy-eights": crazyEights,
});
export const COLLECTION = "matches";
const NAMES = { gomoku: ["五子棋", "Gomoku", "Gomoku"], draw: ["你画我猜", "Draw & guess", "Dibuja y adivina"], reversi: ["黑白棋", "Reversi", "Reversi"], connect4: ["四子棋", "Four in a row", "Cuatro en raya"], truths: ["两个真相一个谎言", "Two truths and a lie", "Dos verdades y una mentira"], rps: ["石头剪刀布", "Rock paper scissors", "Piedra, papel o tijera"], xiangqi: ["象棋", "Chinese chess", "Ajedrez chino"], ludo: ["情侣飞行棋", "Couples' ludo", "Parchís de pareja"], soup: ["海龟汤", "Lateral puzzles", "Acertijos laterales"], hunt: ["双人寻宝", "Treasure Hunt", "Búsqueda del tesoro"], dots: ["连点占格", "Dots and Boxes", "Puntos y cajas"], doodle: ["接力涂鸦", "Doodle Relay", "Dibujo por turnos"], jigsaw: ["双人拼图", "Jigsaw Together", "Rompecabezas en pareja"], detective: ["照片侦探", "Photo Detective", "Detective de fotos"] };
Object.assign(NAMES, {
  sokoban: ["双人推箱子", "Together We Move", "Mudanza en pareja"], battleship: ["海战棋", "Battleship", "Batalla naval"],
  kitchen: ["两人开餐厅", "Two-Person Kitchen", "Cocina en pareja"], timeline: ["回忆时间线", "Memory Timeline", "Línea de recuerdos"],
  "photo-relay": ["拍照接力", "Photo Relay", "Reto de fotos"], song: ["一起做首歌", "Make a Song Together", "Hagamos una canción"],
  "escape-room": ["双人密室", "Room for Two", "Escape en pareja"], "spot-difference": ["合作找不同", "Spot the Difference Together", "Encuentren las diferencias"],
  "memory-pairs": ["翻牌搭档", "Memory Match Together", "Parejas de memoria"], "date-budget": ["约会拼预算", "Budget a Date", "Una cita con presupuesto"],
  "liar-dice": ["吹牛骰子", "Liar's Dice", "Dados mentirosos"], "mini-golf": ["迷你高尔夫", "Mini Golf", "Minigolf"],
  "stack-tower": ["双人叠塔", "Stack a Tower", "Construyan una torre"], "forbidden-words": ["禁词猜词", "Forbidden Words", "Palabras prohibidas"],
  "air-hockey": ["双人冰球", "Air Hockey", "Hockey de aire"], "pinball-duo": ["双人弹珠台", "Two-Player Pinball", "Pinball en pareja"],
  "block-duel": ["方块对战", "Block Duel", "Duelo de bloques"], "co-pilot": ["你指挥我开车", "You Navigate, I Drive", "Tú guías, yo conduzco"],
  "river-row": ["双人划船", "Row Together", "Remen juntos"], "green-light": ["绿灯抢拍", "Green Light", "Luz verde"],
  "mines-duo": ["双人扫雷", "Minesweeper Together", "Buscaminas en pareja"], "crazy-eights": ["疯狂八点", "Crazy Eights", "Ochos locos"],
});
export const gameName = (game, language) => { const names = NAMES[game] || [game, game, game]; return language === "en" ? names[1] : language === "es" ? names[2] : names[0]; };

export const withPet = (match) => match.players.includes(PET);
const activePair = (context) => context?.relationship.status === "active" && context.members.length === 2;

export function viewMatch(match, userId) {
  const module = GAMES[match.game];
  return { id: match.id, game: match.game, status: match.status, players: match.players, turn: match.turn, createdByUserId: match.createdByUserId, createdAt: match.createdAt, updatedAt: match.updatedAt, finishedAt: match.finishedAt || null, endedBy: match.endedBy || null, version: match.version, state: module ? module.view(match.state, userId) : null };
}

export async function listMatches(store, userId, onSettled) {
  const context = await store.getRelationshipContext(userId);
  if (!context) return [];
  // The store hands every record of the couple to either member; a game with 小家伙 is only for the one playing it.
  const matches = (await store.listRelationshipRecordsForUser(COLLECTION, userId)).filter((match) => match.relationshipId === context.relationship.id && GAMES[match.game] && match.players.includes(userId));
  const now = Date.now();
  const index = matches.findIndex((match) => kitchenResult(match, now));
  if (index < 0 || !activePair(context)) return matches;
  const id = matches[index].id;
  const result = await store.transaction(`relationship:${context.relationship.id}`, async (tx) => {
    const current = await tx.getRelationshipContext(userId);
    if (!activePair(current) || current.relationship.id !== context.relationship.id) return null;
    const match = await tx.getRelationshipRecordForUser(COLLECTION, id, userId);
    if (!match) return null;
    const state = kitchenResult(match, now);
    if (!state) return { match, settled: false };
    const updated = await saveMove(tx, match, userId, kitchen, state, true);
    const conversation = await announceFinish(tx, updated, userId, current);
    return { match: updated, settled: true, conversation };
  });
  if (result) {
    matches[index] = result.match;
    if (result.settled) onSettled?.(result.match, result.conversation, userId);
  }
  return matches;
}

// Apply the result on the next read or move if both players closed Pinky before the kitchen clock reached zero.
function kitchenResult(match, now) {
  if (match.game !== "kitchen" || match.status !== "active") return null;
  const state = kitchen.settle(match.state, now);
  return state === match.state ? null : state;
}

function saveMove(tx, match, userId, module, state, finished) {
  return tx.updateRelationshipRecordForUser(COLLECTION, match.id, userId, (draft) => {
    draft.state = state;
    draft.turn = module.turn(state);
    draft.version += 1;
    if (finished) { draft.status = "finished"; draft.finishedAt = new Date().toISOString(); }
  });
}

async function announceFinish(tx, match, userId, context) {
  const name = (id) => context.members.find((member) => member.userId === id)?.user?.name || "";
  const said = !withPet(match) && GAMES[match.game].announce?.(match.state, { name });
  if (!said?.zh || !said.en || !said.es) return null;
  const posted = await appendTogetherMessage(tx, { relationshipId: match.relationshipId, actorUserId: null, userId, source: "app", kind: "text", text: said.zh, i18n: said, handle: `match-end:${match.id}` });
  return posted.duplicate ? null : posted.conversation;
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
    const previous = mine.filter((match) => match.status === "finished");
    if (open) {
      const result = kitchenResult(open, Date.now());
      if (!result) return { match: open, created: false };
      const finished = await saveMove(tx, open, userId, kitchen, result, true);
      await announceFinish(tx, finished, userId, context);
      previous.push(finished);
    }
    previous.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
export async function actOnMatch({ store, userId, matchId, action, as = userId, expectedGame, arcadeInternal = false }) {
  const initial = await store.getRelationshipContext(userId);
  if (!initial) throw matchError(409, "pairing_required");
  return store.transaction(`relationship:${initial.relationship.id}`, async (tx) => {
    const match = await tx.getRelationshipRecordForUser(COLLECTION, matchId, userId);
    const module = match && GAMES[match.game];
    if (!match || !module || (expectedGame && match.game !== expectedGame) || match.relationshipId !== initial.relationship.id || !match.players.includes(userId) || !(match.players.includes(as) || (as === HOST && module.hostActions))) throw matchError(404, "not_found");
    const context = await tx.getRelationshipContext(userId);
    if (!activePair(context)) throw matchError(409, "pairing_required");
    if (match.status !== "active") {
      const repeated = (match.game === "kitchen" && action?.type === "settle") || (match.game === "photo-relay" && action?.type === "submit");
      if (match.status === "finished" && repeated) return { match, unchanged: true };
      throw matchError(409, "match_over");
    }
    // "abandon", not "end": 你画我猜, 两个真相 and 石头剪刀布 finish normally with their own "end".
    const now = Date.now();
    const timedResult = kitchenResult(match, now);
    if (action?.type === "abandon" && !timedResult) return endMatch(tx, { match, userId, as, context });
    const move = module.prepareAction ? await module.prepareAction({ tx, match, userId, action }) : action;
    let state = timedResult || module.act(match.state, { userId: as, action: move, now, arcadeInternal });
    if (match.game === "photo-relay" && state === match.state) return { match, unchanged: true };
    if ((match.game === "detective" && action?.type === "create_clue") || (match.game === "jigsaw" && action?.type === "photo")) {
      const photo = await requireGamePhoto(tx, { userId, relationshipId: match.relationshipId, photoId: action.photoId });
      if (match.game === "detective") await readGamePhoto(photo, { crop: action.crop });
    }
    const finished = module.finished(state);
    let milestone = null;
    if (finished && module.persistFinish) {
      const language = ["zh", "en", "es"].includes(action.language) ? action.language : "zh";
      ({ state, milestone } = await module.persistFinish({ tx, match, state, userId, context, language }));
    }
    const updated = await saveMove(tx, match, userId, module, state, finished);
    // A game between the two of them may end with a line in Us (石头剪刀布: who lost the bet).
    let conversation = finished ? await announceFinish(tx, updated, userId, context) : null;
    // And lines a move itself asks for (飞行棋: a rent paid with a little promise).
    const lines = withPet(updated) ? [] : module.said?.(match.state, state, { name: (id) => context.members.find((member) => member.userId === id)?.user?.name || "" }) || [];
    for (const [index, line] of lines.entries()) {
      if (!line?.zh || !line.en || !line.es) continue;
      const posted = await appendTogetherMessage(tx, { relationshipId: updated.relationshipId, actorUserId: null, userId, source: "app", kind: "text", text: line.zh, i18n: line, handle: `match-say:${updated.id}:${updated.version}:${index}` });
      if (!posted.duplicate) conversation = posted.conversation;
    }
    return { match: updated, before: match.turn, conversation, milestone };
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
