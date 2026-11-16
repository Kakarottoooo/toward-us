import { useCallback, useEffect, useState } from "react";
import { Check, GameController, Heart, PawPrint, Sparkle } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import type { PetView } from "../character/PetPanel";
import { relationshipApi } from "../relationship/api";
import "./play-week.css";

type Goal = "cards" | "games" | "notes";
type Week = {
  timezone: string;
  today: string;
  start: string;
  end: string;
  counts: Record<Goal, number>;
  targets: Record<Goal, number>;
  days: string[];
};

type PlayWeekProps = {
  language: Language;
  revision: number;
  pet?: Pick<PetView, "level" | "points" | "floor" | "next"> | null;
  onOpenPet?: () => void;
};

const asDate = (day: string) => new Date(`${day}T12:00:00Z`);
const daysOf = (start: string) => Array.from({ length: 7 }, (_, offset) => {
  const date = asDate(start);
  date.setUTCDate(date.getUTCDate() + offset);
  return { date, day: date.toISOString().slice(0, 10) };
});

export function PlayWeek({ language, revision, pet, onOpenPet }: PlayWeekProps) {
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
  }, [language, online, request, revision]);

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
    document.addEventListener("visibilitychange", refreshIfNewDay);
    return () => {
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", refreshIfNewDay);
    };
  }, [online, reload, timezone, today]);

  const goals = [
    { key: "cards", icon: Sparkle, title: t("翻开三道本周每日题", "Reveal three of this week’s daily cards", "Revelen tres preguntas de esta semana") },
    { key: "games", icon: GameController, title: t("完成本周开的一局游戏", "Finish a game you start this week", "Terminen un juego que empiecen esta semana") },
    { key: "notes", icon: Heart, title: t("两人各送一次想你了", "Each send a Thinking of you", "Envíense un «Pensé en ti» cada uno") },
  ] as const;
  const shortDate = new Intl.DateTimeFormat(languageTag(language), { month: "short", day: "numeric", timeZone: "UTC" });
  const fullDate = new Intl.DateTimeFormat(languageTag(language), { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  const weekday = new Intl.DateTimeFormat(languageTag(language), { weekday: "short", timeZone: "UTC" });
  const title = t("这周一起做", "This week together", "Esta semana juntos");
  const petTitle = t("小家伙", "Your pet", "Su mascota");
  const petProgress = pet ? Math.max(0, pet.points - pet.floor) : 0;
  const petTarget = pet ? Math.max(1, pet.next - pet.floor) : 1;
  const finished = week ? goals.filter(({ key }) => week.counts[key] >= week.targets[key]).length : 0;
  return (
    <section className="play-week" aria-label={title} data-testid="play-week">
      <header className="play-week-header">
        <div>
          <h2>{title}</h2>
          {week && <p>{shortDate.format(asDate(week.start))} – {shortDate.format(asDate(week.end))}</p>}
        </div>
        {week && <span>{t(
          `完成 ${finished} / ${goals.length} 项`,
          `${finished} of ${goals.length} done`,
          `${finished} de ${goals.length} completadas`,
        )}</span>}
      </header>
      {!online && <p className="play-week-status" role="status">{week
        ? t("已离线，显示上次同步的进度。", "Offline. Showing your last synced progress.", "Sin conexión. Se muestra el último progreso sincronizado.")
        : t("联网后就能看本周进度。", "Your progress will appear when you’re online.", "Verán su progreso cuando vuelvan a conectarse.")}</p>}
      {online && failed && <div className="play-week-status" role="status">
        <p>{t("本周进度暂时没加载出来。", "This week’s progress couldn’t load.", "No se pudo cargar el progreso de esta semana.")}</p>
        <button className="play-quiet" type="button" onClick={reload}>{t("重试", "Try again", "Reintentar")}</button>
      </div>}
      {online && !week && !failed && <p className="play-week-status" role="status">{t("正在读取共同进度…", "Loading your week…", "Cargando su semana…")}</p>}
      {week && <>
        <ol className="play-week-days" aria-label={t("本周共同互动的日期", "Days with a shared activity", "Días con una actividad compartida")}>
          {daysOf(week.start).map(({ date, day }) => {
            const done = week.days.includes(day);
            const label = t(`${fullDate.format(date)}，${done ? "有一起完成的互动" : "暂无一起完成的互动"}`,
              `${fullDate.format(date)}, ${done ? "shared activity completed" : "no shared activity yet"}`,
              `${fullDate.format(date)}, ${done ? "actividad compartida completada" : "aún sin actividad compartida"}`);
            return <li key={day} className={done ? "is-complete" : ""} aria-label={label} aria-current={day === week.today ? "date" : undefined}>
              <span>{weekday.format(date)}</span>
              <span>{done ? <Check size={14} weight="bold" aria-hidden="true" /> : <span aria-hidden="true" />}</span>
            </li>;
          })}
        </ol>
        <ul className="play-week-goals">
          {goals.map(({ key, title: goalTitle, icon: Icon }) => {
            const target = week.targets[key];
            const current = Math.min(week.counts[key], target);
            return <li key={key}>
              <Icon size={20} weight={current === target ? "fill" : "regular"} aria-hidden="true" />
              <div>
                <div className="play-week-goal-label"><strong>{goalTitle}</strong><span>{current} / {target}</span></div>
                <progress value={current} max={target} aria-label={goalTitle} />
              </div>
            </li>;
          })}
        </ul>
      </>}
      {pet && <div className="play-week-pet">
        <PawPrint size={23} weight="fill" aria-hidden="true" />
        <div>
          <p><strong>{petTitle}</strong> <span>{t(`等级 ${pet.level}`, `Level ${pet.level}`, `Nivel ${pet.level}`)}</span></p>
          <progress value={Math.min(petProgress, petTarget)} max={petTarget} aria-label={t("小家伙的成长", "Your pet’s growth", "Crecimiento de su mascota")} />
          <p>{t(`离下一级还有 ${Math.max(0, petTarget - petProgress)} 点`,
            `${Math.max(0, petTarget - petProgress)} points to the next level`, `${Math.max(0, petTarget - petProgress)} puntos para el próximo nivel`)}</p>
        </div>
        {onOpenPet && <button className="play-quiet" type="button" onClick={onOpenPet}>{t("看看它", "Visit", "Visitar")}</button>}
      </div>}
    </section>
  );
}
