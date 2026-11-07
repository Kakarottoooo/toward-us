import { useEffect, useState } from "react";
import { CalendarBlank, CheckCircle, ClockCounterClockwise, Microphone, PaperPlaneRight } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { jsonBody, relationshipApi } from "../relationship/api";
import type { GraphRecord, RelationshipHomePayload } from "../relationship/types";
import { PromiseList } from "../promises/PromiseList";
import { KeyboardInput, useKeyboard } from "../../mobile";
import { browserSpeechAvailable, useBrowserSpeech } from "../../useBrowserSpeech";
import "./agreements.css";

const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];

// The plan by day (founder 11-06: "按日子排开"): terms that start with a day ("周六：…", "Sunday: …") are grouped under it, with how
// many days away it is; the rest stay a plain list. And open points that only ask whether the other one agrees are left out:
// the agree buttons already ask that.
const WEEKDAYS: Array<[RegExp, number]> = [
  [/^(周日|周天|星期日|星期天|sunday|domingo)$/i, 0], [/^(周一|星期一|monday|lunes)$/i, 1], [/^(周二|星期二|tuesday|martes)$/i, 2],
  [/^(周三|星期三|wednesday|mi[eé]rcoles)$/i, 3], [/^(周四|星期四|thursday|jueves)$/i, 4], [/^(周五|星期五|friday|viernes)$/i, 5],
  [/^(周六|星期六|saturday|s[aá]bado)$/i, 6],
];
const DAY_HEAD = /^\s*(周[一二三四五六日天]|星期[一二三四五六日天]|今天|明天|后天|(?:mon|tues|wednes|thurs|fri|satur|sun)day|today|tomorrow|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|hoy|mañana)\s*[：:，,]\s*(.+)$/i;
export type DayGroup = { day: string; away: number | null; items: string[] };
/** Terms grouped by the day they start with, in the order the days first appear; `rest` has the terms without one. */
export function planByDay(terms: string[], today = new Date()): { days: DayGroup[]; rest: string[] } {
  const days: DayGroup[] = [], rest: string[] = [];
  for (const term of terms) {
    const match = DAY_HEAD.exec(term);
    if (!match) { rest.push(term); continue; }
    const day = match[1], weekday = WEEKDAYS.find(([pattern]) => pattern.test(day))?.[1];
    const away = weekday === undefined ? null : (weekday - today.getDay() + 7) % 7;
    const group = days.find((item) => item.day === day) || (days.push({ day, away, items: [] }), days[days.length - 1]);
    group.items.push(match[2]);
  }
  return { days, rest };
}
export const isConsentPoint = (point: string) => /是否同意|同不同意|是否接受|同意.*安排|agrees?\b|approv|está de acuerdo|acepta/i.test(point);

/** 我们说好的 (founder 11-06): the top of Coming up, not a page of its own. What they promised each other, reviews that are due,
 * agreements waiting for approval (approved right here or on the card in Us), those in effect with their undated parts, and
 * earlier ones folded away. Dated parts are on the calendar below like any other to-do. Nothing shows until there is something. */
