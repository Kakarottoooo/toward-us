import type { ReactNode } from "react";
import { AirplaneTilt, ArrowsSplit, BowlSteam, ChatsCircle, CircleHalf, GridNine, HandFist, Horse, MaskHappy, PaintBrush, Target, TreasureChest, PuzzlePiece, Images, PencilSimple, GridFour } from "@phosphor-icons/react";
import { Camera, ClockCounterClockwise, CookingPot, MusicNotes, Package, Sailboat } from "@phosphor-icons/react";
import { Cards, ChatTeardropDots, Coins, DiceFive, Door, Golf, MagnifyingGlass, Stack } from "@phosphor-icons/react";
import { Boat, Bomb, CirclesFour, GameController, Hockey, SteeringWheel, TrafficSignal } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";

// 游戏大厅 (founder 11-06): the hall lists every game by category, and more of both are coming (棋类、解谜、文字、各种小游戏).
// Adding a game: add it here, and either
//   - kind "match": a module in server/matches (see its index.mjs) plus a screen in MatchScreen.tsx, or
//   - kind "card": a round played as a card in Us (server/games.mjs).
// A category is listed only once it has a game.
export type CategoryId = "board" | "draw" | "words" | "puzzle" | "casual";
export type GameEntry = { id: string; category: CategoryId; kind: "match" | "card"; cardType?: "choice" | "guess" | "truth"; solo?: boolean; partnerOnly?: boolean; icon: ReactNode; name: string; tagline: string; rules: string[] };

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
      id: "xiangqi", category: "board", kind: "match", icon: <Horse size={26} weight="duotone" />, name: t("象棋", "Chinese chess", "Ajedrez chino"),
      tagline: t("楚河汉界，将死对方的将就赢。", "Cross the river and checkmate the other general.", "Cruza el río y da jaque mate al otro general."),
      rules: [
        t("开局的人执红先走，下一盘换另一个人执红。你的棋子总在下方。", "Whoever starts plays red and moves first; next game, the other one plays red. Your pieces are always at the bottom.", "Quien empieza lleva rojas y sale primero; en la siguiente, el otro lleva rojas. Tus piezas siempre están abajo."),
        t("点一下自己的棋子，能走的位置会亮起来，再点一下就走过去。", "Tap one of your pieces to light up where it can go, then tap a spot to move there.", "Toca una de tus piezas para ver adónde puede ir y luego toca el punto para moverla."),
        t("帅（将）和仕（士）不出九宫，相（象）不过河、塞象眼不能走，马被绊腿不能走，炮隔一个子才能吃，兵（卒）过河后可以横走，两个将不能在同一条线上照面。", "K general and A advisors stay in the palace. E elephants never cross the river and are blocked by a piece in between. H horses are blocked by a piece next to them. R chariots move straight. C cannons move like chariots but capture by jumping exactly one piece. P soldiers go forward, and sideways too after the river.", "K general y A consejeros no salen del palacio. E elefantes no cruzan el río y se bloquean con una pieza en medio. H caballos se bloquean con una pieza al lado. R carros van en línea recta. C cañones se mueven como carros pero capturan saltando exactamente una pieza. P soldados avanzan, y tras el río también de lado."),
        t("不能让自己的将被吃，两个将也不能在没有子隔开时照面。把对方将死，或让对方无棋可走就赢；也可以认输。", "You may never leave your own general in check, and the two generals may never face each other on an open line. Win by checkmate, or when the other side has no legal move; either of you may resign.", "Nunca puedes dejar a tu general en jaque, y los dos generales no pueden mirarse en una línea abierta. Ganas con jaque mate o si el otro no tiene ningún movimiento; cualquiera puede rendirse."),
        t("各走 150 步还没分出胜负就算和棋。TA 不在的时候，可以和小家伙下。", "No result after 150 moves each is a draw. When your partner's away, play your little one.", "Sin resultado tras 150 movimientos cada uno, es empate. Si tu pareja no está, juega con tu pequeñín."),
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
      id: "ludo", category: "casual", kind: "match", icon: <AirplaneTilt size={26} weight="duotone" />, name: t("情侣飞行棋", "Couples' ludo", "Parchís de pareja"),
      tagline: t("双圈大棋盘：买约会地点收门票、抽心动卡、走爱心内圈，先把两架飞机送回家的人赢。", "A two-ring board: buy date spots and collect rent, draw heart cards, take the heart ring; first to fly both planes home wins.", "Un tablero de dos anillos: compra lugares de cita y cobra entrada, saca cartas, toma el anillo de corazones; gana quien lleve primero sus dos aviones a casa."),
      rules: [
        t("每人 2 架飞机、200 爱心币。掷到 6 起飞并再掷一次；绕外圈一整圈回到自己的起点就是到家，两架都先到家的人赢。", "You each have 2 planes and 200 coins. A 6 takes off and rolls again; one lap back to your own start is home. Get both home first to win.", "Cada uno tiene 2 aviones y 200 monedas. Un 6 despega y vuelve a tirar; una vuelta hasta tu salida es llegar a casa. Gana quien lleve primero los dos."),
        t("外圈有 8 个约会地点：没人的可以买，自己的可以升级一次；停在对方的地点要付门票，也可以用一个真实的小承诺抵，Pinky 会记在“我们俩”里。", "8 date spots on the outer ring: buy one nobody owns, upgrade your own once. Stop on your partner's and pay rent, in coins or with a real little promise Pinky writes down in Us.", "8 lugares de cita en el anillo exterior: compra uno libre y mejora el tuyo una vez. Si caes en uno de tu pareja, pagas en monedas o con una pequeña promesa real que Pinky anota en Nosotros."),
        t("停在桥头可以走爱心内圈：一样长，有爱心任务和 60 币格，但不能买地、不用付门票。每经过一座桥 +30 币。", "Stop on a bridge to take the heart ring: the same length, with heart tasks and 60-coin squares, but nothing to buy and no rent. Every bridge you pass pays 30.", "Detente en un puente para tomar el anillo de corazones: igual de largo, con tareas y casillas de 60, sin compras ni entradas. Cada puente que pasas paga 30."),
        t("紫色格抽心动卡：前进、后退、收钱、换位置、护身符、一起拍照或回答问题……冷静角会让你歇一回合，掷出 6 或对方说句好听的话就能出来。", "Purple squares draw a heart card: move, coins, swap places, a charm, a photo or a question together… The calm corner holds you a turn: a 6, or a sweet word from your partner, gets you out.", "Las casillas moradas dan una carta: avanzar, monedas, cambiar de sitio, un amuleto, una foto o una pregunta… El rincón de calma te detiene un turno: un 6 o unas palabras bonitas de tu pareja te sacan."),
        t("自己颜色的格子再跳 4 格，自己的飞行格沿虚线飞 12 格；停在对方飞机上会把它撞回去。也可以和小家伙玩，它会自己做选择。", "Your colour hops 4, your flight square flies 12 along the dashed line; land on your partner's plane to send it back. You can play your little one too: it makes its own choices.", "Tu color salta 4, tu casilla de vuelo vuela 12 por la línea; cae sobre el avión de tu pareja para devolverlo. También puedes jugar con tu pequeñín: decide solo."),
      ],
    },
    {
      id: "doodle", category: "draw", kind: "match", partnerOnly: true,
      icon: <PencilSimple size={26} weight="duotone" />, name: t("接力涂鸦", "Doodle Relay", "Dibujo por turnos"),
      tagline: t("你画一半，TA 接一半，最后一起揭晓。", "Draw half, pass it on, and reveal the picture together.", "Dibuja una mitad, pasa el turno y descubran el dibujo juntos."),
      rules: [t("先画上半张，再发给 TA 画下半张。TA 只看到接缝。", "Draw the top and pass it on. Your partner sees only the seam while drawing the bottom.", "Dibuja arriba y pasa el turno. Tu pareja solo ve la unión al dibujar abajo."), t("两个人画完，拼成一张图。", "Both halves come together after you finish.", "Al terminar se juntan las dos mitades.")],
    },
    {
      id: "jigsaw", category: "puzzle", kind: "match", partnerOnly: true,
      icon: <PuzzlePiece size={26} weight="duotone" />, name: t("双人拼图", "Jigsaw Together", "Rompecabezas en pareja"),
      tagline: t("一起拼好 16 片，也可以选你们的共享照片。", "Solve a 16-piece puzzle together, with an illustration or a shared photo.", "Armen juntos 16 piezas, con una ilustración o una foto compartida."),
      rules: [t("点一片，再点想放的格。两个人都能拼，进度会保留。", "Tap a piece, then its spot. You can both play and pick up later.", "Toca una pieza y luego su espacio. Ambos pueden jugar y continuar más tarde."), t("放第一片之前可以选一张共享照片。", "Choose a shared photo before the first piece goes in.", "Pueden elegir una foto compartida antes de poner la primera pieza.")],
    },
    {
      id: "dots", category: "board", kind: "match", partnerOnly: true,
      icon: <GridFour size={26} weight="duotone" />, name: t("连点占格", "Dots and Boxes", "Puntos y cajas"),
      tagline: t("轮流连线，谁围出更多方格谁赢。", "Take turns drawing lines. Claim the most boxes to win.", "Tracen líneas por turnos. Gana quien cierre más cuadros."),
      rules: [t("点相邻两点之间的一条线。围成格子得一分，再走一步。", "Connect two adjacent dots. Complete a box to score and go again.", "Une dos puntos vecinos. Al cerrar un cuadro ganas un punto y vuelves a jugar.")],
    },
    {
      id: "detective", category: "puzzle", kind: "match", partnerOnly: true,
      icon: <Images size={26} weight="duotone" />, name: t("照片侦探", "Photo Detective", "Detective de fotos"),
      tagline: t("只给 TA 看一小角，猜猜照片背后的故事。", "Show one small crop and guess the story behind the photo.", "Muestra solo un recorte y adivinen la historia detrás de la foto."),
      rules: [t("出题的人选一张共享照片和一小块，写下谜底。", "Choose a shared photo, pick the crop and write the answer.", "Elige una foto compartida, recorta una parte y escribe la respuesta."), t("TA 猜完一起翻开完整照片，再换人。", "Reveal the whole photo after your partner guesses, then swap roles.", "Tras la respuesta se revela la foto completa y cambian turnos.")],
    },
    {
      id: "sokoban", category: "puzzle", kind: "match", partnerOnly: true, icon: <Package size={26} weight="duotone" />,
      name: t("双人推箱子", "Together We Move", "Mudanza en pareja"),
      tagline: t("帮 TA 开门，两个人把家具推到位。", "Hold the door for each other and move the furniture into place.", "Mantengan abiertas las puertas y coloquen juntos los muebles."),
      rules: [t("各控制一个人，轮流走路和推家具。", "Each of you controls a mover. Take turns walking and pushing furniture.", "Cada uno controla a un personaje. Túrnense para caminar y empujar muebles."), t("一个人踩住开关，另一个人就能通过对应的门。", "Stand on a switch to hold the matching door open for your partner.", "Pisa un interruptor para que tu pareja pueda pasar por la puerta correspondiente."), t("家具都推到标记处就过关。", "Place all the furniture on its marked spots to finish the level.", "Coloquen todos los muebles en sus lugares marcados para superar el nivel.")],
    },
    {
      id: "battleship", category: "board", kind: "match", partnerOnly: true, icon: <Sailboat size={26} weight="duotone" />,
      name: t("海战棋", "Battleship", "Batalla naval"),
      tagline: t("各藏三艘船，轮流猜 TA 的坐标。", "Hide three ships each, then take turns firing at the other's grid.", "Escondan tres barcos cada uno y túrnense para disparar a la cuadrícula rival."),
      rules: [t("先在自己的海域里摆好三艘船，确认后对方也看不到。", "Place three ships in your waters. Lock them in to keep them hidden from your partner.", "Coloca tres barcos en tu tablero y confirma. Tu pareja no verá dónde están."), t("轮到你时，点对方海域的一格。谁先击沉对方三艘船谁赢。", "Tap one square in your partner's waters on your turn. Sink all three ships first to win.", "En tu turno, toca una casilla del tablero rival. Gana quien hunda primero los tres barcos.")],
    },
    {
      id: "kitchen", category: "casual", kind: "match", partnerOnly: true, icon: <CookingPot size={26} weight="duotone" />,
      name: t("两人开餐厅", "Two-Person Kitchen", "Cocina en pareja"),
      tagline: t("一个备料，一个做菜。两分钟内一起出餐。", "One preps, one cooks. Serve as many orders as you can in two minutes.", "Uno prepara y el otro cocina. Sirvan todos los pedidos que puedan en dos minutos."),
      rules: [t("两个人都准备好才开张。", "The kitchen opens when both of you are ready.", "La cocina abre cuando los dos estén listos."), t("看订单配合，在时间结束前尽量多上菜。", "Work through the orders and serve as many dishes as you can before time runs out.", "Sigan los pedidos y sirvan todos los platos posibles antes de que se acabe el tiempo.")],
    },
    {
      id: "timeline", category: "puzzle", kind: "match", partnerOnly: true, icon: <ClockCounterClockwise size={26} weight="duotone" />,
      name: t("回忆时间线", "Memory Timeline", "Línea de recuerdos"),
      tagline: t("挑几张共同回忆里的照片，猜猜哪张最早。", "Pick photos from Shared memories and put them in chronological order.", "Elijan fotos de sus Recuerdos compartidos y pónganlas en orden cronológico."),
      rules: [t("两人各挑共享照片，也可以用示例卡开局。", "Each of you picks shared photos, or use the sample cards to start.", "Cada uno elige fotos compartidas, o pueden jugar con las cartas de ejemplo."), t("一起从最早排到最近，双方确认同一顺序才揭晓。", "Sort them from earliest to latest. When you both confirm the same order, the dates are revealed.", "Ordénenlas de la más antigua a la más reciente. Las fechas se revelan cuando ambos confirman el mismo orden.")],
    },
    {
      id: "photo-relay", category: "casual", kind: "match", partnerOnly: true, icon: <Camera size={26} weight="duotone" />,
      name: t("拍照接力", "Photo Relay", "Reto de fotos"),
      tagline: t("为同一个主题各拍一张，交齐后拼成一张。", "Take one photo each on the same theme. See them side by side once both are in.", "Tomen una foto cada uno sobre el mismo tema. Véanlas juntas cuando ambos las envíen."),
      rules: [t("按主题拍照或从手机里选，确认后交给这局游戏。", "Take or pick a photo for the prompt, then confirm to submit it to this game.", "Toma o elige una foto para el reto y confirma para enviarla a esta partida."), t("两人都交了才揭晓拼图，可以把合照存下来。", "The collage is revealed after both submit. You can save it to keep.", "El collage se revela cuando ambos envían su foto. Pueden guardarlo como recuerdo.")],
    },
    {
      id: "song", category: "casual", kind: "match", partnerOnly: true, icon: <MusicNotes size={26} weight="duotone" />,
      name: t("一起做首歌", "Make a Song Together", "Hagamos una canción"),
      tagline: t("一个写八拍鼓点，一个加旋律，合起来听。", "Make an eight-beat drum pattern, then let your partner add a melody.", "Crea ocho tiempos de percusión y deja que tu pareja añada una melodía."),
      rules: [t("前一个人做鼓点，后一个人可以先试听，再加旋律。", "One makes the rhythm. The other listens and adds a melody.", "Una persona crea el ritmo. La otra lo escucha y añade una melodía."), t("合成后，两人都可以回到这局随时播放。", "Once it's done, both of you can come back and play your track anytime.", "Cuando esté lista, ambos pueden volver a esta partida y escuchar su canción.")],
    },
    {
      id: "escape-room", category: "puzzle", kind: "match", partnerOnly: true, icon: <Door size={26} weight="duotone" />,
      name: t("双人密室", "Room for Two", "Escape en pareja"),
      tagline: t("一个看线索，一个动手解机关。", "One sees the clues. The other works the controls.", "Uno ve las pistas y el otro maneja los controles."),
      rules: [t("互相讲你们看到的东西，破解三个机关。", "Tell each other what you see and unlock three mechanisms.", "Cuéntense lo que ven y resuelvan tres mecanismos."), t("每关交换角色，卡住可以看提示。", "Switch roles at each stage. Ask for a hint if you get stuck.", "Cambien de rol en cada etapa. Si se atascan, pidan una pista.")],
    },
    {
      id: "spot-difference", category: "puzzle", kind: "match", partnerOnly: true, icon: <MagnifyingGlass size={26} weight="duotone" />,
      name: t("合作找不同", "Spot the Difference Together", "Encuentren las diferencias"),
      tagline: t("每人看到一张图，聊聊哪里不一样。", "Each of you sees one image. Compare what you notice.", "Cada uno ve una imagen. Comparen qué detalles cambian."),
      rules: [t("你和 TA 看到的是同一场景的两个版本。", "You and your partner see two versions of the same scene.", "Tú y tu pareja ven dos versiones de la misma escena."), t("一起找出五处差异，点图片标出来。", "Tap to mark all five differences together.", "Toquen la imagen para encontrar juntos las cinco diferencias.")],
    },
    {
      id: "memory-pairs", category: "puzzle", kind: "match", partnerOnly: true, icon: <Cards size={26} weight="duotone" />,
      name: t("翻牌搭档", "Memory Match Together", "Parejas de memoria"),
      tagline: t("轮流翻两张牌，一起配完八对。", "Flip two cards each turn and find all eight pairs together.", "Volteen dos cartas por turno y encuentren juntos las ocho parejas."),
      rules: [t("记住你们翻过的牌，叫 TA 去找和它一模一样的那张。", "Remember what you've turned over and help each other find the matching cards.", "Recuerden las cartas que han volteado y ayúdense a encontrar sus parejas.")],
    },
    {
      id: "date-budget", category: "casual", kind: "match", partnerOnly: true, icon: <Coins size={26} weight="duotone" />,
      name: t("约会拼预算", "Budget a Date", "Una cita con presupuesto"),
      tagline: t("用共同的游戏点数，拼出你们都想去的约会。", "Use a shared pool of credits to build a date you both want.", "Usen sus créditos para armar una cita que les guste a los dos."),
      rules: [t("商量怎么选吃饭、活动和交通，让三项加起来不超预算。", "Pick food, an activity, and transportation without going over budget.", "Elijan comida, actividad y transporte sin pasarse del presupuesto."), t("你们可以选一个时间，双方确认后会加入共同日历。", "Pick a time if you like. Confirm it together to add it to your shared calendar.", "Si quieren, elijan una hora y confírmenla juntos para añadirla al calendario compartido.")],
    },
    {
      id: "liar-dice", category: "board", kind: "match", partnerOnly: true, icon: <DiceFive size={26} weight="duotone" />,
      name: t("吹牛骰子", "Liar's Dice", "Dados mentirosos"),
      tagline: t("你只看得到自己的骰子。听 TA 怎么押，再决定要不要开。", "See only your own dice. Raise your partner's bid or call their bluff.", "Solo ves tus dados. Sube la apuesta de tu pareja o ponla a prueba."),
      rules: [t("报两人的骰子加起来至少有几个同样的点数。下一个人要报更高，或者开盅。", "Bid on how many dice of one face both players have in total. The next player raises or challenges.", "Di cuántos dados de una cara hay entre los dos. La otra persona sube la apuesta o la cuestiona."), t("每次开盅，输的人少一颗骰子。最后还有骰子的人赢。", "The loser of each challenge loses a die. The last player with dice wins.", "Quien pierda el desafío pierde un dado. Gana quien se quede con dados al final.")],
    },
    {
      id: "mini-golf", category: "casual", kind: "match", partnerOnly: true, icon: <Golf size={26} weight="duotone" />,
      name: t("迷你高尔夫", "Mini Golf", "Minigolf"),
      tagline: t("点一下瞄准，调力度。打完三洞，杆数少的赢。", "Aim, set your power, and putt. Lowest score after three holes wins.", "Apunta, ajusta la fuerza y golpea. Gana quien use menos golpes en tres hoyos."),
      rules: [t("轮流打三洞。可以绕过水坑，也可以借墙弹一下。", "Take turns playing three holes. Go around water or bounce your shot off a wall.", "Jueguen tres hoyos por turnos. Rodeen el agua o hagan rebotar la bola contra una pared.")],
    },
    {
      id: "stack-tower", category: "casual", kind: "match", partnerOnly: true, icon: <Stack size={26} weight="duotone" />,
      name: t("双人叠塔", "Stack a Tower", "Construyan una torre"),
      tagline: t("轮流放积木，小心偏重和风，一起搭到十二层。", "Take turns stacking blocks. Balance their weight and the wind to reach twelve levels.", "Apilen bloques por turnos. Equilibren el peso y el viento para llegar a doce pisos."),
      rules: [t("看积木哪边重，把它放稳，再轮到 TA。塔倒了也可以立刻重开。", "Check which side is heavier, place the block, and pass the turn. If the tower falls, play again.", "Mira qué lado pesa más, coloca el bloque y pasa el turno. Si la torre cae, vuelvan a jugar.")],
    },
    {
      id: "forbidden-words", category: "words", kind: "match", partnerOnly: true, icon: <ChatTeardropDots size={26} weight="duotone" />,
      name: t("禁词猜词", "Forbidden Words", "Palabras prohibidas"),
      tagline: t("让 TA 猜出答案，但线索不能用卡片上的禁词。", "Get your partner to guess the answer without using the words on the card.", "Haz que tu pareja adivine la respuesta sin usar las palabras prohibidas de la carta."),
      rules: [t("一人发线索，一人猜。猜中或这一轮结束时换人。", "One sends clues, the other guesses. Swap when the round ends.", "Una persona da pistas y la otra adivina. Cambien de rol al acabar la ronda.")],
    },
    {
      id: "air-hockey", category: "casual", kind: "match", partnerOnly: true, icon: <Hockey size={26} weight="duotone" />,
      name: t("双人冰球", "Air Hockey", "Hockey de aire"),
      tagline: t("拖动球拍挡球和反击，先进五球。", "Drag your paddle to defend and shoot. First to five goals.", "Arrastra tu paleta para defender y atacar. Gana quien meta cinco goles."),
      rules: [t("两人都准备好后开球。球可以从侧墙反弹。", "The puck drops when you're both ready. Bank shots off the walls.", "El disco sale cuando ambos estén listos. Hazlo rebotar contra las paredes.")],
    },
    {
      id: "pinball-duo", category: "casual", kind: "match", partnerOnly: true, icon: <CirclesFour size={26} weight="duotone" />,
      name: t("双人弹珠台", "Two-Player Pinball", "Pinball en pareja"),
      tagline: t("各控一块挡板，合力接住快掉下去的球。", "Control one flipper each and keep the same ball alive.", "Cada uno controla una aleta. Mantengan la misma bola en juego."),
      rules: [t("发球后用挡板打进不同机关，三颗球用完前冲到目标分。", "Hit bumpers and targets to reach the goal before the three balls run out.", "Golpeen los obstáculos y objetivos para llegar a la meta antes de gastar las tres bolas.")],
    },
    {
      id: "block-duel", category: "casual", kind: "match", partnerOnly: true, icon: <GridNine size={26} weight="duotone" />,
      name: t("方块对战", "Block Duel", "Duelo de bloques"),
      tagline: t("转动方块消行，一次消两行就给 TA 加障碍。", "Rotate and clear blocks. Clear two lines to send your opponent an obstacle.", "Gira y elimina bloques. Al borrar dos filas, envías un obstáculo a tu rival."),
      rules: [t("双方拿到同样的方块顺序，棋盘先堆满的一方输。", "You both get the same sequence of blocks. The first board to fill loses.", "Ambos reciben la misma secuencia de bloques. Pierde quien llene su tablero primero.")],
    },
    {
      id: "co-pilot", category: "casual", kind: "match", partnerOnly: true, icon: <SteeringWheel size={26} weight="duotone" />,
      name: t("你指挥我开车", "You Navigate, I Drive", "Tú guías, yo conduzco"),
      tagline: t("一个看路线，一个开车。下一路口听 TA 的。", "One sees the route and one drives. Follow your partner's directions at each junction.", "Uno ve la ruta y el otro conduce. Sigue las indicaciones de tu pareja en cada cruce."),
      rules: [t("领航员发方向信号，司机在路口前选方向。走错可以回到这个路口。", "The navigator sends signals. Choose before reaching the junction. A wrong turn sends you back to try it again.", "Tu guía envía señales. Elige antes de llegar al cruce. Si te equivocas, puedes volver a intentarlo.")],
    },
    {
      id: "river-row", category: "casual", kind: "match", partnerOnly: true, icon: <Boat size={26} weight="duotone" />,
      name: t("双人划船", "Row Together", "Remen juntos"),
      tagline: t("你划一边，TA 划另一边，一起穿过河上的浮标。", "Take one paddle each and guide the boat through the buoys.", "Cada uno lleva un remo. Guíen el bote entre las boyas."),
      rules: [t("一起划就加速，单边划可以调整方向。", "Stroke together to speed up. Paddle on one side to steer.", "Remen juntos para acelerar. Remen de un solo lado para girar.")],
    },
    {
      id: "green-light", category: "casual", kind: "match", partnerOnly: true, icon: <TrafficSignal size={26} weight="duotone" />,
      name: t("绿灯抢拍", "Green Light", "Luz verde"),
      tagline: t("等灯变绿再拍，五轮比谁反应快。", "Wait for green, then tap. Five heats of quick reactions.", "Espera la luz verde y toca. Cinco rondas para ver quién reacciona más rápido."),
      rules: [t("绿灯先拍得分，抢跑会把这一轮的分送给 TA。", "Tap first on green to score. A false start gives the point to your partner.", "Toca primero en verde para sumar. Si te adelantas, el punto es de tu pareja.")],
    },
    {
      id: "mines-duo", category: "puzzle", kind: "match", partnerOnly: true, icon: <Bomb size={26} weight="duotone" />,
      name: t("双人扫雷", "Minesweeper Together", "Buscaminas en pareja"),
      tagline: t("共用一张雷区，一个翻格，一个帮忙插旗。", "Share one minefield. Reveal tiles and help flag the mines.", "Compartan el campo minado. Abran casillas y marquen minas juntos."),
      rules: [t("第一个格子安全。数字表示周围有几个雷，打开所有安全格就赢。", "Your first tile is safe. Numbers tell you how many mines touch a tile. Open every safe tile to win.", "La primera casilla es segura. Los números indican cuántas minas hay alrededor. Abran todas las casillas seguras para ganar.")],
    },
    {
      id: "crazy-eights", category: "board", kind: "match", partnerOnly: true, icon: <Cards size={26} weight="duotone" />,
      name: t("疯狂八点", "Crazy Eights", "Ochos locos"),
      tagline: t("接同花色或同点数，8 可以换花色。", "Match the suit or rank. Play an eight to change the suit.", "Iguala el palo o el número. Juega un ocho para cambiar el palo."),
      rules: [t("轮流出一张牌，也可以抽一张。先出完手牌的人赢。", "Take turns playing a card or draw one from the deck. First to empty their hand wins.", "Túrnense para jugar una carta o robar del mazo. Gana quien se quede sin cartas primero.")],
    },
    {
      id: "hunt", category: "puzzle", kind: "match", partnerOnly: true, icon: <TreasureChest size={26} weight="duotone" />, name: t("双人寻宝", "Treasure Hunt", "Búsqueda del tesoro"),
      tagline: t("同一张地图，两条不同线索。聊一聊，一起找到宝物。", "One map, two different clues. Talk it out and find the treasure together.", "Un mapa y dos pistas distintas. Hablen y encuentren el tesoro juntos."),
      rules: [
        t("各自看自己的线索。可以在「我们俩」里交流，或者点「给 TA 看」亮出线索。", "Read your own clue. Talk in Us, or tap Show partner to reveal your clue to them.", "Lee tu pista. Pueden hablar en Nosotros o tocar Mostrar a tu pareja para compartirla."),
        t("各自选好一格并确认。两个人选同一格才打开，三次用完就揭晓。", "Pick and confirm a tile each. It opens when you agree. After three tries, the treasure is revealed.", "Cada uno elige y confirma una casilla. Se abre cuando coinciden. Tras tres intentos se revela el tesoro."),
      ],
    },
    {
      // Played alone with Pinky hosting when the partner is away: the "with the pet" match, but the pet doesn't play.
      id: "soup", category: "puzzle", kind: "match", solo: true, icon: <BowlSteam size={26} weight="duotone" />, name: t("海龟汤", "Lateral puzzles", "Acertijos laterales"),
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
    {
      id: "reversi", category: "board", kind: "match", icon: <CircleHalf size={26} weight="duotone" />, name: t("黑白棋", "Reversi", "Reversi"),
      tagline: t("夹住对方的棋子就能翻成你的颜色。", "Sandwich their discs to flip them to your colour.", "Atrapa sus fichas entre las tuyas para voltearlas."),
      rules: [
        t("8×8 的棋盘，开局的人执黑先走。", "An 8 x 8 board; whoever starts plays black and goes first.", "Tablero de 8 x 8; quien empieza lleva negras y sale primero."),
        t("每一步都要把对方的一排（横、竖、斜）夹在你的两颗子之间，被夹住的全部翻成你的颜色。能下的位置会有小圆点提示。", "Each move must trap a line of their discs (across, down or diagonal) between two of yours; every trapped disc flips. Spots you can play show a small dot.", "Cada jugada debe atrapar una línea de sus fichas entre dos tuyas; todas las atrapadas se voltean. Los puntos donde puedes jugar llevan un puntito."),
        t("没地方下就自动跳过；两个人都下不了时，棋子多的人赢。", "No move means your turn is skipped; when neither can move, more discs wins.", "Sin jugada se salta tu turno; cuando nadie puede jugar, gana quien tenga más fichas."),
        t("TA 不在时可以和小家伙下，它特别爱抢角。", "When your partner's away, play your little one: it loves the corners.", "Si tu pareja no está, juega con tu pequeñín: adora las esquinas."),
      ],
    },
    {
      id: "connect4", category: "board", kind: "match", icon: <GridFour size={26} weight="duotone" />, name: t("四子棋", "Four in a row", "Cuatro en raya"),
      tagline: t("点一列投下棋子，先连成四个的赢。", "Drop discs into columns; first to four in a row wins.", "Deja caer fichas en columnas; gana quien haga cuatro en línea."),
      rules: [
        t("7 列 6 行，点哪一列，棋子就掉到那一列最下面的空位。", "Seven columns, six rows: a disc falls to the lowest free spot of the column you tap.", "Siete columnas y seis filas: la ficha cae al hueco más bajo de la columna que toques."),
        t("横、竖、斜先连成四个的人赢；棋盘下满就是平局。", "Four in a row across, down or diagonally wins; a full board is a draw.", "Cuatro en línea en cualquier dirección gana; tablero lleno es empate."),
        t("一盘只要几分钟，下一盘换另一个人先走。", "A game takes a few minutes; the other one goes first next time.", "Una partida dura unos minutos; la próxima empieza el otro."),
      ],
    },
    {
      id: "truths", category: "words", kind: "match", icon: <MaskHappy size={26} weight="duotone" />, name: t("两个真相一个谎言", "Two truths and a lie", "Dos verdades y una mentira"),
      tagline: t("说三件关于自己的事，让 TA 猜哪件是编的。", "Tell three things about you; they guess which one you made up.", "Cuenta tres cosas de ti; adivina cuál es inventada."),
      rules: [
        t("轮到你时写三件关于你的事，其中一件是编的，再点“这句是假的”标出来。", "On your turn write three things about you, one made up, and mark it with This one's the lie.", "En tu turno escribe tres cosas sobre ti, una inventada, y márcala."),
        t("TA 只看到三句话，猜哪句是假的。猜完揭晓，然后换 TA 来说。", "They only see the three lines and guess the lie; then it's revealed and you swap.", "Solo ve las tres frases y adivina la mentira; luego se revela y cambian."),
        t("越像真的越好玩，也是更了解对方的好机会。", "The more believable the better, and you'll learn things about each other.", "Cuanto más creíble, mejor, y se conocerán un poco más."),
        t("也可以和小家伙玩，它也会说三件关于自己的事。", "You can play your little one too: it tells three things about itself.", "También con tu pequeñín: cuenta tres cosas de sí mismo."),
      ],
    },
    {
      id: "rps", category: "casual", kind: "match", icon: <HandFist size={26} weight="duotone" />, name: t("石头剪刀布", "Rock paper scissors", "Piedra, papel o tijera"),
      tagline: t("三局两胜，可以先定个赌注，比如输的人洗碗。", "Best of three, with a bet if you like: loser does the dishes.", "Al mejor de tres, con apuesta si quieren: quien pierda lava los platos."),
      rules: [
        t("开始前可以写一个赌注，第一把出拳之前都能定。", "Before the first pick you can set a bet.", "Antes de la primera jugada pueden fijar una apuesta."),
        t("两个人各自偷偷出，都出完才一起揭晓；平手就再来。", "You each pick in secret; it's revealed once both have picked, and a tie is played again.", "Cada uno elige en secreto; se revela cuando ambos eligen, y el empate se repite."),
        t("先赢两把的人赢。结束后 Pinky 会在“我们俩”里说谁赢了、谁要兑现赌注。", "First to two wins. Pinky then says in Us who won and who owes the bet.", "Gana quien llegue a dos. Pinky dice en Nosotros quién ganó y quién debe la apuesta."),
      ],
    },
  ];
}
