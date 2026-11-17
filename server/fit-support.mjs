const tr = (zh, en, es) => ({ zh, en, es });
const option = (id, zh, en, es) => ({ id, text: tr(zh, en, es) });
const opening = "support-v1-opening";
const silence = "support-v1-pause";
const deadline = "support-v1-decision";
const giving = "support-v1-giving";

export const supportModule = {
  id: "support",
  title: tr("心情不好时，希望 TA 怎么陪我？", "What helps me after a hard day?", "¿Qué me ayuda después de un día difícil?"),
  description: tr("从开口的那一刻，到轮到你听 TA 说。", "From starting the conversation to being the one who listens.", "Desde que empiezas a contar algo hasta que te toca escuchar."),
  questions: [
    {
      id: opening, topic: tr("刚开口时", "Starting to talk", "Al empezar a hablar"),
      text: tr("一件窝心的事刚过去。你和 TA 坐上回家的车，哪种开头最合你此刻的心意？", "Something just went badly. You're on the ride home together. How would you like the conversation to start?", "Algo te acaba de salir mal. Van de camino a casa. ¿Qué comienzo te apetecería ahora?"),
      options: [
        option("story", "我从头讲，讲到哪儿算哪儿", "I'd start at the beginning and see where the story takes me", "Empezaría por el principio y vería qué me sale contar"),
        option("signal", "TA 接一句「那一下挺难受的吧」，我再往下说", "They'd say, “That sounds rough,” and I'd carry on", "Que me diga «Eso debió doler» y yo siga contando"),
        option("ideas", "我挑最卡住的那一步，两个人一起理理", "I'd pick the part I'm stuck on so we can work through it", "Sacaría el punto que me tiene bloqueado para pensarlo juntos"),
        option("company", "先挨着坐一程，想说的时候再开口", "I'd sit close for a while and talk when I feel ready", "Me sentaría cerca un rato y hablaría cuando me naciera"),
      ],
    },
    {
      id: silence, topic: tr("上次对方安静下来时", "The last quiet moment", "El último silencio"),
      text: tr("回想最近一次你把烦心事讲到一半，对方安静了几秒。你接下来做了什么？", "Think of the last time someone went quiet halfway through a story that was bothering you. What did you do next?", "Recuerda la última vez que alguien se quedó en silencio mientras le contabas algo que te preocupaba. ¿Qué hiciste después?"),
      options: [
        option("story", "趁这个空当，把剩下那段讲完了", "Used the pause to finish the story", "Aproveché la pausa para terminar de contarlo"),
        option("signal", "看了对方一眼，等一个点头才继续", "Looked over and waited for a nod before continuing", "Le miré y esperé un gesto para seguir"),
        option("ideas", "问了一句「换你会怎么办？」", "Asked, “What would you do?”", "Pregunté «¿Tú qué harías?»"),
        option("company", "也停了一会儿，安静地待着挺舒服", "Let the silence last. Sitting there felt comfortable", "Dejé que siguiera el silencio. Me sentía a gusto así"),
      ],
    },
    {
      id: deadline, topic: tr("事情还得马上处理时", "With a decision still due", "Con una decisión pendiente"),
      text: tr("想一次你心里不舒服，还得赶在当天回一条难回的消息。你和别人说起这件事时，最先要的是什么？", "Think of a difficult message you still had to answer that day while upset. When you brought it up with someone, what did you want first?", "Piensa en un mensaje difícil que tenías que contestar ese mismo día, con el ánimo revuelto. Al hablarlo con alguien, ¿qué buscaste primero?"),
      options: [
        option("ideas", "一起挑一句能发出去的开头", "Help finding the first line of my reply", "Ayuda para encontrar la primera frase"),
        option("company", "有人坐在旁边，我自己慢慢写", "Company while I wrote it myself", "Compañía mientras escribía a mi ritmo"),
        option("story", "留点时间让我把前因后果讲全", "Time to get the whole backstory out", "Tiempo para contar todo lo que había pasado"),
        option("signal", "听听对方有没有明白我在为难什么", "A sign they understood why the reply felt so difficult", "Una señal de que entendía por qué me costaba contestar"),
      ],
    },
    {
      id: giving, topic: tr("轮到我陪别人时", "When I'm the listener", "Cuando me toca escuchar"),
      text: tr("换个位置。上一次有人跟你讲糟心事，回放那段对话，你最先做了哪件事？", "Switch seats. Replay the last time someone told you something upsetting. What's the first thing you remember doing?", "Cambia de lado. Recuerda la última vez que alguien te contó un disgusto. ¿Qué es lo primero que recuerdas haber hecho?"),
      options: [
        option("story", "听故事往下走，等对方讲完再接话", "Let the story unfold and spoke after they finished", "Dejé que terminara de contar antes de intervenir"),
        option("signal", "复述了一小句自己听到的感受", "Put a feeling I heard into a few words", "Puse en palabras una emoción que percibí"),
        option("ideas", "顺着最麻烦的地方，一起想了下一步", "Picked up on the tricky part and thought through a next step", "Me centré en la parte difícil y pensamos en el siguiente paso"),
        option("company", "坐近了一点，陪对方待了一会儿", "Moved closer and sat with them a while", "Me acerqué y me quedé a su lado un rato"),
      ],
    },
  ],
};

