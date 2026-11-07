import { audit, clean, decisionError } from "./agreement-actions.mjs";
import { createRelationshipRecord } from "./relationship-domain.mjs";
import { appendTogetherMessage, togetherI18n } from "./together-domain.mjs";

// 计划 vs 约定 (founder 11-06: "计划可以变成日历上的事情然后不要放这种下周计划"). A one-off plan ("周六在家，周日一点去爸妈家")
// belongs on the shared calendar with a reminder the day before, not in an agreement both must approve. Pinky now puts plans
// there directly; this turns one already written as an agreement into calendar dates and takes the agreement away.

const WEEKDAYS = [
  [/^(周日|周天|星期日|星期天|sunday|domingo)$/i, 0], [/^(周一|星期一|monday|lunes)$/i, 1], [/^(周二|星期二|tuesday|martes)$/i, 2],
  [/^(周三|星期三|wednesday|mi[eé]rcoles)$/i, 3], [/^(周四|星期四|thursday|jueves)$/i, 4], [/^(周五|星期五|friday|viernes)$/i, 5],
  [/^(周六|星期六|saturday|s[aá]bado)$/i, 6],
];
const RELATIVE = [[/^(今天|today|hoy)$/i, 0], [/^(明天|tomorrow|mañana)$/i, 1], [/^(后天)$/i, 2]];
const DAY_HEAD = /^\s*(周[一二三四五六日天]|星期[一二三四五六日天]|今天|明天|后天|(?:mon|tues|wednes|thurs|fri|satur|sun)day|today|tomorrow|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|hoy|mañana)\s*[：:，,]\s*(.+)$/i;

const addDays = (day, count) => new Date(Date.parse(`${day}T12:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (day) => new Date(`${day}T12:00:00Z`).getUTCDay();

/** The dated parts of a plan: [{ date, label, text }] for each term that starts with a day, counted from `from` (the day the
 * plan was written, YYYY-MM-DD): a weekday is its next occurrence on or after that day, 明天 the day after. */
export function datedTerms(terms, from) {
  const found = [];
  for (const term of Array.isArray(terms) ? terms : []) {
    const match = DAY_HEAD.exec(String(term));
    if (!match) continue;
    const label = match[1], text = match[2].replace(/[。.]\s*$/u, "").trim();
    const weekday = WEEKDAYS.find(([pattern]) => pattern.test(label))?.[1], relative = RELATIVE.find(([pattern]) => pattern.test(label))?.[1];
    const date = weekday !== undefined ? addDays(from, (weekday - weekdayOf(from) + 7) % 7) : relative !== undefined ? addDays(from, relative) : null;
    if (date && text) found.push({ date, label, text });
  }
  return found;
}

/** Puts the plan written as agreement `agreementId` on the shared calendar (one date per dated term, each with a reminder the
 * day before) and takes the agreement away: archived, never deleted, so its history stays. Either of them may do it. */
export async function planToCalendar(tx, { agreementId, version, userId, from, name = "" }) {
  const agreement = await tx.getRelationshipRecordForUser("agreements", agreementId, userId);
  if (!agreement || agreement.archivedAt) throw decisionError(404, "not_found");
  if (!Number.isInteger(version) || version !== agreement.version) throw decisionError(409, "stale_version");
  if (!["awaiting_approvals", "draft"].includes(agreement.status)) throw decisionError(409, "agreement_not_editable");
  const dated = datedTerms(agreement.terms, from);
  if (!dated.length) throw decisionError(400, "plan_without_days");
  const created = [];
  for (const item of dated) {
    const title = clean(`${item.label} · ${item.text}`, 120);
    const milestone = createRelationshipRecord({ relationshipId: agreement.relationshipId, userId, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "both", status: "active", type: "custom", title, date: item.date, timezone: "UTC", recurringRule: "once", jointlyConfirmed: false, notes: clean(agreement.title, 160), provenanceSource: "agreement", sourceAgreementId: agreement.id });
    await tx.createRelationshipRecord("milestones", milestone);
    // The day before, Pinky says it in Us (reminder-service announces shared reminders on a date).
    await tx.createRelationshipRecord("reminders", createRelationshipRecord({ relationshipId: agreement.relationshipId, userId, visibility: "shared", aiAccessScope: "joint", approvalPolicy: "owner", status: "active", milestoneId: milestone.id, minutesBefore: 1440, channel: "in_app", provenanceSource: "agreement" }));
    created.push(milestone);
  }
  const updated = await tx.updateRelationshipRecordForUser("agreements", agreement.id, userId, (draft) => { draft.status = "archived"; draft.archivedAt = new Date().toISOString(); draft.changedByUserId = userId; draft.changeReason = "moved_to_calendar"; draft.version += 1; });
  await audit(tx, updated, userId, "agreement.moved_to_calendar");
  const day = (date, language) => new Date(`${date}T12:00:00Z`).toLocaleDateString(language === "zh" ? "zh-CN" : language, { month: "short", day: "numeric", timeZone: "UTC" });
  const i18n = togetherI18n((language) => {
    const list = dated.map((item) => `${day(item.date, language)} ${item.label}：${item.text}`).join(language === "zh" ? "；" : "; ");
    return language === "en" ? `${name} put "${agreement.title}" on your calendar: ${list}. I'll remind you both the day before.` : language === "es" ? `${name} pasó «${agreement.title}» a su calendario: ${list}. Les aviso a los dos un día antes.` : `${name} 把「${agreement.title}」放进了日历：${list}。前一天我会提醒你们俩。`;
  });
  const posted = await appendTogetherMessage(tx, { relationshipId: agreement.relationshipId, actorUserId: null, userId, source: "app", kind: "text", text: i18n.zh, i18n, handle: `agreement-calendar:${agreement.id}` });
  return { agreement: updated, milestones: created, conversation: posted.duplicate ? null : posted.conversation };
}
