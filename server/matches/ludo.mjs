import { randomInt } from "node:crypto";
import { HOST, matchError, PET } from "./errors.mjs";

// 情侣飞行棋 (founder 11-06). A two-player 飞行棋 for couples with a little 大富翁 in it:
// - Each player has 2 planes and starts with 200 爱心币. A 6 launches a plane onto its owner's start and gives another roll;
//   with nothing out, the third roll in a row without a 6 launches one anyway. Whoever gets both planes home wins.
// - Coins: 30 for every bridge a plane passes, 30 on a coin square, 60 on the inner ring's coin squares.
// - 约会地点 (8 places on the outer ring): stop on one nobody owns and you may buy it; stop on your own and you may upgrade
//   it once; stop on the other one's and you pay rent, in coins or (between the two of them) with a little promise that
//   Pinky writes down in Us.
// - 心动卡 squares draw a card (move, coins, swap places, a 护身符 against the next capture, a photo or a question to do
//   together, a free upgrade, or the 冷静角). The 冷静角 holds you for a turn: roll a 6 to get out at once, or the other one
//   says something nice and bails you out (action "bail").
// - Your own colour hops 4 squares; your flight square flies 12 along the dashed line; landing on the other one's plane
//   sends it back to the hangar; a roll past home bounces back. Hearts (on the inner ring) hold a little task Pinky wrote.
// - Choices wait for the player (phase "decide": buy, upgrade, rent, take the inner ring); 小家伙 makes its own at once.

// ---- The board (B3, founder 11-06: "地图是这样，但是你得多加点功能，参考大富翁") ----
// Two rings on a 9 x 17 grid. The outer ring is 48 squares; four bridges (at the middle of each side) cross a strip of grass
// to the inner "爱心内圈" (32 squares). Every plane flies one lap of 48 steps from its owner's start (a bridge square) back
// to it, which is home. Each quarter (12 steps, bridge to bridge) is flown on the outer ring, or, when a plane stopped on
// the bridge square at its start, on the inner ring instead: same length, no places to buy and no rent, but hearts and
// coins. Squares are named by what they are on the board, so planes on the inner ring meet whoever is there too.
export const BOARD = 3, LOOP = 48, QUARTER = 12, HOME = LOOP, HANGAR = -1, PLANES = 2, FORCED_AFTER = 3, TASK_COUNT = 12;
export const START = [0, 24];
export const JUMP = 4, FLIGHT_FROM = 28, FLIGHT = 12;
export const START_COINS = 200, BRIDGE_PAY = 30, COIN_SQUARE = 30, INNER_COIN = 60, CARD_TASK_PAY = 30, UPGRADE = 100;
// Outer squares (absolute, 0 = the first player's start, clockwise).
export const PLACES = [
  { square: 3, price: 100, name: ["咖啡馆", "Café", "Cafetería"] }, { square: 8, price: 120, name: ["电影院", "Cinema", "Cine"] },
  { square: 15, price: 140, name: ["公园", "Park", "Parque"] }, { square: 20, price: 160, name: ["游乐园", "Fun fair", "Feria"] },
  { square: 27, price: 100, name: ["书店", "Bookshop", "Librería"] }, { square: 32, price: 120, name: ["火锅店", "Hot pot", "Hot pot"] },
  { square: 39, price: 140, name: ["海边", "Seaside", "Playa"] }, { square: 44, price: 160, name: ["摩天轮", "Ferris wheel", "Noria"] },
];
export const CARDS_AT = [5, 18, 29, 42], COINS_AT = [2, 10, 26, 34], CALM_AT = [22, 46];
export const rentOf = (place, level) => Math.round(place.price * (level >= 2 ? 0.9 : 0.4));
const placeAt = (square) => PLACES.find((place) => place.square === square) || null;
/** Whose colour an outer square is (index 0 or 1), for the 4-square hop; special squares have none. */
export function colourOf(square) {
  if (square % QUARTER === 0 || placeAt(square) || CARDS_AT.includes(square) || COINS_AT.includes(square) || CALM_AT.includes(square)) return null;
  if (START.some((start) => (start + FLIGHT_FROM) % LOOP === square)) return null;
  return square % 4 === 1 ? 0 : square % 4 === 3 ? 1 : null;
}
// The inner ring: 32 squares, index 8k at the inner end of bridge k; hearts and coins on it.
export const INNER = 32, INNER_HEARTS = [2, 6], INNER_COINS = [4];
const innerKind = (index) => INNER_HEARTS.includes(index % 8) ? "heart" : INNER_COINS.includes(index % 8) ? "coin" : null;

