import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPlanConstraints, requiresPlanConstraints } from "../server/plan-constraints.mjs";

const context = (question, extra = {}) => ({ messages: [{ role: "user", text: question }], ...extra });
const empty = () => ({ budget: null, location: null, visits: [], food: [] });
const item = (priceText, upper, extra = {}) => ({ label: priceText, priceText, upper, quantity: 1, mode: "cap", sourceQuote: null, ...extra });
const budget = (items, limit = 200, currency = "CNY", limitQuote = "200元以内") => ({ ...empty(), budget: { limit, currency, limitQuote, items } });
const codes = (result) => result.issues.map((item) => item.code);
const visit = (extra = {}) => ({ name: "青馆", city: "北京", date: "2026-11-14", start: "14:00", end: "16:00", openingStart: "10:00", openingEnd: "18:00", sourceQuote: "青馆在北京，10:00至18:00开放。", ...extra });

test("frozen round-one failure: upper expenses 140+50+20+10 cannot be called within 200", () => {
  const reply = "预算（估算，去之前还要你自己核对价格）\n手工体验两人约 120 到 140 元\n饮品加咸口小食约 40 到 50 元\n交通约 20 元\n留个 10 元左右，合计不超过 200 元";
  const check = budget([item("120 到 140 元", 140), item("40 到 50 元", 50), item("20 元", 20), item("10 元", 10)]);
  const result = checkPlanConstraints(check, { context: context("帮我做一个下午约会安排，200元以内的预算"), reply });
  assert.equal(result.totalUpper, 220);
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("over_budget"));
});

test("reduce selected caps to fit, without pretending they are verified prices", () => {
  const result = checkPlanConstraints(budget([item("120元", 120), item("50元", 50), item("20元", 20), item("10元", 10)]), {
    context: context("安排约会，200元以内"), reply: "建议开销上限：手工120元、饮品50元、交通20元、预留10元，合计200元；实际价格尚未核实。",
  });
  assert.equal(result.ok, true);
  assert.equal(result.totalUpper, 200);
});

test("per-person quantities count twice; group totals count once", () => {
  const ctx = context("两人约会安排，200元以内");
  const result = checkPlanConstraints(budget([item("120元/人", 120, { quantity: 2 })]), { context: ctx, reply: "预算上限120元/人，两人。" });
  assert.equal(result.totalUpper, 240);
  assert.ok(codes(result).includes("over_budget"));
  assert.ok(codes(checkPlanConstraints(budget([item("120元/人", 120)]), { context: ctx, reply: "上限120元/人" })).includes("quantity_mismatch"));
  assert.equal(checkPlanConstraints(budget([item("两人总计120元", 120)]), { context: ctx, reply: "两人总计120元的预算上限。" }).ok, true);
});

test("dollar ranges and alternative costs do not silently enter the chosen total", () => {
  const result = checkPlanConstraints(budget([item("$40–$60", 60), item("$20", 20)], 100, "USD", "budget $100"), {
    context: context("Plan an afternoon, budget $100"), reply: "Spending caps: activity $40–$60, snacks $20. Alternative: museum $30 instead of the activity.",
  });
  assert.equal(result.ok, true);
  assert.equal(result.totalUpper, 80);
});

test("omitting a displayed cost and using a range's lower endpoint both fail", () => {
  const opts = { context: context("安排约会，200元以内"), reply: "上限手工120–140元、饮品50元、交通20元。" };
  assert.ok(codes(checkPlanConstraints(budget([item("120–140元", 120)]), opts)).includes("price_mismatch"));
  assert.ok(codes(checkPlanConstraints(budget([item("120–140元", 140), item("50元", 50)]), opts)).includes("unaccounted_price"));
});

test("the model cannot increase the user cap or invent source-backed prices", () => {
  const result = checkPlanConstraints(budget([item("240元", 240, { mode: "verified", sourceQuote: "青馆240元" })], 300), {
    context: context("安排，200元以内"), reply: "青馆240元。",
  });
  assert.ok(codes(result).includes("unsupported_budget"));
  assert.ok(codes(result).includes("unsupported_price"));
});

test("assistant history is not evidence; visible lookup quotes are", () => {
  const check = budget([item("140元", 140, { mode: "verified", sourceQuote: "青馆票价140元" })]);
  const ctx = context("安排，200元以内"); ctx.messages.push({ role: "assistant", text: "青馆票价140元" });
  assert.equal(checkPlanConstraints(check, { context: ctx, reply: "青馆140元。" }).ok, false);
  ctx.lookups = [{ findings: "青馆票价140元" }];
  assert.equal(checkPlanConstraints(check, { context: ctx, reply: "青馆140元。" }).ok, true);
});

test("new planning cannot bypass validation with null, ordinary recall is unaffected", () => {
  const ctx = context("帮我做约会安排，200元以内");
  assert.equal(requiresPlanConstraints(ctx, "手工140元，饮料50元。"), true);
  assert.ok(codes(checkPlanConstraints(null, { context: ctx, reply: "手工140元，饮料50元。" })).includes("missing_constraints"));
  assert.equal(checkPlanConstraints(null, { context: context("回忆之前200元的计划"), reply: "当时手工140元。" }).ok, true);
  assert.equal(checkPlanConstraints(null, { context: ctx, reply: "你想在哪个城市？" }).ok, true);
});

