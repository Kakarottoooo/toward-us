import assert from "node:assert/strict";
import { test } from "node:test";
import { holidaysFor, lunarDates } from "../src/features/upcoming/holidays.ts";

test("lunar holidays move with the year and leap months never match", () => {
  assert.deepEqual(Object.fromEntries(lunarDates(2026, [[1, 1], [7, 7]])), { "1/1": "2026-02-17", "7/7": "2026-08-19" });
  assert.equal(lunarDates(2027, [[7, 7]]).get("7/7"), "2027-08-08");
  assert.equal(lunarDates(2025, [[6, 8]]).get("6/8"), "2025-07-02", "2025 has a leap sixth month; only the regular one counts");
});

test("each language gets the dates couples plan around, in order", () => {
  assert.deepEqual(holidaysFor(2027, "zh").map((day) => `${day.date} ${day.title}`), ["2027-02-07 春节", "2027-02-14 情人节", "2027-05-20 520", "2027-08-08 七夕", "2027-09-15 中秋节", "2027-12-25 圣诞节", "2027-12-31 跨年夜"]);
  assert.equal(holidaysFor(2026, "en").find((day) => day.key === "thanksgiving").date, "2026-11-26");
  assert.equal(holidaysFor(2027, "en").find((day) => day.key === "thanksgiving").date, "2027-11-25");
  assert.deepEqual(holidaysFor(2027, "es").map((day) => day.title), ["San Valentín", "Navidad", "Nochevieja"]);
});
