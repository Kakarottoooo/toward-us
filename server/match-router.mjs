import express from "express";
import { createHash } from "node:crypto";
import { recordUsage } from "./usage.mjs";
import { actOnMatch, autoPending, createMatch, gameName, GAMES, listMatches, matchStats, petPlays, viewMatch, withPet } from "./matches/index.mjs";
import { BOTH, MATCH_ERRORS, matchError } from "./matches/errors.mjs";

const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;

// 游戏大厅: the hall's list, starting a game, and each move. `notify(userId, { body, url, tag })` reaches a member who isn't
// looking (see reminder-service notifyMember); `online(userId)` is true while they have the App open.
export function createMatchRouter({ store, mediator = null, emit = () => {}, notify = async () => {}, online = () => false, petDelay = 1200 }) {
  const router = express.Router();
  router.use("/matches", (req, res, next) => req.auth ? next() : res.status(401).json({ error: say(req.body?.language || req.query?.language, "请先登录。", "Please sign in first.", "Inicia sesión primero.") }));

  router.get("/matches", async (req, res) => {
    const userId = req.auth.user.id, context = await store.getRelationshipContext(userId);
    if (!context) throw matchError(409, "pairing_required");
    const matches = await listMatches(store, userId);
    const shown = [...matches.filter((match) => match.status === "active"), ...matches.filter((match) => match.status !== "active").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10)];
    res.json({ games: Object.keys(GAMES), matches: shown.map((match) => viewMatch(match, userId)), stats: matchStats(matches.filter((match) => !withPet(match))), petStats: matchStats(matches.filter(withPet)), members: context.members.map((member) => ({ id: member.userId, name: member.user.name })), readOnly: context.relationship.status !== "active" || context.members.length !== 2 });
  });

  router.get("/matches/:id", async (req, res) => {
    const userId = req.auth.user.id, match = (await listMatches(store, userId)).find((item) => item.id === req.params.id);
    if (!match) throw matchError(404, "not_found");
    res.json({ match: viewMatch(match, userId) });
  });

  router.post("/matches", async (req, res) => {
    const userId = req.auth.user.id;
    const pet = req.body?.with === "pet";
    const result = await createMatch({ store, userId, game: String(req.body?.game || ""), pet });
    let match = result.match;
    if (result.created && !pet) {
      emit(match, "match.updated"); emit(result.conversation, "together.updated", null, userId);
      void recordUsage(store, { userId, relationshipId: match.relationshipId, action: "match_started" });
    }
    if (result.created) match = await autoTurn(req, match);
    res.status(result.created ? 201 : 200).json({ match: viewMatch(match, userId), created: result.created });
  });

  // Speaking instead of typing in a game (海龟汤 questions): the same realtime transcription as the App conversation. Only the
  // text comes back to the player's own box; nothing is saved until they send it as a move.
  router.post("/matches/:id/realtime", express.text({ type: "application/sdp", limit: "128kb" }), async (req, res) => {
    const userId = req.auth.user.id;
    if (!(await listMatches(store, userId)).some((item) => item.id === req.params.id)) throw matchError(404, "not_found");
    if (typeof req.body !== "string" || !req.body.includes("v=0")) throw matchError(400, "invalid_action");
    if (!mediator?.createRealtimeSession) throw matchError(503, "voice_unavailable");
    const language = ["zh", "en", "es"].includes(req.query.language) ? req.query.language : "zh";
    res.type("application/sdp").send(await mediator.createRealtimeSession({ sdp: req.body, language, safetyIdentifier: createHash("sha256").update(userId).digest("hex") }));
  });

  router.post("/matches/:id/actions", async (req, res) => {
    const userId = req.auth.user.id, action = req.body && typeof req.body === "object" ? req.body : {};
    const { match, before, conversation } = await actOnMatch({ store, userId, matchId: req.params.id, action });
    if (conversation) emit(conversation, "together.updated", null, userId);
    if (withPet(match)) { const after = await autoTurn(req, match); return res.json({ match: viewMatch(after, userId) }); }
    emit(match, "match.updated");
    void autoTurn(req, match);
    const partner = match.players.find((id) => id !== userId);
    // The partner hears about it when it becomes their move, or when the game ends, unless they are looking at the App.
    const theirs = (turn) => turn === partner || turn === BOTH;
    if (partner && !online(partner) && match.status !== "ended" && (match.status !== "active" || (theirs(match.turn) && !theirs(before)))) {
      const context = await store.getRelationshipContext(userId), me = context?.members.find((member) => member.userId === userId)?.user?.name || "";
      const drawn = match.game === "draw" && match.state.rounds.at(-1)?.strokes && match.status === "active";
      const body = (language) => {
        const game = gameName(match.game, language);
        if (match.status !== "active") return say(language, `${me} 结束了这局${game}，去看看结果`, `${me} finished your game of ${game}. See how it went`, `${me} terminó su partida de ${game}. Mira el resultado`);
        if (drawn) return say(language, `${me} 画好了，来猜猜是什么`, `${me} finished a drawing. Can you guess it?`, `${me} terminó un dibujo. ¿Adivinas qué es?`);
        return say(language, `轮到你了 · ${game}`, `Your turn · ${game}`, `Te toca · ${game}`);
      };
      void notify(partner, { body: { zh: body("zh"), en: body("en"), es: body("es") }, url: `/?channel=us&game=${encodeURIComponent(match.id)}`, tag: `pinky-game-${match.id}`.slice(0, 64) }).catch(() => console.error("game push failed"));
    }
    if (match.status !== "active") void recordUsage(store, { userId, relationshipId: match.relationshipId, action: "match_finished" });
    res.json({ match: viewMatch(match, userId) });
  });

  // 小家伙 moves when it is its turn (a board move right away: the reply carries it; a drawing or a guess a moment later) and
  // Pinky hosts (海龟汤: the puzzle, each answer). A game with 小家伙 is told to this member's open App only.
  async function autoTurn(req, match) {
    const userId = req.auth.user.id, language = ["zh", "en", "es"].includes(req.body?.language) ? req.body.language : "zh";
    if (!autoPending(match)) return match;
    const run = petPlays({ store, mediator, userId, matchId: match.id, language, delay: petDelay, onMove: (moved, conversation) => { emit(moved, "match.updated", withPet(moved) ? userId : null); if (conversation) emit(conversation, "together.updated", null, userId); } });
    if (withPet(match) && match.turn === "pet" && GAMES[match.game]?.petInstant) { await run; return (await listMatches(store, userId)).find((item) => item.id === match.id) || match; }
    void run; return match;
  }

  router.use((error, req, res, next) => {
    if (!error?.matchCode) return next(error);
    const language = req.body?.language || req.query?.language || req.auth?.user?.language || "zh";
    const copy = MATCH_ERRORS[error.matchCode] || MATCH_ERRORS.invalid_action;
    res.status(error.statusCode || 400).json({ error: say(language, ...copy), code: error.matchCode });
  });
  return router;
}
