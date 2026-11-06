import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowCounterClockwise, ArrowsClockwise, Check, Eraser, PaperPlaneRight, Shuffle, StopCircle } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { KeyboardInput, useKeyboard } from "../../mobile";
import type { Act, Opponent } from "./MatchScreen";
import type { DrawRound, DrawState, MatchView, Stroke } from "./types";

export const INKS = ["#252525", "#e0405a", "#2f6fde", "#2e9b5f", "#f2a23a", "#8a5ad8"];
const WIDTHS = [4, 9, 18]; // in the 0..1000 drawing space
const MAX_POINTS = 6000;

function paint(canvas: HTMLCanvasElement | null, strokes: Stroke[], progress = 1) {
  if (!canvas) return;
  const context = canvas.getContext("2d"); if (!context) return;
  const scale = canvas.width / 1000;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.lineCap = "round"; context.lineJoin = "round";
  const total = strokes.reduce((sum, stroke) => sum + stroke.p.length / 2, 0);
  let budget = Math.ceil(total * progress);
  for (const stroke of strokes) {
    if (budget <= 0) break;
    const points = Math.min(stroke.p.length / 2, budget); budget -= points;
    context.strokeStyle = INKS[stroke.c] || INKS[0]; context.fillStyle = context.strokeStyle; context.lineWidth = (WIDTHS[stroke.w] || WIDTHS[1]) * scale;
    if (points === 1) { context.beginPath(); context.arc(stroke.p[0] * scale, stroke.p[1] * scale, context.lineWidth / 2, 0, Math.PI * 2); context.fill(); continue; }
    context.beginPath(); context.moveTo(stroke.p[0] * scale, stroke.p[1] * scale);
    for (let index = 1; index < points; index += 1) context.lineTo(stroke.p[index * 2] * scale, stroke.p[index * 2 + 1] * scale);
    context.stroke();
  }
}

// Drawings already replayed in this session; a reload after a guess shows them whole.
const replayed = new Set<string>();

/** A square canvas sized to its box. `replay` (an id for the drawing) draws it in over a moment, the way it was drawn, once. */
function Picture({ strokes, replay = "", label, small = false }: { strokes: Stroke[]; replay?: string; label: string; small?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const pixels = Math.round(canvas.clientWidth * (window.devicePixelRatio || 1)) || 600; canvas.width = pixels; canvas.height = pixels;
    if (!replay || replayed.has(replay) || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { paint(canvas, strokes); return; }
    replayed.add(replay);
    let frame = 0; const began = performance.now();
    const step = (now: number) => { const progress = Math.min(1, (now - began) / 1800); paint(canvas, strokes, progress); if (progress < 1) frame = requestAnimationFrame(step); };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [strokes, replay]);
  return <canvas ref={ref} className={`draw-canvas ${small ? "is-small" : ""}`} role="img" aria-label={label} />;
}

/** The drawing pad: pointer strokes in a 0..1000 space, six inks, three widths, undo and clear. */
function Pad({ language, onDone, busy }: { language: Language; onDone: (strokes: Stroke[]) => void; busy: boolean }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const ref = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]), [ink, setInk] = useState(0), [width, setWidth] = useState(1);
  const live = useRef<Stroke | null>(null);
  const points = strokes.reduce((sum, stroke) => sum + stroke.p.length / 2, 0);
  useEffect(() => { const canvas = ref.current; if (!canvas) return; const pixels = Math.round(canvas.clientWidth * (window.devicePixelRatio || 1)) || 600; canvas.width = pixels; canvas.height = pixels; paint(canvas, strokes); }, [strokes]);
  const spot = (event: ReactPointerEvent<HTMLCanvasElement>) => { const box = event.currentTarget.getBoundingClientRect(); return [Math.max(0, Math.min(1000, Math.round((event.clientX - box.left) / box.width * 1000))), Math.max(0, Math.min(1000, Math.round((event.clientY - box.top) / box.height * 1000)))]; };
  const down = (event: ReactPointerEvent<HTMLCanvasElement>) => { if (points >= MAX_POINTS) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); live.current = { c: ink, w: width, p: spot(event) }; paint(ref.current, [...strokes, live.current]); };
  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const stroke = live.current; if (!stroke) return;
    const [x, y] = spot(event), lx = stroke.p.at(-2)!, ly = stroke.p.at(-1)!;
    if (Math.abs(x - lx) + Math.abs(y - ly) < 6 || points + stroke.p.length / 2 >= MAX_POINTS) return;
    stroke.p.push(x, y); paint(ref.current, [...strokes, stroke]);
  };
  const up = () => { const stroke = live.current; live.current = null; if (stroke) setStrokes((current) => [...current, stroke]); };
  return <div className="draw-pad">
    <canvas ref={ref} className="draw-canvas is-pad" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-scroll-drag="ignore" aria-label={t("画板", "Drawing pad", "Lienzo")} data-testid="draw-pad" />
    <div className="draw-tools">
      <div className="draw-inks" role="radiogroup" aria-label={t("颜色", "Colour", "Color")}>{INKS.map((color, index) => <button key={color} type="button" role="radio" aria-checked={ink === index} aria-label={color} className={ink === index ? "is-on" : ""} style={{ background: color }} onClick={() => setInk(index)} />)}</div>
      <div className="draw-widths" role="radiogroup" aria-label={t("粗细", "Size", "Grosor")}>{WIDTHS.map((size, index) => <button key={size} type="button" role="radio" aria-checked={width === index} aria-label={String(index + 1)} className={width === index ? "is-on" : ""} onClick={() => setWidth(index)}><i style={{ width: 4 + index * 5, height: 4 + index * 5 }} /></button>)}</div>
      <button type="button" className="draw-tool" disabled={!strokes.length} onClick={() => setStrokes((current) => current.slice(0, -1))} aria-label={t("撤销", "Undo", "Deshacer")}><ArrowCounterClockwise size={18} /></button>
      <button type="button" className="draw-tool" disabled={!strokes.length} onClick={() => setStrokes([])} aria-label={t("清空", "Clear", "Borrar todo")}><Eraser size={18} /></button>
    </div>
    <div className="game-actions"><button type="button" className="game-primary" disabled={!strokes.length || busy} onClick={() => onDone(strokes)} data-testid="draw-done"><Check size={16} weight="bold" />{t("画好了，交给 TA 猜", "Done, pass it on", "Listo, pásalo")}</button></div>
  </div>;
}

