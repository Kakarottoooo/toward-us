import { fourSnapshot } from "./fit-four-style.mjs";

const tr = (zh, en, es) => ({ zh, en, es });

const axes = {
  distance: {
    title: tr("距离", "Time together", "Tiempo en pareja"),
    pattern: tr("远近差", "Near and far", "Cerca y lejos"),
    poles: {
      T: tr("想多一些共同时间", "more time together", "más tiempo en compañía"),
      S: tr("想给各自留些时间", "time of your own", "tiempo para cada persona"),
    },
    shared: {
      T: tr("距离上，你们都喜欢常伴。能在同一个屋里各忙各的，也算一起过了这一晚。", "You both enjoy company. Even doing separate things in the same room can feel like an evening together.", "A ambos les gusta la compañía. Incluso hacer cada cual lo suyo en la misma habitación puede sentirse como una noche juntos."),
      S: tr("距离上，你们都喜欢留白。各自去见朋友，回来再说说今天的事，也能是舒服的一天。", "You both value space. Seeing friends separately and swapping stories later can suit you both.", "Ambos valoran su espacio. Ver por separado a sus amistades y luego contarse el día puede sentarles bien."),
    },
    difference: tr("想多待一会儿的人可能觉得被冷落，想自己待一会儿的人可能觉得被缠着。先约好下一次相聚，各自的时间就更容易安排。", "One of you may feel left out just as the other starts to feel crowded. Agreeing when to meet again can make time apart easier.", "Una persona puede sentirse relegada justo cuando la otra empieza a sentirse agobiada. Acordar cuándo volver a verse puede facilitar ese tiempo a solas."),
    tonight: tr("今晚我们留哪一段一起过，又留哪一段各做各的？", "What part of tonight shall we spend together, and what part shall we keep for ourselves?", "¿Qué rato de esta noche pasamos juntos y cuál dejamos para cada quien?"),
  },
  reassurance: {
    title: tr("确认", "Reassurance", "Señales de cariño"),
    pattern: tr("一问一默", "Ask and assume", "Una pregunta y un silencio"),
    poles: {
      R: tr("希望看见或听到回应", "reassurance you can see or hear", "señales de cariño que se vean o se escuchen"),
      C: tr("没有异常就能安心", "feeling secure when things are as usual", "tranquilidad cuando todo sigue como siempre"),
    },
    shared: {
      R: tr("确认上，你们都喜欢收到一点回应。一句「到家了」或「想到你了」，对两个人都有分量。", "You both welcome reassurance. A quick “made it home” or “thinking of you” can mean something to each of you.", "Ambos agradecen las señales de cariño. Un «ya llegué» o un «me acordé de ti» puede significar mucho para los dos."),
      C: tr("确认上，你们都能默认安好。白天各自忙了一阵，晚上也容易自然接上话。", "You both feel secure when things are as usual. After a busy day apart, it may feel natural to pick up where you left off.", "Ambos se sienten tranquilos cuando todo sigue como siempre. Tras un día ajetreado por separado, puede resultarles natural retomar la conversación."),
    },
    difference: tr("一个人想听一句「我还在」，另一个人心里却是「我们一直都好好的」。一句没回复的消息，在两个人那里可能有不同的分量。", "One of you longs to hear “I’m here” while the other assumes everything is fine. An unanswered message can carry a different weight for each of you.", "Una persona necesita oír «aquí estoy» y la otra da por hecho que todo va bien. Un mensaje sin respuesta puede pesar de manera distinta para cada cual."),
    tonight: tr("明天各忙各的时候，你想收到我怎样的一句消息？", "When we’re both busy tomorrow, what kind of message would you like to get from me?", "Cuando estemos ocupados mañana, ¿qué mensaje te gustaría recibir de mí?"),
  },
  language: {
    title: tr("语言", "Receiving affection", "Cómo reciben el cariño"),
    pattern: tr("说做错位", "Words and deeds", "Palabras y gestos"),
    poles: {
      W: tr("想听到心意", "affection put into words", "el cariño expresado con palabras"),
      D: tr("想从行动里感到在乎", "affection shown in actions", "el cariño expresado con hechos"),
    },
    shared: {
      W: tr("语言上，你们都容易从话里收到爱。把「今天想起了你」说出来，两个人都知道这句话的分量。", "You both receive affection through words. Saying “I thought of you today” speaks a language you both understand.", "Ambos reciben cariño a través de las palabras. Decir «hoy me acordé de ti» les habla en un idioma que ambos entienden."),
      D: tr("语言上，你们都容易从行动里收到爱。一顿留好的饭、一件替对方办好的小事，都能让心意变得具体。", "You both notice care in actions. Saving dinner or taking a small task off each other’s hands can make affection tangible.", "Ambos reconocen el cariño en los hechos. Guardar la cena o encargarse de una tarea puede hacer que ese cariño se note."),
    },
    difference: tr("一句喜欢和一件办妥的小事，对你们的分量不同。一方可能一直等那句话，另一方最想看见的是事情真的有人接过去。", "A loving word and a task taken care of carry different weight for you. One of you may be waiting to hear the words while the other looks for a concrete gesture.", "Una palabra cariñosa y una tarea resuelta tienen distinto peso para ustedes. Una persona puede estar esperando escuchar esa frase, y la otra, ver un gesto concreto."),
    tonight: tr("今天我做了什么、说了什么，让你真的感觉到我在乎你？", "What did I do or say today that made you feel cared for?", "¿Qué hice o dije hoy que te hizo sentir mi cariño?"),
  },
  conflict: {
    title: tr("分歧", "Disagreements", "Desacuerdos"),
    pattern: tr("一追一退", "Pursue and pause", "Insistir y tomar aire"),
    poles: {
      N: tr("想当场谈开", "talking things through now", "hablarlo en el momento"),
      L: tr("想先缓一缓", "a pause before talking", "tomarse un tiempo antes de hablar"),
    },
    shared: {
      N: tr("分歧上，你们都想当场谈。出了岔子，往往两个人都愿意把话题摆到桌面上。", "You both want to talk when a disagreement comes up, so either of you can bring the issue into the open.", "Ambos prefieren hablar cuando surge un desacuerdo, así que cualquiera puede sacar el tema."),
      L: tr("分歧上，你们都想先缓一缓。对方要一点时间整理想法，你们都容易理解。", "You both like a pause after a disagreement. Wanting time to gather your thoughts is something you can recognize in each other.", "Ambos prefieren hacer una pausa tras un desacuerdo. Les resulta familiar que la otra persona necesite ordenar sus ideas."),
    },
    difference: tr("一个人越想当场说清，另一个人越需要空间。追问可能让对方更想退开，沉默也可能让想谈的人更着急。", "The more one of you wants to talk now, the more space the other may need. Another question can feel like pressure, while silence can leave the person who wants to talk more anxious.", "Cuanto más quiere hablar una persona, más espacio puede necesitar la otra. Otra pregunta puede sentirse como presión, y el silencio puede inquietar más a quien quiere hablar."),
    tonight: tr("我想把这件事谈完，也愿意先停一停。我们约几点回来接着说？", "I want to finish this conversation, and I’m happy to pause. What time shall we come back to it?", "Quiero que terminemos esta conversación y me parece bien hacer una pausa. ¿A qué hora la retomamos?"),
  },
};

