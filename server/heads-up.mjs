import { memberLanguage } from "./together-domain.mjs";
import { memberTimezone } from "./reminder-service.mjs";
import { profileContext } from "./profile.mjs";

// 提前私下说一声 (founder 11-08, from user research: what hurts is "having to remind my partner of my own birthday").
// A week and a day before a partner's birthday, Pinky tells the OTHER partner privately in Just me, with what the birthday
// person has said they wish for (only notes this member may see), and offers to help. The birthday person hears nothing.
// Before their anniversary, each of them is told privately. One push each time; no model call.
export const HEADS_UP_DAYS = [7, 1];
const FIRST_HOUR = 9, LAST_HOUR = 21, DAY = 86_400_000;
const BIRTHDAY = /生日|birthday|cumplea/i, ANNIVERSARY = /纪念日|周年|anniversary|aniversario/i;
const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;
const localNow = (date, timeZone) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(date).map(({ type, value }) => [type, value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
};
const leap = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
/** The next yearly date (YYYY-MM-DD) on or after `day` for a date's month and day; 29 Feb falls on 28 Feb in other years. */
export function nextYearly(date, day) {
  const [, month, dom] = String(date).split("-").map(Number);
  for (let year = Number(day.slice(0, 4)); ; year += 1) {
    const d = month === 2 && dom === 29 && !leap(year) ? 28 : dom;
    const candidate = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (candidate >= day) return candidate;
  }
}
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY);

/** What a yearly date is about: a member's birthday (named in its title), their anniversary, or neither. */
export function occasionOf(milestone, members) {
  const title = String(milestone.title || "");
  if (milestone.type === "relationship_started" || String(milestone.notes || "") === "together_since") return { kind: "together" };
  if (BIRTHDAY.test(title)) {
    const named = members.filter((member) => member.user?.name && title.toLowerCase().includes(member.user.name.toLowerCase()));
    return named.length === 1 ? { kind: "birthday", of: named[0].userId } : null;
  }
  return ANNIVERSARY.test(title) ? { kind: "anniversary" } : null;
}

function message(language, { occasion, daysLeft, on, name, title, years, wishes }) {
  const md = say(language, `${Number(on.slice(5, 7))} 月 ${Number(on.slice(8, 10))} 日`, on.slice(5), `${on.slice(8, 10)}/${on.slice(5, 7)}`);
  const wish = wishes.length ? say(language, `${name} 说过想要：${wishes.join("、")}。`, `${name} has mentioned wanting: ${wishes.join(", ")}.`, `${name} ha dicho que quiere: ${wishes.join(", ")}.`) : "";
  if (occasion.kind === "birthday") return daysLeft === 1
    ? { text: say(language, `明天是 ${name} 的生日。${wish}都准备好了吗？还要我帮忙就直接说。`, `Tomorrow is ${name}'s birthday. ${wish} All set? Just tell me if you'd like a hand.`, `Mañana es el cumpleaños de ${name}. ${wish} ¿Todo listo? Dime si quieres ayuda.`), push: say(language, `明天是 ${name} 的生日`, `Tomorrow is ${name}'s birthday`, `Mañana es el cumpleaños de ${name}`) }
    : { text: say(language, `${name} 的生日还有 ${daysLeft} 天（${md}）。${wish}要我帮你挑礼物、订个地方，或者写封信到那天发吗？`, `${name}'s birthday is in ${daysLeft} days (${md}). ${wish} Want help picking a gift, booking somewhere, or writing a letter for the day?`, `El cumpleaños de ${name} es en ${daysLeft} días (${md}). ${wish} ¿Te ayudo a elegir un regalo, reservar algo o escribir una carta para ese día?`), push: say(language, `${name} 的生日还有 ${daysLeft} 天`, `${name}'s birthday is in ${daysLeft} days`, `Faltan ${daysLeft} días para el cumpleaños de ${name}`) };
  const what = occasion.kind === "together" && years > 0 ? say(language, `你们在一起 ${years} 周年`, `your ${years}-year anniversary`, `su aniversario de ${years} años`) : say(language, `你们的「${title}」`, `your "${title}"`, `su «${title}»`);
  return daysLeft === 1
    ? { text: say(language, `明天是${what}。都准备好了吗？还要我帮忙就直接说。`, `Tomorrow is ${what}. All set? Just tell me if you'd like a hand.`, `Mañana es ${what}. ¿Todo listo? Dime si quieres ayuda.`), push: say(language, `明天是${what}`, `Tomorrow is ${what}`, `Mañana es ${what}`) }
    : { text: say(language, `还有 ${daysLeft} 天是${what}（${md}）。要我帮你想想怎么过、订个地方，或者写封信到那天发吗？`, `${what[0].toUpperCase()}${what.slice(1)} is in ${daysLeft} days (${md}). Want help planning it, booking somewhere, or writing a letter for the day?`, `Faltan ${daysLeft} días para ${what} (${md}). ¿Te ayudo a planearlo, reservar algo o escribir una carta para ese día?`), push: say(language, `还有 ${daysLeft} 天是${what}`, `${daysLeft} days until ${what}`, `Faltan ${daysLeft} días para ${what}`) };
}