const openings = {
  story: tr("让我先按自己的顺序讲。", "Give me room to tell the story in my own order.", "Dame tiempo para contarlo a mi manera."),
  signal: tr("先让我知道你听出了哪一刻最难受。", "Tell me which part sounded painful to you.", "Dime en qué momento notaste que me dolió."),
  ideas: tr("从我卡住的那一步开始，陪我一起理一理。", "Start with the part where I'm stuck and help me untangle it.", "Empecemos por lo que me tiene bloqueado y pensémoslo juntos."),
  company: tr("先在我旁边坐会儿，等我想讲了再聊。", "Sit with me for a bit and let me find my words.", "Quédate cerca un rato y dame tiempo para encontrar las palabras."),
};
const pauses = {
  story: tr("我说到一半停一下，可以给我一点空当把后半段接上。", "If I pause halfway, leave a little room for the rest of the story.", "Si me paro a mitad, déjame un momento para retomar el hilo."),
  signal: tr("我讲到一半看向你时，点个头，我就知道你还跟得上。", "If I look over halfway through, a nod lets me know you're still with me.", "Si te miro a mitad de la historia, un gesto me dice que sigues conmigo."),
  ideas: tr("等我问「换你呢」，我就准备好听你的想法了。", "When I ask what you'd do, that's a good moment for your ideas.", "Cuando pregunte qué harías tú, será un buen momento para darme ideas."),
  company: tr("聊到一半我们一起安静一会儿，我也自在。", "It's okay to share a little silence halfway through.", "También me siento a gusto si hacemos una pausa en silencio."),
};
// Repeated and contrasting answers support different readings. The draft
// describes a sequence the owner can correct, rather than assigning a trait.
const repeated = {
  story: tr("我刚开口时想自己慢慢讲；讲到一半停住，也许只是在找下一句话。给我留一点空当就好。", "When I start talking, I'd like to find my own way through the story. A pause halfway may just mean I'm finding my next words.", "Cuando empiezo, me gusta contar las cosas a mi ritmo. Si hago una pausa, quizá esté buscando las palabras para seguir."),
  signal: tr("我会留意你有没有跟上：开头的一句回应，或讲到一半的一个点头，都能让我接着说。", "I look for signs you're with me. A word at the start or a nod halfway can help me carry on.", "Me fijo en si me sigues. Una palabra al empezar o un gesto a mitad pueden ayudarme a continuar."),
  ideas: tr("我有时是边开口、边找下一步怎么走。听到我问「换你呢」，可以直接把你的想法说出来。", "Sometimes talking is how I find my next step. When I ask what you'd do, I'd welcome hearing your ideas.", "A veces, hablar me ayuda a encontrar el siguiente paso. Cuando pregunto qué harías tú, me viene bien escuchar tus ideas."),
  company: tr("有人陪在旁边，我就可以不急着把话说出来。哪怕已经聊起来了，留一会儿安静也挺好。", "When you're there with me, I can take my time finding words. Even once we've started talking, silence can feel comfortable.", "Con tu compañía puedo tomarme mi tiempo para hablar. Incluso cuando ya hemos empezado, el silencio puede sentarme bien."),
};
const decisions = {
  story: tr("即使当天就要回消息，我也想先把来龙去脉讲清楚。", "Even with a reply due today, I'd like to tell the whole story first.", "Aunque tenga que responder hoy, me gustaría contar primero lo que pasó."),
  signal: tr("碰到难回的消息，我想先听你说说，你觉得我为难在哪儿。", "With a difficult reply, first tell me what you think is making it hard for me.", "Ante un mensaje difícil, dime primero qué crees que me cuesta."),
  ideas: tr("要是事情还等着我回，我更想两个人一起找一句开头。", "If I still owe someone a reply, help me find the first line.", "Si aún tengo que contestar, ayúdame a encontrar la primera frase."),
  company: tr("得赶着回消息时，陪我坐着就好，我想自己写。", "If I need to reply soon, sit with me while I write it myself.", "Si urge contestar, quédate conmigo mientras escribo por mi cuenta."),
};
const conversationDrafts = {
  story: [tr("下次我有烦心事，可以先让我把那一段讲完，再告诉我你怎么想吗？", "Next time something's bothering me, could you let me finish that part before telling me what you think?", "La próxima vez que algo me preocupe, ¿podrías dejarme terminar esa parte antes de contarme qué piensas?"),
    tr("下次你跟我讲烦心事，我先让你把那一段讲完，再接话，好吗？", "Next time you tell me something's bothering you, shall I let you finish that part before I come in?", "La próxima vez que me cuentes un disgusto, ¿te gustaría que te dejara terminar esa parte antes de intervenir?")],
  signal: [tr("下次我讲到难受的地方，你可以先回应一句，让我知道你还在听吗？", "When I get to the painful part, could you say a word so I know you're still with me?", "Cuando llegue a la parte que me dolió, ¿me dirías algo para saber que me sigues?"),
    tr("下次你讲到难受的地方，我先说说自己听到了什么，你看看我有没有听对，好吗？", "Next time you get to the painful part, can I tell you what I'm hearing so you can let me know if I've got it?", "Cuando llegues a la parte que te dolió, ¿puedo decirte qué entendí para que me digas si acerté?")],
  ideas: [tr("下次我说到自己卡在哪儿，我们可以一起找一个能做的小动作吗？", "Next time I tell you where I'm stuck, could we look for one small thing I can do?", "Cuando te diga dónde me he quedado, ¿podemos pensar en algo pequeño que pueda hacer?"),
    tr("下次你跟我说到卡住的地方，我问问你要不要一起想下一步，好吗？", "Next time you tell me where you're stuck, shall I ask if you want to think through a next step together?", "Cuando me cuentes dónde te has quedado, ¿te pregunto si quieres que pensemos en el siguiente paso?")],
  company: [tr("下次我心情不好，你可以先陪我坐一会儿，等我想讲了再聊吗？", "Next time I'm upset, could you sit with me for a bit while I find my words?", "La próxima vez que esté mal, ¿te quedarías conmigo un rato mientras encuentro las palabras?"),
    tr("下次你难受，我先坐在你身边，把什么时候开口留给你，好吗？", "Next time you're upset, shall I sit close and let you decide when to talk?", "La próxima vez que estés mal, ¿me quedo cerca y dejo que decidas cuándo hablar?")],
};
function choice(profile, question) {
  return question.options.find(option => option.id === profile?.answers?.[question.id]);
}

