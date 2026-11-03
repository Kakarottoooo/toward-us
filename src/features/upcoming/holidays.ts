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

export function holidaysFor(year: number, language: Language): Holiday[] {
  if (language === "zh") {
    const lunar = lunarDates(year, [[1, 1], [7, 7], [8, 15]]);
    return [
      lunar.get("1/1") && { key: "spring", date: lunar.get("1/1")!, title: "春节" },
      { key: "valentine", date: iso(year, 2, 14), title: "情人节" },
      { key: "520", date: iso(year, 5, 20), title: "520" },
      lunar.get("7/7") && { key: "qixi", date: lunar.get("7/7")!, title: "七夕" },
      lunar.get("8/15") && { key: "midautumn", date: lunar.get("8/15")!, title: "中秋节" },
      { key: "christmas", date: iso(year, 12, 25), title: "圣诞节" },
      { key: "newyearseve", date: iso(year, 12, 31), title: "跨年夜" },
    ].filter(Boolean).sort((a, b) => (a as Holiday).date.localeCompare((b as Holiday).date)) as Holiday[];
  }
  if (language === "es") return [
    { key: "valentine", date: iso(year, 2, 14), title: "San Valentín" },
    { key: "christmas", date: iso(year, 12, 25), title: "Navidad" },
    { key: "newyearseve", date: iso(year, 12, 31), title: "Nochevieja" },
  ];
  return [
    { key: "valentine", date: iso(year, 2, 14), title: "Valentine's Day" },
    { key: "thanksgiving", date: thanksgiving(year), title: "Thanksgiving" },
    { key: "christmas", date: iso(year, 12, 25), title: "Christmas" },
    { key: "newyearseve", date: iso(year, 12, 31), title: "New Year's Eve" },
  ];
}
