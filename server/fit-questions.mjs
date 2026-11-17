const tr = (zh, en, es) => ({ zh, en, es });
const option = (id, text, meaning) => ({ id, text: tr(...text), meaning: tr(...meaning) });
const question = (id, text, rows) => ({ id, text: tr(...text), options: rows.map((row, index) => option(String(index), row[0], row[1])) });

// Options describe plausible choices in a specific situation. They never rank people.
// The first situation in each module is the six-question introduction.
export const fitModules = [
  {
    id: "personality", title: tr("性格与生活节奏", "Personality & pace", "Personalidad y ritmo"),
    description: tr("遇到新鲜事和空闲时间，你怎样进入状态？", "How you approach new experiences and free time.", "Cómo te acercas a lo nuevo y al tiempo libre."),
    advice: [
      tr("试着各留一个确定的安排和一段自由时间，看看哪种节奏让你们更自在。", "Try one agreed plan and one open stretch of time. Notice which pace suits each of you.", "Prueben un plan acordado y un rato libre. Vean qué ritmo les sienta mejor."),
      tr("先告诉对方你想保留哪一点随性，再一起确定必须提前说好的部分。", "Say where you'd like some spontaneity, then agree on the details that need planning.", "Di dónde te gustaría improvisar y acuerden qué detalles necesitan un plan."),
      tr("各自说出这次最想一起做的一件事，再选一个都愿意试的安排。", "Each name one thing you'd like to do together, then choose something you both want to try.", "Digan una cosa que les apetezca hacer juntos y elijan algo que ambos quieran probar."),
      tr("说清楚你想独自充电多久，以及什么时候回来一起做点什么。", "Say how much solo time helps you recharge and when you'd like to reconnect.", "Explica cuánto tiempo a solas te ayuda a recargar y cuándo quieres volver a conectar."),
    ],
    questions: [
      question("personality-weekend", ["周末突然空出半天，你通常先做什么？", "A free half-day opens up this weekend. What do you do first?", "De pronto tienes medio día libre. ¿Qué haces primero?"], [
        [["挑一件早就想做的事，安排一下", "Pick something I've been meaning to do and plan it", "Elegir algo pendiente y organizarlo"], ["这个场景里，你喜欢把空闲变成一个具体安排。", "Here, you like turning free time into a concrete plan.", "En esta situación prefieres convertir el tiempo libre en un plan concreto."]],
        [["先出门，路上再决定", "Head out and decide as I go", "Salir y decidir sobre la marcha"], ["这个场景里，你享受边走边发现的余地。", "Here, you enjoy leaving room for discovery.", "Aquí disfrutas dejando espacio para descubrir."]],
        [["问问 TA 有没有想一起做的", "Ask what my partner feels like doing together", "Preguntar qué le apetece hacer a mi pareja"], ["这个场景里，你会先把两个人的意愿放到一起看。", "Here, you start by bringing both people's wishes together.", "Aquí empiezas por juntar los deseos de ambos."]],
        [["先给自己留一会儿，之后再联系", "Take a little time to myself, then reconnect", "Tomarme un rato a solas y después conectar"], ["这个场景里，你希望先恢复自己的精力。", "Here, you prefer to restore your own energy first.", "Aquí prefieres recuperar primero tu energía."]],
      ]),
      question("personality-new-place", ["两人第一次到一个陌生城市，你更想怎么逛？", "You're visiting a new city together. How would you explore?", "Visitan una ciudad nueva. ¿Cómo te gustaría conocerla?"], [
        [["先看地图，挑好两三个地方", "Map out two or three places first", "Elegir primero dos o tres sitios en el mapa"], ["面对陌生环境，你会用一点准备减少不确定。", "In an unfamiliar place, a little preparation helps you settle in.", "En un lugar nuevo, preparar un poco te ayuda a ubicarte."]],
        [["看哪条街有意思就走过去", "Follow whichever street looks interesting", "Seguir la calle que parezca interesante"], ["面对陌生环境，你愿意让当下的好奇带路。", "In a new place, you're happy to let curiosity lead.", "En un lugar nuevo dejas que la curiosidad guíe el camino."]],
        [["每人挑一个地方，轮流带路", "Take turns choosing a stop", "Elegir un sitio cada uno y turnarnos"], ["这次探索里，你希望两个人都有参与的空间。", "Here, you want both people to help shape the experience.", "Aquí quieres que ambos participen en la experiencia."]],
        [["先各逛一会儿，再约好碰面", "Explore separately for a bit, then meet up", "Explorar un rato por separado y reunirnos después"], ["这次探索里，你也看重各自发现的空间。", "Here, you value having space for individual discoveries too.", "Aquí también valoras el espacio para descubrir por tu cuenta."]],
      ]),
      question("personality-change", ["出门前一小时计划有变，你第一步更可能是？", "Plans change an hour before you leave. What's your first move?", "El plan cambia una hora antes de salir. ¿Qué haces primero?"], [
        [["把新的时间和路线理清楚", "Work out the new timing and route", "Aclarar la nueva hora y la ruta"], ["计划变化时，你倾向先重新建立清楚的安排。", "When plans shift, you tend to rebuild a clear structure.", "Cuando cambia el plan, tiendes a reorganizarlo con claridad."]],
        [["看看有什么临时替代方案", "Look for a spontaneous alternative", "Buscar otra opción sobre la marcha"], ["计划变化时，你比较愿意即兴找新选择。", "When plans shift, you're open to improvising.", "Cuando cambia el plan, te abres a improvisar."]],
        [["先问 TA 现在最想保留什么", "Ask what matters most to my partner now", "Preguntar qué le importa mantener a mi pareja"], ["计划变化时，你会先确认对方在意的部分。", "When plans shift, you first check what your partner cares about.", "Cuando cambia el plan, primero miras qué le importa a tu pareja."]],
        [["留十分钟想一想再决定", "Take ten minutes to think before deciding", "Tomarme diez minutos antes de decidir"], ["计划变化时，你喜欢有一点整理思路的时间。", "When plans shift, you appreciate a little thinking time.", "Cuando cambia el plan, agradeces un rato para pensar."]],
      ]),
    ],
  },
  {
    id: "closeness", title: tr("亲密与安全感", "Closeness & reassurance", "Cercanía y seguridad"),
    description: tr("联系的频率、独处和安心感。", "Contact, personal space, and what helps you feel secure.", "Contacto, espacio propio y lo que te da tranquilidad."),
    advice: [
      tr("聊聊一天里哪一种小联系最有用，也约好忙时怎么简短告知。", "Choose a small daily check-in that helps, and agree how to signal a busy day.", "Elijan un pequeño contacto diario útil y cómo avisarse cuando estén ocupados."),
      tr("一起留出能专心相处的时间，允许其他时段各忙各的。", "Set aside some focused time together and allow room for separate activities in between.", "Reserven tiempo de calidad juntos y espacio para sus actividades entre esos momentos."),
      tr("把需要独处和仍然在乎对方同时说出来，再约一个重新联系的时间。", "Express both your need for space and your care, then agree when to reconnect.", "Expresa que necesitas espacio y que te importa tu pareja; acuerden cuándo reconectar."),
      tr("互相说出本周让自己安心的一件小事，再选一个双方舒服的联系节奏。", "Share one small thing that would reassure you this week and agree on a comfortable rhythm.", "Digan un detalle que les daría tranquilidad esta semana y acuerden un ritmo cómodo."),
    ],
    questions: [
      question("closeness-busy", ["TA 今天特别忙，你最希望收到哪种联系？", "Your partner has a very busy day. What kind of contact would feel best?", "Tu pareja tiene un día muy ocupado. ¿Qué contacto te vendría mejor?"], [
        [["中间几句简短消息", "A few short messages along the way", "Unos mensajes cortos durante el día"], ["忙碌时，零碎的小联系更能让你感到靠近。", "On busy days, small moments of contact help you feel close.", "En días ocupados, los pequeños contactos te hacen sentir cercanía."]],
        [["晚上留一段专心聊的时间", "A focused catch-up in the evening", "Un rato por la noche para hablar con calma"], ["忙碌时，你更期待一段能专心相处的时间。", "On busy days, you look forward to focused time together.", "En días ocupados, esperas un momento para estar presentes de verdad."]],
        [["先说一声忙完再联系就好", "A heads-up that we'll talk when they're free", "Que avise que hablaremos cuando se desocupe"], ["忙碌时，一句交代加上各自的空间会让你舒服。", "On busy days, a heads-up and some independence feel comfortable.", "En días ocupados, te viene bien un aviso y tener espacio propio."]],
        [["告诉我大概何时能聊，我好安排", "An idea of when we'll talk so I can plan", "Saber más o menos cuándo hablaremos para organizarme"], ["忙碌时，你喜欢对下一次联系有个大致预期。", "On busy days, knowing roughly when you'll reconnect helps.", "En días ocupados, saber cuándo reconectarán te ayuda."]],
      ]),
      question("closeness-reunion", ["几天没见后，第一段相处时间你想怎样过？", "You reunite after a few days apart. How would you spend the first stretch?", "Se reencuentran tras unos días. ¿Cómo pasarías el primer rato?"], [
        [["拥抱着交换这几天的小事", "Hug and trade little stories", "Abrazarnos y contarnos pequeñas cosas"], ["重逢时，你会通过即时交流找回亲密。", "At a reunion, immediate sharing helps you reconnect.", "Al reencontrarse, compartir enseguida te ayuda a conectar."]],
        [["一起吃顿饭，把手机放远一点", "Have a meal with phones put away", "Comer juntos dejando los teléfonos aparte"], ["重逢时，专心陪伴对你很有分量。", "At a reunion, undivided attention matters to you.", "Al reencontrarse, la atención plena tiene valor para ti."]],
        [["先安顿和休息，之后再一起待着", "Settle in and rest before hanging out", "Instalarme y descansar antes de estar juntos"], ["重逢时，你会先照顾精力，再进入相处。", "At a reunion, you prefer to restore your energy before connecting.", "Al reencontrarse, prefieres recuperar energía antes de compartir."]],
        [["问问彼此现在最需要什么", "Ask what each of us needs right now", "Preguntar qué necesita cada uno ahora"], ["重逢时，你会根据双方当下状态调整。", "At a reunion, you adapt to what both people need in the moment.", "Al reencontrarse, te adaptas al estado de ambos."]],
      ]),
      question("closeness-away", ["这周末你们各有安排，你会怎样保持联系？", "You have separate plans this weekend. How would you keep in touch?", "Este fin de semana tienen planes por separado. ¿Cómo mantendrías el contacto?"], [
        [["遇到有意思的事就发给 TA", "Send interesting little moments as they happen", "Mandar momentos interesantes al vivirlos"], ["分开活动时，你喜欢自然分享小片段。", "During separate activities, you enjoy sharing little moments naturally.", "Al hacer cosas por separado, te gusta compartir momentos espontáneos."]],
        [["约一个晚上的电话", "Arrange one evening call", "Acordar una llamada por la noche"], ["分开活动时，你希望保留一段专门的相处。", "During separate activities, you value a dedicated moment together.", "Al hacer cosas por separado, valoras un rato reservado para ambos."]],
        [["各自好好玩，结束再慢慢说", "Enjoy our plans and catch up afterward", "Disfrutar cada uno y contarnos después"], ["分开活动时，你能享受各自完整的时间。", "During separate activities, you enjoy having uninterrupted time.", "Al hacer cosas por separado, disfrutas de tu tiempo sin interrupciones."]],
        [["提前问好对方喜欢怎么联系", "Agree in advance on how we'd like to check in", "Acordar antes cómo nos gustaría comunicarnos"], ["分开活动时，你会先谈好双方的期待。", "During separate activities, you first align your expectations.", "Al hacer cosas por separado, primero aclaras las expectativas de ambos."]],
      ]),
    ],
  },
  {
    id: "care", title: tr("表达爱与被照顾", "Giving & receiving care", "Dar y recibir cariño"),
    description: tr("哪些日常小事让你感到被放在心上？", "The small things that help you feel cared for.", "Los pequeños gestos que te hacen sentir querido."),
    advice: [
      tr("告诉对方一句你最近特别想听到的话，也问问 TA 想听什么。", "Share one thing you'd love to hear lately, and ask what your partner would like to hear.", "Comparte algo que te gustaría escuchar y pregunta qué le gustaría oír a tu pareja."),
      tr("各挑一件本周可以替对方分担的小事，先问过再做。", "Each choose one small task to help with this week, checking first that it's welcome.", "Elijan una tarea pequeña para aliviar la semana del otro, preguntando antes."),
      tr("留出一段不被打断的相处，各自挑一种轻松的活动。", "Make room for uninterrupted time and each suggest a relaxing activity.", "Reserven un rato sin interrupciones y propongan una actividad tranquila cada uno."),
      tr("互相分享一个会被自己注意到的小细节，给彼此一点具体线索。", "Share a small detail you'd notice so each of you has a concrete clue.", "Compartan un detalle que notarían para darle al otro una pista concreta."),
    ],
    questions: [
      question("care-long-day", ["一天很累，TA 做哪件小事会让你最有被照顾的感觉？", "After an exhausting day, which small gesture would feel most caring?", "Tras un día agotador, ¿qué gesto te haría sentir más cuidado?"], [
        [["认真听我说几分钟", "Listen closely for a few minutes", "Escucharme con atención unos minutos"], ["这个时候，你尤其看重被听见和理解。", "At this moment, being heard and understood matters to you.", "En ese momento valoras que te escuchen y comprendan."]],
        [["帮我接手一件手边的事", "Take one task off my hands", "Encargarse de algo que tengo pendiente"], ["这个时候，实际分担能让你感到支持。", "At this moment, practical help feels supportive.", "En ese momento, la ayuda práctica te hace sentir apoyo."]],
        [["陪我安静吃饭或走一会儿", "Have a quiet meal or walk with me", "Comer o pasear conmigo con calma"], ["这个时候，轻松的陪伴对你很重要。", "At this moment, easy companionship matters to you.", "En ese momento, la compañía tranquila importa para ti."]],
        [["带一件记得我喜欢的小东西", "Bring a little thing they remembered I like", "Traer un detalle que recuerde que me gusta"], ["这个时候，被记住的喜好会让你感到被惦记。", "At this moment, a remembered preference helps you feel thought of.", "En ese momento, recordar tus gustos te hace sentir presente para el otro."]],
      ]),
      question("care-good-news", ["你有件小事做成了，最期待 TA 怎么庆祝？", "You've had a little win. How would you like your partner to celebrate?", "Lograste algo pequeño. ¿Cómo te gustaría celebrarlo con tu pareja?"], [
        [["说出 TA 注意到的努力", "Tell me what effort they noticed", "Decirme qué esfuerzo notó"], ["庆祝时，你喜欢努力被具体看见。", "When celebrating, you like your effort to be noticed specifically.", "Al celebrar, te gusta que se reconozca tu esfuerzo concreto."]],
        [["帮我腾出时间放松一下", "Help clear some time for me to relax", "Ayudarme a liberar un rato para descansar"], ["庆祝时，你会珍惜能轻松下来的支持。", "When celebrating, you appreciate support that lets you unwind.", "Al celebrar, aprecias el apoyo que te permite relajarte."]],
        [["一起吃点好的，聊聊经过", "Share a nice meal and hear the story", "Comer algo rico y contar cómo fue"], ["庆祝时，你想把好心情变成共同经历。", "When celebrating, you want to turn the moment into a shared experience.", "Al celebrar, quieres convertir el momento en una experiencia compartida."]],
        [["留一张照片或小纸条", "Keep a photo or a little note", "Guardar una foto o una notita"], ["庆祝时，你喜欢留下能回看的具体纪念。", "When celebrating, you like keeping a tangible memory.", "Al celebrar, te gusta guardar un recuerdo concreto."]],
      ]),
      question("care-give", ["想在普通的一天关心 TA，你最自然会做什么？", "On an ordinary day, how do you most naturally show care?", "En un día normal, ¿cómo te sale más natural mostrar cariño?"], [
        [["发一句具体的鼓励或感谢", "Send a specific encouragement or thank-you", "Mandar un ánimo o agradecimiento concreto"], ["表达关心时，你倾向把心意说出来。", "When showing care, you tend to put it into words.", "Al mostrar cariño, tiendes a expresarlo con palabras."]],
        [["顺手做好 TA 挂心的一件事", "Help with something that's been on their mind", "Ayudar con algo que le preocupa"], ["表达关心时，你倾向通过行动分担。", "When showing care, you tend to help through action.", "Al mostrar cariño, tiendes a ayudar con acciones."]],
        [["约 TA 一起做点轻松的事", "Invite them to do something low-key together", "Invitarle a hacer algo tranquilo juntos"], ["表达关心时，你倾向创造相处的时间。", "When showing care, you tend to create time together.", "Al mostrar cariño, tiendes a crear tiempo para ambos."]],
        [["记住 TA 随口提过的喜好", "Remember a preference they mentioned casually", "Recordar un gusto que mencionó de pasada"], ["表达关心时，你会留意对方的小细节。", "When showing care, you notice your partner's little details.", "Al mostrar cariño, te fijas en los detalles de tu pareja."]],
      ]),
    ],
  },
  {
    id: "conflict", title: tr("分歧与修复", "Disagreement & repair", "Desacuerdos y reparación"),
    description: tr("有了分歧，你需要怎样的节奏才能重新靠近？", "What helps you reconnect after a disagreement.", "Qué te ayuda a reconectar después de un desacuerdo."),
    advice: [
      tr("先确认两个人现在都有精力聊，再各用一句话说自己最在意什么。", "Check that you both have energy to talk, then each name what matters most.", "Comprueben que ambos tienen energía para hablar y digan qué les importa más."),
      tr("如果要暂停，说清楚大概多久回来，再按时接上这段对话。", "If you pause, agree roughly when to return and follow through.", "Si hacen una pausa, acuerden cuándo volver y retomen la conversación."),
      tr("可以先写下事实、感受和希望，约好之后一起读一遍。", "Try writing the facts, feelings, and wishes first, then read them together.", "Prueben escribir hechos, sentimientos y deseos, y luego leerlos juntos."),
      tr("一起挑一个下次能做到的小改变，并约好怎么知道它有没有帮助。", "Pick one small change for next time and agree how you'll know whether it helps.", "Elijan un cambio pequeño para la próxima vez y cómo sabrán si ayudó."),
    ],
    questions: [
      question("conflict-first", ["聊天有点僵住，你更希望下一步怎么做？", "A conversation feels stuck. What would you prefer next?", "La conversación se atasca. ¿Qué preferirías hacer después?"], [
        [["趁还记得，慢慢说清楚", "Talk it through while it's still fresh", "Hablarlo con calma mientras está reciente"], ["这次分歧里，你希望及时把话说清楚。", "In this disagreement, you prefer to work toward clarity promptly.", "En este desacuerdo prefieres aclararlo pronto."]],
        [["先歇一会儿，约好晚点接着聊", "Take a break and agree when to come back", "Descansar un rato y acordar cuándo retomarlo"], ["这次分歧里，你需要一点恢复情绪的时间。", "In this disagreement, a little recovery time would help you.", "En este desacuerdo te ayudaría un tiempo para recuperar la calma."]],
        [["先把想说的写下来", "Write down what I want to say first", "Escribir primero lo que quiero decir"], ["这次分歧里，书面整理会帮助你表达。", "In this disagreement, writing would help you express yourself.", "En este desacuerdo, escribir te ayudaría a expresarte."]],
        [["先找一个今天能解决的小点", "Start with one small thing we can resolve today", "Empezar por un detalle que podamos resolver hoy"], ["这次分歧里，你想从一个具体进展开始。", "In this disagreement, you want to start with a concrete step.", "En este desacuerdo quieres empezar con un avance concreto."]],
      ]),
      question("conflict-repair", ["一段不愉快过后，哪种开场最容易让你重新聊起来？", "After a tense moment, what opening would help you talk again?", "Tras un momento tenso, ¿qué inicio te ayudaría a volver a hablar?"], [
        [["问我刚才最难受的地方", "Ask what felt hardest for me", "Preguntarme qué me dolió más"], ["重新接近时，你想先让自己的感受被听见。", "When reconnecting, you first want your feelings to be heard.", "Al reconectar, primero quieres que se escuchen tus sentimientos."]],
        [["确认彼此缓过来了，再谈", "Check we're both calmer before talking", "Comprobar que estamos más tranquilos antes de hablar"], ["重新接近时，你重视两个人是否准备好了。", "When reconnecting, readiness matters to you.", "Al reconectar, te importa que ambos estén preparados."]],
        [["给我一段认真写过的话", "Send a thoughtfully written message", "Mandarme un mensaje pensado con cuidado"], ["重新接近时，经过整理的话会让你更容易接住。", "When reconnecting, thoughtful wording feels easier to take in.", "Al reconectar, las palabras meditadas te resultan más fáciles de recibir."]],
        [["提出下次可以试的一种做法", "Suggest something we could try next time", "Proponer algo que podamos intentar la próxima vez"], ["重新接近时，你希望看见下一步的实际改变。", "When reconnecting, you want to see a practical next step.", "Al reconectar, quieres ver un siguiente paso práctico."]],
      ]),
      question("conflict-repeat", ["同一个小问题又出现，你最想先做哪一步？", "A familiar small problem comes up again. What would you do first?", "Vuelve un pequeño problema conocido. ¿Qué harías primero?"], [
        [["各说这次为什么在意它", "Each explain why it matters this time", "Explicar cada uno por qué le importa esta vez"], ["面对重复问题，你会先了解这次各自的感受。", "With a recurring issue, you first explore what it means this time.", "Ante un tema repetido, primero buscas lo que significa esta vez."]],
        [["先找个两个人都不赶时间的时候", "Find a time when neither of us is rushed", "Buscar un momento en que ninguno tenga prisa"], ["面对重复问题，你会先给沟通留出合适的时机。", "With a recurring issue, you first make room for a good conversation.", "Ante un tema repetido, primero buscas un buen momento para hablar."]],
        [["把上次说好的翻出来一起看", "Revisit what we agreed last time", "Revisar juntos lo que acordamos antes"], ["面对重复问题，你会借助已有记录理清经过。", "With a recurring issue, you use the earlier agreement to find clarity.", "Ante un tema repetido, usas el acuerdo anterior para aclararlo."]],
        [["试一个更容易做到的新安排", "Try a new arrangement that's easier to keep", "Probar un acuerdo nuevo más fácil de cumplir"], ["面对重复问题，你愿意调整原来的做法。", "With a recurring issue, you're willing to adjust the approach.", "Ante un tema repetido, estás dispuesto a ajustar la forma de actuar."]],
      ]),
    ],
  },
  {
    id: "boundaries", title: tr("边界与自主", "Boundaries & independence", "Límites y autonomía"),
    description: tr("朋友、独处和共同决定怎样相处舒服？", "Friends, personal time, and decisions you share.", "Amistades, tiempo propio y decisiones compartidas."),
    advice: [
      tr("各说出一项希望自己决定的事，以及怎样告知会让彼此舒服。", "Name one choice you'd like to make yourself and how you'd like to keep each other informed.", "Digan una decisión que quieren tomar por su cuenta y cómo prefieren avisarse."),
      tr("把需要提前告知的事说具体，再确认对方同样愿意这么做。", "Be specific about what deserves a heads-up and check that it works for both of you.", "Concreten qué merece un aviso y comprueben que funciona para ambos."),
      tr("一起约一条双方都能做到的边界，保留重新商量的机会。", "Agree on one boundary you can both respect and leave room to revisit it.", "Acuerden un límite que ambos puedan respetar y dejen espacio para revisarlo."),
      tr("遇到拿不准的场景，先问这一次的意愿，再决定怎么做。", "When a situation feels unclear, ask about the preference for this occasion before acting.", "Cuando una situación no esté clara, pregunten qué prefiere cada uno antes de actuar."),
    ],
    questions: [
      question("boundaries-friends", ["朋友临时约你今晚出去，你更自然会怎么安排？", "A friend invites you out tonight at short notice. What feels natural?", "Una amistad te invita a salir esta noche. ¿Qué te sale más natural?"], [
        [["确认自己有空，再告诉 TA 我的安排", "Check I'm free, then tell my partner my plans", "Ver si estoy libre y contarle el plan a mi pareja"], ["这次私人安排里，你看重自主决定和清楚告知。", "For this personal plan, you value deciding independently and keeping your partner informed.", "En este plan personal valoras decidir por tu cuenta e informar a tu pareja."]],
        [["先看看会不会影响原来约好的时间", "Check whether it affects time we'd already agreed on", "Ver si afecta el tiempo que ya habíamos acordado"], ["这次私人安排里，你会先照顾已有的共同约定。", "For this personal plan, you first consider commitments you've already made together.", "En este plan personal, primero cuidas los compromisos compartidos."]],
        [["按我们已经谈好的习惯来", "Follow the approach we've already agreed on", "Seguir lo que ya habíamos acordado"], ["这次私人安排里，你喜欢双方已经明确的边界。", "For this personal plan, you appreciate boundaries you've clarified together.", "En este plan personal aprecias los límites que ya aclararon juntos."]],
        [["问问 TA 今晚有没有特别想一起做的事", "Ask whether my partner had something special in mind tonight", "Preguntar si mi pareja tenía algo especial en mente"], ["这次私人安排里，你会根据当晚的需要再商量。", "For this personal plan, you check in about the needs of this particular evening.", "En este plan personal consultas las necesidades de esa noche."]],
      ]),
      question("boundaries-photo", ["拍到一张两个人的合照，你想发到社交平台时会？", "You have a photo of you both. What do you do before posting it?", "Tienes una foto de ambos. ¿Qué haces antes de publicarla?"], [
        [["按各自账号的习惯，先说一声", "Mention it and follow our usual individual account habits", "Avisar y seguir la costumbre de nuestras cuentas"], ["这次分享里，你会沿用日常的自主安排。", "For this photo, you would follow your usual independent approach.", "Para esta foto seguirías la forma habitual de cada uno."]],
        [["告诉 TA 准备发哪张和配文", "Show which photo and caption I have in mind", "Mostrar la foto y el texto que pienso usar"], ["这次分享里，提前告知具体内容对你重要。", "For this photo, sharing the specific content ahead of time matters to you.", "Para esta foto, te importa avisar del contenido concreto."]],
        [["看我们之前说好的哪些能公开", "Check what we previously agreed to share publicly", "Revisar qué habíamos acordado hacer público"], ["这次分享里，你会参考两个人已有的公开范围。", "For this photo, you refer to the sharing boundaries you've already agreed on.", "Para esta foto recurres a los límites de publicación ya acordados."]],
        [["这次先让 TA 挑愿意公开的那张", "Ask which photo they'd like shared this time", "Preguntar qué foto le gustaría compartir esta vez"], ["这次分享里，你希望具体确认对方的意愿。", "For this photo, you want to check your partner's preference for this occasion.", "Para esta foto quieres confirmar la preferencia de tu pareja esta vez."]],
      ]),
      question("boundaries-alone", ["你想留一个晚上独处，通常会怎样表达？", "You'd like an evening to yourself. How would you bring it up?", "Quieres una noche para ti. ¿Cómo lo plantearías?"], [
        [["说出自己的安排，约好之后再聊", "Explain my plan and arrange a later catch-up", "Explicar mi plan y acordar hablar después"], ["独处时，你会用清楚告知保留个人空间。", "For solo time, you preserve personal space with a clear heads-up.", "Para tu tiempo propio, preservas espacio avisando con claridad."]],
        [["先确认没有占用已经约好的时间", "Check it doesn't replace time we'd already planned", "Comprobar que no reemplaza un plan ya acordado"], ["独处时，你会先兼顾既有的共同安排。", "For solo time, you first consider shared commitments.", "Para tu tiempo propio, primero cuidas los planes compartidos."]],
        [["提议每周都各留一段自己的时间", "Suggest we each keep some regular solo time", "Proponer tiempo propio habitual para cada uno"], ["独处时，你喜欢通过稳定安排形成共识。", "For solo time, you like establishing a shared routine.", "Para tu tiempo propio, te gusta acordar una rutina."]],
        [["问这晚是否方便，再一起选时间", "Ask if that evening works and choose a time together", "Preguntar si esa noche viene bien y elegirla juntos"], ["独处时，你愿意就具体时间共同调整。", "For solo time, you're willing to negotiate the particular timing.", "Para tu tiempo propio, estás dispuesto a ajustar el momento juntos."]],
      ]),
    ],
  },
  {
    id: "future", title: tr("金钱、家庭与未来", "Money, family & the future", "Dinero, familia y futuro"),
    description: tr("看看你们怎样做取舍，哪些事值得提前聊。", "How you make trade-offs and what deserves a conversation.", "Cómo toman decisiones y qué conviene conversar."),
    advice: [
      tr("各说一项想守住的稳定感，再聊聊可以为新体验留多少空间。", "Each name one source of stability you'd like to protect, then discuss room for new experiences.", "Digan una fuente de estabilidad que quieran cuidar y cuánto espacio dejar para experiencias nuevas."),
      tr("各说一个值得投入的体验，再一起定一个舒服的预算或时间范围。", "Each name an experience worth investing in, then agree on a comfortable budget or time frame.", "Digan una experiencia que valga la pena y acuerden un presupuesto o plazo cómodo."),
      tr("把共同部分和各自部分写清楚，约好什么变化会让你们重新商量。", "Clarify what is shared and what remains individual, and when you'd revisit the arrangement.", "Aclaren qué es compartido y qué es individual, y cuándo revisarían el acuerdo."),
      tr("先选一件近期真实要决定的事，各讲最在意的条件，再找共同空间。", "Choose one real upcoming decision, share your most important conditions, and find common ground.", "Elijan una decisión cercana, compartan sus condiciones importantes y busquen terreno común."),
    ],
    questions: [
      question("future-money", ["两个人多出一笔可支配的钱，你最想先聊哪件事？", "You have some extra money available as a couple. What would you discuss first?", "Tienen algo de dinero extra como pareja. ¿Qué hablarías primero?"], [
        [["先留一部分给以后安心", "Set some aside for future peace of mind", "Guardar una parte para el futuro"], ["这笔钱的安排里，你会先照顾稳定和余地。", "For this money decision, you first consider security and flexibility.", "En esta decisión de dinero, primero cuidas la estabilidad y el margen."]],
        [["有没有一直想一起体验的事", "An experience we've wanted to share", "Alguna experiencia que queramos vivir juntos"], ["这笔钱的安排里，你会想到共同经历的价值。", "For this money decision, shared experiences come to mind.", "En esta decisión de dinero, piensas en el valor de las experiencias compartidas."]],
        [["共同用一部分，各自留一部分", "Split it between something shared and individual choices", "Dividir entre algo compartido y gustos individuales"], ["这笔钱的安排里，你想兼顾共同和个人选择。", "For this money decision, you want room for both shared and individual choices.", "En esta decisión de dinero, quieres lugar para lo compartido y lo individual."]],
        [["先看看两个人近期最需要什么", "Look at what each of us needs most right now", "Ver qué necesita más cada uno ahora"], ["这笔钱的安排里，你会先比较当前的实际需要。", "For this money decision, you first consider your current practical needs.", "En esta decisión de dinero, primero miras las necesidades actuales."]],
      ]),
      question("future-family", ["假期既想陪家人又想两个人相处，你会先提哪个方案？", "A holiday could include family time and couple time. What would you suggest first?", "Quieren ver a la familia y pasar tiempo en pareja en vacaciones. ¿Qué propondrías?"], [
        [["先保留每年重要的家庭安排", "Protect the family traditions that matter most", "Mantener las tradiciones familiares importantes"], ["这个假期里，重要的家庭惯例对你有分量。", "For this holiday, important family traditions carry weight for you.", "Para estas vacaciones, las tradiciones familiares importantes tienen peso para ti."]],
        [["这次安排一次两个人的新体验", "Make room for a new experience as a couple", "Reservar una experiencia nueva en pareja"], ["这个假期里，你期待建立两个人的新经历。", "For this holiday, you look forward to building a new shared experience.", "Para estas vacaciones, esperas crear una experiencia nueva juntos."]],
        [["把家庭时间和两人时间分开留好", "Reserve distinct time for family and for us", "Reservar tiempo separado para la familia y para ambos"], ["这个假期里，你想让两种关系都有明确空间。", "For this holiday, you want clear room for both kinds of connection.", "Para estas vacaciones, quieres espacio claro para ambos vínculos."]],
        [["问问双方家里和我们各有什么需要", "Ask what both families and each of us need this year", "Preguntar qué necesitan las familias y nosotros este año"], ["这个假期里，你会根据今年的实际状况商量。", "For this holiday, you would adapt to this year's circumstances.", "Para estas vacaciones, te adaptarías a las circunstancias de este año."]],
      ]),
      question("future-city", ["一方有去新城市发展的机会，你最想先了解什么？", "One of you gets an opportunity in a new city. What would you want to understand first?", "A uno le surge una oportunidad en otra ciudad. ¿Qué querrías entender primero?"], [
        [["住处、收入和生活能否稳下来", "Housing, income, and whether daily life would be stable", "Vivienda, ingresos y estabilidad de la vida diaria"], ["面对迁居，你先关注生活的稳定条件。", "With a possible move, you first focus on stable living conditions.", "Ante una mudanza, primero miras las condiciones de estabilidad."]],
        [["这个机会会带来怎样的成长", "What growth this opportunity could offer", "Qué crecimiento podría traer la oportunidad"], ["面对迁居，你先关注机会和成长空间。", "With a possible move, you first focus on opportunity and growth.", "Ante una mudanza, primero miras las oportunidades de crecimiento."]],
        [["双方的工作与相处怎样都留出空间", "How both careers and our time together could fit", "Cómo encajar ambos trabajos y el tiempo juntos"], ["面对迁居，你先关注双方各自的发展。", "With a possible move, you first consider room for both people's paths.", "Ante una mudanza, primero miras el desarrollo de ambos."]],
        [["彼此真正想要什么、能接受哪些条件", "What each person wants and what arrangements could work", "Qué quiere cada uno y qué condiciones funcionarían"], ["面对迁居，你想先把双方的愿望和条件讲清楚。", "With a possible move, you first clarify wishes and workable conditions.", "Ante una mudanza, primero aclaras deseos y condiciones posibles."]],
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
