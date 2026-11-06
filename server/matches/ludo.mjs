import { randomInt } from "node:crypto";
import { HOST, matchError, PET } from "./errors.mjs";

// 情侣飞行棋 (founder 11-06): a simplified two-player ludo for couples. Each player has 2 planes; both race once around one
// shared loop of 30 squares, from their own take-off square, and fly home from the square before it with an exact roll.
// - The die is rolled here (action "roll"); the client never says what came up.
// - A 6 launches a plane from the hangar onto its take-off square. When nothing of yours is on the loop, every roll without a
//   6 counts as a failed try; the third in a row launches a plane anyway, so nobody gets stuck. A 6 gives another roll.
// - When more than one plane can move (to a different square), the player chooses ("move" with the plane index); one choice
//   moves by itself, and no choice passes the turn.
// - Landing exactly on the other player's plane(s) sends them back to their hangar. Whoever gets both planes home wins.
// - Every 5th square has a heart: landing there shows a small task for the one who landed, and their turn waits until they
//   tap 做到了 ("task", done: true) or 跳过 (done: false). Pinky writes ~12 tasks at the start, in each player's language;
//   without a model the built-in list below is used. 小家伙 does its tasks by itself, with a cute line.
export const LOOP = 30, HOME = LOOP, HANGAR = -1, PLANES = 2, FORCED_AFTER = 3, TASK_COUNT = 12;
export const ENTRY = [0, 15];
export const isHeart = (square) => square % 5 === 2;
const KEEP_LOG = 8, MAX_TASKS = 20, MAX_TASK_LENGTH = 160;
export const LANGS = ["zh", "en", "es"];

// The die. Tests swap `roll` for a fixed sequence; the game itself only ever uses this.
export const dice = { roll: () => randomInt(1, 7) };

