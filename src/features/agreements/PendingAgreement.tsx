import { useState } from "react";
import { CalendarBlank, Microphone, PaperPlaneRight } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { jsonBody, relationshipApi } from "../relationship/api";
import { KeyboardInput, useKeyboard } from "../../mobile";
import { browserSpeechAvailable, useBrowserSpeech } from "../../useBrowserSpeech";
import "./agreements.css";

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

/** The terms of an agreement: dated ones under their day with how far away it is, the others as a list. */
export function PlanTerms({ terms, language }: { terms: string[]; language: Language }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const plan = planByDay(terms);
  const away = (days: number | null) => days === null ? "" : days === 0 ? t("今天", "today", "hoy") : days === 1 ? t("明天", "tomorrow", "mañana") : t(`还有 ${days} 天`, `in ${days} days`, `en ${days} días`);
  return <>
    {plan.days.length > 0 && <div className="agreement-days">{plan.days.map((group) => <section key={group.day} className="agreement-day">
      <h3><CalendarBlank size={15} />{group.day}{away(group.away) && <em>{away(group.away)}</em>}</h3>
      <ul>{group.items.map((item, index) => <li key={index}>{item}</li>)}</ul>
    </section>)}</div>}
    {!!plan.rest.length && <ol>{plan.rest.map((term, index) => <li key={index}>{term}</li>)}</ol>}
  </>;
}

/** What an agreement still waiting for both of them can do on its card in Us (founder 11-06: settled there, not on Coming up,
 * which is for the whole relationship): answer a point still open, typed or spoken, and move a one-off plan to the calendar. */
export function PendingAgreementTools({ agreement, language, onChanged }: { agreement: { id: string; version: number; terms: string[]; unresolvedPoints?: string[] }; language: Language; onChanged: () => void | Promise<void> }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [answering, setAnswering] = useState<number | null>(null), [answer, setAnswer] = useState("");
  const keyboard = useKeyboard();
  const speech = useBrowserSpeech({ lang: languageTag(language), onTranscript: (text) => setAnswer((value) => value ? `${value}${language === "zh" ? "" : " "}${text}` : text), onError: () => setNotice(t("语音暂时用不了，可以先打字。", "Voice is unavailable right now. You can still type.", "La voz no está disponible ahora. Puedes escribir.")) });
  const open = (agreement.unresolvedPoints || []).map((point, index) => ({ point, index })).filter(({ point }) => point.trim() && !isConsentPoint(point));
  const dated = planByDay(agreement.terms).days.length > 0;
  const call = async (path: string, body: Record<string, unknown>) => {
    setBusy(true); setNotice("");
    try { await relationshipApi(`/api/together/agreements/${agreement.id}/${path}`, jsonBody({ version: agreement.version, language, ...body })); setAnswering(null); setAnswer(""); await onChanged(); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };
  const settle = (index: number) => { const text = answer.trim(); if (!text) return; keyboard.hide(); speech.stop(); void call("answer", { index, text }); };
  return <>
    {!!open.length && <div className="agreement-open"><small>{t("还没定的，点一下直接回答", "Still open: tap one to settle it", "Pendiente: toca uno para resolverlo")}</small>
      <ul>{open.map(({ point, index }) => <li key={index} className={answering === index ? "is-answering" : ""}>
        {answering !== index ? <button type="button" className="agreement-point" onClick={() => { setAnswering(index); setAnswer(""); }} data-testid="agreement-point">{point}<span>{t("回答", "Answer", "Responder")}</span></button> : <span>{point}</span>}
        {answering === index && <form className="agreement-answer-form" onSubmit={(event) => { event.preventDefault(); settle(index); }}>
          <KeyboardInput value={answer} onChange={(event) => setAnswer(event.target.value)} onBlur={() => keyboard.hide()} maxLength={300} autoFocus placeholder={t("比如：十二点半出发，打车", "e.g. leave at 12:30, take a taxi", "p. ej.: salir a las 12:30, en taxi")} aria-label={point} data-testid="agreement-answer-input" />
          {browserSpeechAvailable() && <button type="button" className={`agreement-mic ${speech.listening ? "is-on" : ""}`} onClick={() => { keyboard.hide(); if (speech.listening) speech.stop(); else speech.start(); }} aria-pressed={speech.listening} aria-label={speech.listening ? t("停止说话", "Stop speaking", "Dejar de hablar") : t("用说的", "Speak instead", "Hablar")}><Microphone size={18} /></button>}
          <button type="submit" className="agreement-send" disabled={!answer.trim() || busy} aria-label={t("补上", "Add it", "Añadir")} data-testid="agreement-answer-send"><PaperPlaneRight size={16} weight="fill" /></button>
        </form>}
      </li>)}</ul>
      {answering !== null && <small className="agreement-answer-note">{t("补上后是新的一份，你们俩要再各点一次同意。", "Adding it makes a new version: you both say yes again.", "Al añadirlo es una versión nueva: los dos aceptan otra vez.")}</small>}
    </div>}
    {dated && <button type="button" className="agreement-to-calendar" disabled={busy} onClick={() => void call("to-calendar", {})} data-testid="agreement-to-calendar"><CalendarBlank size={16} />{t("这是个计划，放进日历", "It's just a plan: put it on the calendar", "Es solo un plan: al calendario")}</button>}
    {notice && <p className="space-error" role="alert">{notice}</p>}
  </>;
}
