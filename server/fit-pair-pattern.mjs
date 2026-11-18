const tr = (zh, en, es) => ({ zh, en, es });
const option = (id, zh, en, es) => ({ id, text: tr(zh, en, es) });
const question = (id, text, options) => ({ id: `pair-v1-${id}`, text, options });

// The two receiving prompts in each area ask about distinct occasions with this partner.
const received = [
  option("landed", "当时那样就合适，我得到了需要的回应", "What happened worked for me at the time", "Lo que pasó me vino bien en ese momento"),
  option("adjusted", "我说了一句想要什么，后来换的方式挺合适", "I said what I needed and the adjustment worked", "Expliqué qué necesitaba y el ajuste me sirvió"),
  option("missed", "事情过去了，我需要的那种回应还是没到", "The moment passed and the response I needed never came", "Pasó el momento y me quedé sin la respuesta que necesitaba"),
  option("unclear", "当时我自己也分不清，或没有这样的经历", "I couldn't tell what I needed, or this hasn't happened", "No tenía claro qué necesitaba o no he vivido algo así"),
];
const feedback = [
  option("helped", "不止一次，TA 明确说过当时的方式有用", "More than once they explicitly said my response helped", "Más de una vez me dijo expresamente que mi respuesta le ayudó"),
  option("change", "不止一次，TA 说还想要另一种回应，我当时没接上", "More than once they said they still wanted a different response that I hadn't provided", "Más de una vez me dijo que seguía necesitando otra respuesta que yo no le había dado"),
  option("varies", "几次反馈不一样，得看具体情况", "Their feedback varied across occasions", "Sus comentarios cambiaron según la ocasión"),
  option("unclear", "没聊到过结果，或只记得一次", "We didn't discuss how it went, or I only recall one occasion", "No hablamos del resultado o solo recuerdo una ocasión"),
];

