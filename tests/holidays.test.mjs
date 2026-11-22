import assert from "node:assert/strict";
import { test } from "node:test";
import { coupleHolidays, holidaysFor, lunarDates } from "../src/features/upcoming/holidays.ts";

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

test("a couple with different languages sees both people's holidays, in the reader's words, with whose they are", () => {
  const days = (list) => list.map((day) => `${day.date} ${day.title}${day.owner ? ` [${day.owner}]` : ""}`);
  assert.deepEqual(days(coupleHolidays(2027, "en", "zh")), [
    "2027-02-07 Lunar New Year [partner]", "2027-02-14 Valentine's Day", "2027-05-20 520 love day [partner]", "2027-08-08 Qixi (Chinese Valentine's Day) [partner]",
    "2027-09-15 Mid-Autumn Festival [partner]", "2027-11-25 Thanksgiving [mine]", "2027-12-25 Christmas", "2027-12-31 New Year's Eve",
  ]);
  assert.deepEqual(days(coupleHolidays(2027, "zh", "en")).filter((line) => line.includes("[")), ["2027-02-07 春节 [mine]", "2027-05-20 520 [mine]", "2027-08-08 七夕 [mine]", "2027-09-15 中秋节 [mine]", "2027-11-25 感恩节 [partner]"]);
  assert.deepEqual(days(coupleHolidays(2027, "es", "en")), ["2027-02-14 San Valentín", "2027-11-25 Acción de Gracias [partner]", "2027-12-25 Navidad", "2027-12-31 Nochevieja"]);
  const keys = coupleHolidays(2027, "en", "zh").map((day) => day.key);
  assert.equal(new Set(keys).size, keys.length, "a holiday both keep appears once");
});

test("a couple with the same language, or a partner whose language is unknown, sees one set and no owners", () => {
  for (const partner of ["zh", null, undefined]) {
    const list = coupleHolidays(2027, "zh", partner);
    assert.deepEqual(list, holidaysFor(2027, "zh"));
    assert.ok(list.every((day) => !("owner" in day)));
  }
  assert.deepEqual(coupleHolidays(2027, "en", "en"), holidaysFor(2027, "en"));
});
