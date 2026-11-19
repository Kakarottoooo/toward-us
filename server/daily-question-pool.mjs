import { dailyQuestionTopicsA } from "./daily-question-topics-a.mjs";
import { dailyQuestionTopicsB } from "./daily-question-topics-b.mjs";

// Each entry is one question in three languages, with the same meaning in each.
// Keep the subjects distinct so the daily rotation has room to skip recent questions.
export const dailyQuestionPool = [
  {
    zh: "要给你们的双人队印一件队服，你会在背后印什么？",
    en: "If your duo had team shirts, what would you print on the back?",
    es: "Si tuvieran camisetas de equipo, ¿qué imprimirías en la espalda?",
  },
  {
    zh: "小时候的你会对现在的你哪一点最惊讶？",
    en: "What would your childhood self find most surprising about you now?",
    es: "¿Qué sería lo que más sorprendería a tu yo de la infancia sobre ti hoy?",
  },
  {
    zh: "哪种味道一闻到，就会把你带回某个地方？",
    en: "What smell takes you right back to a particular place?",
    es: "¿Qué olor te transporta de inmediato a un lugar concreto?",
  },
  {
    zh: "如果能暂借 TA 的一项本领一天，你会借什么？",
    en: "If you could borrow one of your partner’s skills for a day, which would you pick?",
    es: "Si pudieras tomar prestada por un día una habilidad de tu pareja, ¿cuál sería?",
  },
  {
    zh: "如果只能用三样东西装一盒「你的家乡」，你会放什么？",
    en: "If you could put three things in a box to show where you grew up, what would you pack?",
    es: "Si pudieras mostrar dónde creciste con tres cosas en una caja, ¿qué pondrías?",
  },
  {
    zh: "有哪种舞步，就算你俩都跳错了也愿意一起学？",
    en: "What dance step would you enjoy learning together even if you both got it wrong?",
    es: "¿Qué paso de baile les divertiría aprender juntos aunque les saliera mal?",
  },
  {
    zh: "如果你们客串同一部动画片，会扮演什么角色？",
    en: "If you made a cameo in the same cartoon, what roles would you play?",
    es: "Si hicieran una aparición en la misma serie animada, ¿qué papeles tendrían?",
  },
  {
    zh: "你小时候最爱的游戏，有没有一个想教会 TA？",
    en: "Which game you loved as a kid would you like to teach your partner?",
    es: "¿Qué juego de tu infancia te gustaría enseñarle a tu pareja?",
  },
  {
    zh: "如果给你们的冰箱加一格，专放一种零食，你会留给什么？",
    en: "What snack would you give its own shelf in your fridge?",
    es: "¿A qué antojo le darías un estante entero en el refrigerador?",
  },
  {
    zh: "如果有个按钮能自动做完一种家务，你会把它留给什么？",
    en: "If a button could do one household chore for you, which chore would you choose?",
    es: "Si un botón pudiera hacer una tarea de casa por ti, ¿cuál elegirías?",
  },
  {
    zh: "你觉得 TA 最适合给哪一种动物配音？",
    en: "What animal do you think your partner would be best at voicing?",
    es: "¿A qué animal crees que tu pareja le pondría mejor la voz?",
  },
  {
    zh: "找一个词形容你今天的心情，你想选哪个词？",
    en: "What one word would you use to describe how you feel today?",
    es: "¿Con qué palabra describirías cómo te sientes hoy?",
  },
  {
    zh: "你觉得哪种声音最适合当作起床铃？",
    en: "What sound would you actually like to wake up to?",
    es: "¿Con qué sonido te gustaría despertarte?",
  },
  {
    zh: "在你们认识之前，有哪段趣事你还没讲给 TA 听？",
    en: "What funny story from before you met have you yet to tell your partner?",
    es: "¿Qué anécdota graciosa de antes de conocerse aún no le has contado a tu pareja?",
  },
  {
    zh: "你们如果开一家快闪小店，会卖什么？",
    en: "If you opened a pop-up shop together, what would you sell?",
    es: "Si abrieran una tienda temporal juntos, ¿qué venderían?",
  },
  {
    zh: "哪个味道奇怪的食物组合，你愿意推荐给 TA？",
    en: "What unusual food combination would you recommend to your partner?",
    es: "¿Qué combinación rara de comida le recomendarías a tu pareja?",
  },
  {
    zh: "你们在路上遇到猫、狗和鸽子，TA 最可能停下来跟谁打招呼？",
    en: "If you passed a cat, a dog and a pigeon, which would your partner stop to greet?",
    es: "Si se cruzaran con un gato, un perro y una paloma, ¿a cuál se pararía a saludar tu pareja?",
  },
  {
    zh: "你们合力做过哪件小事，结果比你想象中更顺利？",
    en: "When did something small you did as a team go better than you expected?",
    es: "¿Qué pequeña cosa hicieron en equipo que salió mejor de lo que esperabas?",
  },
  {
    zh: "如果连续一个月每天拍同一个地方，你会选哪儿？",
    en: "If you took a photo of the same spot every day for a month, where would you do it?",
    es: "Si fotografiaras el mismo lugar cada día durante un mes, ¿cuál elegirías?",
  },
  {
    zh: "你最近看到的哪条冷知识，最想拿去考考 TA？",
    en: "What random fact you learned lately would you quiz your partner on?",
    es: "¿Con qué dato curioso que aprendiste hace poco pondrías a prueba a tu pareja?",
  },
  {
    zh: "如果可以给日历多加一个季节，你会怎么命名？",
    en: "If you could add a season to the calendar, what would you call it?",
    es: "Si pudieras añadir una estación al calendario, ¿cómo la llamarías?",
  },
  {
    zh: "你最想把哪本书或哪部电影的一个角色请来吃饭？",
    en: "Which character from a book or movie would you most like to invite to dinner?",
    es: "¿A qué personaje de un libro o una película te gustaría invitar a cenar?",
  },
  {
    zh: "你们只剩一张草稿纸，会一起在上面画什么？",
    en: "If you had just one piece of scrap paper, what would you draw on it together?",
    es: "Si solo tuvieran una hoja para garabatear, ¿qué dibujarían juntos?",
  },
  {
    zh: "你最想亲眼看看什么东西是怎么做出来的？",
    en: "What would you most like to see being made in person?",
    es: "¿Qué te gustaría ver en persona mientras lo fabrican?",
  },
  {
    zh: "哪一种天气会让你想立刻出门？",
    en: "What kind of weather makes you want to go outside right away?",
    es: "¿Qué tipo de tiempo te da ganas de salir enseguida?",
  },
  {
    zh: "你想给 TA 最近做成的哪件事颁一枚小奖章？",
    en: "What recent thing your partner did deserves a little medal?",
    es: "¿Por qué cosa que hizo hace poco le darías una medallita a tu pareja?",
  },
  {
    zh: "如果给朋友写三句城市指南，你会推荐哪一个去处？",
    en: "If you gave a friend a three-line guide to your city, what spot would you recommend?",
    es: "Si escribieras una guía de tu ciudad de tres líneas para alguien, ¿qué lugar recomendarías?",
  },
  {
    zh: "你会用什么颜色形容你们第一次见面那一天？",
    en: "What color would you use to describe the day you met?",
    es: "¿Con qué color describirías el día en que se conocieron?",
  },
  {
    zh: "什么日常小事，你知道自己跟大多数人的做法不太一样？",
    en: "What ordinary little thing do you do a bit differently from most people?",
    es: "¿Qué cosita cotidiana haces de una manera un poco distinta a la mayoría?",
  },
  {
    zh: "哪一句话是你跟 TA 相处之后才学会说的？",
    en: "What phrase did you pick up from spending time with your partner?",
    es: "¿Qué frase se te pegó de tanto pasar tiempo con tu pareja?",
  },
  {
    zh: "你愿意第一次跟 TA 参加哪种不计输赢的比赛？",
    en: "What kind of contest would be fun to enter together if the score didn’t count?",
    es: "¿En qué tipo de concurso te divertiría participar con tu pareja si no contara el resultado?",
  },
  {
    zh: "有哪一样东西，TA 比你更擅长在家里找到？",
    en: "What thing at home is your partner better at finding than you are?",
    es: "¿Qué cosa de casa encuentra tu pareja más fácilmente que tú?",
  },
  {
    zh: "最近有过哪一次，你原以为会很无聊，结果却玩得很开心？",
    en: "What did you expect to be boring recently that ended up being fun?",
    es: "¿Qué pensabas que iba a ser aburrido hace poco y resultó muy divertido?",
  },
  {
    zh: "如果你们共同给一颗新发现的星星取名，它会叫什么？",
    en: "If you could name a newly discovered star together, what would you call it?",
    es: "Si pudieran ponerle nombre a una estrella recién descubierta, ¿cómo la llamarían?",
  },
  {
    zh: "挑一件从小留到现在的东西，你最想给 TA 看哪一件？",
    en: "What object you’ve kept since childhood would you most like to show your partner?",
    es: "¿Qué objeto que conservas desde la infancia te gustaría mostrarle a tu pareja?",
  },
  {
    zh: "如果你们从零开始种一个花盆，第一株想种什么？",
    en: "If you started a little planter together, what would you grow first?",
    es: "Si empezaran a cultivar algo en una maceta juntos, ¿qué plantarían primero?",
  },
  {
    zh: "你们第一次一起做过的哪件事，现在回想会笑？",
    en: "What did you do together for the first time that makes you laugh now?",
    es: "¿Qué hicieron juntos por primera vez que hoy te da risa recordar?",
  },
  {
    zh: "如果两个人只能带一个包去野餐，你负责带哪样东西？",
    en: "If you shared one picnic bag, what would you make sure to bring?",
    es: "Si llevaran una sola bolsa para un pícnic, ¿qué te encargarías de llevar?",
  },
  {
    zh: "有什么声音一响起来，TA 就会知道是你来了？",
    en: "What sound would tell your partner that you’ve just arrived?",
    es: "¿Qué sonido le avisaría a tu pareja de que acabas de llegar?",
  },
  {
    zh: "现在要给半年后的自己藏一张纸条，你会写什么？",
    en: "What would you write in a note to open six months from now?",
    es: "¿Qué escribirías en una nota para abrir dentro de seis meses?",
  },
  {
    zh: "最近哪一个新发现，你觉得 TA 也会喜欢？",
    en: "What have you discovered recently that you think your partner would like too?",
    es: "¿Qué descubriste hace poco que crees que también le gustaría a tu pareja?",
  },
  {
    zh: "有哪一句台词，你们能各自接出下一句？",
    en: "What line from a show or movie could both of you finish?",
    es: "¿Qué frase de una serie o película podrían completar los dos?",
  },
  {
    zh: "如果你们设计一个双人游戏，里面最奇怪的一条规则是什么？",
    en: "If you invented a game for two, what would be its strangest rule?",
    es: "Si inventaran un juego para dos, ¿cuál sería la regla más rara?",
  },
  {
    zh: "哪个你不常去的地方，一想到和 TA 一起去就有点期待？",
    en: "What place you rarely go to would you be excited to visit with your partner?",
    es: "¿A qué lugar al que casi nunca vas te haría ilusión ir con tu pareja?",
  },
  {
    zh: "TA 随手做过什么事，让你也想学着做？",
    en: "What did your partner do without thinking much about it that made you want to try it yourself?",
    es: "¿Qué hizo tu pareja casi sin pensarlo que te dio ganas de probarlo también?",
  },
  {
    zh: "你觉得 TA 看到哪种路边招牌，会忍不住停下来读完？",
    en: "What kind of street sign would make your partner stop and read the whole thing?",
    es: "¿Qué tipo de letrero haría que tu pareja se detuviera a leerlo entero?",
  },
  {
    zh: "如果用三个表情讲完你今天的故事，你会选哪三个？",
    en: "Which three emojis would tell the story of your day?",
    es: "¿Qué tres emojis contarían la historia de tu día?",
  },
  {
    zh: "有没有一个你家的小传统，想跟 TA 一起接着做？",
    en: "What little family tradition would you like to carry on with your partner?",
    es: "¿Qué pequeña tradición familiar te gustaría mantener con tu pareja?",
  },
  {
    zh: "如果可以给一本书加个番外，你想知道谁后来怎么样了？",
    en: "If you could add an epilogue to a book, whose story would you want to follow?",
    es: "Si pudieras añadir un epílogo a un libro, ¿de quién querrías saber qué pasó después?",
  },
  {
    zh: "去自助餐吃饭，TA 会先往盘子里夹什么？",
    en: "At a buffet, what would your partner put on their plate first?",
    es: "En un bufé, ¿qué sería lo primero que tu pareja pondría en su plato?",
  },
  {
    zh: "有没有一种东西，你用旧了反而比刚买时还喜欢？",
    en: "What do you like even more now that it’s worn in?",
    es: "¿Qué cosa te gusta más ahora que ya tiene sus años de uso?",
  },
  {
    zh: "如果明天表演双人魔术，谁更擅长吸引观众的注意力？",
    en: "If you performed a magic trick together, who would be better at distracting the audience?",
    es: "Si hicieran un truco de magia juntos, ¿quién distraería mejor al público?",
  },
  {
    zh: "最近你学会的哪一件事，比想象中容易上手？",
    en: "What have you learned lately that was easier to pick up than you expected?",
    es: "¿Qué aprendiste hace poco que resultó más fácil de lo que esperabas?",
  },
  {
    zh: "如果家门口能凭空多出一家小店，你希望是哪种店？",
    en: "If a new shop magically appeared near your front door, what kind would you want it to be?",
    es: "Si apareciera por arte de magia un negocio junto a tu casa, ¿de qué te gustaría que fuera?",
  },
  {
    zh: "到一个新地方，你会先四处看看，还是先低头看地图？",
    en: "In a new place, do you look around first or look down at the map?",
    es: "Al llegar a un lugar nuevo, ¿miras a tu alrededor primero o bajas la vista al mapa?",
  },
  {
    zh: "TA 说话时，哪个表情你一眼就看得懂？",
    en: "What facial expression of your partner’s can you read right away?",
    es: "¿Qué expresión de tu pareja sabes interpretar al instante?",
  },
  {
    zh: "你愿意和 TA 在阳台上看日出，还是在路边摊吃宵夜？",
    en: "Would you rather watch the sunrise with your partner or eat at a street stall late at night?",
    es: "¿Preferirías ver el amanecer con tu pareja o comer algo de madrugada en un puesto callejero?",
  },
  {
    zh: "如果给你们的家挑一种新颜色，你最想先刷哪里？",
    en: "If you picked a new paint color for your home, what would you paint first?",
    es: "Si eligieran un color nuevo para la casa, ¿qué pintarías primero?",
  },
  {
    zh: "哪件东西你出门前常常忘带，却一路都能想起来？",
    en: "What do you often forget to bring and keep remembering once you’re out?",
    es: "¿Qué se te suele olvidar al salir y luego recuerdas todo el camino?",
  },
  {
    zh: "哪样不起眼的东西，你能一本正经地给它拍个广告？",
    en: "What unremarkable thing could you make a completely serious commercial for?",
    es: "¿Para qué cosa sin importancia podrías hacer un anuncio totalmente serio?",
  },
  {
    zh: "忙的时候，哪一种休息方式十分钟就能让你缓过来？",
    en: "What kind of ten-minute break helps you reset on a busy day?",
    es: "¿Qué tipo de pausa de diez minutos te ayuda a recargar pilas en un día ocupado?",
  },
  {
    zh: "哪次你本来随口一提，后来两个人真的把它做成了？",
    en: "What did you mention in passing that the two of you actually ended up doing?",
    es: "¿Qué idea comentaste al pasar y luego acabaron haciendo juntos?",
  },
  {
    zh: "你愿意只靠手势和 TA 沟通一小时，还是只用歌词？",
    en: "Would you rather communicate with your partner for an hour using only gestures or only song lyrics?",
    es: "¿Preferirías comunicarte con tu pareja una hora solo con gestos o solo con letras de canciones?",
  },
  {
    zh: "假如桌上有台时光收音机，你会调到哪一年的电台？",
    en: "If a time-travel radio were on the table, which year would you tune into?",
    es: "Si hubiera una radio que viajara en el tiempo sobre la mesa, ¿qué año sintonizarías?",
  },
  {
    zh: "你身上哪一处小细节，会让 TA 一眼认出是你？",
    en: "What little detail would let your partner recognize you at a glance?",
    es: "¿Qué pequeño detalle permitiría a tu pareja reconocerte de un vistazo?",
  },
  {
    zh: "你最喜欢哪一种「终于弄好了」的感觉？",
    en: "What little task is most satisfying to finally finish?",
    es: "¿Qué tarea pequeña te da más gusto terminar por fin?",
  },
  {
    zh: "你会给五岁的自己留一个什么周末任务？",
    en: "What weekend mission would you give your five-year-old self?",
    es: "¿Qué misión de fin de semana le darías a tu yo de cinco años?",
  },
  {
    zh: "不能用菜单上的话，猜猜 TA 会怎么夸最喜欢的那道菜？",
    en: "Without borrowing menu words, how do you think your partner would describe their favorite dish?",
    es: "Sin usar palabras del menú, ¿cómo crees que describiría tu pareja su plato favorito?",
  },
  {
    zh: "如果让你决定电影该在哪儿看，你会选床上、影院，还是露天？",
    en: "If it were your call, would you watch a movie in bed, at the cinema, or outdoors?",
    es: "Si dependiera de ti, ¿verías una película en la cama, en el cine o al aire libre?",
  },
  {
    zh: "TA 为你做过的哪件事，你最想用同样的方式回报？",
    en: "What has your partner done for you that you’d love to do for them in return?",
    es: "¿Qué ha hecho tu pareja por ti que te gustaría repetir para devolverle el gesto?",
  },
  {
    zh: "你坐过的哪一种交通工具最像是在冒险？",
    en: "What kind of transportation have you tried that felt most like an adventure?",
    es: "¿Qué medio de transporte has probado que te hizo sentir que estabas de aventura?",
  },
  {
    zh: "如果你们每天只能留一个软件图标在主屏，你会留哪个？",
    en: "If you could keep only one app icon on your home screen, which would you keep?",
    es: "Si solo pudieras dejar un icono en la pantalla de inicio, ¿cuál conservarías?",
  },
  {
    zh: "你会用哪三种东西，给 TA 搭一个特别舒服的角落？",
    en: "Which three things would you use to make an especially cozy corner for your partner?",
    es: "¿Qué tres cosas usarías para crear un rincón especialmente cómodo para tu pareja?",
  },
  {
    zh: "有没有一样你小时候嫌不好吃，后来反而爱上的东西？",
    en: "What food did you dislike as a kid and come to love later?",
    es: "¿Qué comida no te gustaba de peque y acabó encantándote?",
  },
  {
    zh: "一起做拼图，你会先找边角，还是先拼最显眼的一块？",
    en: "Doing a puzzle together, would you start with the edges or the piece that stands out most?",
    es: "Al armar un rompecabezas juntos, ¿empezarías por los bordes o por la pieza que más destaca?",
  },
  {
    zh: "你觉得哪张合照拍下来的前一秒，比照片本身还有趣？",
    en: "Which photo of you together has a story from right before the shutter clicked?",
    es: "¿Qué foto de los dos tiene una historia de justo antes de hacerla?",
  },
  {
    zh: "你觉得 TA 会坚持读完一本不喜欢的书，还是看几页就放下？",
    en: "Would your partner finish a book they didn’t like or put it down after a few pages?",
    es: "¿Crees que tu pareja acabaría un libro que no le gusta o lo dejaría tras unas páginas?",
  },
  {
    zh: "如果今天能从待办里划掉一件事，你最想划掉哪件？",
    en: "If you could cross one thing off your to-do list today, what would it be?",
    es: "Si hoy pudieras tachar una cosa de tu lista de pendientes, ¿cuál sería?",
  },
  {
    zh: "你们出门时分头买个一样的东西，要买什么最容易选中同款？",
    en: "If you went shopping separately, what could you buy and most likely pick the exact same one?",
    es: "Si compraran por separado, ¿qué cosa tendría más probabilidades de que eligieran exactamente la misma?",
  },
  {
    zh: "如果你和 TA 能搬走一个房间，原样放进未来的家，你会选哪间？",
    en: "If you could move one room as it is into your future home together, which would you choose?",
    es: "Si pudieras trasladar una habitación tal como está a su futura casa juntos, ¿cuál elegirías?",
  },
  {
    zh: "哪件小东西要是能变成十倍大，你觉得会特别好玩？",
    en: "What little object would be especially fun if it were ten times bigger?",
    es: "¿Qué objeto pequeño sería muy divertido si tuviera diez veces su tamaño?",
  },
  {
    zh: "你觉得 TA 看到雨要下了，会找屋檐躲着，还是趁没下大赶路？",
    en: "When rain is about to start, would your partner take shelter or hurry on before it gets heavy?",
    es: "Si está a punto de llover, ¿tu pareja buscaría refugio o se apuraría antes de que arrecie?",
  },
  {
    zh: "你是哪一天发现，原来 TA 还有一项你不知道的本领？",
    en: "When did you discover that your partner could do something you hadn’t known about?",
    es: "¿Cuándo descubriste que tu pareja sabía hacer algo que no esperabas?",
  },
  {
    zh: "如果你们各花同样的钱，给自己买件小礼物，你会买什么？",
    en: "If you had the same amount to spend on a little gift for yourselves, what would you buy?",
    es: "Si tuvieran el mismo presupuesto para darse un pequeño gusto, ¿qué te comprarías?",
  },
  {
    zh: "在哪个地方，你们可以各走一小段路，再聊聊看到的东西？",
    en: "Where could you each take a little walk and then compare what you saw?",
    es: "¿Dónde podría cada quien dar un paseo corto y luego contarse qué vio?",
  },
  {
    zh: "如果 TA 突然跟着音乐哼起来，最可能哼哪一首？",
    en: "What song would your partner be most likely to start humming along to?",
    es: "¿Con qué canción es más probable que tu pareja se ponga a tararear?",
  },
  {
    zh: "你最近做成的哪件不起眼的小事，回头想想还挺满意？",
    en: "What little thing you did recently are you quietly pleased with?",
    es: "¿Qué cosita que hiciste hace poco te da gusto recordar?",
  },
  {
    zh: "你能给最近一次一起迷路或走错路的经历，起个什么标题？",
    en: "What title would you give the last time you took a wrong turn together?",
    es: "¿Qué título le pondrías a la última vez que se desviaron por error?",
  },
  {
    zh: "如果给陌生人留一句只有好心情、没有大道理的话，你会留什么？",
    en: "What cheerful little note would you leave for a stranger?",
    es: "¿Qué mensajito alegre le dejarías a alguien que no conoces?",
  },
  {
    zh: "和 TA 相处时，什么事最容易让你忘记看时间？",
    en: "What are you doing with your partner when you’re most likely to lose track of time?",
    es: "¿Qué haces con tu pareja cuando más fácilmente pierdes la noción del tiempo?",
  },
  {
    zh: "你会给哪一件眼前的东西补一张有趣的说明书？",
    en: "Which thing in front of you would you write a funny instruction manual for?",
    es: "¿Para cuál de las cosas que tienes delante escribirías un manual de instrucciones gracioso?",
  },
  {
    zh: "TA 做决定时有什么小动作，让你一下就知道 TA 在认真想？",
    en: "What little thing does your partner do when you can tell they’re really thinking a decision through?",
    es: "¿Qué pequeño gesto hace tu pareja que te indica que se está pensando bien una decisión?",
  },
  {
    zh: "以前不敢用、现在很喜欢的颜色，你有哪一种？",
    en: "What color did you used to shy away from but love now?",
    es: "¿Qué color antes no te atrevías a usar y ahora te encanta?",
  },
  {
    zh: "如果挑一件自己的小东西让 TA 带一天，你会选哪件？",
    en: "If your partner could carry one little thing of yours for a day, what would you choose?",
    es: "Si tu pareja llevara consigo un objeto pequeño tuyo durante un día, ¿cuál elegirías?",
  },
  {
    zh: "哪一句简短的消息，TA 发给你时最容易让你放松下来？",
    en: "What short message from your partner helps you relax right away?",
    es: "¿Qué mensaje corto de tu pareja te hace relajarte enseguida?",
  },
  {
    zh: "你们如果用积木拼一个必须能站稳的奇怪东西，你想拼什么？",
    en: "If you built something weird with blocks and it had to stand up on its own, what would you make?",
    es: "Si construyeran algo raro con bloques y tuviera que sostenerse solo, ¿qué harían?",
  },
  {
    zh: "你会给 TA 哪个半小时都讲不完的话题，开一集播客？",
    en: "What topic could your partner talk about for over half an hour that deserves a podcast episode?",
    es: "¿De qué tema podría hablar tu pareja más de media hora y merece un episodio de pódcast?",
  },
  {
    zh: "有哪件事你以前觉得没什么意思，后来被 TA 带着喜欢上了？",
    en: "What didn’t you get the appeal of until your partner got you into it?",
    es: "¿Qué cosa no te llamaba la atención hasta que empezaste a compartirla con tu pareja?",
  },
  {
    zh: "要用手边的东西给 TA 做一个五分钟的小谜题，你想藏什么线索？",
    en: "If you made your partner a five-minute riddle with things nearby, what clue would you hide?",
    es: "Si hicieras un acertijo de cinco minutos para tu pareja con lo que tienes a mano, ¿qué pista esconderías?",
  },
  {
    zh: "今天能和 TA 交换一个自己看见、对方没看见的瞬间，你会分享哪一个？",
    en: "What moment from today would you share with your partner that they weren’t there to see?",
    es: "¿Qué momento de hoy compartirías con tu pareja que no pudo ver en persona?",
  },
  ...dailyQuestionTopicsA,
  ...dailyQuestionTopicsB,
];
