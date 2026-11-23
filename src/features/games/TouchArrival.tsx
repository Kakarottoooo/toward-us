import { Heart, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { localized, type Language } from "../../i18n";
import { jsonBody, relationshipApi } from "../relationship/api";
import { relationshipEvents } from "../relationship/events";

type Touch = { id: string; userId?: string; expiresAt: number; matched: boolean; joinId?: string };
type Board = { now: number; touch: Touch | null; partner: string };
const PATH = "/api/play-distance";
// The Touch & cards sheet shows the same moment itself; the app-wide banner only speaks when that sheet is closed.
const panelOpen = () => Boolean(document.querySelector('[data-testid="play-distance"]'));

/** 碰一碰 anywhere in the app (founder 11-22): the partner's touch arrives as a banner to touch back within the minute,
 * and a touch that meets shows the same heart to both, wherever each of them is in Ourever. */
export function TouchArrival({ language, userId }: { language: Language; userId: string }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [touch, setTouch] = useState<Touch | null>(null);
  const [partner, setPartner] = useState("");
  const [skew, setSkew] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [met, setMet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const dismissed = useRef(new Set<string>());
  const celebrated = useRef(new Set<string>());
  const live = useRef(true);

  const celebrate = useCallback((next: Touch | null) => {
    if (!next?.matched || !next.joinId || celebrated.current.has(next.id) || panelOpen()) return;
    celebrated.current.add(next.id);
    setMet(true);
    window.setTimeout(() => { if (live.current) setMet(false); }, 2600);
  }, []);

  const show = useCallback((board: Board) => {
    setSkew(board.now - Date.now());
    setClock(Date.now());
    setPartner(board.partner);
    setTouch(board.touch);
    celebrate(board.touch);
  }, [celebrate]);

  const load = useCallback(async () => {
    if (document.hidden || !navigator.onLine) return;
    try { const board = await relationshipApi<Board>(PATH); if (live.current) show(board); }
    catch { /* The rest of Ourever never waits on this. */ }
  }, [show]);

  useEffect(() => {
    live.current = true;
    const events = typeof EventSource === "function" ? relationshipEvents() : null;
    const onEvent = (event: Event) => {
      try { if (JSON.parse((event as MessageEvent).data).eventType === "play-distance.updated") void load(); }
      catch { /* The next update still arrives. */ }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    events?.addEventListener("relationship", onEvent);
    events?.addEventListener("ready", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    void load();
    return () => {
      live.current = false;
      events?.close();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [load]);

  const waiting = Boolean(touch && !touch.matched && touch.userId && touch.userId !== userId && !dismissed.current.has(touch.id));
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waiting]);

  const seconds = touch ? Math.max(0, Math.ceil((touch.expiresAt - clock - skew) / 1000)) : 0;
  const name = partner || t("TA", "Your partner", "Tu pareja");

  async function touchBack() {
    if (!touch || busy) return;
    setBusy(true); setFailed(false);
    try { show(await relationshipApi<Board>(PATH + "/touch", jsonBody({ action: "join", id: crypto.randomUUID(), language }))); }
    catch { if (live.current) { setFailed(true); void load(); } }
    finally { if (live.current) setBusy(false); }
  }

  return <>
    {waiting && seconds > 0 && !panelOpen() && <aside className="touch-arrival" role="status" data-testid="touch-arrival">
      <Heart size={20} weight="fill" aria-hidden="true" />
      <span>{failed ? t("没能回碰，再试一次。", "Couldn’t touch back. Try again.", "No se pudo responder. Inténtalo de nuevo.")
        : t(`${name}碰了你一下`, `${name} touched you`, `${name} te tocó`)}<small>{seconds}s</small></span>
      <button type="button" className="touch-arrival-back" disabled={busy} onClick={() => void touchBack()}>{t("回碰", "Touch back", "Responder")}</button>
      <button type="button" className="touch-arrival-close" aria-label={t("关闭", "Dismiss", "Cerrar")} onClick={() => { if (touch) dismissed.current.add(touch.id); setTouch(null); }}><X size={16} /></button>
    </aside>}
    {met && <div className="touch-met" role="status" data-testid="touch-met" onClick={() => setMet(false)}>
      <div className="touch-met-heart" aria-hidden="true"><Heart size={34} weight="fill" /></div>
      <p>{t(`你和${name}碰到了`, `You and ${name} touched`, `Tú y ${name} se tocaron`)}</p>
    </div>}
  </>;
}
