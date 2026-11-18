import { inventoryQuestions } from "./fit-inventory.mjs";
import { portableQuestions } from "./fit-portable.mjs";
import { fitFuturePlans } from "./fit-pair-pattern.mjs";
import { loveQuestions } from "./fit-love-questions.mjs";

const tr = (zh, en, es) => ({ zh, en, es });
const questions = [...inventoryQuestions, ...portableQuestions, ...loveQuestions];
const onAxis = axis => questions.filter(question => question.axis === axis);
const axes = {
  space: { questions: onAxis("space"), a: ["T", tr("常伴", "Together", "En compañía")], b: ["S", tr("留白", "Space", "Espacio propio")] },
  support: { questions: onAxis("give-support"), a: ["L", tr("先听", "Listen first", "Escuchar primero")], b: ["H", tr("先做", "Help first", "Ayudar primero")] },
  repair: { questions: onAxis("dialogue"), a: ["V", tr("边谈", "Think aloud", "Pensar en diálogo")], b: ["Q", tr("静思", "Reflect first", "Reflexionar primero")] },
  planning: { questions: onAxis("planning"), a: ["C", tr("共议", "Plan together", "Pensar juntos")], b: ["E", tr("摸底", "Explore options first", "Explorar opciones")] },
};

function preference(profile, items) {
  const picks = items.map(q => profile?.answers?.[q.id]).filter(id => id === "a" || id === "b");
  if (!items.length || picks.length < Math.min(items.length, 3)) return "unknown";
  const balance = picks.reduce((sum, choice) => sum + (choice === "a" ? 1 : -1), 0);
  const requiredLead = items.length === 3 ? 1 : 2;
  return Math.abs(balance) < requiredLead ? "mixed" : balance > 0 ? "a" : "b";
}

export function loveStyleSignals(profile) {
  return Object.fromEntries(Object.entries(axes).map(([key, value]) => [key, preference(profile, value.questions)]));
}

