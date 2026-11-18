const text = (zh, en, es) => ({ zh, en, es });

export const familyLines = {
  TR: text("你喜欢多和伴侣待在一起，也希望对方经常让你知道，心里惦记着你。", "You enjoy time together and appreciate regular signs that your partner is thinking of you.", "Disfrutas del tiempo en pareja y valoras las señales frecuentes de que tu pareja piensa en ti."),
  TC: text("你喜欢两个人一起过日常。各自忙起来、暂时没联系时，你通常也觉得感情安稳。", "You enjoy sharing everyday life. When you are both busy and out of touch, you usually still feel secure about the relationship.", "Disfrutas de la vida cotidiana en pareja. Cuando ambos tienen cosas que hacer y pasan tiempo sin hablar, sueles sentir que el vínculo sigue bien."),
  SR: text("你希望留出自己安排的时间。即使今天不见面，伴侣主动问一句你过得怎样，也会让你觉得被在乎。", "You like having time of your own. Even on days apart, a message asking how you are can help you feel cared for.", "Te gusta disponer de tiempo propio. Incluso si hoy no se ven, un mensaje preguntándote cómo estás puede hacerte sentir cariño."),
  SC: text("你喜欢各自有安排。即使一段时间没联系，你通常也相信彼此仍然在乎对方。", "You enjoy making plans of your own. Even when you go a while without checking in, you usually trust that you care about each other.", "Disfrutas de tus propios planes. Aunque pasen un tiempo sin comunicarse, sueles confiar en que el cariño sigue presente."),
};

