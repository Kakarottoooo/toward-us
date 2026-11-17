import { ArrowClockwise, ArrowCounterClockwise, DoorOpen, Lightbulb, LockKey, LockKeyOpen } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { localized, type Language } from "../../i18n";
import type { ScreenProps } from "./MatchScreen";
import "./escape-room.css";

const symbols = {
  star: ["✦", "星星", "Star", "Estrella"],
  leaf: ["❧", "叶子", "Leaf", "Hoja"],
  moon: ["☾", "月亮", "Moon", "Luna"],
  sun: ["☀", "太阳", "Sun", "Sol"],
  wave: ["≋", "波浪", "Waves", "Olas"],
  heart: ["♥", "爱心", "Heart", "Corazón"],
  rain: ["⋮", "雨滴", "Rain", "Lluvia"],
} as const;

const directions = {
  up: ["↑", "上", "Up", "Arriba"],
  down: ["↓", "下", "Down", "Abajo"],
  left: ["←", "左", "Left", "Izquierda"],
  right: ["→", "右", "Right", "Derecha"],
} as const;

type SymbolKey = keyof typeof symbols;
type Direction = keyof typeof directions;
type Copy = Record<Language, string>;
type Translate = (zh: string, en: string, es: string) => string;
type EscapeView = {
  name: Copy; goal: Copy; theme: string; cleared: number; total: number; hintsUsed: number;
  current: {
    kind: "sequence" | "dials" | "route"; title: Copy; misses: number;
    panel: { length: number; symbols?: SymbolKey[]; start?: number; exit?: number } | null;
    guide: { instructions: Copy; symbols?: SymbolKey[]; legend?: { symbol: SymbolKey; number: number }[]; tiles?: number[] } | null;
    hint: { symbol?: SymbolKey; number?: number; direction?: Direction } | null;
  } | null;
};

const symbolLabel = (t: Translate, key: SymbolKey) => t(symbols[key][1], symbols[key][2], symbols[key][3]);
const directionLabel = (t: Translate, key: Direction) => t(directions[key][1], directions[key][2], directions[key][3]);

function destination(cell: number, direction: Direction) {
  if (direction === "left") return cell % 4 === 0 ? null : cell - 1;
  if (direction === "right") return cell % 4 === 3 ? null : cell + 1;
  if (direction === "up") return cell < 4 ? null : cell - 4;
  return cell >= 12 ? null : cell + 4;
}

function routeDirections(tiles: number[]) {
  return tiles.slice(1).map((tile, index) => {
    const step = tile - tiles[index];
    return (step === -4 ? "up" : step === 4 ? "down" : step === -1 ? "left" : "right") as Direction;
  });
}

function RouteBoard({ t, tiles, exit, guide = false }: { t: Translate; tiles: number[]; exit: number; guide?: boolean }) {
  return <div className="escape-route-map" role="img" aria-label={guide
    ? t("路线", "Route", "Ruta") + ": " + routeDirections(tiles).map((step) => directionLabel(t, step)).join(", ")
    : t("路线面板", "Route panel", "Panel de ruta")}>
    {Array.from({ length: 16 }, (_, tile) => {
      const step = tiles.indexOf(tile), isLast = tile === tiles.at(-1), isExit = tile === exit;
      return <span key={tile} className={step >= 0 ? "is-route" : isExit ? "is-exit" : undefined} aria-hidden="true">
        {step >= 0 ? isLast && !guide ? "●" : step : isExit ? "◇" : ""}
      </span>;
    })}
  </div>;
}

