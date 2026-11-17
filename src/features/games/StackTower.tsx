import { ArrowClockwise, Crosshair, HandTap, Stack, Wind } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { localized } from "../../i18n";
import type { ScreenProps } from "./MatchScreen";
import "./two-player-arcade.css";

type Piece = { center: number; width: number; bias: number };
type TowerState = { blocks: Piece[]; floor: Piece; margin: number | null; next: { width: number; bias: number; wind: number } | null; goal: number; revision: number; fallen: Piece | null };
const COLORS = ["#dc7660", "#e8b957", "#81a385", "#7995b6", "#bd87a1", "#a37c61"];
const MAX_VISIBLE = 9;

function blockStyle(piece: Piece, level: number, bottom: number): CSSProperties {
  return { left: `${piece.center - piece.width / 2}%`, width: `${piece.width}%`, bottom: `${bottom}%`, background: COLORS[level % COLORS.length] };
}

export function StackTower({ match, language, userId, partnerName, act, onRematch, visible = true }: ScreenProps<TowerState>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const { blocks, floor, margin, next, goal, fallen, revision } = match.state;
  const mine = match.turn === userId && match.status === "active";
  const [aim, setAim] = useState<{ center: number; revision: number } | null>(null);
  const [swing, setSwing] = useState(false), [busy, setBusy] = useState(false);
  const pending = useRef(false), currentPosition = useRef(50);
  const minimum = Math.ceil((next?.width || 0) / 2), maximum = 100 - minimum;
  const top = blocks.at(-1) || floor;
  const center = aim?.revision === revision ? aim.center : Math.min(maximum, Math.max(minimum, Math.round(top.center)));
  const firstVisible = Math.max(0, blocks.length - MAX_VISIBLE);
  const visibleBlocks = blocks.slice(firstVisible);
  const levelY = 10 + visibleBlocks.length * 7.6;
  const landed = margin === null ? null : margin >= 7 ? t("很稳", "Steady", "Estable") : margin >= 2 ? t("有点晃", "Wobbly", "Tambalea") : t("快撑不住了", "On the edge", "Al límite");

  function pick(value: number) {
    const selected = Math.max(minimum, Math.min(maximum, Math.round(value)));
    currentPosition.current = selected;
    setAim({ center: selected, revision });
  }

  useEffect(() => {
    if (!swing || !mine || !visible) return;
    const start = performance.now();
    const speed = 0.003 + blocks.length * 0.00020;
    const stop = () => { if (document.hidden) setSwing(false); };
    let frame = 0;
    function animate(now: number) {
      const value = Math.round(50 + Math.cos((now - start) * speed) * Math.min(27, maximum - 50));
      if (value !== currentPosition.current) {
        currentPosition.current = value;
        setAim({ center: value, revision });
      }
      if (!document.hidden) frame = requestAnimationFrame(animate);
    }
    if (!document.hidden) frame = requestAnimationFrame(animate);
    document.addEventListener("visibilitychange", stop);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("visibilitychange", stop); };
  }, [blocks.length, maximum, mine, revision, swing, visible]);

  async function drop() {
    if (pending.current || !mine) return;
    pending.current = true;
    setBusy(true);
    setSwing(false);
    try { await act({ type: "drop", center: swing ? currentPosition.current : center, revision }); }
    finally { pending.current = false; setBusy(false); }
  }

  function aimAt(event: MouseEvent<HTMLButtonElement>) {
    setSwing(false);
    if (!event.detail) { pick(top.center); return; }
    const area = event.currentTarget.getBoundingClientRect();
    pick((event.clientX - area.left) * 100 / area.width);
  }

  return <section className="arcade-game tower-game" data-testid="stack-tower">
    <header className="arcade-heading"><div><span><Stack size={16} weight="fill" />{t("一起往上搭", "Build it together", "Construyan juntos")}</span><strong>{t(`${blocks.length} / ${goal} 层`, `${blocks.length} of ${goal} levels`, `${blocks.length} de ${goal} pisos`)}</strong></div>{landed && !fallen && <span className={`tower-stability${margin! < 7 ? " is-wobbly" : ""}`} role="status">{landed}</span>}</header>
    <div className={`tower-board${fallen ? " is-fallen" : ""}`}>
      <div className="tower-landscape" aria-hidden="true">
        <i className="tower-rail" />
        <i className="tower-base" style={{ left: `${floor.center - floor.width / 2}%`, width: `${floor.width}%` }} />
        {firstVisible > 0 && <span className="tower-tail">+{firstVisible}</span>}
        {visibleBlocks.map((piece, index) => <i key={firstVisible + index} className="tower-piece" style={blockStyle(piece, firstVisible + index, 10 + index * 7.6)}>
          <b style={{ left: `${50 + piece.bias * 100 / piece.width}%` }} />
        </i>)}
        {next && mine && <>
          <i className="tower-drop-line" style={{ left: `${center}%`, bottom: `${levelY + 6.5}%` }} />
          <i className="tower-piece tower-preview" style={blockStyle({ ...next, center }, blocks.length, levelY)}>
            <b style={{ left: `${50 + next.bias * 100 / next.width}%` }} /></i>
        </>}
        {fallen && <i className="tower-piece tower-fallen" style={blockStyle(fallen, blocks.length, levelY)} />}
      </div>
      {mine && <button type="button" className="golf-aim-plane" onClick={aimAt} disabled={busy}
        aria-label={t("点一下选择放积木的位置", "Tap to position the block", "Toca para colocar el bloque")} />}
    </div>
    {mine && next && <>
      <div className="tower-hints">
        <span><Crosshair size={17} />{next.bias < 0 ? t("这块左边重", "Heavy on the left", "Pesa más a la izquierda") : next.bias > 0 ? t("这块右边重", "Heavy on the right", "Pesa más a la derecha") : t("重量居中", "Even weight", "Peso equilibrado")}</span>
        {next.wind !== 0 && <span><Wind size={17} />{next.wind > 0 ? t("风往右吹", "Wind pushes right", "El viento va a la derecha") : t("风往左吹", "Wind pushes left", "El viento va a la izquierda")}</span>}
      </div>
      <label className="tower-position">{t("左右移动积木", "Move the block left or right", "Mueve el bloque hacia un lado")}
        <input type="range" min={minimum} max={maximum} value={center} disabled={busy} data-scroll-drag="ignore" data-testid="tower-position"
          onChange={(event) => { setSwing(false); pick(Number(event.currentTarget.value)); }} />
      </label>
      <div className="tower-actions"><button type="button" className="game-primary" disabled={busy} onClick={() => void drop()} data-testid="tower-drop"><HandTap size={19} />{t("放下积木", "Drop block", "Suelta el bloque")}</button>
        <button type="button" className="game-quiet" disabled={busy} onClick={() => { currentPosition.current = center; setSwing(!swing); }}>
          {swing ? t("停止摆动", "Stop sway", "Detén el vaivén") : t("摆动挑战", "Sway challenge", "Reto de vaivén")}
        </button></div>
    </>}
    {!mine && match.status === "active" && <p className="arcade-instruction" role="status">{t(`等 ${partnerName} 放下一块。`, `Waiting for ${partnerName} to place a block.`, `Esperando a que ${partnerName} coloque un bloque.`)}</p>}
    {match.status === "finished" && <div className="arcade-result" role="status" data-testid="tower-result">
      <strong>{fallen ? t("塔倒啦！", "Timber!", "¡Se cayó!") : t("你们搭到顶了！", "You built it together!", "¡Llegaron a la cima!")}</strong>
      <span>{fallen ? t(`你们稳稳搭了 ${blocks.length} 层。`, `You built ${blocks.length} stable levels.`, `Construyeron ${blocks.length} pisos estables.`) : t(`一起完成了 ${goal} 层。`, `${goal} levels together.`, `Construyeron ${goal} pisos juntos.`)}</span>
      <button type="button" className="game-primary" onClick={onRematch} data-testid="tower-rematch"><ArrowClockwise size={18} />{t("再搭一次", "Build again", "Vuelvan a construir")}</button>
    </div>}
  </section>;
}
