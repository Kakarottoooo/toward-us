import { matchError, PET } from "./errors.mjs";

// 两个真相一个谎言 (founder 11-06, batch 2): one tells three things about themself, one of them made up; the other guesses
// which is the lie. Then they swap. The lie stays with the teller until the guess is in. The hall counts how often each one
// caught the other.
const MAX = 80;
const other = (state, userId) => state.players.find((id) => id !== userId);
const current = (state) => state.rounds.at(-1);

// 小家伙's own three things, in every language; `lie` is the made-up one.
export const PET_SETS = [
  { lie: 1, zh: ["我今天睡了十四个小时", "我最喜欢的食物是西兰花", "我会在你们说话的时候偷偷竖起耳朵"], en: ["I slept fourteen hours today", "My favourite food is broccoli", "I prick up my ears when you two talk"], es: ["Hoy dormí catorce horas", "Mi comida favorita es el brócoli", "Levanto las orejas cuando ustedes hablan"] },
  { lie: 2, zh: ["我追过自己的尾巴", "我觉得你们俩很般配", "我从来没有打过喷嚏"], en: ["I've chased my own tail", "I think you two are a great match", "I have never sneezed"], es: ["He perseguido mi propia cola", "Creo que ustedes dos hacen buena pareja", "Nunca he estornudado"] },
  { lie: 0, zh: ["我会说三种外语", "我喜欢被摸头", "下雨天我最想窝在被子里"], en: ["I speak three foreign languages", "I love a pat on the head", "On rainy days I just want to curl up in a blanket"], es: ["Hablo tres idiomas", "Me encanta que me acaricien la cabeza", "Los días de lluvia solo quiero acurrucarme"] },
  { lie: 1, zh: ["我最怕吸尘器", "我昨天自己学会了骑自行车", "你们一起答完今日一问时我会特别开心"], en: ["I'm scared of the vacuum cleaner", "Yesterday I taught myself to ride a bike", "I'm happiest when you both answer the daily question"], es: ["Le tengo miedo a la aspiradora", "Ayer aprendí solo a andar en bici", "Me pongo feliz cuando ambos responden la pregunta del día"] },
  { lie: 2, zh: ["我数过天上的星星，数到一半睡着了", "我偷偷记住了你们的纪念日", "我一口气能吃十个汉堡"], en: ["I tried counting the stars and fell asleep halfway", "I secretly remember your anniversary", "I can eat ten burgers in one go"], es: ["Intenté contar las estrellas y me dormí a la mitad", "Recuerdo en secreto su aniversario", "Puedo comer diez hamburguesas de una vez"] },
  { lie: 0, zh: ["我每天早上都去跑五公里", "我喜欢晒太阳", "我会把最喜欢的玩具藏在枕头底下"], en: ["I run five kilometres every morning", "I love lying in the sun", "I hide my favourite toy under the pillow"], es: ["Corro cinco kilómetros cada mañana", "Me encanta tomar el sol", "Escondo mi juguete favorito bajo la almohada"] },
];

export const twoTruths = {
  id: "truths",
  category: "words",
  start({ players, inviterUserId }) {
    return { players: [...players], rounds: [{ teller: inviterUserId, statements: null, lie: null, guess: null, outcome: null }], caught: {}, played: 0, ended: false };
  },
  turn(state) {
    if (state.ended) return null;
    const round = current(state);
    return round.statements ? other(state, round.teller) : round.teller;
  },
  act(state, { userId, action }) {
    if (state.ended) throw matchError(409, "match_over");
    if (action?.type === "end") return { ...state, ended: true, endedBy: userId };
    const round = current(state);
    if (action?.type === "tell") {
      if (round.teller !== userId || round.statements) throw matchError(409, "not_your_turn");
      const statements = Array.isArray(action.statements) ? action.statements.map((item) => String(item || "").trim().slice(0, MAX)) : [];
      const pet = action.i18n && userId === PET ? Object.fromEntries(["zh", "en", "es"].map((language) => [language, (action.i18n[language] || []).map((item) => String(item).slice(0, MAX))])) : null;
      if (statements.length !== 3 || statements.some((item) => !item) || ![0, 1, 2].includes(action.lie)) throw matchError(400, "statements_required");
      return { ...state, rounds: [...state.rounds.slice(0, -1), { ...round, statements, lie: action.lie, ...(pet ? { i18n: pet } : {}) }] };
    }
    if (action?.type === "guess") {
      if (!round.statements || round.teller === userId) throw matchError(409, "not_your_turn");
      if (![0, 1, 2].includes(action.index)) throw matchError(400, "invalid_action");
      const outcome = action.index === round.lie ? "caught" : "fooled";
      const done = { ...round, guess: action.index, outcome };
      // Next round: the one who guessed tells.
      return { ...state, rounds: [...state.rounds.slice(0, -1), done, { teller: userId, statements: null, lie: null, guess: null, outcome: null }].slice(-30), caught: { ...state.caught, [userId]: (state.caught[userId] || 0) + Number(outcome === "caught") }, played: state.played + 1 };
    }
    throw matchError(400, "invalid_action");
  },
  finished(state) { return Boolean(state.ended); },
  /** Which one is the lie stays with the teller until the guess is in. */
  view(state, userId) { return { ...state, rounds: state.rounds.map((round) => round.outcome || round.teller === userId ? round : { ...round, lie: null }) }; },
  stats(matches) {
    const caught = {}; let played = 0;
    for (const match of matches) { played += match.state.played || 0; for (const [id, count] of Object.entries(match.state.caught || {})) caught[id] = (caught[id] || 0) + count; }
    return { caught, played };
  },
  petInstant: true,
  async petActions({ state }) {
    const round = current(state);
    if (round.teller === PET && !round.statements) {
      const set = PET_SETS[(state.played / 2 + state.rounds.length) % PET_SETS.length | 0];
      return [{ type: "tell", statements: set.zh, lie: set.lie, i18n: { zh: set.zh, en: set.en, es: set.es } }];
    }
    if (round.statements && round.teller !== PET) return [{ type: "guess", index: Math.floor(Math.random() * 3) }];
    return [];
  },
};