/** Where a plane is: an outer square "o<n>", the grass by bridge k "g<k>", an inner square "i<n>", or null (hangar, home). */
export function cellOf(state, userId, plane) {
  const { p, inner } = plane;
  if (p < 0 || p >= HOME) return null;
  const start = START[state.players.indexOf(userId)], segment = Math.floor(p / QUARTER), step = p % QUARTER;
  const bridge = (start / QUARTER + segment) % 4;
  if (inner !== segment || step === 0) return `o${(start + p) % LOOP}`;
  if (step === 1) return `g${bridge}`;
  if (step === QUARTER - 1) return `g${(bridge + 1) % 4}`;
  return `i${(bridge * 8 + step - 2) % INNER}`;
}
const KEEP_LOG = 10, MAX_TASKS = 20, MAX_TASK_LENGTH = 160;
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



// Little promises a rent can be paid with, instead of coins (only between the two of them; Pinky writes it down in Us).
export const PROMISES = [
  ["下次奶茶我请", "the next bubble tea is on me", "el próximo té de burbujas lo pago yo"],
  ["给你按摩十分钟", "a ten-minute massage", "un masaje de diez minutos"],
  ["这周洗一次碗", "doing the dishes once this week", "lavar los platos una vez esta semana"],
  ["给你做一顿早餐", "making you breakfast", "prepararte un desayuno"],
  ["陪你看一部你选的电影", "watching a film of your choice", "ver una película que elijas tú"],
  ["给你写一张小纸条", "writing you a little note", "escribirte una notita"],
  ["听你吐槽十分钟不插嘴", "ten minutes of listening without interrupting", "diez minutos de escucharte sin interrumpir"],
  ["下次出门我拎包", "carrying the bags next time we go out", "llevar las bolsas la próxima vez que salgamos"],
];
// Questions a 心动卡 can ask (answered out loud or in Us).
export const QUESTIONS = [
  ["说一个你最近想和 TA 一起做的事。", "Name something you'd like to do with your partner soon.", "Di algo que te gustaría hacer pronto con tu pareja."],
  ["你们第一次约会，你最记得什么？", "What do you remember most from your first date?", "¿Qué recuerdas más de su primera cita?"],
  ["TA 哪个小习惯让你心动？", "Which little habit of your partner's makes your heart skip?", "¿Qué costumbre de tu pareja te enamora?"],
  ["如果明天放假一天，你想怎么和 TA 过？", "If tomorrow were a day off, how would you spend it together?", "Si mañana fuera libre, ¿cómo lo pasarían juntos?"],
  ["说一件 TA 不知道你很感激的事。", "Tell your partner something you're grateful for that they don't know.", "Cuéntale a tu pareja algo que agradeces y no sabe."],
  ["你最想和 TA 一起去哪里旅行？", "Where would you most like to travel together?", "¿A dónde les gustaría más viajar juntos?"],
];
// 心动卡 (the 机会/命运 of this board): what each one does.
export const CARDS = ["ahead3", "back2", "gift50", "bonus80", "swap", "charm", "photo", "question", "upgrade", "calm"];
/** The `count`-th card of a game with this seed: a shuffled order of its own, the same for both of them. */
export const cardAt = (seed, count) => CARDS[Math.abs(seedOf(seed, "card", count)) % CARDS.length];

