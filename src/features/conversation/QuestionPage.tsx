import { useEffect, useLayoutEffect, useRef, type PointerEvent, type ReactNode } from "react";
import { ArrowLeft, CaretLeft, CaretRight, SquaresFour } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { MobileScroll } from "../../mobile";
import "./question-page.css";

export function QuestionPage({ language, onBack, onLibrary, onMove, canPrevious, canNext, messageCount, footer, children, cardId, card }: {
  language: Language;
  onBack: () => void;
  onLibrary: () => void;
  onMove: (direction: -1 | 1) => void | Promise<void>;
  canPrevious: boolean;
  canNext: boolean;
  messageCount: number;
  footer: ReactNode;
  children: ReactNode;
  cardId: string;
  card: ReactNode;
}) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const content = useRef<HTMLDivElement>(null);
  const face = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number; horizontal: boolean } | null>(null);
  const lastCard = useRef(cardId);
  const direction = useRef<-1 | 1>(1);
  const locked = useRef(false);
  const suppressClick = useRef(false);
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pose = (x: number) => `translate3d(${x}px,0,0) rotate(${Math.max(-4, Math.min(4, x / 65))}deg)`;
  const settle = (node: HTMLElement) => {
    const from = getComputedStyle(node).transform;
    node.style.transform = "";
    if (!reduced()) node.animate([{ transform: from }, { transform: "none" }], { duration: 190, easing: "cubic-bezier(.2,.8,.2,1)" });
  };
  const turn = async (step: -1 | 1) => {
    const node = face.current;
    if (!node || locked.current) return;
    if (!(step === 1 ? canNext : canPrevious)) { settle(node); return; }
    locked.current = true;
    direction.current = step;
    const leavingId = lastCard.current;
    if (!reduced()) {
      const from = getComputedStyle(node).transform;
      const end = pose(-step * node.clientWidth);
      node.style.transform = end;
      const exit = node.animate([{ transform: from }, { transform: end }], { duration: 145, easing: "ease-in" });
      await exit.finished.catch(() => {});
    }
    if (!node.isConnected) return;
    try { await onMove(step); }
    finally {
      requestAnimationFrame(() => {
        if (node.isConnected && lastCard.current === leavingId) settle(node);
        locked.current = false;
      });
    }
  };
  useLayoutEffect(() => {
    if (lastCard.current === cardId) return;
    lastCard.current = cardId;
    const node = face.current;
    if (!node) return;
    node.style.transform = "";
    node.style.setProperty("--deal-from", direction.current === 1 ? "38%" : "-38%");
    node.dataset.dealt = "true";
    const viewport = node.closest(".mobile-scroll");
    if (viewport) viewport.scrollTop = 0;
    previous.current = messageCount;
    following.current = true;
  }, [cardId, messageCount]);
  const begin = (event: PointerEvent<HTMLDivElement>) => {
    suppressClick.current = false;
    if (locked.current || !event.isPrimary || event.button !== 0 ||
      (event.target as Element).closest("textarea,input,select,a,canvas,[contenteditable],[data-scroll-drag='ignore']")) return;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, horizontal: false };
  };
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    const dx = event.clientX - g.x, dy = event.clientY - g.y;
    if (!g.horizontal) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.2) { gesture.current = null; return; }
      event.currentTarget.setPointerCapture(event.pointerId);
      g.horizontal = true;
      suppressClick.current = true;
    }
    event.stopPropagation();
    const allowed = dx < 0 ? canNext : canPrevious;
    if (!reduced()) event.currentTarget.style.transform = pose(dx * (allowed ? 0.88 : 0.18));
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    gesture.current = null;
    if (!g.horizontal) return;
    const dx = event.clientX - g.x;
    if (event.type === "pointerup" && Math.abs(dx) >= 52) void turn(dx < 0 ? 1 : -1);
    else settle(event.currentTarget);
  };
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
      <button type="button" disabled={!canPrevious} onClick={() => void turn(-1)} aria-label={t("上一题", "Previous card", "Carta anterior")}><CaretLeft size={20} /></button>
      <span>{t("左右滑动换题", "Swipe to change cards", "Desliza para cambiar de carta")}</span>
      <button type="button" disabled={!canNext} onClick={() => void turn(1)} aria-label={t("下一题", "Next card", "Carta siguiente")}><CaretRight size={20} /></button>
    </div>
    <div className="question-page-stream">
      <MobileScroll className="question-page-scroll"><div ref={content} className="question-page-content">
        <div ref={face} className="question-page-face" onPointerDown={begin} onPointerMove={drag} onPointerUp={end} onPointerCancel={end}
          onClickCapture={event => { if (event.detail && suppressClick.current) { event.preventDefault(); event.stopPropagation(); } }}>
          <div key={cardId}>{card}</div>
        </div>{children}</div></MobileScroll>
    </div>
    {footer}
  </section>;
}
