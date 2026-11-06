// The other player when someone plays with their pet, 小家伙 (founder 11-06), instead of their partner.
export const PET = "pet";

// Errors a game's rules raise; match-router turns the code into a sentence in the player's language.
export function matchError(statusCode, code) { return Object.assign(new Error(code), { statusCode, matchCode: code }); }

export const MATCH_ERRORS = {
  not_found: ["没有找到这局游戏。", "This game was not found.", "No se encontró esta partida."],
  unknown_game: ["还没有这个游戏。", "That game isn't here yet.", "Ese juego aún no está."],
  pairing_required: ["要先和 TA 绑定，才能一起玩。", "Pair with your partner to play together.", "Vincúlate con tu pareja para jugar juntos."],
  not_your_turn: ["还没轮到你。", "It's not your turn yet.", "Aún no es tu turno."],
  occupied: ["这里已经有子了。", "There's already a stone there.", "Ya hay una ficha ahí."],
  match_over: ["这局已经结束了。", "This game is over.", "Esta partida terminó."],
  invalid_action: ["这一步不行，再试一次。", "That move doesn't work. Try again.", "Ese movimiento no vale. Inténtalo de nuevo."],
  drawing_required: ["先画几笔再交给 TA。", "Draw something before passing it on.", "Dibuja algo antes de pasarlo."],
  guess_required: ["写下你的答案。", "Write your guess.", "Escribe tu respuesta."],
};