test("invalid dates, time order and opening windows are rejected without throwing", () => {
  const ctx = context("安排北京的半天行程", { lookups: [{ findings: "青馆在北京，10:00至18:00开放。" }] });
  for (const date of ["2026-02-30", "2026-13-01", "no date"]) {
    assert.ok(codes(checkPlanConstraints({ ...empty(), visits: [visit({ date })] }, { context: ctx, reply: "去青馆。" })).includes("invalid_date"));
  }
  assert.ok(codes(checkPlanConstraints({ ...empty(), visits: [visit({ end: "13:00" })] }, { context: ctx })).includes("invalid_order"));
  assert.ok(codes(checkPlanConstraints({ ...empty(), visits: [visit({ end: "19:00" })] }, { context: ctx })).includes("outside_hours"));
  assert.equal(checkPlanConstraints({ ...empty(), visits: [visit()] }, { context: ctx }).ok, true);
});

test("wrong city and unsupported opening hours cannot be promoted as confirmed", () => {
  const check = { ...empty(), location: { required: "北京", quote: "已搬到北京", actual: "上海" }, visits: [visit()] };
  const result = checkPlanConstraints(check, { context: context("已搬到北京，安排半日活动"), reply: "安排好了。" });
  assert.ok(codes(result).includes("wrong_location"));
  assert.ok(codes(result).includes("unsupported_hours"));
});

test("unknown hours can support a clearly conditional suggestion", () => {
  const check = { ...empty(), visits: [visit({ city: null, openingStart: null, openingEnd: null, sourceQuote: null })] };
  assert.equal(checkPlanConstraints(check, { reply: "可考虑青馆，但营业时间尚未核实。" }).ok, true);
  assert.ok(codes(checkPlanConstraints(check, { reply: "青馆肯定营业。" })).includes("unverified_fact"));
});

test("allergens exclude known ingredients; unknown ingredients require uncertainty", () => {
  const ctx = context("对花生过敏，选晚饭", { lookups: [{ findings: "沙拉含生菜、花生酱。" }] });
  const food = { name: "沙拉", avoid: ["花生"], ingredients: ["生菜", "花生酱"], sourceQuote: "沙拉含生菜、花生酱。" };
  assert.ok(codes(checkPlanConstraints({ ...empty(), food: [food] }, { context: ctx, reply: "选沙拉。" })).includes("allergen_conflict"));
  assert.ok(codes(checkPlanConstraints({ ...empty(), food: [{ ...food, sourceQuote: null }] }, { context: ctx, reply: "配料我没法核实。" })).includes("allergen_conflict"), "uncertain sourcing never excuses a listed allergen");
  const unknown = { ...food, ingredients: null, sourceQuote: null };
  assert.equal(checkPlanConstraints({ ...empty(), food: [unknown] }, { context: ctx, reply: "配料及交叉接触风险尚未核实，先向店员确认。" }).ok, true);
  assert.equal(checkPlanConstraints({ ...empty(), food: [unknown] }, { context: ctx, reply: "具体配料我没法核实，买之前看配料表，避免花生残留。" }).ok, true, "the real replay's explicit uncertainty is not a confirmed-safety claim");
  assert.equal(checkPlanConstraints({ ...empty(), food: [unknown] }, { context: ctx, reply: "可以放心吃。" }).ok, false);
});

test("malformed numeric costs fail closed", () => {
  for (const upper of [Infinity, NaN, -1, "10"]) {
    assert.ok(codes(checkPlanConstraints(budget([item("10元", upper)]), { context: context("200元以内"), reply: "上限10元。" })).includes("invalid_cost"));
  }
});

test("different currencies cannot be added as if their numeric values were comparable", () => {
  const result = checkPlanConstraints(budget([item("$100", 100)]), { context: context("安排约会，200元以内"), reply: "活动预算上限$100。" });
  assert.ok(codes(result).includes("currency_mismatch"));
});

test("shared member messages and authorized shared memories are valid evidence", () => {
  const ctx = { messages: [{ role: "member", actorUserId: "fictional-a", text: "安排约会，200元以内" }], authorizedMemories: [{ text: "青馆票价140元" }] };
  const check = budget([item("140元", 140, { mode: "verified", sourceQuote: "青馆票价140元" })]);
  assert.equal(checkPlanConstraints(check, { context: ctx, reply: "青馆140元。" }).ok, true);
});

test("empty metadata cannot bypass a budget or allergy plan", () => {
  assert.ok(codes(checkPlanConstraints(empty(), { context: context("约会安排，200元以内"), reply: "手工140元，饮品50元。" })).includes("empty_constraints"));
  assert.ok(codes(checkPlanConstraints(empty(), { context: context("对花生过敏，帮我选晚饭"), reply: "吃沙拉。" })).includes("missing_food"));
});

test("a visit must respect a single explicitly requested calendar date", () => {
  const result = checkPlanConstraints({ ...empty(), visits: [visit()] }, { context: context("安排2026-11-15半日活动"), reply: "营业时间未核实。" });
  assert.ok(codes(result).includes("wrong_date"));
});
