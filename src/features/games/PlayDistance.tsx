import { useCallback, useEffect, useRef, useState } from "react";
import { Heart, Image as ImageIcon, NotePencil, PaintBrush, PaperPlaneTilt, X } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { KeyboardTextarea, useKeyboard } from "../../mobile";
import { shrinkForCharacter } from "../character/character";
import { jsonBody, relationshipApi } from "../relationship/api";
import { Drawing, Sketch, type Stroke } from "./PlayDrawing";
import "./play-distance.css";
import { relationshipEvents } from "../relationship/events";

const PATH = "/api/play-distance";
type Kind = "note" | "doodle" | "photo";
type Card = { id: string; userId: string; kind: Kind; at: string; text?: string; strokes?: Stroke[]; photoId?: string };
type Touch = { id: string; userId?: string; expiresAt: number; matched: boolean; joinId?: string };
type Board = { version: number; now: number; cards: Card[]; touch: Touch | null; partner: string; readOnly: boolean };
type Draft = { text: string; strokes: Stroke[] };
type Capacitor = { isPluginAvailable?: (name: string) => boolean; Plugins?: { Haptics?: { impact: (options: { style: "LIGHT" }) => Promise<void> } } };

function restoreDraft(storage: string): Draft {
  try {
    const value = storage ? JSON.parse(sessionStorage.getItem(storage) || "null") as Partial<Draft> | null : null;
    if (value && typeof value.text === "string" && Array.isArray(value.strokes)) return { text: value.text, strokes: value.strokes };
  } catch { /* The composer still works without storage. */ }
  return { text: "", strokes: [] };
}

function feedback() {
  const capacitor = (window as Window & { Capacitor?: Capacitor }).Capacitor;
  const native = capacitor?.isPluginAvailable?.("Haptics") && capacitor.Plugins?.Haptics;
  if (native) void native.impact({ style: "LIGHT" }).catch(() => {});
  else if (typeof navigator.vibrate === "function") navigator.vibrate(105);
}