const types = {
  TLVC: [tr("共话知己型", "Companion in conversation", "Confidente de diálogo"), tr("你喜欢把生活过在一处。听人把话说完、把自己的想法讲出来、从第一步就一起商量，都是你让关系靠近的方式。", "Shared days bring you close. You give your partner room to speak, find your own words in conversation, and like to shape a plan together from the beginning.", "Te gusta compartir lo cotidiano. Escuchas hasta el final, encuentras tus propias palabras al conversar y prefieres dar juntos el primer paso de un plan.")],
  TLVE: [tr("筹划知己型", "Resourceful confidant", "Confidente que explora"), tr("你享受朝夕相处，也善于给心事留出谈话的空间。等谈到具体的选择，你喜欢先查清几条路，再拉一把椅子一起挑。", "You enjoy everyday company and make time to talk through what matters. When a decision calls for practical options, you like to bring a few routes to the table.", "Disfrutas de la compañía diaria y haces sitio para hablar de lo importante. Ante una decisión concreta te gusta investigar dos o tres caminos y sentarte a elegir en pareja.")],
  TLQC: [tr("静思知己型", "Reflective confidant", "Confidente reflexivo"), tr("喜欢一起过日常，愿意听对方说。轮到自己有心事，你需要一点时间找准措辞；轮到两人做决定，你希望从头就在场。", "You enjoy sharing ordinary days and listening to your partner. Finding your own words takes time. When a decision concerns you both, you want to be there from the start.", "Te gusta compartir lo cotidiano y escuchar a tu pareja. Para encontrar tus propias palabras necesitas tiempo. Cuando algo les afecta a ambos, quieres participar desde el inicio.")],
  TLQE: [tr("静伴倾听型", "Quiet listening companion", "Compañía que escucha"), tr("你喜欢和对方同处，听对方慢慢讲。真正难说的话、难做的选择，你常会先在心里理出头绪，再带回两个人之间。", "Company and unhurried listening come naturally to you. A difficult conversation or an important decision often feels easier once you have sorted through the words or the options.", "Te sale natural acompañar y escuchar sin prisa. Una conversación difícil o una decisión importante suele resultar más llevadera cuando has ordenado tus palabras o las opciones.")],
  THVC: [tr("并肩共创型", "Hands-on co-creator", "Compañía que construye"), tr("你喜欢两个人在场，一起把事情往前推。伴侣遇到难处，你常想搭把手；两人意见不同，你更容易边说边找到共同的起点。", "You like being there and moving things forward together. A difficulty makes you want to lend a hand. When views differ, talking can help you find a shared starting point.", "Te gusta estar presente y hacer avanzar las cosas en pareja. Ante una dificultad quieres echar una mano. Si hay diferencias, hablar te ayuda a encontrar un punto de partida común.")],
  THVE: [tr("并肩筹划型", "Side-by-side planner", "Compañía con iniciativa"), tr("你喜欢一起吃饭、一起做事，也乐意把一件麻烦拆成可做的小步。面对共同选择，你常会带着可行选项回来，边聊边定。", "Shared meals and shared tasks matter to you. You like turning a problem into manageable steps and bringing workable choices back to discuss together.", "Valoras compartir una comida o una tarea. Te gusta dividir una dificultad en pasos pequeños y traer propuestas factibles para decidirlas en conversación.")],
  THQC: [tr("静思共建型", "Reflective co-builder", "Compañía que construye con calma"), tr("你喜欢陪在身边，用具体行动减轻对方的负担。争执时你想先整理自己，可遇到共同计划，你希望两个人早早坐到一张桌前。", "You like being nearby and easing a partner’s load in practical ways. You take time to reflect during a disagreement, yet want an early seat at the table when planning together.", "Te gusta estar cerca y aliviar cargas concretas. En un desacuerdo necesitas reflexionar, pero ante un plan común quieres sentarte a la mesa desde el principio.")],
  THQE: [tr("静伴行动型", "Quiet hands-on companion", "Compañía de gestos tranquilos"), tr("你喜欢日子里有彼此，也相信一件实际的小事能表达关心。难开口的问题先想一想，陌生的选项先查一查，是你为两个人做准备的方式。", "You like sharing daily life and showing care through useful help. Reflecting on a difficult exchange or checking unfamiliar options is one way you prepare for the next step together.", "Te gusta compartir la vida diaria y cuidar mediante gestos útiles. Pensar en un roce o informarte sobre las opciones es tu manera de preparar el siguiente paso en pareja.")],
  SLVC: [tr("自在共话型", "Independent conversation partner", "Compañía de diálogo con espacio"), tr("你喜欢在亲密里保留自己的时间。事情值得谈的时候，你愿意认真听，也愿意边谈边厘清自己的想法，把影响两人的主意早点拿出来说。", "You value time of your own. When something matters, you like to listen closely, think aloud, and bring a shared decision into the conversation early.", "Valoras tener tiempo propio. Si algo importa, escuchas con atención, piensas en voz alta y planteas pronto las decisiones que les afectan a ambos.")],
  SLVE: [tr("自在参谋型", "Independent sounding board", "Confidente con iniciativa"), tr("你需要各自生活的余地，也享受有来有回的好对话。听心事时愿意慢一点；碰到具体决定时，你喜欢先把可行的路摸清。", "You like room for separate lives and a good two-way conversation. You can take your time with a partner’s story and prefer to research the practical choices before a decision.", "Te gusta conservar tu espacio y disfrutar de una buena conversación. Escuchas sin apuro y, ante una decisión concreta, prefieres investigar primero los caminos posibles.")],
  SLQC: [tr("留白知己型", "Space-giving confidant", "Confidente que da espacio"), tr("你愿意安心听别人讲，也珍惜安静整理自己的时间。平时可以各有安排，涉及两人方向时，你却希望最初的讨论就有彼此。", "You enjoy listening and value quiet time to sort out your thoughts. Separate daily plans suit you, while major decisions feel more shared when you discuss the direction from day one.", "Escuchas con calma y valoras el tiempo para ordenar tus ideas. Te van bien los planes por separado; cuando se trata del rumbo de ambos, prefieres pensarlo juntos desde el inicio.")],
  SLQE: [tr("静思倾听型", "Thoughtful listener", "Escucha reflexiva"), tr("你喜欢有呼吸空间的亲密，也愿意让对方按自己的节奏把话讲完。需要表达自己的意见时，你更习惯先把感受或选项理清。", "You like intimacy with room to breathe and let your partner tell a story at their own pace. Before offering your own view, you prefer to put your feelings or the options in order.", "Te gusta una cercanía con espacio y escuchar a tu pareja a su ritmo. Antes de expresar tu postura, prefieres ordenar tus sentimientos o explorar las opciones.")],
  SHVC: [tr("自在共创型", "Independent co-creator", "Complicidad con autonomía"), tr("各自安排好一个下午，也能在晚上并肩解决一件事。你愿意用帮忙表达在乎，也喜欢趁想法还在形成时把对方请进讨论。", "An afternoon apart can end with an evening spent solving something together. You offer practical support and like inviting your partner in while an idea is still taking shape.", "Pueden pasar la tarde por separado y resolver algo juntos al anochecer. Das apoyo concreto y te gusta invitar a tu pareja a conversar cuando una idea aún está tomando forma.")],
  SHVE: [tr("自在行动型", "Independent problem-solver", "Iniciativa con autonomía"), tr("你需要自己的时间，也会用实际帮助表达关心。有分歧时你习惯通过对话弄清楚；遇到共同选择，你喜欢先查好选项，再一起决定。", "You value time of your own and offer practical help. You tend to make sense of disagreements in conversation and like to research the options before deciding together.", "Valoras tu tiempo propio y sueles ofrecer ayuda concreta. Aclaras los desacuerdos hablando y prefieres explorar las opciones antes de decidir juntos.")],
  SHQC: [tr("留白共建型", "Independent co-builder", "Construcción con espacio propio"), tr("你可以各忙各的，也会在对方卡住的时候上前帮忙。整理情绪时你需要空间；商量未来时，你希望彼此都参与最初的构想。", "You enjoy doing your own thing and stepping in when a partner gets stuck. Space helps when feelings run high, while a shared future is something you like to shape together from the outset.", "Disfrutas de tus propios planes y de echar una mano cuando tu pareja se atasca. El espacio ayuda con las emociones, y el futuro prefieres pensarlo en pareja desde el principio.")],
  SHQE: [tr("留白筹划型", "Independent pathfinder", "Planificación con espacio propio"), tr("你喜欢有各自的时间，也愿意把手头能做的事接过去。等想法或选项有了轮廓，你会更容易和伴侣展开一次具体的讨论。", "You value time of your own and often take on a practical task to help. Once your thoughts or options have a clear shape, a concrete conversation with your partner comes more naturally.", "Valoras tu tiempo propio y sueles asumir alguna tarea para ayudar. Cuando tus ideas u opciones toman forma, te resulta más fácil tener una conversación concreta con tu pareja.")],
};

