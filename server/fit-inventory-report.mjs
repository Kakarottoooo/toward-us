import { inventoryQuestions } from "./fit-inventory.mjs";

const words = (zh, en, es) => ({ zh, en, es });
const mixed = words("两种都有", "A bit of both", "Un poco de ambos");
const styleNames = {
  aa: words("相伴言语", "Together in words", "En compañía y con palabras"),
  ab: words("并肩行动", "Side by side in action", "En compañía y con gestos"),
  ba: words("自在言语", "Space and words", "Con espacio y palabras"),
  bb: words("自在行动", "Space and action", "Con espacio y gestos"),
};
const styleAxes = {
  space: {
    name: words("亲近", "Closeness", "Cercanía"),
    a: words("共处", "Together", "En compañía"), b: words("留白", "Space", "Espacio propio"),
    aStory: words("累了，我更想在你身边歇一会儿。", "After a tiring day, I like to unwind beside you.", "Después de un día largo, me gusta descansar a tu lado."),
    bStory: words("累了，我更想先一个人歇一会儿。", "After a tiring day, I like a little time to myself.", "Después de un día largo, me gusta tener un rato a solas."),
  },
  care: {
    name: words("示爱", "Showing care", "Expresar cariño"),
    a: words("言语", "Words", "Palabras"), b: words("行动", "Actions", "Gestos"),
    aStory: words("我惦记你的时候，常会把心里的话说给你听。", "When you are on my mind, I tend to tell you.", "Cuando pienso en ti, suelo decírtelo."),
    bStory: words("我惦记你的时候，常会替你做点具体的事。", "When you are on my mind, I tend to do something for you.", "Cuando pienso en ti, suelo hacer algo por ti."),
  },
  repair: {
    name: words("重谈", "After conflict", "Retomar el diálogo"),
    a: words("早谈", "Talk soon", "Hablar pronto"), b: words("缓谈", "Pause first", "Hacer una pausa"),
    aStory: words("有了分歧，我通常希望早点把话接上。", "After a disagreement, I usually want to talk again soon.", "Después de un desacuerdo, suelo querer retomar pronto la conversación."),
    bStory: words("有了分歧，我通常想先整理一下，再回来谈。", "After a disagreement, I usually need a pause before talking again.", "Después de un desacuerdo, suelo necesitar una pausa antes de volver a hablar."),
  },
};
const axes = {
  rhythm: {
    name: words("约会节奏", "Making plans", "Hacer planes"),
    a: words("提前有约", "Plans in place", "Planes de antemano"),
    b: words("随兴出发", "Room for spontaneity", "Espacio para improvisar"),
    prompt: words("下一次见面，哪一件事要先敲定，哪一件可以当天再说？", "For our next date, what shall we book and what shall we leave open?", "Para la próxima cita, ¿qué dejamos decidido y qué improvisamos?"),
  },
  support: {
    name: words("烦心时的陪伴", "Support on a hard day", "Apoyo en un mal día"),
    a: words("先听心事", "Listening first", "Escuchar primero"),
    b: words("一起想办法", "Finding a way together", "Buscar soluciones en pareja"),
    partnerA: words("在你说起烦心事时留出时间，听你讲完", "gives you space to finish telling a difficult story", "te da tiempo para contar de principio a fin lo que te preocupa"),
    partnerB: words("在事情卡住时坐下来，和你一起想下一步", "sits down with you to work out a next step", "se sienta contigo a pensar en el siguiente paso"),
    prompt: words("下次一方心里堵得慌，问一句「今天想先讲完，还是想一起想办法？」", "Next time one of us is upset, could we ask whether listening or ideas would help first?", "Cuando algo nos pese, ¿podemos preguntar si primero vendría mejor escuchar o buscar ideas?"),
  },
  care: {
    name: words("爱意的表达", "Expressing care", "Expresar cariño"),
    a: words("把爱说出来", "Care in words", "Cariño en palabras"),
    b: words("把爱做出来", "Care in action", "Cariño con hechos"),
    prompt: words("最近哪句话、哪件小事让你感觉被放在心上？那天我注意到了吗？", "What words or small gesture made you feel cared for lately? Did I notice at the time?", "¿Qué palabras o detalle te hicieron sentir cariño hace poco? ¿Me di cuenta entonces?"),
  },
  repair: {
    name: words("分歧后的节奏", "After a disagreement", "Tras un desacuerdo"),
    a: words("当下谈开", "Talking it through now", "Hablar en el momento"),
    b: words("缓一缓再谈", "A pause before talking", "Una pausa para hablar después"),
    prompt: words("如果我们之中有一个想先静一静，怎么让另一个知道什么时候会回来谈？", "If one of us needs a pause, how will the other know when we'll talk again?", "Si alguien necesita una pausa, ¿cómo sabremos cuándo retomaremos la conversación?"),
  },
  space: {
    name: words("恢复精力的方式", "Recharging", "Recuperar energía"),
    a: words("一起充电", "Recharging together", "Recargar en compañía"),
    b: words("独处充电", "Recharging alone", "Recargar a solas"),
    prompt: words("这一周最累的那天，你想我留在旁边，还是约好晚些时候再见？", "On the hardest day this week, would you like company or a time to meet later?", "El día más duro de esta semana, ¿te apetece compañía o prefieres que nos veamos más tarde?"),
  },
  resources: {
    name: words("共同预算的取舍", "Shared spending choices", "Prioridades de gasto en pareja"),
    a: words("为以后预留", "Saving for later", "Reservar para después"),
    b: words("优先一起体验", "Making memories now", "Vivir experiencias juntos"),
    prompt: words("如果这月多出一笔可以自由安排的钱，留多少给以后，拿多少一起做件开心的事？", "If we have money left over this month, how much shall we save and how much shall we enjoy together?", "Si este mes nos sobra dinero, ¿cuánto guardamos y cuánto dedicamos a disfrutar juntos?"),
  },
};

