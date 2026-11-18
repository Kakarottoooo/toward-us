import { inventoryQuestions } from "./fit-inventory.mjs";
import { fitFuturePlans, fitPairPatternName } from "./fit-pair-pattern.mjs";

const tr = (zh, en, es) => ({ zh, en, es });
const idFor = key => "portrait-v3-" + key;
function scene(key, axis, text, a, b, reverse = false) {
  const options = [{ id: "a", text: a }, { id: "b", text: b }];
  return { id: idFor(key), axis, text, options: reverse ? options.reverse() : options };
}

export const portableQuestions = [
  scene("kept", "receive-care",
    tr("最近一次你做成一件费劲的事，有人为你庆祝。过了几天，你还会跟别人提起哪个细节？", "Someone celebrated a hard-won success with you. A few days later, which detail did you still find yourself telling people about?", "Alguien celebró contigo un logro que te costó esfuerzo. Unos días después, ¿qué detalle seguías contando?"),
    tr("对方说起一路上我付出过的一处努力", "They named a particular effort they'd seen me make", "Mencionó un esfuerzo concreto que me había visto hacer"),
    tr("对方专门为我准备的一顿饭或一个小安排", "They made a meal or arranged something especially for me", "Preparó una comida o un pequeño plan especialmente para mí")),
  scene("voice-note", "give-support",
    tr("想起上一次有人发语音，说今天发生了一件窝火的事。你回过去的第一句更像哪句？", "Remember a voice message from someone who'd had a frustrating day. What did you say first in reply?", "Recuerda un mensaje de voz de alguien que había tenido un día frustrante. ¿Cómo empezó tu respuesta?"),
    tr("「后来呢？你慢慢讲，我在。」", "“What happened next? Take your time, I'm here.”", "«¿Y luego? Cuéntame con calma, estoy aquí»."),
    tr("「现在最棘手的是哪一步？我们一起看看。」", "“What's the trickiest part now? Let's look at it together.”", "«¿Qué parte te cuesta más ahora? Vamos a mirarla juntos»."), true),
  scene("walk-home", "receive-repair",
    tr("回想一次和亲近的人拌了几句嘴，回去的路上你还在想这件事。对方怎样重新开口，你觉得比较接得住？", "Think of a disagreement with someone close that was still on your mind on the way home. Which opening from them would have worked better for you then?", "Tras una discusión con alguien cercano, seguías dándole vueltas camino a casa. ¿Qué manera de retomar el tema te habría venido mejor?"),
    tr("趁两人还记得细节，问我「要不要现在接着说？」", "While the details were fresh, asking if I'd like to keep talking now", "Mientras recordábamos los detalles, preguntarme si quería seguir hablando"),
    tr("先定好晚点再聊的时间，让我把想说的话理顺", "Agreeing on a later time so I could sort out my thoughts", "Acordar una hora para retomarlo y darme tiempo para ordenar mis ideas")),
  scene("thought-of-me", "receive-care",
    tr("上次你觉得「原来那件小事有人记得」，是什么让你一下子有了这个感觉？", "Last time you thought, “They remembered that little thing,” what brought on that feeling?", "La última vez que pensaste «Se acordó de aquel detalle», ¿qué despertó esa sensación?"),
    tr("后来聊天时，对方把我说过的一句话又提了起来", "In a later conversation they brought up something I'd said", "En otra conversación volvió a mencionar algo que yo había dicho"),
    tr("下次见面时，我提过想要或需要的东西已经备好了", "When we next met, something I'd mentioned wanting or needing was ready", "Al volver a vernos, ya tenía preparado algo que yo había dicho que quería o necesitaba"), true),
  scene("two-offers", "give-support",
    tr("有人拿不定主意，约你出来坐坐。回想类似的一次，你们刚坐下时你做了什么？", "Someone couldn't make up their mind and asked to meet. Think of a time like this: what did you do as you sat down?", "Alguien tenía dudas y te propuso veros. Recuerda una ocasión parecida: ¿qué hiciste nada más sentarte?"),
    tr("把手机放下，问「你最放不下的是哪一段？」", "Put my phone away and asked which part was weighing on them", "Aparté el móvil y pregunté qué parte le estaba pesando más"),
    tr("把几个选择摆出来，陪对方顺了一遍各自的取舍", "Laid out the options and went through the trade-offs with them", "Puse las opciones sobre la mesa y repasamos qué implicaba cada una")),
  scene("crossed-wires", "receive-repair",
    tr("想一次双方都以为说清了、事后却发现自己被误解的经历。对方怎么邀请你再谈，你比较愿意接？", "Recall realizing someone close had misunderstood you. How would you have liked them to invite you back into the conversation?", "Recuerda cuando descubriste que alguien cercano te había malinterpretado. ¿Cómo te habría gustado que te invitara a retomar la conversación?"),
    tr("当场留一点时间，让我马上把自己的意思重新讲一遍", "Make room right then for me to explain what I meant", "Hacer un hueco en ese momento para que pudiera explicarme de nuevo"),
    tr("说好稍后找我，让我有空先想想换个什么说法", "Set a time to come back so I could find the words first", "Acordar volver después para que pudiera encontrar las palabras"), true),
  ...fitFuturePlans.map(plan => ({ id: idFor(plan.id), text: plan.text, options: plan.options })),
];