const areas = [
  {
    id: "daily", title: tr("日常亲近", "Everyday closeness", "Cercanía cotidiana"),
    first: tr("最近一次你想和 TA 多待一会儿，或想先独处，接下来发生的事合你的心意吗？", "Last time you wanted more time together or a little space with this partner, how did what happened next feel?", "La última vez que quisiste más tiempo en pareja o algo de espacio, ¿cómo te sentó lo que pasó después?"),
    second: tr("另想一天，你想让 TA 知道一件对你很要紧的小事。后来你收到的回应怎么样？想不到另一次就跳过。", "Think of a different day when you wanted your partner to notice something small that mattered to you. How did their response land? Skip if you can't recall another occasion.", "Piensa en otro día en que querías que tu pareja notara un detalle importante para ti. ¿Cómo te sentó su respuesta? Si no recuerdas otra ocasión, sáltala."),
    giving: tr("想想你给 TA 留时间、留空间或做了件贴心小事之后。回头聊起时，TA 给过你什么反馈？", "After you made time, gave space or did something thoughtful, what feedback did this partner give you afterward?", "Tras dedicarle tiempo, darle espacio o tener un detalle, ¿qué te contó después tu pareja?"),
    prompt: tr("最近哪件小事让你感到我在乎你？下次你还想要那样，还是想换一种？", "Which small thing recently made you feel cared for? Would you like that again or something different?", "¿Qué detalle reciente te hizo sentir cariño? ¿Te gustaría repetirlo o cambiar algo?"),
  },
  {
    id: "support", title: tr("对外支持", "Facing outside pressure", "Apoyo ante la presión externa"),
    first: tr("上次工作、家里或朋友的事让你难受，你找 TA 说了说。回想那次对话，你得到自己需要的回应了吗？", "Last time something at work, at home or with a friend upset you and you turned to this partner, how did their response land?", "La última vez que algo del trabajo, la familia o una amistad te afectó y acudiste a tu pareja, ¿cómo te sentó su respuesta?"),
    second: tr("另想一次外面的麻烦还没解决，你带着这件事去找 TA。到那天结束时，你怎样看 TA 给你的回应？没有另一次就跳过。", "Recall a different outside difficulty that was still unresolved when you turned to your partner. By the end of the day, how did their response feel? Skip if there wasn't another occasion.", "Recuerda otro problema externo que seguía abierto cuando acudiste a tu pareja. Al acabar el día, ¿cómo te sentó su respuesta? Si no hubo otra ocasión, sáltala."),
    giving: tr("轮到 TA 被外面的事情难住，你听过、陪过或帮忙想过办法。事后 TA 实际说过什么？", "When this partner faced outside difficulties and you listened, stayed close or helped find a next step, what feedback did they actually give?", "Cuando tu pareja afrontó un problema externo y tú escuchaste, acompañaste o ayudaste a buscar una salida, ¿qué te dijo después?"),
    prompt: tr("下次我带着外面的烦心事来找你，我们先问一句：「想讲完、想有人陪，还是一起想下一步？」", "Next time one of us brings a problem from outside, shall we ask: want to talk it through, have company, or work out a next step?", "La próxima vez que traigamos un problema de fuera, ¿preguntamos si apetece contarlo, tener compañía o pensar el siguiente paso?"),
  },
  {
    id: "repair", title: tr("分歧后修复", "Reconnecting after conflict", "Reencuentro tras una diferencia"),
    first: tr("最近一次你们意见不合，你想当场谈或想晚点再说。回看两人后来处理谈话时机的方式，你感觉怎样？", "In your last disagreement, you wanted to talk then or come back later. How did the timing the two of you settled into feel to you?", "En su último desacuerdo quisiste hablar entonces o retomarlo después. ¿Cómo te sentó el momento en que lo abordaron?"),
    second: tr("回想另一次两人闹了别扭。等这件事过去，你想被对方听懂的那部分，后来有得到回应吗？没有另一次就跳过。", "Recall a different disagreement with this partner. Afterward, did the part you wanted them to understand receive the response you needed? Skip if there wasn't another occasion.", "Piensa en otro desacuerdo con tu pareja. Al pasar el momento, ¿recibiste la respuesta que necesitabas sobre lo que querías que entendiera? Si no hubo otra ocasión, sáltala."),
    giving: tr("两人各有想法、后来把话题接回来时，你当时的做法对 TA 有没有帮助？只回想 TA 后来亲口给过的反馈。", "After disagreements when you returned to the conversation, what did this partner actually tell you about how your response felt to them?", "Al retomar la conversación tras los desacuerdos, ¿qué te dijo tu pareja sobre cómo le sentó tu respuesta?"),
    prompt: tr("需要暂停时，我们要不要一起约个回来谈的时间？回来后先各讲一件希望对方听懂的事。", "When one of us needs a pause, shall we agree when to return, then each name one thing we'd like understood?", "Si alguien necesita una pausa, ¿acordamos cuándo volver y decimos entonces qué nos gustaría que el otro entendiera?"),
  },
];

const plans = [
  {
    id: "children", title: tr("未来是否养育孩子", "Raising children in the future", "Criar hijos en el futuro"),
    text: tr("如果谈到未来是否开始养育或再养育一个孩子，你此刻能清楚说出哪一种打算？不想纳入分享预览可以跳过。", "If you discuss raising a first or another child in the future, which intention can you state today? Skip to keep this out of the sharing preview.", "Si hablan de criar en el futuro a su primer hijo o a otro, ¿qué intención puedes expresar hoy? Sáltala para excluirla de la vista previa."),
    options: [option("yes", "我目前想要", "I currently want this", "Actualmente lo deseo"), option("no", "我目前不想要", "I currently don't want this", "Actualmente no lo deseo"), option("open", "我还没想定", "I'm undecided", "Aún no lo tengo claro")],
    prompt: tr("我们各自的打算有多确定？哪些地方值得找个时间认真谈？", "How settled is each of us on this? What deserves a longer conversation?", "¿Qué tan clara tiene cada persona su intención? ¿Qué merece una conversación tranquila?"),
  },
  {
    id: "home", title: tr("未来两年的居住地", "Where to live over the next two years", "Dónde vivir los próximos dos años"),
    text: tr("说起未来两年「住在哪儿」，你现在已经决定到什么程度？不想纳入分享预览可以跳过。", "How settled are your plans about where to live over the next two years? Skip to keep this out of the sharing preview.", "¿Hasta qué punto tienes decidido dónde vivir los próximos dos años? Sáltala para excluirla de la vista previa."),
    options: [option("stay", "我目前打算留在现在的城市或地区", "I plan to stay in my current area", "Pienso quedarme en mi zona actual"), option("move", "我目前有搬离现在城市或地区的打算", "I plan to leave my current area", "Pienso mudarme de mi zona actual"), option("open", "地点还可以商量", "The location is open for discussion", "El lugar aún se puede hablar")],
    prompt: tr("把各自说的具体地点和时间放在一起聊聊；各自说「留下」也可能指不同地方。", "Compare the actual places and dates; even «stay» can mean different places.", "Hablen de lugares y plazos concretos; incluso «quedarme» puede referirse a lugares distintos."),
  },
];

