import { AnchorSimple, ArrowsDownUp, ArrowsLeftRight, Crosshair, Shuffle } from "@phosphor-icons/react";
import { useRef, useState, type CSSProperties } from "react";
import { localized } from "../../i18n";
import type { ScreenProps } from "./MatchScreen";
import "./battleship.css";

type Orientation = "row" | "column";
type FleetSide = "target" | "home";
type Place = { x: number; y: number; orientation: Orientation };
type Shot = { cell: number; hit: boolean; sunk: boolean };
type SeaState = {
  size: number;
  lengths: number[];
  fleet: Place[];
  revealedFleet: Place[] | null;
  ready: boolean;
  partnerReady: boolean;
  ownSunk: number;
  partnerSunk: number;
  sent: Shot[];
  received: Shot[];
  revision: number;
  shotCount: number;
  winner: string | null;
};

function positions(place: Place, length: number, size: number) {
  return Array.from({ length }, (_, offset) => place.orientation === "row"
    ? place.y * size + place.x + offset
    : (place.y + offset) * size + place.x);
}

const coordinate = (cell: number, size: number) => String.fromCharCode(65 + cell % size) + (Math.floor(cell / size) + 1);
const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function Battleship({ match, language, userId, partnerName, act, onRematch }: ScreenProps<SeaState>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const { state } = match;
  const { size, lengths } = state;
  const setup = !state.ready;
  const battle = state.ready && state.partnerReady;
  const finished = match.status === "finished";
  const myShot = match.turn === userId && battle && !finished;
  const [side, setSide] = useState<FleetSide>("target");
  const [choice, setChoice] = useState({ index: 0, orientation: null as Orientation | null });
  const [aim, setAim] = useState<{ cell: number; shotCount: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const ships = [
    t("巡洋舰", "Cruiser", "Crucero"),
    t("蓝艇", "Blue cutter", "Lancha azul"),
    t("金艇", "Gold cutter", "Lancha dorada"),
  ];
  const own = !battle || side === "home";
  const visibleShips = own ? state.fleet : state.revealedFleet;
  const hits = new Map((own ? state.received : state.sent).map((shot) => [shot.cell, shot]));
  const occupied = new Map(
    (visibleShips || []).flatMap((ship, index) => positions(ship, lengths[index], size).map((cell) => [cell, index] as const)),
  );
  const orientation = choice.orientation || state.fleet[choice.index].orientation;
  const target = myShot && aim?.shotCount === state.shotCount ? aim.cell : null;

  function canPlace(cell: number) {
    const x = cell % size, y = Math.floor(cell / size);
    const length = lengths[choice.index];
    if (x + (orientation === "row" ? length : 1) > size || y + (orientation === "column" ? length : 1) > size) return false;
    return positions({ x, y, orientation }, length, size).every((tile) =>
      !occupied.has(tile) || occupied.get(tile) === choice.index);
  }

  async function send(action: Record<string, unknown>) {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const okay = await act({ ...action, revision: state.revision, shotCount: state.shotCount });
      if (!okay) setFailed(true);
      return okay;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function moveShip(cell: number) {
    if (!setup || !canPlace(cell)) return;
    const moved = await send({ type: "place", index: choice.index, x: cell % size, y: Math.floor(cell / size), orientation });
    if (moved) setChoice({ index: choice.index, orientation: null });
  }

  async function shuffle() {
    if (await send({ type: "shuffle" })) setChoice({ index: 0, orientation: null });
  }

  async function fire() {
    if (target !== null && await send({ type: "fire", cell: target })) setAim(null);
  }

  const latestOwn = state.sent.at(-1);
  const latestPartner = state.received.at(-1);
  const lastWasMine = finished ? state.winner === userId : !myShot;
  const latest = lastWasMine ? latestOwn : latestPartner;
  const shooter = lastWasMine ? t("你的炮击", "Your shot", "Tu disparo") : t("对方炮击", "Incoming shot", "Disparo rival");
  const result = latest && (latest.sunk ? t("击沉一艘船", "Ship sunk", "Barco hundido") : latest.hit ? t("命中", "Hit", "Impacto") : t("落空", "Miss", "Agua"));
  const announcement = finished ? state.winner === userId
    ? t("你赢啦！", "You win!", "¡Ganaste!")
    : t(`${partnerName} 赢了！`, `${partnerName} wins!`, `¡${partnerName} ganó!`)
    : setup ? t("布置你的舰队", "Set up your fleet", "Coloca tu flota")
      : !battle ? t(`等 ${partnerName} 布置舰队`, `Waiting for ${partnerName} to set up`, `Esperando a que ${partnerName} coloque su flota`)
        : myShot ? t("轮到你开火", "Your turn to fire", "Te toca disparar")
          : t(`轮到 ${partnerName}`, `${partnerName}'s turn`, `Turno de ${partnerName}`);

  return <section className="sea-game" data-testid="battleship" aria-label={t("海战棋", "Battleship", "Batalla naval")}>
    <div className="sea-status" role="status">
      <strong>{announcement}</strong>
      {latest && result && <span>{shooter} · {coordinate(latest.cell, size)} · {result}</span>}
      {myShot && !latest && <span>{t("点坐标瞄准，再开火。", "Pick a square, then fire.", "Elige una casilla y dispara.")}</span>}
    </div>
    {battle ? <>
      <div className="sea-scores" aria-label={t("剩余船只", "Ships remaining", "Barcos restantes")}>
        <span>{t("你", "You", "Tú")}<b>{lengths.length - state.ownSunk}</b></span>
        <span>{partnerName}<b>{lengths.length - state.partnerSunk}</b></span>
      </div>
      <div className="sea-choice sea-duel-choice" role="group" aria-label={t("切换海域", "Choose a board", "Elige un tablero")}>
        <button type="button" aria-pressed={!own} onClick={() => setSide("target")}><Crosshair size={18} />
          {finished ? t("对方的舰队", "Their fleet", "Su flota") : t("瞄准海域", "Target waters", "Zona de ataque")}</button>
        <button type="button" aria-pressed={own} onClick={() => setSide("home")}><AnchorSimple size={18} />{t("你的舰队", "Your fleet", "Tu flota")}</button>
      </div>
    </> : setup ? <>
      <p className="sea-help">{t("点一艘船选中它，再点海面挪位置。只有你看得见自己的船。", "Choose a ship and tap the water to move it. Your fleet is private.", "Elige un barco y toca el agua para moverlo. Tu flota es privada.")}</p>
      <div className="sea-choice sea-ship-choice" role="group" aria-label={t("选船", "Choose a ship", "Elige un barco")}>
        {ships.map((ship, index) => <button key={ship} type="button" aria-pressed={choice.index === index} data-ship={index}
          disabled={busy} onClick={() => setChoice({ index, orientation: null })}><i aria-hidden="true" />{ship}<b>{lengths[index]}</b></button>)}
      </div>
      <div className="sea-orientation">
        <button type="button" className="game-quiet" disabled={busy} onClick={() =>
          setChoice({ ...choice, orientation: orientation === "row" ? "column" : "row" })}>
          {orientation === "row" ? <ArrowsLeftRight size={18} /> : <ArrowsDownUp size={18} />}
          {orientation === "row" ? t("横向放置", "Place across", "Colocar en horizontal")
            : t("纵向放置", "Place down", "Colocar en vertical")}
        </button>
      </div>
    </> : <p className="sea-help">{t("你的舰队已就位。两人都准备好就开始。", "Your fleet is ready. The battle starts when both of you are ready.", "Tu flota está lista. La batalla empieza cuando ambos estén listos.")}</p>}

    <div className="sea-board" style={{ "--sea-size": size } as CSSProperties} role="group"
      aria-label={own ? t("你的舰队棋盘", "Your fleet board", "Tablero de tu flota") : t("对方的海域", "Target board", "Tablero de ataque")}
      data-testid="battleship-board">
      <span aria-hidden="true" />
      {Array.from({ length: size }, (_, column) => <span className="sea-axis" key={letters[column]} aria-hidden="true">{letters[column]}</span>)}
      {Array.from({ length: size }, (_, row) => <div className="sea-row" key={row}>
        <span className="sea-axis" aria-hidden="true">{row + 1}</span>
        {Array.from({ length: size }, (_, column) => {
          const cell = row * size + column;
          const shot = hits.get(cell);
          const ship = occupied.get(cell);
          const entry = ship === undefined ? "" : " · " + ships[ship];
          const status = !shot ? "" : shot.hit ? t(" · 命中", " · Hit", " · Impacto") : t(" · 落空", " · Miss", " · Agua");
          const enabled = setup ? canPlace(cell) : myShot && !own && !shot;
          return <button type="button" key={cell} className="sea-cell" data-testid={`battleship-cell-${cell}`}
            aria-label={coordinate(cell, size) + entry + status}
            aria-pressed={!own && !shot ? target === cell : undefined}
            data-ship={ship} data-shot={shot ? shot.hit ? "hit" : "miss" : undefined}
            data-target={target === cell && !own || undefined} disabled={busy || !enabled}
            onClick={() => setup ? void moveShip(cell) : setAim({ cell, shotCount: state.shotCount })}>
            {shot ? <span aria-hidden="true">{shot.hit ? "×" : "•"}</span> : ship !== undefined && <i aria-hidden="true" />}
          </button>;
        })}
      </div>)}
    </div>

    {battle && <p className="sea-key">
      <span><i data-shot="hit" aria-hidden="true">×</i>{t("命中", "Hit", "Impacto")}</span>
      <span><i data-shot="miss" aria-hidden="true">•</i>{t("落空", "Miss", "Agua")}</span>
    </p>}
    {failed && <p className="sea-help" role="alert">{t("这一步没有完成，请再试一次。", "That move didn't go through. Try again.", "El movimiento no se completó. Inténtalo de nuevo.")}</p>}
    {setup ? <div className="sea-actions">
      <button type="button" className="game-quiet" disabled={busy} onClick={() => void shuffle()}><Shuffle size={18} />{t("随机布阵", "Shuffle fleet", "Mezclar flota")}</button>
      <button type="button" className="game-primary" disabled={busy} onClick={() => void send({ type: "lock" })}>{t("舰队就位", "Fleet ready", "Flota lista")}</button>
    </div> : finished ? <button type="button" className="game-primary" onClick={onRematch}>{t("再来一局", "Play again", "Otra partida")}</button>
      : myShot && !own && <button type="button" className="game-primary" disabled={busy || target === null} onClick={() => void fire()}>
        <Crosshair size={18} />{target === null ? t("开火", "Fire", "Disparar")
          : t(`开火 · ${coordinate(target, size)}`, `Fire · ${coordinate(target, size)}`, `Disparar · ${coordinate(target, size)}`)}
      </button>}
  </section>;
}