// Built-in tasks [zh, en, es]: warm, doable over the phone or side by side, never costly or embarrassing.
export const TASKS = [
  ["说出三件你喜欢 TA 的地方。", "Say three things you like about your partner.", "Di tres cosas que te gustan de tu pareja."],
  ["告诉 TA 今天让你开心的一件小事。", "Tell your partner one small thing that made you happy today.", "Cuéntale a tu pareja algo pequeño que hoy te hizo feliz."],
  ["给 TA 发一张你现在看到的画面。", "Send your partner a photo of what you see right now.", "Mándale a tu pareja una foto de lo que ves ahora mismo."],
  ["用一个词形容你们第一次见面。", "Describe your first meeting in one word.", "Describe su primer encuentro en una palabra."],
  ["说一件 TA 最近做了让你很感动的事。", "Name something your partner did lately that touched you.", "Menciona algo que tu pareja hizo hace poco y te conmovió."],
  ["哼一小段你最近常听的歌给 TA 听。", "Hum a bit of a song you've been playing lately.", "Tararea un poco de una canción que escuchas últimamente."],
  ["说一个你们下次见面想一起做的小事。", "Name one small thing you want to do together next time you meet.", "Di algo pequeño que quieras hacer juntos la próxima vez que se vean."],
  ["夸一夸 TA 今天的样子或声音。", "Pay your partner a compliment on how they look or sound today.", "Hazle un cumplido a tu pareja por cómo se ve o se oye hoy."],
  ["说出一道你想和 TA 一起吃的菜。", "Name a dish you'd love to eat together.", "Di un plato que te encantaría comer juntos."],
  ["分享一个你小时候的有趣回忆。", "Share a funny memory from when you were little.", "Comparte un recuerdo divertido de cuando eras pequeño o pequeña."],
  ["给 TA 起一个今天专用的可爱昵称。", "Give your partner a cute nickname just for today.", "Ponle a tu pareja un apodo tierno solo por hoy."],
  ["说一句你一直想对 TA 说的谢谢。", "Say a thank-you you've been meaning to tell your partner.", "Dile a tu pareja un gracias que tenías pendiente."],
  ["描述一下你理想中的一个周末早晨。", "Describe your ideal weekend morning together.", "Describe su mañana de fin de semana ideal juntos."],
  ["学一种小动物的叫声给 TA 听。", "Do your best little animal sound for your partner.", "Imita el sonido de un animalito para tu pareja."],
  ["说出 TA 的一个小习惯，你觉得很可爱。", "Name one little habit of your partner's you find adorable.", "Di una costumbre de tu pareja que te parece adorable."],
  ["给 TA 发一个你现在的表情自拍。", "Send your partner a selfie of your face right now.", "Mándale a tu pareja una selfi con tu cara de ahora."],
  ["说一个你们一起去过、还想再去的地方。", "Name a place you've been together and want to go back to.", "Di un lugar donde estuvieron juntos y al que quieres volver."],
  ["用三个表情符号描述你今天的心情。", "Describe your mood today in three emoji.", "Describe tu ánimo de hoy con tres emojis."],
  ["说一件你最近学到的有趣的小知识。", "Share a fun little fact you learned recently.", "Comparte un dato curioso que aprendiste hace poco."],
  ["对 TA 说晚安或早安，用最温柔的语气。", "Say good night or good morning to your partner in your softest voice.", "Dale las buenas noches o los buenos días a tu pareja con tu voz más tierna."],
  ["说出 TA 让你笑得最厉害的一次。", "Recall the time your partner made you laugh the hardest.", "Recuerda la vez que tu pareja te hizo reír más."],
  ["说一个你想和 TA 一起学的新东西。", "Name something new you'd like to learn together.", "Di algo nuevo que te gustaría aprender juntos."],
  ["给 TA 讲一个十秒钟的小故事。", "Tell your partner a ten-second story.", "Cuéntale a tu pareja una historia de diez segundos."],
  ["说出你现在最想给 TA 的一个拥抱是什么样的。", "Describe the hug you'd give your partner right now.", "Describe el abrazo que le darías a tu pareja ahora mismo."],
  ["说一部你想和 TA 一起看的电影或剧。", "Name a film or show you want to watch together.", "Di una película o serie que quieras ver juntos."],
  ["分享你手机里一张让你开心的照片。", "Share a photo on your phone that makes you smile.", "Comparte una foto de tu teléfono que te haga sonreír."],
  ["说一件这周你为自己骄傲的事。", "Share one thing you're proud of yourself for this week.", "Comparte algo de esta semana de lo que estás orgulloso u orgullosa."],
  ["猜猜 TA 现在最想吃什么。", "Guess what your partner most wants to eat right now.", "Adivina qué es lo que más quiere comer tu pareja ahora."],
  ["说一个你觉得你们俩很像的地方。", "Name one way the two of you are alike.", "Di algo en lo que ustedes dos se parecen."],
  ["给 TA 一句明天的小小鼓励。", "Give your partner a little word of encouragement for tomorrow.", "Dale a tu pareja una palabrita de ánimo para mañana."],
];
// 小家伙 "does" a task with one of these; the screen puts its name in.
export const PET_LINES = [
  ["{name}转了个圈", "{name} spun around in a happy circle", "{name} dio una vueltecita feliz"],
  ["{name}蹭了蹭你的手", "{name} nuzzled your hand", "{name} te acarició la mano con el hocico"],
  ["{name}给你比了个心", "{name} made a little heart for you", "{name} te hizo un corazoncito"],
  ["{name}摇了摇尾巴", "{name} wagged its tail", "{name} movió la colita"],
  ["{name}跳了一小段舞", "{name} did a tiny dance", "{name} bailó un poquito"],
];

const seedOf = (...parts) => [...parts.join(":")].reduce((hash, char) => (hash * 31 + char.codePointAt(0)) | 0, 7);
const other = (state, userId) => state.players.find((id) => id !== userId);
const builtin = (index) => { const [zh, en, es] = TASKS[index]; return { zh, en, es }; };
/** `count` built-in tasks in an order of this game's own. */
export const builtinTasks = (seed, count = TASK_COUNT) => TASKS.map((_, index) => index).sort((a, b) => seedOf(seed, a) - seedOf(seed, b)).slice(0, count).map(builtin);