// Each theme has a different number of independent situations. Skips are never votes.
const receiving = onAxis("support");
const trust = onAxis("trust");
const responsibility = onAxis("responsibility");

const daily = {
  TL: tr("你可能很喜欢这样的晚上：两个人在厨房忙自己的事，对方讲起白天的小插曲，你顺着多问了一句。就算最后什么也没解决，听完那件小事，今天就有了一段是一起过的。", "An evening in the kitchen can feel like time together even if you are doing separate things. Asking one more question about a small incident at work can make an ordinary day feel shared, even when there is nothing to solve.", "Una noche en la cocina puede sentirse compartida aunque cada cual haga algo distinto. Preguntar un poco más por algo que ocurrió en el trabajo puede acercarles, incluso sin nada que resolver."),
  TH: tr("伴侣说今天实在忙不过来，你可能一边留下来陪，一边看手头有哪件事可以接过去。对你来说，空出十分钟陪着打个电话，往往比等到周末安排一次正式约会更自然。", "When a partner feels swamped, you may stay close and look for one task you could take off their hands. Sitting beside them for a difficult phone call may come more naturally than waiting for a formal date at the weekend.", "Si tu pareja está desbordada, quizá te quedes cerca y busques una tarea de la que puedas encargarte. Acompañar una llamada difícil puede resultarte más natural que esperar a una cita formal el fin de semana."),
  SL: tr("你可能喜欢这样的周末：白天各过各的，晚上碰面时有新鲜事可讲。见面少几小时并不会自动削弱这份亲近；把手机放下，好好听完对方最想讲的那一段，往往更合你的心意。", "You may enjoy spending the day apart and meeting in the evening with new stories to tell. A few hours apart can leave room for the undivided attention you like to give when you put your phone down and listen.", "Quizá disfrutes de pasar el día por separado y reencontrarte por la noche con historias nuevas. Unas horas de espacio pueden dar paso a esa atención que te gusta ofrecer cuando dejas el móvil y escuchas."),
  SH: tr("各自安排的日子里，你的关心也可以很具体。对方正被临时的差事绊住，你可能会回一句「我刚好经过，哪样东西要顺路带？」一件帮得上的小事，让各有空间和彼此照应可以同时发生。", "Having separate plans can still leave space for practical care. If your partner is tied up unexpectedly, you might ask what you could pick up on your way past. A small favor can keep both independence and support in the same afternoon.", "Tener planes propios también deja sitio para cuidar. Si a tu pareja le surge un imprevisto, quizá preguntes qué podrías recoger de camino. Ese favor permite conservar el espacio de ambos y echar una mano."),
};
const crossed = {
  VC: tr("你边说边厘清想法，又希望伴侣早点参与。一个刚冒出来的念头从你嘴里说出来，对方可能以为你已经有了结论；你抛出的几个问题，也可能听起来像催对方当场表态。", "Talking helps you discover what you think, and you like involving your partner early. An idea you are trying out can sound like a decision. A string of open questions can feel like pressure to answer immediately.", "Hablar te ayuda a descubrir qué piensas y te gusta involucrar pronto a tu pareja. Una idea que estás probando puede sonar a decisión tomada; varias preguntas seguidas pueden sentirse como presión para responder ya."),
  VE: tr("分歧发生时，你愿意把还没成形的想法说出来；但面对共同决定，你喜欢先把选项查清。这两种节奏容易让人误会。对方可能纳闷：「昨天你有话就说，这么大的事怎么现在才提？」", "You are willing to think aloud in a disagreement, yet tend to research shared decisions before bringing them up. A partner might wonder why an important plan was mentioned so late when yesterday’s disagreement was discussed from the first moment.", "En un desacuerdo piensas en voz alta, pero ante una decisión conjunta sueles investigar antes de plantearla. Tu pareja quizá se pregunte por qué te guardaste un plan importante cuando ayer hablaron de un roce desde el primer momento."),
  QC: tr("你想先整理，对方可能以为你已经退出了谈话。反过来，伴侣带着几个选好的方案出现时，你也许会觉得自己来晚了一步。你在分歧里需要一点时间，在共同计划里却希望从头参与。", "When you take time to think, a partner may wonder whether the conversation is over. In the other direction, being shown a shortlist can leave you feeling left out of how it took shape. You want time in a disagreement and an early voice in a shared plan.", "Cuando te tomas tiempo para pensar, tu pareja puede creer que la conversación terminó. En cambio, recibir una lista ya preparada quizá te deje fuera de cómo se formó. Quieres tiempo ante un desacuerdo y participar desde el inicio en un plan común."),
  QE: tr("安静时，你可能正在认真想措辞、查资料；对方能看到的却常常只是沉默。从你开始整理到愿意开口之间，如果一直没有消息，伴侣很难区分「还在想」和「已经替我们决定了」。", "During a quiet spell you may be choosing your words or looking into options. From the outside it can simply look like silence. Without a small update a partner may find it hard to tell that you are still thinking and that the decision is still open.", "En silencio quizá estés buscando palabras o consultando opciones. Desde fuera solo se ve el silencio. Sin alguna señal, a tu pareja puede costarle saber que sigues pensando y que la decisión continúa abierta."),
};
const practical = {
  VC: tr("说到分歧或新计划时，可以先点明这次谈话的用意：「我还没想定，想先和你一起捋捋。你现在有空，还是晚上再聊？」这样对方也有时间形成自己的想法。", "Name the purpose of the conversation: “I don’t have a decision yet. Could we think out loud together now, or would tonight work better?” Your partner can take part without having to arrive with an answer.", "Aclara para qué quieres hablar: «Aún no lo tengo decidido. ¿Lo pensamos ahora o te viene mejor esta noche?». Así tu pareja puede participar sin tener una respuesta preparada."),
  VE: tr("做调查之前，先给对方一句短消息：「我打算查两种可能，你还有哪个方向想放进来？」真正讨论时，可以先摆出你还没拿准的地方。对方就知道自己还能改变方案。", "Before you research, send a short note: “I’ll look into two options. Is there another direction you want included?” When you sit down together, start with what is still open so your partner knows where they can shape the decision.", "Antes de investigar, avisa: «Voy a mirar dos opciones. ¿Hay otra que quieras incluir?». Al sentarse a conversar, empieza por lo que sigue abierto para que tu pareja sepa dónde puede influir."),
  QC: tr("暂停时给一句能落地的约定：「我想安静半小时，八点回来从你刚才最在意的地方接着谈。」做计划则可以反过来：先一起说清目标和限制，再分头去查。", "Make a pause specific: “I’d like half an hour. At eight can we come back to what mattered most to you?” For a shared plan, reverse the order: agree on the goal and constraints together before splitting up the research.", "Concreta la pausa: «Necesito media hora. ¿A las ocho retomamos lo que más te importó?». Para un plan común, invierte el orden: acuerden primero la meta y los límites y luego repartan la búsqueda."),
  QE: tr("你可以在两个时间点让对方加入。开始时说「我先查，明晚一起挑」，回来时带一两个仍然开放的问题。需要想清争执时也可以用同一个办法，暂停前约个回来谈的时间。", "Invite your partner in at two points. Say “I’ll check what’s possible and we can choose tomorrow evening,” then return with one or two genuinely open questions. A disagreement can use the same rhythm: agree on a time to pick it up before taking a pause.", "Invita a tu pareja en dos momentos. Di «Voy a mirar posibilidades y mañana elegimos» y vuelve con una o dos preguntas abiertas. También pueden acordar cuándo retomar una discusión antes de hacer una pausa."),
};

