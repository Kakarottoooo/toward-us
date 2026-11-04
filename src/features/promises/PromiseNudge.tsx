import { useState } from "react";
import { ArrowRight, CheckCircle, Handshake } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { actOnPromise, promiseLead, type PromiseItem } from "./promises";
import "./promises.css";

/** Pinky's one gentle mention of an open promise at a fresh start of Us (11-03): done, not now, or see them all. */
export function PromiseNudge({ item, partnerName, language, onSettled, onOpenAll }: { item: PromiseItem; partnerName: string; language: Language; onSettled: () => void; onOpenAll: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const act = async (action: "done" | "later") => {
    setBusy(true); setError("");
    try { await actOnPromise(item, action, language); onSettled(); } catch (caught) { setError((caught as Error).message); } finally { setBusy(false); }
  };
  return <div className="us-row from-agent promise-nudge" data-testid="promise-nudge"><i className="us-avatar is-pinky" aria-hidden="true">P</i>
    <article className="conversation-card">
      <header><Handshake size={16} />{t("还欠着什么", "Promises to keep", "Promesas pendientes")}</header>
      <p>{promiseLead(item, partnerName, language)}{t("。做到了吗？", ". Done yet?", ". ¿Ya está?")}</p>
      {item.quote && <q>{item.quote}</q>}
      {error && <small role="alert">{error}</small>}
      <div className="card-actions">
        <button className="card-primary" disabled={busy} onClick={() => void act("done")}><CheckCircle size={17} weight="fill" />{t("做到了", "Done", "Hecho")}</button>
        <button disabled={busy} onClick={() => void act("later")}>{t("先不提", "Not now", "Ahora no")}</button>
        <button disabled={busy} onClick={onOpenAll}>{t("全部", "See all", "Ver todas")}<ArrowRight size={15} /></button>
      </div>
    </article>
  </div>;
}
