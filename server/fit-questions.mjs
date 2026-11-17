const tr = (zh, en, es) => ({ zh, en, es });
const option = (id, text, meaning) => ({ id, text: tr(...text), meaning: tr(...meaning) });
const question = (id, text, followup, rows) => ({ id, text: tr(...text), followup: tr(...followup), options: rows.map((row, index) => option(String(index), row[0], row[1])) });

// Options describe plausible choices in a specific situation. They never rank people.
// The first situation in each module is the six-question introduction.
export const fitModules = [
  {
    id: "personality", title: tr("性格与生活节奏", "Personality & pace", "Personalidad y ritmo"),
    description: tr("遇到新鲜事和空闲时间，你怎样进入状态？", "How you approach new experiences and free time.", "Cómo te acercas a lo nuevo y al tiempo libre."),
    questions: [
      question("v2-personality-weekend", ["周六只剩两个钟头，五点得回家。你先把哪件事排进去？", "You have two hours together before you need to be home at five. What goes in first?", "Tienen dos horas antes de volver a casa a las cinco. ¿Qué metes primero en el plan?"],
        ["哪一种安排取消了，你会最舍不得？", "Which part would you most miss if it got cut?", "Si hubiera que quitar algo, ¿qué echarías más de menos?"], [
          [["去我收藏很久的那家店，路上就要半小时", "Visit the café I've saved for ages, even with the half-hour trip", "Ir al café que llevo tiempo queriendo probar, aunque quede a media hora"], ["兑现自己期待已久的安排", "a long-awaited personal plan", "un plan personal esperado"]],
          [["在附近转转，把时间花在街上", "Wander nearby and spend the time exploring", "Quedarme cerca y pasar el rato callejeando"], ["留出临场发现的空间", "room for discovery", "espacio para descubrir"]],
          [["跟 TA 去看那场我本来不会选的展", "Join my partner at the exhibit I wouldn't pick myself", "Ir con mi pareja a esa exposición que yo no elegiría"], ["试一次对方喜欢的安排", "trying their choice", "probar lo que eligió tu pareja"]],
          [["先各忙一小时，剩下的一起吃点东西", "Take an hour each for ourselves and meet for a bite", "Guardarnos una hora para cada quien y después comer algo"], ["保留个人时间", "time of your own", "tiempo propio"]],
        ]),
      question("v2-personality-new-place", ["第一次一起逛夜市，只来得及排一个摊。你往哪边走？", "First night market together. There's time for one line. Where do you head?", "Primera visita juntos al mercado nocturno. Solo da tiempo a hacer una fila. ¿Adónde vas?"],
        ["排到一半才发现隔壁更好，你还会留下吗？", "Halfway through the line, something better catches your eye. Would you stay?", "A mitad de la fila ves algo más tentador. ¿Te quedarías?"], [
          [["去我查过菜单的那家", "The stall whose menu I checked", "Al puesto cuyo menú ya miré"], ["行前做过的准备", "the research you did", "la preparación previa"]],
          [["去香味最吸引我的那家，卖什么到了再看", "Follow the best smell and see what they sell", "Seguir el olor que me gusta y ver qué venden"], ["跟随当下的好奇", "following your curiosity", "seguir tu curiosidad"]],
          [["跟着 TA 走，今晚尝尝 TA 的口味", "Follow my partner and try their taste tonight", "Seguir a mi pareja y probar lo que le gusta"], ["体验对方的口味", "experiencing their taste", "conocer sus gustos"]],
          [["各买一样，约在门口碰头", "Split up for food and meet at the entrance", "Comprar por separado y vernos en la entrada"], ["各自挑到想吃的东西", "each getting what you want", "que cada quien elija lo suyo"]],
        ]),
      question("v2-personality-change", ["快到影院才发现停映了。下一班回家的车二十分钟后到，你先做什么？", "The screening is cancelled. The next bus home is in twenty minutes. What's your first move?", "Cancelaron la función. El autobús a casa pasa en veinte minutos. ¿Qué haces primero?"],
        ["原计划里，你最想留下的究竟是哪一部分？", "Which part of the original plan did you most want to keep?", "¿Qué parte del plan original querías conservar?"], [
          [["查另一家影院，晚点回也行", "Check another cinema, even if we get home late", "Buscar otro cine aunque volvamos tarde"], ["保住原来的活动", "keeping the original activity", "mantener la actividad"]],
          [["拐进旁边有空桌的小馆", "Grab the empty table at the place next door", "Entrar al local de al lado que tiene mesa"], ["就地找到替代体验", "finding something nearby", "encontrar otra experiencia cerca"]],
          [["问 TA 本来最期待的是电影还是出门", "Ask whether they were looking forward to the film or the outing", "Preguntar si le hacía más ilusión la película o salir"], ["弄清对方看重的部分", "finding out what mattered to them", "averiguar qué le importaba a tu pareja"]],
          [["去车站，把今晚剩下的时间留出来", "Head for the bus and keep the rest of the night open", "Ir a la parada y dejar libre el resto de la noche"], ["把时间重新留给自己", "reclaiming your time", "recuperar tu tiempo"]],
        ]),
    ],
  },
  {
    id: "closeness", title: tr("亲密与安全感", "Closeness & reassurance", "Cercanía y seguridad"),
    description: tr("联系的频率、独处和安心感。", "Contact, personal space, and what helps you feel secure.", "Contacto, espacio propio y lo que te da tranquilidad."),
    questions: [
      question("v2-closeness-busy", ["午休只剩十分钟。TA 发来「今天有点烦」，你下午要连着开会。你拿起手机会怎么回？", "Ten minutes left at lunch. Your partner texts “Rough day.” You have meetings all afternoon. What do you send?", "Quedan diez minutos de descanso. Tu pareja escribe «Qué día». Tienes reuniones toda la tarde. ¿Qué le mandas?"],
        ["如果换成你发出那条消息，你会怎样理解 TA 的第一句回复？", "If you had sent that first text, how would you read their reply?", "Si tú hubieras enviado el primer mensaje, ¿cómo interpretarías la respuesta?"], [
          [["拨过去，聊到这十分钟用完", "Call and use the ten minutes to talk", "Llamar y dedicar esos diez minutos a hablar"], ["现在听到对方的声音", "hearing their voice now", "escuchar su voz ahora"]],
          [["发一段语音，让 TA 想说的时候回", "Send a voice note they can answer whenever they like", "Mandar un audio que pueda contestar cuando quiera"], ["给彼此错开回应的余地", "room to respond at different times", "espacio para responder en distintos momentos"]],
          [["约好晚饭后打电话，把午休留给自己", "Set a time to call after dinner and keep my break", "Quedar en llamar después de cenar y guardar mi descanso"], ["保住午休，也把长聊落实到晚饭后", "keeping your break and setting aside time later", "conservar el descanso y reservar tiempo después"]],
          [["先问「发生什么了」，进会前能聊几句算几句", "Ask what happened and text until the meeting starts", "Preguntar qué pasó y escribir hasta que empiece la reunión"], ["先弄清发生了什么", "finding out what happened first", "entender primero qué pasó"]],
        ]),
      question("v2-closeness-reunion", ["分开几天后终于见到面。行李还没拆，半小时后有人来取东西。这半小时怎么用？", "You're back together after days apart. Bags still packed, someone is coming by in half an hour. How do you spend it?", "Vuelven a verse tras varios días. Las maletas siguen cerradas y en media hora viene una visita breve. ¿Qué haces mientras?"],
        ["刚见面的头十分钟，对你来说怎样才算重新接上了？", "What makes the first ten minutes feel like a reunion to you?", "¿Qué te hace sentir el reencuentro en esos primeros diez minutos?"], [
          [["坐下来，把这几天的事先讲一件", "Sit down and tell one story from the trip", "Sentarme a contar una cosa de estos días"], ["交换分开时的经历", "sharing what happened while apart", "compartir las vivencias de esos días"]],
          [["一起拆行李，边收边聊", "Unpack together and talk as we go", "Deshacer las maletas juntos mientras hablamos"], ["一边做事一边重新熟悉", "reconnecting through a shared task", "reencontrarse haciendo algo juntos"]],
          [["靠着 TA 歇一会儿，等人走了再聊", "Lean against them and save the stories for later", "Recostarme a su lado y dejar las historias para después"], ["安静地待在彼此身边", "quiet physical closeness", "la cercanía tranquila"]],
          [["先冲个澡，出来再好好打招呼", "Shower first, then give them my full attention", "Ducharme primero y después dedicarle toda mi atención"], ["先恢复自己的状态", "settling back in first", "recuperar primero tu propio ritmo"]],
        ]),
      question("v2-closeness-reach", ["刚被临时改了排班，你憋了一肚子话。TA 再过十分钟就要进会，到晚饭后才有空。你打开聊天框，先做什么？", "Your shift just got changed and you need to vent. Your partner has ten minutes before meetings and is free after dinner. What do you do first?", "Te acaban de cambiar el turno y necesitas desahogarte. A tu pareja le quedan diez minutos antes de entrar a reuniones y tendrá tiempo después de cenar. ¿Qué haces primero?"],
        ["这样的时刻，你想有人马上回应，还是更想把话说完整？", "In that moment, what matters more: being heard right away or telling the whole story?", "En ese momento, ¿te pesa más que te escuchen enseguida o poder contar toda la historia?"], [
          [["写一句「晚饭后陪我走走？」把过程留到晚上", "Ask for a walk after dinner and save the story for then", "Proponer un paseo después de cenar y guardar la historia para entonces"], ["留一段完整的倾诉时间", "an uninterrupted conversation later", "reservar una conversación sin prisas"]],
          [["直接打过去，只讲最让我生气的那件事", "Call now and tell just the part that upset me most", "Llamar ya y contar solo lo que más me enfadó"], ["当下听到熟悉的声音", "hearing a familiar voice now", "oír una voz conocida ahora"]],
          [["发两句文字，看 TA 进会前来不来得及回", "Text two lines and see if there's time for a reply", "Escribir dos líneas y ver si le da tiempo a contestar"], ["用短消息尽快接上话", "starting a quick exchange by text", "iniciar un intercambio breve por mensaje"]],
          [["录下整段经过，告诉 TA 有空再听", "Record the whole story for them to hear when free", "Grabar toda la historia para que la escuche cuando pueda"], ["趁记忆鲜明把事情讲完整", "telling the whole story while it is fresh", "contar toda la historia mientras está fresca"]],
        ]),
    ],
  },
  {
    id: "care", title: tr("表达爱与被照顾", "Giving & receiving care", "Dar y recibir cariño"),
    description: tr("哪些日常小事让你感到被放在心上？", "The small things that help you feel cared for.", "Los pequeños gestos que te hacen sentir querido."),
    questions: [
      question("v2-care-long-day", ["你和 TA 都刚下班，冰箱里只够做一道菜。谁都没做饭，你先动哪一样？", "You're both off work. There's enough food for one dish and nothing is cooked. What do you reach for first?", "Acaban de salir del trabajo. Hay ingredientes para un solo plato y nada preparado. ¿Qué tomas primero?"],
        ["那晚最稀缺的是钱、力气，还是一起坐下来的时间？", "What was in shortest supply that night: money, energy or time together?", "Esa noche, ¿qué escaseaba más: dinero, energía o tiempo juntos?"], [
          [["拿锅做熟悉的菜，口味按我的来", "A pan for my usual dish, seasoned my way", "La sartén para hacer mi plato de siempre a mi gusto"], ["尽快吃上一道自己拿手的菜", "making something familiar quickly", "preparar pronto algo que conoces"]],
          [["拿外卖菜单，花点钱换两个人休息", "A delivery menu to buy us both a break", "El menú a domicilio para comprarnos un descanso"], ["用钱换回休息", "buying time to rest", "pagar para descansar"]],
          [["拿两块砧板，一起做，慢一点也行", "Two boards so we can cook together, even if it takes longer", "Dos tablas para cocinar juntos aunque tardemos más"], ["把做饭变成相处时间", "making cooking time together", "pasar tiempo juntos al cocinar"]],
          [["拿点面包垫肚子，等两个人缓过来再弄", "Bread to tide us over until we've both unwound", "Pan para picar mientras recuperamos las fuerzas"], ["先把晚饭的压力放一放", "taking pressure off dinner", "quitar presión a la cena"]],
        ]),
      question("v2-care-good-news", ["TA 刚拿到一个盼了很久的好消息，你还有半小时就要交东西。你先做什么？", "Your partner got news they've waited ages for. Your deadline is in half an hour. What's your first move?", "Tu pareja por fin recibe una buena noticia. Tienes una entrega en media hora. ¿Qué haces primero?"],
        ["好消息刚发生时那几分钟，对你们各自有多重要？", "How much do those first few minutes matter to each of you?", "¿Cuánto importan esos primeros minutos para cada uno?"], [
          [["停五分钟听 TA 讲现场，之后赶工", "Pause for five minutes to hear the story, then catch up on work", "Parar cinco minutos para escuchar y después recuperar el tiempo"], ["赶在兴奋还鲜活时听 TA 讲", "hearing the news while it's fresh", "escuchar la noticia en caliente"]],
          [["发句只有我们懂的庆祝暗号，接着忙", "Send our inside joke to celebrate and keep working", "Mandar nuestra broma de celebración y seguir trabajando"], ["用熟悉的玩笑及时回应", "responding with shared humour", "responder con humor compartido"]],
          [["订好今晚的甜点，细节等见面再听", "Order dessert for tonight and hear the details in person", "Pedir un postre para esta noche y escuchar los detalles en persona"], ["把庆祝留到见面", "celebrating in person", "celebrar en persona"]],
          [["请 TA 把过程录下来，我交完就听", "Ask them to record the story for me to hear after the deadline", "Pedirle que grabe la historia para oírla al terminar"], ["保留当时的声音、稍后再听", "saving their voice for later", "guardar su voz para después"]],
        ]),
      question("v2-care-give", ["TA 明早很早出门，你今晚也累。睡前还有五分钟，你会用在哪里？", "Your partner leaves early tomorrow and you're tired too. Where do your last five minutes go?", "Tu pareja sale temprano mañana y tú también tienes sueño. ¿En qué usas los últimos cinco minutos?"],
        ["如果 TA 根本没注意到你做的事，你还会选同一个吗？", "Would you choose the same thing if they never noticed?", "Si tu pareja ni siquiera lo notara, ¿elegirías lo mismo?"], [
          [["把咖啡机装好，明早少一道工序", "Set up the coffee so there's one less job tomorrow", "Dejar preparada la cafetera para ahorrar un paso mañana"], ["让明早少忙一步", "one less task tomorrow", "ahorrar una tarea mañana"]],
          [["陪 TA 坐一会儿，东西留到明早", "Sit with them for a bit and leave the packing for morning", "Sentarme un rato a su lado y dejar las cosas para mañana"], ["睡前有一小段陪伴", "a little company before bed", "un rato de compañía antes de dormir"]],
          [["关灯一起睡，把五分钟还给睡眠", "Turn out the lights and give those minutes back to sleep", "Apagar la luz y ganar esos minutos de sueño"], ["多留一点睡眠", "a little more sleep", "unos minutos más de sueño"]],
          [["写张纸条塞进 TA 的包里", "Slip a handwritten note into their bag", "Meter una nota en su bolso"], ["给明天留一份意外的小惊喜", "a small surprise tomorrow", "una pequeña sorpresa mañana"]],
        ]),
    ],
  },
  {
    id: "conflict", title: tr("分歧与修复", "Disagreement & repair", "Desacuerdos y reparación"),
    description: tr("有了分歧，你需要怎样的节奏才能重新靠近？", "What helps you reconnect after a disagreement.", "Qué te ayuda a reconectar después de un desacuerdo."),
    questions: [
      question("v2-conflict-first", ["出门前两个人为一件小事争了几句，车已经到楼下。你上车后的第一步是？", "You traded sharp words on the way out. The ride is here. What's your first move in the car?", "Discutieron justo antes de salir. Ya llegó el coche. ¿Qué haces al subir?"],
        ["车上的沉默对你是缓冲，对 TA 又可能是什么？", "What does a quiet car ride mean to each of you after an argument?", "¿Qué significa para cada uno el silencio en el coche después de discutir?"], [
          [["发条文字说刚才卡在哪，车上不用开口", "Text the point that bothered me so we don't have to talk in the car", "Escribir qué me molestó para no hablar en el coche"], ["用文字讲准确", "precision in writing", "expresarte por escrito con precisión"]],
          [["先看窗外，到地方再提", "Look out of the window and come back to it when we arrive", "Mirar por la ventana y retomarlo al llegar"], ["等换个环境再开口", "changing surroundings before talking", "cambiar de entorno antes de hablar"]],
          [["轻轻碰碰 TA 的手，事情稍后说", "Touch their hand and leave the conversation for later", "Rozarle la mano y dejar la conversación para después"], ["先用动作重新靠近", "reconnecting through touch", "acercarte con un gesto"]],
          [["趁记得原话，小声问清刚才那一句", "Quietly ask about that one phrase while it's fresh", "Preguntar en voz baja por esa frase mientras la recuerdo"], ["趁记忆清楚时核对原意", "clarifying while the words are fresh", "aclarar las palabras mientras las recuerdas"]],
        ]),
      question("v2-conflict-repair", ["昨晚吵完谁也没再开口。第二天厨房里只有你们俩，你先说哪句话？", "Neither of you spoke after last night's argument. You're alone in the kitchen. What do you say first?", "Anoche discutieron y dejaron de hablar. Ahora están solos en la cocina. ¿Qué dices primero?"],
        ["哪一句会让你愿意继续说，哪一句你还接不住？", "Which opening feels easy to answer, and which would need more time?", "¿A qué frase te resultaría fácil responder y para cuál necesitarías tiempo?"], [
          [["「要咖啡吗？」先一起做件平常事", "“Coffee?” Start with something familiar", "«¿Café?» Empezar por algo cotidiano"], ["用日常小事恢复接触", "reconnecting through routine", "retomar el contacto con algo cotidiano"]],
          [["「昨晚那句我还在想。」把话题重新打开", "“I'm still thinking about what was said.” Reopen it now", "«Sigo pensando en lo de anoche». Retomar el tema ahora"], ["把未解决的事情带回讨论", "reopening the unresolved issue", "retomar el asunto pendiente"]],
          [["「今晚散步时说行吗？」先定时间", "“Could we talk on our walk tonight?” Set a time", "«¿Lo hablamos en el paseo de esta noche?» Fijar un momento"], ["给对话一个确定的时间", "setting a time to talk", "fijar un momento para hablar"]],
          [["「我现在有点紧张。」先说自己此刻的状态", "“I'm nervous right now.” Start with how I feel", "«Ahora estoy algo nervioso». Empezar por cómo me siento"], ["让对方先知道自己的感受", "letting them know how you feel", "dar a conocer cómo te sientes"]],
        ]),
      question("v2-conflict-repeat", ["又一次到了约好的时间，TA 还要二十分钟。电影已经开场，你在门口怎么做？", "Your partner is twenty minutes away again. The film has started. What do you do at the door?", "Otra vez tu pareja tarda veinte minutos más. La película ya empezó. ¿Qué haces en la puerta?"],
        ["下次再迟到，怎样安排才不需要一个人一直等？", "What arrangement would keep one person from always waiting next time?", "¿Qué acuerdo evitaría que siempre espere la misma persona?"], [
          [["先进场，给 TA 留好座位号", "Go in and text them the seat number", "Entrar y mandarle el número de asiento"], ["保住自己想看的开头", "seeing the beginning", "ver el principio"]],
          [["在门口等，一起进去少看一段", "Wait and miss the opening together", "Esperar y perderme el principio para entrar juntos"], ["一起进场的体验", "starting the experience together", "entrar juntos"]],
          [["问能不能换下一场，晚饭随之推迟", "Ask about the next screening, even if dinner moves later", "Preguntar por la siguiente sesión aunque se retrase la cena"], ["调整后续安排以看完整场", "rearranging the evening for the whole film", "reorganizar la noche para ver la película entera"]],
          [["把票留给 TA，自己去附近做另一件事", "Leave them the ticket and do something else nearby", "Dejarle la entrada y hacer otra cosa cerca"], ["按自己的节奏重新安排当下", "using the time independently", "usar el tiempo por tu cuenta"]],
        ]),
    ],
  },
  {
    id: "boundaries", title: tr("边界与自主", "Boundaries & independence", "Límites y autonomía"),
    description: tr("朋友、独处和共同决定怎样相处舒服？", "Friends, personal time, and decisions you share.", "Amistades, tiempo propio y decisiones compartidas."),
    questions: [
      question("v2-boundaries-friends", ["周五晚上你本想在家歇着，朋友临时叫你出门，TA 以为你俩会一起吃饭。你先回哪边？", "You planned to rest on Friday. Friends invite you out and your partner expects dinner together. What do you reply first?", "Pensabas descansar el viernes. Tus amigos te invitan a salir y tu pareja cuenta con cenar juntos. ¿Qué contestas primero?"],
        ["你会把「没明确约过」的晚上算作谁的时间？", "Whose time do you assume an evening is when there's no explicit plan?", "¿De quién es una noche cuando nadie hizo un plan explícito?"], [
          [["回朋友晚点到，先在家吃完饭", "Tell my friends I'll join late, after dinner at home", "Decir a mis amigos que llegaré después de cenar en casa"], ["兑现对晚饭的默契", "keeping the dinner expectation", "respetar la expectativa de cenar juntos"]],
          [["问 TA 要不要一起去，今晚换个地方吃", "Ask my partner to join and eat somewhere else tonight", "Preguntar a mi pareja si se viene a cenar fuera"], ["让伴侣加入朋友圈的安排", "bringing your partner into the outing", "incluir a tu pareja en la salida"]],
          [["告诉 TA 我想赴约，另挑一晚一起吃", "Tell my partner I'd like to go and pick another dinner night", "Decirle a mi pareja que quiero ir y buscar otra noche para cenar"], ["抓住这一次朋友的邀约", "taking this particular invitation", "aprovechar esta invitación"]],
          [["推掉聚会，跟 TA 说今晚只想简单吃点就休息", "Pass on going out and ask for an easy dinner and early night", "Declinar la salida y proponer una cena sencilla para descansar"], ["保留原本想要的休息", "protecting the rest you wanted", "conservar el descanso que querías"]],
        ]),
      question("v2-boundaries-photo", ["你们都同意可以分享旅行照。朋友在群里催着看，你只有一分钟挑照片。你发什么？", "You both agreed that trip photos can be shared. Friends are asking in the group chat. You have a minute to choose. What do you send?", "Los dos aceptaron compartir fotos del viaje. El grupo pide verlas y tienes un minuto para elegir. ¿Qué envías?"],
        ["发一张照片时，你希望保留哪一部分决定权？", "Which part of choosing a photo do you want a say in?", "Al compartir una foto, ¿sobre qué parte quieres decidir?"], [
          [["挑一张风景照，人物照以后再选", "A landscape, leaving the portraits for later", "Un paisaje y dejar los retratos para después"], ["先分享地点，人物留待细选", "sharing the place first", "compartir primero el lugar"]],
          [["发我最喜欢的那张合照，即使背景很乱", "My favourite shot of us despite the messy background", "Mi foto favorita de los dos aunque el fondo sea un caos"], ["保留自己最喜欢的瞬间", "sharing your favourite moment", "compartir tu momento favorito"]],
          [["转发 TA 刚选作封面的那张", "The one my partner just chose as their cover photo", "La que mi pareja acaba de elegir como portada"], ["采用对方已经表达的偏好", "using their expressed preference", "recoger la preferencia que ya expresó tu pareja"]],
          [["先发一张我自己的，合照回去再挑", "One of myself now and a photo of us after we get home", "Una mía ahora y una de los dos cuando volvamos"], ["分别掌握各自照片的选择", "keeping individual photo choices separate", "mantener la elección individual de las fotos"]],
        ]),
      question("v2-boundaries-alone", ["家里只有一张舒服的书桌。你今晚想画画，TA 想在同一时段拼模型。你把画纸铺在哪？", "There's one comfortable desk. You want to draw tonight and your partner wants to build a model. Where do you put your paper?", "Solo hay una mesa cómoda. Quieres dibujar y tu pareja quiere montar una maqueta al mismo tiempo. ¿Dónde pones el papel?"],
        ["你更在意同时在场，还是有一块能自己决定的空间？", "What mattered here: sharing the moment or having space under your control?", "¿Qué pesaba más aquí: coincidir en el momento o disponer de tu propio espacio?"], [
          [["铺在书桌上，约个时间到点换人", "On the desk and set a time to swap", "En el escritorio y acordar una hora para cambiar"], ["把好位置分时使用", "taking turns in the good spot", "turnarse en el lugar más cómodo"]],
          [["挪到餐桌，今晚我可以用得久一点", "At the dining table so I can keep going longer", "En la mesa del comedor para poder seguir más tiempo"], ["换取不被打断的时间", "uninterrupted time", "tiempo sin interrupciones"]],
          [["只铺半张桌，两个人都得收一点工具", "On half the desk, with fewer tools for both of us", "En media mesa, con menos herramientas para ambos"], ["同时使用同一块空间", "using the space together", "usar el espacio juntos"]],
          [["先收着，改天留整晚用书桌", "Keep it rolled up and claim a whole evening another day", "Guardar el papel y reservar otra noche entera para mí"], ["集中使用一整晚", "having a full evening later", "disponer de una noche entera después"]],
        ]),
    ],
  },
  {
    id: "future", title: tr("金钱、家庭与未来", "Money, family & the future", "Dinero, familia y futuro"),
    description: tr("看看你们怎样做取舍，哪些事值得提前聊。", "How you make trade-offs and what deserves a conversation.", "Cómo toman decisiones y qué conviene conversar."),
    questions: [
      question("v2-future-money", ["你们原本打算下月旅行。你刚收到一笔自己的奖金，刚够升一晚房，也刚够你一直想报的课。你先把哪个选项放到桌上？", "You've earned a personal bonus before a trip. It covers one room upgrade or the class you've wanted. Which idea do you bring up first?", "Justo antes de un viaje recibes un bono personal. Alcanza para mejorar una noche de hotel o para ese curso que querías. ¿Qué propones primero?"],
        ["如果想报课的人换成 TA，你还会先提同一个方案吗？", "If it were your partner who wanted the class, would you propose the same thing?", "Si fuera tu pareja quien quisiera el curso, ¿propondrías lo mismo?"], [
          [["把那一晚换成我们喜欢的房间", "Upgrade the room for a night we get to share", "Mejorar la habitación para disfrutar esa noche juntos"], ["把额外的钱用在共同体验", "spending extra money on a shared experience", "usar el extra en una experiencia compartida"]],
          [["先报课，旅行按原预算走", "Book the class and keep the original trip budget", "Inscribirme en el curso y mantener el presupuesto del viaje"], ["为自己的学习机会买单", "funding your learning opportunity", "financiar tu aprendizaje"]],
          [["各分一半，想升级或上课的人自己补差额", "Split it equally and cover any extra individually", "Repartirlo por igual y que cada quien cubra la diferencia"], ["各自掌握相同的额度", "equal amounts to spend individually", "tener el mismo importe para cada quien"]],
          [["先留在账户里，旅行回来再定", "Leave it in the account until after the trip", "Dejarlo en la cuenta hasta después del viaje"], ["给之后的不确定开支留余地", "keeping a buffer for later", "guardar un margen para después"]],
        ]),
      question("v2-future-family", ["今年只有三天假，你父母和 TA 的家人分别住在两个方向。两边都去就有一天在路上。你先查哪种车票？", "You have three days off. Your families live in opposite directions. Visiting both costs a day in transit. Which tickets do you look up first?", "Tienen tres días libres y sus familias viven en direcciones opuestas. Ver a ambas cuesta un día de viaje. ¿Qué billetes buscas primero?"],
        ["上一次是谁跑了更远的路？这会改变你这次的选择吗？", "Who travelled further last time? Would that change your choice?", "¿Quién viajó más la última vez? ¿Cambiaría eso tu elección?"], [
          [["去我家的往返票，另找时间看 TA 家", "A return trip to my family, visiting theirs another time", "Ida y vuelta a mi casa y ver a su familia en otra fecha"], ["这次先留时间给自己的家人", "time with your family this visit", "tiempo con tu familia esta vez"]],
          [["去 TA 家的票，把我家的探望放到下次", "Tickets to their family, saving mine for next time", "Billetes para visitar a su familia y dejar la mía para otra vez"], ["这次先留时间给对方的家人", "time with their family this visit", "tiempo con su familia esta vez"]],
          [["各自回家的两张票，回来再见", "Separate trips to our families and reunite afterwards", "Dos billetes por separado para reunirnos a la vuelta"], ["各自拥有完整的探亲时间", "a full visit for each person", "una visita completa para cada quien"]],
          [["一条串起两家的路线，接受少玩一天", "A route through both homes, even with a day on the road", "Una ruta por las dos casas aunque perdamos un día en carretera"], ["让两家在同一次行程中见到你们", "seeing both families on the same trip", "ver a ambas familias en el mismo viaje"]],
        ]),
      question("v2-future-city", ["你拿到外地一个月的工作机会，答复期限是明早。晚饭后你只有半小时做准备。你先打开什么？", "You're offered a month of work away and owe an answer tomorrow morning. You have half an hour after dinner. What do you open first?", "Te ofrecen un mes de trabajo fuera y debes responder mañana. Tienes media hora después de cenar. ¿Qué abres primero?"],
        ["如果机会给的是对方，你会希望先知道哪一件事？", "If the offer went to your partner, what would you want to know first?", "Si la oferta fuera para tu pareja, ¿qué querrías saber primero?"], [
          [["工作说明，先弄清这一步对我值多少", "The job description to see what this means for me", "La descripción del puesto para ver qué me aporta"], ["先确认机会对个人发展的价值", "understanding the career opportunity", "entender el valor profesional de la oferta"]],
          [["两个人的日历，看看会错过哪些日子", "Our calendars to see what dates we'd miss", "Nuestros calendarios para ver qué fechas perderíamos"], ["先盘点两个人会错过的日子", "identifying the dates you'd miss together", "identificar las fechas que perderían juntos"]],
          [["住房和交通报价，算清实际代价", "Housing and travel prices to work out the cost", "Precios de vivienda y transporte para calcular el coste"], ["先看这个月到底负担得起什么", "working out what is affordable", "calcular qué pueden permitirse"]],
          [["打开和 TA 的对话，先听听对方最担心哪件事", "Our chat to hear their biggest concern first", "El chat con mi pareja para escuchar primero su mayor inquietud"], ["先听到对方具体的顾虑", "hearing their specific concern", "escuchar su inquietud concreta"]],
        ]),
    ],
  },
];

