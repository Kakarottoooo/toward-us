import { fitModules, overviewQuestionIds, zodiacNames } from "./fit-questions.mjs";

const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;
const selected = (profile, question) => question.options.find((option) => option.id === profile.answers?.[question.id]);
export const fitOverviewComplete = (profile) => overviewQuestionIds.every((id) => typeof profile?.answers?.[id] === "string");

// Preference definitions follow the Myers & Briggs Foundation's preference and
// relationship guides. Practical prompts below are Pinky's suggested experiments.
const mbtiAxes = [
  {
    title: ["恢复精力", "Recharging", "Recargar energía"],
    choices: { E: ["向外交流、边聊边想", "interaction and thinking aloud", "interactuar y pensar en voz alta"], I: ["独处整理、想好再说", "reflection before sharing", "reflexionar antes de compartir"] },
    together: ["先约一段一起聊的时间，也给各自整理思路的空隙。", "Agree on time to talk and room to gather your thoughts.", "Acuerden un rato para hablar y espacio para ordenar las ideas."],
  },
  {
    title: ["接收信息", "Taking in information", "Recibir información"],
    choices: { S: ["从具体事实和细节入手", "concrete facts and details", "hechos concretos y detalles"], N: ["从整体、联系和可能性入手", "patterns and possibilities", "patrones y posibilidades"] },
    together: ["做计划时先讲想要的体验，再一起列出日期、预算和细节。", "Start a plan with the experience you want, then add dates, budget, and details.", "Empiecen por la experiencia deseada y añadan fechas, presupuesto y detalles."],
  },
  {
    title: ["做决定", "Making decisions", "Tomar decisiones"],
    choices: { T: ["先看逻辑和一致的原则", "logic and consistent principles", "lógica y principios coherentes"], F: ["先看个人价值和对人的影响", "personal values and impact on people", "valores personales e impacto en las personas"] },
    together: ["遇到分歧，各说清现实利弊和对自己的影响，再一起选。", "In a disagreement, each explain both the practical trade-offs and the personal impact.", "Ante un desacuerdo, expliquen las ventajas prácticas y el impacto personal."],
  },
  {
    title: ["安排生活", "Organizing life", "Organizar la vida"],
    choices: { J: ["喜欢先定下来、有清楚安排", "settled plans and structure", "planes definidos y estructura"], P: ["喜欢保留选择、灵活调整", "open options and flexibility", "opciones abiertas y flexibilidad"] },
    together: ["先定必须敲定的时间和预算，再留一段临场决定的空间。", "Set essential timing and budget, then leave part of the plan open.", "Fijen la hora y el presupuesto necesarios y dejen una parte abierta."],
  },
];
const atLanguage = (values, language) => values[language === "en" ? 1 : language === "es" ? 2 : 0];

function mbtiNote(profile, language) {
  const introduction = say(language,
    `你自填的类型是 ${profile.mbti}。下面按类型框架解读这四个偏好，实际情况可以用你的经历核对。`,
    `You reported ${profile.mbti}. Here is how the framework describes those preferences. Check them against your own experiences.`,
    `Indicaste ${profile.mbti}. Así describe el marco esas preferencias. Compáralas con tus experiencias.`);
  const preferences = mbtiAxes.map((axis, index) => `${profile.mbti[index]} · ${atLanguage(axis.title, language)} — ${atLanguage(axis.choices[profile.mbti[index]], language)}`);
  const question = say(language,
    "回想最近一次累了一天后的相处：你想先聊，还是先整理自己的思路？哪一种让你更舒服？",
    "Think of your last tiring day: did you want to talk first or gather your thoughts? What felt better?",
    "Piensa en tu último día agotador: ¿querías hablar primero o ordenar tus ideas? ¿Qué te sentó mejor?");
  return [introduction, ...preferences, question].join("\n\n");
}

function mbtiPairNote(mine, partner, partnerName, language) {
  const introduction = say(language,
    `你自填 ${mine.mbti}，${partnerName} 自填 ${partner.mbti}。以下按类型框架比较双方偏好，适合拿真实场景核对和聊天。`,
    `You reported ${mine.mbti}; ${partnerName} reported ${partner.mbti}. Use this framework comparison as a starting point and check it against real situations.`,
    `Indicaste ${mine.mbti}; ${partnerName} indicó ${partner.mbti}. Usen esta comparación como punto de partida y contrástenla con situaciones reales.`);
  const preferences = mbtiAxes.map((axis, index) => {
    const own = atLanguage(axis.choices[mine.mbti[index]], language);
    const theirs = atLanguage(axis.choices[partner.mbti[index]], language);
    const comparison = mine.mbti[index] === partner.mbti[index]
      ? say(language, `你们填写的偏好相同，都偏向${own}。`, `Your reported preferences match: ${own}.`, `Sus preferencias indicadas coinciden: ${own}.`)
      : say(language, `你偏向${own}，${partnerName} 偏向${theirs}。`, `You lean toward ${own}; ${partnerName} toward ${theirs}.`, `Te inclinas por ${own}; ${partnerName}, por ${theirs}.`);
    return `${atLanguage(axis.title, language)}\n${comparison} ${atLanguage(axis.together, language)}`;
  });
  return [introduction, ...preferences].join("\n\n");
}

