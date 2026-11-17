import { Armchair, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Door, DoorOpen, PersonSimple } from "@phosphor-icons/react";
import { useRef, useState, type CSSProperties } from "react";
import { localized } from "../../i18n";
import type { ScreenProps } from "./MatchScreen";
import "./sokoban.css";

type Direction = "up" | "down" | "left" | "right";
type MovingDay = {
  room: number;
  players: string[];
  positions: number[];
  crates: number[];
  activeMover: number;
  remaining: number;
  moves: number;
  revision: number;
  width: number;
  size: number;
  walls: number[];
  doors: number[];
  plates: number[];
  goals: number[];
  legal: Direction[];
  doorOpen: boolean;
};

const rooms: ReadonlyArray<readonly [string, string, string]> = [
  ["第一间新家", "The first apartment", "El primer apartamento"],
  ["餐厅和客厅", "Room for two", "Espacio para dos"],
  ["楼上楼下", "Upstairs, downstairs", "Arriba y abajo"],
] as const;

const arrows = [
  { direction: "left", Icon: ArrowLeft, label: ["向左", "Left", "Izquierda"] },
  { direction: "up", Icon: ArrowUp, label: ["向上", "Up", "Arriba"] },
  { direction: "down", Icon: ArrowDown, label: ["向下", "Down", "Abajo"] },
  { direction: "right", Icon: ArrowRight, label: ["向右", "Right", "Derecha"] },
] as const;

