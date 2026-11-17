import { BOTH, matchError } from "./errors.mjs";

const ROUND_TIME = 120_000;
const COUNT_IN = 3_000;
const BURN_WINDOW = 3_200;

const MENU = [
  { id: "pasta", ingredients: ["pasta", "tomato", "basil"], cookMs: 4_200 },
  { id: "salad", ingredients: ["greens", "tomato", "cheese"], cookMs: 2_600 },
  { id: "taco", ingredients: ["tortilla", "greens", "beans"], cookMs: 3_500 },
  { id: "pizza", ingredients: ["dough", "tomato", "cheese"], cookMs: 4_600 },
  { id: "soup", ingredients: ["beans", "tomato", "basil"], cookMs: 3_700 },
  { id: "flatbread", ingredients: ["dough", "greens", "cheese"], cookMs: 4_000 },
];

const elapsedError = () => matchError(409, "invalid_action");
const activeOrder = (state) => state.orders.find((order) => !order.served);
const prepOrders = (state) => state.orders.filter((order) => !order.served).slice(0, 2);
const stocked = (order) => order.picked.length === order.ingredients.length;
const pantry = new Set(MENU.flatMap((order) => order.ingredients));

// Recipes stay fixed for an open game, including across all clients and refreshes.
function drawMenu(matchId, previous) {
  let next = 0;
  for (const char of matchId) next = (Math.imul(next, 31) + char.charCodeAt(0)) >>> 0;
  const menu = [...MENU];
  for (let i = menu.length - 1; i > 0; i--) {
    next = (Math.imul(next, 1664525) + 1013904223) >>> 0;
    const j = Math.floor(next / 2 ** 32 * (i + 1));
    [menu[i], menu[j]] = [menu[j], menu[i]];
  }
  const orderIds = menu.slice(0, 5).map(({ id }) => id);
  if (orderIds.every((id, index) => id === previous?.orders[index]?.id)) menu.reverse();
  return menu.slice(0, 5).map((recipe) => ({ ...recipe, picked: [], firedAt: null, served: false }));
}

function settle(state, now = Date.now()) {
  if (state.phase !== "running" || now < state.deadlineAt) return state;
  return { ...state, phase: "finished", outcome: "time" };
}

function ready(state, userId, now) {
  if (state.ready.includes(userId)) throw elapsedError();
  const nextReady = [...state.ready, userId];
  if (nextReady.length < state.players.length) return { ...state, ready: nextReady };
  const startAt = now + COUNT_IN;
  const freeze = state.pausedAt === null ? 0 : startAt - state.pausedAt;
  return {
    ...state,
    phase: "running",
    ready: nextReady,
    startAt,
    deadlineAt: state.deadlineAt === null ? startAt + ROUND_TIME : state.deadlineAt + freeze,
    orders: state.orders.map((order) => order.firedAt === null || order.served ? order : { ...order, firedAt: order.firedAt + freeze }),
    pausedAt: null,
  };
}

export const kitchen = {
  id: "kitchen",
  category: "casual",
  start({ players, inviterUserId, matchId, previous }) {
    const last = previous?.[0]?.state;
    const prep = last ? players.find((id) => id !== last.prep) : inviterUserId;
    return {
      players, prep, ready: [], phase: "lobby", startAt: null, deadlineAt: null, pausedAt: null,
      orders: drawMenu(matchId, last), prepErrors: 0, outcome: null,
    };
  },
  settle,
  turn(state) {
    if (state.phase === "finished") return null;
    if (state.phase === "running") return BOTH;
    const waiting = state.players.filter((id) => !state.ready.includes(id));
    return waiting.length === 1 ? waiting[0] : BOTH;
  },
  act(state, { userId, action, now = Date.now() }) {
    if (!state.players.includes(userId)) throw matchError(403, "not_your_turn");
    const settled = settle(state, now);
    if (settled !== state) return settled;
    if (state.phase === "finished") throw matchError(409, "match_over");
    if (action.type === "settle") throw elapsedError();

    if (state.phase === "lobby" || state.phase === "paused") {
      if (action.type === "ready") return ready(state, userId, now);
      if (action.type === "unready" && state.ready.includes(userId)) return { ...state, ready: state.ready.filter((id) => id !== userId) };
      throw elapsedError();
    }
    if (action.type === "pause") {
      // A pause during the count-in does not consume any round time.
      return { ...state, phase: "paused", ready: [], pausedAt: Math.max(state.startAt, now) };
    }
    if (now < state.startAt) throw elapsedError();

    if (action.type === "prep") {
      if (userId !== state.prep) throw matchError(409, "not_your_turn");
      const order = prepOrders(state).find((item) => item.id === action.order);
      const ingredient = typeof action.ingredient === "string" ? action.ingredient : "";
      if (!order || order.picked.includes(ingredient) || !pantry.has(ingredient)) throw elapsedError();
      if (!order.ingredients.includes(ingredient)) {
        return settle({ ...state, deadlineAt: state.deadlineAt - 2_000, prepErrors: state.prepErrors + 1 }, now);
      }
      return { ...state, orders: state.orders.map((item) => item === order ? { ...item, picked: [...item.picked, ingredient] } : item) };
    }

    if (userId === state.prep) throw matchError(409, "not_your_turn");
    const order = activeOrder(state);
    if (!order || order.id !== action.order || !stocked(order)) throw elapsedError();
    const updateOrder = (patch) => state.orders.map((item) => item === order ? { ...item, ...patch } : item);
    const readyAt = order.firedAt === null ? null : order.firedAt + order.cookMs;
    if (action.type === "fire" && (readyAt === null || now >= readyAt + BURN_WINDOW)) {
      return { ...state, orders: updateOrder({ firedAt: now }) };
    }
    if (action.type === "serve" && readyAt !== null && now >= readyAt && now < readyAt + BURN_WINDOW) {
      const orders = updateOrder({ served: true });
      if (orders.every((item) => item.served)) return { ...state, orders, phase: "finished", outcome: "complete" };
      return { ...state, orders };
    }
    throw elapsedError();
  },
  finished(state) { return state.phase === "finished"; },
  view(state) { return { ...state, serverNow: Date.now(), burnWindow: BURN_WINDOW }; },
  stats(matches) { return { played: matches.filter((match) => match.status === "finished").length }; },
  announce(state) {
    const plated = state.orders.filter((order) => order.served).length;
    return {
      zh: "两人开餐厅：你们一起端出了 " + plated + " 道菜。",
      en: "Two-Person Kitchen: you served " + plated + " dishes together.",
      es: "Cocina en pareja: sirvieron " + plated + " platos juntos.",
    };
  },
};