function Stage({ current, stage, t, language, busy, play }: {
  current: NonNullable<EscapeView["current"]>;
  stage: number; t: Translate; language: Language; busy: boolean;
  play: (action: Record<string, unknown>) => Promise<boolean | undefined>;
}) {
  const { panel, guide, kind, hint } = current;
  const [sequence, setSequence] = useState<SymbolKey[]>([]);
  const [dials, setDials] = useState([0, 0, 0]);
  const [moves, setMoves] = useState<Direction[]>([]);
  const tiles = moves.reduce<number[]>((path, move) => [...path, destination(path.at(-1)!, move)!], [panel?.start ?? 0]);
  const values = kind === "sequence" ? sequence : kind === "dials" ? dials : moves;
  const removeLast = () => kind === "route"
    ? setMoves((currentMoves) => currentMoves.slice(0, -1))
    : setSequence((currentSequence) => currentSequence.slice(0, -1));
  const adjust = (slot: number, change: number) => setDials((previous) => previous.map((value, index) => index === slot ? value + change : value));
  const first = hint?.symbol
    ? hint.number === undefined ? symbolLabel(t, hint.symbol) : `${symbolLabel(t, hint.symbol)} · ${hint.number}`
    : hint?.direction ? directionLabel(t, hint.direction) : "";

  return <article className="escape-stage" data-testid={panel ? "escape-panel" : "escape-guide"}>
    <div className="escape-stage-head">
      <small>{panel ? t("你操作", "You operate", "Tú manejas el panel") : t("你读线索", "You read the clue", "Tú lees la pista")}</small>
      <h3>{current.title[language]}</h3>
    </div>
    {guide && <>
      <p>{guide.instructions[language]}</p>
      {guide.symbols && <ol className="escape-strip" data-testid="escape-sequence-clue">{guide.symbols.map((key, index) =>
        <li key={index}><span aria-hidden="true">{symbols[key][0]}</span><small>{symbolLabel(t, key)}</small></li>)}</ol>}
      {guide.legend && <ul className="escape-strip" data-testid="escape-dials-clue">{guide.legend.map(({ symbol, number }) =>
        <li key={symbol}><span><span aria-hidden="true">{symbols[symbol][0]} </span><b>{number}</b></span><small>{symbolLabel(t, symbol)}</small></li>)}</ul>}
      {guide.tiles && <RouteBoard guide t={t} tiles={guide.tiles} exit={guide.tiles.at(-1)!} />}
    </>}
    {panel && <>
      {kind === "sequence" && <>
        <p>{t("问 TA 灯的顺序，再依次按键。", "Ask your partner for the order, then tap the buttons.", "Pídele el orden a tu pareja y pulsa los botones.")}</p>
        <div className="escape-input-slots" aria-label={t("已按的顺序", "Buttons pressed", "Botones pulsados")}>
          {Array.from({ length: panel.length }, (_, index) => {
            const symbol = sequence[index];
            return <span key={index} aria-label={symbol ? symbolLabel(t, symbol) : t("空位", "Empty slot", "Espacio vacío")}>{symbol ? symbols[symbol][0] : "·"}</span>;
          })}
        </div>
        <div className="escape-keys">
          {panel.symbols?.map((key) => <button className="escape-key" key={key} type="button" aria-label={symbolLabel(t, key)}
            disabled={busy || sequence.length >= panel.length} onClick={() => setSequence((currentSequence) => [...currentSequence, key])} data-testid={`escape-key-${key}`}>
            <span aria-hidden="true">{symbols[key][0]}</span><small>{symbolLabel(t, key)}</small>
          </button>)}
        </div>
      </>}
      {kind === "dials" && <>
        <p>{t("向 TA 问每个标志的数字，再调好三个旋钮。", "Ask for the number that goes with each symbol, then set the three dials.", "Pregunta qué número corresponde a cada símbolo y ajusta las tres ruedas.")}</p>
        <div className="escape-dials">
          {panel.symbols?.map((key, index) => {
            const name = symbolLabel(t, key);
            return <div className="escape-dial" key={key}>
              <span className="escape-dial-symbol"><span aria-hidden="true">{symbols[key][0]}</span> {name}</span>
              <button type="button" aria-label={t(`调高${name}`, `Raise ${name}`, `Subir ${name}`)} data-testid={`escape-dial-plus-${index}`}
                disabled={busy || dials[index] === 5} onClick={() => adjust(index, 1)}>+</button>
              <output aria-label={name}>{dials[index]}</output>
              <button type="button" aria-label={t(`调低${name}`, `Lower ${name}`, `Bajar ${name}`)} data-testid={`escape-dial-minus-${index}`}
                disabled={busy || dials[index] === 0} onClick={() => adjust(index, -1)}>−</button>
            </div>;
          })}
        </div>
      </>}
      {kind === "route" && <>
        <p>{t("按 TA 报出的方向移动。空心菱形是出口。", "Enter the directions your partner calls out. The diamond marks the exit.", "Introduce las direcciones que te indica tu pareja. El rombo marca la salida.")}</p>
        <RouteBoard t={t} tiles={tiles} exit={panel.exit!} />
        <div className="escape-route-inputs">{(Object.keys(directions) as Direction[]).map((direction) =>
          <button key={direction} type="button" aria-label={directionLabel(t, direction)} data-testid={`escape-direction-${direction}`}
            disabled={busy || moves.length >= panel.length || destination(tiles.at(-1)!, direction) === null}
            onClick={() => setMoves((currentMoves) => [...currentMoves, direction])}>{directions[direction][0]}</button>)}
        </div>
      </>}
      <div className="escape-actions">
        <button className="game-primary" type="button" disabled={busy || values.length !== panel.length}
          onClick={() => void play({ type: "submit", stage, values })} data-testid="escape-submit"><LockKeyOpen size={19} aria-hidden="true" />
          {t("试着打开", "Try the lock", "Probar el cierre")}</button>
        {kind !== "dials" && <button className="game-quiet" type="button" disabled={busy || values.length === 0} onClick={removeLast}>
          <ArrowCounterClockwise size={16} aria-hidden="true" />{t("撤销一步", "Undo", "Deshacer")}</button>}
      </div>
    </>}
    {current.misses > 0 && <p className="escape-feedback" role="status">
      {t("还没打开，核对一下刚才的线索。", "Still locked. Compare the clue with what you entered.", "Sigue cerrado. Comparen la pista con lo que ingresaron.")}
    </p>}
    {hint ? <p className="escape-tip" role="status"><Lightbulb size={17} aria-hidden="true" /><span>{t("第一步", "First step", "Primer paso")} <b>{first}</b></span></p>
      : <button type="button" className="game-quiet escape-hint" disabled={busy} data-testid="escape-hint" onClick={() => void play({ type: "hint", stage })}>
        <Lightbulb size={16} aria-hidden="true" />{t("提示第一步", "Hint for step one", "Pista para el primer paso")}
      </button>}
  </article>;
}

