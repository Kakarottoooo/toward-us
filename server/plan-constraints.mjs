// The model extracts a proposed plan; this boundary checks arithmetic, chronology and
// quoted evidence before its prose is shown. It does not certify external facts.
const text = { type: "string" }, number = { type: "number" }, nullableText = { type: ["string", "null"] };
const object = (properties) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const array = (items, maxItems = 12) => ({ type: "array", items, maxItems });
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
export const planConstraintsSchema = nullable(object({
  budget: nullable(object({ limit: number, currency: text, limitQuote: text, items: array(object({
    label: text, upper: number, quantity: number, priceText: text,
    mode: { type: "string", enum: ["cap", "verified", "estimate"] }, sourceQuote: nullableText,
  })) })),
  location: nullable(object({ required: text, quote: text, actual: text })),
  visits: array(object({ name: text, city: nullableText, date: nullableText, start: nullableText, end: nullableText,
    openingStart: nullableText, openingEnd: nullableText, sourceQuote: nullableText })),
  food: array(object({ name: text, avoid: array(text), ingredients: nullable(array(text, 30)), sourceQuote: nullableText })),
}));

export const planConstraintsInstructions = `For a concrete outing, itinerary, meal or spending plan with hard conditions, provide planConstraints; otherwise null. This is checked by code, not a claim that you verified it. Include every selected expense (not alternatives or the total) in budget.items. limitQuote must quote the user's actual budget, currency is CNY/USD/EUR/etc. priceText must be an exact money expression in reply, upper its highest price (ranges use the high end), quantity the number of units ONLY for per-person/per-item prices; a group total has quantity 1. mode cap is a proposed spending ceiling explicitly labelled as such, estimate is uncertain cost explicitly labelled estimated/unverified, verified requires an exact sourceQuote from visible user/profile/lookup data containing the price. Never omit a selected expense to force the sum under budget. Use location for a required city/area, with the user's exact quote and the proposed actual area. visits gives the proposed ISO date and HH:mm start/end, and source-backed openingStart/openingEnd or null if unknown; sourceQuote must name this venue and substantiate its location/opening hours. Unknown actual prices, hours or ingredients must be explicitly called unverified in reply; don't call the whole plan confirmed. food lists only selected dishes, all known allergens in avoid, ingredients from the visible source or null (not guessed), with its exact sourceQuote. Mention cross-contact precautions for allergies. Do not recommend food with a known excluded ingredient. Use the same names, prices, dates and times in reply and metadata. A failed check means revise the plan, not append a disclaimer to a contradictory or unsafe plan.`;

const normalized = (value) => String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "").replace(/[，,]/g, "");
const finite = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const lastQuestion = (context) => [...(context?.messages || [])].reverse().find((item) => item.role === "user" || item.role === "member")?.text || "";
const proposed = /安排|规划|计划|方案|选.*(?:晚饭|午饭|餐|菜)|吃什么|做什么|plan\b|itinerary|choose.*(?:meal|dinner)|planear|itinerario/i;
const condition = /预算|不超过|以内|上限|过敏|营业|开放|搬到|budget|under\s*[$€£\d]|allerg|opening|presupuesto|alerg/i;
const uncertain = /没(?:有)?(?:核实|确认|查到)|未(?:核实|确认|查证)|待(?:核实|确认)|需(?:要)?(?:向|与)?.{0,15}(?:确认|核实)|估(?:算|计)|暂按|以.{0,15}为准|unverified|not (?:yet )?(?:verified|confirmed)|could not verify|estimate|check .{0,30}(?:hours|price|ingredient)|sin confirmar|no (?:está )?verificad|estimad/i;
const capWords = /上限|最多|不超过|控制在|封顶|限额|预留|预算|以内|at most|up to|cap|allowance|budget|maximum|presupuesto|máximo/i;