const seedOf = (...parts) => [...parts.join(":")].reduce((hash, char) => (hash * 31 + char.codePointAt(0)) | 0, 7);
const other = (state, userId) => state.players.find((id) => id !== userId);
const pick3 = ([zh, en, es]) => ({ zh, en, es });
const builtin = (index) => pick3(TASKS[index]);
/** `count` built-in tasks in an order of this game's own. */
export const builtinTasks = (seed, count = TASK_COUNT) => TASKS.map((_, index) => index).sort((a, b) => seedOf(seed, a) - seedOf(seed, b)).slice(0, count).map(builtin);
export const outerOf = (state, userId, p) => (START[state.players.indexOf(userId)] + p) % LOOP;
const onBoard = (plane) => plane.p >= 0 && plane.p < HOME;
const log = (state, entry) => ({ ...state, log: [...state.log, { ...entry, n: state.rolls }].slice(-KEEP_LOG) });
const give = (state, userId, amount) => ({ ...state, coins: { ...state.coins, [userId]: Math.max(0, (state.coins[userId] || 0) + amount) } });
const setPlane = (state, userId, index, plane) => ({ ...state, planes: { ...state.planes, [userId]: state.planes[userId].map((item, at) => at === index ? plane : item) } });

/** Where a plane at `from` ends with the die, before any hop or flight: off the hangar only with a 6, and a roll past home
 * bounces back. Null when it can't move. */
export function stepTo(from, value) {
  if (from === HANGAR) return value === 6 ? 0 : null;
  if (from < 0 || from >= HOME) return null;
  const to = from + value;
  return to > HOME ? HOME - (to - HOME) : to;
}

/** The planes of `userId` that can move `value`, as [{ plane, from, to }]; two planes on the same spot count once. */
export function options(state, userId, value) {
  const found = [];
  state.planes[userId].forEach((plane, index) => {
    const to = stepTo(plane.p, value);
    if (to !== null && !found.some((item) => item.from === plane.p && item.inner === plane.inner)) found.push({ plane: index, from: plane.p, inner: plane.inner, to });
  });
  return found;
}

/** Puts plane `index` of the player to move at progress `to` (a die move, a hop, a flight or a card), paying 30 for each
 * bridge passed on the way forward, and keeping the inner ring only while still in the quarter it was chosen for. */
function place(state, userId, index, to, { pay = true } = {}) {
  const plane = state.planes[userId][index], from = plane.p;
  let next = state;
  if (pay && from >= 0) for (let bridge = (Math.floor(from / QUARTER) + 1) * QUARTER; bridge <= Math.min(to, HOME - 1); bridge += QUARTER) next = give(next, userId, BRIDGE_PAY);
  const inner = plane.inner === Math.floor(to / QUARTER) && to % QUARTER !== 0 ? plane.inner : -1;
  return setPlane(next, userId, index, { p: to, inner });
}

/** The other player's planes on the same square as plane `index` of `userId` go back to their hangar (a 护身符 saves one). */
function capture(state, userId, index) {
  const rival = other(state, userId), cell = cellOf(state, userId, state.planes[userId][index]);
  if (!cell) return state;
  let next = state;
  state.planes[rival].forEach((plane, at) => {
    if (cellOf(state, rival, plane) !== cell) return;
    if ((next.charm[rival] || 0) > 0) { next = log({ ...next, charm: { ...next.charm, [rival]: next.charm[rival] - 1 } }, { by: rival, kind: "charmed", plane: at }); return; }
    next = log(setPlane(next, rival, at, { p: HANGAR, inner: -1 }), { by: userId, kind: "capture", planes: [at] });
  });
  return next;
}

function nextTask(state) {
  const list = state.tasks?.length ? state.tasks : builtinTasks(state.seed, TASKS.length);
  return { text: list[state.taskCount % list.length], taskCount: state.taskCount + 1 };
}

/** What happens on the square plane `index` of the player to move has just reached (`depth` 1 after a hop, flight or card:
 * no second hop, flight or card). Returns the state, possibly waiting for a decision (phase "decide") or a task. */