/** Runs on the maintenance tick. Returns how many heads-ups it posted. */
export async function sendHeadsUps({ store, now = () => new Date(), postNote = async () => null, notify = async () => {} }) {
  let sent = 0;
  for (const conversation of await store.listRecordsForJob("togetherConversations")) {
    try {
      if (!conversation.relationshipId || conversation.archivedAt) continue;
      const context = await store.getRelationshipContext(conversation.createdByUserId);
      if (!(context?.relationship.id === conversation.relationshipId && context.relationship.status === "active" && context.members.length === 2)) continue;
      const yearly = (await store.listRelationshipRecordsForUser("milestones", context.members[0].userId))
        .filter((item) => item.relationshipId === context.relationship.id && !item.archivedAt && /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || "")) && (item.recurringRule === "yearly" || item.type === "relationship_started"));
      for (const recipient of context.members) {
        const zone = await memberTimezone(store, recipient.userId);
        if (!zone) continue;
        const { day, hour } = localNow(now(), zone);
        if (hour < FIRST_HOUR || hour >= LAST_HOUR) continue;
        const threads = (await store.listRelationshipRecordsForUser("privateAgentThreads", recipient.userId)).filter((thread) => thread.ownerUserId === recipient.userId);
        for (const milestone of yearly) {
          const occasion = occasionOf(milestone, context.members);
          if (!occasion || (occasion.kind === "birthday" && occasion.of === recipient.userId)) continue;
          const on = nextYearly(milestone.date, day), daysLeft = daysBetween(day, on);
          if (!HEADS_UP_DAYS.includes(daysLeft)) continue;
          const key = `${milestone.id}:${on}:${daysLeft}`;
          if (threads.some((thread) => thread.headsUp?.[key])) continue;
          const language = await memberLanguage(store, recipient.userId);
          const partner = context.members.find((member) => member.userId !== recipient.userId);
          const known = occasion.kind === "birthday" ? (await profileContext(store, recipient.userId)).partner : [];
          const wishes = [...known.filter((item) => item.category === "wishes"), ...known.filter((item) => item.category === "likes")].slice(0, 3).map((item) => item.fact);
          const years = Number(on.slice(0, 4)) - Number(milestone.date.slice(0, 4));
          const { text, push } = message(language, { occasion, daysLeft, on, name: partner?.user?.name || say(language, "TA", "your partner", "tu pareja"), title: String(milestone.title || "").slice(0, 40), years, wishes });
          const saved = await postNote(recipient.userId, { language, text });
          if (!saved) continue;
          await store.transaction("reminder-delivery", (tx) => tx.updateRelationshipRecordForUser("privateAgentThreads", saved.id, recipient.userId, (draft) => { draft.headsUp = { ...(draft.headsUp || {}), [key]: now().toISOString() }; }));
          threads.push({ headsUp: { [key]: true } });
          await notify(recipient.userId, { body: { zh: push, en: push, es: push }, url: "/?channel=me", tag: `pinky-headsup-${milestone.id}-${daysLeft}`.slice(0, 64) }).catch(() => {});
          sent += 1;
        }
      }
    } catch (error) { console.error("Heads-up will retry on the next tick:", error?.message || error); }
  }
  return { sent };
}
