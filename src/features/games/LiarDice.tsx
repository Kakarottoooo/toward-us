import { ArrowsClockwise, Minus, Plus } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { localized } from "../../i18n";
import type { ScreenProps } from "./MatchScreen";
import "./liar-dice.css";

const SIDES = [1, 2, 3, 4, 5, 6] as const;
const PIPS: Record<number, readonly number[]> = {
  1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

type Bid = { quantity: number; face: number; by: string };
type DiceView = {
  hand: number[]; opponentHand: number[] | null; diceLeft: number; partnerDiceLeft: number; round: number;
  bid: Bid | null; result: { caller: string; loser: string; actual: number; held: boolean } | null;
  revision: number; winner: string | null;
};

function Die({ face }: { face: number | null }) {
  if (face === null) return <span className="liar-die liar-die-back" aria-hidden="true">?</span>;
  return <span className="liar-die" data-face={face} aria-hidden="true">
    {PIPS[face].map((pip) => <i key={pip} style={{ gridArea: `${Math.floor(pip / 3) + 1}/${pip % 3 + 1}` }} />)}
  </span>;
}

export function LiarDice({ match, language, userId, partnerName, act, onRematch }: ScreenProps<DiceView>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const { bid, result, revision, round, winner, hand, opponentHand, diceLeft, partnerDiceLeft } = match.state;
  const myTurn = match.turn === userId;
  const maximum = diceLeft + partnerDiceLeft;
  const minimum = bid ? bid.quantity + (bid.face === 6 ? 1 : 0) : 1;
  const canRaise = minimum <= maximum;
  const smallestFace = (quantity: number) => bid && quantity === bid.quantity ? bid.face + 1 : 1;
  const [draft, setDraft] = useState<{ revision: number; quantity: number; face: number } | null>(null);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  const { quantity, face } = draft?.revision === revision ? draft : { quantity: minimum, face: smallestFace(minimum) };

  function chooseQuantity(next: number) {
    if (next < minimum || next > maximum) return;
    setDraft({ revision, quantity: next, face: Math.max(face, smallestFace(next)) });
  }

  async function move(type: "bid" | "call" | "next") {
    if (sending.current) return;
    sending.current = true;
    setPending(true);
    try { await act({ type, revision, ...(type === "bid" ? { quantity, face } : {}) }); }
    finally { sending.current = false; setPending(false); }
  }

  const yours = t("你", "You", "Tú");
  const yourDice = t("你的骰子", "Your dice", "Tus dados");
  const theirDice = t(`${partnerName} 的骰子`, `${partnerName}'s dice`, `Dados de ${partnerName}`);
  const diceCount = (count: number) => t(`还剩 ${count} 颗`, count === 1 ? "1 die left" : `${count} dice left`, count === 1 ? "Queda 1 dado" : `Quedan ${count} dados`);
  const describeDice = (name: string, dice: number[] | null, hidden: number) => dice ? `${name}, ${dice.join(", ")}` :
    t(`${name}，${hidden} 颗未揭晓`, `${name}, ${hidden} hidden`, `${name}, ${hidden} ocultos`);
  const describeBid = (bet: Bid) => t(`至少 ${bet.quantity} 颗 ${bet.face} 点`, `At least ${bet.quantity} showing ${bet.face}`, `Al menos ${bet.quantity} con un ${bet.face}`);

  return <section className="liar-dice" data-testid="liar-dice">
    <div className="liar-felt">
      <div className="liar-round"><span>{t(`第 ${round} 轮`, `Round ${round}`, `Ronda ${round}`)}</span><i aria-hidden="true" /></div>
      <div className="liar-rolls">
        <div>
          <strong>{yours}</strong><small>{diceCount(diceLeft)}</small>
          <div className="liar-hand" role="img" aria-label={describeDice(yourDice, hand, 0)} data-testid="liar-own-hand">
            {hand.map((value, index) => <Die key={index} face={value} />)}
          </div>
        </div>
        <div>
          <strong>{partnerName}</strong><small>{diceCount(partnerDiceLeft)}</small>
          <div className="liar-hand" role="img" aria-label={describeDice(theirDice, opponentHand, partnerDiceLeft)} data-testid="liar-partner-hand">
            {(opponentHand ?? Array.from({ length: partnerDiceLeft }, () => null)).map((value, index) => <Die key={index} face={value} />)}
          </div>
        </div>
      </div>
    </div>
    {bid && <div className="liar-bid-card" data-testid="liar-current-bid">
      <div><small>{bid.by === userId ? t("你刚才叫的", "You bid", "Tu apuesta") : t(`${partnerName} 刚才叫的`, `${partnerName} bid`, `Apuesta de ${partnerName}`)}</small>
        <strong>{describeBid(bid)}</strong></div>
      <Die face={bid.face} />
    </div>}
    {result && bid ? <div className="liar-result" data-testid={winner ? "liar-winner" : "liar-reveal"}>
      <div role="status">
        <strong>{winner ? winner === userId ? t("你赢了！", "You won!", "¡Ganaste!") : t(`${partnerName} 赢了！`, `${partnerName} won!`, `¡Ganó ${partnerName}!`)
          : result.held ? t("这次叫的够数", "The bid held", "La apuesta se cumplió") : t("这次叫多了", "That was a bluff", "Era un farol")}</strong>
        <p>{t(`桌上实际有 ${result.actual} 颗 ${bid.face} 点。`,
          result.actual === 1 ? `There was 1 die showing ${bid.face}.` : `There were ${result.actual} dice showing ${bid.face}.`,
          result.actual === 1 ? `Había 1 dado con un ${bid.face}.` : `Había ${result.actual} dados con un ${bid.face}.`)}{" "}
          {result.loser === userId ? t("你少了一颗骰子。", "You lost a die.", "Perdiste un dado.") : t(`${partnerName} 少了一颗骰子。`, `${partnerName} lost a die.`, `${partnerName} perdió un dado.`)}</p>
      </div>
      {winner ? <button className="game-primary" type="button" onClick={onRematch} data-testid="liar-rematch"><ArrowsClockwise size={18} />{t("再来一局", "Play again", "Otra partida")}</button>
        : myTurn ? <button className="game-primary" type="button" disabled={pending} onClick={() => void move("next")} data-testid="liar-next">{t("掷下一轮", "Roll the next round", "Tirar para la siguiente ronda")}</button>
        : <p>{t(`等 ${partnerName} 掷下一轮。`, `Waiting for ${partnerName} to roll.`, `Esperando a que ${partnerName} vuelva a tirar.`)}</p>}
    </div> : <>
      <div className="liar-turn" role="status" data-testid="liar-turn">
        <strong>{myTurn ? t("轮到你", "Your turn", "Te toca") : t(`轮到 ${partnerName}`, `${partnerName}'s turn`, `Turno de ${partnerName}`)}</strong>
        <span>{!bid ? t("说一个两个人的骰子加起来可能有的数。", "Guess how many dice show the same face across both hands.", "Adivina cuántos dados muestran el mismo número entre las dos manos.")
          : myTurn ? canRaise ? t("加数量，或保持数量、加点数。也可以开盅。", "Raise the count or face value, or call the bluff.", "Sube la cantidad o el número, o destapa los dados.")
            : t("这已经是最大的叫法，可以开盅了。", "That's the highest bid. Call to reveal the dice.", "Es la apuesta más alta. Destapa los dados.")
          : t("两个人的骰子都算在内。", "A bid counts dice from both hands.", "La apuesta cuenta los dados de ambas manos.")}</span>
      </div>
      {myTurn && canRaise && <div className="liar-selection">
        <div className="liar-quantity">
          <span>{t("数量", "Count", "Cantidad")}</span>
          <div className="liar-stepper">
            <button type="button" disabled={pending || quantity <= minimum} onClick={() => chooseQuantity(quantity - 1)}
              aria-label={t("少一颗", "One fewer die", "Un dado menos")} data-testid="liar-quantity-minus"><Minus size={18} /></button>
            <output aria-label={t("数量", "Count", "Cantidad")} data-testid="liar-quantity">{quantity}</output>
            <button type="button" disabled={pending || quantity >= maximum} onClick={() => chooseQuantity(quantity + 1)}
              aria-label={t("多一颗", "One more die", "Un dado más")} data-testid="liar-quantity-plus"><Plus size={18} /></button>
          </div>
        </div>
        <div className="liar-values" role="group" aria-label={t("骰子点数", "Face value", "Número del dado")}>
          {SIDES.map((value) => <button type="button" key={value} disabled={pending || value < smallestFace(quantity)} aria-pressed={face === value}
            onClick={() => setDraft({ revision, quantity, face: value })} data-testid={`liar-face-${value}`}
            aria-label={t(`${value} 点`, `Face ${value}`, `Número ${value}`)}><Die face={value} /></button>)}
        </div>
      </div>}
      {myTurn && <div className="liar-actions">
        {canRaise && <button className="game-primary" type="button" disabled={pending} onClick={() => void move("bid")} data-testid="liar-bid">{bid ? t("加码", "Raise", "Subir") : t("确认叫数", "Place bid", "Confirmar apuesta")}</button>}
        {bid && <button className={canRaise ? "game-quiet" : "game-primary"} type="button" disabled={pending} onClick={() => void move("call")} data-testid="liar-call">{t("开盅", "Call the bluff", "Destapar los dados")}</button>}
      </div>}
    </>}
  </section>;
}