export const portraits = {
  TRWN: {
    lines: [
      text("爱得最响。想你就说，不高兴也当场说，什么都摆在明面上。", "You love out loud. You say when you miss someone and speak up when something hurts. Everything is out in the open.", "Tu amor se oye. Dices cuándo extrañas a alguien y cuándo algo te duele. Todo queda a la vista."),
      text("常在一起，常听到回应，有事当下谈完。", "Frequent time together, frequent replies, and a chance to talk things through right away.", "Pasar tiempo juntos, recibir señales frecuentes y aclarar las cosas en el momento."),
      text("被看成要求多、情绪来得快。其实说完就过去了，不记隔夜的账。", "You may seem demanding or quick to react. Once you have said your piece, you move on without holding yesterday against anyone.", "Pueden pensar que pides mucho o que reaccionas enseguida. Una vez que lo has dicho, pasas página sin llevarte la cuenta al día siguiente."),
      text("对方回应快，不嫌话多。碰上要缓一缓的人，要学会给对方一个时间，而不是追着谈。", "Someone who responds readily and likes hearing you out. With a partner who needs a pause, give them time instead of pressing them to talk.", "Alguien que responda pronto y te escuche con gusto. Si necesita una pausa, dale tiempo en vez de insistir en hablar."),
    ],
  },
  TRWL: {
    lines: [
      text("平时话很甜、很黏，一有事反而安静下来。", "Affectionate words and closeness come easily most days. When something troubles you, you grow quiet.", "Te sale estar cerca y decir cosas cariñosas. Cuando algo te preocupa, te quedas en silencio."),
      text("对方主动问一句「你是不是有心事」，给时间，但人别走开。", "Someone who asks, “Is something on your mind?” You need time, with your partner still nearby.", "Que tu pareja pregunte «¿Tienes algo en mente?», te dé tiempo y siga cerca."),
      text("安静下来的时候，对方以为没事了。其实是在等对方来问。", "Your silence can look like a sign that everything is fine. You may be waiting for your partner to ask.", "Al verte en silencio, puede creer que ya pasó. Quizá estés esperando a que pregunte."),
      text("对方看得出情绪变化，愿意先开口。自己要练习说「我在想一件事，晚点跟你说」。", "Someone who notices changes in your mood and reaches out. Try saying, “I’m thinking something through. I’ll tell you later.”", "Te ayuda que note tus cambios de ánimo y dé el primer paso. Prueba a decir «Estoy pensando en algo, luego te cuento»."),
    ],
  },
  TRDN: {
    lines: [
      text("会替你把事情都办了，然后盼着你看见。看不见就当场说。", "You take care of things and hope your partner notices. If they miss it, you speak up right away.", "Resuelves cosas por quien quieres y esperas que se dé cuenta. Si no lo ve, lo dices en el momento."),
      text("被看见，被具体地感谢，比如「谢谢你帮我把票改了」。", "To be noticed and thanked for the particular thing you did, like “Thanks for changing my ticket.”", "Que se fijen y agradezcan algo concreto, como «Gracias por cambiarme el billete»."),
      text("很少说喜欢，却会抱怨「你都没注意我做了什么」，听着像计较。其实是在要回应。", "You may say little about liking someone, then say, “You didn’t notice what I did.” This can sound like keeping score when you want acknowledgment.", "Quizá digas poco que quieres a alguien, pero sí «No viste lo que hice». Puede sonar a que llevas la cuenta cuando buscas una respuesta."),
      text("对方留意细节，会把感谢说出口。", "Someone who sees the details and says thank you out loud.", "Alguien que se fije en los detalles y dé las gracias en voz alta."),
    ],
  },
  TRDL: {
    lines: [
      text("做了很多不说，盼着对方发现。没被发现就自己难过，也不说。", "You do a great deal quietly and hope your partner notices. When they don’t, you keep the hurt to yourself.", "Haces mucho en silencio y esperas que tu pareja se dé cuenta. Si no lo ve, te guardas la pena."),
      text("对方主动注意、主动问。", "A partner who notices things and asks how you are of their own accord.", "Que tu pareja se fije y pregunte por iniciativa propia."),
      text("十六型里最容易被看错的一型。看上去省心、什么都不要，实际上需要的最多。", "Of the sixteen styles, yours is the easiest to misread. You may seem to ask for nothing while needing the most.", "De los dieciséis estilos, el tuyo es el más fácil de malinterpretar. Puedes parecer alguien que apenas pide nada y, aun así, necesitar más que nadie."),
      text("两个人约好「不舒服可以晚点说，但一定要说」。对方定期问一句「最近有没有哪里我没顾到」。", "Agree that a hurt can be raised later, but it will be raised. It helps to hear, “Is there anything I’ve overlooked lately?”", "Acuerden que si algo duele pueden decirlo después, pero lo dirán. Ayuda que te pregunten de vez en cuando «¿Hay algo que se me haya pasado últimamente?»."),
    ],
  },
  TCWN: {
    lines: [
      text("喜欢待在一起，不需要反复确认，有话直说。稳定、热闹、好相处。", "You enjoy being together, feel secure without repeated reassurance, and speak your mind. You bring steadiness and lively company.", "Te gusta estar en compañía, sientes seguridad sin pedir confirmación a menudo y hablas con franqueza. Aportas estabilidad y animas el día a día."),
      text("有人一起过日子，愿意当面把话说开。", "Someone to share ordinary life with who will talk things through face to face.", "Alguien con quien compartir lo cotidiano y hablar las cosas cara a cara."),
      text("自己心里踏实，就容易把对方的不安看成想太多。直话有时显得不够体贴。", "Feeling secure yourself can make a partner’s worries seem like overthinking. Your directness can sound less tender than you intend.", "Al sentirte en calma, puedes creer que tu pareja le da demasiadas vueltas. Tu franqueza puede sonar poco delicada."),
      text("对方也坦率。碰上要回应的人，记得多说一句「我在」，这对自己不费力，对对方很重要。", "Someone who also speaks openly. With a partner who needs reassurance, an extra “I’m here” costs little and means a great deal.", "Alguien que también hable con franqueza. Si tu pareja necesita señales, decirle «Estoy aquí» cuesta poco y puede significar mucho."),
    ],
  },
  TCWL: {
    lines: [
      text("陪伴多，话暖，心里稳，有分歧先想再谈。像一个能聊很久的老朋友。", "You offer company and warm words, feel secure, and like to reflect before discussing a disagreement. Talking to you can feel like talking to an old friend.", "Ofreces compañía y palabras cálidas, sientes seguridad y ante una diferencia prefieres reflexionar. Contigo se puede hablar como con una amistad de toda la vida."),
      text("一起的日常，以及一点整理想法的时间。", "Everyday time together and a little room to collect your thoughts.", "Compartir lo cotidiano y tener tiempo para ordenar tus ideas."),
      text("不慌不忙加上缓一缓，急的人会觉得「你根本不在乎」。", "Your calm manner and wish to pause may leave an impatient partner thinking, “You don’t care at all.”", "Tu calma y tus pausas pueden llevar a alguien con más prisa a pensar «Esto te da igual»."),
      text("暂停时说清楚什么时候回来谈，并且真的回来。", "When you pause, say when you will return to the conversation and follow through.", "Cuando necesites parar, di cuándo volverás a hablar y cumple ese acuerdo."),
    ],
  },
  TCDN: {
    lines: [
      text("过日子的好手。修东西、订票、做饭，事情来了当场解决。", "You are at home with the practical side of life. You fix things, book tickets, cook, and tackle problems as they arise.", "Se te da bien la vida cotidiana. Arreglas cosas, reservas billetes, cocinas y resuelves lo que surge en el momento."),
      text("一起做事的时间，对方直接说要什么。", "Time to do things together and someone who tells you directly what they need.", "Tiempo para hacer cosas juntos y que tu pareja diga con claridad qué necesita."),
      text("把解决问题当成安慰，对方只想被听的时候，方案已经出来了。很少说情话。", "You may offer a solution as comfort just when a partner wants to be heard. Romantic words may be rare.", "Puedes ofrecer una solución como consuelo cuando tu pareja solo quería que la escucharas. Quizá se te oigan pocas palabras románticas."),
      text("对方会直接说「我现在只想你听我说」。", "Someone who can say plainly, “Right now I just want you to listen.”", "Que tu pareja pueda decirte sin rodeos «Ahora solo quiero que me escuches»."),
    ],
  },
  TCDL: {
    lines: [
      text("一直在旁边，一直在做，不说，也不慌。最安静的陪伴。", "You stay close and quietly keep things going. You bring a calm, steady kind of company.", "Sigues cerca, haciendo cosas sin ruido ni apuro. Tu manera de acompañar es serena y constante."),
      text("共处，不被逼着立刻表态。", "Time together without pressure to give an immediate answer.", "Compartir espacio sin que te exijan una respuesta inmediata."),
      text("太安静，对方不确定他在想什么。不满也放很久，可能攒成大事。", "Your silence can leave a partner guessing. Small grievances may stay with you for a long time and turn into bigger ones.", "Tu silencio puede hacer difícil saber qué piensas. Una molestia que guardas mucho tiempo puede terminar creciendo."),
      text("对方学会从他做的事里读出爱。自己要练习把不满在还小的时候说出来。", "A partner who notices the love in what you do. Practise bringing up a frustration while it is still small.", "Que tu pareja vea el cariño en lo que haces. Practica contar lo que te molesta mientras aún sea algo pequeño."),
    ],
  },
  SRWN: {
    lines: [
      text("各忙各的没关系，但消息要回，话要有。有事立刻说。", "You are happy doing your own thing, as long as messages get a reply and words of affection keep coming. When something happens, you speak up.", "Te parece bien que cada cual siga con lo suyo si hay conversación y los mensajes tienen respuesta. Si ocurre algo, lo dices enseguida."),
      text("独处被尊重，同时话语上保持联系。", "Respect for your time alone and ongoing contact through words.", "Que respeten tu tiempo a solas y mantengan el contacto con palabras."),
      text("「你又要自由，又要我随时在」，看着矛盾。其实距离和确认是两件事：可以不见面，不能没音讯。", "“You want freedom and you want me available” can sound contradictory. For you, space and reassurance are separate: time apart is fine; silence is harder.", "«Quieres libertad y a la vez que siempre esté ahí» puede sonar contradictorio. Para ti, espacio y señales son dos cosas distintas: pasar tiempo sin verse está bien; no saber nada cuesta más."),
      text("对方不黏人，但回消息靠谱。", "Someone who gives you room and can be counted on to reply.", "Alguien que te dé espacio y responda con constancia."),
    ],
  },
  SRWL: {
    lines: [
      text("需要独处，也需要听到在乎的话。有事先退回自己的空间想。", "You need solitude and affectionate words. When something bothers you, you retreat to your own space and think.", "Necesitas estar a solas y oír palabras de cariño. Si algo te inquieta, te retiras a tu espacio para pensarlo."),
      text("一句不带压力的话，比如「我在，你想好了来找我」。", "A few words without pressure, such as “I’m here. Come find me when you’re ready.”", "Una frase sin presión, como «Estoy aquí. Ven a buscarme cuando quieras»."),
      text("一有事就退开，对方以为他冷了。其实他在里面等那句话。", "Pulling back can look like cooling off toward someone, even as you wait for that small word of reassurance.", "Al retirarte, tu pareja puede creer que has perdido interés. Quizá sigas esperando esa frase que te dé tranquilidad."),
      text("对方不追着谈，但会留一句话在门口。", "Someone who gives you room to think and leaves a few kind words for you on the way out.", "Que tu pareja te deje pensar a tu ritmo y, al salir, te deje unas palabras de cariño."),
    ],
  },
  SRDN: {
    lines: [
      text("独立，不黏人，但很在意对方有没有把自己放在心上的实际举动。有事当场提。", "You value independence and pay close attention to actions that show you are on someone’s mind. You raise issues promptly.", "Valoras tu independencia y te fijas en los gestos concretos que muestran que cuentan contigo. Si algo te molesta, lo dices enseguida."),
      text("对方记得他说过的事，说到做到。", "Someone who remembers what you told them and follows through.", "Que tu pareja recuerde lo que le contaste y cumpla lo que dice."),
      text("平时什么都不要，却会因为「你忘了我说过的事」当场不高兴，对方觉得突然。", "You may rarely ask for anything, then speak up the moment a partner forgets a detail you shared. To them it can seem sudden.", "Casi nunca pides nada, pero si tu pareja olvida algo que dijiste puedes señalarlo en el acto. Puede tomarle por sorpresa."),
      text("对方靠得住，答应的事有着落。", "A dependable partner whose promises turn into action.", "Alguien de confianza que cumpla su palabra."),
    ],
  },
  SRDL: {
    lines: [
      text("独立，话少，有事不说，心里一直在看对方有没有把自己当回事。", "Independent and quiet, you watch for signs that you matter even when you say little about what bothers you.", "Con independencia y pocas palabras, te fijas en si tu pareja te tiene en cuenta, aunque calles lo que te preocupa."),
      text("持续、具体的小举动。", "Small, concrete gestures that keep coming over time.", "Pequeños gestos concretos y constantes."),
      text("十六型里最难读的一型。看着什么都不需要，失望是悄悄攒的，攒够了可能直接走远。", "Of the sixteen styles, yours can be the hardest to read. You may seem to need nothing while disappointments add up quietly, until you step away.", "Entre los dieciséis estilos, el tuyo puede ser el más difícil de leer. Puedes parecer alguien que no necesita nada, mientras las decepciones se acumulan hasta que te alejas."),
      text("对方定期主动问「最近我有没有让你失望的地方」。自己要练习在失望还小的时候提一句。", "A partner can ask, “Have I let you down in any way lately?” Try raising disappointments before they grow.", "Que tu pareja pregunte de vez en cuando «¿Te he decepcionado en algo últimamente?». Practica comentarlo mientras la decepción sea pequeña."),
    ],
  },
  SCWN: {
    lines: [
      text("独立、踏实、坦率。各过各的很安心，见面时什么都能聊，有事当场讲清。", "Independent, secure and candid, you are comfortable spending time apart. When together, you can talk about anything and clear the air on the spot.", "Tienes independencia, seguridad y franqueza. Te sientes a gusto cuando cada cual hace lo suyo. Al verse, pueden hablar de todo y aclarar lo que pasa en el momento."),
      text("自己的时间和空间，高质量的谈话。", "Time and space of your own, and conversations with substance.", "Tiempo y espacio propios, y conversaciones de calidad."),
      text("自己不需要确认，就容易忘了对方需要。直话加上距离，显得冷。", "Since you need little reassurance, it is easy to forget a partner might want more. Distance and direct words together can seem cold.", "Como necesitas pocas señales, se te puede olvidar que tu pareja sí las necesita. La distancia y la franqueza juntas pueden parecer frialdad."),
      text("对方也独立。碰上要回应的人，主动报个平安，能省掉很多误会。", "Another independent person can feel natural to you. With someone who needs reassurance, a quick check-in can prevent misunderstandings.", "Alguien que también valore su independencia. Si tu pareja necesita señales, un breve mensaje por iniciativa propia puede evitar malentendidos."),
    ],
  },
  SCWL: {
    lines: [
      text("独立、踏实，爱放在深谈里，有事想透了再说。像隔一阵写来一封长信的人。", "Independent and secure, you put affection into deep conversations and think things through before speaking. You are like someone who writes a long letter every so often.", "Tienes independencia y seguridad. Expresas el cariño en conversaciones profundas y reflexionas antes de hablar, como quien de vez en cuando escribe una carta larga."),
      text("不被催。", "Time without being rushed.", "Que no te apuren."),
      text("联系不频繁，遇事又慢，急的人会觉得被晾着。", "When contact is infrequent and you take your time with difficult topics, a partner who wants to talk sooner may feel left waiting.", "Si el contacto es poco frecuente y te tomas tiempo para hablar, la otra persona puede sentir que la dejas esperando."),
      text("自己给出一个时间，比如「周末我们聊」，对方就等得住。", "Offer a time yourself, such as “Let’s talk this weekend.” It makes the wait easier.", "Propón tú un momento, por ejemplo «Hablemos este fin de semana». Así será más fácil esperar."),
    ],
  },
  SCDN: {
    lines: [
      text("不黏、不问、不绕弯，事情来了就处理。", "You give people room, rarely ask for reassurance and get straight to the point. When something needs doing, you handle it.", "Das espacio, pides pocas señales y vas al grano. Cuando aparece un problema, te ocupas."),
      text("各自的空间，直接的沟通，少猜。", "Space for each of you, direct conversation and little guesswork.", "Espacio para cada cual, comunicación directa y poco que adivinar."),
      text("把关系经营得像合作，效率很高，对方却感觉不到温度。", "The relationship can run as efficiently as a work partnership while your partner misses warmth.", "La relación puede funcionar con la eficacia de un equipo de trabajo y, aun así, tu pareja puede echar de menos la calidez."),
      text("对方看重可靠胜过甜言蜜语。自己偶尔做一件没有用处、只为对方高兴的事。", "Someone who values reliability more than sweet words. Occasionally do something just to make your partner happy, even when it serves no practical purpose.", "Alguien que valore la fiabilidad más que las palabras dulces. Haz de vez en cuando algo por el simple gusto de alegrarle el día."),
    ],
  },
  SCDL: {
    lines: [
      text("最独立，最安静。爱是长期地、不出声地在那里。", "You are the most independent and the quietest. Your love is a steady presence that lasts without drawing attention to itself.", "De todos los estilos, el tuyo es el más independiente y silencioso. Tu amor es una presencia discreta y duradera."),
      text("大量自主，被信任。", "A great deal of autonomy and a partner’s trust.", "Mucha autonomía y sentir que confían en ti."),
      text("几乎不发出信号，对方很难知道自己在他心里的位置。不满也不提，可能某天才发现两人已经很远。", "With few visible signals, a partner can struggle to tell where they stand. If frustrations stay unspoken, you may discover how far apart you have grown only much later.", "Si apenas das señales, puede costarle a tu pareja saber qué lugar ocupa para ti. Si además callas lo que te molesta, quizá tarden en advertir cuánto se han distanciado."),
      text("对方自己心里也踏实。自己最该练的一件事，是偶尔把话说出口。", "A partner who feels secure in the relationship. The most useful thing to practise is saying out loud, once in a while, what you have kept inside.", "Alguien que también sienta seguridad en la relación. Lo más útil que puedes practicar es decir de vez en cuando lo que llevas dentro."),
    ],
  },
};

