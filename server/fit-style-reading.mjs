const words = (zh, en, es) => ({ zh, en, es });

const letters = {
  space: { a: "T", b: "S" },
  care: { a: "W", b: "A" },
  repair: { a: "R", b: "P" },
};

const meanings = {
  T: words("Together · 共处充电", "Together · Recharge in company", "Together · Recargar en compañía"),
  S: words("Solo · 独处充电", "Solo · Recharge alone", "Solo · Recargar a solas"),
  W: words("Words · 用语言示爱", "Words · Express care through words", "Words · Mostrar cariño con palabras"),
  A: words("Actions · 用行动示爱", "Actions · Express care through actions", "Actions · Mostrar cariño con hechos"),
  R: words("Reconnect · 分歧后尽早重谈", "Reconnect · Talk again soon", "Reconnect · Retomar pronto el diálogo"),
  P: words("Pause · 缓一缓再谈", "Pause · Take time before talking", "Pause · Hacer una pausa antes de hablar"),
};

const chapterTitles = [
  words("你带给这段关系的东西", "What you bring to the relationship", "Lo que aportas a la relación"),
  words("好意容易被误读的时候", "When your intentions get lost", "Cuando tu intención se malinterpreta"),
  words("两个人可以怎么配合", "How to meet each other halfway", "Cómo encontrar un punto de encuentro"),
];

// A partial portrait can explain a preference without assigning the other letters.
const partialReadings = {
  T: words("一起待着对你可能就有恢复精力的作用。下次很累却想见对方时，可以说「我今天话不多，能不能一起吃点东西？」这样对方既知道你想靠近，也知道你此刻还有多少力气。", "Quiet company may help you recharge. On a tiring day, try asking someone to share a meal even if you don't feel like talking. That lets them know both that you want them close and how much energy you have.", "La compañía tranquila puede ayudarte a recargar energía. En un día agotador, puedes proponer comer juntos aunque no tengas ganas de hablar. Así tu pareja sabe que quieres cercanía y cuánta energía tienes."),
  S: words("累的时候，独处往往能让你重新有精神。想留一个晚上给自己时，也可以告诉对方下一次想见面的时间。这样独处有了具体边界，对方也容易看见你依然期待下一次相聚。", "Time alone may help you recover. When you keep an evening for yourself, naming the next time you would like to meet gives that space a boundary and your partner something to look forward to.", "Pasar tiempo a solas puede ayudarte a recuperar energía. Al reservarte una noche, decir cuándo te gustaría volver a ver a tu pareja le da un límite a ese espacio y algo que esperar con ilusión."),
  W: words("你倾向于把惦记说出来。一句带着细节的感谢，例如「昨天你把电视声音调小，让我能把电话讲完，我有注意到」，能让对方知道你在乎的是哪一个瞬间。", "You tend to put affection into words. A specific thank-you, such as noticing that they turned down the TV during your call, tells your partner exactly which moment mattered to you.", "Sueles expresar cariño con palabras. Un agradecimiento concreto, como mencionar que tu pareja bajó el volumen de la tele durante tu llamada, le dice qué momento significó algo para ti."),
  A: words("你更容易用行动表达在乎。想帮忙的时候，可以先问对方眼下最需要什么。比如先问是想有人接回家，还是想回家时有点东西吃，同样一份心意就更可能落在对方最需要的地方。", "You often express affection through actions. Asking whether your partner would prefer a lift home or dinner waiting there can direct the same amount of effort toward what would help them most.", "A menudo expresas cariño con hechos. Preguntar si tu pareja prefiere que la recojas o que le guardes la cena puede dirigir el mismo esfuerzo hacia lo que ahora más le serviría."),
  R: words("分歧后早点接上话，对你可能很重要。可以把第一次开口变成约时间的邀请，例如「我想知道你怎么想，今天什么时候你有精神聊？」这样你们已经重新有了联系，也都还有准备的余地。", "It may matter to you to reconnect soon after a disagreement. An early invitation to choose a time can restore contact while giving both of you room to prepare for the conversation itself.", "Quizá te importe retomar pronto el contacto tras un desacuerdo. Proponer un momento para hablar permite acercarse de nuevo y deja a ambos tiempo para prepararse."),
  P: words("你倾向给自己一点时间整理情绪。如果想暂停，告诉对方你准备何时回来，并由你在那个时间重新开口。这样这一段安静既能帮你想清楚，也给对方一个可以期待的时刻。", "You often take time to gather your thoughts. When you ask for a pause, give a time when you'll return and start the conversation yourself when it arrives. Both people then know what the quiet is for.", "Sueles tomarte tiempo para ordenar las ideas. Al pedir una pausa, di cuándo volverás e inicia tú la conversación al llegar ese momento. Así ambos saben para qué sirve ese rato de silencio."),
};

