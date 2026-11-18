import { fourQuestions } from "./fit-four-questions.mjs";
import { axes, poles, headings, familyLines, portraits } from "../shared/fit-four-portraits.mjs";

const text = (zh, en, es) => ({ zh, en, es });
const pending = text("待确认", "Still open", "Por confirmar");
const partialTitle = text("我的恋爱四问线索", "My four relationship preferences so far", "Mis cuatro preferencias en pareja hasta ahora");

const otherSide = {
  T: text("也有些时候，即使各自忙自己的事，你仍感觉亲近。", "At times you feel close even while doing things separately.", "A veces sientes cercanía aunque cada cual haga lo suyo."),
  S: text("也有些时候，和对方待在一起比一个人更能让你放松。", "At times you relax more easily in your partner’s company.", "A veces te relajas más en compañía de tu pareja."),
  R: text("有时即使没有特意确认，你也能相信两个人好好的。", "Sometimes you trust that things are fine without checking in.", "A veces confías en que todo marcha bien sin pedir una señal."),
  C: text("有时你也很希望对方主动说一句，让你知道自己被放在心上。", "At times you would welcome a sign that you are on your partner’s mind.", "A veces agradeces una señal espontánea de que tu pareja piensa en ti."),
  W: text("具体的行动有时也会让你更清楚地感到被爱。", "Sometimes a concrete gesture makes love easier for you to feel.", "A veces un gesto concreto te hace sentir el cariño con más claridad."),
  D: text("在某些时刻，一句贴心的话比实际帮助更能传达心意。", "Sometimes a thoughtful word reaches you more easily than practical help.", "En ocasiones unas palabras atentas te llegan más que la ayuda práctica."),
  N: text("遇到有些分歧，你也会想等心里清楚些再谈。", "For some disagreements you would rather collect your thoughts first.", "En algunos desacuerdos prefieres ordenar tus ideas antes de hablar."),
  L: text("碰到特别在意的事，你也可能希望当下就说开。", "When something really matters to you, you may want to discuss it right away.", "Cuando algo te importa mucho, quizá quieras hablarlo en el momento."),
};
const strengths = {
  clear: text("明显", "Clear", "Clara"),
  leaning: text("偏向", "Leaning", "Tendencia"),
  middle: text("接近中间", "Near the middle", "Cerca del punto medio"),
};

const questionsByAxis = Object.groupBy(fourQuestions, q => q.axis);

function countChoices(profile, axis) {
  let a = 0, b = 0;
  for (const question of questionsByAxis[axis]) {
    const value = profile?.answers?.[question.id];
    if (value === "a") a++;
    if (value === "b") b++;
  }
  return { a, b };
}

function core(profile) {
  const letters = {}, levels = {};
  for (const [axis, { pair }] of Object.entries(axes)) {
    const { a, b } = countChoices(profile, axis);
    const answered = a + b;
    letters[axis] = answered < 5 || a === b ? null : pair[a > b ? 0 : 1];
    if (!letters[axis]) continue;
    // Five or six answered scenarios use the closest equivalent seven-vote split.
    const winningVotes = Math.round(7 * Math.max(a, b) / answered);
    levels[axis] = winningVotes >= 6 ? "clear" : winningVotes === 5 ? "leaning" : "middle";
  }
  const typeCode = Object.values(letters).includes(null) ? null : Object.values(letters).join("");
  return { letters, levels, typeCode };
}