/** 你画我猜: whoever draws sees the word and the pad; the other waits, then guesses with three tries. */
export function DrawGuess({ match, language, userId, partnerName, opponent, act, onRematch }: { match: MatchView<DrawState>; language: Language; userId: string; partnerName: string; opponent: Opponent; act: Act; onRematch: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const [guess, setGuess] = useState(""), [busy, setBusy] = useState(false), [ending, setEnding] = useState(false);
  const rounds = match.state.rounds, round = rounds.at(-1)!, previous = rounds.length > 1 ? rounds.at(-2)! : null;
  const drawing = round.drawer === userId, over = match.status !== "active";
  const word = (item: DrawRound) => item.word ? item.word[language] : "";
  const kinds: Record<string, string> = { animal: t("动物", "an animal", "un animal"), food: t("吃的喝的", "food or drink", "comida o bebida"), thing: t("东西", "a thing", "un objeto"), place: t("地方", "a place", "un lugar"), nature: t("大自然", "nature", "naturaleza"), travel: t("交通工具", "a way to travel", "un transporte") };
  const hint = t(`提示：${kinds[round.hint.category] || ""} · ${round.hint.length.zh} 个字`, `Hint: ${kinds[round.hint.category] || ""} · ${round.hint.length.en} letters`, `Pista: ${kinds[round.hint.category] || ""} · ${round.hint.length.es} letras`);
  const run = async (action: Record<string, unknown>) => { if (busy) return false; setBusy(true); const ok = await act(action); setBusy(false); return ok; };
  const send = async () => { const text = guess.trim(); if (!text) return; keyboard.hide(); if (await run({ type: "guess", text })) setGuess(""); };
  const left = 3 - round.guesses.length;
  const score = match.state.played ? t(`一起猜中 ${match.state.guessed || 0}/${match.state.played} 幅`, `Guessed ${match.state.guessed || 0} of ${match.state.played} together`, `Acertaron ${match.state.guessed || 0} de ${match.state.played}`) : "";
  return <div className="draw-guess">
    {score && <p className="game-stat is-center">{score}</p>}
    {previous && <article className="draw-last" data-testid="draw-last">
      {previous.strokes?.length ? <Picture strokes={previous.strokes} small label={t("上一幅画", "The last drawing", "El último dibujo")} /> : null}
      <div><small>{t("上一轮", "Last round", "Ronda anterior")}</small><b>{word(previous)}</b><span className={previous.outcome === "guessed" ? "is-hit" : ""}>{previous.outcome === "guessed" ? t("猜中了！", "Guessed it!", "¡Acertado!") : previous.outcome === "skipped" ? t(`${partnerName} 这次没画出来，换你画`, `${partnerName} couldn't draw this one; your turn`, `${partnerName} no pudo dibujarlo; te toca`) : t("这次没猜中", "Not this time", "Esta vez no")}</span></div>
    </article>}
    {over ? <div className="draw-over"><p className="gomoku-status">{t("这局结束了。", "This game is over.", "Esta partida terminó.")}</p><div className="game-actions"><button type="button" className="game-primary" onClick={onRematch} data-testid="game-rematch"><ArrowsClockwise size={16} />{t("再来一局", "Play again", "Otra partida")}</button></div></div>
      : drawing && !round.strokes ? <>
        <div className="draw-word" data-testid="draw-word"><small>{t("你要画的是", "Draw this", "Dibuja esto")}</small><b>{word(round)}</b><button type="button" className="game-quiet" disabled={busy} onClick={() => void run({ type: "swap" })} data-testid="draw-swap"><Shuffle size={15} />{t("换一个", "Another word", "Otra palabra")}</button></div>
        <Pad language={language} busy={busy} onDone={(strokes) => void run({ type: "draw", strokes })} />
        <p className="game-note">{t("不能写字哦，只能画。", "No writing, just drawing.", "Nada de letras, solo dibujo.")}</p>
      </>
      : drawing ? <>
        <p className="gomoku-status" role="status">{opponent.pet ? t(`${partnerName} 在猜…`, `${partnerName} is guessing…`, `${partnerName} está adivinando…`) : t(`等 ${partnerName} 猜…`, `Waiting for ${partnerName} to guess…`, `Esperando a que ${partnerName} adivine…`)}</p>
        <Picture strokes={round.strokes || []} label={t("你的画", "Your drawing", "Tu dibujo")} />
        <p className="draw-word is-quiet">{t("答案：", "Answer: ", "Respuesta: ")}<b>{word(round)}</b></p>
        {round.guesses.length > 0 && <ul className="draw-guesses is-wrong" data-testid="draw-their-guesses">{round.guesses.map((item) => <li key={item.at}>{item.text}？</li>)}</ul>}
      </>
      : !round.strokes ? <p className="gomoku-status" role="status" data-testid="draw-waiting">{opponent.picture && <img src={opponent.picture} alt="" className="draw-face" />}{opponent.pet ? t(`${partnerName} 正在画…`, `${partnerName} is drawing…`, `${partnerName} está dibujando…`) : t(`${partnerName} 正在画，画好了会提醒你。`, `${partnerName} is drawing. You'll be told when it's ready.`, `${partnerName} está dibujando. Te avisamos cuando esté listo.`)}</p>
      : <>
        <Picture strokes={round.strokes} replay={`${match.id}:${rounds.length}`} label={t(`${partnerName} 的画`, `${partnerName}'s drawing`, `El dibujo de ${partnerName}`)} />
        <p className="draw-hint">{hint}</p>
        {round.guesses.length > 0 && <ul className="draw-guesses is-wrong">{round.guesses.map((item) => <li key={item.at}>{item.text}</li>)}</ul>}
        <form className="draw-guess-form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <KeyboardInput value={guess} onChange={(event) => setGuess(event.target.value)} onBlur={() => keyboard.hide()} maxLength={40} placeholder={t("你猜是…", "I think it's…", "Creo que es…")} aria-label={t("你的答案", "Your guess", "Tu respuesta")} data-testid="draw-guess-input" />
          <button type="submit" className="game-primary" disabled={!guess.trim() || busy} aria-label={t("猜", "Guess", "Adivinar")} data-testid="draw-guess-send"><PaperPlaneRight size={16} weight="fill" /></button>
        </form>
        <p className="game-note">{t(`还有 ${left} 次机会`, `${left} ${left === 1 ? "guess" : "guesses"} left`, `Te quedan ${left} intentos`)}</p>
      </>}
    {!over && <div className="game-actions is-end"><button type="button" className={`game-quiet ${ending ? "is-confirm" : ""}`} onClick={() => { if (!ending) { setEnding(true); return; } setEnding(false); void run({ type: "end" }); }} onBlur={() => setEnding(false)} data-testid="draw-end"><StopCircle size={16} />{ending ? t("确定结束这局", "Really end this game", "Terminar de verdad") : t("结束这局", "End this game", "Terminar partida")}</button></div>}
  </div>;
}
