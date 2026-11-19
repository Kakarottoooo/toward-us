import { useCallback, useEffect, useState } from "react";
import { GameController, Heart, Sparkle } from "@phosphor-icons/react";
import { counted, languageTag, localized, type Language } from "../../i18n";
import { relationshipApi } from "../relationship/api";
import "./play-week.css";

type Goal = "cards" | "games" | "notes";
type Week = {
  timezone: string;
  today: string;
  start: string;
  end: string;
  counts: Record<Goal, number>;
};

const asDate = (day: string) => new Date(`${day}T12:00:00Z`);

export function PlayWeek({ language }: { language: Language }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [week, setWeek] = useState<Week | null>(null);
  const [failed, setFailed] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [request, setRequest] = useState(0);
  const reload = useCallback(() => setRequest((previous) => previous + 1), []);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    setFailed(false);
    void relationshipApi<Week>(`/api/play-week?language=${language}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setWeek(data); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [language, online, request]);

  const today = week?.today;
  const timezone = week?.timezone;
  useEffect(() => {
    if (!today || !timezone || !online) return;
    const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
    let observedDay = today;
    const refreshIfNewDay = () => {
      if (document.visibilityState !== "visible") return;
      const parts = dayFormat.formatToParts(new Date());
      const value = (type: string) => parts.find((part) => part.type === type)?.value;
      const day = `${value("year")}-${value("month")}-${value("day")}`;
      if (day === observedDay) return;
      observedDay = day;
      reload();
    };
    const clock = window.setInterval(refreshIfNewDay, 60_000);
    const refreshOnReturn = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [online, reload, timezone, today]);

  const shortDate = new Intl.DateTimeFormat(languageTag(language), { month: "short", day: "numeric", timeZone: "UTC" });
  const title = t("这周", "This week", "Esta semana");
  const counts = week?.counts;
  const notes = counts?.notes === 2 ? t("两个人都给对方留了心意", "You both reached out", "Ambos tuvieron un detalle")
    : counts?.notes === 1 ? t("有一人给对方留了心意", "One of you reached out", "Uno tuvo un detalle")
      : t("还没有小卡或「想你了」", "No little cards or Thinking of You yet", "Aún no hay tarjetas ni «Pensé en ti»");
  return (
    <section className="play-week" aria-label={title} data-testid="play-week">
      <header className="play-week-header">
        <h3>{title}</h3>
        {week && <p>{shortDate.format(asDate(week.start))} – {shortDate.format(asDate(week.end))}</p>}
      </header>
      {!online && <p className="play-week-status" role="status">{week
        ? t("已离线，显示上次同步的记录。", "Offline. Showing your last synced activity.", "Sin conexión. Se muestra la última actividad.")
        : t("联网后可以查看。", "Connect to see this week.", "Conéctense para ver esta semana.")}</p>}
      {online && failed && <div className="play-week-status" role="alert">
        <p>{t("本周记录暂时没加载出来。", "Couldn’t load this week.", "No se pudo cargar esta semana.")}</p>
        <button type="button" onClick={reload}>{t("重试", "Try again", "Reintentar")}</button>
      </div>}
      {online && !week && !failed && <p className="play-week-status" role="status">{t("正在读取本周记录…", "Loading this week…", "Cargando esta semana…")}</p>}
      {counts && <ul className="play-week-summary">
        <li><Sparkle size={19} aria-hidden="true" />{t(`一起答完 ${counts.cards} 道题`, `Answered ${counted(counts.cards, "question", "questions")} together`, `Respondieron ${counted(counts.cards, "pregunta", "preguntas")} juntos`)}</li>
        <li><GameController size={19} aria-hidden="true" />{t(`一起玩完 ${counts.games} 局游戏`, `Finished ${counted(counts.games, "game", "games")} together`, `Terminaron ${counted(counts.games, "juego", "juegos")} juntos`)}</li>
        <li><Heart size={19} aria-hidden="true" />{notes}</li>
      </ul>}
    </section>
  );
}