function arrive(state, index, depth = 0) {
  const userId = state.current, plane = state.planes[userId][index];
  if (plane.p >= HOME) return log(state, { by: userId, kind: "home", plane: index });
  let next = capture(state, userId, index);
  const cell = cellOf(next, userId, plane);
  if (cell.startsWith("i")) {
    const kind = innerKind(Number(cell.slice(1)));
    if (kind === "coin") return log(give(next, userId, INNER_COIN), { by: userId, kind: "coins", amount: INNER_COIN });
    if (kind === "heart") return task(next, userId, null);
    return next;
  }
  if (cell.startsWith("g")) return next;
  const square = Number(cell.slice(1)), me = next.players.indexOf(userId);
  if (depth === 0 && plane.p === FLIGHT_FROM) return arrive(log(place(next, userId, index, FLIGHT_FROM + FLIGHT), { by: userId, kind: "flight", plane: index }), index, 1);
  if (depth === 0 && colourOf(square) === me && plane.p + JUMP < HOME && (plane.p + JUMP) % QUARTER !== 0) return arrive(log(place(next, userId, index, plane.p + JUMP), { by: userId, kind: "jump", plane: index }), index, 1);
  if (plane.p > 0 && plane.p % QUARTER === 0) return { ...next, phase: "decide", pending: { kind: "bridge", by: userId, plane: index } };
  const spot = placeAt(square);
  if (spot) {
    const owned = next.owned[square];
    if (!owned) return next.coins[userId] >= spot.price ? { ...next, phase: "decide", pending: { kind: "buy", by: userId, square, price: spot.price } } : next;
    if (owned.owner === userId) return owned.level < 2 && next.coins[userId] >= UPGRADE ? { ...next, phase: "decide", pending: { kind: "upgrade", by: userId, square, price: UPGRADE } } : next;
    return { ...next, phase: "decide", pending: { kind: "rent", by: userId, to: owned.owner, square, rent: rentOf(spot, owned.level) } };
  }
  if (COINS_AT.includes(square)) return log(give(next, userId, COIN_SQUARE), { by: userId, kind: "coins", amount: COIN_SQUARE });
  if (CALM_AT.includes(square)) return log({ ...next, calm: { ...next.calm, [userId]: true } }, { by: userId, kind: "calm" });
  if (CARDS_AT.includes(square) && depth === 0) return draw(next, index);
  return next;
}

function task(state, userId, card, pay = 0) {
  const { text, taskCount } = card ? { text: card, taskCount: state.taskCount } : nextTask(state);
  return { ...state, taskCount, phase: "task", task: { by: userId, text, pay, card: Boolean(card) } };
}

/** A 心动卡: what it says happens at once, or waits for a task. */
function draw(state, index) {
  const userId = state.current, rival = other(state, userId);
  const card = cardAt(state.seed, state.cardCount);
  let next = log({ ...state, cardCount: state.cardCount + 1, card: { by: userId, id: card, n: state.rolls } }, { by: userId, kind: "card", card });
  const plane = next.planes[userId][index];
  switch (card) {
    case "ahead3": return arrive(place(next, userId, index, Math.min(plane.p + 3, HOME)), index, 1);
    case "back2": return arrive(place(next, userId, index, Math.max(plane.p - 2, 0), { pay: false }), index, 1);
    case "gift50": { const paid = Math.min(50, next.coins[rival] || 0); return give(give(next, rival, -paid), userId, paid); }
    case "bonus80": return give(next, userId, 80);
    case "swap": {
      // Trade places with the other's plane furthest along (on the board, not on a runway of its own): only if it is ahead.
      const theirs = next.planes[rival].map((item, at) => ({ item, at })).filter(({ item }) => onBoard(item)).sort((a, b) => b.item.p - a.item.p)[0];
      if (!theirs) return next;
      const mineCell = outerOf(next, userId, plane.p), theirCell = outerOf(next, rival, theirs.item.p);
      const mineTo = (theirCell - START[next.players.indexOf(userId)] + LOOP) % LOOP, theirTo = (mineCell - START[next.players.indexOf(rival)] + LOOP) % LOOP;
      if (mineTo <= plane.p) return next;
      return setPlane(setPlane(next, userId, index, { p: mineTo, inner: -1 }), rival, theirs.at, { p: theirTo, inner: -1 });
    }
    case "charm": return { ...next, charm: { ...next.charm, [userId]: (next.charm[userId] || 0) + 1 } };
    case "photo": return task(next, userId, { zh: "一起拍张合照，发到“我们俩”。", en: "Take a photo together and share it in Us.", es: "Tómense una foto juntos y compártanla en Nosotros." }, CARD_TASK_PAY);
    case "question": return task(next, userId, pick3(QUESTIONS[next.cardCount % QUESTIONS.length]), CARD_TASK_PAY);
    case "upgrade": {
      const mine = Object.entries(next.owned).filter(([, owned]) => owned.owner === userId && owned.level < 2).map(([square]) => Number(square)).sort((a, b) => a - b)[0];
      return mine === undefined ? give(next, userId, 50) : { ...next, owned: { ...next.owned, [mine]: { owner: userId, level: 2 } } };
    }
    case "calm": return { ...next, calm: { ...next.calm, [userId]: true } };
    default: return next;
  }
}

