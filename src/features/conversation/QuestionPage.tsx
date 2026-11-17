import { useEffect, useRef, type ReactNode } from "react";
import { ArrowLeft, CaretLeft, CaretRight, SquaresFour } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { MobileScroll } from "../../mobile";
import "./question-page.css";

export function QuestionPage({ language, onBack, onLibrary, onPrevious, onNext, canPrevious, canNext, messageCount, footer, children, swipe }: {
  language: Language;
  onBack: () => void;
  onLibrary: () => void;
  onPrevious: () => void;
  onNext: () => void;
  canPrevious: boolean;
  canNext: boolean;
  messageCount: number;
  footer: ReactNode;
  children: ReactNode;
  swipe: ReturnType<typeof import("./useQuestionSwipe").useQuestionSwipe>;
}) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const content = useRef<HTMLDivElement>(null);
  const previous = useRef(messageCount);
  const following = useRef(true);
  useEffect(() => {
    const viewport = content.current?.closest<HTMLElement>(".mobile-scroll");
    if (!viewport) return;
    const track = () => { following.current = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 72; };
    viewport.addEventListener("scroll", track, { passive: true });
    return () => viewport.removeEventListener("scroll", track);
  }, []);
  useEffect(() => {
    const viewport = content.current?.closest<HTMLElement>(".mobile-scroll");
    if (viewport && messageCount > previous.current && following.current) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    }
    previous.current = messageCount;
  }, [messageCount]);
  return <section className="question-page" aria-label={t("这张题卡", "This question", "Esta pregunta")} data-testid="question-page">
    <header className="question-page-header">
      <button type="button" onClick={onBack} data-testid="question-back"><ArrowLeft size={21} /><span>{t("我们俩", "Us", "Nosotros")}</span></button>
      <h1>{t("双人题卡", "Question for two", "Pregunta para dos")}</h1>
      <button type="button" onClick={onLibrary} aria-label={t("打开题库", "Open library", "Abrir catálogo")}><SquaresFour size={22} /></button>
    </header>
    <div className="question-page-nav">
      <button type="button" disabled={!canPrevious} onClick={onPrevious} aria-label={t("上一题", "Previous card", "Carta anterior")}><CaretLeft size={20} /></button>
      <span>{t("左右滑动换题", "Swipe to change cards", "Desliza para cambiar de carta")}</span>
      <button type="button" disabled={!canNext} onClick={onNext} aria-label={t("下一题", "Next card", "Carta siguiente")}><CaretRight size={20} /></button>
    </div>
    <div className="question-page-stream">
      <MobileScroll className="question-page-scroll"><div ref={content} className="question-page-content" {...swipe}>{children}</div></MobileScroll>
    </div>
    {footer}
  </section>;
}