export const pairQuestions = [
  ...areas.map(area => question(`${area.id}-first`, area.first, received)),
  ...areas.map(area => question(`${area.id}-giving`, area.giving, feedback)),
  ...areas.map(area => question(`${area.id}-second`, area.second, received)),
  ...plans.map(plan => question(plan.id, plan.text, plan.options)),
];

const outcomes = {
  met: tr("两次都收到了需要的回应", "The response met my needs both times", "La respuesta cubrió mis necesidades ambas veces"),
  gap: tr("两次都有需要没被接住", "Something I needed was missing both times", "Algo que necesitaba quedó sin respuesta ambas veces"),
  varies: tr("两次体验不同", "My two experiences differed", "Mis dos experiencias fueron distintas"),
  unknown: tr("经历还不足", "Not enough experience to tell", "Aún faltan experiencias"),
};
const heard = {
  helped: tr("我记得 TA 多次说我的回应有用", "I recall my partner saying more than once that my response helped", "Recuerdo que mi pareja me dijo varias veces que mi respuesta ayudó"),
  change: tr("我记得 TA 多次表示还需要另一种回应", "I recall my partner repeatedly asking for a different response", "Recuerdo que mi pareja pidió otra respuesta varias veces"),
  varies: tr("我记得 TA 的反馈随场合不同", "I recall different feedback across occasions", "Recuerdo comentarios distintos según la ocasión"),
};

// The partner report can only read facts that appear in each owner's preview.
function projection(profile) {
  const answers = profile?.answers || {};
  const areasOut = areas.map(({ id }) => {
    const experience = ["first", "second"].map(which => answers[`pair-v1-${id}-${which}`])
      .map(answer => answer === "missed" ? "gap" : ["landed", "adjusted"].includes(answer) ? "met" : null);
    const outcome = experience.includes(null) ? "unknown" : experience[0] === experience[1] ? experience[0] : "varies";
    const giving = answers[`pair-v1-${id}-giving`];
    return { outcome, giving: Object.hasOwn(heard, giving) ? giving : null };
  });
  const plansOut = plans.map(p => p.options.find(o => o.id === answers[`pair-v1-${p.id}`]) || null);
  return { areas: areasOut, plans: plansOut };
}

function ownerLine(area, language) {
  const parts = [outcomes[area.outcome][language]];
  if (area.giving) parts.push(heard[area.giving][language]);
  return parts.join(" · ");
}

export function pairPreview(profile, language) {
  const own = projection(profile);
  return [...areas.map((a, i) => `${a.title[language]} · ${ownerLine(own.areas[i], language)}`),
    ...plans.flatMap((plan, i) => own.plans[i] ? [`${plan.title[language]} · ${own.plans[i].text[language]}`] : [])];
}

