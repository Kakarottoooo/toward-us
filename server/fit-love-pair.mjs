import { inventoryQuestions } from "./fit-inventory.mjs";
import { fitFuturePlans, fitPairPatternName } from "./fit-pair-pattern.mjs";
import { portableQuestions } from "./fit-portable.mjs";
import { loveQuestions } from "./fit-love-questions.mjs";
import { loveStyleReport, loveStyleSignals } from "./fit-love-style.mjs";

const text = (zh, en, es) => ({ zh, en, es });
const varies = text("随当时情况变化", "depends on the situation", "depende de la situación");
const missing = text("待确认", "still open", "por confirmar");
const you = text("你", "You", "Tú");
const fromPortraits = text("根据双方同意分享的画像推测", "Based on the portraits you both shared", "Según los retratos que ambos compartieron");
const situations = {
  daily: {
    title: text("日常亲近", "Everyday closeness", "Cercanía cotidiana"),
    a: text("多留一些共同时间", "more time together", "más tiempo en compañía"),
    b: text("保留各自安排的时间", "time for individual plans", "tiempo para planes propios"),
    tip: text("各选一个想要共处的时段，再留出一个可以各自安排的时段。试过之后，问问对方哪一段最舒服。", "Choose one time to spend together and one to leave open. Afterwards, ask each other which part felt best.", "Elijan un momento para compartir y otro para sus propios planes. Después, cuéntense en cuál se sintieron más a gusto."),
  },
  care: {
    title: text("表达在乎", "Showing affection", "Expresar cariño"),
    a: text("把欣赏和心意说出来", "affection put into words", "cariño expresado con palabras"),
    b: text("用具体的小事表达关心", "care shown in small gestures", "cariño expresado con pequeños gestos"),
    tip: text("下次想表达喜欢时，搭配对方容易收到的方式。比如替对方带一份晚饭时，也说一句今天为什么想到了对方。", "Try combining the two forms of affection. Bringing dinner can be a chance to say what made you think of each other today.", "Prueben a combinar ambas formas de cariño. Al traer la cena pueden contar qué les hizo pensar hoy en su pareja."),
  },
  support: {
    title: text("面对外部压力", "Support under outside stress", "Apoyo ante la presión externa"),
    a: text("先听完感受", "listening to feelings first", "escuchar los sentimientos primero"),
    b: text("先试着帮上具体的忙", "offering practical help first", "ofrecer ayuda concreta primero"),
    tip: text("有人带着烦恼回家时，先问「你想把它讲完，还是有件事想让我陪你做？」准备动手前，让对方说出真正需要帮忙的那一步。", "When one of you brings a problem home, ask whether they want to finish the story or tackle a specific task together. Let them choose the first step.", "Cuando alguien llegue con un problema, pregunten si quiere terminar de contarlo o resolver juntos una tarea concreta. Que pueda elegir el primer paso."),
  },
  repair: {
    title: text("分歧后的修复", "Reconnecting after disagreement", "Reencuentro tras un desacuerdo"),
    a: text("早点把谈话接回来", "returning to the conversation soon", "retomar pronto la conversación"),
    b: text("先留时间整理再回来谈", "taking a pause before returning", "tomarse un tiempo antes de retomar la charla"),
    tip: text("需要暂停时，先说一句「我还想把这件事谈完」，再一起约一个回来谈的时间。如果需要延后，主动告诉对方。", "When either of you needs a pause, say that you want to finish the conversation and agree when to return. If plans change, let the other person know.", "Cuando necesiten una pausa, digan que quieren terminar la conversación y acuerden cuándo retomarla. Si cambia el momento, avisen."),
  },
  planning: {
    title: text("共同筹划", "Making decisions together", "Tomar decisiones en pareja"),
    a: text("从形成方向时一起讨论", "discussing the direction from the start", "conversar desde que empieza a formarse la idea"),
    b: text("先查清选项再一起商量", "exploring the options before discussing them together", "explorar las opciones antes de hablarlas en pareja"),
  },
};

