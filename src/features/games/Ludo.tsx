import { useEffect, useRef, useState, type ReactNode } from "react";
import { AirplaneTakeoff, AirplaneTilt, ArrowsClockwise, Check, DiceFive, DiceFour, DiceOne, DiceSix, DiceThree, DiceTwo, Flag, Heart, House, SkipForward } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import type { ScreenProps } from "./MatchScreen";
import { PET } from "./types";
import "./ludo.css";

// server/matches/ludo.mjs
const BOARD = 2, LOOP = 52, LAST = 50, HOME = 56, HANGAR = -1, PLANES = 4, ENTRY = [1, 27], JUMP = 4, FLIGHT_FROM = 31, FLIGHT = 12;
const HEARTS = [4, 10, 16, 22, 30, 36, 42, 48];
const colourOf = (square: number) => square % 4 === 1 ? 0 : square % 4 === 3 ? 1 : null;
const onLoop = (progress: number) => progress >= 0 && progress <= LAST;
function stepTo(from: number, value: number) {
  if (from === HANGAR) return value === 6 ? 0 : null;
  if (from < 0 || from >= HOME) return null;
  const to = from + value;
  return to > HOME ? HOME - (to - HOME) : to;
}
function landing(from: number, value: number): { to: number | null; via: "jump" | "flight" | null } {
  const to = stepTo(from, value);
  if (to === null || from === HANGAR || !onLoop(to)) return { to, via: null };
  if (to === FLIGHT_FROM) return { to: to + FLIGHT, via: "flight" };
  if (to % 4 === 0 && to + JUMP <= LAST) return { to: to + JUMP, via: "jump" };
  return { to, via: null };
}

type Text = { zh?: string; en?: string; es?: string };
type LogEntry = { by: string; kind: "launch" | "forced" | "move" | "home" | "capture" | "pass" | "try" | "task" | "jump" | "flight"; plane?: number; planes?: number[]; value?: number; tries?: number; done?: boolean; line?: number; n: number };
export type LudoState = {
  board?: number; players: string[]; planes: Record<string, number[]>; current: string; phase: "roll" | "move" | "task" | "over";
  die: { value: number; by: string; n: number } | null; rolls: number; tries: Record<string, number>;
  task: { by: string; text: Text; extra: boolean } | null; tasksReady: boolean; done: Record<string, number>; skipped: Record<string, number>;
  log: LogEntry[]; winner: string | null; resignedBy: string | null;
};
const PET_LINES: Array<[string, string, string]> = [
  ["{name}转了个圈", "{name} spun around in a happy circle", "{name} dio una vueltecita feliz"],
  ["{name}蹭了蹭你的手", "{name} nuzzled your hand", "{name} te acarició la mano con el hocico"],
  ["{name}给你比了个心", "{name} made a little heart for you", "{name} te hizo un corazoncito"],
  ["{name}摇了摇尾巴", "{name} wagged its tail", "{name} movió la colita"],
  ["{name}跳了一小段舞", "{name} did a tiny dance", "{name} bailó un poquito"],
];
const FACES = [DiceOne, DiceTwo, DiceThree, DiceFour, DiceFive, DiceSix];

// The cross-shaped board on a 15 x 15 grid: arms 3 squares wide around a 3 x 3 centre, a yard in each corner.
// One quarter of the loop (13 squares), drawn for the first player; the other three are the same turned by 90° each.
const QUARTER: Array<[number, number]> = [[6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 7]];
const turn = ([row, column]: [number, number], times: number): [number, number] => { let cell: [number, number] = [row, column]; for (let index = 0; index < times % 4; index += 1) cell = [cell[1], 14 - cell[0]]; return cell; };
const loopCell = (square: number) => turn(QUARTER[square % 13], Math.floor(square / 13));
// The first player's runway (their progress 51..55) runs along the middle of the left arm; the second's is the same turned.
const runwayCell = (player: number, step: number) => turn([7, 1 + step], player * 2);

