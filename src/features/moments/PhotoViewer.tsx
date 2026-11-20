import { useEffect, useRef, useState, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import { CaretLeft, CaretRight, MagnifyingGlassPlus, X } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { useScreenPortal } from "../../mobile";

type Transform = { scale: number; x: number; y: number };
const original: Transform = { scale: 1, x: 0, y: 0 };
const distance = (a: React.Touch, b: React.Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function PhotoViewer({ photos, start, title, language, onClose }: { photos: string[]; start: number; title: string; language: Language; onClose: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const { screenRef } = useScreenPortal();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [index, setIndex] = useState(start);
  const [transform, setTransform] = useState(original);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const gesture = useRef<{ startX: number; startY: number; distance: number; transform: Transform } | null>(null);
  function move(next: number) {
    if (next < 0 || next >= photos.length) return;
    setIndex(next); setTransform(original); setFailed(false); setAttempt(0);
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);
  function begin(event: TouchEvent) {
    const [a, b] = Array.from(event.touches);
    gesture.current = { startX: a.clientX, startY: a.clientY, distance: b ? distance(a, b) : 0, transform };
  }
  function drag(event: TouchEvent<HTMLDivElement>) {
    const from = gesture.current;
    if (!from) return;
    const [a, b] = Array.from(event.touches);
    if (from.distance && !b) return;
    const scale = b && from.distance ? clamp(from.transform.scale * distance(a, b) / from.distance, 1, 5) : from.transform.scale;
    const dx = from.transform.x + a.clientX - from.startX, dy = from.transform.y + a.clientY - from.startY;
    const bx = event.currentTarget.clientWidth * (scale - 1) / 2, by = event.currentTarget.clientHeight * (scale - 1) / 2;
    setTransform({ scale, x: clamp(dx, -bx, bx), y: clamp(dy, -by, by) });
  }
  function finish(event: TouchEvent) {
    const from = gesture.current;
    if (from && !from.distance && from.transform.scale === 1 && !event.touches.length) {
      const dx = event.changedTouches[0].clientX - from.startX, dy = event.changedTouches[0].clientY - from.startY;
      if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.3) move(index + (dx < 0 ? 1 : -1));
    }
    gesture.current = null;
  }
  const caption = t(`${title}，第 ${index + 1} 张，共 ${photos.length} 张`, `${title}, photo ${index + 1} of ${photos.length}`, `${title}, foto ${index + 1} de ${photos.length}`);
  if (!screenRef.current) return null;
  return createPortal(<div className="memory-viewer" role="dialog" aria-modal="true" aria-label={title}
    onKeyDown={(event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") move(index + 1);
      if (event.key === "ArrowLeft") move(index - 1);
      if (event.key === "Tab") {
        const enabled = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:enabled"));
        if (event.shiftKey && document.activeElement === enabled[0]) { event.preventDefault(); enabled.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === enabled.at(-1)) { event.preventDefault(); enabled[0]?.focus(); }
      }
    }}>
    <header><strong>{title}</strong><button type="button" ref={closeRef} onClick={onClose} aria-label={t("关闭照片", "Close photo", "Cerrar foto")}><X size={22} /></button></header>
    <div className="memory-viewer-stage" data-scroll-drag="ignore" onTouchStart={begin} onTouchMove={drag} onTouchEnd={finish} onTouchCancel={() => { gesture.current = null; }}>
      {!failed ? <img key={`${photos[index]}:${attempt}`} src={`/api/photos/${encodeURIComponent(photos[index])}`} alt={caption} draggable={false}
        onError={() => setFailed(true)} style={{ transform: `translate(${transform.x}px,${transform.y}px) scale(${transform.scale})` }} />
        : <div role="alert"><p>{t("照片未能加载。", "This photo could not load.", "No se pudo cargar esta foto.")}</p><button type="button" onClick={() => { setFailed(false); setAttempt(attempt + 1); }}>{t("重试", "Retry", "Reintentar")}</button></div>}
    </div>
    <footer>
      <button type="button" disabled={!index} onClick={() => move(index - 1)} aria-label={t("上一张照片", "Previous photo", "Foto anterior")}><CaretLeft size={22} /></button>
      <span aria-live="polite">{index + 1} / {photos.length}</span>
      <button type="button" disabled={index === photos.length - 1} onClick={() => move(index + 1)} aria-label={t("下一张照片", "Next photo", "Foto siguiente")}><CaretRight size={22} /></button>
      <button type="button" disabled={failed} aria-pressed={transform.scale > 1} onClick={() => setTransform(transform.scale > 1 ? original : { ...original, scale: 2 })} aria-label={t("缩放照片", "Zoom photo", "Ampliar foto")}><MagnifyingGlassPlus size={22} /></button>
    </footer>
  </div>, screenRef.current);
}