const summaryChoices = {
  "four-v5-return-time": {
    key: "returnTime",
    a: text("暂停后，倾向按约定的时间主动接回谈话。", "After a pause, tends to restart the conversation at an agreed time.", "Después de una pausa, suele retomar la charla a la hora acordada."),
    b: text("暂停后，倾向等合适的机会再开口。", "After a pause, tends to wait for a suitable opening.", "Después de una pausa, suele esperar una buena ocasión para hablar."),
  },
  "four-v5-postponed": {
    key: "postponed",
    a: text("需要推迟重谈时，希望当时约好新的时间。", "If a conversation has to be put off, prefers to set another time right away.", "Si hay que aplazar una charla, prefiere fijar otra hora en ese momento."),
    b: text("需要推迟重谈时，倾向忙完后再联系。", "If a conversation has to be put off, tends to reconnect once free.", "Si hay que aplazar una charla, suele retomar el contacto al desocuparse."),
  },
  "love-v4-first-weeks": {
    key: "earlyTrust",
    a: text("关系刚开始时，说清彼此的期待会更安心。", "Early in a relationship, clear expectations help build trust.", "Al principio, aclarar expectativas ayuda a sentir confianza."),
    b: text("关系刚开始时，小约定一次次兑现会更安心。", "Early in a relationship, keeping small promises helps build trust.", "Al principio, cumplir pequeños acuerdos ayuda a sentir confianza."),
  },
  "love-v4-regular-plans": {
    key: "contactTrust",
    a: text("作息错开时，希望先讲清对联系的期待。", "When schedules differ, prefers to agree on contact expectations.", "Cuando los horarios no coinciden, prefiere aclarar cómo seguir en contacto."),
    b: text("作息错开时，按约定保持联系会更安心。", "When schedules differ, keeping agreed check-ins feels reassuring.", "Cuando los horarios no coinciden, da tranquilidad cumplir el contacto acordado."),
  },
  "four-v5-broken-promise": {
    key: "brokenPromise",
    a: text("临时改约却没有提前告知，更容易影响信任。", "A change of plan without a heads-up can shake trust.", "Un cambio de plan sin aviso puede afectar a la confianza."),
    b: text("承诺反复落空，更容易影响信任。", "Repeatedly unkept promises can shake trust.", "Las promesas incumplidas varias veces pueden afectar a la confianza."),
  },
  "inventory-v1-leftover-budget": {
    key: "budget",
    a: text("共同活动预算有余时，更想留给以后一起做的事。", "With extra money for shared plans, prefers to save for a future experience.", "Si sobra dinero para planes en pareja, prefiere guardarlo para una experiencia futura."),
    b: text("共同活动预算有余时，更想用于眼前一起想做的事。", "With extra money for shared plans, prefers an experience to enjoy together soon.", "Si sobra dinero para planes en pareja, prefiere disfrutar pronto de una experiencia juntos."),
  },
  "love-v4-busy-week": {
    key: "chores",
    a: text("分担家务时，喜欢各自从头到尾负责一块。", "For household work, prefers each person to own a task from start to finish.", "En casa, prefiere que cada cual se encargue de una tarea de principio a fin."),
    b: text("分担家务时，喜欢按当周谁有余力来安排。", "For household work, prefers to divide tasks by that week’s availability.", "En casa, prefiere repartir las tareas según la disponibilidad de cada semana."),
  },
  "love-v4-shared-table": {
    key: "planning",
    a: text("共同筹划时，喜欢一开始就一起定目标。", "For shared plans, prefers to set goals together from the start.", "Al planear en pareja, prefiere fijar las metas en conjunto desde el principio."),
    b: text("共同筹划时，喜欢先查好选项再一起聊。", "For shared plans, prefers to explore options before discussing them together.", "Al planear en pareja, prefiere mirar las opciones antes de comentarlas juntos."),
  },
};

const lifeTopics = {
  children: text("孩子", "Children", "Hijos"),
  home: text("定居", "Where to live", "Dónde vivir"),
  fidelity: text("忠诚约定", "Commitments around exclusivity", "Acuerdos de exclusividad"),
  family: text("双方家庭的边界", "Boundaries with family", "Límites con las familias"),
};
const lifeLabels = {
  children: {
    yes: text("目前想要孩子", "Would like children", "Por ahora quiere tener hijos"),
    no: text("目前不想要孩子", "Does not currently want children", "Por ahora no quiere tener hijos"),
  },
  home: {
    stay: text("倾向留下", "Leans toward staying", "Se inclina por quedarse"),
    move: text("倾向搬迁", "Leans toward moving", "Se inclina por mudarse"),
  },
  fidelity: {
    exclusive: text("倾向排他的伴侣关系", "Prefers an exclusive relationship", "Prefiere una relación exclusiva"),
    negotiated: text("愿意在双方事先明确同意的范围内讨论非排他关系", "Open to discussing a non-exclusive relationship with prior mutual agreement", "Acepta hablar de un vínculo no exclusivo con acuerdo previo de ambas partes"),
  },
  family: {
    couple: text("希望两人先商量，再与家人沟通", "Prefers to discuss decisions as a couple before involving family", "Prefiere hablar en pareja antes de involucrar a la familia"),
    "family-input": text("希望较早听取家人的意见", "Prefers to hear family members’ views early", "Prefiere escuchar pronto la opinión de la familia"),
  },
};
const openChoice = text("还没想好", "Undecided", "Aún sin decidir");

function details(profile, axis, lang) {
  return questionsByAxis[axis].flatMap(({ id }) => {
    const def = summaryChoices[id];
    const selected = def?.[profile?.answers?.[id]];
    return selected?.[lang] ? [{ key: def.key, label: selected[lang] }] : [];
  });
}

function giving(profile, axis) {
  const { a, b } = countChoices(profile, axis);
  if (!a && !b) return null;
  if (a === b) return "mixed";
  return a > b ? "a" : "b";
}

