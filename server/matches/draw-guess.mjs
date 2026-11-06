import { matchError } from "./errors.mjs";

// 你画我猜 (founder 11-06): the two of them take turns. The drawer gets a word only they can see, draws it and passes it on;
// the other has three guesses. Either way the word is shown to both, and the next round starts with the roles swapped. It is
// played together, not against each other: the hall counts how many drawings were guessed. Every word exists in Chinese,
// English and Spanish, so each of them sees and guesses it in their own language.
export const GUESSES = 3;
const KEEP_DRAWINGS = 4, KEEP_ROUNDS = 30;
export const MAX_STROKES = 400, MAX_POINTS = 6000, COLORS = 6, WIDTHS = 3;

// [category, zh, en, es]
export const WORDS = [
  ["animal", "猫", "cat", "gato"], ["animal", "狗", "dog", "perro"], ["animal", "兔子", "rabbit", "conejo"], ["animal", "大象", "elephant", "elefante"],
  ["animal", "长颈鹿", "giraffe", "jirafa"], ["animal", "企鹅", "penguin", "pingüino"], ["animal", "蛇", "snake", "serpiente"], ["animal", "鱼", "fish", "pez"],
  ["animal", "蝴蝶", "butterfly", "mariposa"], ["animal", "熊猫", "panda", "panda"], ["animal", "猪", "pig", "cerdo"], ["animal", "蜗牛", "snail", "caracol"],
  ["food", "苹果", "apple", "manzana"], ["food", "香蕉", "banana", "plátano"], ["food", "西瓜", "watermelon", "sandía"], ["food", "蛋糕", "cake", "pastel"],
  ["food", "冰淇淋", "ice cream", "helado"], ["food", "披萨", "pizza", "pizza"], ["food", "汉堡", "hamburger", "hamburguesa"], ["food", "面条", "noodles", "fideos"],
  ["food", "鸡蛋", "egg", "huevo"], ["food", "胡萝卜", "carrot", "zanahoria"], ["food", "咖啡", "coffee", "café"], ["food", "寿司", "sushi", "sushi"],
  ["thing", "雨伞", "umbrella", "paraguas"], ["thing", "眼镜", "glasses", "gafas"], ["thing", "钥匙", "key", "llave"], ["thing", "手机", "phone", "teléfono"],
  ["thing", "气球", "balloon", "globo"], ["thing", "吉他", "guitar", "guitarra"], ["thing", "相机", "camera", "cámara"], ["thing", "台灯", "lamp", "lámpara"],
  ["thing", "剪刀", "scissors", "tijeras"], ["thing", "戒指", "ring", "anillo"], ["thing", "枕头", "pillow", "almohada"], ["thing", "牙刷", "toothbrush", "cepillo de dientes"],
  ["place", "房子", "house", "casa"], ["place", "山", "mountain", "montaña"], ["place", "海滩", "beach", "playa"], ["place", "桥", "bridge", "puente"],
  ["place", "城堡", "castle", "castillo"], ["place", "摩天轮", "ferris wheel", "noria"], ["nature", "太阳", "sun", "sol"], ["nature", "月亮", "moon", "luna"],
  ["nature", "彩虹", "rainbow", "arcoíris"], ["nature", "雪人", "snowman", "muñeco de nieve"], ["nature", "花", "flower", "flor"], ["nature", "树", "tree", "árbol"],
  ["nature", "云", "cloud", "nube"], ["nature", "闪电", "lightning", "rayo"], ["travel", "飞机", "airplane", "avión"], ["travel", "自行车", "bicycle", "bicicleta"],
  ["travel", "火车", "train", "tren"], ["travel", "船", "boat", "barco"], ["travel", "火箭", "rocket", "cohete"], ["travel", "汽车", "car", "coche"],
];

const pick = (used, seed) => {
  const free = WORDS.map((_, index) => index).filter((index) => !used.includes(index));
  const pool = free.length ? free : WORDS.map((_, index) => index);
  return pool[Math.abs(seed) % pool.length];
};
const seedOf = (...parts) => [...parts.join(":")].reduce((hash, char) => (hash * 31 + char.codePointAt(0)) | 0, 7);
const word = (index) => { const [category, zh, en, es] = WORDS[index]; return { category, zh, en, es }; };
const current = (state) => state.rounds.at(-1);
const other = (state, userId) => state.players.find((id) => id !== userId);

/** Forgiving comparison: case, spaces, punctuation and a leading article or trailing plural "s" don't matter. */
export function sameWord(guess, entry) {
  const norm = (value) => String(value || "").normalize("NFKC").toLowerCase().trim().replace(/^(a|an|the|el|la|los|las|un|una)\s+/u, "").replace(/[\s\p{P}\p{S}]+/gu, "");
  const plain = (value) => norm(value).normalize("NFD").replace(/\p{M}/gu, "");
  const said = plain(guess);
  if (!said) return false;
  return ["zh", "en", "es"].some((language) => { const target = plain(entry[language]); return said === target || said === `${target}s` || said === `${target}es`; });
}