export const fitQuestions = fitModules.flatMap((module) => module.questions);
export const overviewQuestionIds = fitModules.map((module) => module.questions[0].id);
export const mbtiTypes = new Set(["ISTJ", "ISFJ", "INFJ", "INTJ", "ISTP", "ISFP", "INFP", "INTP", "ESTP", "ESFP", "ENFP", "ENTP", "ESTJ", "ESFJ", "ENFJ", "ENTJ"]);
export const zodiacNames = {
  aries: tr("白羊座", "Aries", "Aries"), taurus: tr("金牛座", "Taurus", "Tauro"),
  gemini: tr("双子座", "Gemini", "Géminis"), cancer: tr("巨蟹座", "Cancer", "Cáncer"),
  leo: tr("狮子座", "Leo", "Leo"), virgo: tr("处女座", "Virgo", "Virgo"),
  libra: tr("天秤座", "Libra", "Libra"), scorpio: tr("天蝎座", "Scorpio", "Escorpio"),
  sagittarius: tr("射手座", "Sagittarius", "Sagitario"), capricorn: tr("摩羯座", "Capricorn", "Capricornio"),
  aquarius: tr("水瓶座", "Aquarius", "Acuario"), pisces: tr("双鱼座", "Pisces", "Piscis"),
};

export function localizedFitModules(language) {
  return fitModules.map((module) => ({
    id: module.id, title: module.title[language], description: module.description[language],
    questions: module.questions.map((item) => ({ id: item.id, text: item.text[language], options: item.options.map((choice) => ({ id: choice.id, text: choice.text[language] })) })),
  }));
}
