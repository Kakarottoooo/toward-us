import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarBlank, CheckCircle, Heart, LockKey, Sparkle } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { KeyboardInput, useKeyboard } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";
import "./play-plans.css";

type Idea = { id: string; title: string; detail: string; fromBoth: boolean };
type Offer = {
  ideaId: string; title: string; date: string; time: string; timezone: string; dueAt: string | null;
  status: "pending" | "cancelled" | "declined" | "confirmed" | "removed"; proposedBy: string;
  calendarUrl?: string; milestoneId?: string; acceptedBy?: string;
};
type Plan = {
  questionId: string; questionTitle: string; version: number;
  ideas: Idea[]; mine: string[]; saved: boolean; partnerReady: boolean; matches: string[]; offer: Offer | null;
};
type Props = {
  language: Language; userId: string; questionId?: string;
  revision: string | number; readOnly?: boolean; onOpenCalendar?: (url: string) => void;
};

const path = "/api/play-plans";
const ended = (offer: Offer) => offer.dueAt ? Date.parse(offer.dueAt) < Date.now() : offer.date < dayIn(offer.timezone);
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const dayIn = (zone: string) => new Date().toLocaleDateString("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });

export function PlayPlans({ language, userId, questionId, revision, readOnly = false, onOpenCalendar }: Props) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(() => !navigator.onLine);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<{ source: string; ids: string[] } | null>(null);
  const [custom, setCustom] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ source: string; ideaId: string; date: string; time: string } | null>(null);
  const opened = useRef("");
  const refreshWhenReady = useRef(false);
  const requests = useRef(0);
  const writing = useRef(false);
  const timezone = localZone();
  const load = useCallback(async (signal?: AbortSignal) => {
    if (writing.current) { refreshWhenReady.current = true; return; }
    const stamp = ++requests.current;
    const source = opened.current;
    try {
      const result = await relationshipApi<{ plan: Plan | null }>(
        source ? path + "/" + encodeURIComponent(source) + "?language=" + language
          : path + "?language=" + language + (questionId ? "&questionId=" + encodeURIComponent(questionId) : ""),
        { signal },
      );
      if (stamp !== requests.current || signal?.aborted) return;
      if (result.plan?.offer?.status === "pending" || result.plan?.offer?.status === "confirmed") opened.current = result.plan.questionId;
      setPlan(result.plan);
      setError("");
    } catch (caught) {
      if (!signal?.aborted && stamp === requests.current) setError((caught as Error).message);
    } finally { if (!signal?.aborted && stamp === requests.current) setLoading(false); }
  }, [language, questionId]);
  useEffect(() => {
    requests.current += 1;
    opened.current = "";
    setPlan(null);
    setCustom(null);
    setDraft(null);
    setSelection(null);
    setLoading(true);
  }, [questionId, userId]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, revision, userId]);
  useEffect(() => {
    const events = new EventSource("/api/relationship/events");
    const changed = (event: Event) => {
      try {
        const { eventType, objectId } = JSON.parse((event as MessageEvent).data);
        if (eventType === "play.plans.updated" && (!opened.current || objectId === opened.current)) void load();
      } catch { /* Existing visibility also refreshes state. */ }
    };
    const online = () => { setOffline(false); void load(); };
    const disconnected = () => setOffline(true);
    const visible = () => { if (document.visibilityState === "visible" && navigator.onLine) void load(); };
    events.addEventListener("relationship", changed);
    window.addEventListener("online", online);
    window.addEventListener("offline", disconnected);
    document.addEventListener("visibilitychange", visible);
    return () => {
      events.close();
      window.removeEventListener("online", online);
      window.removeEventListener("offline", disconnected);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [load, questionId]);

  const send = async (action: string, data: Record<string, unknown> = {}) => {
    if (!plan || writing.current || readOnly || offline) return false;
    writing.current = true;
    const request = ++requests.current;
    keyboard.hide();
    setBusy(true);
    setError("");
    try {
      const result = await relationshipApi<{ plan: Plan }>(path + "/" + encodeURIComponent(plan.questionId), jsonBody({ action, version: plan.version, language, ...data }));
      if (requests.current === request) {
        opened.current = result.plan.questionId;
        setPlan(result.plan);
      }
      return true;
    } catch (caught) {
      if (requests.current === request) setError((caught as Error).message);
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
      setLoading(false);
      if (refreshWhenReady.current) {
        refreshWhenReady.current = false;
        void load();
      }
    }
  };
  if (!questionId && !plan) return null;

  const unavailable = readOnly || offline || busy;
  const picks = plan && selection?.source === plan.questionId ? selection.ids : plan?.mine || [];
  const ordering = (items: string[]) => [...items].sort().join(",");
  const editing = Boolean(plan && plan.saved && ordering(picks) !== ordering(plan.mine));
  const offer = plan?.offer;
  const activeDraft = plan && draft?.source === plan.questionId ? draft : null;
  const matching = plan?.ideas.filter((idea) => plan.matches.includes(idea.id)) || [];
  const knownTitle = offer && (plan?.ideas.find((idea) => offer.ideaId === idea.id)?.title || offer.title);
  const displayDate = (date: string) => new Date(date + "T12:00:00Z").toLocaleDateString(languageTag(language), { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
  const displayTime = (candidate: Offer) => candidate.dueAt ? new Date(candidate.dueAt).toLocaleString(languageTag(language), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone }) : "";
  const editPicks = (ideas: string[]) => plan && setSelection({ source: plan.questionId, ids: ideas });
  const resetSelection = () => setSelection(null);
  const beginSchedule = (ideaId: string) => plan && setDraft({ source: plan.questionId, ideaId, date: "", time: "" });
  const save = async () => { if (await send("save_picks", { ideaIds: picks })) resetSelection(); };
  const addIdea = async () => { if (custom?.trim() && await send("add_idea", { title: custom })) setCustom(null); };
  const schedule = async () => {
    if (!activeDraft?.date) return;
    if (await send("propose", { date: activeDraft.date, time: activeDraft.time, ideaId: activeDraft.ideaId, timezone })) setDraft(null);
  };
  const openCurrent = () => {
    if (!questionId) return;
    keyboard.hide();
    opened.current = questionId;
    setSelection(null);
    setDraft(null);
    setCustom(null);
    void load();
  };

  return <section className="play-plans" aria-label={t("选个约会", "Make a date", "Planeen una cita")} data-testid="play-plans">
    <p className="play-plans-label"><CalendarBlank size={17} aria-hidden="true" />{t("答完就约一个", "Make a date", "Planeen una cita")}</p>
    {!plan && loading && <p role="status">{t("正在找你们的点子…", "Getting your ideas…", "Buscando sus ideas…")}</p>}
    {offline && <p className="play-plans-status" role="status">{t("你现在离线，联网后继续。", "You're offline. Reconnect to continue.", "Estás sin conexión. Conéctate para seguir.")}</p>}
    {error && <div className="play-plans-status" role="alert">{error} <button type="button" className="play-link" disabled={unavailable} onClick={() => void load()}>{t("刷新", "Refresh", "Actualizar")}</button></div>}

    {plan && offer?.status === "confirmed" && <div className="play-plans-receipt">
      <h2><CheckCircle size={23} weight="fill" aria-hidden="true" />{t("已经加进共同日历", "On your shared calendar", "En su calendario compartido")}</h2>
      <strong>{knownTitle}</strong>
      <time dateTime={offer.dueAt || offer.date}>{offer.time ? displayTime(offer) : displayDate(offer.date)}</time>
      <a className="play-plans-calendar" href={offer.calendarUrl || "/?view=upcoming"} onClick={onOpenCalendar ? (event) => {
        event.preventDefault();
        keyboard.hide();
        onOpenCalendar(offer.calendarUrl || "/?view=upcoming");
      } : undefined}>{t("打开共同日历", "Open shared calendar", "Abrir el calendario compartido")}</a>
    </div>}

    {plan && offer?.status === "pending" && <div className="play-plans-pending">
      <h2>{knownTitle}</h2>
      {plan.questionId !== questionId && <small>{plan.questionTitle}</small>}
      <time dateTime={offer.dueAt || offer.date}>{offer.time ? displayTime(offer) : displayDate(offer.date)}</time>
      {offer.time && offer.timezone !== timezone && <small>{t("提议时的时间", "Time as proposed", "Hora propuesta")} · {offer.date} {offer.time} ({offer.timezone})</small>}
      <p role="status">{ended(offer) ? t("这个时间已经过了。", "That time has passed.", "Esa hora ya pasó.") :
        offer.proposedBy === userId ? t("时间已发给 TA，等你们都确认才进日历。", "You sent this time to your partner. It goes on the calendar after you both agree.", "Enviaste esta hora a tu pareja. Se añade al calendario cuando ambos confirmen.")
          : t("TA 提议这个时间。你确认后就加入共同日历。", "Your partner suggested this time. Confirm to put it on your shared calendar.", "Tu pareja propuso esta hora. Confirma para añadirla al calendario compartido.")}</p>
      <div className="play-actions">
        {offer.proposedBy !== userId && <button type="button" className="play-main" disabled={unavailable || ended(offer)} onClick={() => void send("accept")}>{t("确认并加入日历", "Confirm and add to calendar", "Confirmar y añadir al calendario")}</button>}
        <button type="button" className="play-quiet" disabled={unavailable} onClick={() => void send(offer.proposedBy === userId ? "cancel" : "decline")}>{offer.proposedBy === userId ? t("撤回时间", "Withdraw time", "Retirar la propuesta") : t("这个时间不行", "This time doesn't work", "Esta hora no me viene bien")}</button>
      </div>
    </div>}

    {plan && offer?.status !== "pending" && offer?.status !== "confirmed" && <>
      {offer && <p className="play-plans-status" role="status">{offer.status === "declined" ? t("这个时间没约成，你们可以换一天。", "That time didn't work. You can try another day.", "Esa hora no funcionó. Pueden probar otro día.") :
        offer.status === "removed" ? t("日历里的计划已移除，可以另选时间。", "The calendar entry was removed. You can choose another time.", "Se eliminó del calendario. Pueden elegir otra hora.") :
          t("上一个时间已撤回。", "The previous time was withdrawn.", "Se retiró la hora anterior.")}</p>}
      {activeDraft ? <form className="play-plans-form" onSubmit={(event) => { event.preventDefault(); void schedule(); }}>
        <h2>{plan.ideas.find((idea) => idea.id === activeDraft.ideaId)?.title}</h2>
        <label><span>{t("约在哪一天", "Pick a date", "Elige una fecha")}</span><KeyboardInput type="date" value={activeDraft.date} min={dayIn(timezone)} required disabled={unavailable} onChange={(event) => setDraft({ ...activeDraft, date: event.target.value })} /></label>
        <label><span>{t("几点（可选）", "Time (optional)", "Hora (opcional)")}</span><KeyboardInput type="time" value={activeDraft.time} disabled={unavailable} onChange={(event) => setDraft({ ...activeDraft, time: event.target.value })} /></label>
        <small>{timezone}</small>
        <div className="play-actions"><button type="submit" className="play-main" disabled={unavailable || !activeDraft.date}>{t("把时间发给 TA", "Send the time to your partner", "Enviar la hora a tu pareja")}</button>
          <button type="button" className="play-quiet" disabled={busy} onClick={() => { keyboard.hide(); setDraft(null); }}>{t("返回点子", "Back to ideas", "Volver a las ideas")}</button></div>
      </form> : <>
        <h2>{matching.length ? t("你们俩都想试试", "You both want to try", "A los dos les apetece") : t("今天约点什么？", "What would you like to do?", "¿Qué les apetece hacer?")}</h2>
        {plan.saved && !plan.partnerReady ? <p className="play-plans-status" role="status"><LockKey size={16} aria-hidden="true" />{t("你的选择已保存。等 TA 也选完才一起看。", "Your picks are saved. You'll see what matches after your partner chooses.", "Guardamos tus elecciones. Verán las coincidencias cuando tu pareja elija.")}</p> :
          plan.saved && plan.partnerReady && !matching.length ? <p role="status">{t("这次暂时没选到一起，可以改一改或加自己的点子。", "No matches this time. Change your picks or add an idea.", "Esta vez no coincidieron. Pueden cambiar sus elecciones o añadir una idea.")}</p> :
            !plan.saved && <p>{t("各选几个想做的。双方都选完才看共同选中的。", "Pick anything you'd like. Only shared picks appear once both of you choose.", "Elijan lo que les apetezca. Las coincidencias se muestran cuando ambos eligen.")}</p>}

        {matching.length > 0 && <div className="play-plans-matches">
          {matching.map((idea) => <button className="play-quiet" type="button" key={idea.id} disabled={unavailable || editing} onClick={() => beginSchedule(idea.id)}><CalendarBlank size={18} aria-hidden="true" />{idea.title}</button>)}
        </div>}
        <div className="play-plans-ideas" role="group" aria-label={t("我的选择", "My picks", "Mis elecciones")}>
          {plan.ideas.map((idea) => <button type="button" className="play-plans-idea" key={idea.id} aria-pressed={picks.includes(idea.id)} disabled={unavailable}
            onClick={() => editPicks(picks.includes(idea.id) ? picks.filter((item) => item !== idea.id) : [...picks, idea.id])}>
            <Heart size={18} weight={picks.includes(idea.id) ? "fill" : "regular"} aria-hidden="true" /><span>
              <strong>{idea.title}</strong>{idea.detail && <small>{idea.detail}</small>}
              {idea.fromBoth && <small className="play-plans-from-both"><Sparkle size={13} aria-hidden="true" />{t("你们的答案都提到了这个", "Inspired by both answers", "Inspirado en ambas respuestas")}</small>}
            </span>
          </button>)}
        </div>
        <div className="play-actions">
          <button type="button" className="play-main" disabled={unavailable || (plan.saved && !editing)} onClick={() => void save()}>{picks.length ? t("保存我的选择", "Save my picks", "Guardar mis elecciones") : t("这几个都先跳过", "Skip these ideas", "Omitir estas ideas")}</button>
          {!plan.ideas.some((item) => item.id === "custom") && custom === null && <button type="button" className="play-quiet" disabled={unavailable} onClick={() => setCustom("")}>{t("加个自己的点子", "Add an idea of your own", "Añadir mi propia idea")}</button>}
        </div>
        {custom !== null && <form className="play-plans-form" onSubmit={(event) => { event.preventDefault(); void addIdea(); }}>
          <label><span>{t("加到你们都能看到的点子里", "Add to the ideas you both see", "Añadir a las ideas que ven ambos")}</span><KeyboardInput value={custom} disabled={unavailable} maxLength={80} onChange={(event) => setCustom(event.target.value)} /></label>
          <div className="play-actions">
            <button type="submit" className="play-main" disabled={unavailable || !custom.trim()}>{t("加入点子", "Add idea", "Añadir idea")}</button>
            <button type="button" className="play-quiet" disabled={busy} onClick={() => { keyboard.hide(); setCustom(null); }}>{t("取消", "Cancel", "Cancelar")}</button>
          </div>
        </form>}
      </>}
    </>}
    {plan && questionId && plan.questionId !== questionId && offer?.status !== "pending" && <button type="button" className="play-link" disabled={unavailable} onClick={openCurrent}>{t("看看今天的点子", "See today's ideas", "Ver las ideas de hoy")}</button>}
  </section>;
}
