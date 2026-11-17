import { ArrowClockwise, Check, Lightbulb, MagnifyingGlass } from "@phosphor-icons/react";
import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { localized, type Language } from "../../i18n";
import type { ScreenProps } from "./MatchScreen";
import "./spot-difference.css";

type Coord = { x: number; y: number };
type Mark = Coord & { index: number; name: Record<Language, string> };
type SpotView = {
  name: Record<Language, string>; total: number; side: "A" | "B";
  marks: Mark[]; hint: Mark | null; hintsUsed: number;
  last: "miss" | "known" | "found" | null;
};

const arrows: Record<string, Coord> = {
  ArrowUp: { x: 0, y: -5 }, ArrowDown: { x: 0, y: 5 }, ArrowLeft: { x: -5, y: 0 }, ArrowRight: { x: 5, y: 0 },
};
const clamp = (value: number) => Math.min(97, Math.max(3, value));
const at = (point: Coord): CSSProperties => ({ left: `${point.x}%`, top: `${point.y}%` });

export function SpotDifference({ match, language, act, onRematch }: ScreenProps<SpotView>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const { state } = match;
  const done = match.status === "finished";
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [cursor, setCursor] = useState<Coord | null>(null);
  const [tap, setTap] = useState<Coord | null>(null);
  const sending = useRef(false);

  async function play(action: Record<string, unknown>) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try { await act(action); }
    finally { sending.current = false; setBusy(false); }
  }

  function guess(point: Coord) {
    if (!imageLoaded || busy || done) return;
    setTap(point);
    void play({ type: "tap", ...point });
  }

  function moveCursor(event: KeyboardEvent<HTMLButtonElement>) {
    if (!imageLoaded || done) return;
    const direction = arrows[event.key];
    if (!direction) return;
    event.preventDefault();
    const previous = cursor ?? { x: 50, y: 50 };
    setCursor({ x: clamp(previous.x + direction.x), y: clamp(previous.y + direction.y) });
  }

  const status = state.last === "miss" ? t("这里一样，再比较一下。", "This spot matches. Keep looking.", "Esta parte coincide. Sigan buscando.")
    : state.last === "known" ? t("这里已经标记过了。", "You've already marked this spot.", "Ya marcaron esta parte.")
    : state.last === "found" ? t("找到了！", "You found one!", "¡Encontraron una!")
    : t("找到差异后，直接点你图上的那一处。", "When something looks different, tap that spot on your picture.", "Cuando vean una diferencia, tóquenla en su imagen.");

  return <section className="spot-difference" data-testid="spot-difference">
    <header className="spot-top">
      <div><strong>{state.name[language]}</strong><p>{t(`你看的是图 ${state.side} · 和 TA 聊聊各自看见了什么`, `Picture ${state.side} · Tell your partner what you see`, `Imagen ${state.side} · Cuéntale a tu pareja qué ves`)}</p></div>
      <div className="spot-counter" aria-label={t(`找到 ${state.marks.length}/${state.total}`, `Found ${state.marks.length} of ${state.total}`, `Encontraron ${state.marks.length} de ${state.total}`)}>
        <MagnifyingGlass size={15} weight="bold" aria-hidden="true" /><strong>{state.marks.length}/{state.total}</strong>
      </div>
    </header>
    {imageError ? <div className="spot-image-empty" role="status">
      <p>{t("图暂时打不开。", "This picture couldn't open.", "No se pudo abrir la imagen.")}</p>
      <button className="game-quiet" type="button" onClick={() => { setImageError(false); setRetry((value) => value + 1); }}>{t("重试", "Retry", "Reintentar")}</button>
    </div> : <div className={`spot-frame${imageLoaded ? " is-loaded" : ""}`}>
      <img
        src={`/api/matches/${encodeURIComponent(match.id)}/spot-image${retry ? `?retry=${retry}` : ""}`}
        alt={state.name[language]} width={720} height={500} draggable={false}
        onLoad={() => setImageLoaded(true)} onError={() => { setImageLoaded(false); setImageError(true); }}
      />
      {!imageLoaded && <div className="spot-wait" role="status">{t("正在打开图片…", "Opening the picture…", "Abriendo la imagen…")}</div>}
      {imageLoaded && <>
        {!done && <button type="button" className="spot-hit-surface" aria-disabled={busy} data-testid="spot-image-board"
          aria-label={t("标记不同。也可用方向键移动，按回车标记。", "Mark a difference. Use arrow keys to move and Enter to mark.", "Marca una diferencia. Usa las flechas y pulsa Intro para marcar.")}
          onKeyDown={moveCursor} onBlur={() => setCursor(null)}
          onClick={(event) => {
            if (event.detail === 0) { guess(cursor ?? { x: 50, y: 50 }); return; }
            const bounds = event.currentTarget.getBoundingClientRect();
            guess({ x: (event.clientX - bounds.left) * 100 / bounds.width, y: (event.clientY - bounds.top) * 100 / bounds.height });
          }}
        />}
        {state.marks.map((mark) => <span key={mark.index} style={at(mark)} className="spot-marker is-found" aria-hidden="true"><Check size={15} weight="bold" /></span>)}
        {state.hint && <span style={at(state.hint)} className="spot-marker is-hint" aria-hidden="true"><Lightbulb size={15} weight="bold" /></span>}
        {!done && cursor && <span style={at(cursor)} className="spot-marker is-cursor" aria-hidden="true" />}
        {!done && tap && (busy || state.last === "miss") && <span style={at(tap)} className={`spot-tap${busy ? " is-busy" : ""}`} aria-hidden="true">{busy ? "·" : "×"}</span>}
      </>}
    </div>}
    {done ? <div className="spot-finish" data-testid="spot-result" role="status">
      <strong>{t("五处都找到了！", "You found all five!", "¡Encontraron las cinco!")}</strong>
      <span>{t(`使用了 ${state.hintsUsed} 个提示`, `Hints used: ${state.hintsUsed}`, `Pistas usadas: ${state.hintsUsed}`)}</span>
      <button type="button" className="game-primary" onClick={onRematch}><ArrowClockwise size={17} aria-hidden="true" />{t("下一张图", "Next picture", "Siguiente imagen")}</button>
    </div> : <>
      <p className="spot-feedback" data-testid="spot-feedback" role="status">{status}</p>
      <div className="spot-actions">
        {state.hint ? <p className="spot-hint-label" role="status"><Lightbulb size={17} aria-hidden="true" />{state.hint.name[language]}</p>
          : <button className="game-quiet" type="button" disabled={busy || !imageLoaded} data-testid="spot-hint" onClick={() => void play({ type: "hint" })}>
            <Lightbulb size={17} aria-hidden="true" />{t("要个提示", "Get a hint", "Pedir una pista")}</button>}
        <button className="game-quiet" type="button" disabled={busy} onBlur={() => setConfirmEnd(false)}
          onClick={() => {
            if (confirmEnd) { setConfirmEnd(false); void play({ type: "abandon" }); }
            else setConfirmEnd(true);
          }}>{confirmEnd ? t("确认结束", "Confirm ending", "Confirmar fin") : t("结束这局", "End game", "Terminar partida")}</button>
      </div>
    </>}
  </section>;
}
