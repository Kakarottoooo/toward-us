import { fitModules, overviewQuestionIds, zodiacNames } from "./fit-questions.mjs";

const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;
const selected = (profile, question) => question.options.find((option) => option.id === profile.answers?.[question.id]);
export const fitOverviewComplete = (profile) => overviewQuestionIds.every((id) => typeof profile?.answers?.[id] === "string");

function mbtiNote(profile, language) {
  return say(language,
    `你填写的类型是 ${profile.mbti}。可以借这个标签聊聊：怎样恢复精力、喜欢怎样接收信息、做决定时在意什么、怎样安排生活。把情景里的选择和真实经历放在一起看，会更了解自己。`,
    `You entered ${profile.mbti}. Use this label to explore how you recharge, take in information, make decisions, and organize life. Your situation choices and lived experiences add useful detail.`,
    `Ingresaste ${profile.mbti}. Usa esta etiqueta para explorar cómo recargas energía, recibes información, tomas decisiones y organizas tu vida. Tus elecciones y experiencias aportan más detalle.`);
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
    `趣味星座故事：把「${first}」和「${second}」放进同一次小约会，会是什么样？各自挑一个喜欢的细节，试着给你们的组合起个名字。这段内容供娱乐和聊天，双方的相处解析依据下方真实回答。`,
    `A playful zodiac story: what would a tiny date combine from “${first}” and “${second}”? Each pick a detail you like and name your duo. This is for entertainment and conversation; your relationship insights use your actual answers below.`,
    `Un juego de signos: ¿cómo sería una pequeña cita que una «${first}» y «${second}»? Elijan un detalle cada uno y pónganle nombre a su dúo. Es entretenimiento para conversar; el análisis de su relación se basa en las respuestas reales de abajo.`);
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
      summary: say(language, `你选了${name}。想象以「${zodiacPrompts[profile.zodiac][0]}」为主题，给自己设计一个小小的约会。`, `You chose ${name}. Imagine a tiny date inspired by ${zodiacPrompts[profile.zodiac][1]}.`, `Elegiste ${name}. Imagina una pequeña cita inspirada en ${zodiacPrompts[profile.zodiac][2]}.`),
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
      summary: say(language, `你填写 ${mine.mbti}，${partnerName} 填写 ${partner.mbti}。拿双方在「性格与生活节奏」里的选择，聊聊怎样充电、怎样做决定更舒服。类型由本人填写；具体相处建议以你们的场景回答为依据。`, `You entered ${mine.mbti}; ${partnerName} entered ${partner.mbti}. Use your Personality & pace answers to discuss how each of you likes to recharge and make decisions. Types are self-reported; practical suggestions come from your situation answers.`, `Ingresaste ${mine.mbti}; ${partnerName} ingresó ${partner.mbti}. Usen las respuestas de Personalidad y ritmo para hablar de cómo recargan energía y deciden. Los tipos son los que indicó cada uno; las sugerencias se apoyan en sus respuestas.`),
    };
  }
  if (mine.zodiac && partner.zodiac) report.zodiac = {
    title: `${zodiacNames[mine.zodiac][language]} × ${zodiacNames[partner.zodiac][language]}`,
    summary: zodiacNote(mine, partner, language),
  };
  return report;
}
