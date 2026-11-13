import { useEffect, useRef, useState, type ReactNode } from "react";
import { AirplaneTakeoff, AirplaneTilt, ArrowsClockwise, Bridge, Check, Coins, DiceFive, DiceFour, DiceOne, DiceSix, DiceThree, DiceTwo, Flag, HandHeart, Heart, House, ShieldCheck, SkipForward, Snowflake, Sparkle, Star } from "@phosphor-icons/react";
import { counted, localized, type Language } from "../../i18n";
import type { ScreenProps } from "./MatchScreen";
import { PET } from "./types";
import "./ludo.css";

// server/matches/ludo.mjs (board 3, founder 11-06: the double ring with a little 大富翁 in it)
const BOARD = 3, LOOP = 48, QUARTER = 12, HOME = 48, HANGAR = -1, START = [0, 24], FLIGHT_FROM = 28, FLIGHT = 12, UPGRADE = 100;
// `short`: what fits on the square itself; `name` in sentences.
const PLACES: Array<{ square: number; price: number; name: [string, string, string]; short?: [string, string, string] }> = [
  { square: 3, price: 100, name: ["咖啡馆", "Café", "Cafetería"], short: ["咖啡馆", "Café", "Café"] }, { square: 8, price: 120, name: ["电影院", "Cinema", "Cine"], short: ["电影院", "Cinema", "Cine"] },
  { square: 15, price: 140, name: ["公园", "Park", "Parque"], short: ["公园", "Park", "Parque"] }, { square: 20, price: 160, name: ["游乐园", "Fun fair", "Feria"], short: ["游乐园", "Fair", "Feria"] },
  { square: 27, price: 100, name: ["书店", "Bookshop", "Librería"], short: ["书店", "Books", "Libros"] }, { square: 32, price: 120, name: ["火锅店", "Hot pot", "Hot pot"], short: ["火锅店", "Hot pot", "Hot pot"] },
  { square: 39, price: 140, name: ["海边", "Seaside", "Playa"], short: ["海边", "Beach", "Playa"] }, { square: 44, price: 160, name: ["摩天轮", "Ferris wheel", "Noria"], short: ["摩天轮", "Wheel", "Noria"] },
];
const CARDS_AT = [5, 18, 29, 42], COINS_AT = [2, 10, 26, 34], CALM_AT = [22, 46];
const rentOf = (price: number, level: number) => Math.round(price * (level >= 2 ? 0.9 : 0.4));
const placeAt = (square: number) => PLACES.find((place) => place.square === square);
function colourOf(square: number) {
  if (square % QUARTER === 0 || placeAt(square) || CARDS_AT.includes(square) || COINS_AT.includes(square) || CALM_AT.includes(square)) return null;
  if (START.some((start) => (start + FLIGHT_FROM) % LOOP === square)) return null;
  return square % 4 === 1 ? 0 : square % 4 === 3 ? 1 : null;
}
const innerKind = (index: number) => [2, 6].includes(index % 8) ? "heart" : index % 8 === 4 ? "coin" : null;
const stepTo = (from: number, value: number) => { if (from === HANGAR) return value === 6 ? 0 : null; if (from < 0 || from >= HOME) return null; const to = from + value; return to > HOME ? HOME - (to - HOME) : to; };

