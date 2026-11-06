import { useCallback, useEffect, useState } from "react";
import { CheckCircle, Trash } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { jsonBody, relationshipApi } from "../relationship/api";

type Money = { currency: string; amount: number };
type Entry = { id: string; title: string; date: string; amount: number; currency: string; split: "half" | "for_other"; paidBy: "me" | "partner"; settled: boolean; settle: boolean; settledBalance?: Array<Money & { owedTo: "me" | "partner" }> };
type Ledger = { id: string; title: string; partnerName: string | null; balance: Money[]; entries: Entry[] };

/** 我们的账本 (founder 11-06): who owes whom at the top, then every entry by month. Entries come from the conversation; the page
 * only settles up and removes a wrong entry. */
export function LedgerView({ id, language, onError }: { id: string; language: Language; onError: (message: string) => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setLedger((await relationshipApi<{ ledger: Ledger }>(`/api/ledger/${encodeURIComponent(id)}`)).ledger); } catch (error) { onError((error as Error).message); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const events = new EventSource("/api/relationship/events");
    events.addEventListener("relationship", (event) => { try { if (/^space/.test(JSON.parse((event as MessageEvent).data).eventType)) void load(); } catch { /* Ignore malformed events. */ } });
    return () => events.close();
  }, [load]);
  if (!ledger) return null;
  const partner = ledger.partnerName || t("TA", "your partner", "tu pareja");
  const money = (amount: number, currency: string) => { try { return new Intl.NumberFormat(languageTag(language), { style: "currency", currency, maximumFractionDigits: 2 }).format(amount); } catch { return `${amount} ${currency}`; } };
  const owed = (item: Money) => item.amount > 0 ? t(`${partner} 欠你 ${money(item.amount, item.currency)}`, `${partner} owes you ${money(item.amount, item.currency)}`, `${partner} te debe ${money(item.amount, item.currency)}`) : t(`你欠 ${partner} ${money(-item.amount, item.currency)}`, `You owe ${partner} ${money(-item.amount, item.currency)}`, `Le debes ${money(-item.amount, item.currency)} a ${partner}`);
  const month = new Date().toISOString().slice(0, 7);
  const spent = Object.entries(ledger.entries.filter((entry) => !entry.settle && entry.date.slice(0, 7) === month).reduce<Record<string, number>>((sum, entry) => ({ ...sum, [entry.currency]: (sum[entry.currency] || 0) + entry.amount }), {}));
  const groups = ledger.entries.reduce<Array<{ label: string; entries: Entry[] }>>((all, entry) => {
    const label = new Date(`${entry.date.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString(languageTag(language), { year: "numeric", month: "long", timeZone: "UTC" });
    const last = all.at(-1); if (last?.label === label) last.entries.push(entry); else all.push({ label, entries: [entry] }); return all;
  }, []);
  const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(languageTag(language), { month: "short", day: "numeric", timeZone: "UTC" });
  const how = (entry: Entry) => `${entry.paidBy === "me" ? t("你付", "You paid", "Pagaste tú") : t(`${partner} 付`, `${partner} paid`, `Pagó ${partner}`)} · ${entry.split === "for_other" ? (entry.paidBy === "me" ? t(`全算 ${partner} 的`, `all for ${partner}`, `todo para ${partner}`) : t("全算你的", "all for you", "todo para ti")) : t("各一半", "split in half", "a medias")}`;
  const settle = async () => {
    if (confirming !== "settle") { setConfirming("settle"); return; }
    setConfirming(null); setBusy(true);
    try { setLedger((await relationshipApi<{ ledger: Ledger }>(`/api/ledger/${encodeURIComponent(id)}/settle`, jsonBody({ language }))).ledger); } catch (error) { onError((error as Error).message); } finally { setBusy(false); }
  };
  const remove = async (entry: Entry) => {
    if (confirming !== entry.id) { setConfirming(entry.id); return; }
    setConfirming(null);
    try { await relationshipApi(`/api/space-items/${entry.id}/archive`, jsonBody({})); await load(); } catch (error) { onError((error as Error).message); }
  };
  return <div className="ledger" data-testid="ledger">
    <section className="ledger-balance">
      {ledger.balance.length ? ledger.balance.map((item) => <strong key={item.currency}>{owed(item)}</strong>) : <strong>{t("你们两清了", "You're even", "Están a mano")}</strong>}
      {!!spent.length && <small>{t("这个月一起花了 ", "Spent together this month: ", "Gastado juntos este mes: ")}{spent.map(([currency, total]) => money(total, currency)).join(" + ")}</small>}
      {!!ledger.balance.length && <button type="button" className={confirming === "settle" ? "confirming" : ""} disabled={busy} onClick={() => void settle()} data-testid="ledger-settle"><CheckCircle size={18} />{confirming === "settle" ? t("确认已经结清", "Confirm you've settled up", "Confirmar que saldaron") : t("结清", "Settle up", "Saldar cuentas")}</button>}
    </section>
    {!ledger.entries.length ? <p className="space-empty">{t("还没有记账。在“我们俩”里说“Pinky，晚饭我付了 320”就会记进来。", "Nothing yet. Say “Pinky, I paid 40 for dinner” in Us and it lands here.", "Aún no hay nada. Di «Pinky, pagué 40 de la cena» en Nosotros y aparecerá aquí.")}</p>
      : groups.map((group) => <section key={group.label} className="ledger-month"><h2 className="space-subhead">{group.label}</h2><ul>{group.entries.map((entry) => entry.settle
        ? <li key={entry.id} className="ledger-settled-note"><CheckCircle size={16} weight="fill" /><span>{t("结清了", "Settled up", "Cuentas saldadas")}{(entry.settledBalance || []).map((item) => ` · ${item.owedTo === "me" ? t(`${partner} 给你 `, `${partner} paid you `, `${partner} te pagó `) : t(`你给 ${partner} `, `you paid ${partner} `, `pagaste a ${partner} `)}${money(item.amount, item.currency)}`).join("")}</span><small>{day(entry.date)}</small></li>
        : <li key={entry.id} className={entry.settled ? "is-settled" : ""}>
          <div><strong>{entry.title}</strong><small>{day(entry.date)} · {how(entry)}</small></div>
          <span className="ledger-amount">{money(entry.amount, entry.currency)}</span>
          {!entry.settled && <button type="button" className={`space-remove ${confirming === entry.id ? "confirming" : ""}`} onClick={() => void remove(entry)} aria-label={t("删除", "Delete", "Eliminar")}>{confirming === entry.id ? t("确认删除", "Delete?", "¿Eliminar?") : <Trash size={16} />}</button>}
        </li>)}</ul></section>)}
  </div>;
}