const wants = {
  a: tr("你遇到难事时，往往想先有人把经过听完。比如面试结果出来后，一句「最让你难受的是哪一段？」可能给你留出了整理感受的空间。等你讲到下一步，再决定要不要一起想办法。", "On a difficult day, you often want room to finish the story first. After disappointing news, “Which part was hardest?” may give you space to find the feeling. You can decide later whether you want help thinking through the next step.", "En un día difícil sueles querer terminar de contar lo ocurrido. Tras una mala noticia, «¿Qué parte te dolió más?» puede darte espacio para aclararte. Después puedes decidir si quieres pensar en el siguiente paso con ayuda."),
  b: tr("你遇到难事时，往往更希望有人陪你把眼前的第一步理出来。可以让伴侣问得具体些：「你想我陪你想一个开头，还是现在有件事需要我接过去？」有了着手的地方，你也可能更有余力慢慢讲。", "On a hard day, it can help to work out a first step together. A partner could ask, “Would you like help getting started, or is there one task I could take over?” A concrete way forward may make it easier to talk about the rest later.", "Si algo se complica, puede ayudarte encontrar un primer paso en compañía. Tu pareja podría preguntar: «¿Pensamos por dónde empezar o hay algo de lo que pueda encargarme?». Tener un punto de partida puede dejarte más espacio para hablar después."),
  mixed: tr("你有时想把经过讲完，有时更希望有人陪你把下一步理清。伴侣可以先问「今天想要我听，还是陪你做一件事？」这会给你机会说出这一刻真正需要什么。", "Sometimes you want to tell the whole story; at other times, help finding a next step feels right. “Would listening help today, or shall we do one thing together?” gives you a chance to say what fits this moment.", "A veces quieres contar todo; otras, te sirve más encontrar el siguiente paso. «¿Hoy prefieres que escuche o que hagamos algo juntos?» te permite decir qué necesitas en ese momento."),
  unknown: tr("关于你自己想收到的支持，目前的经历还不够明确。可以先让伴侣问一句「现在怎样陪你比较好？」", "Your responses leave open what kind of support you want to receive. A partner could start by asking what would feel helpful right now.", "Todavía queda abierta la clase de apoyo que quieres recibir. Tu pareja puede empezar preguntando cómo te gustaría que te acompañara ahora."),
};
const trustReading = {
  a: tr("对你来说，把接下来的打算和彼此的承诺讲明白，更容易建立安心感。", "Clarity about what you both intend and agree to can help you feel secure.", "Hablar con claridad de intenciones y compromisos puede darte tranquilidad."),
  b: tr("你更容易从小约定的持续兑现中建立信任，一次次照说好的做很有分量。", "Trust tends to grow for you when small promises keep being honored.", "Para ti la confianza suele crecer al ver que los pequeños acuerdos se cumplen una y otra vez."),
  mixed: tr("说清期待和持续兑现小事，你在不同情境下都看重。", "Clear expectations and following through both matter to you in different situations.", "En distintas situaciones valoras tanto hablar de expectativas como cumplir los acuerdos."),
};
const workReading = {
  a: tr("谈共同生活时，你倾向先说明谁负责哪一块，也把记得、安排和收尾算进责任。", "When sharing responsibilities, you prefer to agree who owns each area, including the remembering, organizing and following up.", "Al repartir responsabilidades, prefieres acordar quién se ocupa de cada parte, incluyendo recordar, organizar y dar seguimiento."),
  b: tr("共同生活里，你倾向看两个人当下各有多少余力，再商量这一段时间怎样分担。", "You prefer to share the load according to how much time and energy each of you has at the moment.", "Prefieres repartir la carga según el tiempo y la energía de cada persona en ese momento."),
  mixed: tr("共同责任的安排上，你有时看重职责清楚，有时更愿意随两人的负荷调整。", "Sometimes you want clear ownership of tasks; at other times you prefer adjusting to each person’s workload.", "A veces valoras que las tareas queden claras y otras prefieres adaptarlas a la carga de cada persona."),
};

