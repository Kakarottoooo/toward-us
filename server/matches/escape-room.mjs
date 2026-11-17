import { matchError } from "./errors.mjs";

const copy = (zh, en, es) => ({ zh, en, es });
const sequence = (title, panel, guide, answer) => ({ kind: "sequence", title, panel, guide, answer });
const dials = (title, panel, guide, answer) => ({ kind: "dials", title, panel, guide, answer });
const route = (title, guide, start, answer) => ({ kind: "route", title, guide, start, answer });

const rooms = [
  {
    name: copy("末班地铁", "The Last Metro", "El último metro"),
    goal: copy("末班车停在地下。恢复供电，打开通风井，从月台尽头出去。", "The last train has stopped underground. Restore power, open the vent and find your way out.", "El último tren se ha detenido bajo tierra. Recuperen la corriente, abran la ventilación y encuentren la salida."),
    theme: "metro",
    steps: [
      sequence(copy("站台控制台", "Platform console", "Panel del andén"), ["star", "leaf", "moon", "sun"],
        copy("读站牌上的三盏灯，从左到右。告诉 TA 按这个顺序按键。", "Read the three lamps on the station sign from left to right. Tell your partner which buttons to press.", "Lee las tres luces del cartel de izquierda a derecha. Dile a tu pareja qué botones debe pulsar."),
        ["moon", "sun", "star"]),
      dials(copy("通风井配电箱", "Vent fuse box", "Caja de fusibles"),
        ["wave", "leaf", "heart"],
        copy("三项数字是保险丝的档位。报出每个标志的数字，由 TA 按控制台上的顺序设置。", "These are the fuse settings. Read out the number for each symbol so your partner can set their dials.", "Estos son los ajustes de los fusibles. Dile a tu pareja el número de cada símbolo para que ajuste sus ruedas."),
        [3, 1, 4]),
      route(copy("检修车逃生路线", "Maintenance cart route", "Ruta del carro de mantenimiento"),
        copy("浅色格子是检修车要依次经过的路线。由 0 移到 4，每一步报一个方向。", "The lit tiles show the cart's route. Go from 0 to 4, calling out one direction at a time.", "Las casillas iluminadas muestran la ruta. Ve del 0 al 4 e indica una dirección por vez."),
        12, ["up", "right", "right", "up"]),
    ],
  },
  {
    name: copy("夜间温室", "The Midnight Greenhouse", "El invernadero de medianoche"),
    goal: copy("展厅关门了，植物还在等水。调好设备，再用采样车打开安全门。", "The greenhouse has closed and the plants still need water. Set up the equipment, then use the sample cart to open the safety door.", "El invernadero cerró y las plantas aún necesitan agua. Ajusten el equipo y usen el carro de muestras para abrir la salida."),
    theme: "greenhouse",
    steps: [
      sequence(copy("植物生长灯", "Grow-light panel", "Panel de luces de cultivo"), ["heart", "sun", "wave", "leaf", "star"],
        copy("从幼苗到开花，展板上的四个印章就是亮灯的顺序。按从左到右报给 TA。", "The four stamps trace a plant from sprout to bloom. Call them out from left to right.", "Los cuatro sellos muestran el crecimiento de la planta. Léelos de izquierda a derecha."),
        ["leaf", "wave", "sun", "heart"]),
      dials(copy("滴灌阀门", "Irrigation valves", "Válvulas de riego"), ["rain", "star", "leaf"],
        copy("把每株植物旁的刻度和标志告诉 TA。TA 手上的阀门排列顺序不同。", "Share the setting next to each plant's symbol. The valves on your partner's panel are in a different order.", "Indica el nivel junto a cada símbolo de planta. Las válvulas del panel de tu pareja están en otro orden."),
        [5, 2, 3]),
      route(copy("采样车路线", "Sample cart route", "Ruta del carro de muestras"),
        copy("沿着图上的数字依次报方向，采样车才会经过所有传感器。", "Call out the directions in numbered order so the cart passes all the sensors.", "Indica las direcciones en orden numérico para que el carro pase por todos los sensores."),
        15, ["left", "up", "up", "left", "up"]),
    ],
  },
  {
    name: copy("风暴灯塔", "The Storm Lighthouse", "El faro en la tormenta"),
    goal: copy("暴风雨吹灭了灯塔。一人读记录，一人操作，把救援舱引到码头。", "A storm has cut power to the lighthouse. Read the logs, work the controls and guide the rescue pod to the dock.", "Una tormenta dejó al faro sin corriente. Lean los registros, manejen los controles y guíen la cápsula de rescate al muelle."),
    theme: "lighthouse",
    steps: [
      sequence(copy("风暴警示灯", "Storm beacon controls", "Controles de la baliza"), ["rain", "star", "wave", "moon", "sun"],
        copy("值班记录的四个标记是警示灯的重启顺序。念给 TA，直到最后一盏。", "The four marks in the watch log show the restart sequence. Read them out to your partner.", "Las cuatro marcas del registro indican la secuencia de reinicio. Léelas en orden a tu pareja."),
        ["wave", "moon", "rain", "star"]),
      dials(copy("无线电频率", "Radio tuning dials", "Selectores de radio"), ["moon", "wave", "sun"],
        copy("这三个标志是救援频率的代号，对照读出对应数字。", "Match each rescue call sign to its frequency number and tell your partner.", "Relaciona cada indicativo de rescate con su número de frecuencia y díselo a tu pareja."),
        [2, 5, 0]),
      route(copy("救援舱引导图", "Rescue pod navigation", "Navegación de la cápsula"),
        copy("图中的数字给出了穿过浪区的先后顺序。每一步说上、下、左或右。", "Follow the numbers to get through the waves. Call out up, down, left or right for each move.", "Sigue los números para atravesar las olas. Indica arriba, abajo, izquierda o derecha en cada paso."),
        3, ["down", "left", "down", "left", "down"]),
    ],
  },
];