const domains = [
  {
    id: "daily", give: "care", receive: "receive-care",
    title: tr("日常示爱", "Everyday affection", "Cariño cotidiano"),
    personal: tr("我怎样感到被在乎", "How care reaches me", "Cómo me llega el cariño"),
    a: tr("把心意说出来", "expressing care in words", "expresar el cariño con palabras"),
    b: tr("用行动表达关心", "showing care through actions", "mostrar cariño con gestos"),
    suggestion: tr("哪句话、哪件小事最容易让你感到被放在心上？", "What words or small gestures make you feel cared for?", "¿Qué palabras o detalles hacen que sientas cariño?"),
  }, {
    id: "support", give: "give-support", receive: "support",
    title: tr("对外支持", "Outside stress", "Apoyo ante el estrés"),
    personal: tr("我陪别人面对烦恼时", "How I offer support", "Cómo ofrezco apoyo"),
    a: tr("听对方讲完", "listening first", "escuchar primero"), b: tr("一起找办法", "finding a next step together", "buscar soluciones juntos"),
    suggestion: tr("下次遇到难事，怎样让我知道你想先讲完，还是想找个办法？", "Next time something's bothering you, how can I tell whether to listen or help find a next step?", "La próxima vez que algo te preocupe, ¿cómo puedo saber si prefieres que escuche o que pensemos juntos?"),
  }, {
    id: "repair", give: "repair", receive: "receive-repair",
    title: tr("分歧后重谈", "Returning after disagreement", "Retomar un desacuerdo"),
    personal: tr("我希望对方何时重新开口", "When I want the other person to reconnect", "Cuándo quiero que la otra persona retome la charla"),
    a: tr("尽早接着谈", "talking again soon", "retomar la charla pronto"), b: tr("缓一缓再谈", "allowing a pause first", "hacer una pausa primero"),
    suggestion: tr("如果一个人想先停一下，约在什么时候回来，两个人都舒服？", "If one of us wants a pause, when would we both feel comfortable coming back?", "Si alguien necesita una pausa, ¿cuándo nos vendría bien retomar la conversación?"),
  },
];

const questionsFor = new Map(domains.flatMap(d => [d.give, d.receive]).map(axis =>
  [axis, [...inventoryQuestions, ...portableQuestions].filter(q => q.axis === axis)]));
const chosen = (q, profile) => q.options.find(o => o.id === profile?.answers?.[q.id]);

function preference(profile, axis) {
  const questions = questionsFor.get(axis);
  const answers = questions.map(q => chosen(q, profile)?.id).filter(Boolean);
  if (answers.length < Math.min(questions.length, 3)) return "unknown";
  const balance = answers.reduce((total, value) => total + (value === "a" ? 1 : -1), 0);
  return Math.abs(balance) < 2 ? "varies" : balance > 0 ? "a" : "b";
}

const varies = tr("随情境变化", "varies by situation", "varía según el contexto");
const unknown = tr("线索不足", "not enough information", "faltan datos");
const label = (domain, side, lang) => (domain[side] || (side === "varies" ? varies : unknown))[lang];

function projection(profile) {
  return {
    signals: domains.map(d => ({ give: preference(profile, d.give), receive: preference(profile, d.receive) })),
    plans: fitFuturePlans.map(p => p.options.find(o => o.id === profile?.answers?.[idFor(p.id)])),
  };
}

