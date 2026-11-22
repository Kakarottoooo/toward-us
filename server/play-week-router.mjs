import express from "express";
import { dayIn, shiftDay, validZone } from "./streak.mjs";

const GOALS = { cards: 3, games: 1, notes: 2 };
const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;

export function weekOf(conversation, members, now, readerId = null) {
  // Each reader's card runs Monday to Sunday in their own time zone (QA round 6): a partner abroad no longer sees a week that
  // starts on their Sunday evening. Without a saved zone for the reader, the partner's, then UTC.
  const reader = members.find((member) => member.userId === readerId) || members.find((member) => member.role === "A") || members[0];
  const partner = members.find((member) => member.userId !== reader.userId);
  const timezone = validZone(conversation?.zones?.[reader.userId]) || validZone(conversation?.zones?.[partner?.userId]) || "UTC";
  const today = dayIn(now, timezone);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const start = shiftDay(today, -((weekday + 6) % 7));
  return { timezone, today, start, end: shiftDay(start, 6) };
}

/** A read-only view of shared activity. Partial answers and games with the pet never count. */
async function weeklyActivity(store, { conversation, matches, relationshipId, userId, members, week }) {
  const ids = members.map((member) => member.userId);
  const dateFormat = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: week.timezone });
  const dateOf = (value) => {
    const date = new Date(value || NaN);
    return Number.isFinite(date.getTime()) ? dateFormat.format(date) : "";
  };
  const inWeek = (day) => day >= week.start && day <= week.today;
  const cards = new Set(), games = new Set(), notes = new Set(), activity = new Set();
  const notesByDay = new Map();
  const collect = (messages) => {
    for (const message of messages || []) {
      if (!["daily_question", "game", "nudge"].includes(message.kind)) continue;
      const day = dateOf(message.createdAt);
      if (!inWeek(day)) continue;
      if (message.kind === "nudge") {
        if (!ids.includes(message.actorUserId)) continue;
        notes.add(message.actorUserId);
        const sent = notesByDay.get(day) ?? new Set();
        sent.add(message.actorUserId);
        notesByDay.set(day, sent);
        if (sent.size === ids.length) activity.add(day);
        continue;
      }
      if (!ids.every((id) => message.answers?.[id])) continue;
      const completed = ids.map((id) => dateOf(message.answers[id].at)).filter(Boolean).sort().at(-1) || day;
      if (!inWeek(completed)) continue;
      if (message.kind === "daily_question") cards.add(day);
      else games.add(message.id);
      activity.add(completed);
    }
  };

  collect(conversation?.messages);
  collect((conversation?.playDistance?.cards || []).map((card) => ({
    kind: "nudge", actorUserId: card.userId, createdAt: card.at,
  })));
  for (const id of ids) {
    if (inWeek(dateOf(conversation?.playDistance?.lastSentAt?.[id]))) notes.add(id);
  }
  for (let seq = conversation?.archived?.chunks || 0; seq >= 1; seq -= 1) {
    const chunk = await store.getRelationshipRecordForUser("togetherArchives", `together:${relationshipId}:archive:${seq}`, userId);
    const last = dateOf(chunk?.lastAt || chunk?.messages?.at(-1)?.createdAt);
    if (last && last < week.start) break;
    collect(chunk?.messages);
  }

  for (const match of matches) {
    if (match.relationshipId !== relationshipId || match.visibility !== "shared" || match.status !== "finished" ||
      match.players?.length !== ids.length || !ids.every((id) => match.players.includes(id))) continue;
    const finished = dateOf(match.finishedAt);
    if (!inWeek(dateOf(match.createdAt)) || !inWeek(finished)) continue;
    games.add(match.id);
    activity.add(finished);
  }
  return { counts: { cards: cards.size, games: games.size, notes: notes.size }, days: [...activity].sort() };
}

export function createPlayWeekRouter({ store }) {
  const router = express.Router();
  router.get("/play-week", async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const userId = req.auth?.user?.id;
    const language = req.query.language || req.auth?.user?.language;
    if (!userId) return res.status(401).json({ error: say(language, "请先登录。", "Sign in to see your week.", "Inicia sesión para ver tu semana.") });
    const context = await store.getRelationshipContext(userId);
    if (context?.relationship?.status !== "active" || context.members.length !== 2 ||
      !context.members.some((member) => member.userId === userId)) {
      return res.status(409).json({ error: say(language, "配对后可以查看共同进度。", "Pair up to see your week together.", "Vincúlense para ver su semana juntos.") });
    }
    const relationshipId = context.relationship.id;
    const [conversation, matches] = await Promise.all([
      store.getRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, userId),
      store.listRelationshipRecordsForUser("matches", userId),
    ]);
    const week = weekOf(conversation, context.members, new Date(), userId);
    const result = await weeklyActivity(store, { conversation, matches, relationshipId, userId, members: context.members, week });
    return res.json({ ...week, targets: GOALS, ...result });
  });
  return router;
}
