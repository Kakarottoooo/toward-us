import { useMemo, useState, type ReactNode } from "react";
import { Buildings, CalendarPlus, Camera, Check, ForkKnife, Gift, Heart, House, Mountains, PaintBrush, RocketLaunch, Shuffle } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { BottomSheet } from "../../mobile";
import { IDEA_CATEGORIES, IDEAS, ideaText, type Idea, type IdeaCategory } from "./ideas";

type Done = Map<number, { photo: string | null; date: string }>;

// Each kind of idea has its colour and its picture on the poster.
const LOOK: Record<IdeaCategory, { icon: (size: number) => ReactNode; tone: string }> = {
  outdoors: { icon: (size) => <Mountains size={size} weight="fill" />, tone: "outdoors" },
  home: { icon: (size) => <House size={size} weight="fill" />, tone: "home" },
  food: { icon: (size) => <ForkKnife size={size} weight="fill" />, tone: "food" },
  town: { icon: (size) => <Buildings size={size} weight="fill" />, tone: "town" },
  adventure: { icon: (size) => <RocketLaunch size={size} weight="fill" />, tone: "adventure" },
  create: { icon: (size) => <PaintBrush size={size} weight="fill" />, tone: "create" },
  romance: { icon: (size) => <Heart size={size} weight="fill" />, tone: "romance" },
  care: { icon: (size) => <Gift size={size} weight="fill" />, tone: "care" },
};

/** "100 small things to do together" (founder 11-06, design A, then readable cards): all hundred by kind, each card with its words
 * and turning into the couple's own photo once they have done it. "今天做什么" picks one they haven't done. A card opens the
 * idea: tell Pinky you did it (it keeps the memory and ticks the card) or that you want to (it helps plan it). */