function readings(profile) {
  const answers = profile?.answers || {};
  return Object.entries(axes).map(([id, axis]) => {
    const questions = inventoryQuestions.filter(question => question.axis === id);
    const responses = questions.flatMap(question => {
      const option = question.options.find(item => item.id === answers[question.id]);
      return option ? [{ question, option }] : [];
    });
    const a = responses.filter(response => response.option.id === "a").length;
    const b = responses.length - a;
    // A single vote separating two sides is too little to name a preference.
    const margin = Math.abs(a - b);
    const side = margin < 2 ? "mixed" : a > b ? "a" : "b";
    return { id, axis, responses, margin, side, total: questions.length,
      complete: questions.every(question => ["a", "b", "skip"].includes(answers[question.id])) };
  });
}

const enough = rows => rows.every(row => row.complete && row.responses.length >= 2);
const label = (axis, side, language) => (side === "mixed" ? mixed : axis[side])[language];

export function inventoryReady(profile) {
  return enough(readings(profile));
}

export function inventoryRevisitIds(profile) {
  const sparse = new Set(readings(profile).filter(row => row.responses.length < 2).map(row => row.id));
  return inventoryQuestions.filter(question => sparse.has(question.axis) && profile?.answers?.[question.id] === "skip")
    .map(question => question.id);
}

export function inventoryReport(profile, language) {
  const rows = readings(profile);
  if (!rows.every(row => row.complete) || !rows.some(row => row.responses.length)) return null;

  const byId = new Map(rows.map(row => [row.id, row]));
  const styleSides = {};
  const markers = [];
  const story = [];
  const unresolved = [];
  for (const [id, axis] of Object.entries(styleAxes)) {
    const row = byId.get(id);
    // Prefer a descriptive partial result to a type based on only two examples.
    if (row.responses.length >= 3 && row.side !== "mixed") {
      styleSides[id] = row.side;
      markers.push(axis.name[language] + " · " + axis[row.side][language]);
      story.push(axis[row.side + "Story"][language]);
    } else {
      unresolved.push(axis.name[language]);
      const status = row.responses.length < 3
        ? words("待补充", "More examples needed", "Faltan ejemplos") : mixed;
      markers.push(axis.name[language] + " · " + status[language]);
    }
  }

  let title = words("我的相处线索", "My relationship patterns so far", "Mis primeras pistas en pareja")[language];
  if (!unresolved.length) {
    const base = styleNames[styleSides.space + styleSides.care][language];
    const repair = styleAxes.repair[styleSides.repair][language];
    title = language === "zh" ? base + "·" + repair + "型" : base + " · " + repair;
  } else {
    const pending = unresolved.join(language === "zh" ? "、" : ", ");
    story.push(words(`关于「${pending}」，目前的回答还不足以确定一种做法。`,
      `My answers about ${pending.toLowerCase()} leave the pattern open.`,
      `Mis respuestas sobre ${pending.toLowerCase()} todavía dejan abierta la conclusión.`)[language]);
  }

  const sections = ["space", "care", "repair", "support", "rhythm", "resources"].map(id => {
    const { axis, responses, side, total } = byId.get(id);
    const evidence = responses.map(({ question, option }) => ({
      questionId: question.id, question: question.text[language], answer: option.text[language], topic: axis.name[language],
    }));
    const preferred = responses.filter(response => response.option.id === side).length;
    const count = responses.length;
    const pattern = label(axis, side, language);
    const summary = count < 2
      ? words("这个方面还缺少具体经历。", "This area needs more concrete examples.", "Faltan experiencias concretas en este aspecto.")[language]
      : side === "mixed"
      ? words("你的回答里两种做法都出现了，暂时看不出稳定偏向。", "Both approaches appear in your answers, with no clear tilt.", "En tus respuestas aparecen ambas opciones sin una tendencia clara.")[language]
      : words(`在作了具体选择的 ${count} 个场景中，有 ${preferred} 次更接近「${pattern}」。`,
        `In ${preferred} of the ${count} situations you answered, you leaned toward “${pattern}”.`,
        `En ${preferred} de las ${count} situaciones que respondiste, te acercaste a «${pattern}».`)[language];
    const limited = count === 2 ? words("这里仅有两次具体选择，可以先当作线索。", "There are only two concrete choices here. Treat them as an initial clue.", "Aquí solo hay dos respuestas concretas. Tómalas como una primera pista.")[language] : "";
    const title = id === "support" ? words("我想收到的支持", "Support I look for", "El apoyo que busco")[language] : axis.name[language];
    let suggestion = axis.prompt[language];
    if (id === "support" && count >= 3 && side !== "mixed") {
      const support = (side === "a" ? axis.partnerA : axis.partnerB)[language];
      suggestion = words(`当伴侣${support}，你会更自在吗？`,
        `Do you feel more at ease with someone who ${support}?`,
        `¿Te sientes más a gusto cuando tu pareja ${support}?`)[language];
    }
    return { id, title, summary: [summary, limited].filter(Boolean).join(language === "zh" ? "" : " "), suggestion, evidence, answered: count, total };
  });
  const answered = rows.reduce((n, row) => n + row.responses.length, 0);
  return { title, markers, summary: story.join(language === "zh" ? "" : " "), sections, coverage: words(`依据你在 ${answered} 个场景中的选择。这是本次问卷的相处偏好画像。`,
    `A portrait of your preferences based on ${answered} choices in this questionnaire.`,
    `Un retrato de tus preferencias a partir de ${answered} respuestas a este cuestionario.`)[language] };
}