const heading = {
  habits: tr("你在恋爱里的四个相处习惯", "Your everyday relationship habits", "Tus hábitos en pareja"),
  needs: tr("你希望怎样被爱", "How you like to receive care", "Cómo te gusta recibir cariño"),
  misunderstanding: tr("你容易在哪里被误解", "Where you might be misunderstood", "Dónde pueden malinterpretarte"),
  rhythm: tr("和你相处，更容易舒服的方式", "Finding a comfortable rhythm with you", "Cómo encontrar un ritmo cómodo contigo"),
  values: tr("你在意的信任、责任和未来选择", "Trust, responsibility and future choices", "Confianza, responsabilidades y futuro"),
};
const axisNames = {
  space: tr("日常亲近", "everyday closeness", "cercanía cotidiana"),
  support: tr("支持伴侣", "supporting a partner", "apoyo a tu pareja"),
  repair: tr("面对分歧", "working through disagreements", "desacuerdos"),
  planning: tr("共同筹划", "making plans together", "planes en pareja"),
};
const firstPerson = {
  T: tr("喜欢一起过日常", "I like sharing everyday life", "Me gusta compartir lo cotidiano"),
  S: tr("亲近时也想留点自己的时间", "I like time of my own within a relationship", "Me gusta conservar tiempo propio en pareja"),
  L: tr("遇事先听你说", "I tend to listen first", "suelo escuchar primero"),
  H: tr("遇事先帮你动手", "I tend to offer practical help first", "suelo empezar ofreciendo ayuda concreta"),
  V: tr("有分歧时边谈边理清", "I think through disagreements in conversation", "aclaro los desacuerdos conversando"),
  Q: tr("有分歧时先想清楚", "I reflect before talking through a disagreement", "reflexiono antes de hablar de un desacuerdo"),
  C: tr("大事希望从头一起商量", "I want us to shape important plans together from the start", "prefiero pensar juntos los planes importantes desde el principio"),
  E: tr("大事喜欢先查选项，再一起商量", "I like checking the options before we decide together", "prefiero explorar opciones antes de decidir juntos"),
};
const noView = tr("关于这一点，目前的回答还没有形成清楚的倾向。", "Your answers leave this preference open.", "Tus respuestas aún dejan abierta esta preferencia.");

