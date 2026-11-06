import { useState } from "react";
import { CaretDown, Check, Sparkle } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { IDEA_CATEGORIES, IDEAS, ideaText, type IdeaCategory } from "./ideas";

type Done = Map<number, { photo: string | null; date: string }>;

/** "100 small things to do together": ideas to browse; telling Pinky in Us that you did one keeps it as a memory and ticks it. */
export function IdeasSection({ language, done, onDid }: { language: Language; done: Done; onDid: (text: string) => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<IdeaCategory | "all">("all");
  const shown = IDEAS.filter((idea) => category === "all" || idea.category === category);
  const did = (number: number, text: string) => onDid(t(`Pinky，我们一起「${text}」了！帮我们存进回忆，写几句温馨的话。（100 件小事 #${number}）`, `Pinky, we did "${text}" together! Keep it in our memories with a few warm words. (100 little things #${number})`, `Pinky, ¡hicimos «${text}» juntos! Guárdalo en nuestros recuerdos con unas palabras bonitas. (100 cosas pequeñas #${number})`));
  return <section className="ideas" data-testid="ideas">
    <button type="button" className="ideas-head" aria-expanded={open} onClick={() => setOpen(!open)}>
      <Sparkle size={20} weight="fill" />
      <span><strong>{t("一起做的 100 件小事", "100 little things to do together", "100 cosas pequeñas para hacer juntos")}</strong>
        <small>{done.size ? t(`已经一起做了 ${done.size} 件`, `${done.size} done together`, `${done.size} hechas juntos`) : t("没想好去哪、做什么？来这里找灵感", "Not sure what to do? Find an idea here", "¿No saben qué hacer? Encuentren una idea aquí")}</small></span>
      <CaretDown size={18} className={open ? "ideas-caret open" : "ideas-caret"} />
    </button>
    {open && <>
      <div className="ideas-progress" aria-hidden="true"><span style={{ width: `${done.size}%` }} /></div>
      <div className="ideas-cats" role="group" aria-label={t("分类", "Categories", "Categorías")}>
        {[{ id: "all" as const, label: ["全部", "All", "Todas"] as [string, string, string] }, ...IDEA_CATEGORIES].map((item) => <button key={item.id} type="button" className={category === item.id ? "active" : ""} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{ideaText(item, language)}</button>)}
      </div>
      <p className="ideas-hint">{t("做过了就点一下，发几张照片给 Pinky，它会存进你们的回忆。", "Did one? Tap it and send Pinky a few photos; it keeps them in your memories.", "¿Hicieron una? Tóquenla y envíen unas fotos a Pinky; las guarda en sus recuerdos.")}</p>
      <ol className="ideas-list">{shown.map((idea) => {
        const text = ideaText(idea, language), mark = done.get(idea.number);
        return <li key={idea.number}><button type="button" className={mark ? "is-done" : ""} onClick={() => did(idea.number, text)} data-testid={`idea-${idea.number}`}>
          <span className="ideas-num">{mark ? <Check size={14} weight="bold" /> : idea.number}</span>
          <span className="ideas-text">{text}</span>
          {mark?.photo && <img src={`/api/photos/${encodeURIComponent(mark.photo)}`} alt="" draggable={false} />}
        </button></li>;
      })}</ol>
    </>}
  </section>;
}
