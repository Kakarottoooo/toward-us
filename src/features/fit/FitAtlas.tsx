import { useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { axes, preferenceLabel, familyLines, headings, headlineOrder, patterns, poles, portraits, type Family, type Axis } from "../../../shared/fit-four-portraits.mjs";

export function FitAtlas({ language, myCode }: { language: Language; myCode?: string | null }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const own = myCode && Object.hasOwn(portraits, myCode) ? myCode : null;
  const [family, setFamily] = useState<Family>(() => own ? own.slice(0, 2) as Family : "TR");
  const [opened, setOpened] = useState<string | null>(own);
  const familyKeys = Object.keys(familyLines) as Family[];

  const readings: Record<Axis, { question: string; example: string }> = {
    distance: {
      question: t("相处距离 · 两个人都空着的周六，我希望怎么过？", "Time together · When we both have a free Saturday, how would I like to spend it?", "Tiempo en pareja · Si los dos tenemos el sábado libre, ¿cómo me gustaría pasarlo?"),
      example: t("小林想上午独自看展，晚上和阿宁吃饭；阿宁更喜欢一起去看展，哪怕各看各的。他们都期待见面，区别是一天里有多少时间想留给自己。", "Lin would like to see an exhibition alone and meet Ning for dinner. Ning would like to go together, even if they look at different things. Both look forward to meeting. They differ in how much of the day they want to keep for themselves.", "Lin quiere ir a una exposición por su cuenta y cenar con Ning. Ning prefiere ir en pareja, aunque cada cual mire cosas distintas. A ambos les apetece verse. La diferencia está en cuánto tiempo quieren reservar para sí."),
    },
    reassurance: {
      question: t("确认需求 · 分开的时候，我怎么知道你还惦记我？", "Reassurance · When we are apart, what tells me I am on your mind?", "Confirmación · Cuando estamos por separado, ¿cómo sé que piensas en mí?"),
      example: t("小林喜欢独自看展，却希望中午收到阿宁一句「晚上见，我订了你喜欢的那家」。阿宁觉得昨晚约好了就可以安心等到晚上。这解释了为什么一个人既需要空间，也会盼着对方联系。", "Lin enjoys the exhibition alone and would still love a midday message from Ning: “See you tonight. I booked your favorite place.” Ning feels reassured by the plan they made yesterday. Wanting time alone can go hand in hand with wanting a check-in.", "Lin disfruta de la exposición y aun así agradecería un mensaje de Ning a mediodía: «Nos vemos esta noche. Reservé en tu sitio favorito». A Ning le basta con el plan de ayer. Querer tiempo propio es compatible con agradecer una señal de cariño."),
    },
    language: {
      question: t("爱意接收 · 你已经在表达关心，怎样做我最有感觉？", "Receiving affection · When you show care, what helps me feel it?", "Cómo recibo cariño · Cuando me cuidas, ¿qué me ayuda a sentirlo?"),
      example: t("晚饭时小林说这周加班很累。阿宁可以先说「听起来你这周真的很辛苦」，也可以接过家里的事，让小林早点休息。两种都能表达关心；这一项问的是哪种更容易让收下这份关心的人感觉到爱。", "At dinner Lin mentions a tiring week of overtime. Ning could say, “That sounds like a really tough week,” or take over the chores so Lin can rest. Both express care. The question is which reaches the person on the receiving end more readily.", "Durante la cena Lin cuenta que ha trabajado muchas horas extra. Ning puede decir «Parece que has tenido una semana durísima» o encargarse de las tareas para que Lin descanse. Ambos gestos expresan cariño. Lo que cambia es cuál le llega más a quien lo recibe."),
    },
    conflict: {
      question: t("分歧沟通时机 · 意见不同，我什么时候才谈得进去？", "Talking through disagreement · When am I ready to talk about a disagreement?", "Cuándo hablar de un desacuerdo · ¿Cuándo estoy en condiciones de hablar de lo ocurrido?"),
      example: t("饭后，两人因为临时改计划起了争执。阿宁想现在弄清是怎么回事，小林想先走一圈，半小时后再回来聊。知道这一点，两人就能约好何时继续。是否真的回来、是否愿意听完，还要看之后的行动。", "After dinner a last-minute change of plans causes friction. Ning wants to understand what happened now. Lin wants a walk and to talk in half an hour. Knowing this helps them agree on a time. Coming back and listening are things they still have to do.", "Después de cenar discuten por un cambio de planes. Ning quiere aclararlo enseguida. Lin quiere dar un paseo y volver a hablar en media hora. Saberlo permite acordar una hora. Volver y escuchar dependen de lo que hagan después."),
    },
  };
  return <article className="fit-atlas" data-testid="fit-atlas">
    <section className="atlas-overview">
      <h2>{t("四个字母，读懂你的恋爱风格", "Four letters describe how you like to be loved", "Cuatro letras para entender cómo te gusta recibir amor")}</h2>
      <p>{t("先看你喜欢多少共处时间，以及多常需要伴侣明确表达在乎。再看你更容易从言语还是行动中感到被爱，遇到分歧想当场谈还是晚点谈。这四项偏好组合成 16 种恋爱风格。", "Start with how much time you like together and how often you want clear signs of affection. Then consider whether words or actions make you feel loved, and whether you want to talk through disagreements now or later. These four preferences form 16 styles.", "Empieza por cuánto tiempo te gusta pasar en pareja y con qué frecuencia necesitas señales claras de cariño. Luego piensa si sientes más el amor en las palabras o en los hechos y si prefieres hablar de un desacuerdo en el momento o más tarde. Estas cuatro preferencias forman 16 estilos.")}</p>
      <details className="atlas-explainer" data-testid="atlas-four-questions"><summary>{t("四个角度分别在问什么？", "What does each question tell us?", "¿Qué nos dice cada pregunta?")}<CaretDown size={16}/></summary>
        <p>{t("拿小林和阿宁的一个周六举例。留意同一个人在四个时刻，想要的东西有什么不同。", "Imagine spending a Saturday with Lin and Ning. Notice what the same person wants at four different moments.", "Imagina un sábado con Lin y Ning. Observa cómo cambian las necesidades de una misma persona en cuatro momentos distintos.")}</p>
        <dl>{Object.entries(axes).map(([axis, definition]) => <div key={axis}>
          <dt>{readings[axis as Axis].question}</dt>
          <dd>{definition.pair.split("").map(letter => <span key={letter}><b>{letter}</b> {poles[letter][language]}</span>)}</dd>
          <dd className="atlas-case">{readings[axis as Axis].example}</dd>
        </div>)}</dl>
        <p>{t("每项看 7 道情境题的整体倾向。至少要有 5 次明确选择；两边打平或答得太少，就写「待确认」。", "Each preference draws on seven situations and needs at least five clear choices. A tie or too few answers leaves it open.", "Cada preferencia se basa en siete situaciones y requiere al menos cinco elecciones claras. Un empate o muy pocas respuestas la dejan por confirmar.")}</p>
      </details>
      <details className="atlas-explainer" data-testid="atlas-why-four"><summary>{t("为什么是这四项？它们能说明多少？", "Why these four, and what can they tell us?", "¿Por qué estas cuatro y hasta dónde llegan?")}<CaretDown size={16}/></summary>
        <dl>
          <div><dt>{t("少问一项，就容易猜错一件事", "Leaving one out invites a misunderstanding", "Omitir una pregunta puede llevar a un malentendido")}</dt><dd>{t("只看共处时间，会以为喜欢独处的小林也喜欢一整天没消息。只知道小林想收到回应，仍然猜不到一句体贴的话和替人分担一件事，哪种更贴心。就算这两样都做对了，起争执时要不要马上谈，也得另问。", "Time together alone would suggest Lin might enjoy a whole day of silence. Knowing Lin wants a check-in still leaves open whether kind words or practical help would feel better. Even getting both right tells Ning little about whether to start a difficult conversation right away.", "Si solo miramos el tiempo en pareja, podríamos pensar que Lin disfruta de un día entero sin noticias. Saber que agradece una señal tampoco aclara si le llegan más unas palabras amables o una ayuda concreta. Incluso acertando en ambas cosas, aún hay que preguntar cuándo hablar de un desacuerdo.")}</dd></div>
          <div><dt>{t("什么值得放进四个字母", "What earns a place in the code", "Qué merece una letra")}</dt><dd>{t("Pinky 选的是日常会反复遇到、两种做法都有道理、说清后伴侣就知道怎样调整的偏好。四项分别决定一起待多久、多久给一次回应、用什么方式表达关心、何时重新开口。每项保留两种倾向，组合起来有 16 种读法；接近中间时，报告也会写出另一面的表现。", "Pinky chose recurring situations where either preference makes sense and knowing it helps a partner adjust. Each question guides a different decision: time together, frequency of reassurance, form of affection or timing of a conversation. Two tendencies per question give 16 possible descriptions. A close result leaves room for the other tendency too.", "Pinky eligió situaciones cotidianas en las que ambas preferencias tienen sentido y conocerlas ayuda a actuar. Cada pregunta orienta una decisión distinta: cuánto tiempo compartir, con qué frecuencia dar señales, cómo expresar cariño y cuándo retomar una charla. Dos tendencias por pregunta dan 16 descripciones posibles. Cuando el resultado es ajustado, el retrato recoge también la otra tendencia.")}</dd></div>
          <div><dt>{t("同一个类型，仍可能想过不同的生活", "The same style can come with different life choices", "Un mismo estilo puede acompañar planes de vida distintos")}</dt><dd>{t("两个人四个字母完全一样，也可能一个确定想要孩子、另一个确定不想。两人都想尽快谈开，也可能只有一个人愿意听完或兑现约定。因此，44 题里有 28 题用于描述风格，另有 16 题了解实际怎样照顾人、暂停后怎样接着谈、信任、分工和未来选择。判断要不要一起生活，还需要双方谈清这些事，也看平时怎样对待彼此。", "Two people can share all four letters and have firmly different wishes about children. Both may want to talk right away, yet only one listens or keeps an agreement. Of the 44 questions, 28 describe style. The other 16 explore how you offer care, follow up after a pause, build trust, share work and see the future. A decision about a life together also depends on these conversations and how you treat each other over time.", "Dos personas con las mismas cuatro letras pueden tener deseos opuestos sobre tener hijos. Quizá ambas quieran hablar enseguida, aunque solo una escuche o cumpla lo acordado. De las 44 preguntas, 28 describen el estilo. Las otras 16 exploran cómo se cuidan, retoman las conversaciones, construyen confianza, reparten tareas y ven el futuro. La decisión de compartir una vida también depende de hablar de estas cosas y de cómo se tratan a lo largo del tiempo.")}</dd></div>
        </dl>
      </details>
    </section>
    <section aria-labelledby="atlas-families"><h3 id="atlas-families">{t("共处与确认需求", "Time together and reassurance", "Tiempo en pareja y necesidad de confirmación")}</h3>
      <div className="atlas-family-nav" role="group" aria-labelledby="atlas-families">{familyKeys.map(key =>
        <button type="button" key={key} aria-pressed={family === key} aria-controls="atlas-family-list" data-testid={`atlas-family-${key}`}
          onClick={() => { setFamily(key); setOpened(key === own?.slice(0, 2) ? own : null); }}>
          <b>{key}</b><span className="atlas-group-label">{[...key].map(letter => <span key={letter}>{poles[letter][language]}</span>)}</span>
        </button>)}</div>
      <div id="atlas-family-list" className="atlas-family-list">
        <h4>{preferenceLabel(family, language)} <span>· {family}</span></h4>
        <p className="atlas-family-motto">{familyLines[family][language]}</p>
        {Object.entries(portraits).filter(([code]) => code.startsWith(family)).map(([code, portrait]) =>
          <div key={code} className="atlas-type">
            <button type="button" aria-expanded={opened === code} aria-controls={`atlas-reading-${code}`} data-testid={`atlas-type-${code}`} onClick={() => setOpened(opened === code ? null : code)}>
              <span className="atlas-word"><strong>{preferenceLabel(code.slice(2), language)}</strong><small>{code}</small></span>
              {own === code && <span className="atlas-own">{t("我的类型", "My type", "Mi tipo")}</span>}<CaretDown aria-hidden="true" size={17}/>
            </button>
            <div id={`atlas-reading-${code}`} hidden={opened !== code} className="atlas-reading">
              <p className="atlas-poles">{[...code].map(c => poles[c][language]).join(" · ")}</p>
              <dl>{portrait.lines.map((line, n) => <div key={n}><dt>{headings[n][language]}</dt><dd>{line[language]}</dd></div>)}</dl>
            </div>
          </div>)}
      </div>
    </section>
    <details className="atlas-explainer atlas-pair"><summary>{t("两个人会形成什么相处模式？", "How do two styles work together?", "¿Cómo se relacionan dos estilos?")}<CaretDown size={16}/></summary>
      <p>{t("双方都同意连接画像后，Pinky 对照四项偏好。遇到多处不同，标题依次优先考虑分歧、确认、距离、语言；待确认的字母单独注明。", "After both partners agree to connect, Pinky compares the four preferences. When several differ, the title prioritizes disagreement, reassurance, closeness and then affection. Open letters are marked separately.", "Cuando ambos aceptan conectar sus retratos, Pinky compara las cuatro preferencias. Si hay varias diferencias, el título da prioridad a desacuerdos, seguridad, cercanía y afecto, en ese orden. Las letras pendientes se indican aparte.")}</p>
      <dl>{[...headlineOrder, "same" as const].map(key => <div key={key}><dt>{patterns[key].name[language]}</dt><dd>{patterns[key].body[language]}</dd></div>)}</dl>
    </details>
  </article>;
}
