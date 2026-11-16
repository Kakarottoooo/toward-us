import { useRef, useState, type PointerEvent } from "react";
import { ArrowCounterClockwise, Trash } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import "./play-drawing.css";

const palette = { rose: "#c24b6e", blue: "#3a639b", ink: "#4c343f" };
type Pen = keyof typeof palette;
type Point = [number, number];
export type Stroke = { color: Pen; points: Point[] };

const pointString = (point: Point) => (point[0] * 320 / 255).toFixed(1) + "," + (point[1] * 170 / 255).toFixed(1);

function Lines({ strokes }: { strokes: Stroke[] }) {
  return strokes.map(({ points, color }, index) => points.length === 1
    ? <circle key={index} cx={points[0][0] * 320 / 255} cy={points[0][1] * 170 / 255} r="2" fill={palette[color]} />
    : <polyline key={index} points={points.map(pointString).join(" ")} stroke={palette[color]} fill="none" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />);
}

export function Sketch({ strokes, label }: { strokes: Stroke[]; label: string }) {
  return <svg className="play-sketch" viewBox="0 0 320 170" role="img" aria-label={label}><Lines strokes={strokes} /></svg>;
}

export function Drawing({ strokes, onChange, disabled, language }: { strokes: Stroke[]; onChange: (value: Stroke[]) => void; disabled: boolean; language: Language }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [color, setColor] = useState<Pen>("rose");
  const active = useRef<number | null>(null);
  const current = useRef(strokes);
  current.current = strokes;
  const maxed = strokes.length >= 16 || strokes.reduce((count, stroke) => count + stroke.points.length, 0) >= 480;
  const point = (event: PointerEvent<SVGSVGElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect();
    const bound = (n: number) => Math.max(0, Math.min(255, Math.round(n * 255)));
    return [bound((event.clientX - box.left) / box.width), bound((event.clientY - box.top) / box.height)];
  };
  const write = (next: Stroke[]) => { current.current = next; onChange(next); };
  const start = (event: PointerEvent<SVGSVGElement>) => {
    if (disabled || maxed || event.button !== 0 || active.current !== null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    active.current = event.pointerId;
    write([...current.current, { color, points: [point(event)] }]);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (disabled || active.current !== event.pointerId) return;
    const items = current.current, last = items.at(-1);
    if (!last || items.reduce((count, stroke) => count + stroke.points.length, 0) >= 480) return;
    const next = point(event), previous = last.points.at(-1);
    if (previous && Math.hypot(next[0] - previous[0], next[1] - previous[1]) < 2) return;
    write([...items.slice(0, -1), { ...last, points: [...last.points, next] }]);
  };
  const release = () => { active.current = null; };
  return <div className="play-drawing">
    <svg className="play-sketch is-editable" data-scroll-drag="ignore" viewBox="0 0 320 170" role="img" aria-label={t("涂鸦画布", "Doodle canvas", "Lienzo de dibujo")}
      onPointerDown={start} onPointerMove={move} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}><Lines strokes={strokes} /></svg>
    <div className="play-drawing-tools">
      {(Object.keys(palette) as Pen[]).map((pen) => <button key={pen} type="button" className="play-pen" aria-pressed={color === pen}
        disabled={disabled} aria-label={pen === "rose" ? t("粉色", "Rose", "Rosa") : pen === "blue" ? t("蓝色", "Blue", "Azul") : t("墨色", "Ink", "Tinta")}
        onClick={() => setColor(pen)}><span style={{ backgroundColor: palette[pen] }} /></button>)}
      <button type="button" className="play-drawing-icon" disabled={disabled || !strokes.length} aria-label={t("撤销一笔", "Undo stroke", "Deshacer trazo")} onClick={() => write(strokes.slice(0, -1))}><ArrowCounterClockwise size={19} /></button>
      <button type="button" className="play-drawing-icon" disabled={disabled || !strokes.length} aria-label={t("清空画布", "Clear drawing", "Borrar dibujo")} onClick={() => write([])}><Trash size={19} /></button>
    </div>
    {maxed && <small>{t("画布快满了，可以撤销一笔再画。", "You can undo a stroke to make more room.", "Puedes deshacer un trazo para seguir dibujando.")}</small>}
  </div>;
}