const headlineOrder = ["conflict", "reassurance", "distance", "language"];
const reminders = {
  N: tr("都当场谈，吵得快，和得快。说得快的时候，也给彼此一点听完的时间。", "You both talk straight away, so a quarrel and a reconciliation may come quickly. Leave room for each other to finish a thought.", "Los dos prefieren hablarlo en el momento, así que la discusión y la reconciliación pueden llegar rápido. Dense tiempo para terminar una idea."),
  L: tr("都缓一缓，事情容易没人提。暂停前约个时间，也约好谁先开口。", "You both pause, so an issue can sit untouched. Before you break, decide when to return and who will bring it up.", "Los dos prefieren una pausa y el asunto puede quedarse sin retomar. Antes de parar, acuerden cuándo volver y quién lo planteará."),
  R: tr("都要回应，很甜，也可能很累。不方便联系时，让对方知道下一次能联系的时间。", "You both like reassurance. It can feel sweet and sometimes tiring. When you are busy, let each other know when you can check in.", "Los dos buscan señales de cariño. Pueden ser dulces y a veces agotadoras. Cuando estén ocupados, avisen cuándo podrán volver a escribirse."),
  C: tr("都默认安好，很稳，也容易淡。即使一切照常，也可以主动说一次在乎。", "You both assume things are fine. That can feel steady, and affection can also fade into the background. Put it into words once in a while.", "Ambos dan por hecho que todo va bien. Eso da estabilidad, aunque el cariño también puede pasar desapercibido. Expresen de vez en cuando lo que sienten."),
};

