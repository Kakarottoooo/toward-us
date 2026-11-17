import { readFile } from "node:fs/promises";
import { BOTH, matchError } from "./errors.mjs";

const copy = (zh, en, es) => ({ zh, en, es });
const width = 720;
const height = 500;
const scenes = [
  {
    id: "lake",
    name: copy("湖边野餐", "Lakeside Picnic", "Pícnic junto al lago"),
    targets: [
      [530, 83, 48, copy("天空", "The sky", "El cielo")],
      [420, 166, 45, copy("旗子", "The flag", "La bandera")],
      [272, 357, 43, copy("杯子", "The mug", "La taza")],
      [410, 364, 44, copy("水果", "The fruit", "La fruta")],
      [615, 210, 53, copy("船帆", "The sail", "La vela")],
    ],
  },
  {
    id: "market",
    name: copy("夜市小摊", "Night Market", "Mercado nocturno"),
    targets: [
      [179, 163, 45, copy("挂灯", "The lantern", "El farol")],
      [342, 140, 51, copy("招牌", "The shop sign", "El letrero")],
      [545, 87, 48, copy("彩旗", "The bunting", "Los banderines")],
      [269, 341, 46, copy("烤点心", "The baked treats", "Los dulces")],
      [583, 369, 45, copy("小猫", "The cat", "El gato")],
    ],
  },
  {
    id: "garden",
    name: copy("小小温室", "Little Greenhouse", "Pequeño invernadero"),
    targets: [
      [365, 104, 49, copy("屋顶徽章", "The roof badge", "La insignia del techo")],
      [203, 381, 51, copy("浇水壶", "The watering can", "La regadera")],
      [574, 351, 49, copy("花朵", "The flowers", "Las flores")],
      [483, 212, 43, copy("蝴蝶", "The butterfly", "La mariposa")],
      [350, 384, 45, copy("花盆", "The planter", "La maceta")],
    ],
  },
];

const sceneOf = (state) => scenes[state.scene];
const finished = (state) => state.found.length === sceneOf(state).targets.length;
const mark = ([x, y, , name], index) => ({ x: x * 100 / width, y: y * 100 / height, name, index });

export async function readSpotImage(match, userId) {
  if (match?.game !== "spot-difference" || !match.players.includes(userId)) throw matchError(404, "not_found");
  const side = match.state.players.indexOf(userId);
  const scene = sceneOf(match.state);
  if (side < 0 || !scene) throw matchError(404, "not_found");
  return readFile(new URL(`./spot-difference-art/${scene.id}-${side}.png`, import.meta.url));
}

export const spotDifference = {
  id: "spot-difference",
  category: "puzzle",
  start({ players, inviterUserId, previous }) {
    const prior = previous[0]?.state;
    const first = prior ? players.find((userId) => userId !== prior.players[0]) : inviterUserId;
    return {
      players: [first, players.find((userId) => userId !== first)],
      scene: prior ? (prior.scene + 1) % scenes.length : 0,
      found: [], hint: null, hintsUsed: 0, last: null,
    };
  },
  turn(state) { return finished(state) ? null : BOTH; },
  finished,
  act(state, { userId, action }) {
    const side = state.players.indexOf(userId);
    if (side < 0) throw matchError(404, "not_found");
    if (finished(state)) throw matchError(409, "match_over");
    const { targets } = sceneOf(state);
    if (action.type === "hint") {
      if (state.hint !== null) throw matchError(409, "invalid_action");
      return { ...state, hint: targets.findIndex((_, index) => !state.found.includes(index)), hintsUsed: state.hintsUsed + 1 };
    }
    if (action.type !== "tap" || !Number.isFinite(action.x) || !Number.isFinite(action.y)
      || action.x < 0 || action.x > 100 || action.y < 0 || action.y > 100) throw matchError(400, "invalid_action");
    const x = action.x * width / 100, y = action.y * height / 100;
    const found = targets.findIndex(([targetX, targetY, radius]) => Math.hypot(x - targetX, y - targetY) <= radius);
    if (found < 0) return { ...state, last: { side, outcome: "miss" } };
    if (state.found.includes(found)) return { ...state, last: { side, outcome: "known" } };
    return { ...state, found: [...state.found, found], hint: state.hint === found ? null : state.hint, last: { side, outcome: "found" } };
  },
  view(state, userId) {
    const side = state.players.indexOf(userId), scene = sceneOf(state);
    return {
      name: scene.name, total: scene.targets.length, side: side === 0 ? "A" : "B",
      marks: state.found.map((index) => mark(scene.targets[index], index)),
      hint: state.hint === null ? null : mark(scene.targets[state.hint], state.hint),
      hintsUsed: state.hintsUsed,
      last: state.last?.side === side ? state.last.outcome : null,
    };
  },
  stats(matches) { return { played: matches.filter(({ status }) => status === "finished").length }; },
  announce(state) {
    const scene = sceneOf(state);
    return {
      zh: `你们找齐了「${scene.name.zh}」的 5 处不同。`,
      en: `You found all five differences in “${scene.name.en}” together.`,
      es: `Encontraron juntos las cinco diferencias de «${scene.name.es}».`,
    };
  },
};
