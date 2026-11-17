import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowsClockwise, Check, Clock, CookingPot, Fire, ForkKnife, Pause, StopCircle, Timer } from "@phosphor-icons/react";
import { localized } from "../../i18n";
import type { ScreenProps } from "./MatchScreen";
import "./kitchen.css";

const pantry = {
  pasta: ["🍝", "意面", "Pasta", "Pasta"],
  tomato: ["🍅", "番茄", "Tomato", "Tomate"],
  basil: ["🌿", "罗勒", "Basil", "Albahaca"],
  greens: ["🥬", "生菜", "Lettuce", "Lechuga"],
  cheese: ["🧀", "芝士", "Cheese", "Queso"],
  tortilla: ["🫓", "玉米饼", "Tortilla", "Tortilla"],
  beans: ["🫘", "豆子", "Beans", "Frijoles"],
  dough: ["🥖", "面团", "Dough", "Masa"],
} as const;
const dishes = {
  pasta: ["🍝", "番茄意面", "Tomato pasta", "Pasta con tomate"],
  salad: ["🥗", "芝士沙拉", "Cheese salad", "Ensalada con queso"],
  taco: ["🌮", "豆子塔可", "Bean taco", "Taco de frijoles"],
  pizza: ["🍕", "番茄披萨", "Tomato pizza", "Pizza con tomate"],
  soup: ["🥣", "番茄豆汤", "Tomato bean soup", "Sopa de tomate y frijoles"],
  flatbread: ["🫓", "生菜芝士饼", "Cheese flatbread", "Pan plano con queso"],
} as const;
type Ingredient = keyof typeof pantry;
type Order = { id: keyof typeof dishes; ingredients: Ingredient[]; picked: Ingredient[]; cookMs: number; firedAt: number | null; served: boolean };
type KitchenState = {
  prep: string;
  ready: string[];
  phase: "lobby" | "running" | "paused" | "finished";
  startAt: number | null;
  pausedAt: number | null;
  deadlineAt: number | null;
  serverNow: number;
  burnWindow: number;
  orders: Order[];
  prepErrors: number;
  outcome: "time" | "complete" | null;
};
type KitchenProps = ScreenProps<KitchenState> & { visible?: boolean };

const isStocked = (order: Order) => order.picked.length === order.ingredients.length;
function timeText(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}

