import { ArrowsClockwise, Butterfly, Check, Cloud, Coffee, Diamond, Fire, Flower, Heart, Leaf, MoonStars, Sparkle, Star, Sun, Umbrella, X } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { localized } from "../../i18n";
import type { ScreenProps } from "./MatchScreen";
import "./memory-pairs.css";

const faces = {
  moon: [MoonStars, "月亮", "Moon", "Luna"], sun: [Sun, "太阳", "Sun", "Sol"],
  heart: [Heart, "爱心", "Heart", "Corazón"], cloud: [Cloud, "云朵", "Cloud", "Nube"],
  flower: [Flower, "花朵", "Flower", "Flor"], star: [Star, "星星", "Star", "Estrella"],
  butterfly: [Butterfly, "蝴蝶", "Butterfly", "Mariposa"], diamond: [Diamond, "钻石", "Diamond", "Diamante"],
  umbrella: [Umbrella, "雨伞", "Umbrella", "Paraguas"], leaf: [Leaf, "叶子", "Leaf", "Hoja"],
  flame: [Fire, "火苗", "Flame", "Llama"], coffee: [Coffee, "咖啡", "Coffee", "Café"],
} as const;

type MemoryView = {
  tiles: { face: keyof typeof faces | null; status: "hidden" | "open" | "matched" }[];
  found: number; pairs: number; attempts: number; best: number | null; revision: number;
  last: "match" | "miss" | null; needsDismiss: boolean; secondCard: boolean;
};

export function MemoryPairs({ match, language, userId, partnerName, act, onRematch }: ScreenProps<MemoryView>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const { tiles, found, pairs, attempts, best, revision, last, needsDismiss, secondCard } = match.state;
  const finished = match.status === "finished";
  const myTurn = !finished && match.turn === userId;
  const [pending, setPending] = useState(false);
  const [ending, setEnding] = useState(false);
  const sending = useRef(false);

  async function move(type: "flip" | "continue" | "abandon", index?: number) {
    if (sending.current) return;
    sending.current = true;
    setPending(true);
    try { await act({ type, revision, ...(index === undefined ? {} : { index }) }); }
    finally { sending.current = false; setPending(false); }
  }

  const turn = myTurn ? t("轮到你", "Your turn", "Te toca") : t(`轮到 ${partnerName}`, `${partnerName}'s turn`, `Turno de ${partnerName}`);
  const status = finished ? t("所有图案都配对了。", "You matched every pair.", "Encontraron todas las parejas.")
    : needsDismiss ? t("这两张不一样。记住位置再盖回去。", "These two don't match. Remember where they are before turning them back.", "Estas dos no coinciden. Recuerden dónde están antes de taparlas.")
    : secondCard ? t("再翻一张，看看能不能配成一对。", "Flip a second card to look for its pair.", "Volteen otra carta para buscar su pareja.")
    : last === "match" ? t("配成一对！换人继续。", "A pair! Swap turns.", "¡Una pareja! Cambia el turno.")
    : t("翻两张牌，找到相同的图案。", "Flip two cards to find matching pictures.", "Volteen dos cartas para encontrar dibujos iguales.");

  return <section className="memory-pairs" data-testid="memory-pairs">
    <div className="memory-score">
      <div>
        <small>{t("找到的配对", "Pairs found", "Parejas encontradas")}</small>
        <strong data-testid="memory-found">{found}<span>/{pairs}</span></strong>
      </div>
      <div className="memory-score-right">
        <span data-testid="memory-attempts">{t(`${attempts} 次尝试`, attempts === 1 ? "1 try" : `${attempts} tries`, attempts === 1 ? "1 intento" : `${attempts} intentos`)}</span>
        <div className="memory-steps" aria-hidden="true">{Array.from({ length: pairs }, (_, index) => <i className={index < found ? "is-found" : ""} key={index} />)}</div>
      </div>
    </div>
    <div className="memory-turn" data-side={myTurn ? "me" : "them"} role="status" data-testid="memory-turn">
      <strong>{finished ? t("配对完成", "All matched", "Tablero completo") : turn}</strong>
      <p>{status}</p>
    </div>
    <div className="memory-grid" role="group" aria-label={t("翻牌区", "Memory board", "Tablero de memoria")}>
      {tiles.map(({ face, status: tileState }, index) => {
        const [Icon, zh, en, es] = face ? faces[face] : [Sparkle, "盖着", "Face down", "Boca abajo"] as const;
        const name = t(zh, en, es);
        const description = t(`第 ${index + 1} 张：${name}`, `Card ${index + 1}: ${name}`, `Carta ${index + 1}: ${name}`);
        const matched = tileState === "matched";
        return <button type="button" key={index} className="memory-tile" data-state={tileState} data-face={face || undefined}
          data-testid={`memory-tile-${index}`} aria-label={matched ? t(`${description}，已配对`, `${description}, matched`, `${description}, emparejada`) : description}
          disabled={pending || !myTurn || needsDismiss || tileState !== "hidden"} onClick={() => void move("flip", index)}>
          <Icon weight={face ? "duotone" : "fill"} className="memory-glyph" aria-hidden="true" />
          <span className="memory-position" aria-hidden="true">{index + 1}</span>
          {matched && <Check weight="bold" className="memory-mark" aria-hidden="true" />}
        </button>;
      })}
    </div>
    {finished ? <div className="memory-finished" data-testid="memory-result">
      {best !== null && <p>{attempts < best ? t("你们刷新了最快配对纪录！", "You beat your best round!", "¡Superaron su mejor partida!")
        : t(`你们的最佳纪录是 ${best} 次。`, `Your best round took ${best} tries.`, `Su mejor partida fue de ${best} intentos.`)}</p>}
      <button type="button" className="game-primary" onClick={onRematch} data-testid="memory-rematch"><ArrowsClockwise size={18} />{t("再来一局", "Play again", "Otra partida")}</button>
    </div> : <div className="memory-controls">
      {needsDismiss && myTurn && <button type="button" className="game-primary" disabled={pending} onClick={() => void move("continue")} data-testid="memory-continue">
        {t("盖回去，继续", "Turn them back", "Tapar y seguir")}
      </button>}
      <button type="button" className="game-quiet" disabled={pending} onBlur={() => setEnding(false)}
        onClick={() => ending ? void move("abandon") : setEnding(true)} data-testid="memory-end">
        {!ending && <X size={16} aria-hidden="true" />}{ending ? t("确定结束这局？", "End this round?", "¿Terminar esta partida?") : t("结束这局", "End round", "Terminar partida")}
      </button>
    </div>}
  </section>;
}
