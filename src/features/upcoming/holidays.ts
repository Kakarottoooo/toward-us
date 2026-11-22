// Holidays couples tend to plan around, by interface language. Lunar dates (七夕, 春节, 中秋) are found with the
// phone's own Chinese calendar, so they move with each year without a table.
export type Holiday = { key: string; date: string; title: string };
type Language = "zh" | "en" | "es";

const iso = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** Gregorian dates in `year` whose Chinese-calendar month/day match (leap months never match). */
export function lunarDates(year: number, wanted: Array<[number, number]>) {
  let format: Intl.DateTimeFormat;
  try { format = new Intl.DateTimeFormat("en-u-ca-chinese", { month: "numeric", day: "numeric", timeZone: "UTC" }); } catch { return new Map<string, string>(); }
  const found = new Map<string, string>();
  for (const day = new Date(Date.UTC(year, 0, 1)); day.getUTCFullYear() === year; day.setUTCDate(day.getUTCDate() + 1)) {
    const parts = Object.fromEntries(format.formatToParts(day).map((part) => [part.type, part.value]));
    for (const [month, date] of wanted) if (parts.month === String(month) && parts.day === String(date)) found.set(`${month}/${date}`, day.toISOString().slice(0, 10));
  }
  return found;
}

/** The fourth Thursday of November (US Thanksgiving). */
const thanksgiving = (year: number) => { const first = new Date(Date.UTC(year, 10, 1)).getUTCDay(); return iso(year, 11, 1 + ((4 - first + 7) % 7) + 21); };

type Titles = [zh: string, en: string, es: string];
// Every holiday has a name in every interface language, so a partner's holiday reads in the reader's own words.
const titles: Record<string, Titles> = {
  spring: ["春节", "Lunar New Year", "Año Nuevo Lunar"],
  valentine: ["情人节", "Valentine's Day", "San Valentín"],
  "520": ["520", "520 love day", "Día del amor 520"],
  qixi: ["七夕", "Qixi (Chinese Valentine's Day)", "Qixi (San Valentín chino)"],
  midautumn: ["中秋节", "Mid-Autumn Festival", "Festival del Medio Otoño"],
  thanksgiving: ["感恩节", "Thanksgiving", "Acción de Gracias"],
  christmas: ["圣诞节", "Christmas", "Navidad"],
  newyearseve: ["跨年夜", "New Year's Eve", "Nochevieja"],
};
const observed: Record<Language, string[]> = {
  zh: ["spring", "valentine", "520", "qixi", "midautumn", "christmas", "newyearseve"],
  en: ["valentine", "thanksgiving", "christmas", "newyearseve"],
  es: ["valentine", "christmas", "newyearseve"],
};
const titleIn = (key: string, language: Language) => titles[key][language === "en" ? 1 : language === "es" ? 2 : 0];

function datesFor(year: number, keys: string[]) {
  const lunar = keys.some((key) => ["spring", "qixi", "midautumn"].includes(key)) ? lunarDates(year, [[1, 1], [7, 7], [8, 15]]) : new Map<string, string>();
  const dates: Record<string, string | undefined> = {
    spring: lunar.get("1/1"), valentine: iso(year, 2, 14), "520": iso(year, 5, 20), qixi: lunar.get("7/7"), midautumn: lunar.get("8/15"),
    thanksgiving: thanksgiving(year), christmas: iso(year, 12, 25), newyearseve: iso(year, 12, 31),
  };
  return dates;
}

/** The holidays a speaker of `language` plans around in `year`, titled in `titleLanguage` (their own by default), by date. */
export function holidaysFor(year: number, language: Language, titleLanguage: Language = language): Holiday[] {
  const dates = datesFor(year, observed[language]);
  return observed[language].flatMap((key) => dates[key] ? [{ key, date: dates[key]!, title: titleIn(key, titleLanguage) }] : [])
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 异地/跨文化 couples: when the partner's language differs, both people's holidays, titled in the reader's language.
 * A holiday both keep appears once with no owner; one only the reader keeps is "mine", one only the partner keeps "partner". */
export function coupleHolidays(year: number, language: Language, partnerLanguage?: Language | null): Array<Holiday & { owner?: "mine" | "partner" }> {
  const mine = holidaysFor(year, language);
  if (!partnerLanguage || partnerLanguage === language) return mine;
  const theirs = holidaysFor(year, partnerLanguage, language), shared = new Set(theirs.map((holiday) => holiday.key)), own = new Set(mine.map((holiday) => holiday.key));
  return [
    ...mine.map((holiday) => shared.has(holiday.key) ? holiday : { ...holiday, owner: "mine" as const }),
    ...theirs.filter((holiday) => !own.has(holiday.key)).map((holiday) => ({ ...holiday, owner: "partner" as const })),
  ].sort((a, b) => a.date.localeCompare(b.date));
}