function signalLine(domain, signal, lang) {
  const give = label(domain, signal.give, lang), receive = label(domain, signal.receive, lang);
  return tr(`我通常：${give}；我希望收到：${receive}`, `My usual response: ${give}. I look for: ${receive}.`, `Mi respuesta habitual: ${give}. Lo que busco: ${receive}.`)[lang];
}

export function portablePreview(profile, lang) {
  const own = projection(profile);
  return [
    ...domains.map((d, i) => `${d.title[lang]} · ${signalLine(d, own.signals[i], lang)}`),
    ...fitFuturePlans.flatMap((p, i) => own.plans[i] ? [`${p.title[lang]} · ${own.plans[i].text[lang]}`] : []),
  ];
}

export function portableSupportChapter(profile, lang) {
  const give = preference(profile, "give-support");
  const receive = preference(profile, "support");
  const stories = {
    aa: tr("烦心的时候，有人听你把来龙去脉说完，你才容易理清自己最在意什么。别人找你诉苦，你也常把这份耐心给回去。如果对方讲了三遍同一个难处，可以在听完后轻轻问一句：「还有哪一段你想说，还是我们一起想想明天怎么办？」", "Talking a hard day through can help you discover which part really hurt. You often offer the same patience in return. If someone circles back to the same problem, let them finish, then ask whether there is more to tell or whether a plan for tomorrow would help.", "Contar un mal día de principio a fin puede ayudarte a descubrir qué te dolió. Sueles ofrecer esa misma paciencia. Si tu pareja vuelve al mismo problema, deja que termine y pregúntale si quiere contar algo más o pensar en qué hacer mañana."),
    ab: tr("伴侣遇到麻烦时，你愿意先把话听完。可轮到自己被一件事卡住，有人坐到身边一起找个开头，可能更让你松一口气。两个人都很体贴，也可能在这里猜错。你可以直接说：「这次我已经讲得差不多了，能陪我想想第一步吗？」", "You often let your partner finish the story when something goes wrong. In the same moment yourself, you may feel more relieved when someone helps find a first step. Make that difference easy to notice: “I think I’ve said what I needed to say. Could you help me work out where to start?”", "Cuando algo le sale mal a tu pareja, sueles dejar que termine de contarlo. Si el problema es tuyo, quizá te alivie más encontrar juntos un primer paso. Puedes hacer visible esa diferencia diciendo: «Creo que ya lo conté todo. ¿Me ayudas a pensar por dónde empezar?»."),
    ba: tr("听到伴侣犯难，你容易想到可以先替对方做什么。可你自己委屈的时候，也许最想要的是把经过讲完，中途有人点点头。这给你一个很好的提醒：有办法的时候也可以先把办法放一放，问一句「你想先说说，还是要我一起想？」", "When someone you love is stuck, a practical next step may come to mind quickly. When you are upset, what feels best may be a chance to finish the story and see the other person nod. Remembering that difference gives you a useful opening before offering advice: “Shall I listen a little longer, or think it through with you?”", "Cuando tu pareja tiene un problema, quizá se te ocurra pronto una solución. Cuando te pasa a ti, puede ayudarte más contar lo ocurrido sin interrupciones. Recordar esa diferencia te permite preguntar antes de aconsejar: «¿Quieres que siga escuchando o lo pensamos juntos?»."),
    bb: tr("事情卡住时，一起找到一个能动手的小步骤，会让你感觉有人和你站在同一边。你也容易用同样的方式帮助伴侣。一次有分寸的帮忙，可以是先问「要我陪你写第一句吗？」让对方自己决定接下来怎么做，也给只是想诉苦的那一天留个余地。", "A manageable first step can make a problem feel shared. You often offer that kind of help to a partner too. “Would it help if we drafted the first line together?” gives them something concrete while leaving them room to choose, including on a day when they just want to vent.", "Encontrar un primer paso manejable puede hacerte sentir en compañía. Sueles ofrecer esa misma ayuda. «¿Te serviría que escribiéramos juntos la primera frase?» propone algo concreto y deja margen para elegir, incluso cuando tu pareja solo necesita desahogarse."),
  };
  const body = stories[give + receive];
  return body ? { title: tr("遇上难事时，怎样陪你", "What helps on a hard day", "Qué te ayuda en un día difícil")[lang], body: body[lang] } : null;
}

