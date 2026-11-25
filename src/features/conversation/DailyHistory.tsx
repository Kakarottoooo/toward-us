import { useEffect, useState } from "react";
import { languageTag, localized, type Language } from "../../i18n";
import { relationshipApi } from "../relationship/api";
import { Sketch, type Stroke } from "../games/PlayDrawing";

type Row = { id: string; day: string; question: string; answers: { userId: string; text: string; drawing?: Stroke[] }[] };
type Page = { rows: Row[]; next: string | null; days?: number };

export default function DailyHistory({ language, userId, partner, currentId }: { language: Language; userId: string; partner: string; currentId?: string }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<Page | null>(null);
  const [cursor, setCursor] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
    if (cursor) query.set("before", cursor);
    setState("loading");
    void relationshipApi<Page>("/api/together/daily/history?" + query, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(result => {
        if (controller.signal.aborted) return;
        setPage(previous => cursor && previous ? { rows: [...previous.rows, ...result.rows], next: result.next, days: previous.days } : result);
        setState("ready");
      }).catch(() => { if (!controller.signal.aborted) setState("failed"); });
    return () => controller.abort();
  }, [language, cursor, attempt]);
  const rows = page?.rows.filter(row => row.id !== currentId || row.answers.length);
  const days = page?.days ?? 0;
  return <section className="daily-history">
    {page && <small data-testid="daily-streak">{t(`连续 ${days} 天一起来`, `${days}-day streak together`, `Racha juntos: ${days} ${days === 1 ? "día" : "días"}`)}</small>}
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{t("往日问题", "Question history", "Historial de preguntas")}</button>
    {state === "loading" && <small role="status">{t("正在读取…", "Loading…", "Cargando…")}</small>}
    {state === "failed" && <div role="alert">{t("暂时无法读取记录。", "Your history couldn’t load.", "No se pudo cargar el historial.")}
      <button type="button" onClick={() => setAttempt(n => n + 1)}>{t("重试", "Retry", "Reintentar")}</button></div>}
    {open && page && <div className="daily-history-rows">
      {!rows?.length && <p>{t("两人答完今天的问题后，就可以在这里重温。", "Once you both answer today’s question, you can revisit it here.", "Cuando ambos respondan la pregunta de hoy, podrán volver a verla aquí.")}</p>}
      {rows?.map(row => <details key={row.id}>
        <summary><time dateTime={row.day}>{new Date(row.day + "T12:00:00Z").toLocaleDateString(languageTag(language), { timeZone: "UTC", dateStyle: "medium" })}</time>{row.question}</summary>
        {row.answers.length ? row.answers.map(answer => <div key={answer.userId}><small>{answer.userId === userId ? t("你", "You", "Tú") : partner}</small>
          {answer.drawing?.length ? <Sketch strokes={answer.drawing} label={t("已揭晓的画", "Revealed drawing", "Dibujo revelado")} /> : <p>{answer.text}</p>}</div>) :
          <p>{t("等两人都回答后揭晓。", "Answers appear once you both answer.", "Las respuestas se revelan cuando ambos respondan.")}</p>}
      </details>)}
      {page.next && state === "ready" && <button type="button" onClick={() => setCursor(page.next!)}>{t("更早的问题", "Earlier questions", "Preguntas anteriores")}</button>}
    </div>}
  </section>;
}