const pass = (state) => ({ ...state, current: other(state, state.current), phase: "roll", task: null, pending: null, extra: false });
/** After the move and whatever it led to: the game may be won; otherwise another roll after a 6, or the other one's turn. */
function settle(state) {
  if (state.phase === "decide" || state.phase === "task") return state;
  const userId = state.current;
  if (state.planes[userId].every((plane) => plane.p >= HOME)) return { ...state, phase: "over", winner: userId, task: null, pending: null };
  return state.extra ? { ...state, phase: "roll", task: null, pending: null } : pass(state);
}

function move(state, index, value, forced = false) {
  const userId = state.current, from = state.planes[userId][index].p;
  const to = forced ? 0 : stepTo(from, value);
  let next = log(place({ ...state, extra: value === 6 && !forced, tries: { ...state.tries, [userId]: from === HANGAR ? 0 : state.tries[userId] } }, userId, index, to), { by: userId, kind: forced ? "forced" : from === HANGAR ? "launch" : to >= HOME ? "home" : "move", plane: index, value });
  next = from === HANGAR ? capture(next, userId, index) : arrive(next, index);
  return autoDecide(settle(next));
}

/** One choice the player to move makes: buy or not, upgrade or not, pay rent in coins or with a little promise, take the
 * bridge to the inner ring or not. */
function decide(state, choice) {
  const pending = state.pending, userId = pending.by;
  let next = { ...state, phase: "move", pending: null };
  if (pending.kind === "buy" && choice === "buy") next = log({ ...give(next, userId, -pending.price), owned: { ...next.owned, [pending.square]: { owner: userId, level: 1 } } }, { by: userId, kind: "buy", square: pending.square });
  else if (pending.kind === "upgrade" && choice === "upgrade") next = log({ ...give(next, userId, -pending.price), owned: { ...next.owned, [pending.square]: { owner: userId, level: 2 } } }, { by: userId, kind: "upgrade", square: pending.square });
  else if (pending.kind === "rent") {
    if (choice === "promise" && pending.to !== PET && userId !== PET) {
      const promise = pick3(PROMISES[Math.abs(seedOf(state.seed, "promise", state.promises.length)) % PROMISES.length]);
      next = log({ ...next, promises: [...next.promises, { from: userId, to: pending.to, text: promise, square: pending.square }] }, { by: userId, kind: "promise", square: pending.square });
    } else {
      const paid = Math.min(pending.rent, next.coins[userId] || 0);
      next = log(give(give(next, userId, -paid), pending.to, paid), { by: userId, kind: "rent", square: pending.square, amount: paid });
    }
  } else if (pending.kind === "bridge") {
    const plane = next.planes[userId][pending.plane];
    if (choice === "inner") next = log(setPlane(next, userId, pending.plane, { p: plane.p, inner: Math.floor(plane.p / QUARTER) }), { by: userId, kind: "inner", plane: pending.plane });
  } else if (!["skip", "outer"].includes(choice)) throw matchError(400, "invalid_action");
  return settle({ ...next, phase: "move" });
}

