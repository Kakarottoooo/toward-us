import { ArrowClockwise, Bicycle, CalendarBlank, CheckCircle, ForkKnife, Sparkle, Star, Ticket, X } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { localized, type Language } from "../../i18n";
import { KeyboardInput, useKeyboard } from "../../mobile";
import type { ScreenProps } from "./MatchScreen";
import "./date-budget.css";

type Labels = Record<Language, string>;
type Group = "food" | "activity" | "travel";
type Pick = { id: string; icon: string; cost: number; title: Labels; star: boolean };
type Schedule = { date: string; time: string; timezone: string };
type DateBudgetState = {
  menu: { title: Labels; intro: Labels; budget: number; options: Record<Group, Pick[]> };
  picks: Partial<Record<Group, string>>;
  spent: number;
  ready: boolean;
  schedule: (Schedule & { dueAt: string | null }) | null;
  revision: number;
  confirmed: string[];
  milestoneId: string | null;
};

const groups: Group[] = ["food", "activity", "travel"];
const myZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const commonZones = [
  "America/Los_Angeles", "America/Phoenix", "America/Denver", "America/Chicago", "America/New_York",
  "America/Mexico_City", "America/Bogota", "America/Lima", "America/Santiago", "America/Argentina/Buenos_Aires",
  "Europe/Madrid", "Asia/Shanghai", "UTC",
];

function localDay(timezone: string) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts();
  const get = (part: Intl.DateTimeFormatPartTypes) => parts.find(({ type }) => type === part)?.value;
  return [get("year"), get("month"), get("day")].join("-");
}

