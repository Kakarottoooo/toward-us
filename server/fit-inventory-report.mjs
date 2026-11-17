import { inventoryQuestions } from "./fit-inventory.mjs";

const words = (zh, en, es) => ({ zh, en, es });
const mixed = words("两种都有", "A bit of both", "Un poco de ambos");
const axes = {
  rhythm: {
    name: words("约会节奏", "Making plans", "Hacer planes"),
    a: words("提前有约", "Plans in place", "Planes de antemano"),
    b: words("随兴出发", "Room for spontaneity", "Espacio para improvisar"),
    partnerA: words("提前和你敲定见面的时间", "makes plans with you ahead of time", "acuerda contigo cuándo van a verse"),
    partnerB: words("愿意留一段空白，到时候一起决定去哪儿", "leaves room for you to decide together on the day", "deja margen para decidir juntos sobre la marcha"),
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
    partnerA: words("愿意把欣赏你的具体理由说出口", "puts appreciation into specific words", "te dice qué es lo que aprecia de ti"),
    partnerB: words("留意生活里的小事，用行动回应你", "notices everyday needs and follows through", "se fija en los detalles cotidianos y actúa"),
    prompt: words("最近哪句话、哪件小事让你感觉被放在心上？那天我注意到了吗？", "What words or small gesture made you feel cared for lately? Did I notice at the time?", "¿Qué palabras o detalle te hicieron sentir cariño hace poco? ¿Me di cuenta entonces?"),
  },
  repair: {
    name: words("分歧后的节奏", "After a disagreement", "Tras un desacuerdo"),
    a: words("当下谈开", "Talking it through now", "Hablar en el momento"),
    b: words("缓一缓再谈", "A pause before talking", "Una pausa para hablar después"),
    partnerA: words("有分歧时愿意尽快开口，把事情谈清楚", "opens a conversation soon after a disagreement", "abre pronto la conversación tras un desacuerdo"),
    partnerB: words("允许彼此先缓一缓，再回来把话说完", "allows a pause and returns to the conversation", "da espacio para una pausa y luego retoma la conversación"),
    prompt: words("如果我们之中有一个想先静一静，怎么让另一个知道什么时候会回来谈？", "If one of us needs a pause, how will the other know when we'll talk again?", "Si alguien necesita una pausa, ¿cómo sabremos cuándo retomaremos la conversación?"),
  },
  space: {
    name: words("恢复精力的方式", "Recharging", "Recuperar energía"),
    a: words("一起充电", "Recharging together", "Recargar en compañía"),
    b: words("独处充电", "Recharging alone", "Recargar a solas"),
    partnerA: words("在累了一天后也愿意和你安静地待一会儿", "enjoys quiet company with you after a long day", "disfruta de tu compañía tranquila después de un día largo"),
    partnerB: words("给你留出独处的时间，也乐意之后再聚", "gives you time alone and looks forward to reconnecting", "te deja tiempo a solas y disfruta del reencuentro"),
    prompt: words("这一周最累的那天，你想我留在旁边，还是约好晚些时候再见？", "On the hardest day this week, would you like company or a time to meet later?", "El día más duro de esta semana, ¿te apetece compañía o prefieres que nos veamos más tarde?"),
  },
  resources: {
    name: words("共同预算的取舍", "Shared spending choices", "Prioridades de gasto en pareja"),
    a: words("为以后预留", "Saving for later", "Reservar para después"),
    b: words("优先一起体验", "Making memories now", "Vivir experiencias juntos"),
    partnerA: words("愿意一起商量先为将来的计划留多少", "talks with you about what to set aside for future plans", "habla contigo de cuánto reservar para sus planes futuros"),
    partnerB: words("愿意在负担得起时为一段共同经历花钱", "makes room for shared experiences you can afford", "hace sitio en el presupuesto para una experiencia compartida"),
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
  if (!enough(rows)) return null;
  const leading = rows.filter(row => row.side !== "mixed")
    .sort((a, b) => b.margin - a.margin || b.responses.length - a.responses.length).slice(0, 2);
  const patterns = leading.map(row => label(row.axis, row.side, language));
  const partner = leading.map(({ axis, side }) => (side === "a" ? axis.partnerA : axis.partnerB)[language]);
  const title = patterns.length ? patterns.join(" · ") : words("看情境切换", "Different moments, different needs", "Cada momento pide algo distinto")[language];
  const summary = partner.length
    ? words(`在你回想的场景里，「${patterns.join("」和「")}」反复出现。想了解怎样的伴侣适合你，可以先看一个具体问题：对方${partner.join("，也")}时，你是否更自在？`,
      `“${patterns.join("” and “")}” came up repeatedly in the situations you recalled. One question to explore: do you feel at ease with someone who ${partner.join(" and ")}?`,
      `«${patterns.join("» y «")}» aparecen varias veces en las situaciones que recuerdas. Algo que puedes explorar: ¿te sientes a gusto cuando tu pareja ${partner.join(" y ")}?`)[language]
    : words("你的答案里，两种做法都有位置。相处起来可能更舒服的，是愿意在事情发生时问你「这一次想怎么来」的人。",
      "Both approaches show up in your answers. You may feel at ease with someone who asks what feels right this time.",
      "En tus respuestas aparecen ambas opciones. Quizá estés a gusto con alguien que te pregunte qué te apetece esta vez.")[language];
  const sections = rows.map(({ id, axis, responses, side, total }) => {
    const evidence = responses.map(({ question, option }) => ({
      questionId: question.id, question: question.text[language], answer: option.text[language], topic: axis.name[language],
    }));
    const preferred = responses.filter(response => response.option.id === side).length;
    const count = responses.length;
    const pattern = label(axis, side, language);
    const summary = side === "mixed"
      ? words("你的回答里两种做法都出现了，暂时看不出稳定偏向。", "Both approaches appear in your answers, with no clear tilt.", "En tus respuestas aparecen ambas opciones sin una tendencia clara.")[language]
      : words(`在作了具体选择的 ${count} 个场景中，有 ${preferred} 次更接近「${pattern}」。`,
        `In ${preferred} of the ${count} situations you answered, you leaned toward “${pattern}”.`,
        `En ${preferred} de las ${count} situaciones que respondiste, te acercaste a «${pattern}».`)[language];
    return { id, title: axis.name[language], summary, suggestion: axis.prompt[language], evidence, answered: count, total };
  });
  const answered = rows.reduce((n, row) => n + row.responses.length, 0);
  return { title, summary, sections, coverage: words(`依据你在 ${answered} 个场景中的选择。这是本次问卷的相处偏好画像。`,
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
  const phrases = [];
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
