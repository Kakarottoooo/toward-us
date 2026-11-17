import { ArrowClockwise, Check, TreasureChest } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { localized, type Language } from "../../i18n";
import type { ScreenProps } from "./MatchScreen";
import "./treasure-hunt.css";

const sceneNames = {
  camp: ["林间营地", "Forest campsite", "Campamento en el bosque"],
  beach: ["海边午后", "Beach afternoon", "Tarde en la playa"],
  market: ["周末集市", "Weekend market", "Mercado de fin de semana"],
  garden: ["秘密花园", "Secret garden", "Jardín secreto"],
  station: ["出发前的车站", "Railway station", "Estación de tren"],
  picnic: ["公园野餐", "Picnic in the park", "Pícnic en el parque"],
} as const;

const things = {
  tent: ["⛺", "帐篷", "Tent", "Tienda de campaña"],
  lantern: ["🏮", "灯笼", "Lantern", "Farol"],
  fire: ["🔥", "篝火", "Campfire", "Fogata"],
  tree: ["🌲", "松树", "Pine tree", "Pino"],
  boot: ["🥾", "登山靴", "Hiking boot", "Bota de senderismo"],
  mug: ["☕", "杯子", "Mug", "Taza"],
  compass: ["🧭", "指南针", "Compass", "Brújula"],
  backpack: ["🎒", "背包", "Backpack", "Mochila"],
  map: ["🗺️", "地图", "Map", "Mapa"],
  shell: ["🐚", "贝壳", "Shell", "Concha"],
  kite: ["🪁", "风筝", "Kite", "Cometa"],
  sunhat: ["👒", "草帽", "Sun hat", "Sombrero de sol"],
  bucket: ["🪣", "沙滩桶", "Bucket", "Cubo"],
  lemon: ["🍋", "柠檬", "Lemon", "Limón"],
  boat: ["⛵", "帆船", "Sailboat", "Velero"],
  camera: ["📷", "相机", "Camera", "Cámara"],
  towel: ["🧺", "毯子", "Blanket", "Manta"],
  basket: ["🧺", "篮子", "Basket", "Cesta"],
  apple: ["🍎", "苹果", "Apple", "Manzana"],
  flowers: ["💐", "花束", "Bouquet", "Ramo de flores"],
  baguette: ["🥖", "面包", "Bread", "Pan"],
  tea: ["🍵", "茶", "Tea", "Té"],
  jar: ["🍯", "蜂蜜", "Honey", "Miel"],
  book: ["📔", "书", "Book", "Libro"],
  butterfly: ["🦋", "蝴蝶", "Butterfly", "Mariposa"],
  wateringcan: ["🪴", "洒水壶", "Watering can", "Regadera"],
  bee: ["🐝", "蜜蜂", "Bee", "Abeja"],
  leaf: ["🍃", "叶子", "Leaf", "Hoja"],
  ticket: ["🎫", "车票", "Ticket", "Billete"],
  suitcase: ["🧳", "行李箱", "Suitcase", "Maleta"],
  clock: ["🕰️", "钟", "Clock", "Reloj"],
  umbrella: ["☂️", "雨伞", "Umbrella", "Paraguas"],
} as const;

const stamps = {
  star: ["✦", "星星", "Star", "Estrella"],
  moon: ["☾", "月亮", "Moon", "Luna"],
  heart: ["♥", "爱心", "Heart", "Corazón"],
} as const;

type Item = keyof typeof things;
type Stamp = keyof typeof stamps;
type Tile = { item: Item; stamp: Stamp };
type Clue = { kind: "row" | "column"; value: number } | { kind: "stamp"; value: Stamp } | { kind: "near"; value: Item };
type HuntView = {
  scene: keyof typeof sceneNames; tiles: Tile[];
  clue: Clue; partnerClue: Clue | null; shared: boolean;
  mine: number | null; partnerReady: boolean; partnerPick: number | null;
  tried: number[]; attempts: number; result: "found" | "missed" | null; answer?: number;
};

type Translate = (zh: string, en: string, es: string) => string;

function thingName(t: Translate, item: Item) {
  const [, zh, en, es] = things[item];
  return t(zh, en, es);
}

function clueText(t: Translate, clue: Clue) {
  if (clue.kind === "row") return [
    t("宝物藏在最上面一行。", "The treasure is in the top row.", "El tesoro está en la fila de arriba."),
    t("宝物藏在中间一行。", "The treasure is in the middle row.", "El tesoro está en la fila del medio."),
    t("宝物藏在最下面一行。", "The treasure is in the bottom row.", "El tesoro está en la fila de abajo."),
  ][clue.value];
  if (clue.kind === "column") return [
    t("宝物藏在最左边一列。", "The treasure is in the left column.", "El tesoro está en la columna izquierda."),
    t("宝物藏在中间一列。", "The treasure is in the middle column.", "El tesoro está en la columna del medio."),
    t("宝物藏在最右边一列。", "The treasure is in the right column.", "El tesoro está en la columna derecha."),
  ][clue.value];
  if (clue.kind === "stamp") {
    const [, zh, en, es] = stamps[clue.value];
    return t(`宝物所在的格子盖着「${zh}」印章。`, `The treasure is on a tile stamped “${en}”.`, `El tesoro está en una casilla con el sello «${es}».`);
  }
  if (clue.kind === "near") {
    const name = thingName(t, clue.value);
    return t(`宝物紧挨「${name}」，上下左右都算。`, `The treasure is one space from “${name}”, up, down, left or right.`, `El tesoro está a una casilla de «${name}»: arriba, abajo, a la izquierda o a la derecha.`);
  }
}

