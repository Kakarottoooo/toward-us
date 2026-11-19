import { useState } from "react";
import { Heart } from "@phosphor-icons/react";
import { counted, languageTag, localized, type Language } from "../../i18n";
import { KeyboardInput, useKeyboard } from "../../mobile";
import { togetherStats } from "./together";
import type { CoupleStreak } from "../relationship/types";
import "./moments.css";

/** Top of Coming Up (moved from Moments 11-05, where it covered the photos): how long they have been together and the next day worth celebrating; asks for the day once.
 * Below it, 连续一起来 (11-06): how many days in a row both came by, and who has come by today. */
export function TogetherCard({ language, since, onSave, streak = null, partnerName = "" }: { language: Language; since: string | null; onSave: (date: string) => Promise<void>; streak?: CoupleStreak | null; partnerName?: string }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const today = new Date().toLocaleDateString("en-CA");
  const [editing, setEditing] = useState(!since);
  const [date, setDate] = useState(since || "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const stats = since ? togetherStats(since, today) : null;
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(languageTag(language), { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const save = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) { setError(t("选一个今天或以前的日子。", "Pick today or a day before.", "Elige hoy o un día anterior.")); return; }
    keyboard.hide(); setBusy(true); setError("");
    try { await onSave(date); setEditing(false); } catch (caught) { setError((caught as Error).message); } finally { setBusy(false); }
  };
  const span = stats ? [stats.years && t(`${stats.years} 年`, `${stats.years} yr`, `${stats.years} a`), stats.months && t(`${stats.months} 个月`, `${stats.months} mo`, `${stats.months} m`), stats.restDays && t(`${stats.restDays} 天`, `${stats.restDays} d`, `${stats.restDays} d`)].filter(Boolean).join(" ") : "";
  const name = partnerName || t("TA", "your partner", "tu pareja");
  // Coming by = answering today's question, saying anything in Us, or petting the little one. Save time, not kill time
  // (founder 11-07): it only says what happened. No "your turn", no "come by to keep it", and a day that ended it is not shown.
  const streakToday = !streak ? "" : streak.me && streak.partner ? t("今天你们俩都来了", "You both came by today", "Hoy vinieron los dos")
    : streak.me ? t("你今天来过了", "You came by today", "Ya viniste hoy")
    : streak.partner ? t(`${name} 今天来过了`, `${name} came by today`, `${name} vino hoy`) : "";
  const celebrate = (item: NonNullable<NonNullable<typeof stats>["next"]>) => item.kind === "day" ? t(`第 ${item.day} 天`, `day ${item.day}`, `el día ${item.day}`) : t(`${item.years} 周年`, `${item.years}-year anniversary`, `${item.years}.º aniversario`);
  return <section className="together-card" data-testid="together-card">
    {stats && !editing ? <>
      <small><Heart size={14} weight="fill" />{t("在一起", "Together", "Juntos")}</small>
      <strong>{t(`第 ${stats.days} 天`, `${counted(stats.days, "day", "days")}`, `${counted(stats.days, "día", "días")}`)}</strong>
      {span && <span className="together-span">{span}</span>}
      {stats.today ? <p className="together-today">{t(`今天是你们的${celebrate(stats.today)}！`, `Today is your ${celebrate(stats.today)}!`, `¡Hoy es su ${celebrate(stats.today)}!`)}</p>
        : stats.next && <p>{t(`距离${celebrate(stats.next)}还有 ${stats.next.inDays} 天 · ${day(stats.next.date)}`, `${counted(stats.next.inDays, "day", "days")} to ${celebrate(stats.next)} · ${day(stats.next.date)}`, `Faltan ${counted(stats.next.inDays, "día", "días")} para ${celebrate(stats.next)} · ${day(stats.next.date)}`)}</p>}
      <button type="button" className="together-edit" onClick={() => setEditing(true)}>{t(`从 ${day(since!)} 开始 · 修改`, `Since ${day(since!)} · Change`, `Desde ${day(since!)} · Cambiar`)}</button>
    </> : <>
      <small><Heart size={14} weight="fill" />{t("在一起多少天", "Days together", "Días juntos")}</small>
      <label><strong className="together-ask">{t("你们是哪天在一起的？", "When did you get together?", "¿Cuándo empezaron a estar juntos?")}</strong>
        <KeyboardInput type="date" max={today} value={date} onChange={(event) => setDate(event.target.value)} onBlur={() => keyboard.hide()} data-testid="together-date" /></label>
      {error && <p className="together-error" role="alert">{error}</p>}
      <div className="together-actions"><button type="button" className="together-save" disabled={busy || !date} onClick={() => void save()}>{t("保存", "Save", "Guardar")}</button>{since && <button type="button" className="together-edit" onClick={() => { setDate(since); setEditing(false); }}>{t("取消", "Cancel", "Cancelar")}</button>}</div>
      <p className="together-note">{t("你们俩都能看到和修改，这一天也会成为日历上每年的纪念日。", "You both see and can change it; it also becomes your yearly anniversary on the calendar.", "Los dos pueden verlo y cambiarlo; también será su aniversario anual en el calendario.")}</p>
    </>}
    {streak && (streak.days > 0 || streakToday) && <p className="together-streak" data-testid="couple-streak">{streak.days > 0 && <b>{t(`🔥 连续 ${streak.days} 天一起来`, `🔥 ${streak.days} ${streak.days === 1 ? "day" : "days"} in a row together`, `🔥 ${streak.days} ${streak.days === 1 ? "día seguido" : "días seguidos"} juntos`)}</b>}{streakToday && <span>{streakToday}</span>}</p>}
  </section>;
}