// All shared text is derived exclusively from these six categories per person.
function sharedReadings(profile) {
  const rows = readings(profile);
  return enough(rows) ? rows.map(({ id, side }) => ({ id, side })) : [];
}

export function inventoryPreview(profile, language) {
  return sharedReadings(profile).map(({ id, side }) => `${axes[id].name[language]} · ${label(axes[id], side, language)}`);
}

export function inventoryPairReport(mine, theirs, partnerName, language) {
  const own = sharedReadings(mine);
  const other = sharedReadings(theirs);
  if (!own.length || !other.length) return null;
  const sections = own.map(({ id, side }, index) => {
    const axis = axes[id];
    const opposite = other[index].side;
    const status = side === "mixed" || opposite === "mixed" ? "mixed" : side === opposite ? "same" : "different";
    const self = label(axis, side, language), peer = label(axis, opposite, language);
    const summary = words(`你：${self}。对方：${peer}。`, `You: ${self}. Your partner: ${peer}.`, `Tú: ${self}. Tu pareja: ${peer}.`)[language];
    return { id, title: axis.name[language], summary, status, suggestion: axis.prompt[language], evidence: [] };
  });
  const shared = sections.find(section => section.status === "same");
  const different = sections.find(section => section.status === "different");
  const flexible = sections.find(section => section.status === "mixed");
  const title = shared && different ? words("有默契，也有要商量的地方", "Common ground with a few choices to talk through", "Coincidencias y diferencias que conversar")
    : different ? words("节奏需要商量", "Finding a rhythm together", "Encontrar un ritmo en pareja")
    : shared ? words("偏好同频", "On a similar wavelength", "Preferencias en sintonía")
    : words("看当下，一起定", "Deciding in the moment", "Decidir juntos en el momento");
  const same = sections.filter(section => section.status === "same").length;
  const apart = sections.filter(section => section.status === "different").length;
  const open = sections.length - same - apart;
  const phrases = [words(`六个方面里，${same} 项你们偏向同一种做法，${apart} 项你们各有所好，${open} 项至少一人会随情境选择。`,
    `Across six areas, you lean the same way in ${same}, lean in different directions in ${apart}, and at least one of you uses both approaches in ${open}.`,
    `De seis aspectos, en ${same} se inclinan por lo mismo, en ${apart} prefieren cosas distintas y en ${open} al menos una persona elige según la situación.`)[language]];
  if (shared) phrases.push(words(`在「${shared.title}」上，你们都倾向「${label(axes[shared.id], own.find(row => row.id === shared.id).side, language)}」。`,
    `For ${shared.title.toLowerCase()}, you both lean toward “${label(axes[shared.id], own.find(row => row.id === shared.id).side, language)}”.`,
    `En «${shared.title}», ambos se inclinan por «${label(axes[shared.id], own.find(row => row.id === shared.id).side, language)}».`)[language]);
  if (different) phrases.push(words(`「${different.title}」是值得先聊的一处：${different.summary}`,
    `A good place to start talking is ${different.title.toLowerCase()}. ${different.summary}`,
    `Un buen punto de partida es «${different.title}». ${different.summary}`)[language]);
  else if (flexible) phrases.push(words(`碰到「${flexible.title}」，最好问问这一次各自想怎么做。`,
    `When it comes to ${flexible.title.toLowerCase()}, ask what each of you wants this time.`,
    `En «${flexible.title}», pregúntense qué les apetece esta vez.`)[language]);
  return { status: "ready", partnerName, title: title[language], summary: phrases.join(language === "zh" ? "" : " "), sections };
}