export function TreasureHunt({ match, language, partnerName, act, onRematch }: ScreenProps<HuntView>) {
  const t: Translate = (zh, en, es) => localized(language, zh, en, es);
  const state = match.state;
  const [draft, setDraft] = useState<{ index: number; attempt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const inFlight = useRef(false);
  const selected = draft?.attempt === state.tried.length ? draft.index : state.mine;
  const attemptsLeft = state.attempts - state.tried.length;
  const done = match.status !== "active";
  const status = state.result === "found" ? t("你们找到宝物了！", "You found the treasure!", "¡Encontraron el tesoro!")
    : state.result === "missed" ? t("地图揭晓了宝物的位置。", "The map revealed the treasure.", "El mapa reveló dónde estaba el tesoro.")
    : state.mine !== null && state.partnerPick !== null && state.mine !== state.partnerPick
      ? t("你们选了不同的格子。聊一下，再确定同一格。", "You picked different tiles. Talk it over and agree on one.", "Eligieron casillas distintas. Hablen y pónganse de acuerdo.")
      : state.mine !== null ? t(`等 ${partnerName} 也选一个格子。`, `Waiting for ${partnerName} to pick a tile.`, `Esperando a que ${partnerName} elija una casilla.`)
        : state.tried.length ? t("刚才那格是空的。用线索再试一次。", "That tile was empty. Use your clues and try again.", "Esa casilla estaba vacía. Usen las pistas e inténtenlo de nuevo.")
          : state.partnerReady ? t(`${partnerName} 已选好，轮到你。`, `${partnerName} picked a tile. Your turn.`, `${partnerName} ya eligió. Te toca.`)
            : t("选中同一格，就一起打开。", "Pick the same tile to open it together.", "Elijan la misma casilla para abrirla juntos.");

  async function play(action: Record<string, unknown>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try { await act(action); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <section className="treasure-hunt" data-scene={state.scene} data-testid="treasure-hunt" aria-label={t("寻宝地图", "Treasure map", "Mapa del tesoro")}>
    <header className="hunt-heading">
      <div><TreasureChest size={20} weight="duotone" aria-hidden="true" /><strong>{t(sceneNames[state.scene][0], sceneNames[state.scene][1], sceneNames[state.scene][2])}</strong></div>
      {!done && <span>{t(`还可试 ${attemptsLeft} 次`, `${attemptsLeft} ${attemptsLeft === 1 ? "try" : "tries"} left`, `Quedan ${attemptsLeft} ${attemptsLeft === 1 ? "intento" : "intentos"}`)}</span>}
    </header>
    <div className="hunt-clue">
      <div><small>{t("你的线索", "Your clue", "Tu pista")}</small><p>{clueText(t, state.clue)}</p></div>
      {!done && <button type="button" className="hunt-share" disabled={busy || state.shared} onClick={() => void play({ type: "share" })} data-testid="hunt-share">
        {state.shared ? t("已亮给 TA", "Clue shared", "Pista compartida") : t("给 TA 看", "Show partner", "Mostrar a tu pareja")}
      </button>}
    </div>
    {state.partnerClue && <div className="hunt-clue is-partner" data-testid="hunt-partner-clue">
      <div><small>{t("TA 的线索", "Partner’s clue", "Pista de tu pareja")}</small><p>{clueText(t, state.partnerClue)}</p></div>
    </div>}
    <div className="hunt-grid" role="group" aria-label={t("九格地图", "Nine-tile map", "Mapa de nueve casillas")}>
      {state.tiles.map((tile, index) => {
        const isTried = state.tried.includes(index), answer = state.answer === index;
        const [, zh, en, es] = stamps[tile.stamp], stampName = t(zh, en, es);
        const [, thingZh, thingEn, thingEs] = things[tile.item], name = t(thingZh, thingEn, thingEs);
        return <button key={tile.item} type="button" className={`hunt-tile${selected === index ? " is-selected" : ""}${isTried ? " is-empty" : ""}${answer ? " is-treasure" : ""}`}
          aria-pressed={selected === index} aria-label={`${name} · ${stampName}${answer ? t(" · 宝物在这里", " · treasure here", " · aquí está el tesoro") : isTried ? t(" · 空", " · empty", " · vacía") : ""}`}
          disabled={done || isTried || busy} onClick={() => setDraft({ index, attempt: state.tried.length })} data-testid="hunt-tile">
          <span className="hunt-stamp" data-stamp={tile.stamp} aria-hidden="true">{stamps[tile.stamp][0]}</span>
          <span aria-hidden="true" className="hunt-icon">{answer ? "💎" : things[tile.item][0]}</span>
          <span className="hunt-name">{name}</span>
          {!done && state.partnerPick === index && <small className="hunt-partner-mark">{t("TA", "Partner", "Tu pareja")}</small>}
        </button>;
      })}
    </div>
    <p className="hunt-status" role="status" data-testid="hunt-result">{status}</p>
    {done ? <button type="button" className="hunt-primary" onClick={onRematch}><ArrowClockwise size={16} />{t("下一张地图", "Next map", "Siguiente mapa")}</button> :
      <div className="hunt-actions">
        <button type="button" className="hunt-primary" disabled={busy || selected === null || selected === state.mine || state.tried.includes(selected)}
          onClick={() => void play({ type: "pick", index: selected, attempt: state.tried.length })} data-testid="hunt-confirm"><Check size={16} />
          {t("就选这格", "Pick this tile", "Elegir esta casilla")}
        </button>
        <button type="button" className="hunt-end" disabled={busy} onClick={() => {
          if (!confirmEnd) setConfirmEnd(true);
          else { setConfirmEnd(false); void play({ type: "abandon" }); }
        }} onBlur={() => setConfirmEnd(false)}>{confirmEnd ? t("确认结束", "Confirm ending", "Confirmar fin") : t("结束这局", "End game", "Terminar partida")}</button>
      </div>}
  </section>;
}

