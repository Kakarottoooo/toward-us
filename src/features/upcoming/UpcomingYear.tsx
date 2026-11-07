import { useMemo, useState } from "react";
import { CaretLeft, CaretRight, ChatCircleDots, LockKey } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { holidaysFor } from "./holidays";
import "./upcoming.css";

export type CalendarKind = "date" | "holiday" | "plan" | "reminder";
/** One thing on the calendar. `yearly` dates repeat every year on the same month and day. */
export type CalendarEntry = { id: string; date: string; title: string; kind: CalendarKind; yearly?: boolean; private?: boolean; note?: string; onOpen?: () => void };
type Placed = CalendarEntry & { day: string };

const pad = (value: number) => String(value).padStart(2, "0");
const todayIso = () => { const now = new Date(); return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`; };
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
const holidayKey = "toward-us:calendar-holidays";

/** Entries as they fall in `year`: yearly dates move to that year (29 February to the 28th), one-off dates stay put. */
export function placeInYear(entries: CalendarEntry[], year: number): Placed[] {
  return entries.flatMap((entry) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return [];
    if (!entry.yearly) return entry.date.startsWith(`${year}-`) ? [{ ...entry, day: entry.date }] : [];
    const monthDay = entry.date.slice(5) === "02-29" && new Date(Date.UTC(year, 1, 29)).getUTCMonth() !== 1 ? "02-28" : entry.date.slice(5);
    return Date.parse(`${year}-${monthDay}`) >= Date.parse(entry.date.slice(0, 4) + "-01-01") ? [{ ...entry, day: `${year}-${monthDay}` }] : [];
  }).sort((a, b) => a.day.localeCompare(b.day) || kindOrder(a.kind) - kindOrder(b.kind));
}
const kindOrder = (kind: CalendarKind) => ["date", "plan", "reminder", "holiday"].indexOf(kind);

/** The year at a glance: the next date as a countdown, twelve small months with colored days, one month opened, then a list. */
export function UpcomingYear({ language, entries, onAsk, counted }: { language: Language; entries: CalendarEntry[]; onAsk: (text: string) => void; counted?: string }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const today = todayIso(), thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState(() => Number(today.slice(5, 7)) - 1);
  const [showHolidays, setShowHolidays] = useState(() => { try { return localStorage.getItem(holidayKey) !== "off"; } catch { return true; } });
  const toggleHolidays = () => { setShowHolidays((on) => { try { localStorage.setItem(holidayKey, on ? "off" : "on"); } catch { /* Kept for this visit only. */ } return !on; }); };
  const withHolidays = (target: number) => [...entries, ...(showHolidays ? holidaysFor(target, language).map((holiday) => ({ id: `holiday:${holiday.key}`, date: holiday.date, title: holiday.title, kind: "holiday" as const })) : [])];
  const placed = useMemo(() => placeInYear(withHolidays(year), year), [entries, year, showHolidays, language]);
  // What comes next always looks from today, across the turn of the year.
  const ahead = useMemo(() => [...placeInYear(withHolidays(thisYear), thisYear), ...placeInYear(withHolidays(thisYear + 1), thisYear + 1)].filter((entry) => entry.day >= today && daysBetween(today, entry.day) < 366), [entries, showHolidays, language, today]);
  // Coming up is for the whole relationship, not next week (founder 11-06): "next" and the list ahead are the dates that come
  // back (anniversaries, birthdays, holidays); one-off plans and reminders stay as dots on the calendar and in their month.
  const lasting = ahead.filter((entry) => entry.kind === "date" || entry.kind === "holiday");
  // A date already counted down above (the next meeting) is not shown twice as "next".
  const next = lasting.find((entry) => entry.id !== counted);
  const byDay = new Map<string, Placed[]>(); for (const entry of placed) byDay.set(entry.day, [...(byDay.get(entry.day) || []), entry]);
  const mondayFirst = language !== "en";
  const weekdays = Array.from({ length: 7 }, (_, index) => new Date(Date.UTC(2024, 0, mondayFirst ? 1 + index : 7 + index)).toLocaleDateString(languageTag(language), { weekday: "narrow", timeZone: "UTC" }));
  const monthTitle = (index: number) => new Date(Date.UTC(year, index, 15)).toLocaleDateString(languageTag(language), { year: "numeric", month: "long", timeZone: "UTC" });
  const monthName = (index: number, style: "short" | "long") => new Date(Date.UTC(2024, index, 15)).toLocaleDateString(languageTag(language), { month: style, timeZone: "UTC" });
  const cells = (index: number) => {
    const first = new Date(Date.UTC(year, index, 1)).getUTCDay(), offset = mondayFirst ? (first + 6) % 7 : first, days = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
    return [...Array.from({ length: offset }, () => null), ...Array.from({ length: days }, (_, day) => `${year}-${pad(index + 1)}-${pad(day + 1)}`)];
  };
  const left = (day: string) => { const count = daysBetween(today, day); return count === 0 ? t("今天", "Today", "Hoy") : count === 1 ? t("明天", "Tomorrow", "Mañana") : t(`${count} 天`, `${count} days`, `${count} días`); };
  const dateLabel = (day: string, withYear = false) => new Date(`${day}T12:00:00Z`).toLocaleDateString(languageTag(language), { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
  const tone = (kind: CalendarKind) => `kind-${kind}`;
  const strongest = (list: Placed[] | undefined) => list?.slice().sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind))[0]?.kind;
  const row = (entry: Placed, showLeft: boolean) => <li key={`${entry.id}:${entry.day}`}><button type="button" onClick={entry.onOpen} disabled={!entry.onOpen}>
    <span className={`upcoming-dot ${tone(entry.kind)}`} aria-hidden="true" />
    <span className="upcoming-row-text"><strong>{entry.title}</strong><small>{dateLabel(entry.day, entry.day.slice(0, 4) !== String(thisYear))}{entry.note ? ` · ${entry.note}` : ""}</small></span>
    {entry.private && <LockKey size={14} className="upcoming-lock" aria-label={t("只有你能看到", "Only you can see this", "Solo tú lo ves")} />}
    {showLeft && <em>{left(entry.day)}</em>}
  </button></li>;
  const monthEntries = placed.filter((entry) => entry.day.slice(5, 7) === pad(month + 1));

  return <div className="upcoming-year" data-testid="upcoming-year">
    {next ? <section className={`upcoming-next ${tone(next.kind)}`}>
      <small>{t("下一个", "Next", "Lo próximo")}</small>
      <div><strong>{next.title}</strong><span>{daysBetween(today, next.day) === 0 ? t("就是今天", "It's today", "Es hoy") : t(`还有 ${daysBetween(today, next.day)} 天`, `in ${daysBetween(today, next.day)} days`, `en ${daysBetween(today, next.day)} días`)}</span></div>
      <small>{dateLabel(next.day, next.day.slice(0, 4) !== String(thisYear))}{next.note ? ` · ${next.note}` : ""}</small>
    </section> : <section className="upcoming-next kind-empty"><strong>{t("还没有要记住的日子", "No dates to remember yet", "Aún no hay fechas que recordar")}</strong><small>{t("跟 Pinky 说说你们的纪念日和生日。", "Tell Pinky your anniversary and birthdays.", "Cuéntale a Pinky su aniversario y cumpleaños.")}</small></section>}

    <header className="upcoming-yearbar">
      <button type="button" onClick={() => setYear(year - 1)} aria-label={t("上一年", "Previous year", "Año anterior")}><CaretLeft size={18} weight="bold" /></button>
      <strong>{year}</strong>
      <button type="button" onClick={() => setYear(year + 1)} aria-label={t("下一年", "Next year", "Año siguiente")}><CaretRight size={18} weight="bold" /></button>
      <button type="button" className={`upcoming-holidays ${showHolidays ? "on" : ""}`} aria-pressed={showHolidays} onClick={toggleHolidays}>{t("节日", "Holidays", "Festivos")}</button>
    </header>
    <div className="upcoming-months" role="list">
      {Array.from({ length: 12 }, (_, index) => <button key={index} type="button" role="listitem" className={`upcoming-month ${index === month ? "selected" : ""}`} onClick={() => setMonth(index)} aria-label={monthTitle(index)} aria-pressed={index === month}>
        <span>{monthName(index, "short")}</span>
        <i className="upcoming-mini">{cells(index).map((day, position) => <b key={position} className={day ? `${day === today ? "today " : ""}${tone(strongest(byDay.get(day)) || "plain" as CalendarKind)}` : "blank"} />)}</i>
      </button>)}
    </div>
    <div className="upcoming-legend"><span><i className="upcoming-dot kind-date" />{t("纪念日·生日", "Anniversaries · birthdays", "Aniversarios · cumpleaños")}</span><span><i className="upcoming-dot kind-plan" />{t("计划·约定", "Plans", "Planes")}</span><span><i className="upcoming-dot kind-reminder" />{t("提醒", "Reminders", "Recordatorios")}</span>{showHolidays && <span><i className="upcoming-dot kind-holiday" />{t("节日", "Holidays", "Festivos")}</span>}</div>

    <section className="upcoming-month-detail" aria-label={monthTitle(month)}>
      <h2>{monthTitle(month)}</h2>
      <div className="upcoming-calendar">{weekdays.map((name, index) => <span key={`w${index}`} className="weekday">{name}</span>)}{cells(month).map((day, position) => day ? <span key={day} className={`${day === today ? "today" : ""} ${byDay.has(day) ? "has" : ""}`}>{Number(day.slice(8))}{byDay.has(day) && <i>{byDay.get(day)!.slice(0, 3).map((entry) => <b key={entry.id} className={tone(entry.kind)} />)}</i>}</span> : <span key={`b${position}`} />)}</div>
      {monthEntries.length ? <ul className="upcoming-list">{monthEntries.map((entry) => row(entry, entry.day >= today))}</ul> : <p className="upcoming-empty">{t("这个月没有特别的日子。", "Nothing special this month.", "Nada especial este mes.")}</p>}
    </section>

    <section className="upcoming-ahead"><h2>{t("接下来", "Coming up", "Próximamente")}</h2>
      {lasting.length ? <ul className="upcoming-list">{lasting.slice(0, 8).map((entry) => row(entry, true))}</ul> : <p className="upcoming-empty">{t("接下来还没有安排。", "Nothing planned yet.", "Aún no hay nada planeado.")}</p>}
      <button type="button" className="space-ask" onClick={() => onAsk(t("帮我记下一个日子：", "Add a date for us: ", "Añade una fecha: "))}><ChatCircleDots size={20} weight="fill" />{t("跟 Pinky 说一个日子", "Tell Pinky a date", "Dile una fecha a Pinky")}</button>
    </section>
  </div>;
}