const givingLabels = {
  affection: {
    a: text("倾向把爱意说出来", "Tends to express affection in words", "Suele expresar el cariño con palabras"),
    b: text("倾向用行动表达爱意", "Tends to express affection through deeds", "Suele expresar el cariño con hechos"),
    mixed: text("会说，也会用行动表达爱意", "Expresses affection through both words and deeds", "Expresa el cariño tanto con palabras como con hechos"),
  },
  support: {
    a: text("安慰时倾向先听对方说", "Tends to listen first when offering comfort", "Al consolar, suele escuchar primero"),
    b: text("安慰时倾向先帮上具体的忙", "Tends to offer practical help first", "Al consolar, suele ofrecer ayuda práctica primero"),
    mixed: text("安慰时有时先听，有时先帮忙", "Sometimes listens first, sometimes offers practical help first", "Al consolar, a veces escucha primero y otras empieza por ayudar"),
  },
};

export function fourSnapshot(profile, lang = "zh") {
  const { typeCode, letters } = core(profile);
  const life = {};
  for (const axis of Object.keys(lifeTopics)) {
    const question = questionsByAxis[axis][0];
    const id = profile?.answers?.[question.id];
    const value = id === "open" ? openChoice : lifeLabels[axis][id];
    life[axis] = value?.[lang] ? { id, label: value[lang] } : null;
  }
  return {
    typeCode,
    typeName: portraits[typeCode]?.name[lang] || partialTitle[lang],
    letters,
    giving: { affection: giving(profile, "giving-affection"), support: giving(profile, "giving-support") },
    pause: details(profile, "pause-followup", lang),
    trust: details(profile, "trust", lang),
    household: details(profile, "household", lang),
    life,
  };
}

export function fourPreview(profile, lang) {
  const snapshot = fourSnapshot(profile, lang);
  const lines = [snapshot.typeCode ? snapshot.typeName + " · " + snapshot.typeCode : partialTitle[lang]];
  for (const [axis, letter] of Object.entries(snapshot.letters)) {
    lines.push(axes[axis].name[lang] + " · " + (letter ? letter + " " + poles[letter][lang] : pending[lang]));
  }
  for (const [topic, value] of Object.entries(snapshot.giving)) {
    if (value) lines.push(givingLabels[topic][value][lang]);
  }
  for (const detail of [...snapshot.pause, ...snapshot.trust, ...snapshot.household]) lines.push(detail.label);
  for (const [topic, value] of Object.entries(snapshot.life)) {
    if (value) lines.push(lifeTopics[topic][lang] + " · " + value.label);
  }
  return lines;
}

const scenes = {
  "free-weekend": text("空闲的周末", "On an unplanned weekend", "Un fin de semana sin planes"),
  "same-room": text("两人都在家时", "When you are both at home", "Cuando están en casa"),
  "work-trip": text("对方出差一周时", "When your partner travels for work for a week", "Cuando tu pareja se va una semana por trabajo"),
  "own-hobby": text("做自己的爱好时", "When spending time on a hobby", "Cuando dedicas tiempo a una afición"),
  friends: text("和朋友见面时", "When meeting friends", "Al ver a tus amistades"),
  travel: text("一起旅行时", "On a trip together", "En un viaje en pareja"),
  "after-work": text("工作一天后回到家", "When coming home tired", "Al volver a casa con cansancio"),
  "workday-message": text("忙到一整天没联系时", "After a workday with little contact", "Después de un día de trabajo con poco contacto"),
  "late-reply": text("一条消息迟迟没收到回复时", "While waiting for a reply", "Mientras esperas respuesta a un mensaje"),
  "love-words": text("说到「我想你」这样的话", "When thinking about words like “I miss you”", "Al pensar en palabras como «Te extraño»"),
  "quiet-partner": text("对方今天特别安静时", "When your partner is unusually quiet", "Cuando notas que tu pareja apenas habla"),
  unnoticed: text("自己的小变化没被注意时", "When a small change goes unnoticed", "Cuando un pequeño cambio pasa inadvertido"),
  "after-making-up": text("刚和好后的几天", "In the days after making up", "En los días posteriores a una reconciliación"),
  "special-days": text("在生日或纪念日", "On a birthday or anniversary", "En un cumpleaños o aniversario"),
  "working-late": text("加班到很晚的那一刻", "After working late", "Al terminar una larga jornada"),
  worry: text("说起烦心事时", "When talking about a worry", "Cuando cuentas algo que te preocupa"),
  "birthday-gift": text("选生日礼物时", "When thinking of a birthday gift", "Al pensar en un regalo de cumpleaños"),
  apology: text("想收到道歉时", "When hoping for an apology", "Cuando esperas una disculpa"),
  "sure-of-love": text("回想感到被爱的时刻", "When remembering a moment of feeling loved", "Al recordar un momento en que sentiste cariño"),
  "sick-at-home": text("生病在家时", "When ill at home", "Cuando te enfermas en casa"),
  "long-term": text("说到长期相处中会觉得缺少什么", "When considering what you miss over time", "Al pensar en lo que echas de menos con el tiempo"),
  "late-argument": text("深夜还有分歧时", "When a disagreement runs late into the evening", "Cuando un desacuerdo se alarga hasta la noche"),
  "hurtful-words": text("一句话让你不舒服时", "When someone’s words sting", "Cuando unas palabras te sientan mal"),
  "request-pause": text("对方想暂停时", "When your partner asks for a pause", "Cuando tu pareja pide una pausa"),
  "name-feeling": text("想理清自己在气什么时", "When trying to understand why you are upset", "Cuando intentas aclarar por qué te has molestado"),
  "big-decision": text("对大事意见不同时", "When you disagree on a big decision", "Cuando discrepan sobre una decisión importante"),
  "silent-hours": text("两人僵了半天时", "When neither of you has spoken for a while", "Cuando llevan un buen rato sin hablar"),
  "unexpected-invitation": text("对方没商量就答应邀约时", "When your partner accepts an invitation without checking in", "Cuando tu pareja acepta una invitación sin consultarte"),
};

