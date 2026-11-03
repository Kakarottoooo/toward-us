import assert from "node:assert/strict";
import { test } from "node:test";
import { togetherStats } from "../src/features/moments/together.ts";

test("the day they got together is day 1, and years, months and days add up", () => {
  assert.equal(togetherStats("2025-05-20", "2025-05-20").days, 1);
  const stats = togetherStats("2025-05-20", "2026-11-02");
  assert.equal(stats.days, 532);
  assert.deepEqual([stats.years, stats.months, stats.restDays], [1, 5, 13]);
  assert.deepEqual(togetherStats("2024-01-31", "2024-03-01").restDays, 1, "a short February borrows the right number of days");
  assert.equal(togetherStats("2027-01-01", "2026-11-02"), null, "a future start counts nothing");
});

test("the next day worth celebrating is the nearest hundredth day, 520, 1314 or anniversary", () => {
  assert.deepEqual(togetherStats("2025-05-20", "2026-11-02").next, { kind: "day", day: 600, date: "2027-01-09", inDays: 68 });
  assert.deepEqual(togetherStats("2025-05-20", "2026-10-15").next, { kind: "day", day: 520, date: "2026-10-21", inDays: 6 });
  assert.deepEqual(togetherStats("2025-05-20", "2026-05-01").next, { kind: "anniversary", years: 1, date: "2026-05-20", inDays: 19 });
  assert.deepEqual(togetherStats("2025-05-20", "2025-08-27").today, { kind: "day", day: 100, date: "2025-08-27", inDays: 0 });
  assert.deepEqual(togetherStats("2024-02-29", "2025-02-28").today, { kind: "anniversary", years: 1, date: "2025-02-28", inDays: 0 });
});
