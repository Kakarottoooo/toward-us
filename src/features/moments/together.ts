// "Together for N days": counted inclusively from the day they got together (that day is day 1), with the next day worth
// celebrating: every hundredth day, 520 and 1314 (loved by Chinese couples), and each yearly anniversary.
const parse = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
const DAY = 86_400_000;

export type Celebration = { kind: "day"; day: number; date: string; inDays: number } | { kind: "anniversary"; years: number; date: string; inDays: number };
export type TogetherStats = { days: number; years: number; months: number; restDays: number; next: Celebration | null; today: Celebration | null };

export function togetherStats(since: string, today: string): TogetherStats | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(today) || since > today) return null;
  const days = Math.round((parse(today) - parse(since)) / DAY) + 1;
  // Whole months first (a month after 31 January is the last day of February), then the days left over.
  const addMonths = (count: number) => { const year = Number(since.slice(0, 4)), month = Number(since.slice(5, 7)) - 1 + count; const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); return Date.UTC(year, month, Math.min(Number(since.slice(8, 10)), last)); };
  let total = (Number(today.slice(0, 4)) - Number(since.slice(0, 4))) * 12 + Number(today.slice(5, 7)) - Number(since.slice(5, 7));
  if (addMonths(total) > parse(today)) total -= 1;
  const years = Math.floor(total / 12), months = total % 12, restDays = Math.round((parse(today) - addMonths(total)) / DAY);
  const dayOf = (n: number): Celebration => { const date = iso(parse(since) + (n - 1) * DAY); return { kind: "day", day: n, date, inDays: Math.round((parse(date) - parse(today)) / DAY) }; };
  const anniversary = (n: number): Celebration => { const year = Number(since.slice(0, 4)) + n; const date = since.slice(5) === "02-29" && new Date(Date.UTC(year, 1, 29)).getUTCMonth() !== 1 ? `${year}-02-28` : `${year}${since.slice(4)}`; return { kind: "anniversary", years: n, date, inDays: Math.round((parse(date) - parse(today)) / DAY) }; };
  const candidates: Celebration[] = [dayOf(Math.ceil(days / 100) * 100), dayOf(Math.ceil((days + 1) / 100) * 100), ...[520, 1314].map(dayOf), anniversary(years), anniversary(years + 1)];
  const todayOne = candidates.find((item) => item.inDays === 0 && (item.kind === "anniversary" ? item.years > 0 : true)) || null;
  const next = candidates.filter((item) => item.inDays > 0 && (item.kind === "anniversary" ? item.years > 0 : true)).sort((a, b) => a.inDays - b.inDays)[0] || null;
  return { days, years, months, restDays, next, today: todayOne };
}
