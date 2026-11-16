// Receipts that read like a person (task 58). A reminder, a remembered fact or a checklist is confirmed in one natural
// sentence, rendered by code from the record the store returned ("好，11 月 12 日晚上 8:30 提醒你给他回电话。"), never in a
// system format with ISO dates or IANA zone codes. One action, one sentence.
const parts = (value, timeZone) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", weekday: "short", hourCycle: "h23" })
  .formatToParts(new Date(value)).map(({ type, value: part }) => [type, part]));
const WEEK = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const zhWeek = "日一二三四五六", enWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], esWeek = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const enMonth = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const esMonth = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function zhClock(hour, minute) {
  const period = hour < 5 ? "凌晨" : hour < 9 ? "早上" : hour < 12 ? "上午" : hour < 13 ? "中午" : hour < 18 ? "下午" : "晚上";
  return `${period} ${hour > 12 ? hour - 12 : hour}:${minute}`;
}
const enClock = (hour, minute) => `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
// Only a zone other than the member's own is named, and then by its readable name.
function zoneName(timeZone, sessionZone, language) {
  if (!timeZone || timeZone === sessionZone) return "";
  try {
    const name = new Intl.DateTimeFormat(language === "en" ? "en-US" : language === "es" ? "es-ES" : "zh-CN", { timeZone, timeZoneName: "long" }).formatToParts(new Date()).find(part => part.type === "timeZoneName")?.value;
    return name ? (language === "zh" ? `（${name}）` : ` (${name})`) : "";
  } catch { return ""; }
}
// Verb-first titles read as what to do ("提醒你给他回电话"); others are named after a colon ("提醒你：妈妈生日").
const zhAction = (title) => /^(?:给|跟|和|帮|去|买|打|做|带|交|吃|喝|拿|取|订|约|问|发|回|还|看|准备|联系|收|寄|记得|接|送|洗|换|充|缴|续|参加|预约|出门|起床|睡|开|练|学|写|读|整理|检查|确认|浇|遛|搬|退|付|领|查|找|提交|复习|锻炼|跑|散步|休息|关|煮|烤|走|来|陪|请|叫|告诉|通知|讨论|商量|聊|见|拜访|上|下)/u.test(title) ? title : `：${title}`;

/** One sentence confirming a saved, changed or paused reminder, from the stored record. */
export function reminderReceipt(record, { language = "zh", sessionTimezone = record?.timezone, operation = "create" } = {}) {
  const title = String(record?.title || "").trim();
  if (operation === "archive") return language === "en" ? `OK, I paused the reminder: ${title}.` : language === "es" ? `Listo, pausé el recordatorio: ${title}.` : `好，这条提醒先停了：${title}。`;
  const at = parts(record.dueAt, record.timezone), now = parts(new Date(), record.timezone), zone = zoneName(record.timezone, sessionTimezone, language);
  const hour = Number(at.hour), minute = at.minute.padStart(2, "0"), month = Number(at.month), day = Number(at.day), weekday = WEEK[at.weekday];
  const yearZh = at.year !== now.year ? `${at.year} 年 ` : "", yearEn = at.year !== now.year ? `, ${at.year}` : "", yearEs = at.year !== now.year ? ` de ${at.year}` : "";
  const weekly = record.frequency === "weekly";
  if (language === "en") {
    const when = `${enMonth[month - 1]} ${day}${yearEn} at ${enClock(hour, minute)}${zone}`;
    if (record.occurrenceOriginalDueAt) return `OK, only the next one moves to ${when}; after that I'll keep reminding you every week as before: ${title}.`;
    return weekly ? `OK, I'll remind you every ${enWeek[weekday]} at ${enClock(hour, minute)}${zone}, starting ${enMonth[month - 1]} ${day}: ${title}.` : `OK, I'll remind you on ${when}: ${title}.`;
  }
  if (language === "es") {
    const when = `el ${day} de ${esMonth[month - 1]}${yearEs} a las ${hour}:${minute}${zone}`;
    if (record.occurrenceOriginalDueAt) return `Listo, solo la próxima vez pasa a ${when}; después te lo recuerdo cada semana como antes: ${title}.`;
    return weekly ? `Listo, te lo recuerdo cada ${esWeek[weekday]} a las ${hour}:${minute}${zone}, desde el ${day} de ${esMonth[month - 1]}: ${title}.` : `Listo, te lo recuerdo ${when}: ${title}.`;
  }
  const when = `${yearZh}${month} 月 ${day} 日${zhClock(hour, minute)}${zone}`;
  if (record.occurrenceOriginalDueAt) return `好，只把下一次改到 ${when}，之后仍按原来的每周时间提醒你${zhAction(title)}。`;
  return weekly ? `好，从 ${month} 月 ${day} 日起，每周${zhWeek[weekday]}${zhClock(hour, minute)}${zone} 提醒你${zhAction(title)}。` : `好，${when} 提醒你${zhAction(title)}。`;
}

/** One sentence confirming what was remembered this turn, naming whom each fact is about. */
export function rememberReceipt(facts, { language = "zh" } = {}) {
  const items = [];
  let last = null;
  for (const { who, text } of facts) {
    const fact = String(text || "").trim().replace(/[。.!！]+$/u, "");
    if (!fact) continue;
    // A dated history line already says who did what; a fact already starting with its subject is not prefixed again.
    const named = !who || who === last || /^(?:\d{4}-\d{2}-\d{2}|以前|Before|Antes)/u.test(fact) || fact.startsWith(who) ? fact : `${who}${language === "zh" ? "" : " "}${fact}`;
    items.push(named); last = who;
  }
  if (!items.length) return "";
  const list = items.join(language === "zh" ? "；" : "; ");
  return language === "en" ? `Got it, noted: ${list}.` : language === "es" ? `Listo, lo tengo presente: ${list}.` : `好，记住了：${list}。`;
}

/** One sentence for what this turn put into one checklist or space. */
export function checklistReceipt({ space, created = false, items = [] }, { language = "zh" } = {}) {
  const names = items.map(item => String(item || "").trim()).filter(Boolean);
  const list = (and) => names.length > 1 ? `${names.slice(0, -1).join(language === "zh" ? "、" : ", ")}${and}${names.at(-1)}` : names[0] || "";
  if (language === "en") return created ? `OK, I made "${space}", visible only to you${names.length ? `, and added ${list(" and ")}` : ""}.` : `OK, I added ${list(" and ")} to "${space}".`;
  if (language === "es") return created ? `Listo, creé «${space}», solo visible para ti${names.length ? `, y añadí ${list(" y ")}` : ""}.` : `Listo, añadí ${list(" y ")} a «${space}».`;
  return created ? `好，建好了只有你能看到的“${space}”${names.length ? `，放进了${list("和")}` : ""}。` : `好，已把${list("和")}放进“${space}”。`;
}
