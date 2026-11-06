import type { ReactNode } from "react";
import { ArrowsSplit, BowlSteam, ChatsCircle, GridNine, PaintBrush, Target } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";

// 游戏大厅 (founder 11-06): the hall lists every game by category, and more of both are coming (棋类、解谜、文字、各种小游戏).
// Adding a game: add it here, and either
//   - kind "match": a module in server/matches (see its index.mjs) plus a screen in MatchScreen.tsx, or
//   - kind "card": a round played as a card in Us (server/games.mjs).
// A category is listed only once it has a game.
export type CategoryId = "board" | "draw" | "words" | "puzzle" | "casual";
export type GameEntry = { id: string; category: CategoryId; kind: "match" | "card"; cardType?: "choice" | "guess" | "truth"; icon: ReactNode; name: string; tagline: string; rules: string[] };

export function categories(language: Language): Array<{ id: CategoryId; name: string }> {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  return [
    { id: "board", name: t("棋类", "Board games", "Juegos de mesa") },
    { id: "draw", name: t("画画", "Drawing", "Dibujo") },
    { id: "words", name: t("问答", "Questions", "Preguntas") },
    { id: "puzzle", name: t("解谜", "Puzzles", "Acertijos") },
    { id: "casual", name: t("休闲", "Just for fun", "Para pasar el rato") },
  ];
}