export function AgreementsPage({ language, userId, payload, onChanged, onReview }: { language: Language; userId: string; payload: RelationshipHomePayload; onChanged: () => void | Promise<void>; onReview: (outcomeId: string) => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [busy, setBusy] = useState(""); const [notice, setNotice] = useState("");
  // Answering a point still open, right on the card: which one is open, and what is typed or said.
  const [answering, setAnswering] = useState<{ id: string; index: number } | null>(null), [answer, setAnswer] = useState("");
  const keyboard = useKeyboard();
  const speech = useBrowserSpeech({ lang: languageTag(language), onTranscript: (text) => setAnswer((value) => value ? `${value}${language === "zh" ? "" : " "}${text}` : text), onError: () => setNotice(t("语音暂时用不了，可以先打字。", "Voice is unavailable right now. You can still type.", "La voz no está disponible ahora. Puedes escribir.")) });
  // What this member last told Pinky about each of their promises; only they see it.
  const [answers, setAnswers] = useState<Record<string, { done: boolean; at: string }>>({});
  useEffect(() => { relationshipApi<{ promises: Record<string, { done: boolean; at: string }> }>("/api/assistant/promises").then((result) => setAnswers(result.promises)).catch(() => {}); }, []);
  const { agreements, approvals, commitments } = payload.graph;
  const approvedByMe = (agreement: GraphRecord) => approvals.some((item) => item.agreementId === agreement.id && item.approvedVersion === agreement.version && item.ownerUserId === userId && !item.withdrawnAt);
  const decide = async (agreement: GraphRecord, action: "approve" | "request-change") => {
    setBusy(agreement.id); setNotice("");
    try { await relationshipApi(`/api/together/agreements/${agreement.id}/${action}`, jsonBody({ version: agreement.version, language })); await onChanged(); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(""); }
  };
  // A one-off plan written as an agreement goes onto the calendar instead (founder 11-06: "计划可以变成日历上的事情").
  const toCalendar = async (agreement: GraphRecord) => {
    setBusy(agreement.id); setNotice("");
    try { await relationshipApi(`/api/together/agreements/${agreement.id}/to-calendar`, jsonBody({ version: agreement.version, language })); await onChanged(); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(""); }
  };
  const settle = async (agreement: GraphRecord, index: number) => {
    const text = answer.trim(); if (!text) return;
    keyboard.hide(); speech.stop(); setBusy(agreement.id); setNotice("");
    try { await relationshipApi(`/api/together/agreements/${agreement.id}/answer`, jsonBody({ version: agreement.version, index, text, language })); setAnswering(null); setAnswer(""); await onChanged(); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(""); }
  };
  const groups = [
    { key: "waiting", title: t("等你们点头", "Waiting for both of you", "Esperando a los dos"), items: agreements.filter((item) => item.status === "awaiting_approvals") },
    // A version someone asked to change stays in view, with who asked and why, until a new version goes out for approval.
    { key: "changing", title: t("有人想改", "Someone wants a change", "Alguien quiere cambiarlo"), items: agreements.filter((item) => item.status === "draft") },
    { key: "active", title: t("我们说好的", "What we agreed", "Lo que acordamos"), items: agreements.filter((item) => item.status === "active") },
    { key: "past", title: t("以前的", "Earlier", "Anteriores"), items: agreements.filter((item) => !["awaiting_approvals", "active", "draft"].includes(item.status)) },
  ].filter((group) => group.items.length);
  const reviews = payload.home.pending.filter((item) => item.type === "outcome_review");
  const partner = payload.relationship.members.find((member) => member.id !== userId);
  const partnerName = partner?.name || t("TA", "Your partner", "Tu pareja");
  // Who we're waiting on, in plain words (founder 11-06): the shared agreement says who has said yes to what's on the table.
  const status = (agreement: GraphRecord) => {
    if (agreement.status === "awaiting_approvals") {
      const yes = strings(agreement.approvedBy), mine = approvedByMe(agreement) || yes.includes(userId), theirs = Boolean(partner && yes.includes(partner.id));
      return mine ? t(`你同意了，等 ${partnerName} 点头`, `You said yes. Waiting for ${partnerName}.`, `Dijiste que sí. Esperando a ${partnerName}.`)
        : theirs ? t(`${partnerName} 已经同意了，就差你`, `${partnerName} already said yes. It's up to you.`, `${partnerName} ya dijo que sí. Falta tu respuesta.`)
        // Agreements from before 11-06 don't say who has agreed: don't guess about the other one.
        : !Array.isArray(agreement.approvedBy) ? t("等你点头", "Waiting for your yes", "Falta tu sí")
        : t("等你们俩都点头", "Waiting for both of you to say yes", "Esperando a que los dos digan que sí");
    }
    return agreement.status === "active" ? t("你们俩都同意了", "You both agreed", "Los dos están de acuerdo") : agreement.status === "draft" ? t("在“我们俩”里跟 Pinky 说想怎么改，它出新的一份，你们再点头", "Tell Pinky in Us what to change; it writes a new one for you both to agree to", "Dile a Pinky en Nosotros qué cambiar; escribirá uno nuevo para que los dos lo acepten") : agreement.status === "renegotiation_requested" ? t("有人想重新商量", "Someone asked to revisit it", "Alguien pidió revisarlo") : t("已结束", "Closed", "Cerrado");
  };
  const nameOf = (id: unknown) => id === userId ? t("你", "you", "tú") : payload.relationship.members.find((member) => member.id === id)?.name || "";
  // Who asked for the change and why, in their own words; the server keeps both on the shared agreement.
  const changeNote = (agreement: GraphRecord) => {
    if (agreement.status !== "draft") return null;
    const who = payload.relationship.members.find((member) => member.id === agreement.changedByUserId)?.name || "", why = String(agreement.changeReason || "").trim();
    if (!who && !why) return null;
    return why ? t(`${who || "有人"} 想改：${why}`, `${who || "Someone"} wants a change: ${why}`, `${who || "Alguien"} quiere cambiar: ${why}`) : t(`${who} 想改这一版`, `${who} asked for a change`, `${who} pidió un cambio`);
  };
  const card = (agreement: GraphRecord, key: string) => {
    // Parts with a day are on the calendar below like any to-do; only the undated ones (habits, rules) are listed here.
    const terms = strings(agreement.terms), allOpen = strings(agreement.unresolvedPoints), mine = commitments.filter((item) => item.agreementId === agreement.id && !item.archivedAt && !item.dueAt);
    const open = allOpen.map((point, index) => ({ point, index })).filter(({ point }) => !isConsentPoint(point));
    const waiting = agreement.status === "awaiting_approvals", plan = planByDay(terms);
    const when = new Date(agreement.updatedAt).toLocaleDateString(languageTag(language), { month: "short", day: "numeric" }), by = nameOf(agreement.proposedBy);
    const away = (days: number | null) => days === null ? "" : days === 0 ? t("今天", "today", "hoy") : days === 1 ? t("明天", "tomorrow", "mañana") : t(`还有 ${days} 天`, `in ${days} days`, `en ${days} días`);
    return <article key={agreement.id} className={`agreement-item is-${key}`} data-testid="agreement-item">
      <header><strong>{String(agreement.title || "")}</strong><small>{by ? t(`${by}提的 · ${when}`, `From ${by} · ${when}`, `De ${by} · ${when}`) : when}</small></header>
      {waiting && <p className="agreement-who" data-testid="agreement-who">{status(agreement)}</p>}
      {changeNote(agreement) && <p className="agreement-change" data-testid="agreement-change">{changeNote(agreement)}</p>}
      {!!agreement.summary && agreement.summary !== terms.join(" / ") && agreement.summary !== agreement.title && <p>{String(agreement.summary)}</p>}
      {plan.days.length > 0 && <div className="agreement-days">{plan.days.map((group) => <section key={group.day} className="agreement-day">
        <h3><CalendarBlank size={15} />{group.day}{away(group.away) && <em>{away(group.away)}</em>}</h3>
        <ul>{group.items.map((item, index) => <li key={index}>{item}</li>)}</ul>
      </section>)}</div>}
      {!!plan.rest.length && <ol>{plan.rest.map((term, index) => <li key={index}>{term}</li>)}</ol>}
      {!!open.length && <div className="agreement-open"><small>{t("还没定的，点一下直接回答", "Still open: tap one to settle it", "Pendiente: toca uno para resolverlo")}</small>
        <ul>{open.map(({ point, index }) => {
          const here = answering?.id === agreement.id && answering.index === index;
          return <li key={index} className={here ? "is-answering" : ""}>
            {waiting && !here ? <button type="button" className="agreement-point" onClick={() => { setAnswering({ id: agreement.id, index }); setAnswer(""); }} data-testid="agreement-point">{point}<span>{t("回答", "Answer", "Responder")}</span></button> : <span>{point}</span>}
            {here && <form className="agreement-answer-form" onSubmit={(event) => { event.preventDefault(); void settle(agreement, index); }}>
              <KeyboardInput value={answer} onChange={(event) => setAnswer(event.target.value)} onBlur={() => keyboard.hide()} maxLength={300} autoFocus placeholder={t("比如：十二点半出发，打车", "e.g. leave at 12:30, take a taxi", "p. ej.: salir a las 12:30, en taxi")} aria-label={point} data-testid="agreement-answer-input" />
              {browserSpeechAvailable() && <button type="button" className={`agreement-mic ${speech.listening ? "is-on" : ""}`} onClick={() => { keyboard.hide(); if (speech.listening) speech.stop(); else speech.start(); }} aria-pressed={speech.listening} aria-label={speech.listening ? t("停止说话", "Stop speaking", "Dejar de hablar") : t("用说的", "Speak instead", "Hablar")}><Microphone size={18} /></button>}
              <button type="submit" className="agreement-send" disabled={!answer.trim() || busy === agreement.id} aria-label={t("补上", "Add it", "Añadir")} data-testid="agreement-answer-send"><PaperPlaneRight size={16} weight="fill" /></button>
            </form>}
          </li>;
        })}</ul>
        {answering?.id === agreement.id && <small className="agreement-answer-note">{t("补上后是新的一份，你们俩要再各点一次同意。", "Adding it makes a new version: you both say yes again.", "Al añadirlo es una versión nueva: los dos aceptan otra vez.")}</small>}
      </div>}
      {!!mine.length && <ul className="agreement-commitments">{mine.map((item) => <li key={item.id}>{String(item.description || "")}{answers[item.id] && <small className={`agreement-answer ${answers[item.id].done ? "done" : ""}`}>{answers[item.id].done ? t("你说做到了", "You said you did it", "Dijiste que lo cumpliste") : t("你说还没做到", "You said not yet", "Dijiste que aún no")} · {new Date(answers[item.id].at).toLocaleDateString(languageTag(language), { month: "short", day: "numeric" })} · {t("只有你看得到", "only you see this", "solo tú lo ves")}</small>}</li>)}</ul>}
      <footer>{!waiting && <span className="card-state">{agreement.status === "active" && <CheckCircle size={16} weight="fill" />}{status(agreement)}</span>}
        {waiting && !approvedByMe(agreement) && <div className="card-actions"><button className="card-primary" disabled={busy === agreement.id} onClick={() => void decide(agreement, "approve")} data-testid="agreement-approve"><CheckCircle size={18} weight="fill" />{t("我同意", "I agree", "Estoy de acuerdo")}</button><button disabled={busy === agreement.id} onClick={() => void decide(agreement, "request-change")}>{t("我想改一下", "I'd change something", "Quiero cambiar algo")}</button></div>}
        {(waiting || agreement.status === "draft") && plan.days.length > 0 && <button type="button" className="agreement-to-calendar" disabled={busy === agreement.id} onClick={() => void toCalendar(agreement)} data-testid="agreement-to-calendar"><CalendarBlank size={16} />{t("这是个计划，放进日历", "It's just a plan: put it on the calendar", "Es solo un plan: al calendario")}</button>}
        {waiting && <small className="agreement-rule">{plan.days.length ? t("两个人都同意才算数。同意后，有日子的事 Pinky 会提前一天提醒你们。", "It counts once you both agree. Then Pinky reminds you the day before anything with a day.", "Cuenta cuando los dos aceptan. Luego Pinky les recuerda un día antes lo que tenga fecha.") : t("两个人都同意才算数。", "It counts once you both agree.", "Cuenta cuando los dos aceptan.")}</small>}
      </footer>
    </article>;
  };
  const past = groups.find((group) => group.key === "past");
  return <div className="agreements-page" data-testid="agreements">
    {notice && <p className="space-error" role="alert">{notice}</p>}
    {/* What the two of them promised each other in conversation comes first: it is what Pinky follows up on (11-03). */}
    <PromiseList language={language} partnerName={partnerName} refreshKey={payload} onChanged={onChanged} hideEmpty />
    {reviews.map((item) => <button key={item.id} className="agreement-review" onClick={() => onReview(item.id)}><ClockCounterClockwise size={20} />{t("该复盘了：", "Time to review: ", "Hora de revisar: ")}{item.title}</button>)}
    {groups.filter((group) => group.key !== "past").map((group) => <section key={group.key}><h2 className="space-subhead">{group.title}</h2>{group.items.map((item) => card(item, group.key))}</section>)}
    {past && <details className="agreements-past"><summary>{past.title} · {past.items.length}</summary>{past.items.map((item) => card(item, "past"))}</details>}
  </div>;
}