export function IdeasSection({ language, done, onDid, onPlan }: { language: Language; done: Done; onDid: (text: string) => void; onPlan?: (text: string) => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [category, setCategory] = useState<IdeaCategory | "all">("all");
  const [open, setOpen] = useState<Idea | null>(null), [picked, setPicked] = useState(false);
  const left = useMemo(() => IDEAS.filter((idea) => !done.has(idea.number) && (category === "all" || idea.category === category)), [done, category]);
  const label = (id: IdeaCategory) => ideaText(IDEA_CATEGORIES.find((item) => item.id === id)!, language);
  const did = (idea: Idea) => { const text = ideaText(idea, language); onDid(t(`Pinky，我们一起「${text}」了！帮我们存进回忆，写几句温馨的话。（100 件小事 #${idea.number}）`, `Pinky, we did "${text}" together! Keep it in our memories with a few warm words. (100 little things #${idea.number})`, `Pinky, ¡hicimos «${text}» juntos! Guárdalo en nuestros recuerdos con unas palabras bonitas. (100 cosas #${idea.number})`)); };
  const plan = (idea: Idea) => { const text = ideaText(idea, language); (onPlan || onDid)(t(`Pinky，我们想找个时间一起「${text}」，帮我们想想什么时候、怎么安排。（100 件小事 #${idea.number}）`, `Pinky, we'd like to "${text}" together sometime. Help us work out when and how. (100 little things #${idea.number})`, `Pinky, nos gustaría «${text}» juntos. Ayúdanos a ver cuándo y cómo. (100 cosas #${idea.number})`)); };
  const surprise = () => { if (!left.length) return; setPicked(true); setOpen(left[Math.floor(Math.random() * left.length)]); };
  const mark = open ? done.get(open.number) : undefined;
  const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(languageTag(language), { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

  return <section className="ideas-poster" data-testid="ideas">
    <header className="ideas-poster-head">
      <h2>{t("我们的 100 件小事", "Our 100 little things", "Nuestras 100 cosas")}</h2>
      <p>{done.size ? t(`已经一起做了 ${done.size} 件，还有 ${100 - done.size} 件等你们`, `${done.size} done together, ${100 - done.size} to go`, `${done.size} hechas juntos, faltan ${100 - done.size}`) : t("一起做完一件，这一张就会换成你们那天的照片。", "Do one together and its card becomes your photo from that day.", "Hagan una juntos y su tarjeta se vuelve su foto de ese día.")}</p>
      <div className="ideas-poster-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={done.size} aria-label={t("完成进度", "Progress", "Progreso")}><span style={{ width: `${done.size}%` }} /></div>
    </header>

    <div className="ideas-poster-cats" role="group" aria-label={t("分类", "Categories", "Categorías")}>
      <button type="button" className={category === "all" ? "is-on" : ""} aria-pressed={category === "all"} onClick={() => setCategory("all")}>{t("全部", "All", "Todas")}</button>
      {IDEA_CATEGORIES.map((item) => <button key={item.id} type="button" className={`idea-tone-${LOOK[item.id].tone} ${category === item.id ? "is-on" : ""}`} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{LOOK[item.id].icon(13)}{label(item.id)}</button>)}
    </div>

    <button type="button" className="ideas-surprise" onClick={surprise} disabled={!left.length} data-testid="ideas-surprise"><Shuffle size={18} weight="bold" />{t("今天做什么？抽一件", "Pick one for today", "Elige una para hoy")}</button>

    {/* Every idea readable at a glance (founder 11-06: the squares were too small to tell what they were): a card with its words,
        three to a row, by kind; once done it shows that day's photo under the words. */}
    {IDEA_CATEGORIES.filter((item) => category === "all" || item.id === category).map((item) => {
      const ideas = IDEAS.filter((idea) => idea.category === item.id), count = ideas.filter((idea) => done.has(idea.number)).length;
      return <section key={item.id} className={`ideas-group idea-tone-${LOOK[item.id].tone}`} aria-label={label(item.id)}>
        <h3>{LOOK[item.id].icon(16)}{label(item.id)}<small>{count}/{ideas.length}</small></h3>
        <ol className="ideas-cards">{ideas.map((idea) => {
          const done_ = done.get(idea.number);
          return <li key={idea.number}>
            <button type="button" className={`ideas-card ${done_ ? "is-done" : ""} ${done_?.photo ? "has-photo" : ""}`} onClick={() => { setPicked(false); setOpen(idea); }} data-testid={`idea-${idea.number}`}>
              {done_?.photo && <img decoding="async" src={`/api/photos/${encodeURIComponent(done_.photo)}?w=240`} alt="" draggable={false} />}
              <span className="ideas-card-top">{done_ ? <Check size={14} weight="bold" /> : LOOK[idea.category].icon(14)}<b>{idea.number}</b></span>
              <span className="ideas-card-text">{ideaText(idea, language)}</span>
            </button>
          </li>;
        })}</ol>
      </section>;
    })}

    <BottomSheet open={Boolean(open)} onOpenChange={(next) => { if (!next) setOpen(null); }} title={open ? `#${open.number} · ${label(open.category)}` : ""}>
      {open && <div className={`ideas-sheet idea-tone-${LOOK[open.category].tone}`} data-testid="idea-sheet">
        <span className="ideas-sheet-icon">{LOOK[open.category].icon(30)}</span>
        <h3>{ideaText(open, language)}</h3>
        {mark ? <>
          {mark.photo && <img className="ideas-sheet-photo" decoding="async" src={`/api/photos/${encodeURIComponent(mark.photo)}?w=640`} alt="" draggable={false} />}
          <p>{t(`你们在 ${day(mark.date)} 一起做过了 ♡`, `You did this together on ${day(mark.date)} ♡`, `Lo hicieron juntos el ${day(mark.date)} ♡`)}</p>
        </> : <>
          <p>{t("做过了就告诉 Pinky，发几张那天的照片，它会存进你们的回忆，这一张就会换成你们的照片。", "Done it? Tell Pinky and send a few photos from that day: it keeps them in your memories and this card becomes your photo.", "¿Ya lo hicieron? Díganselo a Pinky con unas fotos de ese día: las guarda en sus recuerdos y esta tarjeta será su foto.")}</p>
          <div className="ideas-sheet-actions">
            <button type="button" className="ideas-primary" onClick={() => { setOpen(null); plan(open); }} data-testid="idea-plan"><CalendarPlus size={18} weight="bold" />{t("就做这件，帮我们安排", "Let's do it: help us plan", "Hagámoslo: ayúdanos a planearlo")}</button>
            <button type="button" className="ideas-quiet" onClick={() => { setOpen(null); did(open); }} data-testid="idea-did"><Camera size={18} />{t("我们做过了", "We did it", "Ya lo hicimos")}</button>
            {picked && <button type="button" className="ideas-quiet" onClick={surprise} data-testid="idea-again"><Shuffle size={18} />{t("换一件", "Another one", "Otra")}</button>}
          </div>
        </>}
      </div>}
    </BottomSheet>
  </section>;
}
