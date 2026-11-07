// The other player when someone plays with their pet, 小家伙 (founder 11-06), instead of their partner.
export const PET = "pet";
// Whose move it is when either player may act (海龟汤: both ask questions), and Pinky when it hosts a game.
export const BOTH = "both";
export const HOST = "host";

// Errors a game's rules raise; match-router turns the code into a sentence in the player's language.
export function matchError(statusCode, code) { return Object.assign(new Error(code), { statusCode, matchCode: code }); }

export const MATCH_ERRORS = {
  not_found: ["没有找到这局游戏。", "This game was not found.", "No se encontró esta partida."],
  soup_not_ready: ["Pinky 还在熬汤，马上就好。", "Pinky is still writing the puzzle. Almost there.", "Pinky aún está preparando el acertijo. Ya casi."], soup_busy: ["Pinky 还在想上面的问题，等它答完再问。", "Pinky is still thinking about the last questions. Ask again once it answers.", "Pinky aún piensa en las últimas preguntas. Pregunta otra vez cuando responda."], question_required: ["写下你的问题。", "Write your question.", "Escribe tu pregunta."],
  unknown_game: ["还没有这个游戏。", "That game isn't here yet.", "Ese juego aún no está."],
  pairing_required: ["要先和 TA 绑定，才能一起玩。", "Pair with your partner to play together.", "Vincúlate con tu pareja para jugar juntos."],
  not_your_turn: ["还没轮到你。", "It's not your turn yet.", "Aún no es tu turno."],
  occupied: ["这里已经有子了。", "There's already a stone there.", "Ya hay una ficha ahí."],
  match_over: ["这局已经结束了。", "This game is over.", "Esta partida terminó."],
  invalid_action: ["这一步不行，再试一次。", "That move doesn't work. Try again.", "Ese movimiento no vale. Inténtalo de nuevo."],
  drawing_required: ["先画几笔再交给 TA。", "Draw something before passing it on.", "Dibuja algo antes de pasarlo."],
  guess_required: ["写下你的答案。", "Write your guess.", "Escribe tu respuesta."],
  statements_required: ["写满三句，再选出哪句是假的。", "Write all three, then mark which one is the lie.", "Escribe las tres y marca cuál es la mentira."],
  roll_first: ["先掷骰子。", "Roll the die first.", "Primero tira el dado."],
  choose_plane: ["先选一架飞机走。", "Pick a plane to move first.", "Primero elige qué avión mover."],
  task_pending: ["先完成或跳过这个小任务。", "Do or skip the little task first.", "Primero haz o salta la tarea."],
  old_board: ["飞行棋换了新地图，这局是旧棋盘，没法接着下了。结束这局，开一局新的吧。", "This game is on the old board; ludo has a new map now. End it and start a new one.", "Esta partida es del tablero antiguo; el parchís tiene un mapa nuevo. Termínala y empieza otra."],
  voice_unavailable: ["语音暂时用不了，可以先打字。", "Voice is unavailable right now. You can still type.", "La voz no está disponible ahora. Puedes seguir escribiendo."],
  decide_first: ["先做个选择再继续。", "Make your choice first.", "Primero elige."],
  plane_stuck: ["这架飞机这次走不了。", "That plane can't move this time.", "Ese avión no puede moverse esta vez."],
};