export function EscapeRoom({ match, language, act, onRematch }: ScreenProps<EscapeView>) {
  const t: Translate = (zh, en, es) => localized(language, zh, en, es);
  const { state } = match;
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const sending = useRef(false);

  async function play(action: Record<string, unknown>) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try { return await act(action); }
    finally { sending.current = false; setBusy(false); }
  }

  return <section className="escape-room" data-testid="escape-room" data-theme={state.theme}>
    <header className="escape-hero">
      <DoorOpen size={34} aria-hidden="true" weight="duotone" />
      <div><strong>{state.name[language]}</strong><p>{state.goal[language]}</p></div>
    </header>
    <div className="escape-progress" aria-label={t(`已解开 ${state.cleared}/${state.total} 道机关`, `${state.cleared} of ${state.total} locks opened`, `${state.cleared} de ${state.total} mecanismos abiertos`)}>
      {Array.from({ length: state.total }, (_, index) => index < state.cleared
        ? <LockKeyOpen key={index} size={17} weight="fill" aria-hidden="true" />
        : <LockKey key={index} size={17} weight={index === state.cleared ? "fill" : "regular"} aria-hidden="true" />)}
      <span aria-hidden="true">{state.cleared}/{state.total}</span>
    </div>
    {state.current ? <>
      <Stage key={`${state.cleared}:${state.current.kind === "dials" ? 0 : state.current.misses}`} current={state.current} stage={state.cleared} language={language} t={t} busy={busy} play={play} />
      <button type="button" className="game-quiet escape-end" disabled={busy} onBlur={() => setConfirmEnd(false)}
        onClick={() => {
          if (confirmEnd) { setConfirmEnd(false); void play({ type: "abandon" }); }
          else setConfirmEnd(true);
        }}>{confirmEnd ? t("确认结束", "Confirm ending", "Confirmar fin") : t("结束这局", "End game", "Terminar partida")}</button>
    </> : <div className="escape-win" role="status" data-testid="escape-result">
      <LockKeyOpen size={32} weight="duotone" aria-hidden="true" />
      <strong>{t("你们一起逃出来了！", "You escaped together!", "¡Escaparon juntos!")}</strong>
      <span>{t(`使用了 ${state.hintsUsed} 个提示`, `Hints used: ${state.hintsUsed}`, `Pistas usadas: ${state.hintsUsed}`)}</span>
      <button type="button" className="game-primary" onClick={onRematch}><ArrowClockwise size={18} aria-hidden="true" />{t("下一间密室", "Next room", "Siguiente sala")}</button>
    </div>}
  </section>;
}