type Text = { zh?: string; en?: string; es?: string };
type Plane = { p: number; inner: number };
type Kind = "launch" | "forced" | "move" | "home" | "capture" | "charmed" | "pass" | "try" | "task" | "jump" | "flight" | "coins" | "buy" | "upgrade" | "rent" | "promise" | "inner" | "card" | "calm" | "calmed" | "bail";
type LogEntry = { by: string; kind: Kind; plane?: number; value?: number; tries?: number; done?: boolean; line?: number; amount?: number; square?: number; card?: string; n: number };
type Pending = { kind: "buy" | "upgrade" | "rent" | "bridge"; by: string; plane?: number; square?: number; price?: number; rent?: number; to?: string };
export type LudoState = {
  board?: number; players: string[]; planes: Record<string, Plane[]>; coins: Record<string, number>; owned: Record<string, { owner: string; level: number }>;
  charm: Record<string, number>; calm: Record<string, boolean>; promises: Array<{ from: string; to: string; text: Text; square: number }>;
  current: string; phase: "roll" | "move" | "task" | "decide" | "over"; die: { value: number; by: string; n: number } | null; rolls: number;
  pending: Pending | null; card: { by: string; id: string; n: number } | null;
  task: { by: string; text: Text; pay: number; card: boolean } | null; tasksReady: boolean; done: Record<string, number>;
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

// The board: 9 x 17. The outer ring runs clockwise from the first player's start at the foot (square 0), the inner ring
// (32 squares) sits two squares in, and the four bridges cross the grass between them at the middle of each side.
const COLS = 9, ROWS = 17;
function outerCell(square: number): [number, number] {
  if (square <= 4) return [16, 4 - square];
  if (square <= 20) return [16 - (square - 4), 0];
  if (square <= 28) return [0, square - 20];
  if (square <= 44) return [square - 28, 8];
  return [16, 8 - (square - 44)];
}
function innerCell(index: number): [number, number] {
  if (index <= 2) return [14, 4 - index];
  if (index <= 14) return [14 - (index - 2), 2];
  if (index <= 18) return [2, index - 12];
  if (index <= 30) return [index - 16, 6];
  return [14, 5];
}
const GRASS: Array<[number, number]> = [[15, 4], [8, 1], [1, 4], [8, 7]];
const cellAt = (id: string): [number, number] => id[0] === "o" ? outerCell(Number(id.slice(1))) : id[0] === "i" ? innerCell(Number(id.slice(1))) : GRASS[Number(id.slice(1))];
function cellOf(state: LudoState, userId: string, plane: Plane) {
  const { p, inner } = plane;
  if (p < 0 || p >= HOME) return null;
  const start = START[Math.max(0, state.players.indexOf(userId))], segment = Math.floor(p / QUARTER), step = p % QUARTER, bridge = (start / QUARTER + segment) % 4;
  if (inner !== segment || step === 0) return `o${(start + p) % LOOP}`;
  if (step === 1) return `g${bridge}`;
  if (step === QUARTER - 1) return `g${(bridge + 1) % 4}`;
  return `i${(bridge * 8 + step - 2) % 32}`;
}

/** 情侣飞行棋: two rings, places to buy, cards, the 冷静角, and whose turn it is. */
export function Ludo({ match, language, userId, partnerName, opponent, act, onRematch }: ScreenProps<LudoState>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const pick = (names: [string, string, string]) => t(...names);
  const state = match.state, rival = state.players.find((id) => id !== userId) || PET;
  const legacy = state.board !== BOARD;
  const active = match.status === "active", mine = active && !legacy && match.turn === userId;
  const [busy, setBusy] = useState(false), [rolling, setRolling] = useState(false), [face, setFace] = useState(0), [resigning, setResigning] = useState(false);
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
  const side = (id: string | null | undefined) => !id ? "" : id === userId ? "is-me" : opponent.pet ? "is-pet" : "is-them";
  const flip = state.players.indexOf(userId) === 1;
  // I'm always at the foot of the board: the second player sees it turned half a turn.
  const shown = ([row, column]: [number, number]): [number, number] => flip ? [ROWS - 1 - row, COLS - 1 - column] : [row, column];
  const place = (cell: [number, number]) => { const [row, column] = shown(cell); return { gridRow: row + 1, gridColumn: column + 1 }; };
  const textOf = (text: Text) => (language === "zh" ? text.zh || text.en || text.es : text[language] || text.en || text.es) || "";
  const coins = (id: string) => state.coins?.[id] ?? 0;

  // Choosing which plane to move (two can move).
  const value = state.die?.value || 0, choosing = mine && state.phase === "move";
  const myPlanes = state.planes[userId] || [];
  const choices = choosing ? myPlanes.map((plane, index) => ({ index, plane, to: stepTo(plane.p, value) })).filter((choice, at, all) => choice.to !== null && all.findIndex((other) => other.plane.p === choice.plane.p && other.plane.inner === choice.plane.inner) === at) : [];

  const planesAt = new Map<string, Array<{ owner: string; plane: number }>>();
  if (!legacy) for (const id of state.players) (state.planes[id] || []).forEach((plane, index) => { const cell = cellOf(state, id, plane); if (cell) planesAt.set(cell, [...(planesAt.get(cell) || []), { owner: id, plane: index }]); });
  const planeIcon = (owner: string, index: number, count = 1, pickable = false) => <span key={`${owner}${index}`} className={`ludo-plane ${side(owner)} ${pickable ? "is-pick" : ""}`} aria-label={t(`${name(owner)}的 ${index + 1} 号飞机`, `${name(owner)}: plane ${index + 1}`, `${name(owner)}: avión ${index + 1}`)}><AirplaneTilt size={20} weight="fill" /><b>{count > 1 ? `×${count}` : index + 1}</b></span>;
  const square = (id: string, className: string, marks: ReactNode, label: string) => {
    const here = planesAt.get(id) || [], picks = here.filter((item) => item.owner === userId && choices.some((choice) => choice.index === item.plane)).map((item) => item.plane);
    const content = <>{marks}{here.length > 0 && planeIcon(here[0].owner, here[0].plane, here.length, picks.length > 0)}</>;
    return picks.length
      ? <button key={id} type="button" className={`${className} is-choice`} style={place(cellAt(id))} onClick={() => void send({ type: "move", plane: picks[0] })} disabled={busy} aria-label={label}>{content}</button>
      : <span key={id} className={className} style={place(cellAt(id))} aria-label={label}>{content}</span>;
  };

  const squares: ReactNode[] = [];
  for (let at = 0; at < LOOP; at += 1) {
    const spot = placeAt(at), owned = state.owned?.[at], colour = colourOf(at), startOf = state.players.find((id, index) => START[index] === at), flightOf = state.players.find((id, index) => (START[index] + FLIGHT_FROM) % LOOP === at);
    const bridge = at % QUARTER === 0;
    let marks: ReactNode = null, className = "ludo-square", label = t(`第 ${at + 1} 格`, `Square ${at + 1}`, `Casilla ${at + 1}`);
    if (spot) { className += ` is-place ${owned ? `is-owned ${side(owned.owner)}` : ""}`; label = pick(spot.name); marks = <><small className="ludo-place-name">{pick(spot.short || spot.name)}</small>{owned ? <span className="ludo-stars">{owned.level >= 2 ? <><Star size={8} weight="fill" /><Star size={8} weight="fill" /></> : <Star size={8} weight="fill" />}</span> : <span className="ludo-price">{spot.price}</span>}</>; }
    else if (startOf) { className += ` is-start ${side(startOf)}`; marks = <AirplaneTakeoff className="ludo-mark" size={16} weight="bold" />; }
    else if (bridge) { className += " is-bridge"; marks = <Bridge className="ludo-mark" size={16} weight="bold" />; }
    else if (CARDS_AT.includes(at)) { className += " is-card"; marks = <Sparkle className="ludo-mark" size={16} weight="fill" />; label = t("心动卡", "Heart card", "Carta"); }
    else if (COINS_AT.includes(at)) { className += " is-coin"; marks = <Coins className="ludo-mark" size={16} weight="fill" />; }
    else if (CALM_AT.includes(at)) { className += " is-calm"; marks = <Snowflake className="ludo-mark" size={16} weight="bold" />; label = t("冷静角", "Calm corner", "Rincón de calma"); }
    else if (flightOf) { className += ` is-flight ${side(flightOf)}`; marks = <AirplaneTilt className="ludo-mark" size={16} weight="fill" />; }
    else if (colour !== null) className += ` is-tone ${side(state.players[colour] || (colour ? rival : userId))}`;
    squares.push(square(`o${at}`, className, marks, label));
  }
  for (let index = 0; index < 32; index += 1) {
    const kind = innerKind(index);
    squares.push(square(`i${index}`, `ludo-square is-inner ${kind ? `is-${kind}` : ""}`, kind === "heart" ? <Heart className="ludo-mark" size={15} weight="fill" /> : kind === "coin" ? <Coins className="ludo-mark" size={15} weight="fill" /> : null, kind === "heart" ? t("爱心格", "Heart", "Corazón") : t("内圈", "Inner ring", "Anillo interior")));
  }
  GRASS.forEach((_, index) => squares.push(square(`g${index}`, "ludo-square is-plank", <Bridge className="ludo-mark" size={14} weight="bold" />, t("桥", "Bridge", "Puente"))));
  const lines = state.players.map((id, index) => {
    const [x1, y1] = shown(outerCell((START[index] + FLIGHT_FROM) % LOOP)), [x2, y2] = shown(outerCell((START[index] + FLIGHT_FROM + FLIGHT) % LOOP));
    // Curved in over the grass, so it doesn't cover the squares it flies past.
    const bend = (COLS - 1) / 2, cx = y1 + 0.5 + (bend - y1) * 0.55, cy = (x1 + x2) / 2 + 0.5;
    return <path key={id} className={`ludo-flight ${side(id)}`} d={`M ${y1 + 0.5} ${x1 + 0.5} Q ${cx} ${cy} ${y2 + 0.5} ${x2 + 0.5}`} fill="none" />;
  });

  const panel = (id: string, area: { gridRow: string; gridColumn: string }) => {
    const planes = state.planes[id] || [], home = planes.filter((plane) => plane.p >= HOME).length;
    return <div className={`ludo-panel ${side(id)} ${active && !legacy && match.turn === id ? "is-turn" : ""}`} style={area} data-testid={id === userId ? "ludo-me" : "ludo-them"}>
      <span className="ludo-panel-name">{id === userId ? t("你", "You", "Tú") : <>{opponent.picture && <img src={opponent.picture} alt="" />}{partnerName}</>}</span>
      <span className="ludo-panel-coins"><Coins size={14} weight="fill" />{coins(id)}</span>
      <span className="ludo-hangar">{planes.map((plane, index) => plane.p !== HANGAR
        ? <span key={index} className="ludo-slot">{plane.p >= HOME && <House size={14} weight="fill" />}</span>
        : id === userId && choices.some((choice) => choice.index === index)
          ? <button key={index} type="button" className="ludo-slot ludo-launch" onClick={() => void send({ type: "move", plane: index })} disabled={busy}>{planeIcon(id, index, 1, true)}</button>
          : <span key={index} className="ludo-slot">{planeIcon(id, index)}</span>)}</span>
      <span className="ludo-panel-tags">
        {home > 0 && <em><House size={12} weight="fill" />{home}/2</em>}
        {(state.charm?.[id] || 0) > 0 && <em><ShieldCheck size={12} weight="fill" />{state.charm[id]}</em>}
        {state.calm?.[id] && <em className="is-calm"><Snowflake size={12} weight="bold" />{t("冷静中", "Calm", "Calma")}</em>}
      </span>
    </div>;
  };

  const cardText = (id: string) => ({
    ahead3: t("前进 3 格", "Move 3 ahead", "Avanza 3"), back2: t("后退 2 格", "Back 2", "Retrocede 2"),
    gift50: t(`${name(rival)}送你 50 币`, `${partnerName} gives you 50`, `${partnerName} te da 50`), bonus80: t("捡到 80 币", "Found 80 coins", "Encuentras 80"),
    swap: t("和对方跑得最远的飞机换位置", "Swap places with their furthest plane", "Cambia de sitio con su avión más adelantado"),
    charm: t("护身符：下次被撞不回去", "A charm: the next bump won't send you back", "Un amuleto: el próximo choque no te devuelve"),
    photo: t("一起拍张合照", "A photo together", "Una foto juntos"), question: t("回答一个问题", "Answer a question", "Responde una pregunta"),
    upgrade: t("免费升级一个地点", "A free upgrade", "Una mejora gratis"), calm: t("去冷静角歇一回合", "Off to the calm corner for a turn", "Al rincón de calma un turno"),
  } as Record<string, string>)[id] || "";
  const placeName = (square?: number) => { const spot = square === undefined ? undefined : placeAt(square); return spot ? pick(spot.name) : ""; };
  const line = (entry: LogEntry) => {
    const who = name(entry.by), n = (entry.plane ?? 0) + 1, v = entry.value;
    const rolled = entry.by === userId ? t(`你掷出 ${v}`, `You rolled ${v}`, `Sacaste ${v}`) : t(`${who}掷出 ${v}`, `${who} rolled ${v}`, `${who} sacó ${v}`);
    switch (entry.kind) {
      case "launch": return `${rolled}${t(`，${n} 号起飞`, `: plane ${n} takes off`, `: despega el avión ${n}`)}`;
      case "forced": return t(`${who}三次没掷到 6，${n} 号照样起飞`, `${who}: no 6 in three tries, plane ${n} takes off anyway`, `${who}: sin 6 en tres intentos, el avión ${n} despega igual`);
      case "move": return `${rolled}${t(`，${n} 号走 ${v} 格`, `: plane ${n} moves ${v}`, `: el avión ${n} avanza ${v}`)}`;
      case "home": return t(`${who}的 ${n} 号到家了`, `${who}: plane ${n} is home`, `${who}: el avión ${n} llegó a casa`);
      case "jump": return t(`停在同色格，再跳 4 格`, `Own colour: hop 4 more`, `Su color: salta 4 más`);
      case "flight": return t(`沿虚线飞了 ${FLIGHT} 格！`, `Flew the dashed line, ${FLIGHT} squares!`, `¡Voló por la línea, ${FLIGHT} casillas!`);
      case "capture": return entry.by === userId ? t(`撞回了 ${partnerName} 的飞机！`, `You sent ${partnerName}'s plane back!`, `¡Mandaste de vuelta el avión de ${partnerName}!`) : t(`${partnerName}把你的飞机撞回去了`, `${partnerName} sent your plane back`, `${partnerName} mandó de vuelta tu avión`);
      case "charmed": return t(`${who}的护身符挡住了一次撞机`, `${who}'s charm stopped a bump`, `El amuleto de ${who} paró un choque`);
      case "coins": return t(`${who}捡到 ${entry.amount} 币`, `${who} picked up ${counted(entry.amount || 0, "coin", "coins")}`, `${who} recogió ${counted(entry.amount || 0, "moneda", "monedas")}`);
      case "buy": return t(`${who}买下了${placeName(entry.square)}`, `${who} bought the ${placeName(entry.square)}`, `${who} compró ${placeName(entry.square)}`);
      case "upgrade": return t(`${who}升级了${placeName(entry.square)}`, `${who} upgraded the ${placeName(entry.square)}`, `${who} mejoró ${placeName(entry.square)}`);
      case "rent": return t(`${who}在${placeName(entry.square)}付了 ${entry.amount} 币门票`, `${who} paid ${entry.amount} at the ${placeName(entry.square)}`, `${who} pagó ${entry.amount} en ${placeName(entry.square)}`);
      case "promise": return t(`${who}在${placeName(entry.square)}用一个小承诺抵了门票`, `${who} paid at the ${placeName(entry.square)} with a little promise`, `${who} pagó en ${placeName(entry.square)} con una promesa`);
      case "inner": return t(`${who}走上了爱心内圈`, `${who} took the heart ring`, `${who} tomó el anillo de corazones`);
      case "card": return t(`${who}抽到心动卡：${cardText(entry.card || "")}`, `${who} drew a heart card: ${cardText(entry.card || "")}`, `${who} sacó una carta: ${cardText(entry.card || "")}`);
      case "calm": return t(`${who}进了冷静角，歇一回合`, `${who} is in the calm corner for a turn`, `${who} está en el rincón de calma un turno`);
      case "calmed": return t(`${who}在冷静角歇了一回合`, `${who} sat out a turn in the calm corner`, `${who} esperó un turno en el rincón de calma`);
      case "bail": return t(`${who}说了句好听的，把对方保释出来了`, `${who} said something sweet and bailed the other out`, `${who} dijo algo bonito y sacó al otro`);
      case "try": return `${rolled}${t(`，还没起飞（${entry.tries}/3）`, `: no take-off yet (${entry.tries}/3)`, `: aún sin despegar (${entry.tries}/3)`)}`;
      case "pass": return `${rolled}${t("，这次走不了", ": no move this time", ": sin movimiento esta vez")}`;
      case "task": {
        if (entry.by === PET && entry.line !== undefined) { const [zh, en, es] = PET_LINES[entry.line] || PET_LINES[0]; return t(zh, en, es).replace("{name}", partnerName); }
        return entry.done ? t(`${who}完成了一个小任务 ♡`, `${who} did a little task ♡`, `${who} hizo una tarea ♡`) : t(`${who}跳过了一个小任务`, `${who} skipped a little task`, `${who} saltó una tarea`);
      }
      default: return "";
    }
  };
  const recent = state.log.slice(-1);

  const pending = state.pending, myChoice = active && !legacy && state.phase === "decide" && pending?.by === userId;
  const decision = myChoice && pending ? (() => {
    const choose = (choice: string) => () => void send({ type: "decide", choice });
    if (pending.kind === "buy") return { title: t(`${placeName(pending.square)}还没人买`, `Nobody owns the ${placeName(pending.square)}`, `Nadie tiene ${placeName(pending.square)}`), text: t(`花 ${pending.price} 币买下？以后 TA 停在这里要付你门票。`, `Buy it for ${pending.price}? Whenever ${partnerName} stops here, they pay you.`, `¿Comprarla por ${pending.price}? Cuando ${partnerName} caiga aquí, te paga.`), actions: [{ label: t(`买下（${pending.price}）`, `Buy (${pending.price})`, `Comprar (${pending.price})`), on: choose("buy"), primary: true }, { label: t("不买", "Skip", "No"), on: choose("skip") }] };
    if (pending.kind === "upgrade") return { title: t(`升级你的${placeName(pending.square)}？`, `Upgrade your ${placeName(pending.square)}?`, `¿Mejorar tu ${placeName(pending.square)}?`), text: t(`花 ${UPGRADE} 币，门票从 ${rentOf(placeAt(pending.square!)!.price, 1)} 涨到 ${rentOf(placeAt(pending.square!)!.price, 2)}。`, `${counted(UPGRADE, "coin", "coins")}; the rent goes from ${rentOf(placeAt(pending.square!)!.price, 1)} to ${rentOf(placeAt(pending.square!)!.price, 2)}.`, `${counted(UPGRADE, "moneda", "monedas")}; la entrada pasa de ${rentOf(placeAt(pending.square!)!.price, 1)} a ${rentOf(placeAt(pending.square!)!.price, 2)}.`), actions: [{ label: t("升级", "Upgrade", "Mejorar"), on: choose("upgrade"), primary: true }, { label: t("先不", "Not now", "Ahora no"), on: choose("skip") }] };
    if (pending.kind === "rent") return { title: t(`${placeName(pending.square)}是${partnerName}的`, `The ${placeName(pending.square)} is ${partnerName}'s`, `${placeName(pending.square)} es de ${partnerName}`), text: t(`门票 ${pending.rent} 币${coins(userId) < (pending.rent || 0) ? `（你只有 ${coins(userId)}，付光为止）` : ""}。`, `The rent is ${pending.rent}${coins(userId) < (pending.rent || 0) ? ` (you have ${coins(userId)}; you pay what you have)` : ""}.`, `La entrada cuesta ${pending.rent}${coins(userId) < (pending.rent || 0) ? ` (tienes ${coins(userId)}; pagas lo que tienes)` : ""}.`), actions: [{ label: t(`付 ${Math.min(pending.rent || 0, coins(userId))} 币`, `Pay ${Math.min(pending.rent || 0, coins(userId))}`, `Pagar ${Math.min(pending.rent || 0, coins(userId))}`), on: choose("coins"), primary: true }, ...(opponent.pet ? [] : [{ label: t("用一个小承诺抵", "Pay with a little promise", "Pagar con una promesa"), on: choose("promise") }])] };
    return { title: t("走爱心内圈吗？", "Take the heart ring?", "¿Tomar el anillo de corazones?"), text: t("内圈一样长，有爱心任务和 60 币格，但没有地可买、也不用付门票。", "The same length: hearts and 60-coin squares, nothing to buy and no rent to pay.", "Igual de largo: corazones y casillas de 60, nada que comprar ni entradas que pagar."), actions: [{ label: t("走内圈", "Heart ring", "Anillo"), on: choose("inner"), primary: true }, { label: t("留在外圈", "Stay outside", "Quedarme fuera"), on: choose("outer") }] };
  })() : null;

  const Face = FACES[(rolling ? face : (state.die?.value || 6) - 1)] || DiceSix;
  const waitingOn = state.phase === "decide" && pending && pending.by !== userId ? t(`${partnerName}在想…`, `${partnerName} is deciding…`, `${partnerName} está decidiendo…`) : "";
  const status = legacy ? t("飞行棋换了新地图，这局是旧棋盘，没法接着下了。", "Ludo has a new map; this game is on the old board and can't go on.", "El parchís tiene un mapa nuevo; esta partida es del tablero antiguo.")
    : !active ? state.winner === userId ? (state.resignedBy ? t(`${partnerName} 认输了，你赢了！`, `${partnerName} resigned. You win!`, `${partnerName} se rindió. ¡Ganaste!`) : t("两架飞机都到家了，你赢了！", "Both planes home. You win!", "¡Tus dos aviones llegaron! ¡Ganaste!"))
      : state.resignedBy === userId ? t("你认输了，下一局再来。", "You resigned. Next game!", "Te rendiste. ¡A la próxima!") : t(`${partnerName} 先到家，赢了这局。`, `${partnerName} got home first and won.`, `${partnerName} llegó primero y ganó.`)
    : rolling ? t("骰子转呀转…", "Rolling…", "Rodando…")
    : waitingOn || (state.phase === "task" ? (state.task?.by === userId ? t("来做个小任务", "A little task for you", "Una tarea para ti") : t(`${partnerName} 在做小任务…`, `${partnerName} is doing a little task…`, `${partnerName} hace una tarea…`))
    : myChoice ? t("做个选择", "Your choice", "Tu decisión")
    : choosing ? t(`掷出 ${value}，选一架飞机`, `You rolled ${value}: pick a plane`, `Sacaste ${value}: elige un avión`)
    : mine ? (state.calm?.[userId] ? t("在冷静角：掷出 6 才能马上出来", "Calm corner: only a 6 gets you out now", "Rincón de calma: solo un 6 te saca ya") : state.die?.by === userId && state.die.value === 6 ? t("掷出 6，再掷一次！", "A 6: roll again!", "¡Un 6: tira otra vez!") : t("轮到你了，点中间的骰子", "Your turn: tap the die", "Te toca: toca el dado"))
    : t(`等 ${partnerName} 掷骰子…`, `Waiting for ${partnerName}…`, `Esperando a ${partnerName}…`));

  // The richer one at the end gets tonight's little privilege (it doesn't change who won).
  const richer = state.players.reduce((best, id) => coins(id) > coins(best) ? id : best, state.players[0]);
  const tie = state.players.every((id) => coins(id) === coins(richer));

  return <div className="ludo">
    <p className={`gomoku-status ${!active && state.winner === userId ? "is-win" : ""}`} role="status" data-testid="ludo-status">{status}</p>
    <div className="ludo-board" role="group" aria-label={t("飞行棋棋盘", "Ludo board", "Tablero de parchís")} data-testid="ludo-board">
      {/* The grass between the rings (the same either way up). */}
      {[["2 / 17", "2 / 3"], ["2 / 17", "8 / 9"], ["2 / 3", "2 / 9"], ["16 / 17", "2 / 9"]].map(([gridRow, gridColumn]) => <span key={gridRow + gridColumn} className="ludo-grass" style={{ gridRow, gridColumn }} />)}
      {squares}
      {panel(rival, { gridRow: "4 / 7", gridColumn: "4 / 7" })}
      <div className="ludo-news" style={{ gridRow: "7 / 9", gridColumn: "4 / 7" }} aria-live="polite">
        {state.card && state.card.n === state.rolls && <p className="ludo-card"><Sparkle size={14} weight="fill" />{cardText(state.card.id)}</p>}
        {recent.map((entry, index) => <p key={`${entry.n}-${index}`} className={side(entry.by)}>{line(entry)}</p>)}
      </div>
      <div className="ludo-dice" style={{ gridRow: "9 / 11", gridColumn: "4 / 7" }}>
        <button type="button" className={`ludo-die ${rolling ? "is-rolling" : ""} ${mine && state.phase === "roll" ? "is-ready" : ""}`} disabled={!mine || state.phase !== "roll" || busy} onClick={() => void roll()} aria-label={t("掷骰子", "Roll the die", "Tirar el dado")} data-testid="ludo-roll"><Face size={46} weight="fill" /></button>
      </div>
      {panel(userId, { gridRow: "11 / 15", gridColumn: "4 / 7" })}
      <svg className="ludo-lines" viewBox={`0 0 ${COLS} ${ROWS}`} aria-hidden="true">{lines}</svg>

      {decision && <section className="ludo-sheet" data-testid="ludo-decide">
        <b>{decision.title}</b><p>{decision.text}</p>
        <div className="ludo-sheet-actions">{decision.actions.map((action, index) => <button key={index} type="button" className={action.primary ? "game-primary" : "game-quiet"} disabled={busy} onClick={action.on} data-testid={`ludo-decide-${index}`}>{action.label}</button>)}</div>
      </section>}
      {choices.length > 1 && <section className="ludo-sheet is-small" data-testid="ludo-choose">
        <b>{t(`掷出 ${value}，走哪架？`, `You rolled ${value}: which plane?`, `Sacaste ${value}: ¿qué avión?`)}</b>
        <div className="ludo-sheet-actions">{choices.map((choice) => <button key={choice.index} type="button" className="game-primary" disabled={busy} onClick={() => void send({ type: "move", plane: choice.index })} data-testid={`ludo-move-${choice.index}`}>{choice.plane.p === HANGAR ? t(`${choice.index + 1} 号起飞`, `#${choice.index + 1} take off`, `#${choice.index + 1} despega`) : choice.to === HOME ? t(`${choice.index + 1} 号回家`, `#${choice.index + 1} home`, `#${choice.index + 1} a casa`) : t(`${choice.index + 1} 号 +${value}`, `#${choice.index + 1} +${value}`, `#${choice.index + 1} +${value}`)}</button>)}</div>
      </section>}
      {state.phase === "task" && state.task && active && !legacy && <section className="ludo-sheet is-task" aria-live="polite" data-testid="ludo-task">
        <Heart size={20} weight="fill" />
        <b>{state.task.by === userId ? t("你的小任务", "Your little task", "Tu tarea") : t(`${partnerName} 的小任务`, `${partnerName}'s little task`, `La tarea de ${partnerName}`)}{state.task.pay ? t(`（做到 +${state.task.pay} 币）`, ` (+${state.task.pay} if done)`, ` (+${state.task.pay} si la haces)`) : ""}</b>
        <p>{textOf(state.task.text) || t("做一件让 TA 开心的小事。", "Do one small thing that makes your partner smile.", "Haz algo pequeño que haga sonreír a tu pareja.")}</p>
        {state.task.by === userId ? <div className="ludo-sheet-actions">
          <button type="button" className="game-primary" disabled={busy} onClick={() => void send({ type: "task", done: true })} data-testid="ludo-task-done"><Check size={16} weight="bold" />{t("做到了", "Done", "Hecho")}</button>
          <button type="button" className="game-quiet" disabled={busy} onClick={() => void send({ type: "task", done: false })} data-testid="ludo-task-skip"><SkipForward size={16} />{t("跳过", "Skip", "Saltar")}</button>
        </div> : <span className="game-note">{t("TA 做完就继续。", "The game goes on once they're done.", "El juego sigue cuando termine.")}</span>}
      </section>}
    </div>

    {active && !legacy && state.calm?.[rival] && !opponent.pet && <div className="game-actions"><button type="button" className="game-quiet" disabled={busy} onClick={() => void send({ type: "bail" })} data-testid="ludo-bail"><HandHeart size={16} />{t(`对 ${partnerName} 说句好听的，保释 TA`, `Say something sweet to bail ${partnerName} out`, `Dile algo bonito a ${partnerName} para sacarle`)}</button></div>}
    {!active && !legacy && <section className="ludo-end">
      <p>{tie ? t(`爱心币打平（${coins(userId)}）。`, `Coins are level (${coins(userId)}).`, `Empate en monedas (${coins(userId)}).`) : t(`${name(richer)}的爱心币最多（${coins(richer)}），今晚的小特权归${richer === userId ? "你" : "TA"}：选电影或者点外卖。`, `${richer === userId ? "You have" : `${partnerName} has`} the most coins (${coins(richer)}): ${richer === userId ? "you pick" : "they pick"} tonight's film or takeaway.`, `${richer === userId ? "Tienes" : `${partnerName} tiene`} más monedas (${coins(richer)}): ${richer === userId ? "eliges tú" : "elige"} la peli o la cena de esta noche.`)}</p>
      {(state.promises || []).length > 0 && <ul>{state.promises.map((item, index) => <li key={index}>{t(`${name(item.from)}欠${name(item.to)}：${textOf(item.text)}`, `${name(item.from)} owes ${name(item.to)}: ${textOf(item.text)}`, `${name(item.from)} le debe a ${name(item.to)}: ${textOf(item.text)}`)}</li>)}</ul>}
      <div className="game-actions"><button type="button" className="game-primary" onClick={onRematch} data-testid="game-rematch"><ArrowsClockwise size={16} />{t("再来一局", "Play again", "Otra partida")}</button></div>
    </section>}
    {active && !legacy && <div className="game-actions">
      <button type="button" className={`game-quiet ${resigning ? "is-confirm" : ""}`} onClick={() => { if (!resigning) { setResigning(true); return; } setResigning(false); void send({ type: "resign" }); }} onBlur={() => setResigning(false)} data-testid="ludo-resign"><Flag size={16} />{resigning ? t("确定认输", "Really resign", "Rendirme de verdad") : t("认输", "Resign", "Rendirse")}</button>
    </div>}
    {active && !legacy && !state.tasksReady && <p className="game-note">{t("Pinky 正在准备爱心格的小任务…", "Pinky is writing the hearts' little tasks…", "Pinky está preparando las tareas de los corazones…")}</p>}
  </div>;
}
