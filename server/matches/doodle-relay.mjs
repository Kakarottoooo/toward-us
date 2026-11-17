import { createHash } from "node:crypto";
import { readPlayDrawing } from "../play-drawing.mjs";
import { matchError } from "./errors.mjs";

const prompts = [
  { zh: "穿礼服去买菜的小怪兽", en: "A little monster grocery shopping in formal wear", es: "Un monstruito que va de compras vestido de gala" },
  { zh: "第一次约会的外星人", en: "An alien on a first date", es: "Un extraterrestre en su primera cita" },
  { zh: "忘带雨伞的小幽灵", en: "A little ghost that forgot its umbrella", es: "Un fantasmita que olvidó su paraguas" },
  { zh: "赶着去看日出的机器人", en: "A robot rushing to catch the sunrise", es: "Un robot que va corriendo a ver el amanecer" },
  { zh: "想当蛋糕师的恐龙", en: "A dinosaur who wants to bake cakes", es: "Un dinosaurio que quiere hacer pasteles" },
  { zh: "在月球上跳舞的猫", en: "A cat dancing on the moon", es: "Un gato bailando en la Luna" },
  { zh: "准备出海的小国王", en: "A little king about to set sail", es: "Un pequeño rey a punto de zarpar" },
  { zh: "踩着滑板去上班的熊", en: "A bear skateboarding to work", es: "Un oso que va al trabajo en patineta" },
  { zh: "迷路了也很开心的探险家", en: "An explorer happy to be lost", es: "Un explorador feliz de haberse perdido" },
  { zh: "要去银河拍照的企鹅", en: "A penguin taking pictures of the Milky Way", es: "Un pingüino que va a fotografiar la Vía Láctea" },
  { zh: "穿了两只不同鞋子的巫师", en: "A wizard wearing two different shoes", es: "Un mago que lleva dos zapatos distintos" },
  { zh: "给偶像送花的海怪", en: "A sea monster bringing flowers to its idol", es: "Un monstruo marino que le lleva flores a su ídolo" },
];

// Share only a few rounded x-coordinates near the join, with no paths or colors.
function joinPoints(strokes) {
  const points = new Set();
  for (const { points: stroke } of strokes) {
    for (const [x, y] of stroke) {
      if (y >= 243) points.add(Math.min(252, Math.round(x / 12) * 12));
      if (points.size === 4) return [...points].sort((a, b) => a - b);
    }
  }
  return [...points].sort((a, b) => a - b);
}

function promptOrder(matchId, previous) {
  const start = createHash("sha256").update(matchId).digest().readUInt32BE() % prompts.length;
  const ids = Array.from({ length: prompts.length }, (_, offset) => (start + offset) % prompts.length);
  const recent = new Set(previous.slice(0, 4).map((match) => match.state.promptId));
  return [...ids.filter((id) => !recent.has(id)), ...ids.filter((id) => recent.has(id))];
}

export const doodleRelay = {
  id: "doodle",
  category: "draw",
  start({ players, inviterUserId, matchId, previous = [] }) {
    const recentDrawer = previous[0]?.state.first;
    const first = recentDrawer ? players.find((id) => id !== recentDrawer) ?? inviterUserId : inviterUserId;
    const second = players.find((id) => id !== first);
    const order = promptOrder(matchId, previous);
    return { first, second, order, promptIndex: 0, promptId: order[0], top: null, bottom: null, joins: [] };
  },
  turn(state) {
    return state.bottom ? null : state.top ? state.second : state.first;
  },
  act(state, { userId, action }) {
    if (state.bottom) throw matchError(409, "match_over");
    if (this.turn(state) !== userId) throw matchError(409, "not_your_turn");
    if (action?.type === "swap" && !state.top) {
      const promptIndex = (state.promptIndex + 1) % state.order.length;
      return { ...state, promptIndex, promptId: state.order[promptIndex] };
    }
    if (action?.type !== "draw") throw matchError(400, "invalid_action");
    const strokes = readPlayDrawing(action.strokes);
    if (!strokes) throw matchError(400, "drawing_required");
    return state.top ? { ...state, bottom: strokes } : { ...state, top: strokes, joins: joinPoints(strokes) };
  },
  finished(state) {
    return Boolean(state.bottom);
  },
  view(state, userId) {
    return {
      prompt: prompts[state.promptId],
      half: userId === state.first ? "top" : "bottom",
      top: state.bottom || userId === state.first ? state.top : null,
      bottom: state.bottom,
      joins: userId === state.second && !state.bottom ? state.joins : [],
    };
  },
  stats(matches) {
    return { played: matches.filter((match) => match.state.bottom).length };
  },
  announce() {
    return {
      zh: "你们的接力涂鸦拼好了。点开当时的游戏邀请，就能看完整的画。",
      en: "Your relay drawing is finished. Open the game invitation to see the whole picture.",
      es: "Ya terminaron su dibujo por turnos. Abran la invitación de la partida para ver el dibujo completo.",
    };
  },
};