function newRound(state, drawer, salt) {
  const index = pick(state.used, seedOf(state.seed, state.rounds.length, salt));
  return { round: { drawer, word: index, strokes: null, guesses: [], outcome: null }, used: [...state.used, index].slice(-WORDS.length + 1) };
}

function cleanStrokes(strokes) {
  if (!Array.isArray(strokes) || !strokes.length || strokes.length > MAX_STROKES) return null;
  let points = 0;
  const cleaned = [];
  for (const stroke of strokes) {
    const color = Number.isInteger(stroke?.c) && stroke.c >= 0 && stroke.c < COLORS ? stroke.c : 0;
    const width = Number.isInteger(stroke?.w) && stroke.w >= 0 && stroke.w < WIDTHS ? stroke.w : 1;
    if (!Array.isArray(stroke?.p) || stroke.p.length < 2 || stroke.p.length % 2) return null;
    if (!stroke.p.every((value) => Number.isInteger(value) && value >= 0 && value <= 1000)) return null;
    points += stroke.p.length / 2;
    if (points > MAX_POINTS) return null;
    cleaned.push({ c: color, w: width, p: stroke.p });
  }
  return cleaned;
}

export const drawGuess = {
  id: "draw",
  category: "draw",
  start({ players, inviterUserId, matchId }) {
    const state = { players: [...players], seed: seedOf(matchId), used: [], rounds: [] };
    const { round, used } = newRound(state, inviterUserId, 0);
    return { ...state, used, rounds: [round] };
  },
  turn(state) {
    if (state.ended) return null;
    const round = current(state);
    return round.strokes ? other(state, round.drawer) : round.drawer;
  },
  act(state, { userId, action }) {
    if (state.ended) throw matchError(409, "match_over");
    const round = current(state);
    if (action?.type === "end") return { ...state, ended: true, endedBy: userId };
    if (action?.type === "swap") {
      // Another word, before anything is drawn.
      if (round.drawer !== userId || round.strokes) throw matchError(409, "not_your_turn");
      const { round: fresh, used } = newRound(state, userId, `${round.word}:${state.used.length}`);
      return { ...state, used, rounds: [...state.rounds.slice(0, -1), fresh] };
    }
    if (action?.type === "draw") {
      if (round.drawer !== userId || round.strokes) throw matchError(409, "not_your_turn");
      const strokes = cleanStrokes(action.strokes);
      if (!strokes) throw matchError(400, "drawing_required");
      return { ...state, rounds: [...state.rounds.slice(0, -1), { ...round, strokes, drawnAt: new Date().toISOString() }] };
    }
    if (action?.type === "guess") {
      if (!round.strokes || round.drawer === userId) throw matchError(409, "not_your_turn");
      const text = String(action.text || "").trim().slice(0, 40);
      if (!text) throw matchError(400, "guess_required");
      const correct = sameWord(text, word(round.word));
      const guesses = [...round.guesses, { text, correct, at: new Date().toISOString() }];
      const outcome = correct ? "guessed" : guesses.length >= GUESSES ? "missed" : null;
      const done = { ...round, guesses, outcome };
      if (!outcome) return { ...state, rounds: [...state.rounds.slice(0, -1), done] };
      // Next round: the one who guessed draws. Only the last few drawings are kept with their strokes.
      const { round: next, used } = newRound(state, userId, state.rounds.length);
      const rounds = [...state.rounds.slice(0, -1), done, next].slice(-KEEP_ROUNDS).map((item, index, all) => index < all.length - KEEP_DRAWINGS && item.strokes ? { ...item, strokes: [] } : item);
      return { ...state, used, rounds, guessed: (state.guessed || 0) + Number(correct), played: (state.played || 0) + 1 };
    }
    throw matchError(400, "invalid_action");
  },
  finished(state) { return Boolean(state.ended); },
  /** The word of a round still being played is shown only to its drawer; the guesser gets its kind and length. */
  view(state, userId) {
    return { ...state, used: undefined, seed: undefined, rounds: state.rounds.map((round) => {
      const entry = word(round.word);
      const hint = { category: entry.category, length: { zh: [...entry.zh].length, en: entry.en.replace(/\s/g, "").length, es: entry.es.replace(/\s/g, "").length } };
      return round.outcome || round.drawer === userId ? { ...round, word: entry, hint } : { ...round, word: null, hint };
    }) };
  },
  stats(matches) {
    let guessed = 0, played = 0;
    for (const match of matches) { guessed += match.state.guessed || 0; played += match.state.played || 0; }
    return { guessed, played };
  },
};