const profiles = {
  TWR: [
    words(
      "和你相处，对方往往比较容易知道自己在你心里的位置。周末就算要各忙各的，你也可能先提一句「把电脑带过来吧，我想跟你待一会儿」。一句想念配上一个具体邀请，让原本普通的下午也有了两个人的意味。你主动把心里话说出来，也给对方留下接话的机会。",
      "A partner can often tell where they stand with you. Even on a working Saturday you might say, “Bring your laptop over. I’d like the company.” Turning a feeling into an invitation gives an ordinary afternoon a sense of intimacy. Saying what you feel also gives the other person something real to respond to.",
      "A tu pareja puede resultarle fácil saber qué lugar ocupa en tu vida. Hasta un sábado de trabajo podrías decirle «Trae el portátil, me gustaría tenerte cerca». Ponerle palabras a las ganas de verse convierte una tarde cualquiera en un momento compartido y le da algo concreto a lo que responder.",
    ),
    words(
      "争执后，你想尽早说清，常常是因为还想跟对方好好过这个晚上。对方如果仍在整理情绪，接连几条消息听起来却像在催一个结论。你可以留意自己想得到的究竟是什么。有时一句「我也想解决，等我缓过来」就足以让你安心，事情本身可以晚点再谈。",
      "After a disagreement, you might reach out early because you still want to enjoy the evening together. Several messages in a row can feel like a deadline to someone still sorting out their feelings. Consider what you need right now. Hearing “I want to work this out too” may give you enough reassurance to leave the issue for later.",
      "Después de una discusión quizá quieras hablar pronto para poder disfrutar de la noche juntos. A quien aún está ordenando sus emociones, varios mensajes seguidos pueden sonarle a ultimátum. Piensa qué necesitas en ese momento. A veces basta oír «Yo también quiero arreglarlo» para poder dejar la conversación para más tarde.",
    ),
    words(
      "下次意见不同时，可以把靠近和解决问题分成两步。先说「我在意刚才那句话，也想听你怎么想。你愿意现在说两句，还是饭后再聊？」然后把这一轮交给对方。愿意回应、也敢说自己需要多久的人，比较容易跟你找到节奏。",
      "Try giving contact and resolution their own moments. “What you said matters to me, and I want to hear your side. Is now a good time, or would after dinner be better?” Then give your partner the next turn. Someone who responds and can say how much time they need may find a comfortable rhythm with you.",
      "Prueba a distinguir entre retomar el contacto y resolver el asunto. «Me importa lo que dijiste y quiero entenderte. ¿Hablamos un momento ahora o después de cenar?» Luego cede la palabra. Alguien que responda y sepa decir cuánto tiempo necesita puede encontrar contigo un ritmo cómodo.",
    ),
  ],
  TWP: [
    words(
      "你能让平淡的陪伴变得有温度。比如两个人做了一晚各自的事，临睡前你会想告诉对方「今天没怎么聊天，可是你在旁边我很开心」。对方不用猜这个晚上过得好不好。你能把这种不容易留意的小感受讲出来，让一个普通晚上成了共同的记忆。",
      "You can give quiet company a sense of warmth. After an evening spent on different things you might say, “We hardly talked, but I loved having you here.” Your partner learns what the evening meant to you, and a small feeling that could have gone unnoticed becomes a shared memory.",
      "Sabes darle calidez a la compañía tranquila. Tras una noche en la que cada quien hizo sus cosas, quizá digas «Apenas hablamos, pero me encantó tenerte cerca». Tu pareja descubre qué significó para ti esa noche y una emoción que podía pasar inadvertida se vuelve un recuerdo compartido.",
    ),
    words(
      "你平时善于表达，一旦突然沉默，这个反差可能比沉默本身更让伴侣担心。明明还愿意一起待着，却暂时回答不了「你到底怎么想」，很容易让两个人都着急。给对方一个小提示，说明你还在乎这件事，可能比勉强给出一句定论更有用。",
      "Because you usually express yourself quite openly, going quiet can alarm a partner more than the silence itself. You may still want their company while having no answer yet to “What do you really think?” A small sign that the matter is still important can be more reassuring than trying to reach a conclusion on the spot.",
      "Como sueles expresarte abiertamente, el cambio repentino al silencio puede preocupar más que el propio silencio. Quizá aún quieras compañía sin saber responder a «¿Qué piensas de verdad?». Decir que el asunto te sigue importando puede tranquilizar más que intentar sacar una conclusión en ese instante.",
    ),
    words(
      "可以事先说好，想暂停谈话时，要不要继续一起吃饭、散步，或者先各待一会儿。比如「我想和你吃完这顿饭。刚才那件事，等我走一圈，九点回来再说」。等到了约定时间，由提出暂停的人重新开口，你需要的安静就有了双方都看得见的尽头。",
      "Agree on what to do during a pause. Would you both like to finish dinner, take a walk together, or have a little space? Try “I’d like to finish dinner with you. Let me take a walk afterward and come back to this at nine.” Returning at the agreed time makes the pause easier for both of you to trust.",
      "Acuerden qué hacer durante la pausa. ¿Terminar de cenar juntos, pasear o pasar un rato a solas? «Me gustaría acabar de cenar contigo. Después daré una vuelta y a las nueve retomamos lo de antes». Si quien pide la pausa vuelve a la hora acordada, ambos pueden confiar en ese tiempo de calma.",
    ),
  ],
  TAR: [
    words(
      "你很容易把「我们一起」变成一件能动手做的事。比如搬家那天，等电梯的工夫你已经顺手把钥匙串好，腾出一只手接对方的箱子。这样的配合会让伴侣感到，两个人遇事真的有人一起扛。等忙完后，你也愿意坐下来把有分歧的地方讲清楚。",
      "You readily turn togetherness into something practical. On moving day you might sort the keys while waiting for the lift, then take a box from your partner. That kind of coordination can make them feel they have real help. Once the work is done, you’re often ready to sit down and talk through any friction.",
      "Conviertes con facilidad la compañía en algo práctico. En una mudanza quizá ordenes las llaves mientras esperas el ascensor y después cargues una caja de tu pareja. Esa coordinación le hace sentir que de verdad tiene ayuda. Al terminar, sueles estar dispuesto a hablar de lo que salió mal.",
    ),
    words(
      "出问题时，你可能已经替对方把麻烦解决了，于是很自然地觉得现在可以往下谈了。对方却可能还卡在刚才你打断他的那一刻。事情办好了，心里的委屈还在。若你越急着想下一步，对方越容易觉得那一刻的感受被跳过去了。",
      "By the time you want to talk, you may already have sorted out the practical problem. Your partner might still be stuck on the moment you cut them off. Fixing the situation can leave a hurt feeling untouched. Rushing into the next decision can make them feel that part was skipped altogether.",
      "Cuando quieras hablar, quizá ya hayas resuelto el problema práctico. Tu pareja puede seguir pensando en el momento en que la interrumpiste. Resolver el asunto no siempre alivia esa herida. Si pasas enseguida a la siguiente decisión, puede sentir que lo que le dolió quedó fuera de la conversación.",
    ),
    words(
      "试着在帮忙之后留一句邀请：「箱子我放好了。刚才我替你拿主意太快了，你本来想怎么做？」如果对方只想被听见，就让那件事先放一放。等你们重新动手时，先问对方愿意接哪一部分，合作才真正有两个人的主意。",
      "Once you’ve helped, leave an opening. “The boxes are inside. I decided for you too quickly earlier. What did you have in mind?” If they want to be heard, let the task wait. When you start again, ask what part they’d like to take on so both voices shape the work.",
      "Después de ayudar, deja una invitación abierta. «Ya guardé las cajas. Antes decidí por ti demasiado rápido. ¿Cómo pensabas hacerlo?» Si necesita que le escuches, la tarea puede esperar. Al volver a ella, pregunta de qué parte quiere encargarse para que el trabajo refleje las ideas de ambos.",
    ),
  ],
  TAP: [
    words(
      "你倾向把陪伴落在眼前的小事里。两个人都累的时候，你也许把最后一碗汤推到对方面前，坐下来一起吃完。你给关系带来的安稳，常藏在这些没有特意说明的瞬间。伴侣若记得说一句「你留的汤我喝到了」，你们就都有机会看见这个小动作的分量。",
      "Your affection often takes shape in whatever is at hand. When you’re both tired, you might slide the last bowl of soup over and sit down to eat together. These small moments can make life feel steadier. A partner who says “I noticed you saved that for me” gives both of you a moment to appreciate the gesture.",
      "Tu cariño suele tomar forma en las cosas que tienes a mano. Cuando ambos llegan cansados, quizá le acerques a tu pareja el último plato de sopa y te sientes a comer a su lado. Estos gestos dan estabilidad al día. Un «Me di cuenta de que me la guardaste» permite que los dos reconozcan lo que significó.",
    ),
    words(
      "闹别扭以后，你可能还会递杯水、等对方一起回家。这是你的关心，可对方或许会理解成「那件事已经翻篇了」。尤其当你还没准备好开口，对方既能感觉到你在照顾自己，又不知道还能不能提刚才的委屈，这两种感受可以同时存在。",
      "After an argument, you may still offer water or wait to walk home together. Your partner might read that as “We’ve moved on.” While you are gathering your thoughts, they may feel looked after and still wonder whether they’re allowed to raise what hurt them. Both reactions can be true at once.",
      "Después de discutir, quizá ofrezcas agua o esperes para regresar juntos. Tu pareja podría entender «ya pasamos página». Mientras tú ordenas tus ideas, puede sentirse cuidada y seguir preguntándose si aún hay espacio para hablar de lo que le dolió. Ambas cosas pueden coexistir.",
    ),
    words(
      "如果此刻只能做一点事，可以给这个动作配一句短话：「我给你倒了水。刚才的事我记着，等我们散完步我来找你聊。」散步之后，先听对方说哪里难受，再解释你当时在想什么。你擅长的照顾会成为谈话的起点。",
      "Give the gesture one short sentence. “Here’s some water. I’m still thinking about earlier. I’ll come find you after our walk.” When you return, ask what hurt before explaining what was on your mind. The care you already show then becomes a way into the conversation.",
      "Acompaña el gesto con una frase breve. «Te traje agua. Sigo pensando en lo de antes. Después del paseo te busco y hablamos». Al volver, pregunta qué le dolió antes de explicar qué pasaba por tu cabeza. El cuidado que ya muestras puede abrir esa conversación.",
    ),
  ],
  SWR: [
    words(
      "你可以把独立和亲密放在同一天里。下午各做喜欢的事，听到一首很合对方口味的歌，你也许会发过去，加一句「听到这里想起你」。这类有来由的表达能让对方知道，即使各自安排时间，彼此也一直在对方的生活里有个位置。",
      "You can make independence and closeness fit inside the same day. While spending an afternoon apart, you might hear a song your partner would love and send it with “This bit made me think of you.” A specific message gives them a place in your day even as you each pursue your own plans.",
      "Puedes dar cabida a la independencia y la cercanía en un mismo día. En una tarde por separado quizá escuches una canción que le encantaría a tu pareja y se la envíes con un «Esta parte me recordó a ti». Un mensaje así le da un lugar en tu día mientras cada quien sigue sus planes.",
    ),
    words(
      "你需要独处来休息，遇到分歧却想早点重谈。这两种节奏容易让伴侣困惑。周五晚上你想自己看电影，对方体贴地给你空间；周六拌完嘴，对方照样留你一个人，你却可能觉得那通电话格外难等。最好让对方知道，休息和闹别扭时，你盼的是两种不同的回应。",
      "You may want solitude when tired and prompt contact after a disagreement. A partner who gives you space for a film on Friday might do the same after Saturday’s argument, leaving you waiting for a call. Telling them that rest and disagreement call for different responses can spare both of you a guessing game.",
      "Puedes necesitar soledad para descansar y contacto pronto después de un roce. Si el viernes agradeciste ver una película a solas, el sábado tu pareja quizá también te deje espacio después de discutir, mientras tú esperas una llamada. Explicar que el cansancio y el desacuerdo requieren cosas distintas puede evitar adivinanzas.",
    ),
    words(
      "试着把两个请求说完整：「今晚我想自己歇歇，明早照样想跟你吃早饭。刚才让我不舒服的那句话，我们能先花五分钟聊一下吗？」也可以让对方选一个能专心听的时间。把独处的边界和重谈的邀请各自说清，会给你们两个人更多自由。",
      "Give each request its own sentence. “Tonight I’d like time alone. I’m still looking forward to breakfast together. Can we take five minutes for that comment that bothered me?” Let them suggest a time when they can listen. Clear requests give both of you more room to choose.",
      "Dale una frase a cada petición. «Esta noche quiero descansar a solas. Mañana me sigue apeteciendo desayunar contigo. ¿Hablamos cinco minutos de ese comentario que me molestó?» Deja que proponga un momento en que pueda escuchar. Las peticiones claras os dan más libertad a los dos.",
    ),
  ],
  SWP: [
    words(
      "你可能要在一天结束、四周安静下来以后，才想到最想对伴侣说的那句话。当面没来得及讲的感谢，回家以后发一条简短的语音，也能说得很贴切。你给关系的一样好东西，是给彼此留出整理感受的余地，又愿意在想清楚后把自己的内心交代给对方。",
      "The words you want may come when the day is over and things are quiet. A short voice note from home can carry the thanks you couldn’t quite express in person. Making room to sort through a feeling, then coming back to put it into words, is something you can offer a relationship.",
      "Quizá encuentres las palabras que buscabas cuando acaba el día y todo se calma. Un breve audio desde casa puede expresar ese agradecimiento que no supiste decir en persona. Dar espacio para entender lo que sientes y volver después a compartirlo es algo valioso que puedes aportar.",
    ),
    words(
      "需要独处和需要暂停叠在一起时，对方容易只看见你离开。你原本在认真想怎么说，伴侣可能已经开始猜测「是不是我做了什么，让你不愿意理我」。特别是在异地或只靠文字联系的时候，一个迟迟没回的对话框很难替你表达善意。",
      "When the need for solitude coincides with a pause after conflict, all a partner may see is you leaving. You could be choosing your words with care while they wonder whether they drove you away. Especially at a distance, an unanswered message offers few clues about your intentions.",
      "Cuando la necesidad de soledad coincide con una pausa tras discutir, tu pareja quizá solo vea que te alejas. Puedes estar escogiendo tus palabras con cuidado mientras se pregunta si hizo algo para apartarte. Sobre todo a distancia, un mensaje sin respuesta ofrece pocas pistas sobre tus intenciones.",
    ),
    words(
      "给伴侣留一个你做得到的约定：「我读到了，今晚脑子有点满。我明天午饭后给你打电话，想听听你那句话是什么意思。」到时候哪怕还没想出答案，也先打那通电话。对方能信任你会回来，你也更容易在安静里把话想清楚。",
      "Leave a promise you can keep. “I read it. My head’s full tonight. Can I call after lunch tomorrow? I want to understand what you meant.” Make that call even if you still don’t have an answer. A reliable return can make space feel safer for the other person and more restorative for you.",
      "Deja un compromiso que puedas cumplir. «Te leí. Esta noche tengo la cabeza llena. ¿Te llamo mañana después de comer? Quiero entender qué quisiste decir». Llama aunque todavía no tengas una respuesta. Si tu pareja sabe que volverás, la pausa puede darle seguridad y a ti, calma.",
    ),
  ],
  SAR: [
    words(
      "即使时间各自安排，你也可能很留意对方生活里的细节。伴侣说最近加班，下次见面你顺路带了一份他喜欢的晚饭，也给他留出自己歇口气的时间。你用一件做得到的事表达在乎，同时尊重两个人各有自己的生活。对喜欢具体支持的人，这往往很容易感受到。",
      "Even when your schedules are separate, you may notice the details of your partner’s day. After a week of late shifts, you might drop off a favourite meal and leave them time to unwind. Offering practical help while respecting their space can feel especially reassuring to someone who appreciates tangible support.",
      "Aunque cada quien siga su horario, quizá prestes mucha atención a los detalles del día de tu pareja. Después de una semana de horas extra, puedes llevarle su cena favorita y dejarle tiempo para descansar. Ofrecer una ayuda concreta y respetar su espacio suele significar mucho para quien valora ese apoyo.",
    ),
    words(
      "平时你对小事一向说做就做，争执后也可能很快拿出改进方案：「下回改成我来订票。」这能解决下一次的安排，却未必碰到对方今天介意的那一点。也许对方最在乎的，是两个人约好的事被临时改掉，却直到最后一刻才知道。",
      "Because you take action readily, you may come to a disagreement with a fix already in hand. “I’ll book the tickets next time.” That settles the next outing while leaving today’s hurt untouched. What mattered may have been finding out at the last minute that a plan you’d made together had changed.",
      "Como sueles pasar pronto a la acción, quizá llegues con una solución: «La próxima vez reservo yo». Eso resuelve la próxima salida, pero puede dejar intacto lo que dolió hoy. Tal vez lo importante fuera haberse enterado a última hora de que cambiaba un plan acordado entre los dos.",
    ),
    words(
      "重谈时先把自己的猜测拿出来核对：「你最难受的是没一起决定，还是等了很久才收到消息？」听完再问「下次有变动，我先打给你，这样会好些吗？」这样你擅长的行动有了明确去向，对方也能感觉到，自己参与了决定。",
      "Start the conversation by checking your reading of things. “Was the hardest part being left out of the decision, or waiting so long to hear about it?” Listen before offering a fix. “Would it help if I called you as soon as anything changed?” Your practical effort then addresses what actually mattered to them.",
      "Comprueba tu interpretación antes de actuar. «¿Te dolió más no participar en la decisión o enterarte tan tarde?» Escucha antes de proponer algo. «¿Ayudaría que te llamase en cuanto hubiera un cambio?» Así tu esfuerzo práctico responde a lo que a tu pareja realmente le importaba.",
    ),
  ],
  SAP: [
    words(
      "你经营亲密的方式可能很安静。忙完自己的一天，路过药店时你仍记得替伴侣买回用完的东西；对方想独处，你也愿意让出那个晚上。你把关心放进生活细节，也给彼此保留喘息的余地。越能留意这些小动作的人，越容易读到你没有特意说出口的牵挂。",
      "Your way of being close may be quiet. After a busy day of your own you might stop at the pharmacy for something your partner has run out of, then leave them the evening they want to themselves. Care for details and space to breathe can coexist. Someone who notices those small gestures may find your affection easier to read.",
      "Tu manera de vivir la cercanía puede ser discreta. Después de un día lleno, quizá pases por la farmacia por algo que se le terminó a tu pareja y luego le dejes esa noche a solas que necesitaba. El cuidado por los detalles puede convivir con el espacio propio. Quien se fije en esos gestos podrá entender mejor tu cariño.",
    ),
    words(
      "分歧发生后，你倾向先消化，表达在乎又更多靠行动，于是伴侣可用来理解你的线索可能都很微小。比如你已经把车开到楼下等他了，对方心里想的仍是「昨晚那件事还能不能说」。同一趟接送，对你是惦记，对他可能只是猜不透的沉默。",
      "After a disagreement, a pause plus a preference for showing care through actions can leave few clues for your partner. You may be downstairs with the car ready, while they’re wondering whether last night’s argument is still open for discussion. The same lift can feel thoughtful to you and hard to interpret to them.",
      "Tras un desacuerdo, la combinación de una pausa y un cariño expresado con hechos puede dejar pocas pistas. Quizá estés abajo esperando en el coche mientras tu pareja se pregunta si aún se puede hablar de lo de anoche. El mismo trayecto que para ti significa cuidado puede resultarle difícil de interpretar.",
    ),
    words(
      "你可以保留自己喜欢的做法，再给对方一个清楚的时间点：「我来接你了。路上想安静一下，到家喝杯水，我们聊聊昨晚的事。」如果要更久，就主动更新约定。能尊重你的空间、也能坦白提出需要的人，更容易跟你把这段安静过得踏实。",
      "Keep the gesture and add a clear time to talk. “I’m here to pick you up. I’d like a quiet drive. Let’s talk about last night over a drink when we get home.” If you need longer, update the agreement yourself. Someone who respects your space and voices their needs can help this quiet feel dependable.",
      "Conserva el gesto y añade un momento concreto. «Ya llegué. Me apetece volver en silencio. Al llegar tomamos algo y hablamos de anoche». Si necesitas más tiempo, avisa tú. Alguien que respete tu espacio y pueda expresar sus necesidades te ayudará a que ese silencio se sienta seguro.",
    ),
  ],
};

export function styleReading(sides, language) {
  const known = Object.entries(letters).flatMap(([axis, options]) => {
    const letter = options[sides[axis]];
    return letter ? [letter] : [];
  });
  const typeCode = known.length === 3 ? known.join("") : null;
  return {
    typeCode,
    legend: known.map(letter => letter + " · " + meanings[letter][language]),
    chapters: typeCode ? profiles[typeCode].map((paragraph, index) => ({
      title: chapterTitles[index][language], body: paragraph[language],
    })) : known.map(letter => ({ title: meanings[letter][language], body: partialReadings[letter][language] })),
  };
}