/** Where a plane of `userId` at `progress` (0..29) stands on the loop. */
export const squareOf = (state, userId, progress) => (ENTRY[state.players.indexOf(userId)] + progress) % LOOP;
const onLoop = (progress) => progress >= 0 && progress < HOME;

/** The planes of `userId` that can move `value`, as [{ plane, to }]; planes that would end on the same square count once. */
export function options(state, userId, value) {
  const found = [];
  state.planes[userId].forEach((progress, plane) => {
    const to = progress === HANGAR ? (value === 6 ? 0 : null) : onLoop(progress) && progress + value <= HOME ? progress + value : null;
    if (to !== null && !found.some((item) => item.from === progress)) found.push({ plane, from: progress, to });
  });
  return found;
}

function cleanTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks.slice(0, MAX_TASKS).map((task) => {
    if (!task || typeof task !== "object") return null;
    const clean = {};
    for (const language of LANGS) { const text = typeof task[language] === "string" ? task[language].trim() : ""; if (text && text.length <= MAX_TASK_LENGTH) clean[language] = text; }
    return Object.keys(clean).length ? clean : null;
  }).filter(Boolean);
}

const log = (state, entry) => [...state.log, { ...entry, n: state.rolls }].slice(-KEEP_LOG);
const pass = (state) => ({ ...state, current: other(state, state.current), phase: "roll", task: null });
const next = (state, extra) => extra ? { ...state, phase: "roll", task: null } : pass(state);

function nextTask(state) {
  const list = state.tasks?.length ? state.tasks : builtinTasks(state.seed, TASKS.length);
  return { text: list[state.taskCount % list.length], taskCount: state.taskCount + 1 };
}

/** Moves `plane` of the player to move by the die (`forced`: the third try without a 6 launches it), with everything that
 * follows: capture, home, the win, a heart's task, and another roll after a 6. */
function move(state, plane, value, forced = false) {
  const userId = state.current, rival = other(state, userId);
  const from = state.planes[userId][plane], to = from === HANGAR ? 0 : from + value;
  const mine = state.planes[userId].map((progress, index) => index === plane ? to : progress);
  let theirs = state.planes[rival], entries = [{ by: userId, kind: forced ? "forced" : from === HANGAR ? "launch" : to === HOME ? "home" : "move", plane, value }];
  if (onLoop(to)) {
    const square = squareOf(state, userId, to);
    const hit = theirs.map((progress, index) => onLoop(progress) && squareOf(state, rival, progress) === square ? index : -1).filter((index) => index >= 0);
    if (hit.length) { theirs = theirs.map((progress, index) => hit.includes(index) ? HANGAR : progress); entries.push({ by: userId, kind: "capture", planes: hit }); }
  }
  let moved = { ...state, planes: { ...state.planes, [userId]: mine, [rival]: theirs }, tries: { ...state.tries, [userId]: from === HANGAR ? 0 : state.tries[userId] } };
  for (const entry of entries) moved = { ...moved, log: log(moved, entry) };
  if (mine.every((progress) => progress === HOME)) return { ...moved, phase: "over", winner: userId, task: null };
  const extra = value === 6 && !forced;
  if (onLoop(to) && isHeart(squareOf(state, userId, to))) {
    const { text, taskCount } = nextTask(moved);
    moved = { ...moved, taskCount };
    if (userId === PET) {
      // 小家伙 does it by itself, no tap needed.
      const line = Math.abs(seedOf(state.seed, taskCount)) % PET_LINES.length;
      return next({ ...moved, log: log(moved, { by: PET, kind: "task", done: true, line }), done: { ...moved.done, [PET]: (moved.done[PET] || 0) + 1 } }, extra);
    }
    return { ...moved, phase: "task", task: { by: userId, text, extra } };
  }
  return next(moved, extra);
}