const zodiacPrompts = {
  aries: ["一起出发", "starting an adventure", "empezar una aventura"],
  taurus: ["享受小日常", "enjoying little comforts", "disfrutar los pequeños placeres"],
  gemini: ["聊点新鲜事", "trading curious stories", "compartir historias curiosas"],
  cancer: ["留住温暖", "keeping a warm memory", "guardar un recuerdo cálido"],
  leo: ["一起庆祝", "celebrating together", "celebrar juntos"],
  virgo: ["照顾小细节", "noticing little details", "cuidar los pequeños detalles"],
  libra: ["一起挑选", "choosing together", "elegir juntos"],
  scorpio: ["分享一个小秘密", "sharing a little secret", "compartir un pequeño secreto"],
  sagittarius: ["探索没去过的地方", "exploring somewhere new", "explorar un lugar nuevo"],
  capricorn: ["完成一个小目标", "finishing a little goal", "lograr una pequeña meta"],
  aquarius: ["试个奇妙点子", "trying a surprising idea", "probar una idea sorprendente"],
  pisces: ["创造一点浪漫", "creating a romantic moment", "crear un momento romántico"],
};

function zodiacNote(mine, partner, language) {
  const index = language === "en" ? 1 : language === "es" ? 2 : 0;
  const first = zodiacPrompts[mine.zodiac][index], second = zodiacPrompts[partner.zodiac][index];
  return say(language,
    `趣味星座故事：今晚你把「${first}」写在第一张小纸条上，TA 把「${second}」写在另一张。交换打开后，各为对方安排十分钟的小惊喜，再给这次约会起个名字。你想先准备哪一个细节？这段故事供娱乐和聊天，相处解析依据下方真实回答。`,
    `A playful zodiac scene: write “${first}” on a note while your partner writes “${second}”. Swap notes, each create a ten-minute surprise, and name your little date. Which detail would you prepare first? This story is for entertainment and conversation; relationship insights use your actual answers below.`,
    `Una escena de signos: escribe «${first}» en una nota mientras tu pareja escribe «${second}». Intercámbienlas, preparen una sorpresa de diez minutos cada uno y pónganle nombre a su cita. ¿Qué detalle prepararías primero? Este cuento es entretenimiento para conversar; el análisis usa sus respuestas reales.`);
}

export function personalFitReport(profile, language) {
  const answered = Object.keys(profile.answers || {}).length;
  if (!answered && !profile.mbti && !profile.zodiac) return null;
  const sections = fitModules.flatMap((module) => {
    const evidence = module.questions.flatMap((question) => {
      const choice = selected(profile, question);
      return choice ? [{ questionId: question.id, question: question.text[language], answer: choice.text[language], meaning: choice.meaning[language] }] : [];
    });
    if (!evidence.length) return [];
    const firstQuestion = module.questions.find((question) => selected(profile, question));
    const first = selected(profile, firstQuestion);
    return [{
      id: module.id, title: module.title[language],
      summary: evidence.map((item) => item.meaning).join(" "), evidence,
      suggestion: module.advice[Number(first.id)][language], answered: evidence.length, total: module.questions.length,
    }];
  });
  if (profile.mbti) sections.push({
    id: "mbti", title: say(language, "我的 MBTI", "My MBTI", "Mi MBTI"), summary: mbtiNote(profile, language),
    evidence: [], suggestion: say(language, "来源：你自己填写的 MBTI 类型。可以随时修改。", "Source: your self-reported MBTI type. You can update it anytime.", "Fuente: tu tipo MBTI indicado por ti. Puedes cambiarlo cuando quieras."), answered: 1, total: 1,
  });
  if (profile.zodiac) {
    const name = zodiacNames[profile.zodiac][language];
    sections.push({
      id: "zodiac", title: say(language, "我的星座 · 趣味", "My sign · Just for fun", "Mi signo · Por diversión"),
      summary: say(language, `你选了${name}。趣味小剧场：今天给你一张「${zodiacPrompts[profile.zodiac][0]}」任务卡。找一个能让你微笑的地方，拍一张照片，写一句想对未来自己说的话。你会把这段小约会留给哪一天？`, `You chose ${name}. A playful scene: today's little mission is ${zodiacPrompts[profile.zodiac][1]}. Find a place that makes you smile, take a photo, and write one line to your future self. Which day would you save this tiny date for?`, `Elegiste ${name}. Una escena por diversión: tu pequeña misión de hoy es ${zodiacPrompts[profile.zodiac][2]}. Busca un lugar que te haga sonreír, toma una foto y escribe una frase para tu yo del futuro. ¿Qué día reservarías para esta pequeña cita?`),
      evidence: [], suggestion: say(language, "来源：你填写的星座。这段趣味内容可以拿来聊天，相处解析采用你的情景回答。", "Source: your chosen zodiac sign. Enjoy this conversation prompt; your relationship insights use your situation answers.", "Fuente: el signo que elegiste. Disfruta esta idea para conversar; el análisis usa tus respuestas a las situaciones."), answered: 1, total: 1,
    });
  }
  return {
    title: say(language, "我的关系说明书", "My relationship guide", "Mi guía en pareja"),
    summary: say(language, `从你亲自选择的 ${answered} 个场景，看看怎样的相处让你舒服。你的选择会随时间和情境变化，可以回来修改。`, `Explore what feels good in a relationship through ${answered} situations you answered yourself. Preferences can shift with time and context; you can come back and edit.`, `Explora qué te hace sentir bien en pareja a partir de ${answered} situaciones que respondiste. Las preferencias cambian con el tiempo y el contexto; puedes volver y editar.`),
    sections,
    coverage: say(language, `已答 ${answered}/18。每个方面先答一道可得到初步理解，继续补充经历会更具体。`, `${answered}/18 answered. One situation per area offers an initial view; more context adds detail.`, `${answered}/18 respuestas. Una situación por área da una primera idea; más contexto aporta detalle.`),
  };
}