const inSync = tr("同频", "In sync", "En sintonía");
const openTitle = tr("你们的相处线索", "Your relationship so far", "Lo que muestran sus preferencias");
const pending = tr("待确认", "Still open", "Por confirmar");
const you = tr("你", "You", "Tú");
const partnerLabel = tr("对方", "Your partner", "Tu pareja");
const lifeTopics = {
  children: tr("是否养育孩子", "Raising children", "Tener hijos"),
  home: tr("定居安排", "Where to live", "Dónde vivir"),
  fidelity: tr("忠诚约定", "Agreements about fidelity", "Acuerdos sobre fidelidad"),
  family: tr("双方家庭的边界", "Boundaries with family", "Límites con las familias"),
};

function section(id, title, lines, status, lang) {
  return { id: "four-" + id, title: title[lang], summary: lines.join("\n"), status, suggestion: "", evidence: [] };
}

function givingLine(snapshot, recipient, name, lang) {
  const affection = snapshot.giving.affection;
  const support = snapshot.giving.support;
  const lines = [];
  const gives = {
    a: tr("习惯把心意说出来", "tends to express affection in words", "suele expresar el cariño con palabras"),
    b: tr("习惯通过做事表达心意", "tends to show affection through actions", "suele mostrar cariño con hechos"),
    mixed: tr("会随情境用话语或行动示爱", "expresses affection through words or actions depending on the situation", "muestra cariño con palabras o con hechos según la situación"),
  };
  const helps = {
    a: tr("安慰人时倾向先听对方讲完", "tends to listen first when giving comfort", "suele escuchar primero al dar consuelo"),
    b: tr("安慰人时倾向先搭把手", "tends to offer practical help first when giving comfort", "suele ofrecer ayuda concreta al dar consuelo"),
    mixed: tr("安慰人时有时先听，有时先帮", "sometimes listens first and sometimes offers practical help", "a veces escucha primero y otras ofrece ayuda concreta"),
  };
  if (gives[affection]) {
    lines.push(gives[affection][lang]);
    const wants = axes.language.poles[recipient.letters.language];
    if (wants) lines.push(tr("伴侣想收到的方式", "what the partner wants to receive", "lo que su pareja quiere recibir")[lang] + " · " + wants[lang]);
  }
  if (helps[support]) lines.push(helps[support][lang]);
  return lines.length ? name + " · " + lines.join(" / ") : "";
}

function lifeSection(own, peer, partner, lang) {
  const rows = [];
  for (const [key, topic] of Object.entries(lifeTopics)) {
    const mine = own.life[key], theirs = peer.life[key];
    if (!mine && !theirs) continue;
    const lines = [topic[lang]];
    if (mine) lines.push(you[lang] + " · " + mine.label);
    if (theirs) lines.push(partner + " · " + theirs.label);
    if (key === "children" && (mine?.id === "open" || theirs?.id === "open")) {
      lines.push(tr("这个决定还留着余地。可以各说一件目前确定的事，以及一个仍在考虑的问题。", "This decision is still open. Each of you can name one thing you know and one question you are still considering.", "La decisión sigue abierta. Cada quien puede contar algo que tiene claro y algo que todavía está pensando.")[lang]);
    }
    rows.push(lines.join("\n"));
  }
  for (const [label, person] of [[you[lang], own], [partner, peer]]) {
    if (person.household.length) rows.push(tr("钱、家务和安排", "Money, chores and plans", "Dinero, tareas y planes")[lang] + " · " + label + "\n" + person.household.map(item => item.label).join("\n"));
  }
  if (!rows.length) rows.push(tr("目前分享的画像里还没有这部分安排。", "Your shared portraits do not yet include plans in this area.", "Los perfiles compartidos aún no incluyen planes en este ámbito.")[lang]);
  return section("life", tr("人生选择与共同生活", "Life choices and living together", "Decisiones de vida y convivencia"), rows, "mixed", lang);
}

