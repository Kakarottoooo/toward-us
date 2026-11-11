// Imported timestamps are wall-clock readings. No UTC conversion or model arithmetic.
const hours = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
export function sourceChronology(messages) {
  const references = new Map(), comparisons = [];
  let currentDate;
  for (const message of messages) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(message.at || "")) continue;
    const date = message.at.slice(0, 10), time = message.at.slice(11, 16);
    if (date !== currentDate) { references.clear(); currentDate = date; }
    const minute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    for (const reference of references.values()) {
      if (reference.sender === message.sender) continue;
      comparisons.push({ date, sender: message.sender, message: message.text, time, referencedTime: clock(reference.minute),
        relation: minute > reference.minute ? "after / 晚于" : minute < reference.minute ? "before / 早于" : "at / 正好",
        differenceMinutes: minute - reference.minute, source: reference.text, interpretation: reference.interpretation });
      if (comparisons.length >= 100) break;
    }
    if (comparisons.length >= 100) break;
    const text = message.text || "";
    // No assumed date for tomorrow, another weekday, or overnight arrangements.
    if (/tomorrow|next|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|明天|后天|昨天|下周|周[一二三四五六日天]|mañana/iu.test(text)) continue;
    const match = text.match(/\b(?:at|on)\s+(\d{1,2}(?::\d{2})?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(a\.?m\.?|p\.?m\.?)?\b/iu)
      || text.match(/(?:约好?|定在|见面|碰面|见|到|在).{0,8}?(\d{1,2}:\d{2})/u);
    if (!match) continue;
    const [hourText, minuteText = "0"] = match[1].toLowerCase().split(":");
    let hour = /^\d+$/.test(hourText) ? Number(hourText) : hours.indexOf(hourText);
    const part = Number(minuteText);
    if (hour < 0 || hour > 23 || part > 59) continue;
    let interpretation = "explicit wall-clock time";
    if (match[2]) { if (hour < 1 || hour > 12) continue; hour = hour % 12 + (/^p/i.test(match[2]) ? 12 : 0); }
    else if (!match[1].includes(":") && hour <= 12) {
      const next = [hour % 12, hour % 12 + 12].find(value => value * 60 + part >= minute);
      if (next === undefined) continue;
      hour = next;
      interpretation = "same-day upcoming time inferred from the source message timestamp; not a separately confirmed appointment";
    }
    if (references.size < 20 || references.has(message.sender)) references.set(message.sender, { minute: hour * 60 + part, sender: message.sender, text, interpretation });
  }
  return comparisons.length ? `\n[Code-calculated wall-clock comparisons; source wording determines whether a time was proposed or agreed]\n${JSON.stringify(comparisons)}` : "";
}