export function gameCatalog(language: Language): GameEntry[] {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  return [
    {
      id: "gomoku", category: "board", kind: "match", icon: <GridNine size={26} weight="duotone" />, name: t("五子棋", "Gomoku", "Gomoku"),
      tagline: t("横竖斜，谁先连成五个谁赢。", "Five in a row, any direction, wins.", "Cinco en línea, en cualquier dirección, gana."),
      rules: [
        t("15×15 的棋盘，两人轮流落子，开局的人执黑先走。", "A 15 x 15 board. You take turns; whoever starts plays black and goes first.", "Tablero de 15 x 15. Juegan por turnos; quien empieza lleva negras y sale primero."),
        t("横、竖、斜任意方向先连成五个（或更多）的人赢。", "The first to get five (or more) in a row, across, down or diagonally, wins.", "Gana quien primero ponga cinco (o más) en línea: horizontal, vertical o diagonal."),
        t("点一下选位置，再点一次或按“落子”确认。", "Tap a spot to pick it, then tap again or press Place to confirm.", "Toca un punto para elegirlo y vuelve a tocar o pulsa Colocar para confirmar."),
        t("不用两个人同时在线：轮到 TA 时会收到提醒。下一盘换另一个人执黑。", "You don't both need to be online: your partner is told when it's their move. Next game, the other one plays black.", "No hace falta estar los dos conectados: a tu pareja le avisamos cuando le toca. En la siguiente, el otro lleva negras."),
        t("TA 不在的时候，可以和小家伙下，它马上就会回你一步。", "When your partner's away, play your little one: it answers right away.", "Si tu pareja no está, juega con tu pequeñín: responde enseguida."),
      ],
    },
    {
      id: "draw", category: "draw", kind: "match", icon: <PaintBrush size={26} weight="duotone" />, name: t("你画我猜", "Draw & guess", "Dibuja y adivina"),
      tagline: t("一个人画，一个人猜，猜中了换人画。", "One draws, the other guesses, then you swap.", "Uno dibuja, el otro adivina, y cambian."),
      rules: [
        t("画的人会看到一个词，只有自己知道。不能写字，只能画。", "The drawer gets a word only they can see. No writing, just drawing.", "Quien dibuja recibe una palabra que solo ve él o ella. Nada de escribir, solo dibujar."),
        t("画好了交给 TA，TA 有 3 次机会猜。会提示是哪一类、几个字。", "Pass it on when you're done; your partner gets 3 guesses, with a hint of the kind of thing and its length.", "Cuando termines, pásalo; tu pareja tiene 3 intentos, con una pista del tipo y la longitud."),
        t("猜中或者 3 次用完，答案揭晓，换另一个人画。", "Guessed or out of guesses, the word is revealed and you swap roles.", "Con acierto o sin intentos, se revela la palabra y cambian los papeles."),
        t("你们是一队的：大厅里记着一起猜中了几幅。", "You're on the same team: the hall keeps count of how many drawings you got.", "Son un equipo: en la sala se cuenta cuántos dibujos acertaron."),
        t("也可以和小家伙玩：你画它猜，它画你猜。", "You can also play your little one: you draw and it guesses, then it draws for you.", "También puedes jugar con tu pequeñín: tú dibujas y adivina, luego dibuja para ti."),
      ],
    },
    {
      id: "soup", category: "puzzle", kind: "match", icon: <BowlSteam size={26} weight="duotone" />, name: t("海龟汤", "Lateral puzzles", "Acertijos laterales"),
      tagline: t("Pinky 出一个怪故事，你们一起问出真相。", "Pinky tells a strange little story; ask your way to the truth together.", "Pinky cuenta una historia rara; descubran juntos la verdad preguntando."),
      rules: [
        t("Pinky 讲一个听起来很奇怪的小故事（汤面），真相（汤底）只有它知道。都是清汤：好玩或温暖，不吓人。", "Pinky tells a short, strange-sounding story; only Pinky knows what really happened. Always gentle: clever, funny or sweet, never scary.", "Pinky cuenta una historia corta y rara; solo Pinky sabe lo que pasó de verdad. Siempre amable: ingeniosa, divertida o tierna, nunca de miedo."),
        t("你们俩随时都可以问，只能问“是 / 不是”的问题。Pinky 会答：是、不是、不重要、是也不是。", "Either of you can ask at any time, but only yes-or-no questions. Pinky answers yes, no, doesn't matter, or yes and no.", "Cualquiera de los dos puede preguntar cuando quiera, pero solo preguntas de sí o no. Pinky responde sí, no, no importa o sí y no."),
        t("屏幕上会显示找到了几个关键，看看离真相还有多远。", "The screen shows how many key facts you've found, so you can tell how close you are.", "La pantalla muestra cuántas claves han encontrado, para ver cuánto les falta."),
        t("想好了就“猜汤底”，说出完整的故事，Pinky 判断对不对。实在猜不出，可以“看汤底”。", "When you think you know, guess the answer by telling the whole story, and Pinky judges it. Stuck? Show the answer.", "Cuando creas saberlo, propón la solución contando la historia completa y Pinky la juzga. ¿Atascados? Vean la solución."),
        t("TA 不在的时候，也可以自己和 Pinky 玩。", "When your partner's away, you can solve one on your own with Pinky.", "Si tu pareja no está, puedes resolver uno tú solo con Pinky."),
      ],
    },
    {
      id: "choice", category: "words", kind: "card", cardType: "choice", icon: <ArrowsSplit size={26} weight="duotone" />, name: t("二选一", "Would you rather", "¿Qué prefieres?"),
      tagline: t("两个选项各选一个，看是不是心有灵犀。", "Both pick one of two; see if you match.", "Cada uno elige una de dos; a ver si coinciden."),
      rules: [
        t("Pinky 在“我们俩”里出一道二选一，你们各自偷偷选。", "Pinky asks a would-you-rather in Us, and you each pick in secret.", "Pinky pregunta en Nosotros y cada uno elige en secreto."),
        t("两个人都选完才一起揭晓，选得一样就加默契值。", "It's revealed once you both pick; the same pick raises your sync score.", "Se revela cuando los dos eligen; coincidir sube su sintonía."),
      ],
    },
    {
      id: "guess", category: "words", kind: "card", cardType: "guess", icon: <Target size={26} weight="duotone" />, name: t("默契问答", "How well do you know me", "¿Cuánto me conoces?"),
      tagline: t("一个人答自己的，另一个人猜。", "One answers about themself, the other guesses.", "Uno responde sobre sí, el otro adivina."),
      rules: [
        t("每道题是关于你们其中一个人的，轮流来。", "Each question is about one of you, taking turns.", "Cada pregunta es sobre uno de ustedes, por turnos."),
        t("被问的人选自己的真实答案，另一个人猜 TA 会选哪个。", "That person picks their real answer; the other guesses what they picked.", "Esa persona elige su respuesta real; la otra adivina cuál eligió."),
        t("两个人都选完才揭晓，猜中就加默契值。", "It's revealed once both have picked; a right guess raises your sync score.", "Se revela cuando los dos eligen; acertar sube su sintonía."),
      ],
    },
    {
      id: "truth", category: "words", kind: "card", cardType: "truth", icon: <ChatsCircle size={26} weight="duotone" />, name: t("真心话", "Heart to heart", "De corazón"),
      tagline: t("一个温柔的问题，各写一句，同时揭晓。", "One gentle question; each writes a line, revealed together.", "Una pregunta tierna; cada uno escribe una línea y se revela a la vez."),
      rules: [
        t("Pinky 出一个温柔的问题，你们各写一句真心话。", "Pinky asks a gentle question and you each write an honest line.", "Pinky hace una pregunta tierna y cada uno escribe una línea sincera."),
        t("两个人都写完才能看到对方的。不会问前任或让人尴尬的事。", "You see each other's only once both have written. Never about exes or anything embarrassing.", "Solo se ven cuando los dos han escrito. Nunca sobre ex parejas ni nada incómodo."),
      ],
    },
  ];
}
