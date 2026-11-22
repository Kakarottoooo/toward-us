import * as Dialog from "@radix-ui/react-dialog";
import { Heart, Sparkle, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { languageTag, localized, type Language } from "../../i18n";
import { useKeyboard, useScreenPortal } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";
import { Sketch, type Stroke } from "./PlayDrawing";
import "./play-card-arrival.css";

type Gift = {
  id: string;
  kind: "note" | "doodle" | "photo";
  at: string;
  text?: string;
  strokes?: Stroke[];
  photoId?: string;
};
type Inbox = { cards: Gift[]; remaining: number; partner: string };
const inboxPath = "/api/play-distance/deliveries";

export function PlayCardArrival({ language }: { language: Language }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const { screenRef } = useScreenPortal();
  const keyboard = useKeyboard();
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const opening = useRef(false);
  const activeLoad = useRef<AbortController | null>(null);
  const card = inbox?.cards[0];

  useEffect(() => {
    const load = () => {
      if (document.hidden || !navigator.onLine || opening.current) return;
      activeLoad.current?.abort();
      const next = new AbortController();
      activeLoad.current = next;
      void relationshipApi<Inbox>(inboxPath, { signal: next.signal }).then((received) => {
        if (!next.signal.aborted) setInbox(received);
      }).catch(() => { /* Opening the rest of Ourever never depends on the inbox. */ });
    };
    const visibility = () => {
      if (document.hidden) activeLoad.current?.abort();
      else load();
    };
    const restoredPage = (event: PageTransitionEvent) => { if (event.persisted) load(); };
    load();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pageshow", restoredPage);
    window.addEventListener("online", load);
    return () => {
      activeLoad.current?.abort();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pageshow", restoredPage);
      window.removeEventListener("online", load);
    };
  }, []);

  if (!card || !inbox) return null;
  const partner = inbox.partner || t("TA", "Your partner", "Tu pareja");
  const title = t(`${partner}给你留了张小卡`, `${partner} left you a little card`, `${partner} te dejó una tarjetita`);
  const when = new Intl.DateTimeFormat(languageTag(language), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(card.at));
  const later = () => {
    if (opening.current) return;
    activeLoad.current?.abort();
    setInbox(null);
    setFailed(false);
  };
  const open = async () => {
    if (opening.current) return;
    opening.current = true;
    activeLoad.current?.abort();
    setBusy(true);
    setFailed(false);
    try {
      const next = await relationshipApi<Inbox>(`${inboxPath}/${encodeURIComponent(card.id)}/open`, jsonBody({ language }));
      setInbox(next);
    } catch (error) {
      if ((error as { status?: number }).status === 409) setInbox(null);
      else setFailed(true);
    } finally {
      opening.current = false;
      setBusy(false);
    }
  };

  return <Dialog.Root open onOpenChange={(isOpen) => { if (!isOpen) later(); }}>
    <Dialog.Portal container={screenRef.current ?? undefined}>
      <Dialog.Overlay className="arrival-backdrop" />
      <Dialog.Content className="arrival-screen" aria-describedby={undefined} data-testid="card-arrival"
        onOpenAutoFocus={() => keyboard.hide()}>
        <button type="button" className="arrival-later" aria-label={t("稍后看小卡", "See this card later", "Ver la tarjeta más tarde")} onClick={later} disabled={busy}><X size={21} /></button>
        <div className="arrival-center" key={card.id}>
          <div className="arrival-mark" aria-hidden="true"><Heart size={24} weight="fill" /><Sparkle size={15} weight="fill" /></div>
          <Dialog.Title>{title}</Dialog.Title>
          <article className={`arrival-card arrival-${card.kind}`} data-testid="arrival-message">
            {card.kind === "note" && <p>{card.text}</p>}
            {card.kind === "doodle" && <Sketch strokes={card.strokes || []} label={t("TA 送你的涂鸦", "A doodle from your partner", "Un dibujo de tu pareja")} />}
            {card.kind === "photo" && <GiftPhoto id={card.photoId} label={t("TA 送你的照片", "A photo from your partner", "Una foto de tu pareja")}
              unavailable={t("这张照片暂时不能显示。", "This photo is currently unavailable.", "Esta foto no está disponible ahora.")} />}
          </article>
          <time dateTime={card.at}>{when}</time>
          {failed && <p className="arrival-error" role="alert">{t("暂时没能收下。可以重试，或者稍后再看。", "Couldn't save this just now. Try again or come back later.", "Todavía no se pudo guardar. Inténtalo de nuevo o vuelve más tarde.")}</p>}
          <button type="button" className="arrival-accept" onClick={() => void open()} disabled={busy}>
            {busy ? t("正在收下…", "Saving…", "Guardando…") : inbox.remaining > 1
              ? t("收下，下一张", "Keep and see the next card", "Guardar y ver la siguiente") : t("收下", "Keep this card", "Guardar tarjeta")}
          </button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function GiftPhoto({ id, label, unavailable }: { id?: string; label: string; unavailable: string }) {
  const [failed, setFailed] = useState(false);
  return !id || failed ? <p>{unavailable}</p> :
    <img src={`/api/photos/${encodeURIComponent(id)}?w=960`} alt={label} onError={() => setFailed(true)} />;
}
