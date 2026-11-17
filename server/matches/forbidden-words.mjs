import { BOTH, matchError } from "./errors.mjs";

const across = ([zh, en, es]) => ({ zh, en, es });
const card = (answer, forbidden, aliases = [], similar = []) => ({ answer: across(answer), forbidden: forbidden.map(across), aliases, similar });
const deck = [
  card(["披萨", "Pizza", "Pizza"], [["芝士", "Cheese", "Queso"], ["意大利", "Italy", "Italia"], ["面饼", "Crust", "Masa"]], ["比萨", "pizzas"], ["奶酪", "起司", "italian", "italiano", "italiana", "dough", "base"]),
  card(["火山", "Volcano", "Volcán"], [["岩浆", "Lava", "Lava"], ["喷发", "Erupt", "Erupción"], ["山峰", "Mountain", "Montaña"]], ["volcanoes", "volcanes"], ["熔岩", "erupting", "eruption", "erupcionar", "magma"]),
  card(["雨伞", "Umbrella", "Paraguas"], [["雨水", "Rain", "Lluvia"], ["撑开", "Open", "Abrir"], ["淋湿", "Wet", "Mojado"]], ["伞", "umbrellas", "sombrilla"], ["下雨", "开放", "rainy", "raining", "llover", "mojar", "abierto"]),
  card(["企鹅", "Penguin", "Pingüino"], [["冰", "Ice", "Hielo"], ["鸟", "Bird", "Ave"], ["南极", "Antarctica", "Antártida"]], ["penguins", "pingüinos"], ["冰雪", "冰块", "pájaro", "sur"]),
  card(["冲浪板", "Surfboard", "Tabla de surf"], [["海浪", "Wave", "Ola"], ["海滩", "Beach", "Playa"], ["站立", "Stand", "De pie"]], ["冲浪", "surfboards", "tabla de surfing"], ["浪花", "surf", "surfing", "standing"]),
  card(["手电筒", "Flashlight", "Linterna"], [["电池", "Battery", "Pila"], ["光", "Light", "Luz"], ["黑暗", "Dark", "Oscuridad"]], ["电筒", "torch", "flashlights", "linternas"], ["batteries", "batería", "oscuro", "claridad"]),
  card(["爆米花", "Popcorn", "Palomitas"], [["电影", "Movie", "Película"], ["玉米", "Corn", "Maíz"], ["黄油", "Butter", "Mantequilla"]], ["palomitas de maíz", "pochoclo", "cotufas"], ["cinema", "film", "cine", "granos"]),
  card(["月亮", "Moon", "Luna"], [["夜晚", "Night", "Noche"], ["太空", "Space", "Espacio"], ["地球", "Earth", "Tierra"]], ["月球", "the moon"], ["晚上", "nochecita", "espacial", "nighttime"]),
  card(["向日葵", "Sunflower", "Girasol"], [["太阳", "Sun", "Sol"], ["黄色", "Yellow", "Amarillo"], ["种子", "Seed", "Semilla"]], ["sunflowers", "girasoles"], ["葵花", "金黄", "amarilla", "sunlight"]),
  card(["冰淇淋", "Ice cream", "Helado"], [["冰冻", "Frozen", "Congelado"], ["甜筒", "Cone", "Cono"], ["香草", "Vanilla", "Vainilla"]], ["冰激凌", "雪糕", "gelato", "nieve"], ["奶油", "cream", "crema", "freezer", "barquillo"]),
  card(["蝴蝶", "Butterfly", "Mariposa"], [["翅膀", "Wing", "Ala"], ["毛毛虫", "Caterpillar", "Oruga"], ["花", "Flower", "Flor"]], ["butterflies", "mariposas"], ["花朵", "floral"]),
  card(["彩虹", "Rainbow", "Arcoíris"], [["颜色", "Color", "Color"], ["天空", "Sky", "Cielo"], ["下雨", "Rain", "Lluvia"]], ["rainbows", "arco iris", "arco iris solar"], ["色彩", "colores", "raining", "llover"]),
  card(["吊床", "Hammock", "Hamaca"], [["树", "Tree", "Árbol"], ["睡觉", "Sleep", "Dormir"], ["摇晃", "Swing", "Balancear"]], ["hammocks", "hamacas"], ["睡着", "swinging", "siesta", "balanceo", "dormido"]),
  card(["独角兽", "Unicorn", "Unicornio"], [["角", "Horn", "Cuerno"], ["马", "Horse", "Caballo"], ["魔法", "Magic", "Magia"]], ["unicorns", "unicornios"], ["magical", "magico", "mágica"]),
  card(["行李箱", "Suitcase", "Maleta"], [["旅行", "Travel", "Viaje"], ["衣服", "Clothes", "Ropa"], ["机场", "Airport", "Aeropuerto"]], ["旅行箱", "luggage", "suitcases", "valija"], ["trip", "travelling", "viajar", "equipaje", "服装"]),
  card(["珍珠奶茶", "Bubble tea", "Té de burbujas"], [["茶", "Tea", "Té"], ["珍珠", "Pearl", "Perla"], ["吸管", "Straw", "Pajita"]], ["奶茶", "boba", "boba tea", "té de perlas", "té boba"], ["tapioca", "popote", "pitillo", "茶叶"]),
  card(["瀑布", "Waterfall", "Cascada"], [["水", "Water", "Agua"], ["岩石", "Rock", "Roca"], ["落下", "Fall", "Caer"]], ["waterfalls", "catarata", "cascadas"], ["falls", "falling", "caída", "descender"]),
  card(["放大镜", "Magnifying glass", "Lupa"], [["大", "Big", "Grande"], ["侦探", "Detective", "Detective"], ["镜片", "Lens", "Lente"]], ["magnifier", "magnifying glasses", "lupas"], ["aumentar", "enlarge", "magnify", "大号"]),
  card(["滑板", "Skateboard", "Patineta"], [["轮子", "Wheel", "Rueda"], ["板", "Board", "Tabla"], ["滑", "Skate", "Patinar"]], ["skateboards", "monopatín", "patinetas"], ["skateboarding", "skater", "ramp", "patinaje"]),
  card(["沙漏", "Hourglass", "Reloj de arena"], [["沙子", "Sand", "Arena"], ["时间", "Time", "Tiempo"], ["玻璃", "Glass", "Vidrio"]], ["hourglasses", "reloj de cristal"], ["sandglass", "timer", "cristal", "reloj", "计时"]),
];

