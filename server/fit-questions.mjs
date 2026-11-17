const tr = (zh, en, es) => ({ zh, en, es });
const question = (id, topic, text, followup, choices) => ({
  id, topic: tr(...topic), text: tr(...text), followup: tr(...followup),
  options: choices.map((words, index) => ({ id: String(index), text: tr(...words) })),
});

// The first item of each chapter is part of the short introduction.
export const fitModules = [
  {
    id: "personality", title: tr("相处节奏", "Time together", "Ritmos compartidos"),
    description: tr("遇到新鲜事和空闲时间，你怎样进入状态？", "How you approach new experiences and free time.", "Cómo te acercas a lo nuevo y al tiempo libre."),
    questions: [
      question("v3-outing-plan", ["约会安排", "Date plans", "Planes de citas"],
        ["周六下午一起出门。翻到下面哪张行程卡，你最想拿走？", "You're going out together on Saturday afternoon. Which itinerary card would you keep?", "Van a salir juntos el sábado por la tarde. ¿Con qué tarjeta de itinerario te quedarías?"],
        ["下次出门前，你希望日历里先写下什么？", "What would you put on the calendar before your next outing?", "¿Qué anotarías antes de su próxima salida?"], [
          ["一个目的地，到了再逛", "One destination, then wander", "Un destino y luego improvisar"],
          ["两三个想去的点，顺序随意", "Two or three stops, in any order", "Dos o tres paradas, en cualquier orden"],
          ["按时间排好的路线", "A route with a time for each stop", "Una ruta con hora para cada parada"],
          ["只写出门时间，地点到时再说", "Just a time to leave. Pick the place later", "Solo una hora de salida. El lugar se decide después"],
        ]),
      question("v3-reunion", ["刚见面时", "Reuniting", "Al reencontrarse"],
        ["几天没见，终于又在一个屋檐下。接下来半小时，哪个画面最有「我们又在一起了」的感觉？", "You're under the same roof again after a few days apart. Which half hour would feel most like a reunion?", "Después de unos días separados vuelven a estar bajo el mismo techo. ¿Qué media hora te sabría más a reencuentro?"],
        ["刚见面时，你想马上开始相处，还是需要一点过渡？", "On arrival, do you like to reconnect straight away or ease into it?", "Al llegar, ¿te apetece conectar enseguida o entrar en ambiente poco a poco?"], [
          ["坐下来，说一件这几天发生的事", "Sitting down and swapping a story", "Sentarnos a contar algo de estos días"],
          ["一起拆行李，边收边聊", "Unpacking together and chatting as we go", "Deshacer las maletas y charlar mientras tanto"],
          ["挨着坐一会儿，不急着说话", "Sitting close without having to talk yet", "Sentarnos cerca sin prisa por hablar"],
          ["各自换好衣服，再一起吃点东西", "Getting changed separately, then sharing a bite", "Cambiarnos por separado y luego comer algo juntos"],
        ]),
      question("v3-changed-plan", ["计划变化的记忆", "Remembering a change of plans", "Recuerdos de un cambio de planes"],
        ["回想上一次约会临时换了安排。过后说起那天，你最先提到的是什么？", "Think about the last time a date changed at short notice. What did you mention first afterwards?", "Piensa en la última cita que cambió sobre la marcha. ¿Qué fue lo primero que contaste después?"],
        ["那天的哪一部分，你愿意下次再来一次？", "Which part of that day would you want to repeat?", "¿Qué parte de ese día te gustaría repetir?"], [
          ["原来有个地方没去成", "The place we missed", "El lugar al que no llegamos a ir"],
          ["后来意外发现的东西", "Something we stumbled on afterwards", "Algo que descubrimos de casualidad"],
          ["临时商量去哪里的那段过程", "How we figured out where to go instead", "Cómo decidimos adónde ir al final"],
          ["记得那天的事，没特别提过换计划", "I remember the day but didn't bring up the change", "Recuerdo el día, pero no mencioné el cambio"],
        ]),
    ],
  },
  {
    id: "closeness", title: tr("倾诉与回应", "Talking & listening", "Hablar y escuchar"),
    description: tr("联系的频率、独处和安心感。", "Contact, personal space, and what helps you feel secure.", "Contacto, espacio propio y lo que te da tranquilidad."),
    questions: [
      question("v3-listening", ["听你说话的方式", "Being heard", "Cómo te gusta que te escuchen"],
        ["你跟 TA 说「今天有件事让我挺委屈的」。TA 已经坐下来听了。哪一句最容易让你接着说？", "You say, “Something really got to me today.” Your partner sits down to listen. Which opening helps you keep talking?", "Dices «Hoy pasó algo que me dolió». Tu pareja se sienta a escucharte. ¿Qué te ayuda a seguir contando?"],
        ["下次你讲到一半停住时，想听 TA 怎样接话？", "If you pause halfway through next time, how would you like them to respond?", "Si te paras a mitad de la historia, ¿cómo te gustaría que respondiera?"], [
          ["「从哪儿开始的？我想听你慢慢讲。」", "“Where did it start? Take your time.”", "«¿Cómo empezó? Cuéntamelo con calma»."],
          ["「哪一下让你最难受？」", "“Which part hurt the most?”", "«¿Qué fue lo que más te dolió?»"],
          ["「你现在最拿不准的是什么？我们一起想想。」", "“What are you unsure about? Let's think it through.”", "«¿Qué te genera dudas ahora? Vamos a pensarlo»."],
          ["先听我说完，过一会儿再接话", "Let me finish before jumping in", "Que me deje terminar y después me responda"],
        ]),
      question("v3-reach-out", ["上次怎样开口", "How the last conversation began", "Cómo empezó la última charla"],
        ["最近一次，你有件不痛快的事想让 TA 知道。你们的对话实际是怎么开始的？", "Last time something was bothering you and you wanted your partner to know, how did the conversation actually start?", "La última vez que querías contarle algo que te molestaba, ¿cómo empezó la conversación?"],
        ["那次开口的方式，是你喜欢的，还是刚好那天如此？", "Did you like how that conversation started, or was that just how the day went?", "¿Te gustó cómo empezó la charla o simplemente se dio así?"], [
          ["我先讲了事情的经过", "I started by telling the story", "Empecé contando lo que pasó"],
          ["我先说了自己的心情", "I started with how I felt", "Empecé diciendo cómo me sentía"],
          ["我先问 TA 有没有空聊", "I started by asking if they had time to talk", "Primero pregunté si tenía tiempo para hablar"],
          ["TA 先问起，我才接着说", "They asked first, then I opened up", "Mi pareja preguntó primero y entonces se lo conté"],
        ]),
      question("v3-wait-cost", ["上次等待的感受", "How waiting felt last time", "Cómo viviste la última espera"],
        ["最近一次，你有话想说，但你们约好了晚一点再聊。等到约好的时间，你的感觉最接近哪一种？", "Last time you had something on your mind and agreed to talk later, how did you feel by the time you talked?", "La última vez que tenían algo pendiente y quedaron en hablar más tarde, ¿cómo te sentías al llegar ese momento?"],
        ["如果再遇到类似的一天，有没有什么能让等待更舒服一点？", "What, if anything, would make the wait easier on a similar day?", "¿Hay algo que haría más llevadera la espera un día parecido?"], [
          ["等一等反而让我理清了想说什么", "The wait helped me find the words", "La espera me ayudó a ordenar lo que quería decir"],
          ["时间早晚对我没什么影响", "The timing made little difference to me", "La hora apenas cambió cómo me sentía"],
          ["中间有点惦记，聊上了就过去了", "It was on my mind until we started talking", "Me rondó la cabeza hasta que hablamos"],
          ["到那时候，我已经没那么想开口了", "By then I felt less like bringing it up", "Para entonces ya tenía menos ganas de sacarlo"],
        ]),
    ],
  },
  {
    id: "care", title: tr("表达爱与被照顾", "Giving & receiving care", "Dar y recibir cariño"),
    description: tr("哪些日常小事让你感到被放在心上？", "The small things that help you feel cared for.", "Los pequeños gestos que te hacen sentir querido."),
    questions: [
      question("v3-keepsake", ["你记住的小心意", "A gesture you remember", "Un detalle que recuerdas"],
        ["如果把最近一次收到的小心意留作纪念，你最想留住哪个细节？", "Think of a recent small gesture from your partner. Which detail would you most like to keep?", "Piensa en un detalle reciente de tu pareja. ¿Qué parte te gustaría guardar?"],
        ["TA 记得的，会不会是同一件事里的另一个细节？", "Might they remember a different detail of that same moment?", "¿Recordará tu pareja otro detalle del mismo momento?"], [
          ["那句恰好说到我心里的话", "The words that hit home", "Las palabras que me llegaron"],
          ["一件本来要做的事已经有人做了", "Finding a task already taken care of", "Descubrir que una tarea ya estaba hecha"],
          ["那段没有别的事打断的时间", "The stretch of uninterrupted time", "Ese rato sin interrupciones"],
          ["一个只有我俩懂的小玩笑", "A little joke only we get", "Una broma que solo entendemos los dos"],
        ]),
      question("v3-celebration", ["庆祝时刻", "Celebrating", "Al celebrar"],
        ["你完成了一件惦记很久的事。庆祝的那晚已经过去，哪一幕你最想再来一次？", "You've finished something that mattered to you. Which moment from a celebration would you most like to relive?", "Has terminado algo importante. ¿Qué momento de una celebración te gustaría volver a vivir?"],
        ["下次有好消息，你愿意把哪一点告诉 TA，让 TA 不用猜？", "What would you tell them about celebrating your next piece of good news?", "¿Qué podrías contarle sobre cómo te gustaría celebrar la próxima buena noticia?"], [
          ["一起把从开始到完成的过程讲一遍", "Telling the whole story together", "Contar juntos la historia de principio a fin"],
          ["两个人出门，给这天留一个特别的地点", "Going somewhere we'll associate with the day", "Salir a un lugar que nos recuerde ese día"],
          ["收到一句具体说出我哪点做得好的话", "Hearing one specific thing I did well", "Oír qué hice bien, con un ejemplo concreto"],
          ["一起干杯或击掌，让那一刻有个记号", "A toast or a high five to mark the moment", "Un brindis o chocar las manos para marcar el momento"],
        ]),
      question("v3-give-care", ["上次表达惦记的方式", "Your last little gesture", "Tu último detalle"],
        ["最近一次你想让 TA 知道「我想到你了」。你最后用的是什么？", "Last time you wanted your partner to know you were thinking of them, what did you use?", "La última vez que quisiste decir «me acordé de ti», ¿cómo lo hiciste?"],
        ["你发出这个信号时，最希望 TA 留意到哪个细节？", "What part of that gesture did you hope they would notice?", "¿Qué detalle del gesto te hacía ilusión que notara?"], [
          ["一句当时想到的话", "Some words that came to mind", "Unas palabras que se me ocurrieron"],
          ["一张照片、一首歌或一个链接", "A photo, song or link", "Una foto, canción o enlace"],
          ["路上顺手带回的一样东西", "Something I picked up along the way", "Algo que traje de camino"],
          ["当面一起做的一件小事", "A small thing we did together in person", "Una pequeña cosa que hicimos en persona"],
        ]),
    ],
  },
  {
    id: "conflict", title: tr("分歧与修复", "Disagreement & repair", "Desacuerdos y reparación"),
    description: tr("有了分歧，你需要怎样的节奏才能重新靠近？", "What helps you reconnect after a disagreement.", "Qué te ayuda a reconectar después de un desacuerdo."),
    questions: [
      question("v3-repair-moment", ["上次和好的瞬间", "When you last felt okay again", "Cuándo volvieron a estar bien"],
        ["回想最近一次小分歧。后来哪个瞬间，让你心里觉得「我们俩好了」？", "Think back to a small disagreement. At what point did you feel the two of you were okay again?", "Recuerda un pequeño desacuerdo. ¿En qué momento sentiste que ya estaban bien?"],
        ["你们上次觉得「已经好了」是在同一个瞬间吗？", "Did you both feel okay again at the same moment last time?", "¿Sintieron que todo estaba bien en el mismo momento?"], [
          ["TA 把我的意思说对了，我不用再解释", "They understood what I meant and I could stop explaining", "Entendió lo que quería decir y pude dejar de explicarlo"],
          ["我们说定了下次遇到这件事怎么办", "We agreed on what to do next time", "Acordamos qué hacer la próxima vez"],
          ["我们又能像平常一样开玩笑了", "We could joke like usual again", "Volvimos a bromear como siempre"],
          ["没有明确的瞬间，是慢慢缓过来的", "There wasn't one moment. It eased gradually", "No hubo un momento concreto. Se fue pasando"],
        ]),
      question("v3-restart", ["重新开口的方式", "Restarting the conversation", "Volver a hablar"],
        ["一次小争执已经停下来，两个人都愿意再聊。哪个开场最容易让你接下去？", "A small argument has settled and you're both willing to talk. Which opening would you find easiest to answer?", "Ya pasó una pequeña discusión y los dos quieren hablar. ¿Con qué frase te resultaría más fácil seguir?"],
        ["如果是你来开场，你自然会说出的第一句也是这句吗？", "If you were opening the conversation, would you use the same line?", "Si empezaras tú la charla, ¿usarías esa misma frase?"], [
          ["「我们刚才是不是把同一句话听成了两个意思？」", "“Did we hear that phrase differently?”", "«¿Entendimos esa frase de maneras distintas?»"],
          ["「你现在最想让我知道哪一点？」", "“What's the one thing you'd like me to understand?”", "«¿Qué es lo que más quieres que entienda?»"],
          ["「要不要边走边说？」", "“Want to talk on a walk?”", "«¿Lo hablamos dando un paseo?»"],
          ["「下次遇到这个，我们想怎么做？」", "“How would we like to handle it next time?”", "«¿Qué nos gustaría hacer la próxima vez?»"],
        ]),
      question("v3-pause", ["上次暂停争执时", "During the last pause", "Durante la última pausa"],
        ["最近一次你们把小分歧先搁了一会儿。那段空档里，什么最影响你是否放得下？", "Last time you put a small disagreement on hold, what most affected how the pause felt?", "La última vez que dejaron un pequeño desacuerdo en pausa, ¿qué influyó más en cómo viviste la espera?"],
        ["下次暂停时，有没有一件事是你希望提前说好的？", "Next time you pause, is there anything you'd like to agree on first?", "La próxima vez que hagan una pausa, ¿qué te gustaría acordar antes?"], [
          ["知不知道什么时候会再谈", "Knowing when we'd return to it", "Saber cuándo volveríamos a hablar"],
          ["能不能各自安静待一会儿", "Having a little quiet time apart", "Disponer de un rato tranquilo por separado"],
          ["还能不能照常一起做别的事", "Being able to carry on doing other things together", "Poder seguir haciendo otras cosas juntos"],
          ["这段空档本身对我没什么影响", "The pause itself didn't matter much to me", "La pausa en sí apenas me afectó"],
        ]),
    ],
  },
  {
    id: "boundaries", title: tr("边界与自主", "Boundaries & independence", "Límites y autonomía"),
    description: tr("朋友、独处和共同决定怎样相处舒服？", "Friends, personal time, and decisions you share.", "Amistades, tiempo propio y decisiones compartidas."),
    questions: [
      question("v3-company", ["各忙各的晚上", "An evening of separate activities", "Una noche de actividades distintas"],
        ["周日晚上，你们各有一件喜欢做的事，两小时没人打扰。哪个画面最有吸引力？", "You each have something you enjoy doing and two free hours on Sunday night. Which picture appeals to you?", "El domingo tienen dos horas libres y cada uno tiene algo que le gusta hacer. ¿Qué imagen te atrae más?"],
        ["在你心里，怎样的一段晚上才算「一起待过了」？", "What makes an evening count as time together for you?", "¿Qué hace que una noche cuente como tiempo juntos para ti?"], [
          ["各忙各的，坐在一张桌边，抬头就能看到 TA", "Doing our own things at one table, within sight", "Cada quien a lo suyo en la misma mesa, a la vista"],
          ["各找个舒服的角落，中途碰面喝点东西", "Separate cosy corners and a drink together halfway through", "Cada quien en su rincón y una bebida juntos a mitad del rato"],
          ["先各自尽兴，后半段收起来一起做一件事", "Time for our own things first, then an activity together", "Primero un rato para cada quien y después una actividad juntos"],
        ]),
      question("v3-audience", ["视频的分享范围", "Who sees the clip", "Quién ve el vídeo"],
        ["你们拍了一段旅行小视频，里面有你笑得停不下来的样子。TA 来问你想让谁看到。哪个范围你最自在？", "There's a travel clip of you laughing uncontrollably. Your partner asks who you'd feel comfortable showing it to. Which audience feels right?", "Hay un vídeo de viaje en el que no paras de reír. Tu pareja pregunta con quién te gustaría compartirlo. ¿Con qué público te sientes a gusto?"],
        ["如果换成另一张照片，哪一处细节会让你改变范围？", "What detail in a different picture might change your answer?", "¿Qué detalle de otra foto cambiaría tu respuesta?"], [
          ["就我们两个", "Just the two of us", "Solo nosotros dos"],
          ["发给我点名的几个人", "A few people I name", "Unas pocas personas que yo elija"],
          ["发在熟人的小群里", "A small group of people I know", "Un grupo pequeño de conocidos"],
          ["发在平时分享旅行动态的地方", "Where I usually share travel updates", "Donde suelo publicar cosas de mis viajes"],
        ]),
      question("v3-solo-evening", ["上次各自过夜晚的感受", "How separate plans felt last time", "Cómo te sentiste con planes separados"],
        ["回想上一次，你们临时决定把原先留给两个人的一个晚上分开过。临睡前，你最接近哪种感受？", "Think of the last time an evening you had set aside together turned into separate plans. How did you feel by bedtime?", "Piensa en la última vez que una noche reservada para los dos terminó con planes separados. ¿Cómo te sentías al acostarte?"],
        ["那晚的感受，你当时有没有说出来？", "Did you say how you felt that evening?", "¿Llegaste a decir cómo te sentías esa noche?"], [
          ["那个晚上独处得正好", "The time alone suited me that night", "Esa noche me vino bien estar a solas"],
          ["怎么过都差不多", "Either plan would have felt fine", "Cualquiera de los dos planes me habría sentado bien"],
          ["挺喜欢自己的安排，也有点想念原来的计划", "I enjoyed my evening and also missed our original plan", "Disfruté de mi noche y también eché de menos el plan original"],
          ["到睡前还是觉得少了点什么", "By bedtime I still felt something was missing", "Al acostarme todavía sentía que faltaba algo"],
        ]),
    ],
  },
  {
    id: "future", title: tr("金钱、家庭与未来", "Money, family & the future", "Dinero, familia y futuro"),
    description: tr("看看你们怎样做取舍，哪些事值得提前聊。", "How you make trade-offs and what deserves a conversation.", "Cómo toman decisiones y qué conviene conversar."),
    questions: [
      question("v3-bonus", ["一笔奖金的用途", "Using a bonus", "El destino de una bonificación"],
        ["一笔自己能决定怎么花的奖金，只够选一件。平时的开支和旅行都已安排好。想到半年后的自己，你更想留下哪段经历？", "A personal bonus covers just one extra. Your bills and planned trip are already covered. Which experience would you rather look back on in six months?", "Una bonificación personal alcanza para un extra. Ya están cubiertos los gastos y el viaje previsto. ¿Qué experiencia te gustaría recordar dentro de seis meses?"],
        ["如果明年还有一次机会，你会先补哪一个？", "If you had another chance next year, what would you do first?", "Si tuvieras otra oportunidad el año que viene, ¿qué harías primero?"], [
          ["一起在旅行里多留一晚，慢慢逛那座城", "An extra night exploring the city together", "Una noche más para recorrer juntos la ciudad"],
          ["上完一门想学很久的课，亲手做出第一件作品", "Finishing a long-awaited course and making my first piece", "Terminar el curso que quería y crear mi primera obra"],
          ["两段经历我都同样期待", "I'd look forward to both equally", "Las dos me harían la misma ilusión"],
        ]),
      question("v3-family-visit", ["探亲时想再经历的时刻", "A family moment to repeat", "Un momento familiar que repetir"],
        ["翻翻最近一个假期的记忆。和家人相处时，你最想把哪一种时刻留到下一次？", "Think of your last holiday with family. Which kind of moment would you most want to bring back next time?", "Piensa en las últimas vacaciones con la familia. ¿Qué momento te gustaría repetir?"],
        ["下次回家前，你想给哪种时刻空出一点时间？", "What would you make room for on the next visit?", "¿Para qué momento te gustaría reservar tiempo en la próxima visita?"], [
          ["大家在一张桌上，热热闹闹地聊", "Everyone talking around one table", "Todos charlando alrededor de la mesa"],
          ["跟一个人单独走走，聊一件平时没聊的事", "A walk with one person and a conversation we rarely get to have", "Un paseo a solas con alguien y una charla poco habitual"],
          ["一起张罗一件小事，边做边说", "Doing something side by side and chatting as we went", "Preparar algo juntos y hablar mientras tanto"],
          ["没安排活动，各自在同一个地方待着", "Being in the same place without a planned activity", "Estar en el mismo sitio sin organizar una actividad"],
        ]),
      question("v3-time-apart", ["分隔两地时的盼头", "Something to look forward to while apart", "Una ilusión para el mes a distancia"],
        ["假设要在不同城市住一个月，见面的日期已经定好。下面只能先定一件小事，哪件最能让这个月有盼头？", "Imagine a month in different cities with your reunion date set. Which detail would you most look forward to arranging first?", "Van a pasar un mes en ciudades distintas y ya tienen fecha para verse. ¿Qué detalle te haría más ilusión concretar primero?"],
        ["这个安排对你来说是锦上添花，还是少了就会惦记？", "Would this be a nice extra, or something you'd really miss?", "¿Sería un extra agradable o algo que echarías de menos?"], [
          ["挑一部两边都能同步看的剧", "A show to watch at the same time", "Una serie para ver al mismo tiempo"],
          ["挑一个固定时间，每周交换近况", "A regular time each week to catch up", "Una hora fija a la semana para ponerse al día"],
          ["各自在当地找一样东西，见面时带给对方", "Something local to pick out and bring to our reunion", "Algo de cada ciudad para intercambiar al reencontrarnos"],
          ["把重逢那天要做的第一件事定下来", "The first thing to do on the day we meet again", "Lo primero que haremos el día del reencuentro"],
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
