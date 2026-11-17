import { ArrowClockwise, Cards, Plus, X } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { localized } from "../../i18n";
import type { ScreenProps } from "./MatchScreen";
import "./arcade-table.css";

const suits = { hearts: ["♥", "红桃", "hearts", "corazones"], diamonds: ["♦", "方片", "diamonds", "diamantes"], clubs: ["♣", "梅花", "clubs", "tréboles"], spades: ["♠", "黑桃", "spades", "picas"] } as const;
type Suit = keyof typeof suits;
type Card = { suit: Suit; rank: number; id: string };
type EightState = { hand: Card[]; other: Card[] | null; otherCount: number; top: Card; suit: Suit; stack: number; canDraw: boolean; canPass: boolean; legal: string[]; last: { type: "play" | "draw" | "pass"; by: string } | null; winner: string | null; revision: number };
const ranks = (number: number) => number === 1 ? "A" : number === 11 ? "J" : number === 12 ? "Q" : number === 13 ? "K" : String(number);
const red = (suit: Suit) => suit === "hearts" || suit === "diamonds";

function Face({ card }: { card: Card }) {
  return <span className={`eight-face${red(card.suit) ? " is-red" : ""}`} aria-hidden="true"><b>{ranks(card.rank)}</b><i>{suits[card.suit][0]}</i></span>;
}

export function CrazyEights({ match, language, userId, partnerName, act, onRematch }: ScreenProps<EightState>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const state = match.state;
  const label = (suit: Suit) => t(suits[suit][1], suits[suit][2], suits[suit][3]);
  const cardLabel = (card: Card) => `${ranks(card.rank)} · ${label(card.suit)}`;
  const [wild, setWild] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mine = match.turn === userId && match.status === "active";

  async function move(type: "play" | "draw" | "pass", cardId?: string, suit?: Suit) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try { if (await act({ type, cardId, suit, revision: state.revision })) setWild(null); }
    finally { pending.current = false; setBusy(false); }
  }

  return <section className="crazy-eights" data-testid="crazy-eights">
    <div className="eight-felt">
      <div className="eight-player"><Cards size={19} aria-hidden="true" /><b>{partnerName}</b><span>{t(`还剩 ${state.otherCount} 张`, `${state.otherCount} left`, `Le quedan ${state.otherCount}`)}</span></div>
      <div className="eight-piles">
        <div className="eight-pile" aria-label={t("抽牌堆", "Draw pile", "Mazo")}><span className="eight-back" aria-hidden="true">{state.stack}</span><small>{t("可抽的牌", "Draw pile", "Mazo")}</small></div>
        <div className="eight-pile" aria-label={t(`桌面牌 ${cardLabel(state.top)}`, `Top card ${cardLabel(state.top)}`, `Carta en mesa ${cardLabel(state.top)}`)}><Face card={state.top} /><small>{t("桌面牌", "Top card", "Carta en mesa")}</small></div>
        <div className="eight-pile"><span className={`eight-suit${red(state.suit) ? " is-red" : ""}`} aria-hidden="true">{suits[state.suit][0]}</span><small>{label(state.suit)}</small></div>
      </div>
      <p role="status">{state.winner ? t("这局打完了", "Round complete", "Partida terminada") : mine ? t("轮到你了", "Your turn", "Te toca") : t(`等 ${partnerName} 出牌`, `Waiting for ${partnerName}`, `Esperando a ${partnerName}`)}</p>
    </div>
    {!state.winner && <>
      <div className="eight-hand" role="group" aria-label={t("你的牌", "Your hand", "Tus cartas")}>
        {state.hand.map((card) => <button type="button" key={card.id} className="eight-card-button" disabled={!mine || busy || !state.legal.includes(card.id)}
          data-testid={`eight-card-${card.id}`} aria-label={cardLabel(card)} onClick={() => card.rank === 8 ? setWild(card.id) : void move("play", card.id)}><Face card={card} /></button>)}
      </div>
      {wild && mine ? <div className="eight-wild"><b>{t("8 可以换花色", "Choose a suit for your 8", "Elige el palo para tu 8")}</b><div>
        {(Object.keys(suits) as Suit[]).map((suit) => <button key={suit} type="button" className={`eight-suit${red(suit) ? " is-red" : ""}`} disabled={busy}
          data-testid={`eight-suit-${suit}`} aria-label={label(suit)} onClick={() => void move("play", wild, suit)}>{suits[suit][0]}</button>)}
        <button type="button" className="game-quiet" disabled={busy} onClick={() => setWild(null)} aria-label={t("取消", "Cancel", "Cancelar")}><X size={18} /></button>
      </div></div> : mine ? <div className="arcade-table-actions">
        <button type="button" className="game-primary" disabled={busy || !state.canDraw} onClick={() => void move("draw")} data-testid="eight-draw"><Plus size={17} />{t("抽一张", "Draw one", "Roba una")}</button>
        <button type="button" className="game-quiet" disabled={busy || !state.canPass} onClick={() => void move("pass")} data-testid="eight-pass">{t("这轮跳过", "Pass", "Pasar")}</button>
      </div> : null}
      {state.last?.by !== userId && state.last?.type === "draw" && <p className="arcade-table-note">{t(`${partnerName} 抽了一张。`, `${partnerName} drew a card.`, `${partnerName} robó una carta.`)}</p>}
      <p className="arcade-table-note">{t("接同花色或同数字，8 可以换花色。先出完手牌就赢。", "Match the suit or rank. An 8 lets you change the suit. First out wins.", "Iguala el palo o el número. Un 8 cambia el palo. Gana quien se quede sin cartas.")}</p>
    </>}
    {state.winner && <div className="arcade-table-outcome" role="status" data-testid="eight-result">
      <strong>{state.winner === "tie" ? t("打成平手", "It's a tie", "Empate") : state.winner === userId ? t("你赢了！", "You won!", "¡Ganaste!") : t(`${partnerName} 赢了！`, `${partnerName} won!`, `¡Ganó ${partnerName}!`)}</strong>
      <button type="button" className="game-primary" onClick={onRematch} data-testid="eight-rematch"><ArrowClockwise size={17} />{t("再发一次牌", "Deal again", "Repartir otra vez")}</button>
    </div>}
  </section>;
}
