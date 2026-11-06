import { useEffect, useState } from "react";
import { Drop, Heart, LockKey, Trash } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { jsonBody, relationshipApi } from "../relationship/api";

type Prediction = { cycle: number; length: number; lastStart: string; inPeriod: number | null; nextStart: string; daysUntil: number; learned: number };
export type CycleView = { mine: { prediction: Prediction; logs: Array<{ id: string; start: string; end: string | null }>; sharing: boolean } | null; partnerName: string | null; care: { name: string } | null };

export const loadCycle = () => relationshipApi<CycleView>(`/api/cycle?timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")}`);

/** 经期 (founder 11-06) on the owner's own Coming up: where they are and the next estimate, only for them. "让 TA 知道" is their
 * choice and gives the partner nothing but "这几天多照顾你一点". For the partner, only that gentle note, when it applies. */
export function CycleCard({ language, view, onChanged }: { language: Language; view: CycleView; onChanged: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [busy, setBusy] = useState(false), [confirming, setConfirming] = useState(""), [error, setError] = useState("");
  const partner = view.partnerName || t("TA", "your partner", "tu pareja");
  const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(languageTag(language), { month: "long", day: "numeric", timeZone: "UTC" });
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setError(""); try { await action(); onChanged(); } catch (caught) { setError((caught as Error).message); } finally { setBusy(false); } };
  const care = view.care && <section className="cycle-care" data-testid="care-note"><Heart size={18} weight="fill" />{t(`这几天多照顾 ${view.care.name} 一点`, `Be extra caring with ${view.care.name} these days`, `Cuida un poco más a ${view.care.name} estos días`)}</section>;
  if (!view.mine) return care || null;
  const { prediction, logs, sharing } = view.mine;
  return <>{care}<section className="cycle-card" data-testid="cycle-card">
    <small className="cycle-private"><LockKey size={13} />{t("只有你能看到", "Only you can see this", "Solo tú lo ves")}</small>
    <strong><Drop size={20} weight="fill" />{prediction.inPeriod ? t(`经期第 ${prediction.inPeriod} 天`, `Day ${prediction.inPeriod} of your period`, `Día ${prediction.inPeriod} de tu periodo`) : prediction.daysUntil === 0 ? t("预计今天开始", "Expected to start today", "Se espera que empiece hoy") : t(`下次预计 ${day(prediction.nextStart)} · 还有 ${prediction.daysUntil} 天`, `Next expected ${day(prediction.nextStart)} · in ${prediction.daysUntil} days`, `Próximo previsto ${day(prediction.nextStart)} · en ${prediction.daysUntil} días`)}</strong>
    <p>{prediction.learned ? t(`按你最近 ${prediction.learned + 1} 次记录，周期约 ${prediction.cycle} 天，每次约 ${prediction.length} 天。只是估算。`, `From your last ${prediction.learned + 1} logs: about ${prediction.cycle} days apart, ${prediction.length} days long. Just an estimate.`, `Según tus últimos ${prediction.learned + 1} registros: unos ${prediction.cycle} días entre uno y otro, ${prediction.length} de duración. Es una estimación.`) : t(`先按 ${prediction.cycle} 天一个周期估算，多记几次会更准。来了或结束时跟 Pinky 说一声就行。`, `Estimated on a ${prediction.cycle}-day cycle for now; it gets better as you log. Just tell Pinky when it starts or ends.`, `Por ahora se estima un ciclo de ${prediction.cycle} días; mejora con más registros. Solo dile a Pinky cuándo empieza o termina.`)}</p>
    {view.partnerName && <label className="cycle-share"><input type="checkbox" checked={sharing} disabled={busy} onChange={(event) => void run(() => relationshipApi("/api/cycle/sharing", jsonBody({ on: event.target.checked })))} data-testid="cycle-share" />
      <span><b>{t(`让 ${partner} 知道`, `Let ${partner} know`, `Que ${partner} lo sepa`)}</b><small>{t(`那几天 ${partner} 只会看到“这几天多照顾你一点”，看不到日期，也不知道原因。随时可以关掉。`, `On those days ${partner} only sees "be extra caring these days": no dates, no reason. Turn it off anytime.`, `Esos días ${partner} solo verá «cuídale un poco más estos días»: sin fechas ni motivo. Puedes desactivarlo cuando quieras.`)}</small></span></label>}
    <details className="cycle-logs"><summary>{t("记录", "Logs", "Registros")}</summary><ul>{logs.map((log) => <li key={log.id}><span>{day(log.start)}{log.end ? ` – ${day(log.end)}` : ""}</span>
      <button type="button" className={confirming === log.id ? "confirming" : ""} disabled={busy} onClick={() => { if (confirming !== log.id) { setConfirming(log.id); return; } setConfirming(""); void run(() => relationshipApi(`/api/cycle/${encodeURIComponent(log.id)}`, { method: "DELETE" })); }} aria-label={t("删除这条", "Delete this log", "Borrar este registro")}>{confirming === log.id ? t("确认删除", "Delete?", "¿Borrar?") : <Trash size={15} />}</button></li>)}</ul></details>
    {error && <p className="space-error" role="alert">{error}</p>}
  </section></>;
}

export function useCycle() {
  const [view, setView] = useState<CycleView | null>(null);
  const reload = () => { loadCycle().then(setView).catch(() => setView(null)); };
  useEffect(reload, []);
  return { view, reload };
}
