import { ArrowClockwise, ArrowDown, ArrowUp, CalendarDots, Check, ImageSquare, Trash } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { localized, type Language } from "../../i18n";
import type { ScreenProps } from "./MatchScreen";
import { SharedGamePhotoPicker } from "./SharedGamePhotoPicker";
import "./photo-rounds.css";

type TimelineCard = { key: string; photoId?: string; example?: number; date?: string };
type TimelineState = {
  phase: "pick" | "sort" | "reveal";
  practice: boolean;
  practiceDeck: number | null;
  cards: TimelineCard[];
  partnerCount: number | null;
  myConfirmation: boolean;
  partnerConfirmation: boolean;
  revision: number;
  correctCount: number | null;
};

const samples = [
  [
    ["📖", "在书店第一次见面", "Met at a bookstore", "Se conocieron en una librería"],
    ["🎟️", "买下两张演出的票", "Bought two tickets to a show", "Compraron dos entradas para un concierto"],
    ["🎸", "一起看演出", "Went to the show", "Fueron al concierto"],
    ["🖼️", "把演出票根裱起来", "Framed the ticket stubs", "Enmarcaron las entradas"],
  ],
  [
    ["🧳", "借来一个行李箱", "Borrowed a suitcase", "Consiguieron una maleta prestada"],
    ["🚆", "搭火车出发", "Left town by train", "Salieron de viaje en tren"],
    ["📮", "寄出旅行明信片", "Mailed a postcard", "Enviaron una postal"],
    ["🔑", "旅行回来，归还行李箱", "Returned the suitcase after the trip", "Devolvieron la maleta al regresar"],
  ],
  [
    ["🧶", "挑了围巾用的毛线", "Chose yarn for a scarf", "Eligieron hilo para una bufanda"],
    ["📏", "第一次试织", "Knitted the first row", "Tejieron la primera fila"],
    ["🎁", "把织好的围巾包起来", "Wrapped the finished scarf", "Envolvieron la bufanda terminada"],
    ["📸", "围着新围巾拍照", "Took a photo wearing the scarf", "Se tomaron una foto con la bufanda"],
  ],
  [
    ["🔑", "拿到新家的钥匙", "Picked up the keys to a new place", "Recogieron las llaves de su nuevo hogar"],
    ["📦", "搬进第一箱东西", "Moved in the first box", "Llevaron la primera caja"],
    ["🛋️", "在新沙发上休息", "Took a break on the new couch", "Descansaron en el sofá nuevo"],
    ["🥂", "第一次在新家请客", "Hosted their first dinner there", "Organizaron su primera cena en casa"],
  ],
  [
    ["🌱", "把番茄籽种下去", "Planted tomato seeds", "Sembraron semillas de tomate"],
    ["🪴", "把小苗搬进花盆", "Moved the sprouts into a pot", "Trasplantaron los brotes a una maceta"],
    ["🌼", "番茄苗开花了", "Spotted the first flowers", "Vieron las primeras flores"],
    ["🍅", "用第一颗番茄做沙拉", "Made a salad with the first tomato", "Prepararon una ensalada con el primer tomate"],
  ],
  [
    ["🚲", "给旧自行车打上气", "Pumped up the old bike tires", "Inflaron las ruedas de la bicicleta"],
    ["🗺️", "画出骑行路线", "Drew their bike route", "Dibujaron su ruta en bicicleta"],
    ["🧺", "骑到河边野餐", "Rode to the river for a picnic", "Fueron en bici al río a hacer un picnic"],
    ["🖌️", "给那天的照片做了相框", "Made a frame for the day's photo", "Hicieron un marco para la foto de ese día"],
  ],
] as const;

function Thumbnail({ card }: { card: TimelineCard }) {
  const [failed, setFailed] = useState(false);
  if (!card.photoId || failed) return <span className="timeline-thumb is-placeholder"><ImageSquare size={24} aria-hidden="true" /></span>;
  return <img className="timeline-thumb" src={`/api/photos/${encodeURIComponent(card.photoId)}?w=240`}
    onError={() => setFailed(true)} alt="" draggable={false} />;
}