function personalScenes(profile, signals, lang) {
  const examples = [];
  const order = Object.keys(axes).sort((a, b) => Number(signals.levels[b] === "middle") - Number(signals.levels[a] === "middle"));
  for (const axis of order) {
    const choices = questionsByAxis[axis].flatMap(q => {
      const option = q.options.find(item => item.id === profile?.answers?.[q.id]);
      return option ? [{ q, option }] : [];
    });
    if (!choices.length) continue;
    const winning = signals.letters[axis] === axes[axis].pair[0] ? "a" : "b";
    // A close vote is most informative when the example shows the quieter preference.
    const desired = signals.levels[axis] === "middle" ? (winning === "a" ? "b" : "a") : winning;
    const { q, option } = choices.find(item => item.option.id === desired) || choices[0];
    const context = scenes[q.id.slice("four-v5-".length)][lang];
    const answer = option.text[lang];
    const line = text(context + "，你选的是「" + answer + "」。",
      context + ", you chose “" + answer + "”.",
      context + ", elegiste «" + answer + "».");
    examples.push(line[lang]);
    if (examples.length === 3) break;
  }
  return examples.join(lang === "zh" ? "" : " ");
}

export function fourReport(profile, lang) {
  const signals = core(profile);
  const { letters, levels, typeCode } = signals;
  const type = portraits[typeCode];
  const title = type?.name[lang] || partialTitle[lang];
  const incomplete = text("部分偏好仍待确认，先看看已经说得清的部分。", "Some preferences are still open. Here is what your answers suggest so far.", "Algunas preferencias siguen abiertas. Esto es lo que indican tus respuestas hasta ahora.")[lang];
  const summary = type ? familyLines[typeCode.slice(0, 2)][lang] : incomplete;
  const legend = [];
  const middle = [];
  const chapters = (type?.lines || []).map((line, i) => ({ title: headings[i][lang], body: line[lang] }));
  for (const [axis, letter] of Object.entries(letters)) {
    const value = letter ? letter + " · " + poles[letter][lang] + " · " + strengths[levels[axis]][lang] : pending[lang];
    legend.push(axes[axis].name[lang] + " · " + value);
    if (levels[axis] === "middle") middle.push(otherSide[letter][lang]);
  }
  if (middle.length) chapters.push({
    title: text("接近中间的地方", "Where you fall near the middle", "Donde estás cerca del punto medio")[lang],
    body: middle.join(lang === "zh" ? "" : " "),
  });
  const personal = personalScenes(profile, signals, lang);
  if (personal) chapters.push({
    title: text("你在这些时刻的选择", "Moments from your own life", "Momentos que elegiste")[lang],
    body: personal,
  });
  const snapshot = fourSnapshot(profile, lang);
  const life = Object.entries(snapshot.life).filter(([, value]) => value)
    .map(([axis, value]) => lifeTopics[axis][lang] + " · " + value.label);
  life.push(...snapshot.household.map(item => item.label));
  if (life.length) chapters.push({
    title: text("人生选择与共同生活", "Life choices and shared responsibilities", "Decisiones de vida y responsabilidades compartidas")[lang],
    body: life.join("\n"),
  });
  const introduction = type
    ? text("我是" + title + " · " + typeCode + "。" + summary + "。",
      "My style is " + title + " · " + typeCode + ". " + summary,
      "Mi estilo es " + title + " · " + typeCode + ". " + summary)[lang]
    : "";
  return { title, typeCode, summary, legend, chapters, introduction, sections: [], coverage: "" };
}