function valuesFor(profile, lang) {
  const readings = [
    trustReading[preference(profile, trust)]?.[lang],
    workReading[preference(profile, responsibility)]?.[lang],
  ].filter(Boolean);
  for (const plan of fitFuturePlans) {
    const choice = plan.options.find(option => option.id === profile?.answers?.["portrait-v3-" + plan.id]);
    if (choice) readings.push(plan.title[lang] + " · " + choice.text[lang]);
  }
  return readings.join("\n");
}

export function loveStyleReport(profile, lang) {
  const signals = loveStyleSignals(profile);
  const letters = {};
  const legend = [];
  const unresolved = [];
  for (const [name, signal] of Object.entries(signals)) {
    const pole = axes[name][signal];
    if (pole) {
      letters[name] = pole[0];
      legend.push(pole[1][lang]);
    } else {
      unresolved.push(axisNames[name][lang]);
    }
  }
  const confirmed = Object.values(letters);
  const typeCode = confirmed.length === 4 ? confirmed.join("") : null;
  const match = typeCode && types[typeCode];
  const title = match ? match[0][lang] : tr("我的恋爱风格线索", "My emerging relationship style", "Las pistas de mi estilo en pareja")[lang];
  const summary = match ? match[1][lang] : tr(
    "目前还不能确定完整主型。有些习惯随情境变化，或能回忆的具体经历还不多。",
    "Some preferences vary with the situation or have too few concrete examples to name a full style.",
    "Algunas preferencias cambian con la situación o tienen pocos ejemplos concretos para nombrar un estilo completo.",
  )[lang];
  const voice = confirmed.map(letter => firstPerson[letter][lang]).join(lang === "zh" ? "，" : "; ");
  const introduction = typeCode ? tr(
    "我是" + title + "。" + voice + "。",
    "My relationship style is " + title + ". " + voice + ".",
    "Mi estilo de pareja es «" + title + "». " + voice + ".",
  )[lang] : voice ? voice + (lang === "zh" ? "。" : ".") : "";
  const dailyPair = (letters.space || "") + (letters.support || "");
  const decisionPair = (letters.repair || "") + (letters.planning || "");
  const chapters = [];
  const add = (name, body) => { if (body) chapters.push({ title: heading[name][lang], body }); };
  const habitDetail = daily[dailyPair]?.[lang] || voice;
  const pending = unresolved.join(lang === "zh" ? "、" : ", ");
  add("habits", [
    habitDetail,
    ...(pending ? [tr("尚未定型的部分：" + pending + "。", "Preferences left open: " + pending + ".", "Preferencias que quedan abiertas: " + pending + ".")[lang]] : []),
  ].filter(Boolean).join(lang === "zh" ? "" : " "));
  const receive = preference(profile, receiving);
  const needs = [wants[receive][lang]];
  if (signals.support === "a" && receive === "b") needs.push(tr(
    "你习惯给出倾听，自己却更容易被实际分担接住。",
    "Listening is what you tend to offer; a practical hand is what you often hope to receive.",
    "Sueles ofrecer escucha y esperar una mano concreta cuando te toca a ti.",
  )[lang]);
  if (signals.support === "b" && receive === "a") needs.push(tr(
    "你习惯先伸手帮忙，自己有心事时却想要一个愿意听完的人。",
    "You often offer a practical hand first, while hoping for a listener when it is your turn.",
    "Sueles ofrecer ayuda práctica primero, aunque cuando te toca a ti buscas a alguien que escuche.",
  )[lang]);
  add("needs", needs.join(lang === "zh" ? "" : " "));
  add("misunderstanding", crossed[decisionPair]?.[lang]);
  add("rhythm", practical[decisionPair]?.[lang]);
  const values = valuesFor(profile, lang);
  add("values", values || tr("这部分还没有可用的独立回答。", "There are no separate responses available for these topics yet.", "Aún no hay respuestas independientes sobre estos temas.")[lang]);
  return { title, summary, typeCode, legend, chapters, introduction, sections: [], coverage: unresolved.length ? noView[lang] : "" };
}
