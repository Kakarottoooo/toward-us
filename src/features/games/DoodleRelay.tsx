import { useRef, useState } from "react";
import { ArrowsClockwise, PaperPlaneRight, Shuffle, StopCircle } from "@phosphor-icons/react";
import { localized } from "../../i18n";
import { Drawing, Sketch, type Stroke } from "./PlayDrawing";
import type { ScreenProps } from "./MatchScreen";
import "./doodle-relay.css";

type RelayState = {
  prompt: { zh: string; en: string; es: string };
  half: "top" | "bottom";
  top: Stroke[] | null;
  bottom: Stroke[] | null;
  joins: number[];
};

function readDraft(key: string): Stroke[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function DoodleRelay({ match, language, userId, partnerName, act, onRematch }: ScreenProps<RelayState>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const { prompt, half, top, bottom, joins } = match.state;
  const promptText = t(prompt.zh, prompt.en, prompt.es);
  const ownHalf = half === "top" ? top : bottom;
  const draftKey = `pinky-doodle-draft:${userId}:${match.id}:${half}`;
  const [strokes, setStrokes] = useState(() => readDraft(draftKey));
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const pending = useRef(false);

  const change = (next: Stroke[]) => {
    setStrokes(next);
    try {
      if (next.length) sessionStorage.setItem(draftKey, JSON.stringify(next));
      else sessionStorage.removeItem(draftKey);
    } catch {
      // Drawing remains available while this card stays open.
    }
  };
  const run = async (action: Record<string, unknown>) => {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    try {
      return await act(action);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const complete = Boolean(top && bottom);
  const canDraw = match.status === "active" && match.turn === userId;
  const sectionTitle = half === "top"
    ? t("画上半身", "Draw the top half", "Dibuja la mitad de arriba")
    : t("画下半身", "Draw the bottom half", "Dibuja la mitad de abajo");
  const seamHint = half === "top"
    ? t("可以把线画到下边缘，让 TA 接着画。", "Draw to the bottom edge to give them a place to start.", "Lleva el trazo al borde inferior para que tu pareja pueda continuarlo.")
    : joins.length
      ? t("沿上边缘的接缝点接着画。", "Continue from the dots along the top edge.", "Continúa desde los puntos del borde superior.")
      : t("从上边缘自由接着画。", "Start anywhere along the top edge.", "Empieza donde quieras junto al borde superior.");

  return <section className="doodle-relay" data-testid="doodle-relay">
    <header className="doodle-relay-prompt">
      <small>{t("本轮主题", "Drawing prompt", "Tema del dibujo")}</small>
      <strong>{promptText}</strong>
    </header>
    {complete && top && bottom ? <>
      <h3>{t("你们一起画好了！", "You made this together!", "¡Lo dibujaron juntos!")}</h3>
      <div className="doodle-relay-result" data-testid="doodle-relay-result">
        <Sketch strokes={top} label={t("完成的上半身", "Finished top half", "Mitad superior terminada")} />
        <Sketch strokes={bottom} label={t("完成的下半身", "Finished bottom half", "Mitad inferior terminada")} />
      </div>
      <div className="game-actions">
        <button type="button" className="game-primary" onClick={onRematch} data-testid="doodle-rematch">
          <ArrowsClockwise size={16} />{t("再画一张", "Draw another", "Dibujar otro")}
        </button>
      </div>
    </> : canDraw ? <>
      <div className="doodle-relay-instructions"><h3>{sectionTitle}</h3><p>{seamHint}</p></div>
      <div className="doodle-relay-pad">
        <Drawing strokes={strokes} onChange={change} disabled={busy} language={language} />
        {half === "bottom" && joins.length > 0 && <div className="doodle-relay-joins" aria-hidden="true">
          {joins.map((point) => <i key={point} style={{ left: `${point / 255 * 100}%` }} />)}
        </div>}
      </div>
      <div className="game-actions doodle-relay-act">
        {half === "top" && !strokes.length && <button type="button" className="game-quiet" disabled={busy}
          onClick={() => void run({ type: "swap" })} data-testid="doodle-swap">
          <Shuffle size={16} />{t("换个主题", "New prompt", "Cambiar tema")}
        </button>}
        <button type="button" className="game-primary" disabled={busy || !strokes.length}
          onClick={() => void run({ type: "draw", strokes }).then((ok) => { if (ok) change([]); })} data-testid="doodle-send">
          <PaperPlaneRight size={16} weight="fill" />
          {half === "top" ? t("交给 TA 接着画", "Pass it on", "Pasar el dibujo") : t("拼成整张画", "Reveal the drawing", "Revelar el dibujo")}
        </button>
      </div>
    </> : <>
      <p className="doodle-relay-wait" role="status" data-testid="doodle-wait">
        {half === "top"
          ? t(`等 ${partnerName} 画完下半身。`, `Waiting for ${partnerName} to draw the bottom half.`, `Esperando a que ${partnerName} dibuje la mitad de abajo.`)
          : t(`等 ${partnerName} 画完上半身。`, `Waiting for ${partnerName} to draw the top half.`, `Esperando a que ${partnerName} dibuje la mitad de arriba.`)}
      </p>
      {ownHalf && <Sketch strokes={ownHalf} label={t("你画的这一半", "The half you drew", "La mitad que dibujaste")} />}
    </>}
    {match.status === "active" && <div className="game-actions is-end">
      <button type="button" className={`game-quiet${confirmEnd ? " is-confirm" : ""}`} disabled={busy}
        onClick={() => { if (confirmEnd) { void run({ type: "abandon" }); setConfirmEnd(false); } else setConfirmEnd(true); }}
        onBlur={() => setConfirmEnd(false)}>
        <StopCircle size={16} />{confirmEnd ? t("确定结束？", "End it?", "¿Terminar?") : t("结束这局", "End game", "Terminar partida")}
      </button>
    </div>}
  </section>;
}
