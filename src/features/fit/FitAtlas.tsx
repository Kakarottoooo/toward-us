import { useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { axes, families, familyLines, headings, headlineOrder, patterns, poles, portraits, type Family } from "../../../shared/fit-four-portraits.mjs";

export function FitAtlas({ language, myCode }: { language: Language; myCode?: string | null }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const own = myCode && Object.hasOwn(portraits, myCode) ? myCode : null;
  const [family, setFamily] = useState<Family>(() => own ? own.slice(0, 2) as Family : "TR");
  const [opened, setOpened] = useState<string | null>(own);
  const familyKeys = Object.keys(families) as Family[];

  return <article className="fit-atlas" data-testid="fit-atlas">
    <section className="atlas-overview">
      <h2>{t("四个字母，读懂你的恋爱风格", "Four letters describe how you like to be loved", "Cuatro letras para entender cómo te gusta recibir amor")}</h2>
      <p>{t("Pinky 的恋爱四问，从距离、确认、语言和分歧看你希望怎样被爱。前两个字母组成家族，后两个说明什么最能传达爱、你想在什么时候谈分歧。每个家族都有四种风格。", "Pinky’s Four Questions explore closeness, reassurance, affection and disagreement. The first two letters give your family. The last two describe how love reaches you and when you like to talk things through. Each family has four styles.", "Las Cuatro Preguntas de Pinky exploran cercanía, seguridad, cariño y desacuerdos. Las dos primeras letras forman tu familia. Las dos últimas describen cómo recibes el cariño y cuándo prefieres hablar de un desacuerdo. Cada familia tiene cuatro estilos.")}</p>
      <details className="atlas-explainer"><summary>{t("每个字母是什么意思？", "What does each letter mean?", "¿Qué significa cada letra?")}<CaretDown size={16}/></summary>
        <dl>{Object.values(axes).map(axis => <div key={axis.pair}><dt>{axis.name[language]}</dt><dd>{axis.pair.split("").map(letter => <span key={letter}><b>{letter}</b> {poles[letter][language]}</span>)}</dd></div>)}</dl>
        <p>{t("44 道情境题中，每个字母各参考 7 道。报告会标出倾向强弱；某项明确作答不足 5 道或票数相同时，该项显示待确认。", "Of the 44 situations, seven inform each letter. Your report shows the strength of each preference. Fewer than five choices or a tie leaves that letter open.", "De las 44 situaciones, siete corresponden a cada letra. El retrato indica la fuerza de cada preferencia. Con menos de cinco respuestas claras o un empate, esa letra queda por confirmar.")}</p>
      </details>
    </section>
    <section aria-labelledby="atlas-families"><h3 id="atlas-families">{t("四个家族 · 十六种风格", "Four families · Sixteen styles", "Cuatro familias · Dieciséis estilos")}</h3>
      <div className="atlas-family-nav" role="group" aria-labelledby="atlas-families">{familyKeys.map(key =>
        <button type="button" key={key} aria-pressed={family === key} aria-controls="atlas-family-list" data-testid={`atlas-family-${key}`}
          onClick={() => { setFamily(key); setOpened(key === own?.slice(0, 2) ? own : null); }}>
          <b>{key}</b><span>{families[key][language]}</span>
        </button>)}</div>
      <div id="atlas-family-list" className="atlas-family-list">
        <h4>{families[family][language]} <span>· {family}</span></h4>
        <p className="atlas-family-motto">{familyLines[family][language]}</p>
        {Object.entries(portraits).filter(([code]) => code.startsWith(family)).map(([code, portrait]) =>
          <div key={code} className="atlas-type">
            <button type="button" aria-expanded={opened === code} aria-controls={`atlas-reading-${code}`} data-testid={`atlas-type-${code}`} onClick={() => setOpened(opened === code ? null : code)}>
              <span className="atlas-word"><strong>{portrait.name[language]}</strong><small>{code}</small></span>
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