const patterns = {
  "111": [tr("默契搭档型", "In-sync partners", "Pareja en sintonía"), tr("平时能接住彼此的喜欢，遇到外面的难事能并肩，有分歧也能重新接上话。", "Care lands day to day, support helps under outside pressure, and you find each other again after disagreements.", "El cariño llega en el día a día, el apoyo ayuda ante la presión externa y vuelven a encontrarse tras un desacuerdo.")],
  "110": [tr("甜蜜战友型", "Everyday allies", "Cómplices del día a día"), tr("平常亲近，对外能并肩；你们之间出了分歧，怎样回来谈最值得商量。", "Closeness and outside challenges are common ground. Getting back into a conversation after a disagreement deserves attention.", "La cercanía y los retos externos los unen. Conviene acordar cómo retomar la charla tras un desacuerdo.")],
  "101": [tr("亲密回航型", "Reconnecting companions", "Cómplices del reencuentro"), tr("平常靠得近，闹过别扭也能回来；碰到关系之外的烦恼，安慰容易错拍。", "You feel close and reconnect after a disagreement. Comfort can miss the mark when one of you faces an outside problem.", "Hay cercanía y reencuentro tras las diferencias. Ante un problema externo, el consuelo puede no llegar como se necesita.")],
  "011": [tr("风雨同舟型", "Through-the-storm partners", "Pareja ante la tormenta"), tr("难事和分歧里能找到彼此，日常关心怎样才被收到值得先聊。", "You connect under pressure and after disagreements. Start by talking about how everyday care lands.", "Se encuentran ante la presión y tras las diferencias. Empiecen por cómo llega el cariño en lo cotidiano.")],
  "100": [tr("日常知己型", "Everyday confidants", "Confidentes cotidianos"), tr("平常待在一起很自然。碰上外来的压力或两人有了分歧，回应较容易落空。", "Everyday closeness comes naturally. Responses can miss a need under outside pressure or after disagreements.", "La cercanía cotidiana fluye. Ante problemas externos o desacuerdos, algunas necesidades quedan sin respuesta.")],
  "010": [tr("闯关队友型", "Challenge teammates", "Equipo ante los retos"), tr("一起面对外面的困难是强项；日常表达和争执后的重谈，还需要找到更合意的方式。", "You team up well against outside difficulties. Everyday closeness and reconnecting after conflict need a conversation.", "Hacen equipo ante dificultades externas. Conviene hablar del día a día y de cómo reencontrarse tras un conflicto.")],
  "001": [tr("和好搭档型", "Reconciliation partners", "Equipo para reconciliarse"), tr("你们能在分歧后重新对话。平常怎样陪伴、压力来时怎样支持，值得重新听听彼此。", "You reconnect after disagreements. Take another look at everyday closeness and support during outside stress.", "Vuelven al diálogo tras las diferencias. Escúchense sobre la cercanía cotidiana y el apoyo ante el estrés externo.")],
  "000": [tr("磨合探索型", "Finding your rhythm", "Pareja en búsqueda de su ritmo"), tr("三个方面都有人提到反复没收到需要的回应。可以先从一件最近的小事说起。", "In all three areas, at least one of you recalls repeatedly missing something important. Start with one recent moment.", "En los tres ámbitos al menos una persona recuerda necesidades que quedaron sin respuesta. Empiecen por un momento reciente.")],
};

function domainResult(a, b) {
  if ([a, b].some(person => person.outcome === "gap")) return "gap";
  // The receiver's account takes precedence over a giver's guess. Explicit conflicting
  // recollections are kept open, without assuming both people recall the same occasion.
  if ([a, b].some(person => person.outcome === "varies" || person.giving === "change")) return "varies";
  if (a.outcome === "met" && b.outcome === "met") return "met";
  return "unknown";
}

