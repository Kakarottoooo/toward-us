import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pause, Play, X } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { useScreenPortal } from "../../mobile";

export type Slide = { photo: string | null; title: string; date: string; text: string };

/** A story Ourever found, played full screen like Google Photos' memories: one photo at a time, advancing by itself; tap
 * the right side for the next, the left for the previous. */
export function StoryViewer({ title, slides, language, onClose }: { title: string; slides: Slide[]; language: Language; onClose: () => void }) {
  const { screenRef } = useScreenPortal();
  const [index, setIndex] = useState(0);
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(4500);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);
  const slide = slides[index];
  const next = () => { if (index + 1 < slides.length) setIndex(index + 1); else onClose(); };
  const back = () => setIndex(Math.max(0, index - 1));
  useEffect(() => { remaining.current = 4500; }, [index]);
  useEffect(() => {
    if (paused) return;
    const started = performance.now();
    const timer = setTimeout(next, remaining.current);
    return () => { clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (performance.now() - started)); };
  }, [paused, index, slides]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); else if (event.target instanceof HTMLInputElement) return; else if (event.key === "ArrowRight") next(); else if (event.key === "ArrowLeft") back(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  if (!slide || !screenRef.current) return null;
  return createPortal(<div className="story-viewer" onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:enabled,input"));
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    }} role="dialog" aria-modal="true" aria-label={title} data-testid="story-viewer">
    {slide.photo ? <img key={slide.photo} className="story-viewer-photo" style={{ animationPlayState: paused ? "paused" : "running" }} src={`/api/photos/${encodeURIComponent(slide.photo)}`} alt={t(`${slide.title || title}，${slide.date}，第 ${index + 1} 张`, `${slide.title || title}, ${slide.date}, photo ${index + 1}`, `${slide.title || title}, ${slide.date}, foto ${index + 1}`)} draggable={false} /> : <div className="story-viewer-photo story-viewer-blank" />}
    <div className="story-viewer-bars" aria-hidden="true" key={index}>{slides.map((item, at) => <span key={at}><i className={at < index ? "done" : at === index ? "now" : ""} style={{ animationPlayState: paused ? "paused" : "running" }} /></span>)}</div>
    <header className="story-viewer-head"><strong>{title}</strong><button type="button" onClick={() => setPaused(!paused)} aria-label={paused ? t("继续播放", "Resume story", "Continuar historia") : t("暂停播放", "Pause story", "Pausar historia")}>{paused ? <Play size={20} /> : <Pause size={20} />}</button><button type="button" ref={closeRef} onClick={onClose} aria-label={t("关闭故事", "Close story", "Cerrar historia")}><X size={22} weight="bold" /></button></header>
    <button type="button" className="story-viewer-tap is-back" onClick={back} disabled={index === 0} aria-label={t("上一张", "Previous slide", "Diapositiva anterior")} />
    <button type="button" className="story-viewer-tap is-next" onClick={next} aria-label={t("下一张", "Next slide", "Diapositiva siguiente")} />
    <footer className="story-viewer-foot">{slides.length > 1 && <input type="range" min={1} max={slides.length} step={1} value={index + 1} aria-label={t("故事进度", "Story position", "Posición de la historia")} onChange={(event) => setIndex(Number(event.target.value) - 1)} />}<small>{slide.date}</small>{slide.title && <strong>{slide.title}</strong>}{slide.text && <p>{slide.text}</p>}</footer>
  </div>, screenRef.current);
}
