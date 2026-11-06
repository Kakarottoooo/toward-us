import { useEffect, useRef, useState, type ReactNode } from "react";
import { AirplaneTakeoff, AirplaneTilt, ArrowsClockwise, Check, DiceFive, DiceFour, DiceOne, DiceSix, DiceThree, DiceTwo, Flag, Heart, House, SkipForward } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import type { ScreenProps } from "./MatchScreen";
import { PET } from "./types";
import "./ludo.css";

// server/matches/ludo.mjs
const LOOP = 30, HOME = 30, HANGAR = -1, ENTRY = [0, 15];
const isHeart = (square: number) => square % 5 === 2;
type Text = { zh?: string; en?: string; es?: string };
type LogEntry = { by: string; kind: "launch" | "forced" | "move" | "home" | "capture" | "pass" | "try" | "task"; plane?: number; planes?: number[]; value?: number; tries?: number; done?: boolean; line?: number; n: number };
export type LudoState = {
  players: string[]; planes: Record<string, number[]>; current: string; phase: "roll" | "move" | "task" | "over";
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

/** The loop drawn around a 9 x 8 grid, starting at the viewer's own take-off square in the bottom-left corner and going up,
 * across, down and back: [row, column] of the d-th square from there. */
function cell(d: number): [number, number] {
  if (d === 0) return [7, 0];
  if (d <= 7) return [7 - d, 0];
  if (d <= 15) return [0, d - 7];
  if (d <= 22) return [d - 15, 8];
  return [7, 30 - d];
}

/** 情侣飞行棋: the loop with both players' planes, the die in the middle, a heart's task, and whose turn it is. */
export function Ludo({ match, language, userId, partnerName, opponent, act, onRematch }: ScreenProps<LudoState>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const state = match.state, rival = state.players.find((id) => id !== userId) || PET;
  const active = match.status === "active", mine = active && match.turn === userId;
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
  const myEntry = ENTRY[Math.max(0, state.players.indexOf(userId))];
  const squareOf = (id: string, progress: number) => (ENTRY[state.players.indexOf(id)] + progress) % LOOP;
  const textOf = (text: Text) => (language === "zh" ? text.zh || text.en || text.es : text[language] || text.en || text.es) || t("做一件让 TA 开心的小事。", "Do one small thing that makes your partner smile.", "Haz algo pequeño que haga sonreír a tu pareja.");

  // Which of my planes can move with the die now (when I'm choosing).
  const value = state.die?.value || 0;
  const movable = (plane: number) => { const progress = state.planes[userId]?.[plane]; return progress === HANGAR ? value === 6 : progress >= 0 && progress < HOME && progress + value <= HOME; };
  const choosing = mine && state.phase === "move";
  const choices = choosing ? [0, 1].filter(movable) : [];

  const planesAt = new Map<number, Array<{ owner: string; plane: number }>>();
  for (const id of state.players) state.planes[id]?.forEach((progress, plane) => { if (progress >= 0 && progress < HOME) { const square = squareOf(id, progress); planesAt.set(square, [...(planesAt.get(square) || []), { owner: id, plane }]); } });
  const plane = (owner: string, index: number, pick = false) => <span key={`${owner}${index}`} className={`ludo-plane ${side(owner)} ${pick ? "is-pick" : ""}`} aria-label={t(`${name(owner)}的 ${index + 1} 号飞机`, `${name(owner)}: plane ${index + 1}`, `${name(owner)}: avión ${index + 1}`)}><AirplaneTilt size={18} weight="fill" /><b>{index + 1}</b></span>;

  const squares: ReactNode[] = [];
  for (let d = 0; d < LOOP; d += 1) {
    const square = (myEntry + d) % LOOP, [row, column] = cell(d), here = planesAt.get(square) || [];
    const entryOf = state.players.find((id) => ENTRY[state.players.indexOf(id)] === square);
    const pickable = here.filter((item) => item.owner === userId && choices.includes(item.plane));
    const content = <>{isHeart(square) && <Heart className="ludo-mark" size={16} weight="fill" />}{entryOf && <AirplaneTakeoff className="ludo-mark" size={16} weight="bold" />}{here.map((item) => plane(item.owner, item.plane, pickable.some((pick) => pick.plane === item.plane)))}</>;
    const className = `ludo-square ${isHeart(square) ? "is-heart" : ""} ${entryOf ? `is-entry ${side(entryOf)}` : ""}`;
    squares.push(pickable.length
      ? <button key={square} type="button" className={`${className} is-choice`} style={{ gridRow: row + 1, gridColumn: column + 1 }} onClick={() => void send({ type: "move", plane: pickable[0].plane })} disabled={busy}>{content}</button>
      : <span key={square} className={className} style={{ gridRow: row + 1, gridColumn: column + 1 }}>{content}</span>);
  }

  const dock = (id: string) => {
    const planes = state.planes[id] || [], waiting = planes.map((progress, index) => progress === HANGAR ? index : -1).filter((index) => index >= 0), home = planes.filter((progress) => progress === HOME).length;
    return <div className={`ludo-dock ${side(id)} ${active && match.turn === id ? "is-turn" : ""}`}>
      <span className="ludo-dock-name">{id === userId ? t("你", "You", "Tú") : <>{opponent.picture && <img src={opponent.picture} alt="" />}{partnerName}</>}</span>
      <span className="ludo-hangar">{waiting.map((index) => choices.includes(index) && id === userId
        ? <button key={index} type="button" className="ludo-launch" onClick={() => void send({ type: "move", plane: index })} disabled={busy}>{plane(id, index, true)}</button>
        : plane(id, index))}</span>
      <span className="ludo-home" aria-label={t(`到家 ${home}/2`, `Home ${home}/2`, `En casa ${home}/2`)}><House size={16} weight="fill" />{home}/2</span>
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

  const status = !active
    ? state.winner === userId ? (state.resignedBy ? t(`${partnerName} 认输了，你赢了！`, `${partnerName} resigned. You win!`, `${partnerName} se rindió. ¡Ganaste!`) : t("两架飞机都到家了，你赢了！", "Both planes home. You win!", "¡Tus dos aviones llegaron a casa! ¡Ganaste!"))
      : state.resignedBy === userId ? t("你认输了，下一局再来。", "You resigned. Next game!", "Te rendiste. ¡A la próxima!") : t(`${partnerName} 先到家，赢了这局。`, `${partnerName} got home first and won.`, `${partnerName} llegó primero a casa y ganó.`)
    : rolling ? t("骰子转呀转…", "Rolling…", "Rodando…")
    : state.phase === "task" ? (state.task?.by === userId ? t("停在爱心格，来做个小任务", "You landed on a heart: a little task", "Caíste en un corazón: una tarea") : t(`${partnerName} 在做小任务…`, `${partnerName} is doing a little task…`, `${partnerName} está haciendo una tarea…`))
    : choosing ? t(`掷出 ${value}，选一架飞机走`, `You rolled ${value}: pick a plane`, `Sacaste ${value}: elige un avión`)
    : mine ? (state.die?.by === userId && state.die.value === 6 ? t("掷出 6，再掷一次！", "A 6: roll again!", "¡Un 6: tira otra vez!") : t("轮到你了，掷骰子", "Your turn: roll the die", "Te toca: tira el dado"))
    : t(`等 ${partnerName} 掷骰子…`, `Waiting for ${partnerName} to roll…`, `Esperando a que ${partnerName} tire…`);

  return <div className="ludo">
    <p className={`gomoku-status ${!active && state.winner === userId ? "is-win" : ""}`} role="status" data-testid="ludo-status">{status}</p>
    <div className="ludo-board" role="group" aria-label={t("飞行棋棋盘", "Ludo board", "Tablero de parchís")} data-testid="ludo-board">
      {squares}
      <div className="ludo-center">
        {dock(rival)}
        <div className="ludo-dice">
          <button type="button" className={`ludo-die ${rolling ? "is-rolling" : ""} ${mine && state.phase === "roll" ? "is-ready" : ""}`} disabled={!mine || state.phase !== "roll" || busy} onClick={() => void roll()} aria-label={t("掷骰子", "Roll the die", "Tirar el dado")} data-testid="ludo-roll"><Face size={56} weight="fill" /></button>
          {state.die && !rolling && <small>{state.die.by === userId ? t(`你掷出 ${state.die.value}`, `You rolled ${state.die.value}`, `Sacaste ${state.die.value}`) : t(`${partnerName}掷出 ${state.die.value}`, `${partnerName} rolled ${state.die.value}`, `${partnerName} sacó ${state.die.value}`)}</small>}
        </div>
        {dock(userId)}
      </div>
    </div>

    {choices.length > 1 && <div className="game-actions ludo-choices">{choices.map((index) => {
      const progress = state.planes[userId][index];
      return <button key={index} type="button" className="game-primary" disabled={busy} onClick={() => void send({ type: "move", plane: index })} data-testid={`ludo-move-${index}`}>
        <AirplaneTilt size={18} weight="fill" />{progress === HANGAR ? t(`${index + 1} 号起飞`, `Plane ${index + 1}: take off`, `Avión ${index + 1}: despegar`) : progress + value === HOME ? t(`${index + 1} 号回家`, `Plane ${index + 1}: home`, `Avión ${index + 1}: a casa`) : t(`${index + 1} 号走 ${value} 格`, `Plane ${index + 1}: +${value}`, `Avión ${index + 1}: +${value}`)}
      </button>;
    })}</div>}

    {state.phase === "task" && state.task && active && <section className="ludo-task" aria-live="polite" data-testid="ludo-task">
      <Heart size={22} weight="fill" />
      <small>{state.task.by === userId ? t("你的小任务", "Your little task", "Tu tarea") : t(`${partnerName} 的小任务`, `${partnerName}'s little task`, `La tarea de ${partnerName}`)}</small>
      <p>{textOf(state.task.text)}</p>
      {state.task.by === userId ? <div className="game-actions">
        <button type="button" className="game-primary" disabled={busy} onClick={() => void send({ type: "task", done: true })} data-testid="ludo-task-done"><Check size={16} weight="bold" />{t("做到了", "Done", "Hecho")}</button>
        <button type="button" className="game-quiet" disabled={busy} onClick={() => void send({ type: "task", done: false })} data-testid="ludo-task-skip"><SkipForward size={16} />{t("跳过", "Skip", "Saltar")}</button>
      </div> : <span className="game-note">{t("TA 做完就继续。", "The game goes on once they're done.", "El juego sigue cuando termine.")}</span>}
    </section>}

    {recent.length > 0 && active && <ul className="ludo-log" aria-live="polite">{recent.map((entry, index) => <li key={`${entry.n}-${index}`} className={side(entry.by)}>{line(entry)}</li>)}</ul>}

    {active ? <div className="game-actions">
      <button type="button" className={`game-quiet ${resigning ? "is-confirm" : ""}`} onClick={() => { if (!resigning) { setResigning(true); return; } setResigning(false); void send({ type: "resign" }); }} onBlur={() => setResigning(false)} data-testid="ludo-resign"><Flag size={16} />{resigning ? t("确定认输", "Really resign", "Rendirme de verdad") : t("认输", "Resign", "Rendirse")}</button>
    </div> : <>
      <p className="game-note">{t(`这局一起完成了 ${Object.values(state.done).reduce((sum, count) => sum + count, 0)} 个小任务`, `${Object.values(state.done).reduce((sum, count) => sum + count, 0)} little tasks done together this game`, `${Object.values(state.done).reduce((sum, count) => sum + count, 0)} tareas hechas juntos esta partida`)}</p>
      <div className="game-actions"><button type="button" className="game-primary" onClick={onRematch} data-testid="game-rematch"><ArrowsClockwise size={16} />{t("再来一局", "Play again", "Otra partida")}</button></div>
    </>}
    {active && !mine && !opponent.pet && <p className="game-note">{t("不用一直等着，轮到你时会提醒你。", "No need to wait here: you'll be told when it's your move.", "No hace falta esperar: te avisamos cuando te toque.")}</p>}
    {active && state.phase !== "task" && !state.tasksReady && <p className="game-note">{t("Pinky 正在准备爱心格的小任务…", "Pinky is writing the heart squares' little tasks…", "Pinky está preparando las tareas de los corazones…")}</p>}
  </div>;
}
