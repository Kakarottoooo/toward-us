import { useEffect, useState } from "react";
import { AirplaneTilt, Heart, Moon, Sun } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";

/** Minutes a zone is ahead of UTC at `at`. */
export function zoneOffset(zone: string, at = new Date()): number | null {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at).map((part) => [part.type, part.value]));
    const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute));
    return Math.round((local - Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), at.getUTCHours(), at.getUTCMinutes())) / 60_000);
  } catch { return null; }
}

/** Whole days from today (here) to `date` (YYYY-MM-DD). */
export const daysUntil = (date: string, today = new Date().toLocaleDateString("en-CA")) => Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);

/** 异地 (founder 11-06): under the top of Us, the partner's own time when it differs from yours, and how long until you meet.
 * Nothing shows for a couple in the same time zone with no meeting planned. */
export function DistanceBar({ language, partnerName, partnerZone, nextMeeting, care = false }: { language: Language; partnerName: string; partnerZone: string | null; nextMeeting: { date: string; title: string } | null; care?: boolean }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(timer); }, []);
  const mine = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const theirs = partnerZone ? zoneOffset(partnerZone, now) : null, ours = zoneOffset(mine, now);
  const apart = theirs !== null && ours !== null && theirs !== ours;
  const days = nextMeeting ? daysUntil(nextMeeting.date) : null;
  // 经期 care note: only when the partner chose to share it, and only these words.
  const caring = care ? <span className="distance-care" data-testid="care-pill"><Heart size={14} weight="fill" />{t(`这几天多照顾 ${partnerName} 一点`, `Be extra caring with ${partnerName} these days`, `Cuida un poco más a ${partnerName} estos días`)}</span> : null;
  if (!apart && days === null && !caring) return null;
  let clock = null;
  if (apart && partnerZone) {
    const time = now.toLocaleTimeString(languageTag(language), { timeZone: partnerZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const hour = Number(now.toLocaleString("en-US", { timeZone: partnerZone, hour: "numeric", hourCycle: "h23" }));
    const diff = (theirs! - ours!) / 60, hours = Math.abs(diff) % 1 ? Math.abs(diff).toFixed(1) : String(Math.abs(diff));
    const night = hour >= 23 || hour < 7;
    clock = <span className="distance-clock" data-testid="partner-clock">{night ? <Moon size={14} weight="fill" /> : <Sun size={14} weight="fill" />}{t(`${partnerName} 那边 ${time}`, `${partnerName}'s time ${time}`, `Hora de ${partnerName}: ${time}`)}<small>{diff > 0 ? t(`比你早 ${hours} 小时`, `${hours}h ahead`, `${hours} h más`) : t(`比你晚 ${hours} 小时`, `${hours}h behind`, `${hours} h menos`)}</small></span>;
  }
  const meet = days !== null ? <span className="distance-meet" data-testid="meet-countdown"><AirplaneTilt size={14} weight="fill" />{days === 0 ? t("今天见面！", "You meet today!", "¡Hoy se ven!") : days === 1 ? t("明天见面", "You meet tomorrow", "Se ven mañana") : t(`还有 ${days} 天见面`, `${days} days until you meet`, `${days} días para verse`)}</span> : null;
  return <div className="distance-bar">{caring}{clock}{meet}</div>;
}