export function Sokoban({ match, language, userId, partnerName, act, onRematch }: ScreenProps<MovingDay>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const board = match.state;
  const complete = match.status === "finished";
  const mine = match.turn === userId && !complete;
  const parked = board.crates.filter((cell) => board.goals.includes(cell)).length;
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [confirm, setConfirm] = useState<"reset" | "abandon" | null>(null);
  const [failed, setFailed] = useState(false);
  const self = board.players.indexOf(userId);
  const names = board.players.map((player) => player === userId ? t("你", "You", "Tú") : partnerName);
  const coordinate = (cell: number) => String.fromCharCode(65 + cell % board.width) + (Math.floor(cell / board.width) + 1);
  const listing = (cells: number[]) => cells.map(coordinate).join(", ");

  async function send(type: string, direction?: Direction) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    try {
      if (await act({ type, direction, revision: board.revision })) setConfirm(null);
      else setFailed(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function press(direction: Direction) {
    if (!mine || !board.legal.includes(direction)) return;
    void send("move", direction);
  }

  const goalLabel = t("目标格", "Destination", "Destino");
  const plateLabel = t("开门地砖", "Door switch", "Placa de la puerta");
  const openLabel = board.doorOpen ? t("门已开", "Door open", "Puerta abierta") : t("门关着", "Door closed", "Puerta cerrada");

  return <section className="sokoban" data-testid="sokoban" aria-label={t("双人推箱子", "Together We Move", "Mudanza en pareja")}>
    <header className="sokoban-header">
      <strong>{t(...rooms[board.room])}</strong>
      <span className="sokoban-progress" aria-label={t(`已摆好 ${parked} 件，共 ${board.crates.length} 件`, `${parked} of ${board.crates.length} chairs placed`, `${parked} de ${board.crates.length} sillones colocados`)}>
        <Armchair size={18} aria-hidden="true" />{parked}/{board.crates.length}
      </span>
    </header>
    <div className="sokoban-board" data-testid="sokoban-board" role="img" style={{ "--move-columns": board.width } as CSSProperties}
      aria-label={t(`${names[0]}在 ${coordinate(board.positions[0])}，${names[1]}在 ${coordinate(board.positions[1])}。家具 ${listing(board.crates)}，目标格 ${listing(board.goals)}，开门地砖 ${listing(board.plates)}，${openLabel}。`,
        `${names[0]} at ${coordinate(board.positions[0])}, ${names[1]} at ${coordinate(board.positions[1])}. Chairs at ${listing(board.crates)}, destinations at ${listing(board.goals)}, switches at ${listing(board.plates)}. ${openLabel}.`,
        `${names[0]} en ${coordinate(board.positions[0])}, ${names[1]} en ${coordinate(board.positions[1])}. Sillones en ${listing(board.crates)}, destinos en ${listing(board.goals)}, placas en ${listing(board.plates)}. ${openLabel}.`)}>
      {Array.from({ length: board.size }, (_, cell) => {
        const wall = board.walls.includes(cell), crate = board.crates.includes(cell), goal = board.goals.includes(cell);
        const door = board.doors.includes(cell), plate = board.plates.includes(cell), mover = board.positions.indexOf(cell);
        return <div key={cell} className="sokoban-tile" data-wall={wall || undefined} data-door={door ? board.doorOpen ? "open" : "closed" : undefined}
          data-goal={goal || undefined} data-plate={plate || undefined} data-crate={crate || undefined} aria-hidden="true">
          {goal && !crate && <span className="sokoban-goal" />}
          {plate && <span className="sokoban-plate" />}
          {door && !crate && mover === -1 && (board.doorOpen ? <DoorOpen size="63%" weight="duotone" /> : <Door size="63%" weight="fill" />)}
          {crate && <span className="sokoban-chair"><Armchair size="78%" weight="fill" />{goal && <Check size="36%" weight="bold" />}</span>}
          {mover !== -1 && <span className="sokoban-person" data-mover={mover} data-mine={mover === self || undefined}>
            <PersonSimple size="74%" weight="bold" />
          </span>}
        </div>;
      })}
    </div>
    <div className="sokoban-legend" aria-hidden="true">
      {names.map((name, index) => <span key={board.players[index]} title={name}><i className="sokoban-token" data-mover={index}><PersonSimple size={13} weight="bold" /></i>{name}</span>)}
      <span><i className="sokoban-goal" />{goalLabel}</span>
      <span><i className="sokoban-plate" />{plateLabel}</span>
    </div>
    {complete ? <>
      <p className="sokoban-message" role="status">
        <strong>{t("家具都搬好啦！", "You're all moved in!", "¡Mudanza completada!")}</strong>
        <span>{t(`你们一起走了 ${board.moves} 步。`, `You did it together in ${board.moves} moves.`, `Lo lograron en ${board.moves} movimientos.`)}</span>
      </p>
      <button type="button" className="game-primary" onClick={onRematch}>{t("下一间房", "Next room", "Siguiente habitación")}</button>
    </> : <>
      <p className="sokoban-message" role="status">
        <strong>{mine ? t("轮到你搬", "Your turn", "Te toca")
          : t(`等 ${partnerName} 移动`, `Waiting for ${partnerName}`, `Esperando a ${partnerName}`)}</strong>
        <span>{mine ? t(`剩 ${board.remaining} 步 · ${openLabel}`, `${board.remaining} ${board.remaining === 1 ? "move" : "moves"} left · ${openLabel}`,
          `${board.remaining} ${board.remaining === 1 ? "paso" : "pasos"} · ${openLabel}`) : openLabel}</span>
      </p>
      {mine && <div className="sokoban-turn-controls">
        <div className="sokoban-arrows" role="group" aria-label={t("移动", "Move", "Mover")}>
          {arrows.map(({ direction, Icon, label }) => <button key={direction} type="button" className="sokoban-direction" data-direction={direction}
            aria-label={t(label[0], label[1], label[2])} disabled={busy || !board.legal.includes(direction)} onClick={() => press(direction)}><Icon size={22} weight="bold" /></button>)}
        </div>
        <button type="button" className="game-quiet" disabled={busy} onClick={() => void send("pass")}>{t("交给 TA", "Pass turn", "Pasar turno")}</button>
      </div>}
      {failed && <p className="sokoban-help" role="alert">{t("这一步没有完成，请再试一次。", "That move didn't go through. Try again.", "El movimiento no se completó. Inténtalo de nuevo.")}</p>}
      <p className="sokoban-help">{t("踩住圆形地砖开门，把家具推到虚线框。", "Stand on a round switch to hold the door open. Push the chairs onto the dashed tiles.", "Pisa la placa redonda para mantener la puerta abierta. Empuja los sillones a las casillas punteadas.")}</p>
      <details className="sokoban-tools" onToggle={(event) => { if (!event.currentTarget.open) setConfirm(null); }}>
        <summary>{t("对局选项", "Game options", "Opciones de la partida")}</summary>
        {confirm ? <div className="sokoban-confirm">
          <button type="button" className="game-primary" disabled={busy} onClick={() => void send(confirm)}>{confirm === "reset"
            ? t("确认重置", "Reset room", "Reiniciar habitación")
            : t("确认结束", "End game", "Terminar partida")}</button>
          <button type="button" className="game-quiet" disabled={busy} onClick={() => setConfirm(null)}>{t("取消", "Cancel", "Cancelar")}</button>
        </div> : <div className="sokoban-confirm">
          <button type="button" className="game-quiet" disabled={!board.moves || busy} onClick={() => setConfirm("reset")}>{t("重置这一关", "Reset room", "Reiniciar habitación")}</button>
          <button type="button" className="game-quiet" disabled={busy} onClick={() => setConfirm("abandon")}>{t("结束对局", "End game", "Terminar partida")}</button>
        </div>}
      </details>
    </>}
  </section>;
}
