import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";
import { useScreenPortal } from "../../mobile";

export type Slide = { photo: string | null; title: string; date: string; text: string };

/** A story Pinky found, played full screen like Google Photos' memories: one photo at a time, advancing by itself; tap
 * the right side for the next, the left for the previous. */
export function StoryViewer({ title, slides, closeLabel, onClose }: { title: string; slides: Slide[]; closeLabel: string; onClose: () => void }) {
  const { screenRef } = useScreenPortal();
  const [index, setIndex] = useState(0);
  const slide = slides[index];
  const next = () => { if (index + 1 < slides.length) setIndex(index + 1); else onClose(); };
  const back = () => setIndex(Math.max(0, index - 1));
  useEffect(() => { const timer = setTimeout(next, 4500); return () => clearTimeout(timer); });
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); else if (event.key === "ArrowRight") next(); else if (event.key === "ArrowLeft") back(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  if (!slide || !screenRef.current) return null;
  return createPortal(<div className="story-viewer" role="dialog" aria-modal="true" aria-label={title} data-testid="story-viewer">
    {slide.photo ? <img key={slide.photo} className="story-viewer-photo" src={`/api/photos/${encodeURIComponent(slide.photo)}`} alt="" draggable={false} /> : <div className="story-viewer-photo story-viewer-blank" />}
    <div className="story-viewer-bars" aria-hidden="true">{slides.map((item, at) => <span key={at}><i className={at < index ? "done" : at === index ? "now" : ""} /></span>)}</div>
    <header className="story-viewer-head"><strong>{title}</strong><button type="button" onClick={onClose} aria-label={closeLabel}><X size={22} weight="bold" /></button></header>
    <button type="button" className="story-viewer-tap is-back" onClick={back} aria-label="‹" />
    <button type="button" className="story-viewer-tap is-next" onClick={next} aria-label="›" />
    <footer className="story-viewer-foot"><small>{slide.date}</small>{slide.title && <strong>{slide.title}</strong>}{slide.text && <p>{slide.text}</p>}</footer>
  </div>, screenRef.current);
}
