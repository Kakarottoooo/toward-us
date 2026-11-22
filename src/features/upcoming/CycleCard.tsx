import { useEffect, useState } from "react";
import { Drop, Heart, LockKey, PencilSimple, Trash } from "@phosphor-icons/react";
import { counted, languageTag, localized, type Language } from "../../i18n";
import { jsonBody, relationshipApi } from "../relationship/api";
import { KeyboardInput } from "../../mobile";

type Prediction = { cycle: number; length: number; lastStart: string; inPeriod: number | null; nextStart: string; daysUntil: number; learned: number };
export type CycleView = { mine: { prediction: Prediction; logs: Array<{ id: string; start: string; end: string | null }>; sharing: boolean } | null; partnerName: string | null; care: { name: string } | null };

export const loadCycle = () => relationshipApi<CycleView>(`/api/cycle?timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")}`);

/** 经期 (founder 11-06) on the owner's own Coming up: where they are and the next estimate, only for them. "让 TA 知道" is their
 * choice and gives the partner nothing but "这几天多照顾你一点". For the partner, only that gentle note, when it applies. */
export function CycleCard({ language, view, onChanged, showEmpty = false }: { language: Language; view: CycleView; onChanged: () => void; showEmpty?: boolean }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [busy, setBusy] = useState(false), [confirming, setConfirming] = useState(""), [error, setError] = useState("");
  // Logged by hand here, with or without Ourever (QA round 3: it used to work only by telling Ourever in Just me).
  const today = new Date().toLocaleDateString("en-CA");
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [picking, setPicking] = useState<"start" | "end" | null>(null), [picked, setPicked] = useState(today);
  const [editing, setEditing] = useState<{ id: string; start: string; end: string } | null>(null);
  const [undo, setUndo] = useState<{ start: string; end: string | null } | null>(null);
  useEffect(() => { if (!undo) return; const timer = window.setTimeout(() => setUndo(null), 10_000); return () => clearTimeout(timer); }, [undo]);
  const partner = view.partnerName || t("TA", "your partner", "tu pareja");
  const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(languageTag(language), { month: "long", day: "numeric", timeZone: "UTC" });
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setError(""); try { await action(); onChanged(); } catch (caught) { setError((caught as Error).message); } finally { setBusy(false); } };
  const log = (event: "start" | "end", date: string) => run(async () => { await relationshipApi("/api/cycle/log", jsonBody({ event, date, timezone: zone, language })); setPicking(null); });
  const save = (edit: { id: string; start: string; end: string }) => run(async () => { await relationshipApi(`/api/cycle/${encodeURIComponent(edit.id)}`, { ...jsonBody({ start: edit.start, end: edit.end || null, timezone: zone, language }), method: "PATCH" }); setEditing(null); });
  const remove = (entry: { id: string; start: string; end: string | null }) => run(async () => { await relationshipApi(`/api/cycle/${encodeURIComponent(entry.id)}`, { method: "DELETE" }); setUndo({ start: entry.start, end: entry.end }); });
  const restore = () => { const entry = undo; setUndo(null); if (entry) void run(() => relationshipApi("/api/cycle/restore", jsonBody({ ...entry, timezone: zone, language }))); };
  const quick = (event: "start" | "end") => <span className="cycle-actions">
    <button type="button" className="cycle-start" disabled={busy} onClick={() => void log(event, today)} data-testid={`cycle-${event}`}>{event === "start" ? t("今天来了", "It started today", "Hoy empezó") : t("今天结束了", "It ended today", "Hoy terminó")}</button>
    <button type="button" className="cycle-other" disabled={busy} onClick={() => { setPicked(today); setPicking(picking === event ? null : event); }} aria-expanded={picking === event} data-testid={`cycle-${event}-other`}>{t("选别的日期", "Another day", "Otro día")}</button>
  </span>;
  const picker = picking && <form className="cycle-pick" onSubmit={(event) => { event.preventDefault(); void log(picking, picked); }}>
    <label>{picking === "start" ? t("哪天开始的", "Started on", "Empezó el") : t("哪天结束的", "Ended on", "Terminó el")}<KeyboardInput type="date" required max={today} value={picked} onChange={(event) => setPicked(event.target.value)} data-testid="cycle-date" /></label>
    <button type="submit" className="cycle-start" disabled={busy || !picked} data-testid="cycle-date-save">{t("记下", "Save", "Guardar")}</button>
  </form>;
  const undoBar = undo && <p className="cycle-undo" role="status">{t("已删除这条记录。", "Log deleted.", "Registro borrado.")}<button type="button" onClick={restore} data-testid="cycle-undo">{t("撤销", "Undo", "Deshacer")}</button></p>;
  const medicalNote = <p>{t("周期预测仅供记录，不能用于避孕、诊断或医疗决策。", "Cycle estimates are for tracking only. Do not use them for contraception, diagnosis or medical decisions.", "Las estimaciones solo sirven de registro. No las uses para anticoncepción, diagnóstico ni decisiones médicas.")}</p>;
  const care = view.care && <section className="cycle-care" data-testid="care-note"><Heart size={18} weight="fill" />{t(`这几天多照顾 ${view.care.name} 一点`, `Be extra caring with ${view.care.name} these days`, `Cuida un poco más a ${view.care.name} estos días`)}</section>;
  // Opened from the drawer before anything is logged: say how to start, and start it in one tap (in Just me).
  if (!view.mine) return showEmpty ? <>{care}<section className="cycle-card" data-testid="cycle-card" ref={(node) => node?.scrollIntoView({ block: "start" })}>
    <small className="cycle-private"><LockKey size={13} />{t("只有你能看到", "Only you can see this", "Solo tú lo ves")}</small>
    <strong><Drop size={20} weight="fill" />{t("经期记录", "Period tracking", "Registro del periodo")}</strong>
    <p>{t("来了或结束的时候在这里记一笔（也可以在“只有我”里跟 Ourever 说）。记过两三次后，这里会算出下次大概几号。TA 什么都看不到，除非你自己打开“让 TA 知道”。", "Log it here when it starts or ends (or tell Ourever in Just me). After a couple of times it estimates the next one here. Your partner sees nothing unless you turn on \"let them know\".", "Regístralo aquí cuando empiece o termine (o díselo a Ourever en Solo yo). Tras un par de veces estimará el próximo aquí. Tu pareja no ve nada salvo que actives \"que lo sepa\".")}</p>
    {medicalNote}
    {quick("start")}{picker}{undoBar}
    {error && <p className="space-error" role="alert">{error}</p>}
  </section></> : care || null;
  const { prediction, logs, sharing } = view.mine;
  const open = logs[0] && !logs[0].end && prediction.inPeriod ? logs[0] : null;
  return <>{care}<section className="cycle-card" data-testid="cycle-card" ref={(node) => { if (showEmpty) node?.scrollIntoView({ block: "start" }); }}>
    <small className="cycle-private"><LockKey size={13} />{t("只有你能看到", "Only you can see this", "Solo tú lo ves")}</small>
    <strong><Drop size={20} weight="fill" />{prediction.inPeriod ? t(`经期第 ${prediction.inPeriod} 天`, `Day ${prediction.inPeriod} of your period`, `Día ${prediction.inPeriod} de tu periodo`) : prediction.daysUntil === 0 ? t("预计今天开始", "Expected to start today", "Se espera que empiece hoy") : t(`下次预计 ${day(prediction.nextStart)} · 还有 ${prediction.daysUntil} 天`, `Next expected ${day(prediction.nextStart)} · in ${counted(prediction.daysUntil, "day", "days")}`, `Próximo previsto ${day(prediction.nextStart)} · en ${counted(prediction.daysUntil, "día", "días")}`)}</strong>
    <p>{prediction.learned ? t(`按你最近 ${prediction.learned + 1} 次记录，周期约 ${prediction.cycle} 天，每次约 ${prediction.length} 天。只是估算。`, `From your last ${counted(prediction.learned + 1, "log", "logs")}: about ${counted(prediction.cycle, "day", "days")} apart, ${counted(prediction.length, "day", "days")} long. Just an estimate.`, `Según tus últimos ${counted(prediction.learned + 1, "registro", "registros")}: unos ${counted(prediction.cycle, "día", "días")} entre uno y otro, ${prediction.length} de duración. Es una estimación.`) : t(`先按 ${prediction.cycle} 天一个周期估算，多记几次会更准。来了或结束时在这里记一笔就行。`, `Estimated on a ${prediction.cycle}-day cycle for now; it gets better as you log. Log it here when it starts or ends.`, `Por ahora se estima un ciclo de ${counted(prediction.cycle, "día", "días")}; mejora con más registros. Regístralo aquí cuando empiece o termine.`)}</p>
    {medicalNote}
    {quick(open ? "end" : "start")}{picker}
    {view.partnerName && <label className="cycle-share"><input type="checkbox" checked={sharing} disabled={busy} onChange={(event) => void run(() => relationshipApi("/api/cycle/sharing", jsonBody({ on: event.target.checked })))} data-testid="cycle-share" />
      <span><b>{t(`让 ${partner} 知道`, `Let ${partner} know`, `Que ${partner} lo sepa`)}</b><small>{t(`那几天 ${partner} 只会看到“这几天多照顾你一点”，看不到日期，也不知道原因。随时可以关掉。`, `On those days ${partner} only sees "be extra caring these days": no dates, no reason. Turn it off anytime.`, `Esos días ${partner} solo verá «cuídale un poco más estos días»: sin fechas ni motivo. Puedes desactivarlo cuando quieras.`)}</small></span></label>}
    {undoBar}
    <details className="cycle-logs"><summary>{t("记录", "Logs", "Registros")}</summary><ul>{logs.map((entry) => editing?.id === entry.id ? <li key={entry.id}><form className="cycle-edit" onSubmit={(event) => { event.preventDefault(); void save(editing); }}>
        <label>{t("开始", "Start", "Inicio")}<KeyboardInput type="date" required max={today} value={editing.start} onChange={(event) => setEditing({ ...editing, start: event.target.value })} data-testid="cycle-edit-start" /></label>
        <label>{t("结束（可空）", "End (optional)", "Fin (opcional)")}<KeyboardInput type="date" min={editing.start} max={today} value={editing.end} onChange={(event) => setEditing({ ...editing, end: event.target.value })} data-testid="cycle-edit-end" /></label>
        <span><button type="button" disabled={busy} onClick={() => setEditing(null)}>{t("取消", "Cancel", "Cancelar")}</button><button type="submit" className="cycle-start" disabled={busy || !editing.start} data-testid="cycle-edit-save">{t("保存", "Save", "Guardar")}</button></span>
      </form></li> : <li key={entry.id}><span>{day(entry.start)}{entry.end ? ` – ${day(entry.end)}` : ""}</span><span>
      <button type="button" disabled={busy} onClick={() => { setConfirming(""); setEditing({ id: entry.id, start: entry.start, end: entry.end || "" }); }} aria-label={t("修改这条", "Edit this log", "Editar este registro")} data-testid="cycle-edit"><PencilSimple size={15} /></button>
      <button type="button" className={confirming === entry.id ? "confirming" : ""} disabled={busy} onClick={() => { if (confirming !== entry.id) { setConfirming(entry.id); return; } setConfirming(""); void remove(entry); }} aria-label={t("删除这条", "Delete this log", "Borrar este registro")} data-testid="cycle-delete">{confirming === entry.id ? t("确认删除", "Delete?", "¿Borrar?") : <Trash size={15} />}</button></span></li>)}</ul></details>
    {error && <p className="space-error" role="alert">{error}</p>}
  </section></>;
}

export function useCycle() {
  const [view, setView] = useState<CycleView | null>(null);
  const reload = () => { loadCycle().then(setView).catch(() => setView(null)); };
  useEffect(reload, []);
  return { view, reload };
}