export function fourPairReport(mine, theirs, partnerName, lang) {
  const own = fourSnapshot(mine, lang);
  const peer = fourSnapshot(theirs, lang);
  const partner = partnerName || partnerLabel[lang];
  const same = [], different = [], open = [];
  for (const [key, axis] of Object.entries(axes)) {
    const a = own.letters[key], b = peer.letters[key];
    if (!axis.poles[a] || !axis.poles[b]) open.push(key);
    else if (a === b) same.push(key);
    else different.push(key);
  }

  const focus = headlineOrder.find(key => different.includes(key));
  const allSame = same.length === 4;
  const title = focus ? axes[focus].pattern[lang] : allSame ? inSync[lang] : openTitle[lang];
  const summary = tr("根据你们各自同意分享的画像", "From the portraits you both agreed to share", "Según los perfiles que ambos aceptaron compartir")[lang] +
    "\n" + you[lang] + " · " + (own.typeName || pending[lang]) + "\n" + partner + " · " + (peer.typeName || pending[lang]);

  const common = same.map(key => axes[key].shared[own.letters[key]][lang]);
  if (!common.length) common.push(open.length
    ? tr("已明确的部分还没有显示共同偏好。可以先从一件最近相处舒服的小事说起。", "The known preferences have yet to identify common ground. Start with one recent moment that felt good to you both.", "Las preferencias claras aún no muestran coincidencias. Empiecen por un momento reciente que les haya sentado bien a ambos.")[lang]
    : tr("四个问题上，你们各有自己的偏好。可以先想起一件双方都觉得舒服的小事，看看当时各自做了什么。", "Your preferences differ on all four questions. Recall one recent moment you both enjoyed, and what each of you did that made it work.", "Sus preferencias difieren en las cuatro preguntas. Recuerden un momento reciente que ambos disfrutaron y qué hizo cada uno para que funcionara.")[lang]);
  const sections = [section("common", tr("自然合拍的地方", "Where you meet naturally", "Donde coinciden de forma natural"), common, same.length ? "same" : "mixed", lang)];

  if (focus) {
    const details = [focus, ...different.filter(key => key !== focus)].map(key => {
      const axis = axes[key];
      return axis.title[lang] + " · " + you[lang] + " / " + axis.poles[own.letters[key]][lang] +
        "　" + partner + " / " + axis.poles[peer.letters[key]][lang];
    });
    sections.push(section("pattern", axes[focus].pattern, [axes[focus].difference[lang], ...details], "different", lang));
  } else if (allSame) {
    sections.push(section("reminder", tr("同频时也要记得", "Something to remember in sync", "Algo que recordar cuando coinciden"), [reminders[own.letters.conflict][lang], reminders[own.letters.reassurance][lang]], "same", lang));
  }

  if (open.length) {
    const rows = open.map(key => axes[key].title[lang] + " · " + you[lang] + " / " +
      (axes[key].poles[own.letters[key]]?.[lang] || pending[lang]) + "　" + partner + " / " +
      (axes[key].poles[peer.letters[key]]?.[lang] || pending[lang]));
    sections.push(section("open", pending, rows, "unknown", lang));
  }

  const giving = [givingLine(own, peer, you[lang], lang), givingLine(peer, own, partner, lang)].filter(Boolean);
  if (giving.length) sections.push(section("giving", tr("你们怎样表达关心", "How you show care", "Cómo expresan cariño"), giving, "mixed", lang));
  const followup = [];
  for (const [label, person] of [[you[lang], own], [partner, peer]]) {
    for (const item of [...person.pause, ...person.trust]) followup.push(label + " · " + item.label);
  }
  if (followup.length) sections.push(section("agreements", tr("暂停与信任", "Pauses and trust", "Pausas y confianza"), followup, "mixed", lang));
  sections.push(lifeSection(own, peer, partner, lang));

  let nextStep;
  if (focus) nextStep = axes[focus].tonight[lang];
  else if (allSame) nextStep = own.letters.conflict === "L" ? axes.conflict.tonight[lang] :
    tr("下次意见不一样时，我们能不能各说一件最在意的事，再轮到对方说？", "Next time we disagree, can we each say one thing that matters most and then let the other speak?", "La próxima vez que discrepemos, ¿podemos decir por turnos qué es lo más importante para cada uno?")[lang];
  else nextStep = tr("这几天，哪一刻你最希望我靠近你一点？", "Was there a moment this week when you wished I’d come a little closer?", "¿Hubo un momento esta semana en que te habría gustado sentirme más cerca?")[lang];

  return { status: "ready", partnerName, title, summary, sections, nextStep };
}