export function PlayDistance({ language, userId, revision, readOnly = false, conversationId, incomingCard = false, onClose }: {
  language: Language; userId: string; revision: number; readOnly?: boolean; conversationId?: string; incomingCard?: boolean; onClose: () => void;
}) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const storage = conversationId ? "pinky:distance:v1:" + userId + ":" + conversationId : "";
  const [draft, setDraft] = useState<Draft>(() => restoreDraft(storage));
  const [kind, setKind] = useState<Kind>("note");
  const [view, setView] = useState<"touch" | "cards">(incomingCard ? "cards" : "touch");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [board, setBoard] = useState<Board | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [readFailed, setReadFailed] = useState(false);
  const [writeFailed, setWriteFailed] = useState("");
  const [receipt, setReceipt] = useState(false);
  const [sending, setSending] = useState(false);
  const [touchBusy, setTouchBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [skew, setSkew] = useState(0);
  const latest = useRef<Board | null>(null);
  const join = useRef("");
  const felt = useRef("");
  const writeLock = useRef(false);
  const touchLock = useRef(false);
  const attempted = useRef<{ id: string; key: string | File; kind: Kind; photoId?: string } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const live = useRef(true);
  const state = useRef({ language });
  state.current = { language };

  const sync = useCallback((next: Board) => {
    if (!live.current || (latest.current && latest.current.version > next.version)) return;
    latest.current = next;
    const receivedAt = Date.now();
    setClock(receivedAt);
    setSkew(next.now - receivedAt);
    setBoard(next); setReadFailed(false);
  }, []);

  const load = useCallback(async () => {
    try { sync(await relationshipApi<Board>(PATH + "?language=" + state.current.language)); }
    catch { if (live.current) setReadFailed(true); }
  }, [sync]);

  useEffect(() => {
    live.current = true;
    const events = typeof EventSource === "function" ? relationshipEvents() : null;
    const onEvent = (event: Event) => {
      try { if (JSON.parse((event as MessageEvent).data).eventType === "play-distance.updated") void load(); }
      catch { /* The next update still refreshes the cards. */ }
    };
    const onOnline = () => { setOffline(false); void load(); };
    const onOffline = () => setOffline(true);
    const leaveOnThisDevice = () => {
      const id = join.current;
      join.current = "";
      if (id && navigator.onLine) void relationshipApi(PATH + "/touch", { ...jsonBody({ action: "leave", id, language: state.current.language }), keepalive: true }).catch(() => {});
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void load();
      else leaveOnThisDevice();
    };
    events?.addEventListener("relationship", onEvent);
    events?.addEventListener("ready", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live.current = false;
      events?.close();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      leaveOnThisDevice();
    };
  }, [load]);
  useEffect(() => { if (navigator.onLine) void load(); }, [load, revision]);
  useEffect(() => {
    if (!storage) return;
    try { sessionStorage.setItem(storage, JSON.stringify(draft)); } catch { /* A private draft can stay in memory. */ }
  }, [draft, storage]);
  useEffect(() => {
    if (!photo) { setPreview(""); return; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  useEffect(() => {
    if (!board?.touch) return;
    const { expiresAt } = board.touch;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now + skew >= expiresAt) {
        if (join.current && !board.touch?.matched) setExpired(true);
        join.current = "";
        window.clearInterval(timer);
      }
    }, 225);
    return () => window.clearInterval(timer);
  }, [board?.touch, skew]);

  const seconds = board?.touch ? Math.max(0, Math.min(board.touch.matched ? 20 : 10, Math.ceil((board.touch.expiresAt - clock - skew) / 1000))) : 0;
  const touch = seconds ? board?.touch : null;
  const holding = touch && !touch.matched && touch.userId === userId;
  const partnerWaiting = touch && !touch.matched && touch.userId !== userId;
  const locked = offline || readOnly || (board?.readOnly ?? true);
  const canSend = kind === "note" ? draft.text.trim().length > 0 : kind === "doodle" ? draft.strokes.length > 0 : Boolean(photo);
  const modeName = (value: Kind) => value === "note" ? t("小纸条", "Note", "Nota") :
    value === "doodle" ? t("随手画", "Doodle", "Dibujo") : t("照片", "Photo", "Foto");

  useEffect(() => {
    if (touch?.matched && join.current && touch.joinId === join.current && felt.current !== touch.id) {
      felt.current = touch.id;
      join.current = "";
      feedback();
    }
  }, [touch]);

  async function changeTouch(action: "join" | "leave") {
    if (locked || touchLock.current) return;
    const id = action === "join" ? crypto.randomUUID() : touch?.id;
    if (!id) return;
    if (action === "join") join.current = id;
    if (action === "leave") join.current = "";
    setExpired(false); setWriteFailed(""); setTouchBusy(true); touchLock.current = true;
    try {
      const next = await relationshipApi<Board>(PATH + "/touch", jsonBody({ id, action, language }));
      if ((!live.current || document.visibilityState !== "visible") && action === "join" && next.touch?.id === id) {
        void relationshipApi(PATH + "/touch", jsonBody({ action: "leave", id, language })).catch(() => {});
      }
      sync(next);
    }
    catch (error) { if (live.current) setWriteFailed((error as Error).message); void load(); }
    finally { touchLock.current = false; if (live.current) setTouchBusy(false); }
  }

  async function sendCard() {
    const key = kind === "note" ? draft.text.trim() : kind === "doodle" ? JSON.stringify(draft.strokes) : photo;
    if (!key || !canSend || locked || writeLock.current) return;
    if (attempted.current?.key !== key || attempted.current?.kind !== kind) attempted.current = { id: crypto.randomUUID(), key, kind };
    const pending = attempted.current;
    keyboard.hide();
    writeLock.current = true; setSending(true); setWriteFailed(""); setReceipt(false);
    try {
      if (kind === "photo" && !pending.photoId && photo) {
        const image = await shrinkForCharacter(photo);
        const uploaded = await relationshipApi<{ photo: { id: string } }>("/api/photos", { method: "POST", headers: { "content-type": image.type }, body: image });
        pending.photoId = uploaded.photo.id;
      }
      sync(await relationshipApi<Board>(PATH + "/cards", jsonBody({
        id: pending.id, kind, language,
        ...(kind === "note" ? { text: key } : kind === "doodle" ? { strokes: draft.strokes } : { photoId: pending.photoId }),
      })));
      attempted.current = null;
      if (live.current) {
        setReceipt(true);
        if (kind === "note") setDraft((previous) => ({ ...previous, text: "" }));
        else if (kind === "doodle") setDraft((previous) => ({ ...previous, strokes: [] }));
        else setPhoto(null);
      }
    } catch (error) {
      if (live.current) {
        if ((error as { code?: string }).code === "invalid_photo") pending.photoId = undefined;
        setWriteFailed(t("还没确认送达，可以再试一次。", "Delivery isn’t confirmed. You can retry.", "El envío no se confirmó. Puedes reintentar."));
      }
    } finally { writeLock.current = false; if (live.current) setSending(false); }
  }

  return <section className="distance-panel" data-testid="play-distance">
    <div className="distance-controls">
      <div className="distance-tabs" role="group" aria-label={t("互动方式", "Ways to connect", "Formas de conectar")}>
        <button type="button" aria-pressed={view === "touch"} disabled={sending} onClick={() => { keyboard.hide(); setWriteFailed(""); setView("touch"); }}>{t("碰一下", "Touch", "Toque")}</button>
        <button type="button" aria-pressed={view === "cards"} disabled={Boolean(holding) || touchBusy} onClick={() => { setWriteFailed(""); setView("cards"); }}>{t("小卡", "Little cards", "Tarjetitas")}</button>
      </div>
      <button className="distance-close" type="button" onClick={onClose} aria-label={t("关闭互动", "Close", "Cerrar")}><X size={20} aria-hidden="true" /></button>
    </div>
    {offline && <p className="distance-status" role="status">{t("现在离线，草稿还在。", "You’re offline. Your draft is still here.", "No hay conexión. Tu borrador sigue aquí.")}</p>}
    {readFailed && <div className="distance-status" role="status">{t("暂时没连上。", "Couldn’t connect.", "No se pudo conectar.")} <button type="button" className="distance-text" disabled={offline} onClick={() => void load()}>{t("重试", "Retry", "Reintentar")}</button></div>}
    {!board && !readFailed && !offline && <p className="distance-status" role="status">{t("正在打开你们的小角落…", "Opening your space…", "Abriendo su espacio…")}</p>}
    {writeFailed && <p className="distance-status is-error" role="alert">{writeFailed}</p>}
    {view === "touch" ? <div className={"distance-touch" + (touch?.matched ? " is-matched" : "")} data-testid="interaction-touch">
      <div className="distance-heart" aria-hidden="true"><Heart size={26} weight={touch?.matched ? "fill" : "regular"} /></div>
      <p role="status">{touch?.matched ? t("你们碰到了。", "Your touches met.", "Sus toques se encontraron.") :
        holding ? t("等 TA 也点一下。", "Waiting for your partner to tap.", "Esperando el toque de tu pareja.") :
          partnerWaiting ? t("TA 已经在等你了。", "Your partner is waiting for you.", "Tu pareja te está esperando.") :
            expired ? t("这次错过了，可以再碰一下。", "You missed each other. You can try again.", "Esta vez no coincidieron. Pueden reintentar.") :
              t("你和 TA 在 10 秒内各点一次，就能碰到彼此。", "Tap within 10 seconds of each other to connect.", "Tóquense con menos de 10 segundos de diferencia.")}</p>
      {touch && !touch.matched && <small aria-hidden="true">{seconds}s</small>}
      {touch?.matched ? <button type="button" className="distance-action" onClick={onClose}>{t("完成", "Done", "Listo")}</button>
        : <button type="button" className="distance-action" disabled={locked || touchBusy} onClick={() => void changeTouch(holding ? "leave" : "join")}>
          {holding ? t("取消等待", "Cancel waiting", "Dejar de esperar") : t("碰一下", "Tap", "Tocar")}
        </button>}
    </div> : <>
    <article className="distance-composer">
      <h2>{t("给 TA 留张小卡", "Leave a little card", "Deja una tarjetita")}</h2>
      <div className="distance-modes" role="group" aria-label={t("小卡类型", "Card type", "Tipo de tarjeta")}>
        {(["note", "doodle", "photo"] as const).map((item) => {
          const Icon = item === "note" ? NotePencil : item === "doodle" ? PaintBrush : ImageIcon;
          return <button key={item} type="button" disabled={sending || readOnly || board?.readOnly} aria-pressed={kind === item} onClick={() => { keyboard.hide(); setKind(item); setReceipt(false); }}><Icon size={19} />{modeName(item)}</button>;
        })}
      </div>
      {kind === "note" ? <KeyboardTextarea maxLength={180} rows={3} disabled={sending || readOnly || board?.readOnly} value={draft.text} onChange={(event) => {
        const text = event.currentTarget.value;
        setDraft((previous) => ({ ...previous, text }));
        setReceipt(false);
      }} aria-label={t("小纸条内容", "Your note", "Tu nota")} placeholder={t("想起 TA 的时候，留一句话…", "A little thought to leave for them…", "Un pequeño pensamiento para tu pareja…")} /> :
        kind === "doodle" ? <Drawing language={language} disabled={sending || readOnly || board?.readOnly === true} strokes={draft.strokes} onChange={(strokes) => {
          setDraft((previous) => ({ ...previous, strokes }));
          setReceipt(false);
        }} /> : <div className="distance-pick-photo">
          <input ref={picker} type="file" accept="image/*" hidden onChange={(event) => { setPhoto(event.currentTarget.files?.[0] || null); event.currentTarget.value = ""; setReceipt(false); }} />
          {preview && <img src={preview} alt={t("待发送的照片", "Photo preview", "Vista previa de la foto")} />}
          <button type="button" className="distance-text" disabled={sending || readOnly || board?.readOnly} onClick={() => picker.current?.click()}>{photo ? t("换一张", "Choose another", "Elegir otra") : t("选择照片", "Choose photo", "Elegir foto")}</button>
          {photo && <button type="button" className="distance-text" disabled={sending || readOnly || board?.readOnly} onClick={() => setPhoto(null)}>{t("移除", "Remove", "Quitar")}</button>}
        </div>}
      <button className="distance-action" type="button" disabled={locked || sending || !canSend} onClick={() => void sendCard()}><PaperPlaneTilt size={19} />
        {sending ? t("发送中…", "Sending…", "Enviando…") : t("送给 TA", "Send to your partner", "Enviar a tu pareja")}
      </button>
      {receipt && <p className="distance-receipt" role="status">{t("小卡已送出。TA 下次打开 Ourever 时会看到。", "Card sent. Your partner will see it the next time they open Ourever.", "Tarjeta enviada. Tu pareja la verá al abrir Ourever de nuevo.")}</p>}
    </article>
    {board && <section className="distance-recent" aria-label={t("最近的小卡", "Recent cards", "Tarjetas recientes")}>
      <h2>{t("最近的小卡", "Recent cards", "Tarjetas recientes")}</h2>
      {board.cards.length ? <ul>{board.cards.slice().reverse().map((card) => <li key={card.userId + ":" + card.id}>
        <header><strong>{card.userId === userId ? t("你", "You", "Tú") : board.partner || t("TA", "Your partner", "Tu pareja")}</strong><time dateTime={card.at}>{new Intl.DateTimeFormat(languageTag(language), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(card.at))}</time></header>
        {card.kind === "note" ? <p>{card.text}</p> : card.kind === "doodle" ? <Sketch strokes={card.strokes || []} label={modeName("doodle")} /> :
          card.photoId && <RecentPhoto id={card.photoId} label={modeName("photo")} missing={t("这张照片暂时不能显示。", "This photo is unavailable.", "Esta foto no está disponible.")} />}
      </li>)}</ul> : <p>{t("你们送出的小卡会留在这里。", "The cards you send appear here.", "Las tarjetas que envíen aparecerán aquí.")}</p>}
    </section>}
    </>}
  </section>;
}

function RecentPhoto({ id, label, missing }: { id: string; label: string; missing: string }) {
  const [failed, setFailed] = useState(false);
  const url = "/api/photos/" + encodeURIComponent(id);
  return failed ? <p>{missing}</p> : <a href={url} target="_blank" rel="noreferrer">
    <img src={url + "?w=480"} alt={label} loading="lazy" onError={() => setFailed(true)} />
  </a>;
}