/** 小家伙 decides by itself: it buys and upgrades when it keeps some coins back, pays rent in coins, and takes the inner ring
 * when it is short of coins. */
function autoDecide(state) {
  let next = state;
  for (let guard = 0; guard < 6 && next.current === PET && ["decide", "task"].includes(next.phase); guard += 1) {
    if (next.phase === "task") {
      const line = Math.abs(seedOf(next.seed, next.taskCount, next.rolls)) % PET_LINES.length;
      next = settle(log({ ...give(next, PET, next.task.pay || 0), phase: "move", task: null, done: { ...next.done, [PET]: (next.done[PET] || 0) + 1 } }, { by: PET, kind: "task", done: true, line }));
      continue;
    }
    const { kind, price } = next.pending, coins = next.coins[PET] || 0;
    next = decide(next, kind === "buy" ? (coins - price >= 60 ? "buy" : "skip") : kind === "upgrade" ? (coins - price >= 80 ? "upgrade" : "skip") : kind === "bridge" ? (coins < 150 ? "inner" : "outer") : "coins");
  }
  return next;
}

/** The plane 小家伙 moves: one that sends a plane of mine home, then one that gets home, then the furthest along. */
export function petChoice(state, userId, value) {
  const choices = options(state, userId, value), rival = other(state, userId);
  const hits = (choice) => choice.from >= 0 && choice.to < HOME && state.planes[rival].some((plane) => cellOf(state, rival, plane) && cellOf(state, rival, plane) === cellOf(state, userId, { p: choice.to, inner: choice.inner === Math.floor(choice.to / QUARTER) ? choice.inner : -1 }));
  return (choices.find(hits) || choices.find((choice) => choice.to === HOME) || [...choices].sort((a, b) => b.from - a.from)[0])?.plane;
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

export const ludo = {
  id: "ludo",
  category: "casual",
  start({ players, inviterUserId, matchId }) {
    const first = players.includes(inviterUserId) ? inviterUserId : players[0];
    const ordered = [first, ...players.filter((id) => id !== first)];
    const each = (value) => Object.fromEntries(ordered.map((id) => [id, typeof value === "function" ? value() : value]));
    return {
      board: BOARD, players: ordered, seed: seedOf(matchId),
      planes: each(() => Array.from({ length: PLANES }, () => ({ p: HANGAR, inner: -1 }))),
      coins: each(START_COINS), owned: {}, charm: each(0), calm: each(false), promises: [],
      current: first, phase: "roll", die: null, rolls: 0, extra: false, tries: each(0), pending: null, card: null, cardCount: 0,
      task: null, tasks: null, taskSource: null, taskCount: 0, done: each(0), skipped: each(0),
      log: [], winner: null, resignedBy: null,
    };
  },
  turn(state) { return state.phase === "over" || state.board !== BOARD ? null : state.current; },
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
    // A game on an older board can only be ended, with no winner.
    if (state.board !== BOARD) { if (action?.type === "resign") return { ...state, phase: "over", winner: null, resignedBy: userId, task: null }; throw matchError(409, "old_board"); }
    if (action?.type === "resign") return { ...state, phase: "over", winner: other(state, userId), resignedBy: userId, task: null, pending: null };
    if (action?.type === "bail") {
      // Said something nice: the other one leaves the 冷静角 at once. Any time, not only on your turn.
      const rival = other(state, userId);
      if (!state.calm[rival] || userId === PET) throw matchError(409, "invalid_action");
      return log({ ...state, calm: { ...state.calm, [rival]: false } }, { by: userId, kind: "bail" });
    }
    if (state.current !== userId) throw matchError(409, "not_your_turn");
    if (action?.type === "roll") {
      if (state.phase === "task") throw matchError(409, "task_pending");
      if (state.phase === "decide") throw matchError(409, "decide_first");
      if (state.phase !== "roll") throw matchError(409, "choose_plane");
      // Only the server's die counts; anything the client sends with it is ignored.
      const value = dice.roll(), rolls = state.rolls + 1;
      let rolled = { ...state, rolls, die: { value, by: userId, n: rolls }, card: null };
      if (rolled.calm[userId]) {
        // In the 冷静角: a 6 gets out and plays on; anything else ends the turn there (and the next one is free).
        rolled = { ...rolled, calm: { ...rolled.calm, [userId]: false } };
        if (value !== 6) return autoDecide(pass(log(rolled, { by: userId, kind: "calmed", value })));
      }
      const choices = options(rolled, userId, value);
      if (!choices.length) {
        const stuck = !rolled.planes[userId].some(onBoard) && rolled.planes[userId].some((plane) => plane.p === HANGAR);
        const tries = stuck ? rolled.tries[userId] + 1 : rolled.tries[userId];
        if (stuck && tries >= FORCED_AFTER) return move(rolled, rolled.planes[userId].findIndex((plane) => plane.p === HANGAR), value, true);
        return pass(log({ ...rolled, tries: { ...rolled.tries, [userId]: tries } }, { by: userId, kind: stuck ? "try" : "pass", value, tries: stuck ? tries : undefined }));
      }
      if (choices.length === 1 || userId === PET) return move(rolled, userId === PET ? petChoice(rolled, userId, value) : choices[0].plane, value);
      return { ...rolled, phase: "move" };
    }
    if (action?.type === "move") {
      if (state.phase !== "move") throw matchError(409, state.phase === "task" ? "task_pending" : state.phase === "decide" ? "decide_first" : "roll_first");
      const plane = action.plane;
      if (!Number.isInteger(plane) || plane < 0 || plane >= PLANES) throw matchError(400, "invalid_action");
      if (stepTo(state.planes[userId][plane].p, state.die.value) === null) throw matchError(409, "plane_stuck");
      return move(state, plane, state.die.value);
    }
    if (action?.type === "decide") {
      if (state.phase !== "decide" || state.pending?.by !== userId) throw matchError(409, "roll_first");
      const allowed = { buy: ["buy", "skip"], upgrade: ["upgrade", "skip"], rent: ["coins", "promise"], bridge: ["inner", "outer"] }[state.pending.kind];
      if (!allowed.includes(action.choice)) throw matchError(400, "invalid_action");
      if (action.choice === "promise" && state.pending.to === PET) throw matchError(400, "invalid_action");
      return decide(state, action.choice);
    }
    if (action?.type === "task") {
      if (state.phase !== "task" || state.task?.by !== userId) throw matchError(409, "roll_first");
      if (typeof action.done !== "boolean") throw matchError(400, "invalid_action");
      const key = action.done ? "done" : "skipped";
      const settled = log({ ...(action.done ? give(state, userId, state.task.pay || 0) : state), [key]: { ...state[key], [userId]: (state[key][userId] || 0) + 1 }, phase: "move", task: null }, { by: userId, kind: "task", done: action.done });
      return settle(settled);
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
  /** A rent paid with a little promise is written down in Us, so it is remembered after the game. */
  said(before, after, { name }) {
    return (after.promises || []).slice((before.promises || []).length).map(({ from, to, text, square }) => {
      const where = placeAt(square)?.name || ["", "", ""];
      return { zh: `${name(from)} 在${name(to)}的${where[0]}欠下一个小承诺：${text.zh}。`, en: `${name(from)} owes ${name(to)} a little promise from the ${where[1]}: ${text.en}.`, es: `${name(from)} le debe a ${name(to)} una promesa por la ${where[2]}: ${text.es}.` };
    });
  },
  // Pinky hosts: the game's tasks, written once at the start in each player's language.
  hostPending(state) { return state.board === BOARD && state.phase !== "over" && !state.tasks; },
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
ludo.petActions = async ({ state }) => state.board === BOARD && state.phase === "roll" && state.current === PET ? [{ type: "roll" }] : [];
ludo.petInstant = true;