export function coupleFitReport(mine, partner, partnerName, language) {
  const sections = fitModules.map((module) => {
    const evidence = module.questions.flatMap((question) => {
      const own = selected(mine, question), theirs = selected(partner, question);
      return own && theirs ? [{ questionId: question.id, question: question.text[language], mine: own.text[language], partner: theirs.text[language] }] : [];
    });
    const same = module.questions.filter((question) => selected(mine, question) && selected(mine, question)?.id === selected(partner, question)?.id).length;
    const status = !evidence.length ? "unknown" : same === evidence.length ? "same" : same ? "mixed" : "different";
    const firstDifferent = module.questions.find((question) => selected(mine, question) && selected(partner, question) && selected(mine, question).id !== selected(partner, question).id);
    const anchor = firstDifferent || module.questions.find((question) => selected(mine, question) && selected(partner, question));
    let summary;
    if (!anchor) summary = say(language, "这个方面还需要你们各自补充回答。", "Both of you need to add an answer in this area.", "Hace falta que ambos añadan una respuesta en esta área.");
    else {
      const own = selected(mine, anchor).text[language], theirs = selected(partner, anchor).text[language];
      summary = status === "same"
        ? say(language, `在你们都答过的 ${evidence.length} 个场景里，选择一致。比如这次你们都选了「${own}」，可以从这个共同偏好安排一次相处。`, `You chose the same responses in ${evidence.length} shared situations. For example, you both chose “${own}”. That gives you a concrete shared preference to try.`, `Coincidieron en ${evidence.length} situaciones compartidas. Por ejemplo, ambos eligieron «${own}». Es una preferencia concreta que pueden probar juntos.`)
        : say(language, `在「${anchor.text.zh}」里，你选「${own}」，${partnerName} 选「${theirs}」。把各自期待说具体，有助于找到双方舒服的做法。`, `For “${anchor.text.en}”, you chose “${own}” and ${partnerName} chose “${theirs}”. Explaining what each of you hopes for can help you find an arrangement that works for both.`, `Ante «${anchor.text.es}», elegiste «${own}» y ${partnerName} eligió «${theirs}». Explicar qué espera cada uno puede ayudarles a encontrar algo cómodo para ambos.`);
    }
    return {
      id: module.id, title: module.title[language], status, summary, evidence,
      suggestion: anchor ? say(language, `一起聊聊：「${anchor.text.zh}」里，对方的选项有什么吸引你的地方？下次可以怎样照顾两个人的偏好？`, `Talk about “${anchor.text.en}”: what appeals to you in your partner's choice, and how could you make room for both preferences next time?`, `Hablen sobre «${anchor.text.es}»: ¿qué te atrae de la elección de tu pareja y cómo podrían dar espacio a ambas preferencias?`) : module.description[language],
    };
  });
  const known = sections.filter((section) => section.status !== "unknown").length;
  const same = sections.filter((section) => section.status === "same").length;
  const report = {
    status: "ready", partnerName,
    summary: say(language, `你们在 ${known} 个方面有共同回答，其中 ${same} 个方面的已答场景选择一致。下面逐项看哪些想法接近、哪些值得商量。解析只使用双方本次确认分享的回答。`, `You have shared answers in ${known} areas; in ${same}, all answered situations match. Explore the points you share and the ones worth discussing. These insights use only the answers you both agreed to share.`, `Tienen respuestas compartidas en ${known} áreas; en ${same} coincidieron en todas las situaciones respondidas. Exploren lo que comparten y lo que conviene conversar. Este análisis usa solo las respuestas que ambos aceptaron compartir.`),
    sections,
  };
  if (mine.mbti && partner.mbti) {
    report.mbti = {
      title: `${mine.mbti} × ${partner.mbti}`,
      summary: mbtiPairNote(mine, partner, partnerName, language),
    };
  }
  if (mine.zodiac && partner.zodiac) report.zodiac = {
    title: `${zodiacNames[mine.zodiac][language]} × ${zodiacNames[partner.zodiac][language]}`,
    summary: zodiacNote(mine, partner, language),
  };
  return report;
}