export const axes = {
  distance: { name: text("距离", "Closeness", "Cercanía"), pair: "TS" },
  reassurance: { name: text("确认", "Reassurance", "Confirmación"), pair: "RC" },
  language: { name: text("语言", "Receiving love", "Cómo recibes cariño"), pair: "WD" },
  conflict: { name: text("分歧", "Disagreement", "Desacuerdos"), pair: "NL" },
};

export const poles = {
  T: text("共处偏好", "Shared time", "Tiempo en pareja"),
  S: text("独处偏好", "Personal space", "Espacio propio"),
  R: text("高确认需求", "More reassurance", "Mayor necesidad de confirmación"),
  C: text("低确认需求", "Less reassurance", "Menor necesidad de confirmación"),
  W: text("言语偏好", "Words of affection", "Palabras de afecto"),
  D: text("行动偏好", "Acts of care", "Gestos de cuidado"),
  N: text("即时沟通", "Talk right away", "Hablar en el momento"),
  L: text("延后沟通", "Talk after a pause", "Hablar tras una pausa"),
};

export const headings = [
  text("样子", "What you are like", "Cómo eres en pareja"),
  text("需要", "What you need", "Lo que necesitas"),
  text("容易被误解", "How you can be misread", "Cómo pueden malinterpretarte"),
  text("自在的相处", "What helps you feel at ease", "Qué te ayuda a sentirte a gusto"),
];