export function Kitchen({ match, language, userId, partnerName, act, onRematch, visible = true }: KitchenProps) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const state = match.state;
  const [clock, setClock] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [moveError, setMoveError] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const pending = useRef(false);
  const retryAt = useRef(0);
  const skew = useMemo(() => Date.now() - state.serverNow, [state.serverNow]);
  const currentTime = Math.max(state.serverNow, clock - skew);
  const now = state.pausedAt ?? currentTime;
  const secondsToStart = Math.max(0, Math.ceil(((state.startAt ?? now) - now) / 1000));
  const timeLeft = state.deadlineAt === null ? 120_000 : state.deadlineAt - Math.max(now, state.startAt ?? now);
  const live = state.phase === "running";
  const expired = live && timeLeft <= 0;
  const canCook = live && !secondsToStart && !expired && online && !busy;

  useEffect(() => {
    const networkChange = () => setOnline(navigator.onLine);
    window.addEventListener("online", networkChange);
    window.addEventListener("offline", networkChange);
    return () => {
      window.removeEventListener("online", networkChange);
      window.removeEventListener("offline", networkChange);
    };
  }, []);
  useEffect(() => {
    if (!live || !visible) return;
    const refreshClock = () => setClock(Date.now());
    refreshClock();
    const ticker = window.setInterval(refreshClock, 125);
    return () => window.clearInterval(ticker);
  }, [live, visible]);

  const move = useCallback(async (action: Record<string, unknown>) => {
    if (pending.current || !navigator.onLine) return false;
    pending.current = true;
    setBusy(true);
    try {
      if (action.type !== "settle") setMoveError(false);
      const ok = await act(action);
      if (!ok && action.type !== "settle") setMoveError(true);
      return ok;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, [act]);
  useEffect(() => {
    if (!expired || !online || !visible || busy) return;
    const timer = window.setTimeout(() => {
      retryAt.current = Date.now() + 2300;
      void move({ type: "settle" });
    }, Math.max(250, retryAt.current - Date.now()));
    return () => window.clearTimeout(timer);
  }, [expired, online, visible, busy, move]);

  const preparer = state.prep === userId;
  const remaining = state.orders.filter((order) => !order.served);
  const plated = state.orders.length - remaining.length;
  const order = remaining[0];
  const prepOrder = remaining.slice(0, 2).find((item) => !isStocked(item));
  const cookOrder = preparer && prepOrder ? prepOrder : order;
  const nextOrder = cookOrder && cookOrder !== order;
  const name = cookOrder && t(dishes[cookOrder.id][1], dishes[cookOrder.id][2], dishes[cookOrder.id][3]);
  const readyAt = order?.firedAt == null ? null : order.firedAt + order.cookMs;
  const burned = readyAt !== null && now >= readyAt + state.burnWindow;
  const hot = readyAt !== null && now >= readyAt && !burned;
  const heating = readyAt !== null && !burned && !hot;
  const iAmReady = state.ready.includes(userId);
  const complete = state.phase === "finished";
  const lookingForReady = state.phase === "lobby" || state.phase === "paused";
  const countdown = live && secondsToStart > 0;
  const pauseLabel = t("暂停", "Pause", "Pausa");
  const prepLabel = t("备料", "Prep", "Preparar");
  const cookLabel = t("掌勺", "Cook", "Cocinar");

  return <section className="kitchen" data-testid="kitchen">
    <header className="kitchen-score">
      <div><ForkKnife size={16} weight="bold" aria-hidden="true" /><span>{t("出餐", "Served", "Servidos")}</span><strong>{plated}/{state.orders.length}</strong></div>
      <ol aria-label={t("订单进度", "Order progress", "Progreso de los pedidos")}>
        {state.orders.map((item) => <li key={item.id} className={item.served ? "is-served" : ""} title={t(dishes[item.id][1], dishes[item.id][2], dishes[item.id][3])}>
          {item.served ? <Check size={14} weight="bold" aria-hidden="true" /> : <span aria-hidden="true">{dishes[item.id][0]}</span>}
        </li>)}
      </ol>
      {!complete && <div className={"kitchen-clock" + (live && timeLeft <= 15_000 ? " is-low" : "")} role="timer" aria-label={t("剩余时间", "Time left", "Tiempo restante")}>
        <Clock size={17} weight="bold" aria-hidden="true" /><strong>{timeText(timeLeft)}</strong>
      </div>}
    </header>

    {!online && !complete && <p className="kitchen-offline" role="status">{t("网络断开。重新连线后会同步餐厅。", "Connection lost. The kitchen will sync when you reconnect.", "Sin conexión. La cocina se sincronizará al reconectarte.")}</p>}

    {moveError && !complete && <p className="kitchen-offline" role="alert">{t("这一步没发出去，等画面同步后再试。", "The move did not go through. Wait for the kitchen to sync and try again.", "No se registró el movimiento. Espera a que se sincronice la cocina y vuelve a intentarlo.")}</p>}

    {complete ? <div className="kitchen-finish">
      <CookingPot size={42} weight="duotone" aria-hidden="true" />
      <h3>{state.outcome === "complete" ? t("全部上菜！", "Every order served!", "¡Todos los pedidos servidos!") : t("厨房打烊啦", "Kitchen closed", "La cocina cerró")}</h3>
      <p>{t("你们一起端出了 " + plated + " 道菜。", "You served " + plated + " dishes together.", "Sirvieron " + plated + " platos juntos.")}</p>
      <button type="button" className="game-primary" onClick={onRematch}><ArrowsClockwise size={18} aria-hidden="true" />{t("换角色再来", "Swap roles and replay", "Cambiar de rol y volver a jugar")}</button>
    </div> : lookingForReady ? <div className="kitchen-lobby">
      <h3>{state.phase === "paused" ? t("厨房暂停中", "Kitchen paused", "Cocina en pausa") : t("准备开餐", "Ready for service?", "¿Listos para abrir?")}</h3>
      <div className="kitchen-roles">
        <p><strong>{t("你", "You", "Tú")} · {preparer ? prepLabel : cookLabel}</strong>
          <span>{preparer ? t("按单选食材，提前备下一单。", "Pick ingredients and prep the next ticket.", "Elige ingredientes y adelanta el siguiente pedido.") : t("开火，抓准时间起锅上菜。", "Start the pan and serve before it burns.", "Pon la sartén al fuego y sirve antes de que se queme.")}</span></p>
        <p><strong>{partnerName} · {preparer ? cookLabel : prepLabel}</strong>
          <span>{state.ready.some((id) => id !== userId) ? t("准备好了", "Ready", "Todo listo") : t("等准备", "Getting ready", "Preparándose")}</span></p>
      </div>
      <div className="game-actions">
        <button type="button" className={iAmReady ? "game-quiet" : "game-primary"} disabled={busy || !online}
          onClick={() => void move({ type: iAmReady ? "unready" : "ready" })}>
          {iAmReady ? t("取消准备", "Cancel ready", "Cancelar preparación") : t("我准备好了", "I’m ready", "Todo listo")}
        </button>
      </div>
      {iAmReady && <p className="kitchen-note" role="status">{t("两个人都准备好就开工。", "You’ll start when you’re both ready.", "Empezarán cuando ambos estén listos.")}</p>}
    </div> : expired ? <p className="kitchen-note" role="status">{t("时间到，正在结算…", "Time’s up. Finishing the round…", "Se acabó el tiempo. Cerrando la partida…")}</p>
      : countdown ? <div className="kitchen-countdown" role="status"><Timer size={26} weight="duotone" aria-hidden="true" />
        <strong>{secondsToStart}</strong><span>{t("准备开工", "Get ready", "Prepárense")}</span>
      </div> : cookOrder && <>
        <div className="kitchen-ticket">
          <div className="kitchen-ticket-dish"><span aria-hidden="true">{dishes[cookOrder.id][0]}</span><div>
            <small>{nextOrder ? t("备下一单", "Prep the next ticket", "Prepara el siguiente pedido") : t("当前订单", "Current ticket", "Pedido actual")}</small>
            <h3>{name}</h3>
          </div></div>
          <ul>
            {cookOrder.ingredients.map((ingredient) => {
              const [icon, zh, en, es] = pantry[ingredient];
              const picked = cookOrder.picked.includes(ingredient);
              return <li key={ingredient} className={picked ? "is-picked" : ""}>
                {picked ? <Check size={15} weight="bold" aria-label={t("已备好", "Ready", "Listo")} /> : <span aria-hidden="true">{icon}</span>}{t(zh, en, es)}
              </li>;
            })}
          </ul>
        </div>

        {preparer ? prepOrder ? <>
          <p className="kitchen-note">{t("按订单点选食材，点错扣 2 秒。", "Tap ingredients on the ticket. A wrong pick costs 2 seconds.", "Toca los ingredientes del pedido. Un error cuesta 2 segundos.")}</p>
          {state.prepErrors > 0 && <p className="kitchen-heat-alert" role="status" key={state.prepErrors}>
            {t("选错 " + state.prepErrors + " 次", state.prepErrors + " wrong picks", state.prepErrors + " errores al elegir")}
          </p>}
          <div className="kitchen-pantry" aria-label={t("食材", "Ingredients", "Ingredientes")}>
            {(Object.keys(pantry) as Ingredient[]).map((ingredient) => {
              const [icon, zh, en, es] = pantry[ingredient];
              const picked = prepOrder.picked.includes(ingredient);
              return <button type="button" key={ingredient} disabled={!canCook || picked} aria-pressed={picked}
                onClick={() => void move({ type: "prep", order: prepOrder.id, ingredient })}><span aria-hidden="true">{icon}</span>{t(zh, en, es)}</button>;
            })}
          </div>
        </> : <p className="kitchen-note" role="status">{t("食材都备好了，等 TA 出餐。", "Ingredients are ready. Your partner is on the pan.", "Todo listo. Tu pareja se encarga de la sartén.")}</p>
          : order && <div className="kitchen-pan">
            {!isStocked(order) ? <p className="kitchen-note" role="status">{t("等 TA 把食材备好。", "Waiting for your partner to prep.", "Esperando a que tu pareja prepare los ingredientes.")}</p>
              : heating && readyAt !== null ? <>
                <div className="kitchen-heat"><Fire size={19} weight="duotone" aria-hidden="true" />
                  <strong>{t("正在加热", "On the heat", "Al fuego")}</strong><span>{Math.max(1, Math.ceil((readyAt - now) / 1000))}s</span>
                </div>
                <progress aria-label={t("烹饪进度", "Cooking progress", "Progreso de cocción")} max={order.cookMs} value={Math.min(order.cookMs, now - (order.firedAt || now))} />
              </> : <div className="game-actions">
                {hot && readyAt !== null && <p className="kitchen-heat-alert" role="status">{t("现在起锅！", "Serve it now!", "¡Sírvelo ya!")} · {Math.max(1, Math.ceil((readyAt + state.burnWindow - now) / 1000))}s</p>}
                {burned && <p className="kitchen-heat-alert" role="status">{t("煮焦了。食材还在，可以重做。", "It burned. The ingredients are ready for another try.", "Se quemó. Los ingredientes están listos para volver a intentarlo.")}</p>}
                <button type="button" className="game-primary" disabled={!canCook}
                  onClick={() => void move({ type: hot ? "serve" : "fire", order: order.id })}>
                  {hot ? <ForkKnife size={18} aria-hidden="true" /> : <Fire size={18} aria-hidden="true" />}
                  {hot ? t("起锅上菜", "Serve the dish", "Servir el plato") : burned ? t("重新开火", "Cook it again", "Volver a cocinar") : t("开火", "Start cooking", "Empezar a cocinar")}
                </button>
              </div>}
          </div>}
      </>}

    {!complete && <footer className="kitchen-footer">
      {live && !expired && <button type="button" className="game-quiet" disabled={!online || busy} onClick={() => void move({ type: "pause" })}><Pause size={17} weight="fill" aria-hidden="true" />{pauseLabel}</button>}
      <button type="button" className={"game-quiet" + (confirmEnd ? " is-confirm" : "")} disabled={!online || busy} onBlur={() => setConfirmEnd(false)}
        onClick={() => { if (!confirmEnd) setConfirmEnd(true); else { setConfirmEnd(false); void move({ type: "abandon" }); } }}>
        <StopCircle size={17} aria-hidden="true" />{confirmEnd ? t("确定结束？", "End it?", "¿Terminar?") : t("结束这局", "End game", "Terminar partida")}
      </button>
    </footer>}
  </section>;
}