export function pairReport(mine, theirs, partnerName, language) {
  const own = projection(mine), partner = projection(theirs);
  const peer = partnerName || tr("TA", "your partner", "tu pareja")[language];
  const results = areas.map((_, i) => domainResult(own.areas[i], partner.areas[i]));
  const sections = areas.map((a, i) => {
    const me = own.areas[i], them = partner.areas[i];
    const fromPeer = tr(`${peer} 回应你时，你的体验：`, `When ${peer} responds to you, your account: `, `Cuando ${peer} te responde, recuerdas: `)[language] + outcomes[me.outcome][language];
    const fromMe = tr(`你回应 ${peer} 时，对方的体验：`, `When you respond to ${peer}, their account: `, `Cuando respondes a ${peer}, tu pareja recuerda: `)[language] + outcomes[them.outcome][language];
    const summary = [fromPeer, fromMe];
    if (results[i] === "varies") summary.push(tr("不同场合或不同人的回忆有差别，先对照一件双方都记得的事。", "Recollections vary by occasion or person. Compare one moment you both remember.", "Los recuerdos varían según la ocasión o la persona. Comparen un momento que ambos recuerden.")[language]);
    return { id: `pair-${a.id}`, title: a.title[language], status: { met: "same", gap: "different", varies: "mixed", unknown: "unknown" }[results[i]],
      summary: summary.join("\n"), suggestion: a.prompt[language],
      evidence: [{ questionId: `shared-${a.id}`, question: a.title[language], mine: ownerLine(me, language), partner: ownerLine(them, language) }] };
  });
  const pattern = patterns[results.map(result => ({ met: "1", gap: "0" }[result] || "?")).join("")];
  const smooth = areas.filter((_, i) => results[i] === "met").map(area => area.title[language]);
  const open = areas.filter((_, i) => ["unknown", "varies"].includes(results[i])).map(area => area.title[language]);
  const join = entries => entries.join(language === "zh" ? "、" : ", ");
  const title = pattern?.[0][language] || tr("正在看清的相处方式", "A picture still taking shape", "Un retrato en construcción")[language];
  const partial = [];
  if (smooth.length) partial.push(tr(`在「${join(smooth)}」上，双方都记得需要得到了回应。`, `You both recall getting the response you needed in ${join(smooth)}.`, `Ambas personas recuerdan haber recibido lo que necesitaban en «${join(smooth)}».`)[language]);
  if (open.length) partial.push(tr(`「${join(open)}」的经历还不够或反馈不一致，先保留这些判断。`, `In ${join(open)}, experiences are limited or vary. These areas remain open.`, `En «${join(open)}», las experiencias aún son escasas o varían. Esos ámbitos quedan abiertos.`)[language]);
  const headline = pattern?.[1][language] || partial.join(language === "zh" ? "" : " ");
  const focusIndex = results.indexOf("gap");
  let direction = "";
  if (focusIndex >= 0) {
    const both = own.areas[focusIndex].outcome === "gap" && partner.areas[focusIndex].outcome === "gap";
    const recipient = own.areas[focusIndex].outcome === "gap" ? tr("你", "you", "tú")[language] : peer;
    const domain = areas[focusIndex].title[language];
    direction = both ? tr(`在「${domain}」上，双方都记得有需要没被接住。`, `For ${domain.toLowerCase()}, both of you remember needs that were missed.`, `En «${domain}», ambas personas recuerdan necesidades sin respuesta.`)[language]
      : tr(`在「${domain}」上，${recipient}作为接收回应的人，记得不止一次仍需要别的回应。`, `For ${domain.toLowerCase()}, the person reporting a repeated unmet need is ${recipient}.`, `En «${domain}», quien recuerda una necesidad repetida sin cubrir es ${recipient}.`)[language];
  }
  for (const [i, plan] of plans.entries()) {
    const a = own.plans[i], b = partner.plans[i];
    if (!a || !b) continue;
    const opposite = plan.id === "children" && a.id !== "open" && b.id !== "open" && a.id !== b.id;
    const heading = opposite ? tr("当前意向明确不同", "Different stated intentions", "Intenciones actuales distintas")[language] : tr("各自目前的打算", "Your current intentions", "Sus intenciones actuales")[language];
    sections.push({ id: `plan-${plan.id}`, title: plan.title[language], status: opposite ? "different" : "mixed",
      summary: heading, evidence: [{ questionId: `shared-plan-${plan.id}`, question: plan.title[language], mine: a.text[language], partner: b.text[language] }],
      suggestion: plan.prompt[language] });
    if (opposite) direction += "\n" + tr("长期方向上，你们目前对是否养育孩子有明确不同的打算。", "Separately, your current intentions about raising a child differ.", "Por separado, sus intenciones actuales sobre criar hijos son distintas.")[language];
  }
  return { status: "ready", partnerName, title, summary: [headline.trim(), direction.trim()].filter(Boolean).join("\n"), sections };
}