const roundsPerGame = 4;
const maxGuesses = 3;
const clean = (text) => typeof text === "string" ? text.replace(/\p{Cf}/gu, "").replace(/[\p{C}\s]+/gu, " ").trim() : "";
const fold = (text) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function contains(text, term) {
  const value = fold(term);
  if (/\p{Script=Han}/u.test(value)) return text.replaceAll(" ", "").includes(value.replaceAll(" ", ""));
  return ["", "s", "es"].some((ending) => (" " + text + " ").includes(" " + value + ending + " "));
}

function validClue(text, prompt) {
  const words = fold(text);
  const forbidden = [...Object.values(prompt.answer), ...prompt.aliases, ...prompt.similar, ...prompt.forbidden.flatMap(Object.values)];
  return words && !forbidden.some((phrase) => contains(words, phrase));
}

function correctGuess(text, prompt) {
  const words = fold(text);
  return [...Object.values(prompt.answer), ...prompt.aliases].some((label) =>
    words === fold(label) || words.replace(/^(?:a|an|the|un|una|el|la) /u, "") === fold(label)
  );
}

const current = (state) => state.rounds.at(-1);
const promptFor = (state, number) => deck[(state.startIndex + number) % deck.length];
const stage = (round) => round.outcome ? "reveal" : round.clues.length > round.guesses.length ? "guess" : "clue";
const revision = (round) => round.clues.length + round.guesses.length;
const score = (state) => state.rounds.filter((round) => round.outcome === "correct").length;
const nextRound = (giver) => ({ giver, clues: [], guesses: [], outcome: null });

export const forbiddenWords = {
  id: "forbidden-words",
  category: "words",
  start({ players, inviterUserId, previous }) {
    const last = previous?.[0]?.state?.startIndex;
    const startIndex = typeof last === "number" ? (last + roundsPerGame) % deck.length : 0;
    return { players, startIndex, rounds: [nextRound(inviterUserId || players[0])] };
  },
  act(state, { userId, action }) {
    if (!state.players.includes(userId)) throw matchError(404, "not_found");
    if (forbiddenWords.finished(state)) throw matchError(409, "match_over");
    const index = state.rounds.length - 1, round = current(state), phase = stage(round);
    if (action?.round !== index || action?.revision !== revision(round)) throw matchError(409, "forbidden_round_changed");
    const update = (changes) => ({ ...state, rounds: [...state.rounds.slice(0, index), { ...round, ...changes }] });
    if (phase === "reveal") {
      if (action.type !== "next") throw matchError(400, "invalid_action");
      return { ...state, rounds: [...state.rounds, nextRound(state.players.find((player) => player !== round.giver))] };
    }
    if (action.type === "skip") return update({ outcome: "passed" });
    const myClue = userId === round.giver;
    if ((phase === "clue") !== myClue) throw matchError(409, "not_your_turn");
    const prompt = promptFor(state, index);
    const text = clean(action.text);
    if (phase === "clue" && action.type === "clue") {
      if (!text || text.length > 160) throw matchError(400, "invalid_action");
      if (!validClue(text, prompt)) throw matchError(400, "forbidden_clue");
      return update({ clues: [...round.clues, text] });
    }
    if (phase === "guess" && action.type === "guess") {
      if (!fold(text) || text.length > 60) throw matchError(400, "guess_required");
      const guesses = [...round.guesses, text];
      const outcome = correctGuess(text, prompt) ? "correct" : guesses.length >= maxGuesses ? "missed" : null;
      return update({ guesses, outcome });
    }
    throw matchError(400, "invalid_action");
  },
  turn(state) {
    if (forbiddenWords.finished(state)) return null;
    const round = current(state);
    if (round.outcome) return BOTH;
    return stage(round) === "clue" ? round.giver : state.players.find((player) => player !== round.giver);
  },
  finished(state) { return state.rounds.length >= roundsPerGame && Boolean(current(state).outcome); },
  view(state, userId) {
    if (!state.players.includes(userId)) return null;
    const round = current(state), index = state.rounds.length - 1, prompt = promptFor(state, index);
    const givesClue = round.giver === userId;
    return {
      round: index, total: roundsPerGame, revision: revision(round), phase: stage(round), givesClue, score: score(state),
      clues: round.clues, guesses: round.guesses, attemptsLeft: maxGuesses - round.guesses.length, outcome: round.outcome,
      answer: givesClue || round.outcome ? prompt.answer : null,
      forbidden: givesClue && !round.outcome ? prompt.forbidden : [],
      recaps: state.rounds.flatMap((item, number) => item.outcome ? [{ answer: promptFor(state, number).answer, outcome: item.outcome }] : []),
    };
  },
  stats(matches) { return { played: matches.filter(({ state }) => forbiddenWords.finished(state)).length }; },
};