/** 情侣飞行棋: the cross-shaped board with both players' planes, the die, a heart's task, and whose turn it is. */
export function Ludo({ match, language, userId, partnerName, opponent, act, onRematch }: ScreenProps<LudoState>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const state = match.state, rival = state.players.find((id) => id !== userId) || PET;
  const legacy = state.board !== BOARD;
  const active = match.status === "active", mine = active && !legacy && match.turn === userId;
  const [busy, setBusy] = useState(false), [rolling, setRolling] = useState(false), [face, setFace] = useState(0), [resigning, setResigning] = useState(false);
  // A short tumble whenever a new roll shows up (mine, or the other one's arriving).
  const seen = useRef(state.die?.n || 0);
  useEffect(() => {
    if (!state.die || state.die.n === seen.current) return;
    seen.current = state.die.n;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    setRolling(true); const timer = setTimeout(() => setRolling(false), 450); return () => clearTimeout(timer);
  }, [state.die]);
  useEffect(() => { if (!rolling) return; const timer = setInterval(() => setFace((value) => (value + 1 + Math.floor(Math.random() * 4)) % 6), 70); return () => clearInterval(timer); }, [rolling]);

  const send = async (action: Record<string, unknown>) => { if (busy) return; setBusy(true); await act(action); setBusy(false); };
  const roll = async () => { if (busy) return; setRolling(true); setBusy(true); const started = Date.now(); await act({ type: "roll" }); await new Promise((resolve) => setTimeout(resolve, Math.max(0, 450 - (Date.now() - started)))); setBusy(false); setRolling(false); };

  const name = (id: string) => id === userId ? t("你", "You", "Tú") : partnerName;
  const side = (id: string) => id === userId ? "is-me" : opponent.pet ? "is-pet" : "is-them";
  const indexOf = (id: string) => Math.max(0, state.players.indexOf(id));
  // I'm always at the bottom: my take-off square at the foot of the board, my yard bottom-left, theirs top-right.
  const view = indexOf(userId) === 0 ? 3 : 1;
  const place = (cell: [number, number]) => { const [row, column] = turn(cell, view); return { gridRow: row + 1, gridColumn: column + 1 }; };
  const squareOf = (id: string, progress: number) => (ENTRY[indexOf(id)] + progress) % LOOP;
  const ownerOf = (player: number | null) => player === null ? null : state.players[player] || (player === 1 ? rival : userId);
  const textOf = (text: Text) => (language === "zh" ? text.zh || text.en || text.es : text[language] || text.en || text.es) || t("做一件让 TA 开心的小事。", "Do one small thing that makes your partner smile.", "Haz algo pequeño que haga sonreír a tu pareja.");

  // Which of my planes can move with the die now (when I'm choosing), and where each would end.
  const value = state.die?.value || 0;
  const choosing = mine && state.phase === "move";
  const myPlanes = state.planes[userId] || [];
  const choices = choosing ? myPlanes.map((progress, plane) => ({ plane, from: progress, ...landing(progress, value) })).filter((choice, index, all) => choice.to !== null && all.findIndex((other) => other.from === choice.from) === index) : [];
  const theirsAt = (to: number) => onLoop(to) && (state.planes[rival] || []).some((progress) => onLoop(progress) && squareOf(rival, progress) === squareOf(userId, to));

  // Planes standing on the loop (by square) and on each runway step (by owner and step).
  const planesAt = new Map<string, Array<{ owner: string; plane: number }>>();
  const add = (key: string, owner: string, plane: number) => planesAt.set(key, [...(planesAt.get(key) || []), { owner, plane }]);
  if (!legacy) for (const id of state.players) (state.planes[id] || []).forEach((progress, plane) => { if (onLoop(progress)) add(`l${squareOf(id, progress)}`, id, plane); else if (progress > LAST && progress < HOME) add(`r${indexOf(id)}-${progress - LAST - 1}`, id, plane); });
  const planeIcon = (owner: string, index: number, count = 1, pick = false) => <span key={`${owner}${index}`} className={`ludo-plane ${side(owner)} ${pick ? "is-pick" : ""}`} aria-label={t(`${name(owner)}的 ${index + 1} 号飞机`, `${name(owner)}: plane ${index + 1}`, `${name(owner)}: avión ${index + 1}`)}><AirplaneTilt size={16} weight="fill" /><b>{count > 1 ? `×${count}` : index + 1}</b></span>;
  const stack = (here: Array<{ owner: string; plane: number }>, picks: number[]) => here.length ? planeIcon(here[0].owner, here[0].plane, here.length, here.some((item) => item.owner === userId && picks.includes(item.plane))) : null;
  const pickIn = (here: Array<{ owner: string; plane: number }>) => here.filter((item) => item.owner === userId && choices.some((choice) => choice.plane === item.plane)).map((item) => item.plane);
  const cellFor = (key: string, cell: [number, number], className: string, marks: ReactNode, label: string) => {
    const here = planesAt.get(key) || [], picks = pickIn(here);
    const content = <>{marks}{stack(here, picks)}</>;
    return picks.length
      ? <button key={key} type="button" className={`${className} is-choice`} style={place(cell)} onClick={() => void send({ type: "move", plane: picks[0] })} disabled={busy} aria-label={label}>{content}</button>
      : <span key={key} className={className} style={place(cell)} aria-label={here.length ? label : undefined}>{content}</span>;
  };

  const squares: ReactNode[] = [];
  const flights = state.players.map((id) => ({ id, from: loopCell(squareOf(id, FLIGHT_FROM)), to: loopCell(squareOf(id, FLIGHT_FROM + FLIGHT)) }));
  for (let square = 0; square < LOOP; square += 1) {
    const colour = ownerOf(colourOf(square)), entry = state.players.find((id) => ENTRY[indexOf(id)] === square), flight = state.players.find((id) => squareOf(id, FLIGHT_FROM) === square);
    const heart = HEARTS.includes(square);
    const tone = flight || colour;
    const marks = <>{heart && <Heart className="ludo-mark" size={13} weight="fill" />}{entry && <AirplaneTakeoff className="ludo-mark" size={13} weight="bold" />}{flight && <AirplaneTilt className="ludo-mark" size={13} weight="fill" />}</>;
    const className = `ludo-square ${heart ? "is-heart" : ""} ${tone ? `is-tone ${side(tone)}` : ""} ${entry ? "is-entry" : ""} ${flight ? "is-flight" : ""}`;
    squares.push(cellFor(`l${square}`, loopCell(square), className, marks, t(`第 ${square + 1} 格`, `Square ${square + 1}`, `Casilla ${square + 1}`)));
  }
  for (const id of state.players) for (let step = 0; step < HOME - LAST - 1; step += 1) squares.push(cellFor(`r${indexOf(id)}-${step}`, runwayCell(indexOf(id), step), `ludo-square is-runway ${side(id)}`, null, t(`${name(id)}的跑道`, `${name(id)}'s runway`, `Pista de ${name(id)}`)));
  // The two runways nobody uses carry the flight lines across; drawn as quiet squares.
  for (const player of [1, 3]) for (let step = 0; step < 5; step += 1) squares.push(<span key={`q${player}-${step}`} className="ludo-square is-quiet" style={place(turn([7, 1 + step], player))} />);

  const centre = (cell: [number, number]) => { const [row, column] = turn(cell, view); return [column + 0.5, row + 0.5]; };
  const lines = flights.map(({ id, from, to }) => { const [x1, y1] = centre(from), [x2, y2] = centre(to); return <line key={id} className={`ludo-flight ${side(id)}`} x1={x1} y1={y1} x2={x2} y2={y2} />; });

  const yard = (id: string, area: { gridRow: string; gridColumn: string }) => {
    const planes = state.planes[id] || [], home = planes.filter((progress) => progress === HOME).length;
    return <div className={`ludo-yard ${side(id)} ${active && !legacy && match.turn === id ? "is-turn" : ""}`} style={area}>
      <span className="ludo-yard-name">{id === userId ? t("你", "You", "Tú") : <>{opponent.picture && <img src={opponent.picture} alt="" />}{partnerName}</>}</span>
      <span className="ludo-hangar">{planes.map((progress, index) => progress !== HANGAR
        ? <span key={index} className="ludo-slot" />
        : choices.some((choice) => choice.plane === index) && id === userId
          ? <button key={index} type="button" className="ludo-slot ludo-launch" onClick={() => void send({ type: "move", plane: index })} disabled={busy}>{planeIcon(id, index, 1, true)}</button>
          : <span key={index} className="ludo-slot">{planeIcon(id, index)}</span>)}</span>
      <span className="ludo-home" aria-label={t(`到家 ${home}/${PLANES}`, `Home ${home}/${PLANES}`, `En casa ${home}/${PLANES}`)}><House size={14} weight="fill" />{home}/{PLANES}</span>
    </div>;
  };

  const Face = FACES[(rolling ? face : (state.die?.value || 6) - 1)] || DiceSix;
  const last = state.log.at(-1);
  const line = (entry: LogEntry) => {
    const self = entry.by === userId, n = (entry.plane ?? 0) + 1, v = entry.value;
    // "You rolled" / "Sacaste" for me, "Mia rolled" / "Mia sacó" for the other one.
    const rolled = self ? t(`你掷出 ${v}`, `You rolled ${v}`, `Sacaste ${v}`) : t(`${partnerName}掷出 ${v}`, `${partnerName} rolled ${v}`, `${partnerName} sacó ${v}`);
    switch (entry.kind) {
      case "launch": return `${rolled}${t(`，${n} 号飞机起飞`, `: plane ${n} takes off`, `: despega el avión ${n}`)}`;
      case "forced": return self ? t(`三次没掷到 6，你的 ${n} 号飞机照样起飞`, `No 6 in three tries: your plane ${n} takes off anyway`, `Sin 6 en tres intentos: tu avión ${n} despega igual`) : t(`${partnerName}三次没掷到 6，${n} 号飞机照样起飞`, `${partnerName} had no 6 in three tries: plane ${n} takes off anyway`, `${partnerName} no sacó 6 en tres intentos: su avión ${n} despega igual`);
      case "move": return `${rolled}${t(`，${n} 号飞机前进 ${v} 格`, `: plane ${n} moves ${v}`, `: el avión ${n} avanza ${v}`)}`;
      case "home": return `${rolled}${t(`，${n} 号飞机到家了`, `: plane ${n} is home`, `: el avión ${n} llegó a casa`)}`;
      case "jump": return t(`停在同色格，${n} 号再跳 ${JUMP} 格`, `Its own colour: plane ${n} hops ${JUMP} more`, `Su color: el avión ${n} salta ${JUMP} más`);
      case "flight": return t(`${n} 号沿虚线飞了 ${FLIGHT} 格！`, `Plane ${n} flies the dashed line, ${FLIGHT} squares!`, `¡El avión ${n} vuela por la línea, ${FLIGHT} casillas!`);
      case "capture": return self ? t(`撞回了 ${partnerName} 的飞机！`, `You sent ${partnerName}'s plane back to start!`, `¡Mandaste el avión de ${partnerName} de vuelta a la salida!`) : t(`${partnerName}把你的飞机撞回了起点`, `${partnerName} sent your plane back to start`, `${partnerName} mandó tu avión de vuelta a la salida`);
      case "try": return `${rolled}${t(`，还没起飞（${entry.tries}/3）`, `: no take-off yet (${entry.tries}/3)`, `: aún sin despegar (${entry.tries}/3)`)}`;
      case "pass": return `${rolled}${t("，这次走不了", ": no move this time", ": sin movimiento esta vez")}`;
      case "task": {
        if (entry.by === PET && entry.line !== undefined) { const [zh, en, es] = PET_LINES[entry.line] || PET_LINES[0]; return t(zh, en, es).replace("{name}", partnerName); }
        if (self) return entry.done ? t("你完成了一个小任务 ♡", "You did a little task ♡", "Hiciste una tarea ♡") : t("你跳过了一个小任务", "You skipped a little task", "Saltaste una tarea");
        return entry.done ? t(`${partnerName}完成了一个小任务 ♡`, `${partnerName} did a little task ♡`, `${partnerName} hizo una tarea ♡`) : t(`${partnerName}跳过了一个小任务`, `${partnerName} skipped a little task`, `${partnerName} saltó una tarea`);
      }
      default: return "";
    }
  };
  // The latest roll's story (the other one's whole turn, when it came back with mine).
  const run = last ? state.log.length - [...state.log].reverse().findIndex((entry) => entry.by !== last.by) : 0;
  const recent = (last && run <= state.log.length ? state.log.slice(run) : state.log).slice(-3);

  const status = legacy ? t("飞行棋换了新地图，这局是旧棋盘，没法接着下了。", "Ludo has a new map; this game is on the old board and can't go on.", "El parchís tiene un mapa nuevo; esta partida es del tablero antiguo y no puede seguir.")
    : !active
    ? state.winner === userId ? (state.resignedBy ? t(`${partnerName} 认输了，你赢了！`, `${partnerName} resigned. You win!`, `${partnerName} se rindió. ¡Ganaste!`) : t("四架飞机都到家了，你赢了！", "All four planes home. You win!", "¡Tus cuatro aviones llegaron a casa! ¡Ganaste!"))
      : state.resignedBy === userId ? t("你认输了，下一局再来。", "You resigned. Next game!", "Te rendiste. ¡A la próxima!") : t(`${partnerName} 先到家，赢了这局。`, `${partnerName} got home first and won.`, `${partnerName} llegó primero a casa y ganó.`)
    : rolling ? t("骰子转呀转…", "Rolling…", "Rodando…")
    : state.phase === "task" ? (state.task?.by === userId ? t("停在爱心格，来做个小任务", "You landed on a heart: a little task", "Caíste en un corazón: una tarea") : t(`${partnerName} 在做小任务…`, `${partnerName} is doing a little task…`, `${partnerName} está haciendo una tarea…`))
    : choosing ? t(`掷出 ${value}，选一架飞机走`, `You rolled ${value}: pick a plane`, `Sacaste ${value}: elige un avión`)
    : mine ? (state.die?.by === userId && state.die.value === 6 ? t("掷出 6，再掷一次！", "A 6: roll again!", "¡Un 6: tira otra vez!") : t("轮到你了，掷骰子", "Your turn: roll the die", "Te toca: tira el dado"))
    : t(`等 ${partnerName} 掷骰子…`, `Waiting for ${partnerName} to roll…`, `Esperando a que ${partnerName} tire…`);

  const choiceText = (choice: typeof choices[number]) => {
    const n = choice.plane + 1;
    const base = choice.from === HANGAR ? t(`${n} 号起飞`, `Plane ${n}: take off`, `Avión ${n}: despegar`)
      : choice.to === HOME ? t(`${n} 号回家`, `Plane ${n}: home`, `Avión ${n}: a casa`)
      : t(`${n} 号走 ${value} 格`, `Plane ${n}: +${value}`, `Avión ${n}: +${value}`);
    const extra = choice.via === "flight" ? t(" · 飞！", " · fly!", " · ¡vuela!") : choice.via === "jump" ? t(" · 跳", " · hop", " · salto") : "";
    return `${base}${extra}${theirsAt(choice.to!) ? t(" · 撞机", " · bump", " · choque") : ""}`;
  };

  return <div className="ludo">
    <p className={`gomoku-status ${!active && state.winner === userId ? "is-win" : ""}`} role="status" data-testid="ludo-status">{status}</p>
    <div className="ludo-board" role="group" aria-label={t("飞行棋棋盘", "Ludo board", "Tablero de parchís")} data-testid="ludo-board">
      {yard(rival, { gridRow: "1 / 7", gridColumn: "10 / 16" })}
      <div className="ludo-legend" style={{ gridRow: "1 / 7", gridColumn: "1 / 7" }}>
        <span><Heart size={13} weight="fill" className="is-heart" />{t("小任务", "Little task", "Tarea")}</span>
        <span><i className={`ludo-swatch ${side(userId)}`} />{t(`同色跳 ${JUMP} 格`, `Your colour: +${JUMP}`, `Tu color: +${JUMP}`)}</span>
        <span><AirplaneTilt size={13} weight="fill" className={side(userId)} />{t(`虚线飞 ${FLIGHT} 格`, `Dashed line: +${FLIGHT}`, `Línea: +${FLIGHT}`)}</span>
      </div>
      {squares}
      <div className={`ludo-centre ${side(rival)}`} style={{ gridRow: "7 / 10", gridColumn: "7 / 10" }}><House size={18} weight="fill" /></div>
      <svg className="ludo-lines" viewBox="0 0 15 15" aria-hidden="true">{lines}</svg>
      {yard(userId, { gridRow: "10 / 16", gridColumn: "1 / 7" })}
      <div className="ludo-dice" style={{ gridRow: "10 / 16", gridColumn: "10 / 16" }}>
        <button type="button" className={`ludo-die ${rolling ? "is-rolling" : ""} ${mine && state.phase === "roll" ? "is-ready" : ""}`} disabled={!mine || state.phase !== "roll" || busy} onClick={() => void roll()} aria-label={t("掷骰子", "Roll the die", "Tirar el dado")} data-testid="ludo-roll"><Face size={48} weight="fill" /></button>
        {state.die && !rolling && <small>{state.die.by === userId ? t(`你掷出 ${state.die.value}`, `You rolled ${state.die.value}`, `Sacaste ${state.die.value}`) : t(`${partnerName}掷出 ${state.die.value}`, `${partnerName} rolled ${state.die.value}`, `${partnerName} sacó ${state.die.value}`)}</small>}
      </div>
    </div>

    {choices.length > 1 && <div className="game-actions ludo-choices">{choices.map((choice) =>
      <button key={choice.plane} type="button" className="game-primary" disabled={busy} onClick={() => void send({ type: "move", plane: choice.plane })} data-testid={`ludo-move-${choice.plane}`}>
        <AirplaneTilt size={18} weight="fill" />{choiceText(choice)}
      </button>)}</div>}

    {state.phase === "task" && state.task && active && !legacy && <section className="ludo-task" aria-live="polite" data-testid="ludo-task">
      <Heart size={22} weight="fill" />
      <small>{state.task.by === userId ? t("你的小任务", "Your little task", "Tu tarea") : t(`${partnerName} 的小任务`, `${partnerName}'s little task`, `La tarea de ${partnerName}`)}</small>
      <p>{textOf(state.task.text)}</p>
      {state.task.by === userId ? <div className="game-actions">
        <button type="button" className="game-primary" disabled={busy} onClick={() => void send({ type: "task", done: true })} data-testid="ludo-task-done"><Check size={16} weight="bold" />{t("做到了", "Done", "Hecho")}</button>
        <button type="button" className="game-quiet" disabled={busy} onClick={() => void send({ type: "task", done: false })} data-testid="ludo-task-skip"><SkipForward size={16} />{t("跳过", "Skip", "Saltar")}</button>
      </div> : <span className="game-note">{t("TA 做完就继续。", "The game goes on once they're done.", "El juego sigue cuando termine.")}</span>}
    </section>}

    {recent.length > 0 && active && !legacy && <ul className="ludo-log" aria-live="polite">{recent.map((entry, index) => <li key={`${entry.n}-${index}`} className={side(entry.by)}>{line(entry)}</li>)}</ul>}

    {active ? <div className="game-actions">
      <button type="button" className={`game-quiet ${resigning ? "is-confirm" : ""}`} onClick={() => { if (!resigning) { setResigning(true); return; } setResigning(false); void send({ type: "resign" }); }} onBlur={() => setResigning(false)} data-testid="ludo-resign"><Flag size={16} />{legacy ? (resigning ? t("确定结束", "Really end it", "Terminar de verdad") : t("结束这局", "End this game", "Terminar esta partida")) : resigning ? t("确定认输", "Really resign", "Rendirme de verdad") : t("认输", "Resign", "Rendirse")}</button>
    </div> : <>
      <p className="game-note">{t(`这局一起完成了 ${Object.values(state.done).reduce((sum, count) => sum + count, 0)} 个小任务`, `${Object.values(state.done).reduce((sum, count) => sum + count, 0)} little tasks done together this game`, `${Object.values(state.done).reduce((sum, count) => sum + count, 0)} tareas hechas juntos esta partida`)}</p>
      <div className="game-actions"><button type="button" className="game-primary" onClick={onRematch} data-testid="game-rematch"><ArrowsClockwise size={16} />{t("再来一局", "Play again", "Otra partida")}</button></div>
    </>}
    {active && !legacy && !mine && !opponent.pet && <p className="game-note">{t("不用一直等着，轮到你时会提醒你。", "No need to wait here: you'll be told when it's your move.", "No hace falta esperar: te avisamos cuando te toque.")}</p>}
    {active && !legacy && state.phase !== "task" && !state.tasksReady && <p className="game-note">{t("Pinky 正在准备爱心格的小任务…", "Pinky is writing the heart squares' little tasks…", "Pinky está preparando las tareas de los corazones…")}</p>}
  </div>;
}