export function supportReady(profile) {
  const questions = supportModule.questions;
  return questions.every(q => profile?.answers?.[q.id] === "skip" || choice(profile, q))
    && questions.slice(0, 3).filter(q => choice(profile, q)).length >= 2;
}

function discovery(profile, language) {
  const [first, pause, due] = supportModule.questions.map(q => choice(profile, q)?.id);
  const lines = [];
  // A deadline can change what support looks like. Put that switch first.
  if (first && due === "ideas" && first !== due) {
    const transitions = {
      story: tr("事情已经过去时，我想先讲完；如果还等着我拿主意，我反而想和你一起找个开头。", "When it's over, let me finish the story. When I still have to act, help me find a place to start.", "Si ya pasó, déjame terminar de contarlo. Si aún tengo que actuar, ayúdame a encontrar por dónde empezar."),
      signal: tr("事情已经过去时，一句「我懂」能让我接下去；手里还有事要回，我更想和你一起想第一步。", "When it's over, a sign you understand helps me go on. When I still owe a reply, I'd like help with the first step.", "Si ya pasó, una señal de que me entiendes me ayuda a seguir. Si aún debo contestar, prefiero ayuda con el primer paso."),
      company: tr("事情已经过去时，陪我坐会儿就好；还有一条难回的消息等着我时，我会想拉你一起想一句开头。", "When it's over, sitting with me helps. When a difficult reply is still due, I'd like your help finding the first line.", "Si ya pasó, me ayuda que te quedes conmigo. Si aún debo contestar un mensaje difícil, me gustaría que buscáramos la primera frase."),
    };
    lines.push(transitions[first][language]);
    if (pause && pause !== first && pause !== due) lines.push(pauses[pause][language]);
    return lines.join(language === "zh" ? "" : " ");
  }
  if (first === "story" && pause === "signal") {
    lines.push(tr("让我先讲完，也让我知道你在听。我看向你的时候，一个点头就够了。", "Let me finish the story, and let me know you're with me. A nod when I look over is enough.", "Déjame terminar de contarlo y hazme saber que me sigues. Cuando te mire, bastará con un gesto.")[language]);
  } else if (first && first === pause) {
    lines.push(repeated[first][language]);
  } else {
    if (first) lines.push(openings[first][language]);
    if (pause) lines.push(pauses[pause][language]);
  }
  if (due && due !== first) {
    lines.push(decisions[due][language]);
  } else if (due) {
    lines.push(tr("上次急着回一条难回的消息时，我也想从这里开始。", "I wanted the same start the last time I had a difficult message to answer.", "También busqué ese comienzo la última vez que tuve un mensaje difícil que responder.")[language]);
  }
  return lines.join(language === "zh" ? "" : " ");
}