const headlines = {
  "111": text("平常能亲近，遇事能支持，有分歧也能重新接上。", "Everyday closeness, outside support and reconnecting after disagreements all look like common ground.", "La cercanía diaria, el apoyo ante la presión externa y el reencuentro tras un desacuerdo parecen puntos en común."),
  "110": text("平时相处自然，遇到外面的难事能并肩；彼此有分歧时，需要约好怎样重新靠近。", "Daily life and outside challenges suit you as a team. After a disagreement, agree on how to find your way back.", "La convivencia y las dificultades externas se prestan al trabajo en equipo. Tras un desacuerdo, acuerden cómo volver a acercarse."),
  "101": text("平时有亲近感，争执后也容易重新靠近；一方遇到外部压力时，值得说清怎样支持。", "Everyday affection and making up come naturally on paper. When outside stress arrives, say what kind of support would help.", "La cercanía diaria y el reencuentro parecen fluir. Cuando llegue un problema externo, hablen del apoyo que desean."),
  "011": text("难事面前能互相支持，分歧后能重新靠近；平常怎样陪伴和示爱值得商量。", "You can be a team under pressure and reconnect after a disagreement. Talk about what everyday closeness should look like.", "Pueden acompañarse bajo presión y reencontrarse tras un desacuerdo. Conviene hablar de cómo vivir la cercanía cotidiana."),
  "100": text("平常相处最有默契；遇到外部压力或两人分歧时，更需要说清彼此所需。", "Everyday closeness is your strongest match. Under pressure or after a disagreement, name the response each person needs.", "La cercanía diaria es su mayor coincidencia. Ante la presión o tras un desacuerdo, digan qué respuesta necesita cada quien."),
  "010": text("一起处理外面的难事是优势；平时怎样表达在乎、分歧后怎样接话，值得协调。", "Working through outside trouble together is a strength. Everyday affection and repairing disagreements need coordination.", "Afrontar juntos los problemas externos es una fortaleza. El cariño cotidiano y la reparación tras una discusión requieren coordinación."),
  "001": text("分歧后重新接上是你们的优势；日常亲近和压力下的支持，需要更具体地了解对方。", "Reconnecting after disagreements is a strength. Explore what makes each of you feel close and supported day to day.", "Reencontrarse tras una discusión es una fortaleza. Exploren qué les hace sentir cercanía y apoyo en el día a día."),
  "000": text("在三个场景里，至少一方的习惯与对方所需有差异。先从一件具体的小事试起。", "In each area, at least one person's habit differs from what the other seeks. Start with one small adjustment.", "En cada ámbito, por lo menos una costumbre difiere de lo que busca la otra persona. Empiecen por un ajuste concreto."),
};

const allQuestions = [...inventoryQuestions, ...portableQuestions, ...loveQuestions];
function tendency(profile, axis) {
  const questions = allQuestions.filter(q => q.axis === axis);
  const answered = questions.map(q => profile.answers?.[q.id]).filter(value => value === "a" || value === "b");
  if (answered.length < Math.min(3, questions.length) || !answered.length) return "unknown";
  const balance = answered.reduce((n, value) => n + (value === "a" ? 1 : -1), 0);
  return Math.abs(balance) < 2 ? "mixed" : balance > 0 ? "a" : "b";
}

function project(profile, lang) {
  const style = loveStyleSignals(profile);
  const { title, typeCode } = loveStyleReport(profile, lang) || {};
  return {
    typeName: typeCode ? title : missing[lang],
    daily: [style.space, tendency(profile, "receive-space")],
    care: [tendency(profile, "care"), tendency(profile, "receive-care")],
    support: [style.support, tendency(profile, "support")],
    repair: [tendency(profile, "repair"), tendency(profile, "receive-repair")],
    planning: style.planning,
    plans: fitFuturePlans.map(p => p.options.find(o => o.id === profile.answers?.["portrait-v3-" + p.id])),
  };
}
const label = (area, value, lang) => (situations[area][value] || (value === "mixed" ? varies : missing))[lang];
function pairingStatus(giving, receiving) {
  if (giving === "unknown" || receiving === "unknown") return "unknown";
  if (giving === "mixed" || receiving === "mixed") return "mixed";
  return giving === receiving ? "same" : "different";
}
function bothDirections(forward, back) {
  if ([forward, back].includes("unknown")) return "unknown";
  if ([forward, back].includes("mixed")) return "mixed";
  return [forward, back].includes("different") ? "different" : "same";
}
const areaIds = ["daily", "care", "support", "repair"];
export function lovePairPreview(profile, lang) {
  const p = project(profile, lang);
  return [
    text("我的恋爱风格", "My love style", "Mi estilo en pareja")[lang] + " · " + p.typeName,
    ...areaIds.map(area => {
      const [give, receive] = p[area].map(v => label(area, v, lang));
      const line = text(`我的习惯是「${give}」，希望伴侣「${receive}」`, `My tendency: ${give}. I look for: ${receive}`, `Mi tendencia: ${give}. Busco: ${receive}`);
      return situations[area].title[lang] + " · " + line[lang];
    }),
    situations.planning.title[lang] + " · " + label("planning", p.planning, lang),
    ...fitFuturePlans.flatMap((pdef,i) => p.plans[i] ? [pdef.title[lang] + " · " + p.plans[i].text[lang]] : []),
  ];
}