export function requiresPlanConstraints(context, reply = null) {
  const question = lastQuestion(context);
  // Recall and recording are not new plans. Do not reject a clarification or a
  // failed lookup merely because the request mentioned money.
  if (!proposed.test(question) || !condition.test(`${question} ${JSON.stringify(context?.profile || context?.sharedProfile || {})}`) || /之前.*(?:怎么|什么)|回忆|记账|报销|recall|reimburse/i.test(question)) return false;
  if (reply === null) return true;
  return /\d+(?:\.\d+)?\s*(?:元|美元|欧元|人民币|dollars?|euros?)|[$€£]\s*\d|\d{1,2}:\d{2}|花生|peanut|餐|菜|meal|dish/i.test(reply);
}

function sourceText(context) {
  // Never inspect raw store records, other principals, assistant messages or a
  // model's earlier answer as proof of facts.
  return JSON.stringify({ messages: (context?.messages || []).filter((item) => item.role === "user" || item.role === "member").map(({ text }) => text),
    profile: context?.profile || context?.sharedProfile || {}, memories: context?.authorizedMemories || [], lookups: context?.lookups || [] });
}
function quoted(quote, source) { return typeof quote === "string" && quote.trim().length > 1 && normalized(source).includes(normalized(quote)); }
function currencyOf(value) {
  if (/美元|\bUSD\b|dollars?|\$/.test(value)) return "USD";
  if (/欧元|\bEUR\b|euros?|€/.test(value)) return "EUR";
  if (/英镑|\bGBP\b|pounds?|£/.test(value)) return "GBP";
  if (/元|人民币|\bCNY\b|¥|￥/.test(value)) return "CNY";
  return null;
}
function moneyValues(value) {
  const input = String(value || "").replace(/(?<=\d),(?=\d{3}\b)/g, "");
  // Capture whole ranges so the lower endpoint is never mistaken for the cost.
  return [...input.matchAll(/(?:[$€£¥￥]\s*)?(\d+(?:\.\d+)?)(?:\s*(?:元|美元|欧元|dollars?|euros?)?\s*[-–—~～至到]\s*(?:[$€£¥￥]\s*)?(\d+(?:\.\d+)?))?\s*(元|美元|欧元|人民币|dollars?|euros?|USD|CNY|EUR)?/gi)]
    .filter((match) => match[3] || /[$€£¥￥]/.test(match[0]))
    .map((match) => ({ upper: Math.max(Number(match[1]), Number(match[2] || match[1])), raw: match[0], index: match.index }));
}
function dateValid(value) { const date = new Date(`${value}T12:00:00Z`); return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; }
function minutes(value) { if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null; const [h, m] = value.split(":").map(Number); return h * 60 + m; }

