import { conversationDay } from "../conversation-recall.mjs";
import { createRelationshipRecord } from "../relationship-domain.mjs";
import { localDateTimeToInstant } from "../reminder-service.mjs";
import { BOTH, matchError } from "./errors.mjs";

const labels = (zh, en, es) => ({ zh, en, es });
const pick = (id, icon, cost, title, star = false) => ({ id, icon, cost, title, star });
const categories = ["food", "activity", "travel"];
const menus = [
  {
    title: labels("偷来一个傍晚", "A little evening escape", "Una escapada al atardecer"),
    intro: labels("挑一样带星的点子，让今天和平时有点不同。", "Pick one starred idea to make this evening a little different.", "Elijan una idea con estrella para darle un giro a la tarde."),
    budget: 10,
    options: {
      food: [
        pick("tacos", "🌮", 3, labels("路边塔可", "Street tacos", "Tacos callejeros")),
        pick("picnic", "🧺", 2, labels("带点吃的去野餐", "Pack a picnic", "Pícnic casero")),
        pick("dinner", "🍝", 6, labels("小馆慢慢吃", "Long bistro dinner", "Cena sin prisa")),
      ],
      activity: [
        pick("sunset", "🌇", 1, labels("找个地方看日落", "Find a sunset spot", "Buscar dónde ver el atardecer"), true),
        pick("cinema", "🎟️", 4, labels("看一部旧电影", "See a vintage movie", "Ver una película clásica"), true),
        pick("bookshop", "📚", 2, labels("逛二手书店", "Browse a used bookstore", "Visitar una librería de segunda mano")),
      ],
      travel: [
        pick("walk", "👟", 0, labels("沿着街区慢慢走", "Walk through the neighborhood", "Pasear por el barrio")),
        pick("train", "🚇", 2, labels("坐地铁换个街区", "Take the train somewhere new", "Ir en metro a otro barrio")),
        pick("bikes", "🚲", 3, labels("租单车兜风", "Rent bikes", "Alquilar bicicletas")),
      ],
    },
  },
  {
    title: labels("下雨也要出门", "When it rains", "Una cita con lluvia"),
    intro: labels("用一颗星挑一个下雨天才更有意思的点子。", "Choose a starred idea that's even better on a rainy day.", "Elijan una idea con estrella que se disfrute aún más con lluvia."),
    budget: 11,
    options: {
      food: [
        pick("chocolate", "☕", 3, labels("热巧克力和饼干", "Hot chocolate and cookies", "Chocolate caliente y galletas")),
        pick("noodles", "🍜", 4, labels("去吃碗热汤面", "Go out for noodle soup", "Salir a comer sopa de fideos")),
        pick("grilled", "🧀", 2, labels("在家烤芝士三明治", "Make grilled cheese at home", "Hacer sándwiches de queso en casa")),
      ],
      activity: [
        pick("pottery", "🏺", 7, labels("做一对歪歪的杯子", "Make two wonky mugs", "Hacer un par de tazas chuecas"), true),
        pick("arcade", "🕹️", 4, labels("去游戏厅打擂台", "Challenge each other at the arcade", "Retarse en los juegos de arcade"), true),
        pick("puzzle", "🧩", 1, labels("一起做一张拼图", "Do a jigsaw together", "Armar un rompecabezas juntos"), true),
      ],
      travel: [
        pick("umbrella", "☂️", 1, labels("共撑一把伞", "Share an umbrella", "Compartir un paraguas")),
        pick("bus", "🚌", 2, labels("坐公交去", "Catch a bus", "Tomar el autobús")),
        pick("home", "🛋️", 0, labels("在家就能开始", "Make it a date at home", "Hacer la cita en casa")),
      ],
    },
  },
  {
    title: labels("早起半天约会", "A little morning adventure", "Una pequeña aventura mañanera"),
    intro: labels("选一件带星的小事，把普通的早晨变成记得住的约会。", "Give an everyday morning one memorable starred moment.", "Añadan un momento con estrella para recordar la mañana."),
    budget: 9,
    options: {
      food: [
        pick("bakery", "🥐", 3, labels("趁热吃面包", "Fresh bakery pastries", "Pan recién horneado")),
        pick("breakfast", "🍳", 5, labels("慢慢吃一顿早午餐", "Take your time over brunch", "Desayunar tarde y sin prisa")),
        pick("fruit", "🍓", 2, labels("带点水果出门", "Pack some fruit", "Llevar algo de fruta")),
      ],
      activity: [
        pick("market", "🌻", 3, labels("逛市集，各挑一件小礼物", "Pick each other something at the market", "Elegirse un detalle en el mercado"), true),
        pick("birding", "🦜", 1, labels("到公园找三种鸟", "Spot three birds in the park", "Buscar tres tipos de aves en el parque"), true),
        pick("gallery", "🖼️", 4, labels("各挑一幅想带回家的画", "Pick your favorite painting at a gallery", "Elegir su cuadro favorito en una galería")),
      ],
      travel: [
        pick("walk", "👟", 0, labels("步行去", "Go on foot", "Ir a pie")),
        pick("bikes", "🚲", 3, labels("一起骑单车", "Bike together", "Ir en bicicleta")),
        pick("bus", "🚌", 2, labels("坐一段公交", "Take the bus", "Tomar el autobús")),
      ],
    },
  },
  {
    title: labels("远距离也能约会", "Long-distance date night", "Cita a distancia"),
    intro: labels("在各自的地方准备一个不错的小夜晚，记得挑一项带星的事。", "Make an evening happen from two places and pick one starred idea.", "Planeen una noche desde dos lugares y elijan una idea con estrella."),
    budget: 10,
    options: {
      food: [
        pick("snack", "🍿", 1, labels("各自准备零食", "Bring your own snacks", "Preparar sus propios bocadillos")),
        pick("cook", "🥞", 4, labels("连线做同一道菜", "Cook the same thing on a call", "Cocinar lo mismo en videollamada")),
        pick("takeaway", "🥡", 5, labels("各点一份没吃过的外卖", "Each try a new takeout spot", "Pedir comida de un sitio nuevo")),
      ],
      activity: [
        pick("story", "📖", 1, labels("一起读完一篇短故事", "Read a short story out loud together", "Leer juntos un cuento en voz alta"), true),
        pick("draw", "🎨", 2, labels("互画对方的房间", "Draw each other's room", "Dibujar la habitación del otro"), true),
        pick("watch", "🎬", 4, labels("连线看一部电影", "Watch a movie together on a call", "Ver juntos una película en videollamada")),
      ],
      travel: [
        pick("home", "🛋️", 0, labels("都窝在沙发上", "Both stay on the sofa", "Quedarse en el sofá")),
        pick("stroll", "🌙", 1, labels("各去散步再连线", "Each take a walk before calling", "Pasear antes de llamarse")),
        pick("porch", "🪴", 2, labels("各找一个舒服的角落", "Find a comfy spot outside", "Buscar un rincón cómodo al aire libre")),
      ],
    },
  },
];