export function reviewedWording(profile, language) {
  const review = profile?.supportReview;
  if (!supportReady(profile) || !review) return "";
  if (review.kind === "edit") return review.text?.trim() || "";
  if (review.kind !== "fits" && review.kind !== "sometimes") return "";
  const saved = review.wording?.[language];
  if (typeof saved === "string" && saved.trim()) return saved;
  const line = discovery(profile, language);
  if (review.kind === "fits") return line;
  return tr("有些时候，我希望你这样陪我：", "This helps me some of the time: ", "A veces me ayuda esto: ")[language] + line;
}

export function supportPersonalSection(profile, language) {
  const evidence = supportModule.questions.flatMap(q => {
    const selected = choice(profile, q);
    return selected ? [{ questionId: q.id, question: q.text[language], answer: selected.text[language], topic: q.topic[language] }] : [];
  });
  if (!evidence.length) return null;
  const reviewable = supportReady(profile);
  const first = evidence[0];
  const summary = reviewable ? reviewedWording(profile, language) || discovery(profile, language)
    : tr(`${first.topic}，你选了「${first.answer}」。`, `${first.topic}: you picked “${first.answer}”.`, `${first.topic}: elegiste «${first.answer}».`)[language];
  const suggestion = reviewable
    ? tr("开口时、话说到一半、事情等着处理时，你想要的陪伴可能不同。读一遍这段话，看看哪一句在生活里用得上。", "The beginning of a conversation, a pause and a looming decision can call for different things. Read this back and see which words you'd use.", "Empezar a hablar, hacer una pausa y tener algo pendiente pueden pedir cosas distintas. Lee estas palabras y piensa cuáles usarías.")[language]
    : tr("可以回到这个主题补充经历。至少两个不同的倾诉场景里有贴近你的选项，才会出现可确认的发现。", "You can revisit this topic. A draft appears after the four prompts if at least two listening situations fit your experience.", "Puedes volver a este tema. Aparecerá un borrador al terminar las cuatro preguntas si al menos dos situaciones encajan con tu experiencia.")[language];
  return { id: "support", title: supportModule.title[language], summary, suggestion, evidence, answered: evidence.length, total: supportModule.questions.length, reviewable };
}

function sharedSupport(profile, language) {
  const wording = reviewedWording(profile, language);
  if (!wording) return null;
  const habit = choice(profile, supportModule.questions[3]);
  return { wording, habitId: habit?.id, habit: habit?.text[language] };
}

export function supportSharingPreview(profile, language) {
  const shared = sharedSupport(profile, language);
  if (!shared) return [];
  const lines = [tr(`我希望收到的陪伴：${shared.wording}`, `How I'd like to be supported: ${shared.wording}`, `Cómo me gusta recibir apoyo: ${shared.wording}`)[language]];
  if (shared.habit) lines.push(tr(`上次我陪人时：${shared.habit}`, `When I supported someone last time: ${shared.habit}`, `La última vez que acompañé a alguien: ${shared.habit}`)[language]);
  return lines;
}