/** The plane 小家伙 moves: a capture first, then getting home, then the plane furthest along. */
export function petChoice(state, userId, value) {
  const choices = options(state, userId, value), rival = other(state, userId);
  const captures = (choice) => onLoop(choice.to) && state.planes[rival].some((progress) => onLoop(progress) && squareOf(state, rival, progress) === squareOf(state, userId, choice.to));
  return (choices.find(captures) || choices.find((choice) => choice.to === HOME) || [...choices].sort((a, b) => b.from - a.from)[0])?.plane;
}

export const ludo = {
  id: "ludo",
  category: "casual",
  start({ players, inviterUserId, matchId }) {
    const first = players.includes(inviterUserId) ? inviterUserId : players[0];
    const ordered = [first, ...players.filter((id) => id !== first)];
    return {
      players: ordered, seed: seedOf(matchId), planes: Object.fromEntries(ordered.map((id) => [id, Array(PLANES).fill(HANGAR)])),
      current: first, phase: "roll", die: null, rolls: 0, tries: Object.fromEntries(ordered.map((id) => [id, 0])),
      task: null, tasks: null, taskSource: null, taskCount: 0, done: Object.fromEntries(ordered.map((id) => [id, 0])), skipped: Object.fromEntries(ordered.map((id) => [id, 0])),
      log: [], winner: null, resignedBy: null,
    };
  },
  turn(state) { return state.phase === "over" ? null : state.current; },
  act(state, { userId, action }) {
    if (action?.type === "tasks") {
      // Pinky's tasks for this game, once, at the start.
      if (userId !== HOST || state.tasks) throw matchError(409, "invalid_action");
      const tasks = cleanTasks(action.tasks);
      if (!tasks.length) throw matchError(400, "invalid_action");
      return { ...state, tasks, taskSource: action.source === "model" ? "model" : "builtin" };
    }
    if (!state.players.includes(userId)) throw matchError(409, "not_your_turn");
    if (state.phase === "over") throw matchError(409, "match_over");
    if (action?.type === "resign") return { ...state, phase: "over", winner: other(state, userId), resignedBy: userId, task: null };
    if (state.current !== userId) throw matchError(409, "not_your_turn");
    if (action?.type === "roll") {
      if (state.phase === "task") throw matchError(409, "task_pending");
      if (state.phase !== "roll") throw matchError(409, "choose_plane");
      // Only the server's die counts; anything the client sends with it is ignored.
      const value = dice.roll(), rolls = state.rolls + 1;
      let rolled = { ...state, rolls, die: { value, by: userId, n: rolls } };
      const choices = options(rolled, userId, value);
      if (!choices.length) {
        const stuck = !rolled.planes[userId].some(onLoop) && rolled.planes[userId].includes(HANGAR);
        const tries = stuck ? rolled.tries[userId] + 1 : rolled.tries[userId];
        if (stuck && tries >= FORCED_AFTER) {
          // Third try without a 6: a plane takes off anyway, and the turn passes.
          return move(rolled, rolled.planes[userId].indexOf(HANGAR), value, true);
        }
        return pass({ ...rolled, tries: { ...rolled.tries, [userId]: tries }, log: log(rolled, { by: userId, kind: stuck ? "try" : "pass", value, tries: stuck ? tries : undefined }) });
      }
      if (choices.length === 1 || userId === PET) return move(rolled, userId === PET ? petChoice(rolled, userId, value) : choices[0].plane, value);
      return { ...rolled, phase: "move" };
    }
    if (action?.type === "move") {
      if (state.phase !== "move") throw matchError(409, state.phase === "task" ? "task_pending" : "roll_first");
      const plane = action.plane;
      if (!Number.isInteger(plane) || plane < 0 || plane >= PLANES) throw matchError(400, "invalid_action");
      const progress = state.planes[userId][plane], value = state.die.value;
      const can = progress === HANGAR ? value === 6 : onLoop(progress) && progress + value <= HOME;
      if (!can) throw matchError(409, "plane_stuck");
      return move(state, plane, value);
    }
    if (action?.type === "task") {
      if (state.phase !== "task" || state.task?.by !== userId) throw matchError(409, "roll_first");
      if (typeof action.done !== "boolean") throw matchError(400, "invalid_action");
      const key = action.done ? "done" : "skipped";
      const settled = { ...state, [key]: { ...state[key], [userId]: (state[key][userId] || 0) + 1 }, log: log(state, { by: userId, kind: "task", done: action.done }) };
      return next(settled, state.task.extra);
    }
    throw matchError(400, "invalid_action");
  },
  finished(state) { return state.phase === "over"; },
  /** Nothing is secret between the two of them; only the tasks still to come stay a surprise (and the seed that orders them). */
  view(state) {
    const { seed, tasks, ...shown } = state;
    void seed;
    return { ...shown, tasks: null, tasksReady: Boolean(tasks?.length) };
  },
  /** Wins of each player, and the little tasks done along the way. */
  stats(matches) {
    const wins = {}; let tasks = 0, played = 0;
    for (const match of matches) {
      const state = match.state;
      if (!state) continue;
      tasks += Object.values(state.done || {}).reduce((sum, count) => sum + count, 0);
      if (state.phase === "over") { played += 1; if (state.winner) wins[state.winner] = (wins[state.winner] || 0) + 1; }
    }
    return { wins, played, tasks };
  },
  // Pinky hosts: the game's tasks, written once at the start in each player's language.
  hostPending(state) { return state.phase !== "over" && !state.tasks; },
};