function shortDate(date: string, language: Language) {
  const locale = language === "en" ? "en-US" : language === "es" ? "es" : "zh-CN";
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

export function MemoryTimeline({ match, language, partnerName, act, onRematch }: ScreenProps<TimelineState>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const state = match.state;
  const [busy, setBusy] = useState(false), [error, setError] = useState(false), [confirmEnd, setConfirmEnd] = useState(false);
  const sending = useRef(false);

  async function send(action: Record<string, unknown>) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(false);
    try { setError(!await act(action)); }
    finally { sending.current = false; setBusy(false); }
  }

  function swap(index: number, to: number) {
    if (!state.cards[to]) return;
    void send({ type: "swap", from: state.cards[index].key, to: state.cards[to].key, revision: state.revision });
  }

  const picking = state.phase === "pick", arranging = state.phase === "sort";
  const complete = state.phase === "reveal", count = state.cards.length;
  return <section className="photo-round timeline-round" data-testid="memory-timeline">
    <header className="photo-round-heading timeline-heading">
      <span className="photo-round-icon"><CalendarDots size={24} weight="duotone" aria-hidden="true" /></span>
      <div>
        <h3>{picking ? t("把回忆带进来", "Bring in your memories", "Elijan sus recuerdos")
          : complete ? t("你们的时间线", "Your timeline", "Su línea de tiempo")
          : t("哪一幕最早？", "Which came first?", "¿Qué pasó primero?")}</h3>
        <p>{picking ? t("每人选两张，选齐再排序。", "Pick two photos each. Then put all four in order.", "Elijan dos fotos por persona y luego ordenen las cuatro.")
          : complete ? state.correctCount === count
            ? t("全排对了！", "Every photo in the right place!", "¡Todo en el orden correcto!")
            : t(`${state.correctCount} / ${count} 张位置正确`, `${state.correctCount} of ${count} in the right place`, `${state.correctCount} de ${count} en el lugar correcto`)
          : t("从最早排到最近。你们看到的是同一份顺序。", "Go from oldest to newest. You share one order.", "Empiecen por lo más antiguo. Los dos ven el mismo orden.")}</p>
      </div>
    </header>
    {picking ? <>
      <div className="timeline-selection-status" role="status">
        <span>{t("你已选", "You picked", "Elegiste")} <strong>{count} / 2</strong></span>
        <span>{t(`${partnerName} 已选`, `${partnerName} picked`, `${partnerName} eligió`)} <strong>{state.partnerCount} / 2</strong></span>
      </div>
      {count > 0 && <ul className="timeline-picked">
        {state.cards.map((card, index) => <li key={card.key}>
          <Thumbnail card={card} />
          <button type="button" className="timeline-notice-button" disabled={busy}
            aria-label={t(`移除第 ${index + 1} 张`, `Remove photo ${index + 1}`, `Quitar foto ${index + 1}`)}
            onClick={() => void send({ type: "remove", key: card.key })}><Trash size={18} aria-hidden="true" /></button>
        </li>)}
      </ul>}
      {count < 2 ? <SharedGamePhotoPicker language={language} disabled={busy} onPick={(photoId) => void send({ type: "select", photoId })} />
        : <p role="status" className="photo-round-note">{t(`等 ${partnerName} 选完就能排序。`, `Sorting starts when ${partnerName} finishes picking.`, `Podrán ordenar cuando ${partnerName} termine de elegir.`)}</p>}
      <button type="button" className="game-quiet" disabled={busy} onClick={() => void send({ type: "practice" })}>
        {t("玩一局示例", "Try a sample round", "Probar una ronda de ejemplo")}
      </button>
    </> : <>
      {state.practice && <p className="timeline-sample-label">{t("示例回忆", "Sample memories", "Recuerdos de ejemplo")}</p>}
      <ol className="timeline-list">
        {state.cards.map((card, index) => {
          const example = card.example !== undefined && state.practiceDeck !== null ? samples[state.practiceDeck]?.[card.example] : null;
          const title = example ? t(example[1], example[2], example[3]) : t(`照片 ${index + 1}`, `Photo ${index + 1}`, `Foto ${index + 1}`);
          return <li key={card.key}>
            <span className="timeline-position">{index + 1}</span>
            {example ? <span className="timeline-thumb is-example" aria-hidden="true">{example[0]}</span> : <Thumbnail card={card} />}
            <span className="timeline-caption"><span className={example || card.date ? "" : "timeline-sr-only"}>{title}</span>
              {card.date && <time dateTime={card.date}>{shortDate(card.date, language)}</time>}
            </span>
            {arranging && <div className="timeline-arrows">
              <button type="button" disabled={busy || index === 0} aria-label={t(`上移${title}`, `Move ${title} up`, `Subir ${title}`)}
                onClick={() => swap(index, index - 1)}><ArrowUp size={18} weight="bold" /></button>
              <button type="button" disabled={busy || index === count - 1} aria-label={t(`下移${title}`, `Move ${title} down`, `Bajar ${title}`)}
                onClick={() => swap(index, index + 1)}><ArrowDown size={18} weight="bold" /></button>
            </div>}
          </li>;
        })}
      </ol>
    </>}
    {arranging && <>
      {state.myConfirmation && <p className="photo-round-note" role="status">
        {t(`等 ${partnerName} 确认这份顺序。`, `Waiting for ${partnerName} to confirm this order.`, `Falta que ${partnerName} confirme este orden.`)}
      </p>}
      {!state.myConfirmation && state.partnerConfirmation && <p className="photo-round-note" role="status">
        {t(`${partnerName} 已确认，改动后需要重新确认。`, `${partnerName} confirmed. Changes ask both of you to confirm again.`, `${partnerName} confirmó. Si hacen cambios, tendrán que volver a confirmar.`)}
      </p>}
      <button type="button" className={state.myConfirmation ? "game-quiet" : "game-primary"} disabled={busy}
        onClick={() => void send({ type: state.myConfirmation ? "unlock" : "confirm", revision: state.revision })}>
        {!state.myConfirmation && <Check size={18} weight="bold" aria-hidden="true" />}
        {state.myConfirmation ? t("取消我的确认", "Undo my confirmation", "Retirar mi confirmación") : t("确认顺序", "Confirm order", "Confirmar orden")}
      </button>
    </>}
    {complete && <button type="button" className="game-primary" onClick={onRematch}>
      <ArrowClockwise size={18} aria-hidden="true" />{t("再来一局", "Play another round", "Jugar otra ronda")}
    </button>}
    {error && <p className="photo-round-note is-error" role="alert">{t("这一步没保存。看看现在的顺序，再试一次。", "That move wasn't saved. Check the current order and try again.", "No se guardó el movimiento. Revisa el orden e inténtalo de nuevo.")}</p>}
    {match.status === "active" && <footer className="photo-round-footer">
      <button type="button" className={`game-quiet${confirmEnd ? " is-confirm" : ""}`} disabled={busy}
        onClick={() => { if (confirmEnd) void send({ type: "abandon" }); else setConfirmEnd(true); }}>
        {confirmEnd ? t("确认结束", "Confirm ending", "Confirmar fin") : t("结束这局", "End game", "Terminar partida")}
      </button>
      {confirmEnd && <button type="button" className="game-quiet" disabled={busy} onClick={() => setConfirmEnd(false)}>
        {t("继续玩", "Keep playing", "Seguir jugando")}
      </button>}
    </footer>}
  </section>;
}