export function preferenceLabel(code, language) {
  return Array.from(code, letter => poles[letter][language]).join(" · ");
}

export const patterns = {
  distance: {
    name: text("远近差", "Near and far", "Cerca y lejos"),
    body: text("想多待一会儿的人可能觉得被冷落，想自己待一会儿的人可能觉得被缠着。先约好下一次相聚，各自的时间就更容易安排。", "One of you may feel left out just as the other starts to feel crowded. Agreeing when to meet again can make time apart easier.", "Una persona puede sentirse relegada justo cuando la otra empieza a sentirse agobiada. Acordar cuándo volver a verse puede facilitar ese tiempo a solas."),
  },
  reassurance: {
    name: text("一问一默", "Ask and assume", "Una pregunta y un silencio"),
    body: text("一个人想听一句「我还在」，另一个人心里却是「我们一直都好好的」。一句没回复的消息，在两个人那里可能有不同的分量。", "One of you longs to hear “I’m here” while the other assumes everything is fine. An unanswered message can carry a different weight for each of you.", "Una persona necesita oír «aquí estoy» y la otra da por hecho que todo va bien. Un mensaje sin respuesta puede pesar de manera distinta para cada cual."),
  },
  language: {
    name: text("说做错位", "Words and deeds", "Palabras y gestos"),
    body: text("一句喜欢和一件办妥的小事，对你们的分量不同。一方可能一直等那句话，另一方最想看见的是事情真的有人接过去。", "A loving word and a task taken care of carry different weight for you. One of you may be waiting to hear the words while the other looks for a concrete gesture.", "Una palabra cariñosa y una tarea resuelta tienen distinto peso para ustedes. Una persona puede estar esperando escuchar esa frase, y la otra, ver un gesto concreto."),
  },
  conflict: {
    name: text("一追一退", "Pursue and pause", "Insistir y tomar aire"),
    body: text("一个人越想当场说清，另一个人越需要空间。追问可能让对方更想退开，沉默也可能让想谈的人更着急。", "The more one of you wants to talk now, the more space the other may need. Another question can feel like pressure, while silence can leave the person who wants to talk more anxious.", "Cuanto más quiere hablar una persona, más espacio puede necesitar la otra. Otra pregunta puede sentirse como presión, y el silencio puede inquietar más a quien quiere hablar."),
  },
  same: {
    name: text("同频", "In sync", "En sintonía"),
    body: text("四项偏好都相同。可以从分歧时的节奏、平时需要的回应谈起。", "All four preferences match. Start with how you handle disagreement and what helps you feel reassured.", "Coinciden en las cuatro preferencias. Pueden empezar por cómo afrontan los desacuerdos y qué les da seguridad."),
  },
};

export const headlineOrder = ["conflict", "reassurance", "distance", "language"];