const object = (properties) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const NAMES = { zh: "Simplified Chinese", en: "English", es: "Spanish" };

ludo.hostActions = async ({ state, mediator, language, languages = [] }) => {
  // Each player's language, and the one the game was just opened in.
  const wanted = [...new Set([...languages, language].filter((item) => LANGS.includes(item)))];
  const langs = wanted.length ? wanted : ["zh"];
  try {
    const schema = object({ tasks: { type: "array", maxItems: 16, items: object(Object.fromEntries(langs.map((language) => [language, { type: "string" }]))) } });
    const result = await mediator?.structured?.({ name: "ludo_tasks", schema, maxOutputTokens: 2000, // The game's own number makes every game's request new (background calls with an input already answered are skipped).
      input: JSON.stringify({ game: state.seed, count: TASK_COUNT, languages: langs.map((language) => NAMES[language]) }),
      instructions: `You are Pinky, hosting a cosy board game for a couple. Write ${TASK_COUNT} fresh little tasks; a player does one when their plane lands on a heart square. Each is one short sentence addressed to the player, about their partner (call them "TA" in Chinese, "your partner" in English, "tu pareja" in Spanish), doable in under a minute over the phone or side by side, like "Say three things you like about your partner", "Tell your partner one small thing that made you happy today", "Send your partner a photo of what you see right now". Warm and playful, varied. Never sexual, never embarrassing or about exes, never costing money, never needing anything special. Give every task in each of these languages, with the same meaning: ${langs.map((language) => `${language} (${NAMES[language]})`).join(", ")}.` });
    const tasks = cleanTasks(result?.tasks).filter((task) => langs.every((language) => task[language])).map((task) => Object.fromEntries(langs.map((language) => [language, task[language]])));
    if (tasks.length >= 6) return [{ type: "tasks", tasks, source: "model" }];
  } catch (error) { console.error("ludo tasks failed", error?.code || error?.message || "error"); }
  return [{ type: "tasks", tasks: builtinTasks(state.seed), source: "builtin" }];
};

// 小家伙 as the other player: it just rolls; the plane it moves is chosen with the roll (petChoice), and it does its own tasks.
ludo.petActions = async ({ state }) => state.phase === "roll" && state.current === PET ? [{ type: "roll" }] : [];
ludo.petInstant = true;