function direction(area, from, to, giver, receiver, lang) {
  const a = label(area, from, lang), b = label(area, to, lang);
  return text(`${giver} → ${receiver}：习惯「${a}」，对方希望「${b}」。`, `${giver} → ${receiver}: tendency: ${a}; preference on the receiving side: ${b}.`, `${giver} → ${receiver}: tendencia: ${a}; lo que busca quien recibe: ${b}.`)[lang];
}
function practicalOpening(area, give, receive, giver, receiver, lang) {
  if (area === "support") {
    return receive === "a"
      ? text(`${giver}可以先给${receiver}留出讲完的时间，再问「你现在想一起想办法了吗？」`, `${giver} can give ${receiver} time to finish the story, then check whether ideas would help.`, `${giver} puede dejar que ${receiver} termine de contar lo ocurrido y luego preguntar si quiere pensar en soluciones.`)[lang]
      : text(`${giver}可以问${receiver}「眼前哪一步，你想让我陪你处理？」让对方挑一件具体的事。`, `${giver} can ask ${receiver} which concrete step would help, and let them choose the task.`, `${giver} puede preguntar a ${receiver} en qué paso concreto vendría bien su ayuda y dejar que elija.`)[lang];
  }
  if (area === "repair") {
    return give === "a"
      ? text(`${giver}想继续谈时，可以先问${receiver}需要多久整理，一起约好什么时候继续。到了约定的时间，再各说一件最想被听懂的事。`, `When ${giver} wants to talk, ask how much time ${receiver} needs. Agree when to return and each name one thing you want understood.`, `Cuando ${giver} quiera hablar, conviene preguntar cuánto tiempo necesita ${receiver}. Acuerden cuándo retomar la charla y qué quiere expresar cada quien.`)[lang]
      : text(`${giver}需要暂停时，可以先让${receiver}知道「我想把这件事谈完」，并约一个回来谈的时间。时间有变化时主动告诉对方。`, `If ${giver} needs a pause, tell ${receiver} that the conversation matters and agree on a time to return. Give notice if that time changes.`, `Si ${giver} necesita una pausa, puede asegurar a ${receiver} que quiere terminar la conversación y acordar cuándo volver. Si cambia la hora, conviene avisar.`)[lang];
  }
  return situations[area].tip[lang];
}
function areaSection(area, own, peer, partner, lang) {
  const [g1, r1] = own[area], [g2, r2] = peer[area];
  const forward = pairingStatus(g1, r2), back = pairingStatus(g2, r1);
  const status = bothDirections(forward, back);
  let suggestion = situations[area].tip[lang];
  if (forward === "different" && back !== "different") suggestion = practicalOpening(area, g1, r2, you[lang], partner, lang);
  if (back === "different" && forward !== "different") suggestion = practicalOpening(area, g2, r1, partner, you[lang], lang);
  return { id: "love-" + area, title: situations[area].title[lang], status,
    summary: [direction(area, g1, r2, you[lang], partner, lang), direction(area, g2, r1, partner, you[lang], lang)].join("\n"),
    suggestion, evidence: [] };
}

function planningSection(own, peer, partner, lang) {
  const a = label("planning", own.planning, lang), b = label("planning", peer.planning, lang);
  const status = pairingStatus(own.planning, peer.planning);
  let suggestion = text("考虑搬家时，可以先约定预算、通勤和各自最在意的事，然后分头查资料，带着选项回来一起决定。", "When planning a move, agree on costs, commuting and priorities, then explore options and choose together.", "Al planear una mudanza, hablen primero del presupuesto, los trayectos y sus prioridades. Luego exploren opciones y elijan en pareja.");
  if (status === "same" && own.planning === "b") suggestion = text("各自找一两个可行选项，约好交流的时间。在预订或作出承诺之前，一起比较取舍。", "Each of you can research one or two options. Set a time to compare trade-offs before either of you commits.", "Cada persona puede buscar una o dos opciones. Acuerden cuándo comparar las ventajas antes de comprometerse.");
  if (status === "same" && own.planning === "a") suggestion = text("念头还很初步时，就把最想实现的事讲给对方听。一起选定目标之后，再分工查选项。", "Share the idea while it is still forming. Agree on the goal, then divide up the research.", "Compartan la idea mientras está tomando forma. Acuerden la meta y repartan la búsqueda de opciones.");
  return {id:"love-planning",title:situations.planning.title[lang],status,
    summary:text(`你的习惯是「${a}」，${partner}的习惯是「${b}」。`, `Your tendency is ${a}. ${partner}'s is ${b}.`, `Tu tendencia es ${a}. La de ${partner} es ${b}.`)[lang],
    suggestion:suggestion[lang],evidence:[]};
}

