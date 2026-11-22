import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Buildings, CalendarPlus, Camera, Check, ForkKnife, Gift, Heart, House, Mountains, PaintBrush, RocketLaunch, Shuffle } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { jsonBody, relationshipApi } from "../relationship/api";
import { BottomSheet } from "../navigation/Sheet";
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
 * idea: tell Ourever you did it (it keeps the memory and ticks the card) or that you want to (it helps plan it). */
export function IdeasSection({ language, done, onDid, onPlan, onChanged }: { language: Language; done: Done; onDid: (text: string) => void; onPlan?: (text: string) => void; onChanged?: () => Promise<void> | void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  // "We did it" ticks the card directly (QA round 3: it used to work only through Ourever, so not with AI declined or down);
  // telling Ourever, with photos, stays a choice when AI is on. Undo takes the memory back.
  const [aiOn, setAiOn] = useState(false);
  useEffect(() => { void relationshipApi<{ user: { aiConsentAt?: string | null } | null }>("/api/auth/me").then((state) => setAiOn(Boolean(state.user?.aiConsentAt))).catch(() => {}); }, []);
  const [marking, setMarking] = useState(false), [markError, setMarkError] = useState("");
  const [justDid, setJustDid] = useState<{ idea: number; id: string; version: number } | null>(null);
  const today = () => new Date().toLocaleDateString("en-CA");
  const markDone = async (idea: Idea) => {
    setMarking(true); setMarkError("");
    try {
      const { record } = await relationshipApi<{ record: { id: string; version: number } }>(`/api/spaces/moments/ideas/${idea.number}`, jsonBody({ title: ideaText(idea, language), date: today() }));
      setJustDid({ idea: idea.number, id: record.id, version: record.version });
      await onChanged?.();
    } catch { setMarkError(t("没有保存，请重试。", "That wasn't saved. Try again.", "No se guardó. Inténtalo de nuevo.")); }
    finally { setMarking(false); }
  };
  const undoMark = async () => {
    if (!justDid) return;
    setMarking(true); setMarkError("");
    try { await relationshipApi(`/api/space-items/${encodeURIComponent(justDid.id)}/moment/archive`, jsonBody({ version: justDid.version })); setJustDid(null); await onChanged?.(); }
    catch { setMarkError(t("没有撤销，请重试。", "That wasn't undone. Try again.", "No se deshizo. Inténtalo de nuevo.")); }
    finally { setMarking(false); }
  };
  const [category, setCategory] = useState<IdeaCategory | "all">("all");
  const [open, setOpen] = useState<Idea | null>(null), [picked, setPicked] = useState(false);
  const left = useMemo(() => IDEAS.filter((idea) => !done.has(idea.number) && (category === "all" || idea.category === category)), [done, category]);
  const label = (id: IdeaCategory) => ideaText(IDEA_CATEGORIES.find((item) => item.id === id)!, language);
  const did = (idea: Idea) => { const text = ideaText(idea, language); onDid(t(`Ourever，我们一起「${text}」了！帮我们存进回忆，写几句温馨的话。（100 件小事 #${idea.number}）`, `Ourever, we did "${text}" together! Keep it in our memories with a few warm words. (100 little things #${idea.number})`, `Ourever, ¡hicimos «${text}» juntos! Guárdalo en nuestros recuerdos con unas palabras bonitas. (100 cosas #${idea.number})`)); };
  const plan = (idea: Idea) => { const text = ideaText(idea, language); (onPlan || onDid)(t(`Ourever，我们想找个时间一起「${text}」，帮我们想想什么时候、怎么安排。（100 件小事 #${idea.number}）`, `Ourever, we'd like to "${text}" together sometime. Help us work out when and how. (100 little things #${idea.number})`, `Ourever, nos gustaría «${text}» juntos. Ayúdanos a ver cuándo y cómo. (100 cosas #${idea.number})`)); };
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
          {mark.photo && <img className="ideas-sheet-photo" decoding="async" src={`/api/photos/${encodeURIComponent(mark.photo)}?w=640`} alt={t(`${ideaText(open, language)}，拍摄于 ${day(mark.date)}`, `${ideaText(open, language)}, ${day(mark.date)}`, `${ideaText(open, language)}, ${day(mark.date)}`)} draggable={false} />}
          <p>{t(`你们在 ${day(mark.date)} 一起做过了 ♡`, `You did this together on ${day(mark.date)} ♡`, `Lo hicieron juntos el ${day(mark.date)} ♡`)}</p>
          {!mark.photo && aiOn && <div className="ideas-sheet-actions"><button type="button" className="ideas-quiet" onClick={() => { setOpen(null); did(open); }} data-testid="idea-tell"><Camera size={18} />{t("告诉 Ourever，加几张照片", "Tell Ourever and add photos", "Contárselo a Ourever y añadir fotos")}</button></div>}
          {justDid?.idea === open.number && <button type="button" className="ideas-undo" disabled={marking} onClick={() => void undoMark()} data-testid="idea-undo">{t("撤销", "Undo", "Deshacer")}</button>}
        </> : <>
          <p>{t("做过了就点“我们做过了”，这一张会打上勾，你们俩都能看到。", "Done it? Tap We did it and this card is ticked for both of you.", "¿Ya lo hicieron? Toquen «Ya lo hicimos» y la tarjeta quedará marcada para los dos.")}</p>
          <div className="ideas-sheet-actions">
            {aiOn && <button type="button" className="ideas-primary" onClick={() => { setOpen(null); plan(open); }} data-testid="idea-plan"><CalendarPlus size={18} weight="bold" />{t("就做这件，帮我们安排", "Let's do it: help us plan", "Hagámoslo: ayúdanos a planearlo")}</button>}
            <button type="button" className={aiOn ? "ideas-quiet" : "ideas-primary"} disabled={marking} onClick={() => void markDone(open)} data-testid="idea-did"><Check size={18} weight="bold" />{marking ? t("正在保存…", "Saving…", "Guardando…") : t("我们做过了", "We did it", "Ya lo hicimos")}</button>
            {picked && <button type="button" className="ideas-quiet" onClick={surprise} data-testid="idea-again"><Shuffle size={18} />{t("换一件", "Another one", "Otra")}</button>}
          </div>
        </>}
        {markError && <p className="space-error" role="alert">{markError}</p>}
      </div>}
    </BottomSheet>
  </section>;
}