function choices(state) {
  const menu = menus[state.menuIndex];
  const items = categories.flatMap((group) => menu.options[group].filter(({ id }) => id === state.picks[group]));
  const spent = items.reduce((total, item) => total + item.cost, 0);
  const starred = items.some((item) => item.star);
  return { items, spent, ready: items.length === categories.length && spent <= menu.budget && starred };
}

function validSchedule(input, now = Date.now()) {
  const { date, time = "", timezone } = input;
  const bad = () => matchError(400, "date_budget_schedule");
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      conversationDay(date + "T12:00:00Z") !== date ||
      typeof timezone !== "string" || !timezone || timezone.length > 64 ||
      typeof time !== "string" || (time && !/^\d{2}:\d{2}$/.test(time))) throw bad();
  const today = conversationDay(now, timezone);
  if (!today || date < today) throw bad();
  let dueAt = null;
  if (time) {
    try { dueAt = localDateTimeToInstant(date + "T" + time, timezone); } catch { throw bad(); }
    if (!dueAt || Date.parse(dueAt) <= now) throw bad();
  }
  return { date, time, timezone, dueAt };
}

function sameSchedule(a, b) {
  return a?.date === b?.date && a?.time === b?.time && a?.timezone === b?.timezone;
}

export const dateBudget = {
  id: "date-budget",
  category: "casual",
  start({ players, previous }) {
    const index = previous?.[0]?.state?.menuIndex ?? -1;
    return { players, menuIndex: (index + 1) % menus.length, picks: {}, schedule: null, revision: 0, confirmed: [], milestoneId: null };
  },
  act(state, { userId, action }) {
    if (!state.players.includes(userId)) throw matchError(404, "not_found");
    if (dateBudget.finished(state)) throw matchError(409, "match_over");
    if (action?.revision !== state.revision) throw matchError(409, "date_budget_changed");
    const revised = (update) => ({ ...state, ...update, revision: state.revision + 1, confirmed: [] });
    if (action.type === "pick") {
      const group = action.group;
      if (!categories.includes(group) || !menus[state.menuIndex].options[group].some(({ id }) => id === action.pickId)) throw matchError(400, "invalid_action");
      if (state.picks[group] === action.pickId) return state;
      return revised({ picks: { ...state.picks, [group]: action.pickId } });
    }
    if (action.type === "schedule") {
      const schedule = validSchedule(action);
      return sameSchedule(state.schedule, schedule) ? state : revised({ schedule });
    }
    if (action.type === "unschedule") return state.schedule ? revised({ schedule: null }) : state;
    if (action.type === "withdraw") return { ...state, confirmed: state.confirmed.filter((player) => player !== userId) };
    if (action.type !== "confirm" || !choices(state).ready) throw matchError(400, "invalid_action");
    if (state.schedule) validSchedule(state.schedule);
    return state.confirmed.includes(userId) ? state : { ...state, confirmed: [...state.confirmed, userId] };
  },
  turn(state) {
    const waiting = state.players.filter((player) => !state.confirmed.includes(player));
    return waiting.length === 2 ? BOTH : waiting[0] || null;
  },
  finished(state) { return state.players.every((player) => state.confirmed.includes(player)); },
  view(state) {
    const menu = menus[state.menuIndex];
    const { items, ...budget } = choices(state);
    return {
      menu, picks: state.picks, schedule: state.schedule, ...budget, revision: state.revision,
      confirmed: state.confirmed, milestoneId: state.milestoneId,
    };
  },
  async persistFinish({ tx, match, state, context, language }) {
    if (!state.schedule || state.milestoneId) return { state, milestone: null };
    const schedule = validSchedule(state.schedule);
    const { items } = choices(state);
    const locale = language === "zh" || language === "es" ? language : "en";
    const title = items.map((item) => item.title[locale]).join(" · ").slice(0, 120);
    const milestone = createRelationshipRecord({
      relationshipId: context.relationship.id, userId: state.confirmed[0],
      visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both",
      type: "custom", title, date: schedule.date, timezone: schedule.timezone,
      localDateTime: schedule.time ? schedule.date + "T" + schedule.time : null,
      dueAt: schedule.dueAt, recurringRule: "once", jointlyConfirmed: true,
      confirmedBy: state.players, sourceMatchId: match.id, provenanceSource: "date_budget_game",
    });
    await tx.createRelationshipRecord("milestones", milestone);
    return { state: { ...state, milestoneId: milestone.id }, milestone };
  },
  stats(matches) { return { played: matches.filter(({ state }) => dateBudget.finished(state)).length }; },
  announce(state) {
    return state.milestoneId
      ? labels("你们拼出来的约会已经加进共同日历。", "The date you planned together is on your shared calendar.", "La cita que planearon ya está en su calendario compartido.")
      : labels("你们一起拼好了一场约会。", "You put together a date!", "¡Planearon una cita juntos!");
  },
};
