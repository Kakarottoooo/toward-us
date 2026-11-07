// "Pinky does things for you, you tap the last step" (founder 11-06): a booking or a purchase the person asked for becomes
// link cards into the real services, with everything already filled in. Pinky never books, pays, sends or calls by itself.
// Pure: only the words the person asked to search for go into the links (no names, emails or anything else of theirs).
const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;
const text = (value, limit) => typeof value === "string" ? value.trim().replace(/[\0\r\n]+/g, " ").slice(0, limit) : "";
const short = (value, limit = 24) => value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const isTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const query = (base, params) => `${base}?${new URLSearchParams(params)}`;
const web = (value) => { try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && url.hostname.includes(".") ? url : null; } catch { return null; } };
const dayLabel = (date, language) => new Date(`${date}T12:00:00Z`).toLocaleDateString(language === "zh" ? "zh-CN" : language === "es" ? "es-ES" : "en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** Link cards for a table: OpenTable and Resy searches already set to the day, time and party size, the place in Maps,
 * Dianping for Chinese, a call when the number is known, and the restaurant's own site. Missing date, time or party size
 * is never guessed: `{ missing, question }` asks for it instead. */
export function bookTable(fields, { language = "zh", today = null } = {}) {
  const name = text(fields?.name, 80), area = text(fields?.area, 80), date = text(fields?.date, 10), time = text(fields?.time, 5);
  const partySize = Number.isSafeInteger(fields?.partySize) && fields.partySize >= 1 && fields.partySize <= 50 ? fields.partySize : null;
  const missing = [!name && "name", !(isDay(date) && (!today || date >= today)) && "date", !isTime(time) && "time", !partySize && "partySize"].filter(Boolean);
  if (missing.length) return { missing, question: askFor(missing, language) };
  const term = [name, area].filter(Boolean).join(" ");
  const phone = text(fields?.phone, 40).replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  const site = web(text(fields?.website, 500));
  const place = area ? say(language, `${name}（${area}）`, `${name} (${area})`, `${name} (${area})`) : name;
  const cards = [
    { kind: "link", title: say(language, "在 OpenTable 订位", "Book on OpenTable", "Reservar en OpenTable"), url: query("https://www.opentable.com/s", { dateTime: `${date}T${time}`, covers: String(partySize), term }) },
    { kind: "link", title: say(language, "在 Resy 订位", "Book on Resy", "Reservar en Resy"), url: query("https://resy.com/search", { query: term, date, seats: String(partySize) }) },
    ...(language === "zh" ? [{ kind: "link", title: `在大众点评搜「${short(name)}」`, url: `https://www.dianping.com/search/keyword/0/0_${encodeURIComponent(term)}` }] : []),
    { kind: "link", title: say(language, `在地图上看「${short(name)}」`, `See ${short(name)} on the map`, `Ver ${short(name)} en el mapa`), url: query("https://www.google.com/maps/search/", { api: "1", query: term }) },
    ...(phone.replace(/\D/g, "").length >= 5 ? [{ kind: "link", title: say(language, `打电话订位 ${phone}`, `Call to book ${phone}`, `Llamar para reservar ${phone}`), url: `tel:${phone}` }] : []),
    ...(site ? [{ kind: "link", title: say(language, `${short(name)} 官网`, `${short(name)} website`, `Web de ${short(name)}`), url: site.href }] : []),
  ];
  const day = say(language, `${dayLabel(date, language)} ${time}`, `${dayLabel(date, language)} at ${time}`, `${dayLabel(date, language)} a las ${time}`);
  const summary = say(language, `${day}，${partySize} 位，${place}。点下面去订，最后一步你自己确认。`,
    `${day}, ${partySize} ${partySize === 1 ? "person" : "people"}, ${place}. Tap below to book; you confirm the last step yourself.`,
    `${day}, ${partySize} ${partySize === 1 ? "persona" : "personas"}, ${place}. Toca abajo para reservar; el último paso lo confirmas tú.`);
  // Booking by phone: one line the person can read out (their own name is theirs to add).
  const script = cards.some((card) => card.url.startsWith("tel:")) ? say(language, `打电话可以这样说：“你好，我想订 ${day} 的位子，${partySize} 位。”`,
    `On the phone: "Hi, I'd like a table for ${partySize} on ${day}, please."`, `Por teléfono: «Hola, quisiera una mesa para ${partySize} el ${day}, por favor.»`) : "";
  return { cards, summary, script };
}

/** Link cards for buying something: the store the person named, Amazon, Google Shopping, and Taobao for Chinese. */
export function buy(fields, { language = "zh" } = {}) {
  const item = text(fields?.name, 80), store = text(fields?.store, 500), budget = text(fields?.budget, 40);
  if (!item) return { missing: ["name"], question: askFor(["name"], language) };
  const storeUrl = web(store);
  // A store named in words narrows the comparison search; a store link is handed over as it is.
  const term = storeUrl || !store ? item : `${item} ${text(store, 60)}`;
  const cards = [
    ...(storeUrl ? [{ kind: "link", title: say(language, `去 ${storeUrl.hostname.replace(/^www\./, "")} 买`, `Buy at ${storeUrl.hostname.replace(/^www\./, "")}`, `Comprar en ${storeUrl.hostname.replace(/^www\./, "")}`), url: storeUrl.href }] : []),
    { kind: "link", title: say(language, `在 Amazon 搜「${short(item)}」`, `Find ${short(item)} on Amazon`, `Buscar ${short(item)} en Amazon`), url: query("https://www.amazon.com/s", { k: item }) },
    { kind: "link", title: say(language, "Google 购物比价", "Compare prices on Google Shopping", "Comparar precios en Google Shopping"), url: query("https://www.google.com/search", { tbm: "shop", q: term }) },
    ...(language === "zh" ? [{ kind: "link", title: `在淘宝搜「${short(item)}」`, url: query("https://s.taobao.com/search", { q: item }) }] : []),
  ];
  const summary = say(language, `「${item}」${budget ? `，预算 ${budget}` : ""}，帮你找好了地方。点下面去挑，下单付款你自己来。`,
    `${item}${budget ? ` (budget ${budget})` : ""}: here's where to get it. Tap below to pick; checkout and payment are yours.`,
    `${item}${budget ? ` (presupuesto ${budget})` : ""}: aquí puedes conseguirlo. Toca abajo para elegir; la compra y el pago son cosa tuya.`);
  return { cards, summary, script: "" };
}

/** One short question for what a hand-off still needs. */
export function askFor(missing, language = "zh") {
  if (missing.includes("name")) return say(language, "要订哪家、买什么？告诉我名字。", "Which place or item? Tell me its name.", "¿Qué lugar o artículo? Dime el nombre.");
  const parts = { date: say(language, "哪天", "which day", "qué día"), time: say(language, "几点", "what time", "a qué hora"), partySize: say(language, "几位", "how many people", "cuántas personas") };
  const list = missing.map((key) => parts[key]);
  return say(language, `订位还差一点：${list.join("、")}？`, `To book it: ${list.join(", ")}?`, `Para reservar: ¿${list.join(", ")}?`);
}

/** The hand-off for one planned action (`operation` book_table or buy), or `{ missing, question }`. */
export const prepareHandoff = (operation, fields, options) => operation === "book_table" ? bookTable(fields, options) : buy(fields, options);