export function lovePairReport(mine, theirs, partnerName, lang) {
  const own = project(mine, lang), peer = project(theirs, lang);
  const partner = partnerName || text("TA", "your partner", "tu pareja")[lang];
  const [daily, care, support, repair] = areaIds.map(area => areaSection(area, own, peer, partner, lang));
  // Everyday time is the anchor. Expressing affection can reveal a second mismatch, but cannot substitute for missing information about time together.
  const timeStatus = daily.status;
  daily.status = bothDirections(timeStatus, care.status);
  if (timeStatus === "same" && care.status === "different") daily.suggestion = care.suggestion;
  daily.summary += "\n" + situations.care.title[lang] + "\n" + care.summary;
  const main = [daily, support, repair];
  const code = main.map(s => ({ same:"1", different:"0" }[s.status] || "?")).join("");
  const name = fitPairPatternName(code, lang);
  const title = name ? text(`「${name}」恋人`, name, name)[lang] : text("你们的合拍线索", "Your connection so far", "Lo que sugieren sus preferencias")[lang];
  const lead = headlines[code]?.[lang] || text("部分场景仍待确认，先看两个人已经说清的需要。", "Some areas are still open. Start with the needs each person has described.", "Algunos ámbitos quedan por confirmar. Empiecen por las necesidades que cada quien ha expresado.")[lang];
  const styles = text(`你：${own.typeName}　${partner}：${peer.typeName}`, `Your style: ${own.typeName}. ${partner}: ${peer.typeName}.`, `Tu estilo: ${own.typeName}. ${partner}: ${peer.typeName}.`)[lang];
  const summary = fromPortraits[lang] + " · " + lead + "\n" + styles;
  const introduction = name ? text(`我们是「${name}」恋人。${lead}`, `Our pattern is “${name}”. ${lead}`, `Nuestro estilo es «${name}». ${lead}`)[lang] : lead;
  const planning = planningSection(own, peer, partner, lang);
  const sections = [...main, planning];
  const nextArea = main.find(s => s.status === "different") || main.find(s => s.status !== "same") || (planning.status === "different" ? planning : daily);
  let nextStep = nextArea.suggestion;
  let lifePriority = 0;
  for (const [i, plan] of fitFuturePlans.entries()) {
    const a = own.plans[i], b = peer.plans[i];
    if (!a || !b) continue;
    const aText = a.text[lang], bText = b.text[lang];
    const unsettled = a.id === "open" || b.id === "open";
    const different = a.id !== b.id;
    const isChildren = plan.id === "children";
    const status = unsettled || !isChildren ? "mixed" : different ? "different" : "same";
    let suggestion = plan.prompt[lang];
    if (isChildren && different) suggestion = unsettled
      ? text("找一段不赶时间的空档，各说说对养育孩子已经确定的想法、还需要弄清的顾虑。先约好下次什么时候回来谈。", "Make time to discuss what each of you already knows about raising children, what remains open, and when to revisit the question.", "Reserven un momento para hablar de lo que cada quien tiene claro sobre criar hijos, qué falta por decidir y cuándo volver a hablarlo.")[lang]
      : text("把是否养育孩子单独拿出来谈。分别说清这个决定对自己的意义，以及它会怎样影响未来的共同生活。", "Have a dedicated conversation about children. Say what this choice means to each of you and how it would shape your shared life.", "Dediquen una conversación a la decisión de criar hijos. Expliquen lo que significa para cada persona y cómo afectaría a su vida común.")[lang];
    const priority = different ? (isChildren ? 2 : 1) : 0;
    if (priority > lifePriority) { nextStep = suggestion; lifePriority = priority; }
    sections.push({ id:"love-plan-" + plan.id, title:plan.title[lang], status,
      summary:text(`你的打算是「${aText}」，${partner}的打算是「${bText}」。`, `Your intention: “${aText}”. ${partner}: “${bText}”.`, `Tu intención: «${aText}». ${partner}: «${bText}».`)[lang],
      suggestion,evidence:[] });
  }
  return { status:"ready", partnerName, title, summary, sections, nextStep, introduction };
}