const directions = { up: -4, down: 4, left: -1, right: 1 };
const operatorIndex = (state) => (state.stage + state.first) % 2;
const stageOf = (state) => rooms[state.room].steps[state.stage];

function walk(start, moves) {
  const tiles = [start];
  for (const move of moves) tiles.push(tiles.at(-1) + directions[move]);
  return tiles;
}

function guideFor(stage) {
  if (stage.kind === "route") return { instructions: stage.guide, tiles: walk(stage.start, stage.answer) };
  if (stage.kind === "sequence") return { instructions: stage.guide, symbols: stage.answer };
  return { instructions: stage.guide, legend: stage.panel.map((symbol, index) => ({ symbol, number: stage.answer[index] })).reverse() };
}

function panelFor(stage) {
  const panel = { length: stage.answer.length };
  if (stage.kind === "route") {
    panel.start = stage.start;
    panel.exit = walk(stage.start, stage.answer).at(-1);
  } else panel.symbols = stage.panel;
  return panel;
}

function openHint(stage) {
  const first = stage.answer[0];
  return stage.kind === "sequence" ? { symbol: first }
    : stage.kind === "dials" ? { symbol: stage.panel[0], number: first } : { direction: first };
}

function validSubmission(stage, values) {
  if (!Array.isArray(values) || values.length !== stage.answer.length) return false;
  if (stage.kind === "dials") return values.every((value) => Number.isInteger(value) && value >= 0 && value <= 5);
  if (stage.kind === "sequence") return values.every((value) => stage.panel.includes(value));
  return values.every((value) => typeof value === "string" && Object.hasOwn(directions, value));
}

export const escapeRoom = {
  id: "escape-room",
  category: "puzzle",
  start({ players, inviterUserId, previous }) {
    const prior = previous[0]?.state;
    return {
      players, room: prior ? (prior.room + 1) % rooms.length : 0,
      stage: 0, first: prior ? 1 - prior.first : Number(players[1] === inviterUserId),
      hints: [], stageMisses: 0,
    };
  },
  turn(state) { return stageOf(state) ? state.players[operatorIndex(state)] : null; },
  finished(state) { return !stageOf(state); },
  act(state, { userId, action }) {
    if (!state.players.includes(userId)) throw matchError(404, "not_found");
    const stage = stageOf(state);
    if (!stage || action.stage !== state.stage) throw matchError(409, "invalid_action");
    if (action.type === "hint") {
      if (state.hints.includes(state.stage)) throw matchError(409, "invalid_action");
      return { ...state, hints: [...state.hints, state.stage] };
    }
    if (action.type !== "submit" || !validSubmission(stage, action.values)) throw matchError(400, "invalid_action");
    if (state.players[operatorIndex(state)] !== userId) throw matchError(409, "not_your_turn");
    if (!stage.answer.every((value, index) => value === action.values[index])) {
      return { ...state, stageMisses: state.stageMisses + 1 };
    }
    return { ...state, stage: state.stage + 1, stageMisses: 0 };
  },
  view(state, userId) {
    const room = rooms[state.room];
    const stage = stageOf(state);
    const active = state.players[operatorIndex(state)] === userId;
    return {
      name: room.name, goal: room.goal, theme: room.theme, cleared: state.stage, total: room.steps.length,
      hintsUsed: state.hints.length,
      current: stage ? {
        kind: stage.kind, title: stage.title, misses: state.stageMisses,
        panel: active ? panelFor(stage) : null,
        guide: active ? null : guideFor(stage),
        hint: state.hints.includes(state.stage) ? openHint(stage) : null,
      } : null,
    };
  },
  stats(matches) { return { played: matches.filter(({ status }) => status === "finished").length }; },
  announce(state) {
    const room = rooms[state.room].name;
    return {
      zh: `你们一起逃出了「${room.zh}」！`,
      en: `You escaped “${room.en}” together!`,
      es: `¡Escaparon juntos de «${room.es}»!`,
    };
  },
};
