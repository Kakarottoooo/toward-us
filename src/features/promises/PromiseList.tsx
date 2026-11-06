import { useCallback, useEffect, useState } from "react";
import { ArrowCounterClockwise, CheckCircle, DotsThree, Handshake, LockKey, PaperPlaneRight } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { KeyboardTextarea, useKeyboard } from "../../mobile";
import { actOnPromise, listPromises, type PromiseAction, type PromiseItem } from "./promises";
import "./promises.css";

/** "还欠着什么": a compact list of what the two of them promised each other, with done / not now right on each line. */
export function PromiseList({ language, partnerName, refreshKey, onChanged, hideEmpty = false }: { language: Language; partnerName: string; refreshKey?: unknown; onChanged?: () => void | Promise<void>; hideEmpty?: boolean }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const [items, setItems] = useState<PromiseItem[] | null>(null);
  const [busy, setBusy] = useState(""); const [notice, setNotice] = useState("");
  const [more, setMore] = useState(""); const [sharing, setSharing] = useState<{ id: string; text: string } | null>(null);
  const load = useCallback(async () => { try { setItems(await listPromises(language)); } catch (error) { setNotice((error as Error).message); setItems([]); } }, [language]);
  // Reloaded with the page's own refresh (each relationship event), so a partner's "done" never leaves a stale version here.
  useEffect(() => { void load(); }, [load, refreshKey]);
  const act = async (item: PromiseItem, action: PromiseAction, extra: Record<string, unknown> = {}) => {
    keyboard.hide(); setBusy(item.id); setNotice("");
    try { await actOnPromise(item, action, language, extra); setMore(""); setSharing(null); await load(); if (action === "agreement" || action === "share") await onChanged?.(); }
    catch (error) { setNotice((error as Error).message); await load(); } finally { setBusy(""); }
  };
  const who = (item: PromiseItem) => item.by === "me" ? t("你答应的", "Your promise", "Tu promesa") : item.by === "partner" ? t(`${partnerName} 答应的`, `${partnerName}'s promise`, `Promesa de ${partnerName}`) : t("你们俩说好的", "You both agreed", "Acordado por los dos");
  const day = (value: string) => new Date(value).toLocaleDateString(languageTag(language), { month: "short", day: "numeric" });
  const agreementState = (item: PromiseItem) => !item.agreement ? null : item.agreement.status === "active" ? t("已成约定", "Now an agreement", "Ya es un acuerdo") : item.agreement.status === "awaiting_approvals" ? t("约定等你们批准", "Agreement waiting for approval", "Acuerdo esperando aprobación") : t("约定在修改", "Agreement being revised", "Acuerdo en revisión");
  if (!items || (hideEmpty && !items.length && !notice)) return null;
  return <section className="promise-list" data-testid="promise-list" aria-labelledby="promise-list-title">
    <h2 id="promise-list-title" className="space-subhead">{t("还欠着什么", "Promises to keep", "Promesas pendientes")}</h2>
    {notice && <p className="space-error" role="alert">{notice}</p>}
    {!items.length && <p className="promise-empty">{t("你们在对话里答应对方的事，Pinky 会记在这里。", "When you promise each other something in a chat, Pinky keeps it here.", "Cuando se prometan algo en un chat, Pinky lo guardará aquí.")}</p>}
    {items.map((item) => <article key={item.id} className={`promise-item is-${item.status}${item.later ? " is-later" : ""}`} data-testid="promise-item">
      <div className="promise-head"><span>{who(item)}</span>{!item.shared && <em className="promise-private"><LockKey size={13} />{t("只有你看得到", "Only you see this", "Solo tú lo ves")}</em>}</div>
      <strong>{item.description}{item.when && <small> · {item.when}</small>}</strong>
      {item.quote && <q>{item.quote}</q>}
      <div className="promise-tags">
        {item.status === "kept" && <span className="is-kept"><CheckCircle size={14} weight="fill" />{t("做到了", "Done", "Hecho")}{item.keptAt ? ` · ${day(item.keptAt)}` : ""}</span>}
        {item.status === "open" && item.later && <span>{t("先不提，过几天再说", "Not now; Pinky will wait", "Ahora no; Pinky esperará")}</span>}
        {agreementState(item) && <span><Handshake size={14} />{agreementState(item)}</span>}
      </div>
      {sharing?.id === item.id ? <div className="promise-share">
        <small>{t(`确认后会发到“我们俩”，${partnerName} 会看到这句话（你的原话不会）：`, `Once you confirm, ${partnerName} sees exactly this in Us (never your own words from Just me):`, `Al confirmar, ${partnerName} verá exactamente esto en Nosotros (nunca tus palabras de Solo yo):`)}</small>
        <KeyboardTextarea aria-label={t("要分享的话", "What to share", "Lo que compartirás")} value={sharing.text} maxLength={600} rows={2} onChange={(event) => setSharing({ id: item.id, text: event.target.value })} onBlur={() => keyboard.hide()} />
        <div className="promise-actions"><button className="is-primary" disabled={busy === item.id || !sharing.text.trim()} onClick={() => void act(item, "share", { confirm: true, text: sharing.text.trim() })}><PaperPlaneRight size={16} weight="fill" />{t("确认分享", "Share it", "Compartir")}</button><button disabled={busy === item.id} onClick={() => { keyboard.hide(); setSharing(null); }}>{t("取消", "Cancel", "Cancelar")}</button></div>
      </div> : <div className="promise-actions">
        {item.status === "open" ? <>
          <button className="is-primary" disabled={busy === item.id} onClick={() => void act(item, "done")} data-testid="promise-done"><CheckCircle size={16} weight="fill" />{t("做到了", "Done", "Hecho")}</button>
          {!item.later && <button disabled={busy === item.id} onClick={() => void act(item, "later")}>{t("先不提", "Not now", "Ahora no")}</button>}
        </> : <button disabled={busy === item.id} onClick={() => void act(item, "reopen")}><ArrowCounterClockwise size={16} />{t("还没做到", "Not done yet", "Aún no")}</button>}
        <button className="promise-more" aria-expanded={more === item.id} aria-label={t("更多", "More", "Más")} onClick={() => setMore(more === item.id ? "" : item.id)}><DotsThree size={20} weight="bold" /></button>
      </div>}
      {more === item.id && !sharing && <div className="promise-actions is-more">
        {!item.shared && <button disabled={busy === item.id} onClick={() => setSharing({ id: item.id, text: item.shareText || item.description })}><PaperPlaneRight size={16} />{t(`告诉 ${partnerName}`, `Tell ${partnerName}`, `Contárselo a ${partnerName}`)}</button>}
        {item.shared && item.status === "open" && !item.agreement && <button disabled={busy === item.id} onClick={() => void act(item, "agreement")}><Handshake size={16} />{t("定成约定（两人都批准才算）", "Make it an agreement (both approve)", "Convertir en acuerdo (ambos aprueban)")}</button>}
        <button disabled={busy === item.id} onClick={() => void act(item, "dismiss")}>{t("这不算承诺", "Not a promise", "No es una promesa")}</button>
      </div>}
    </article>)}
  </section>;
}