const differingOpenings = {
  story: tr("一方想先把故事讲完，另一方可能已经准备回应了。可以留意开始接话的那个时刻。", "One of you wants time to finish the story. The other may already be ready to respond. Notice the moment you come in.", "Una persona quiere tiempo para terminar de contar. La otra quizá ya esté lista para responder. Fíjense en cuándo toma la palabra."),
  signal: tr("倾诉的人在等一个「我听到了」的信号。另一种回应即使很用心，这个信号也可能没传到。", "The speaker is listening for a sign of being heard. Even a thoughtful response can leave that signal unspoken.", "Quien habla espera una señal de que se le escucha. Hasta una respuesta atenta puede dejar esa señal sin expresar."),
  ideas: tr("倾诉的人已经想找下一步。听的人可以问一句「现在要一起想办法吗」，再决定怎样接。", "The speaker is ready to consider a next step. A quick “Want to think it through together?” can help the listener find the moment.", "Quien habla ya quiere pensar en el siguiente paso. Preguntar «¿Lo pensamos juntos?» puede ayudar a encontrar el momento."),
  company: tr("一方需要先缓一缓。坐近一些、等对方起头，也能让对方感受到陪伴。", "One of you wants time to settle first. Sitting nearby and letting them start can be a way to offer company.", "Una persona necesita primero un momento de calma. Quedarse cerca y dejar que empiece a hablar puede ser una forma de acompañar."),
};

function direction(receiver, giver, language, partnerName, mine) {
  const request = sharedSupport(receiver, language);
  const response = sharedSupport(giver, language);
  const title = mine ? tr("我心情不好时", "When I've had a hard day", "Cuando yo tengo un mal día") : tr(`${partnerName} 心情不好时`, `When ${partnerName} has had a hard day`, `Cuando ${partnerName} tiene un mal día`);
  const speaker = mine ? tr("我", "Me", "Yo")[language] : partnerName;
  const listener = mine ? partnerName : tr("我", "Me", "Yo")[language];
  const lines = [tr(`${speaker}希望被这样陪伴：「${request.wording}」`, `${speaker} · How I'd like support: “${request.wording}”`, `${speaker} · Cómo me gusta recibir apoyo: «${request.wording}»`)[language]];
  if (response.habit) lines.push(tr(`${listener}分享的上一次回应：「${response.habit}」。`, `${listener} · What I did last time: “${response.habit}”.`, `${listener} · Lo que hice la última vez: «${response.habit}».`)[language]);
  // Only compare the opening described in the approved wording. Edited and
  // conditional statements must not inherit a label from the private answers.
  const first = choice(receiver, supportModule.questions[0])?.id;
  const comparable = receiver.supportReview.kind === "fits" && first && response.habitId;
  let status = "mixed";
  let suggestion = mine
    ? tr(`我在自己的发现里写了「${request.wording}」。下次我难受时，我们可以先对一下那天适合怎么陪我吗？`, `I wrote, “${request.wording}” Next time I'm upset, could we check what would help me that day?`, `Escribí «${request.wording}». La próxima vez que me sienta mal, ¿podemos ver qué me ayudaría ese día?`)[language]
    : tr(`我读到你写的「${request.wording}」。下次你难受时，我先问问那天你最想要什么，好吗？`, `I read what you wrote: “${request.wording}” Next time you're upset, shall I ask what would help most that day?`, `Leí lo que escribiste: «${request.wording}». La próxima vez que te sientas mal, ¿te pregunto primero qué te ayudaría ese día?`)[language];
  if (comparable) {
    status = first === response.habitId ? "same" : "different";
    const interpretation = status === "same"
      ? tr("这一次，倾诉的人想要的开头，刚好是听的人上次做的事。", "The opening one of you wants lines up with what the other did last time.", "El comienzo que una persona busca coincide con lo que la otra hizo la última vez.")
      : differingOpenings[first];
    lines.push(interpretation[language]);
    suggestion = conversationDrafts[first][mine ? 0 : 1][language];
  }
  return { id: mine ? "support-receive" : "support-give", title: title[language], status, summary: lines.join("\n\n"), suggestion, evidence: [] };
}

export function coupleSupportReport(mine, partner, partnerName, language) {
  if (!sharedSupport(mine, language) || !sharedSupport(partner, language)) {
    return { status: "waiting", partnerName, summary: tr("等两个人都确认自己想分享的说法。", "Waiting for both of you to confirm your wording.", "Falta que ambos confirmen sus palabras.")[language], sections: [] };
  }
  return {
    status: "ready", partnerName,
    summary: tr("轮流看一眼：一个人心情不好时，另一个人怎么接住这段话？", "Take turns: when one of you has a hard day, how does the other respond?", "Por turnos: cuando alguien tiene un día difícil, ¿cómo responde la otra persona?")[language],
    sections: [direction(mine, partner, language, partnerName, true), direction(partner, mine, language, partnerName, false)],
  };
}