function compare(give, receive) {
  if ([give, receive].includes("unknown")) return "unknown";
  if ([give, receive].includes("varies")) return "mixed";
  return give === receive ? "same" : "different";
}

export function portablePairReport(mine, theirs, partnerName, lang) {
  const own = projection(mine), peer = projection(theirs);
  const partner = partnerName || tr("TA", "your partner", "tu pareja")[lang];
  const sections = domains.map((d, i) => {
    const me = own.signals[i], other = peer.signals[i];
    const outgoing = compare(me.give, other.receive), incoming = compare(other.give, me.receive);
    const directions = [outgoing, incoming];
    // With an unresolved direction, describe the known side in detail but leave the overall type open.
    const status = directions.includes("unknown") ? "unknown" : directions.includes("mixed") ? "mixed" : directions.includes("different") ? "different" : "same";
    const og = label(d, me.give, lang), or = label(d, other.receive, lang);
    const ig = label(d, other.give, lang), ir = label(d, me.receive, lang);
    const summary = tr(`你回应${partner}：你的习惯是「${og}」，对方希望「${or}」。\n${partner}回应你：对方的习惯是「${ig}」，你希望「${ir}」。`,
      `When you respond to ${partner}, your tendency is “${og}”; they look for “${or}”.\nWhen they respond to you, their tendency is “${ig}”; you look for “${ir}”.`,
      `Cuando respondes a ${partner}, sueles optar por «${og}» y tu pareja busca «${or}».\nCuando te responde, suele optar por «${ig}» y tú buscas «${ir}».`)[lang];
    return { id: "portrait-" + d.id, title: d.title[lang], status, summary, suggestion: d.suggestion[lang],
      evidence: [{ questionId: "shared-" + d.id, question: d.title[lang], mine: signalLine(d, me, lang), partner: signalLine(d, other, lang) }] };
  });
  const code = sections.map(s => ({ same: "1", different: "0" }[s.status] || "?")).join("");
  const title = fitPairPatternName(code, lang) || tr("你们的合拍线索", "Your compatibility clues", "Pistas sobre su compatibilidad")[lang];
  const join = entries => entries.map(s => s.title).join(lang === "zh" ? "、" : ", ");
  const aligned = join(sections.filter(s => s.status === "same"));
  const different = join(sections.filter(s => s.status === "different"));
  const open = join(sections.filter(s => ["mixed", "unknown"].includes(s.status)));
  const lines = [tr("根据你们各自的画像推测：", "Based on your two individual portraits:", "Según sus dos perfiles personales:")[lang]];
  if (aligned) lines.push(tr(`在${aligned}上，你们习惯给出的回应都贴近对方想要的方式。`, `For ${aligned}, each person's usual response fits what the other seeks.`, `En ${aligned}, la respuesta habitual de cada persona encaja con lo que busca la otra.`)[lang]);
  if (different) lines.push(tr(`在${different}上，至少一个方向的偏好有差异，值得提前商量。`, `For ${different}, at least one person's usual response differs from what the other seeks.`, `En ${different}, al menos una respuesta habitual difiere de lo que busca la otra persona.`)[lang]);
  if (open) lines.push(tr(`${open}还需要更多线索，或取决于当时的情境。`, `For ${open}, more information or context is needed.`, `En ${open}, faltan pistas o depende del contexto.`)[lang]);
  for (const [i, plan] of fitFuturePlans.entries()) {
    const a = own.plans[i], b = peer.plans[i];
    if (!a || !b) continue;
    const opposite = plan.id === "children" && a.id !== "open" && b.id !== "open" && a.id !== b.id;
    const summary = opposite ? tr("对未来养育孩子的打算目前不同。", "Your current intentions about raising children differ.", "Hoy tienen intenciones distintas sobre criar hijos.")[lang]
      : tr("这是你们各自目前的打算。", "These are your current intentions.", "Estas son sus intenciones actuales.")[lang];
    if (opposite) lines.push(summary);
    sections.push({ id: "plan-" + plan.id, title: plan.title[lang], status: opposite ? "different" : "mixed", summary,
      suggestion: plan.prompt[lang], evidence: [{ questionId: "shared-plan-" + plan.id, question: plan.title[lang], mine: a.text[lang], partner: b.text[lang] }] });
  }
  return { status: "ready", partnerName, title, summary: lines.join(lang === "zh" ? "" : " "), sections };
}
