// Ways into years of memories without scrolling (founder 11-05): stories Pinky finds by itself (trips, holidays across years,
// anniversaries, years, firsts), a year → month zoom, topics and a map. Everything is derived from dates and places already
// on each memory; nothing here calls a model.
import type { Language } from "../../i18n";
import { holidaysFor } from "../upcoming/holidays";

export type Moment = {
  key: string; date: string; title: string; text: string; photos: string[]; ids: string[]; shared: boolean; mine: boolean;
  mood?: string | null; idea?: number; lat?: number; lon?: number;
};
export type Milestone = { title?: unknown; date?: unknown; recurringRule?: unknown; type?: unknown; archivedAt?: unknown };
export type Story = { id: string; kind: "trip" | "holiday" | "anniversary" | "year" | "first"; title: string; detail: string; moments: Moment[]; cover: string | null };

const TRIP_KM = 150;
const t3 = (language: Language, zh: string, en: string, es: string) => language === "en" ? en : language === "es" ? es : zh;

export function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
const located = (moment: Moment): moment is Moment & { lat: number; lon: number } => typeof moment.lat === "number" && typeof moment.lon === "number";
const cover = (moments: Moment[]) => moments.find((moment) => moment.photos.length)?.photos[0] || null;
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
const newestFirst = (moments: Moment[]) => [...moments].sort((a, b) => b.date.localeCompare(a.date));
// A trip is named after the place most of it happened at, or its two main places (Magic Kingdom, Animal Kingdom…).
const tripName = (titles: string[], language: Language) => {
  const counts = new Map<string, number>(); for (const title of titles) if (title) counts.set(title, (counts.get(title) || 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return "";
  return ranked.length === 1 || ranked[0][1] * 2 > titles.length ? ranked[0][0] : `${ranked[0][0]}${t3(language, "、", " & ", " y ")}${ranked[1][0]}`;
};

/** Where the couple usually is: the half-degree cell with the most distinct days of memories. */
export function homeOf(moments: Moment[]) {
  const cells = new Map<string, { days: Set<string>; lat: number; lon: number }>();
  for (const moment of moments.filter(located)) {
    const key = `${Math.round(moment.lat * 2) / 2},${Math.round(moment.lon * 2) / 2}`;
    const cell = cells.get(key) || { days: new Set<string>(), lat: moment.lat, lon: moment.lon };
    cell.days.add(moment.date); cells.set(key, cell);
  }
  const best = [...cells.values()].sort((a, b) => b.days.size - a.days.size)[0];
  return best ? { lat: best.lat, lon: best.lon } : null;
}

/** Trips: two or more days in a row (a day off allowed) far from home. */
export function tripsOf(moments: Moment[], language: Language): Story[] {
  const home = homeOf(moments); if (!home) return [];
  const far = moments.filter(located).filter((moment) => km(home, moment) > TRIP_KM).sort((a, b) => a.date.localeCompare(b.date));
  const runs: Moment[][] = [];
  for (const moment of far) {
    const run = runs.at(-1);
    // A day off is still the same trip; a jump of 500 km or more (Puerto Rico, then Orlando) starts the next one.
    if (run && days(run.at(-1)!.date, moment.date) <= 2 && km(run.at(-1)! as Moment & { lat: number; lon: number }, moment) < 500) run.push(moment); else runs.push([moment]);
  }
  return runs.filter((run) => new Set(run.map((moment) => moment.date)).size >= 2).map((run) => {
    const length = days(run[0].date, run.at(-1)!.date) + 1, place = tripName(run.map((moment) => moment.title), language);
    return { id: `trip:${run[0].date}`, kind: "trip" as const, title: t3(language, `${place}${/[A-Za-z0-9]$/.test(place) ? " " : ""}之旅`, `${place} trip`, `Viaje a ${place}`), detail: t3(language, `${run[0].date.slice(0, 4)} · ${length} 天`, `${run[0].date.slice(0, 4)} · ${length} days`, `${run[0].date.slice(0, 4)} · ${length} días`), moments: newestFirst(run), cover: cover(run) };
  }).reverse();
}

/** The same holiday across the years ("our Christmases"); Christmas Eve counts as Christmas. */
export function holidaysOf(moments: Moment[], language: Language): Story[] {
  const groups = new Map<string, { title: string; moments: Moment[] }>();
  const byYear = new Map<number, ReturnType<typeof holidaysFor>>();
  for (const moment of moments) {
    const year = Number(moment.date.slice(0, 4));
    if (!byYear.has(year)) byYear.set(year, holidaysFor(year, language));
    for (const holiday of byYear.get(year)!) {
      const eve = holiday.key === "christmas" && moment.date === `${year}-12-24`;
      if (moment.date !== holiday.date && !eve) continue;
      const group = groups.get(holiday.key) || { title: holiday.title, moments: [] };
      group.moments.push(moment); groups.set(holiday.key, group);
    }
  }
  return [...groups].map(([key, group]) => {
    const years = new Set(group.moments.map((moment) => moment.date.slice(0, 4))).size;
    return { id: `holiday:${key}`, kind: "holiday" as const, title: t3(language, `我们的${group.title}`, `Our ${group.title}`, `Nuestra ${group.title}`), detail: t3(language, `${years} 年`, years === 1 ? "1 year" : `${years} years`, years === 1 ? "1 año" : `${years} años`), moments: newestFirst(group.moments), cover: cover(group.moments) };
  });
}

/** Days they marked as yearly in Pinky (birthdays, anniversaries), across the years. */
export function anniversariesOf(moments: Moment[], milestones: Milestone[], language: Language): Story[] {
  return milestones.filter((item) => !item.archivedAt && typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && (item.recurringRule === "yearly" || item.type === "relationship_started")).flatMap((item) => {
    const monthDay = String(item.date).slice(5), matching = moments.filter((moment) => moment.date.slice(5) === monthDay);
    if (!matching.length) return [];
    const title = String(item.title || "") || (item.type === "relationship_started" ? t3(language, "在一起纪念日", "Our anniversary", "Nuestro aniversario") : monthDay);
    return [{ id: `day:${monthDay}`, kind: "anniversary" as const, title, detail: t3(language, `每年 ${Number(monthDay.slice(0, 2))} 月 ${Number(monthDay.slice(3))} 日`, `Every ${monthDay.replace("-", "/")}`, `Cada ${monthDay.slice(3)}/${monthDay.slice(0, 2)}`), moments: newestFirst(matching), cover: cover(matching) }];
  });
}

export type YearSummary = { year: string; moments: Moment[]; places: string[]; cover: string | null; months: Map<string, Moment[]> };
/** One card per year: how many memories, the places visited most, and the memories by month. */
export function yearsOf(moments: Moment[]): YearSummary[] {
  const years = new Map<string, Moment[]>();
  for (const moment of moments) { const year = moment.date.slice(0, 4); if (!years.has(year)) years.set(year, []); years.get(year)!.push(moment); }
  return [...years].sort((a, b) => b[0].localeCompare(a[0])).map(([year, list]) => {
    const months = new Map<string, Moment[]>();
    for (const moment of list) { const month = moment.date.slice(5, 7); if (!months.has(month)) months.set(month, []); months.get(month)!.push(moment); }
    const counts = new Map<string, number>(); for (const moment of list.filter(located)) counts.set(moment.title, (counts.get(moment.title) || 0) + 1);
    return { year, moments: newestFirst(list), places: [...counts].sort((a, b) => b[1] - a[1]).map(([place]) => place).filter(Boolean), cover: cover(list), months };
  });
}

/** Firsts: the first time at a place they went back to. */
export function firstsOf(moments: Moment[], language: Language): Story[] {
  const byPlace = new Map<string, Moment[]>();
  for (const moment of moments.filter(located)) { if (!moment.title) continue; if (!byPlace.has(moment.title)) byPlace.set(moment.title, []); byPlace.get(moment.title)!.push(moment); }
  // Going back counts only on another visit, two weeks or more later, not the next day of the same trip.
  return [...byPlace].filter(([, list]) => { const dates = list.map((moment) => moment.date).sort(); return days(dates[0], dates.at(-1)!) >= 14; }).map(([place, list]) => {
    const first = [...list].sort((a, b) => a.date.localeCompare(b.date))[0];
    return { id: `first:${place}`, kind: "first" as const, title: t3(language, `第一次去 ${place}`, `First time at ${place}`, `Primera vez en ${place}`), detail: first.date.slice(0, 4), moments: [first], cover: cover([first]) };
  }).sort((a, b) => b.moments[0].date.localeCompare(a.moments[0].date));
}

export type Place = { title: string; lat: number; lon: number; moments: Moment[]; cover: string | null };
/** Places for the map and the city topic: memories with the same name close together, newest first inside. */
export function placesOf(moments: Moment[]): Place[] {
  const places: Place[] = [];
  for (const moment of moments.filter(located)) {
    const place = places.find((candidate) => candidate.title === moment.title && km(candidate, moment) < 50);
    if (place) place.moments.push(moment); else places.push({ title: moment.title, lat: moment.lat, lon: moment.lon, moments: [moment], cover: null });
  }
  return places.map((place) => ({ ...place, moments: newestFirst(place.moments), cover: cover(place.moments) })).sort((a, b) => b.moments.length - a.moments.length);
}