export function checkPlanConstraints(check, { context = {}, reply = "" } = {}) {
  const issues = [], unverified = []; let totalUpper = null;
  const issue = (code, message) => issues.push({ code, message });
  const unknown = (label) => { unverified.push(label); if (!uncertain.test(reply)) issue("unverified_fact", `${label}: explicitly state it has not been verified; do not present it as confirmed.`); };
  if (check == null) {
    if (requiresPlanConstraints(context, reply)) issue("missing_constraints", "A concrete plan with hard conditions needs planConstraints, including each selected cost and known restriction.");
    return { ok: !issues.length, issues, unverified, totalUpper };
  }
  if (typeof check !== "object" || Array.isArray(check) || !Array.isArray(check.visits) || !Array.isArray(check.food)) {
    issue("invalid_constraints", "Provide the complete planConstraints object or null for non-planning replies.");
    return { ok: false, issues, unverified, totalUpper };
  }
  const source = sourceText(context), users = sourceText({ ...context, lookups: [] });
  if (requiresPlanConstraints(context, reply) && !check.budget && !check.location && !check.visits.length && !check.food.length) issue("empty_constraints", "The plan's hard conditions cannot be bypassed with an empty object.");
  const allergyMeal = /过敏|allerg|alerg/i.test(`${lastQuestion(context)} ${JSON.stringify(context.profile || context.sharedProfile || {})}`) && /晚饭|午饭|餐|菜|吃|meal|dinner|food|comida/i.test(lastQuestion(context));
  if (allergyMeal && !check.food.length) issue("missing_food", "A meal plan with a known allergy must check the selected food and excluded ingredients.");
  if (check.budget) {
    const budget = check.budget;
    if (!finite(budget.limit) || !quoted(budget.limitQuote, users) || !moneyValues(budget.limitQuote).some((value) => value.upper === budget.limit) || currencyOf(budget.limitQuote) !== budget.currency) issue("unsupported_budget", "The budget limit and currency must match an exact quote from the user's visible request.");
    if (!Array.isArray(budget.items) || !budget.items.length || budget.items.length > 12) issue("missing_costs", "List each selected expense once, excluding alternatives and the grand total.");
    else {
      totalUpper = 0;
      const covered = new Set();
      for (const item of budget.items) {
        if (!item || typeof item !== "object") { issue("invalid_cost", "Each cost must have a label, displayed price, upper bound and quantity."); continue; }
        if (!finite(item.upper) || !finite(item.quantity) || item.quantity <= 0 || !Number.isInteger(item.quantity)) { issue("invalid_cost", "Prices must be finite and nonnegative; quantity must be a positive integer."); continue; }
        totalUpper += item.upper * item.quantity;
        const prices = moneyValues(item.priceText);
        if (currencyOf(item.priceText) && currencyOf(item.priceText) !== budget.currency) issue("currency_mismatch", `${item.label}: convert using a verified rate or use the budget currency throughout; never add different currencies.`);
        if (!item.priceText || !reply.includes(item.priceText) || prices.length !== 1 || prices[0].upper !== item.upper) issue("price_mismatch", `${item.label}: priceText must be an exact displayed price or range and upper must equal its high endpoint.`);
        else covered.add(normalized(item.priceText));
        if (/人均|每人|\/人|per person|each|\/person|por persona/i.test(item.priceText) && item.quantity === 1 && /两人|二人|双人|two people|for two|dos personas/i.test(lastQuestion(context))) issue("quantity_mismatch", `${item.label}: a per-person cost for two needs quantity 2; use quantity 1 only for a group total.`);
        if (item.mode === "verified") {
          if (!quoted(item.sourceQuote, source) || !moneyValues(item.sourceQuote).some((value) => value.upper === item.upper)) issue("unsupported_price", `${item.label}: verified price needs the actual quoted source showing that price.`);
        } else if (item.mode === "estimate") unknown(`${item.label} price`);
        else if (item.mode === "cap") { if (!capWords.test(reply)) issue("unlabelled_cap", `${item.label}: label the amount as a proposed spending cap, not a verified price.`); }
        else issue("invalid_price_mode", `${item.label}: use cap, estimate or verified.`);
      }
      totalUpper = Math.round(totalUpper * 100) / 100;
      if (finite(budget.limit) && totalUpper > budget.limit + 0.005) issue("over_budget", `Selected upper costs total ${totalUpper} ${budget.currency}, exceeding the limit ${budget.limit}; reduce the plan before presenting it.`);
      // Check numeric correspondence without trying to semantically parse an
      // itinerary. A displayed amount not accounted for is unsafe to total.
      for (const value of moneyValues(reply)) {
        if (value.upper === budget.limit || value.upper === totalUpper || [...covered].some((part) => part.includes(normalized(value.raw)))) continue;
        const nearby = reply.slice(Math.max(0, value.index - 48), value.index);
        if (/备选|或选|另一|alternative|instead|opción/i.test(nearby)) continue;
        issue("unaccounted_price", `Displayed ${value.raw.trim()} is absent from the selected cost breakdown; account for it or explicitly label it as an alternative.`);
      }
    }
  } else if (/预算|budget|presupuesto/i.test(lastQuestion(context)) && moneyValues(reply).length > 1) issue("missing_budget", "A plan with a stated budget and several prices requires the full budget breakdown.");
  if (check.location) {
    const { required, quote, actual } = check.location;
    if (!required || !quoted(quote, source) || !normalized(quote).includes(normalized(required))) issue("unsupported_location", "The required location must come from visible user/profile evidence.");
    if (!actual || !normalized(actual).includes(normalized(required))) issue("wrong_location", "The proposed location does not satisfy the required city/area.");
  }
  for (const visit of check.visits.slice(0, 12)) {
    if (!visit || typeof visit !== "object") { issue("invalid_visit", "Each visit must describe its date, times and available evidence."); continue; }
    if (visit.date && !dateValid(visit.date)) issue("invalid_date", `${visit.name}: invalid calendar date.`);
    const requestedDates = [...lastQuestion(context).matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map((match) => match[0]);
    if (visit.date && requestedDates.length === 1 && visit.date !== requestedDates[0]) issue("wrong_date", `${visit.name}: the proposed date differs from the explicit requested date.`);
    const start = minutes(visit.start), end = minutes(visit.end), opens = minutes(visit.openingStart), closes = minutes(visit.openingEnd);
    if ((visit.start && start === null) || (visit.end && end === null)) issue("invalid_time", `${visit.name}: use valid 24-hour HH:mm times.`);
    if (start !== null && end !== null && end <= start) issue("invalid_order", `${visit.name}: end must be later than start; split overnight plans into dated visits.`);
    if (check.location?.required && visit.city && !normalized(visit.city).includes(normalized(check.location.required))) issue("wrong_location", `${visit.name}: this visit is outside the required city/area.`);
    if (visit.openingStart || visit.openingEnd) {
      if (opens === null || closes === null || closes <= opens) issue("invalid_hours", `${visit.name}: opening hours are invalid or incomplete; do not invent an overnight interval.`);
      else if ((start !== null && start < opens) || (end !== null && end > closes)) issue("outside_hours", `${visit.name}: the visit falls outside opening hours.`);
      if (!quoted(visit.sourceQuote, source) || !normalized(visit.sourceQuote).includes(normalized(visit.name)) || !visit.sourceQuote?.includes(visit.openingStart) || !visit.sourceQuote?.includes(visit.openingEnd)) issue("unsupported_hours", `${visit.name}: opening hours need an exact source quote naming the venue and both times.`);
    } else unknown(`${visit.name} opening hours`);
    if (visit.city && (!quoted(visit.sourceQuote, source) || !normalized(visit.sourceQuote).includes(normalized(visit.city)))) unknown(`${visit.name} location`);
  }
  for (const food of check.food.slice(0, 12)) {
    if (!food || typeof food !== "object") { issue("invalid_food", "Each selected dish must list known exclusions and ingredient evidence."); continue; }
    const avoid = Array.isArray(food.avoid) ? food.avoid.filter(Boolean) : [];
    if (avoid.some((allergen) => normalized(food.name).includes(normalized(allergen)))) issue("allergen_conflict", `${food.name}: the selected dish itself names an excluded ingredient; remove it.`);
    if (allergyMeal && !avoid.length) issue("missing_allergens", `${food.name}: known allergy restrictions cannot be omitted.`);
    for (const allergen of avoid) if (!normalized(source).includes(normalized(allergen))) issue("unsupported_allergen", `${food.name}: the excluded ingredient is not in visible source evidence.`);
    if (!Array.isArray(food.ingredients) || !quoted(food.sourceQuote, source)) { if (avoid.length) unknown(`${food.name} ingredients and cross-contact`); continue; }
    for (const ingredient of food.ingredients) {
      if (!normalized(food.sourceQuote).includes(normalized(ingredient))) issue("unsupported_ingredient", `${food.name}: ingredients must be quoted, not inferred from a dish name.`);
      if (avoid.some((allergen) => normalized(ingredient).includes(normalized(allergen)))) issue("allergen_conflict", `${food.name}: contains an excluded ingredient; remove it from the selected meal.`);
    }
  }
  return { ok: !issues.length, issues, unverified, totalUpper };
}