export function DateBudget({ match, language, userId, partnerName, act, onRematch }: ScreenProps<DateBudgetState>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const { menu, picks, spent, schedule, confirmed, milestoneId, revision, ready } = match.state;
  const [group, setGroup] = useState<Group>("food");
  const [draft, setDraft] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const pending = useRef(false);
  const isFinished = match.status === "finished";
  const ownApproval = confirmed.includes(userId);
  const partnerApproval = confirmed.some((id) => id !== userId);
  const over = spent > menu.budget;
  const timedOut = schedule ? schedule.dueAt ? Date.parse(schedule.dueAt) <= Date.now() : schedule.date < localDay(schedule.timezone) : false;
  const groupLabels = {
    food: t("吃什么", "Food", "Comida"),
    activity: t("玩什么", "Activity", "Actividad"),
    travel: t("怎么去", "Getting there", "Transporte"),
  };
  const icons = { food: ForkKnife, activity: Ticket, travel: Bicycle };
  const languageTag = language === "zh" ? "zh-CN" : language;
  const summarizeDate = (candidate: NonNullable<DateBudgetState["schedule"]>) => candidate.dueAt
    ? new Date(candidate.dueAt).toLocaleString(languageTag, { dateStyle: "medium", timeStyle: "short", timeZone: myZone })
    : new Date(candidate.date + "T12:00:00Z").toLocaleDateString(languageTag, { dateStyle: "medium", timeZone: "UTC" });

  async function send(type: string, data: Record<string, unknown> = {}) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    try { return await act({ type, revision, ...data }); }
    finally { pending.current = false; setBusy(false); }
  }

  return <section className="date-budget" aria-label={t("约会拼预算", "Budget a Date", "Una cita con presupuesto")} data-testid="date-budget">
    <header className="date-budget-hero">
      <div>
        <h3>{menu.title[language]}</h3>
        <p>{menu.intro[language]}</p>
      </div>
      <div className={"date-budget-balance" + (over ? " is-over" : "")} aria-live="polite">
        <strong data-testid="date-budget-balance">{menu.budget - spent}</strong>
        <small>{t("剩余点数", "credits left", "créditos libres")}</small>
      </div>
      <div className="date-budget-meter" aria-hidden="true">
        {Array.from({ length: menu.budget }, (_, index) => <span key={index} className={index < spent ? "is-spent" : ""} />)}
      </div>
      {over && <p className="date-budget-over" role="status">{t("超出点数上限，换一项试试。", "You're over budget. Swap one pick.", "Superaron el presupuesto. Cambien una opción.")}</p>}
    </header>

    {!isFinished && <>
      <div className="date-budget-groups" aria-label={t("挑选项目", "Choose a category", "Elijan una categoría")} role="group">
        {groups.map((key) => {
          const Icon = icons[key];
          return <button key={key} type="button" aria-pressed={key === group} onClick={() => setGroup(key)} data-testid={"date-budget-tab-" + key}>
            <Icon size={18} weight={key === group ? "fill" : "regular"} aria-hidden="true" />
            <span>{groupLabels[key]}</span>
            {picks[key] && <CheckCircle size={13} weight="fill" aria-label={t("已选", "Picked", "Elegido")} />}
          </button>;
        })}
      </div>
      <div className="date-budget-choices" aria-label={groupLabels[group]} role="group">
        {menu.options[group].map((option) => <button type="button" key={option.id} aria-pressed={picks[group] === option.id}
          disabled={busy} onClick={() => void send("pick", { group, pickId: option.id })} data-testid={"date-budget-pick-" + option.id}>
          <span className="date-budget-choice-icon" aria-hidden="true">{option.icon}</span>
          <strong>{option.title[language]}</strong>
          {option.star && <Star size={15} weight="fill" className="date-budget-star" aria-label={t("带星的点子", "Starred idea", "Idea con estrella")} />}
          <span className="date-budget-cost" aria-label={t(option.cost + " 点数", option.cost + " credits", option.cost + " créditos")}>{option.cost}</span>
        </button>)}
      </div>
    </>}

    <div className="date-budget-ticket">
      <h4><Sparkle size={17} aria-hidden="true" />{t("你们的约会", "Your date", "Su cita")}</h4>
      <ul>{groups.map((key) => {
        const selection = menu.options[key].find(({ id }) => id === picks[key]);
        const Icon = icons[key];
        return <li key={key}><Icon size={16} aria-hidden="true" />
          <span>{selection ? selection.title[language] : groupLabels[key]}</span>
          {selection ? <CheckCircle size={15} weight="fill" aria-label={t("已选", "Picked", "Elegido")} /> : <small>{t("还没选", "Open", "Por elegir")}</small>}
        </li>;
      })}</ul>
      {schedule && <div className="date-budget-time-summary">
        <CalendarBlank size={17} aria-hidden="true" />
        <div>
          <time dateTime={schedule.dueAt || schedule.date}>{summarizeDate(schedule)}</time>
          {schedule.time && schedule.timezone !== myZone && <small>{t("对方提议的时间", "Time as proposed", "Hora propuesta")} · {schedule.time} {schedule.timezone}</small>}
        </div>
      </div>}
      {timedOut && !isFinished && <p className="date-budget-status" role="status">{t("这个时间已经过了。换个时间，或先保存约会方案。", "That time has passed. Pick another time, or save the plan without a date.", "Esa hora ya pasó. Elijan otra hora o guarden el plan sin fecha.")}</p>}
      {isFinished && <p className="date-budget-status" data-testid="date-budget-finished" role="status">{milestoneId
        ? t("已加入共同日历。", "On your shared calendar.", "En su calendario compartido.")
        : t("两个人都确认了这份方案。", "You both confirmed this plan.", "Ambos confirmaron este plan.")}</p>}
    </div>

    {isFinished ? <div className="date-budget-actions">
      {milestoneId && <a className="game-primary" href="/?view=upcoming" data-testid="date-budget-calendar" onClick={() => keyboard.hide()}><CalendarBlank size={17} aria-hidden="true" />{t("打开共同日历", "Open shared calendar", "Abrir calendario compartido")}</a>}
      <button className={milestoneId ? "game-quiet" : "game-primary"} type="button" onClick={onRematch}><ArrowClockwise size={17} aria-hidden="true" />{t("换个约会主题", "Try another date", "Probar otra cita")}</button>
    </div> : <>
      {draft ? <form className="date-budget-schedule" onSubmit={(event) => {
        event.preventDefault();
        keyboard.hide();
        void send("schedule", draft).then((ok) => { if (ok) setDraft(null); });
      }}>
        <div className="date-budget-date-fields">
          <label>{t("日期", "Date", "Fecha")}
            <KeyboardInput type="date" value={draft.date} min={localDay(draft.timezone)} required onChange={(event) => setDraft({ ...draft, date: event.target.value })} data-testid="date-budget-date" />
          </label>
          <label>{t("时间（可选）", "Time (optional)", "Hora (opcional)")}
            <KeyboardInput type="time" value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} data-testid="date-budget-time" />
          </label>
        </div>
        <label>{t("时区", "Time zone", "Zona horaria")}
          <select value={draft.timezone} onFocus={() => keyboard.hide()} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}>
            {[...new Set([myZone, draft.timezone, ...commonZones])].map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}
          </select>
        </label>
        <div className="date-budget-actions">
          <button type="submit" className="game-primary" disabled={busy || !draft.date} data-testid="date-budget-save-time">{t("保存时间", "Save time", "Guardar hora")}</button>
          <button type="button" className="game-quiet" disabled={busy} onClick={() => { keyboard.hide(); setDraft(null); }}>{t("返回", "Back", "Volver")}</button>
        </div>
      </form> : <>
        <p className="date-budget-status" role="status" data-testid="date-budget-approval">
          {ownApproval ? t(`已确认，等 ${partnerName} 点头。`, `Confirmed. Waiting for ${partnerName}.`, `Confirmado. Esperando a ${partnerName}.`)
            : partnerApproval ? t(`${partnerName} 已确认当前方案。`, `${partnerName} confirmed the current plan.`, `${partnerName} confirmó el plan actual.`)
            : schedule ? t("两人确认这个方案和时间后，会加入共同日历。", "Confirm this plan and time together to add it to your shared calendar.", "Confirmen el plan y la hora para añadirlos al calendario compartido.")
            : t("两人确认同一个方案就完成。也可以先约个时间。", "Confirm the same plan to finish, or add a date and time first.", "Confirmen el mismo plan para terminar o elijan primero una fecha y hora.")}
        </p>
        <div className="date-budget-actions">
          <button type="button" className={ownApproval ? "game-quiet" : "game-primary"} disabled={busy || (!ownApproval && (!ready || timedOut))} onClick={() => void send(ownApproval ? "withdraw" : "confirm")} data-testid={ownApproval ? "date-budget-withdraw" : "date-budget-confirm"}>
            {ownApproval ? t("撤回确认", "Withdraw approval", "Retirar aprobación")
              : schedule ? t("确认方案和时间", "Confirm plan and time", "Confirmar plan y hora") : t("确认这个方案", "Confirm this plan", "Confirmar este plan")}
          </button>
          <button type="button" className="game-quiet" disabled={busy || (!ready && !schedule)} onClick={() => setDraft(schedule || { date: "", time: "", timezone: myZone })} data-testid="date-budget-schedule">
            <CalendarBlank size={16} aria-hidden="true" />{schedule ? t("改时间", "Edit time", "Cambiar hora") : t("约个时间", "Pick a time", "Elegir hora")}
          </button>
        </div>
        {schedule && <button type="button" className="game-quiet date-budget-unschedule" disabled={busy} onClick={() => void send("unschedule")}>{t("先不定时间", "Leave the time open", "Dejar la fecha abierta")}</button>}
      </>}
      <div className="date-budget-end">
        <button type="button" className={"game-quiet" + (ending ? " is-confirm" : "")} disabled={busy} onBlur={() => setEnding(false)}
          onClick={() => { if (!ending) { setEnding(true); return; } keyboard.hide(); setEnding(false); void send("abandon"); }}>
          <X size={16} aria-hidden="true" />{ending ? t("确定结束？", "End the game?", "¿Terminar?") : t("结束", "End game", "Terminar")}
        </button>
      </div>
    </>}
  </section>;
}
