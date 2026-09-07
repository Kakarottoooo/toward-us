import { Bell, BellSlash, Plus } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { languageTag, localized, type Language } from "../../i18n";
import { KeyboardInput } from "../../mobile";
import "./reminders.css";

export type ReminderTarget = { kind: "issue" | "milestone" | "outcome" | "checkin" | "reminders" | "plans" | "checkins"; id?: string };
type Settings = { enabled: boolean; configured: boolean; publicKey: string; timezone: string; devices: Array<{ id: string; createdAt: string }> };
type Delivery = { id: string; status: string; attempts: number; acceptedAt?: string; lastErrorCode?: string };
type Reminder = { id: string; title?: string; dueAt?: string; frequency?: string; timezone?: string; status: string; target?: ReminderTarget; deliveries: Delivery[] };
class ReminderError extends Error { constructor(public code: string) { super(code); } }
function safeTimeZone(value: string) { try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return value; } catch { return "UTC"; } }
async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok) throw new ReminderError(result.code || "reminder_unavailable");
  return result;
}

export function RemindersPanel({ language, initialTarget, initialTitle = "", onChanged }: { language: Language; initialTarget?: ReminderTarget; initialTitle?: string; onChanged?: () => Promise<void> }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [title, setTitle] = useState(initialTitle);
  const [localDateTime, setLocalDateTime] = useState("");
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [frequency, setFrequency] = useState("once");
  const [targetKind, setTargetKind] = useState<ReminderTarget["kind"]>(initialTarget?.kind || "reminders");
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const text = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const load = async () => { const [nextSettings, result] = await Promise.all([api<Settings>("/reminder-settings"), api<{ reminders: Reminder[] }>("/reminders")]); setSettings(nextSettings); setReminders(result.reminders); };
  useEffect(() => { void load().catch(() => setNotice(localized(language, "暂时无法读取提醒，请稍后重试。", "Could not load reminders. Try again shortly.", "No se pudieron cargar los recordatorios. Inténtalo de nuevo."))); }, [language]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("reminder");
    if (id && reminders.some((item) => item.id === id)) document.getElementById(`reminder-${id}`)?.scrollIntoView({ block: "nearest" });
  }, [reminders]);
  const errorText = (error: unknown) => {
    const code = error instanceof ReminderError ? error.code : "reminder_unavailable";
    if (code === "nonexistent_local_time") return text("这个时间因夏令时调整不存在，请选择其他时间。", "This time does not exist because the clocks change. Choose another time.", "Esta hora no existe por el cambio de horario. Elige otra.");
    if (code === "invalid_subscription") return text("这个浏览器的推送服务暂不支持，请尝试 Chrome、Firefox 或 Safari。", "This browser's push provider is not supported. Try Chrome, Firefox or Safari.", "El servicio de notificaciones de este navegador no está admitido. Prueba Chrome, Firefox o Safari.");
    if (code === "subscription_expired") return text("浏览器订阅已失效，请重新连接通知后重试。", "The browser subscription expired. Reconnect notifications and retry.", "La suscripción del navegador caducó. Reconecta las notificaciones y reintenta.");
    if (code === "reminder_disabled") return text("请先开启这条提醒和浏览器通知。", "Enable this reminder and browser notifications first.", "Activa primero este recordatorio y las notificaciones.");
    if (code === "invalid_reminder") return text("请填写名称、有效时区和未来两年内的提醒时间。", "Enter a name, valid time zone and a future time within two years.", "Indica un nombre, una zona horaria válida y una fecha futura dentro de dos años.");
    if (code === "push_not_configured") return text("推送服务还未配置，提醒可先保存。", "Push is not configured yet. You can still save reminders.", "Las notificaciones aún no están configuradas. Puedes guardar recordatorios.");
    if (code === "no_failed_delivery") return text("没有需要重试的失败投递。", "There are no failed deliveries to retry.", "No hay envíos fallidos que reintentar.");
    return text("操作未完成，请检查连接后重试。", "The action could not be completed. Check your connection and retry.", "No se pudo completar la acción. Comprueba la conexión y reintenta.");
  };
  const perform = async (operation: () => Promise<unknown>) => { setBusy(true); setNotice(""); try { await operation(); await load(); await onChanged?.(); } catch (error) { setNotice(errorText(error)); } finally { setBusy(false); } };
  const connect = async () => {
    if (!settings?.configured) return;
    if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) { setNotice(text("当前浏览器不支持后台通知。iPhone/iPad 请将网页添加到主屏幕后打开。", "Background notifications are unavailable. On iPhone/iPad, add this site to the Home Screen and open it there.", "Las notificaciones en segundo plano no están disponibles. En iPhone/iPad, añade el sitio a la pantalla de inicio y ábrelo desde allí.")); return; }
    setBusy(true); setNotice("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setNotice(text("未获得通知权限。提醒仍会保存；你可以在浏览器设置中允许通知。", "Notification permission was not granted. Reminders remain saved; you can allow notifications in browser settings.", "No se concedió permiso. Tus recordatorios siguen guardados; puedes permitir notificaciones en los ajustes del navegador.")); return; }
      const registration = await navigator.serviceWorker.register("/toward-us-sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const bytes = Uint8Array.from(atob(settings.publicKey.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(settings.publicKey.length / 4) * 4, "=")), (character) => character.charCodeAt(0));
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
      const device = await api<{ id: string }>("/push-subscriptions", "POST", subscription.toJSON());
      localStorage.setItem("toward-us-push-device", device.id);
      await api("/reminder-settings", "PATCH", { enabled: true, timezone, language });
      await load();
      setNotice(text("此浏览器已连接。你可以选择提醒时间。", "This browser is connected. Choose when to be reminded.", "Este navegador está conectado. Elige cuándo recibir el recordatorio."));
    } catch (error) { setNotice(errorText(error)); } finally { setBusy(false); }
  };
  const save = () => perform(async () => {
    const body = { title, localDateTime, timezone, frequency, target: initialTarget || { kind: targetKind } };
    await api(editing ? `/reminders/${editing.id}` : "/reminders", editing ? "PATCH" : "POST", body);
    setTitle(""); setLocalDateTime(""); setEditing(null);
  });
  const statusText = (status: string) => ({
    pending: text("待发送", "Waiting to send", "Pendiente de envío"), processing: text("正在请求投递", "Requesting delivery", "Solicitando envío"),
    accepted: text("推送服务已接受", "Accepted by push service", "Aceptado por el servicio"), retry: text("发送失败，将自动重试", "Failed; retry scheduled", "Falló; se reintentará"),
    failed: text("发送失败", "Delivery failed", "Envío fallido"), cancelled: text("已取消", "Cancelled", "Cancelado"),
  }[status] || text("待发送", "Waiting to send", "Pendiente de envío"));
  const edit = (reminder: Reminder) => {
    setEditing(reminder); setTitle(reminder.title || ""); setFrequency(reminder.frequency || "once"); setTimezone(reminder.timezone || timezone);
    if (reminder.dueAt) {
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: safeTimeZone(reminder.timezone || timezone), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(reminder.dueAt)).map(({ type, value }) => [type, value]));
      setLocalDateTime(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`);
    }
  };
  return <section className="relationship-feature reminders-feature" aria-labelledby="reminders-title">
    <header><div><Bell size={23} /><h2 id="reminders-title">{text("我的提醒", "My reminders", "Mis recordatorios")}</h2></div><p>{text("给计划、复盘或一句关心留个时间。提醒名称只对你可见，锁屏通知不会显示内容。", "Make time for a plan, a review or a caring moment. Reminder names stay private and never appear on the lock screen.", "Haz espacio para un plan, una revisión o un gesto de cariño. Los nombres son privados y no aparecen en la pantalla bloqueada.")}</p></header>
    <div className="reminders-settings">
      <p>{settings ? settings.enabled && settings.devices.length ? text("浏览器通知已开启", "Browser notifications are on", "Notificaciones del navegador activadas") : text("浏览器通知未连接或已关闭", "Browser notifications are disconnected or off", "Notificaciones desconectadas o desactivadas") : text("正在读取提醒…", "Loading reminders…", "Cargando recordatorios…")}</p>
      <div className="row-actions"><button type="button" onClick={() => void connect()} disabled={busy || !settings?.configured}>{text("连接此浏览器通知", "Connect this browser", "Conectar este navegador")}</button>
        {settings?.enabled && <button type="button" disabled={busy} onClick={() => void perform(() => api("/reminder-settings", "PATCH", { enabled: false, timezone, language }))}><BellSlash size={16} />{text("关闭所有提醒通知", "Turn off all reminder notifications", "Desactivar todas las notificaciones")}</button>}
        {settings && !settings.enabled && settings.devices.length > 0 && settings.configured && <button type="button" disabled={busy} onClick={() => void perform(() => api("/reminder-settings", "PATCH", { enabled: true, timezone, language }))}>{text("重新开启通知", "Turn notifications back on", "Reactivar notificaciones")}</button>}
      </div>
      {settings && !settings.configured && <p>{text("推送服务尚未配置，你可以先保存提醒。", "Push is not configured yet. You can save reminders now.", "Las notificaciones aún no están configuradas. Puedes guardar recordatorios.")}</p>}
      <small>{text("提醒会尽力在所选时间后发送，后台调度和设备离线可能造成延迟。服务接受投递不代表设备已显示或本人已读。已开始投递的通知无法撤回。", "Reminders are sent on a best-effort basis after the chosen time. Scheduling or offline devices may cause delays. Provider acceptance does not confirm display or reading. Notifications already in flight cannot be recalled.", "Los recordatorios se envían cuando es posible después de la hora elegida. La programación o los dispositivos sin conexión pueden causar retrasos. La aceptación no confirma que se hayan mostrado o leído. Los envíos en curso no se pueden retirar.")}</small>
      {settings && settings.devices.length > 0 && <details><summary>{text("管理已连接浏览器", "Manage connected browsers", "Gestionar navegadores conectados")}</summary>{settings.devices.map((device, index) => <div className="reminders-device" key={device.id}><span>{text("浏览器", "Browser", "Navegador")} {index + 1} · {new Date(device.createdAt).toLocaleDateString(languageTag(language))}</span><button type="button" disabled={busy} onClick={() => void perform(async () => { await api(`/push-subscriptions/${device.id}`, "DELETE"); if (localStorage.getItem("toward-us-push-device") === device.id) { const registration = await navigator.serviceWorker?.getRegistration("/"); await (await registration?.pushManager.getSubscription())?.unsubscribe(); localStorage.removeItem("toward-us-push-device"); } })}>{text("断开", "Disconnect", "Desconectar")}</button></div>)}</details>}
    </div>
    {notice && <p role="status" className="relationship-notice">{notice}</p>}
    <form className="relationship-form reminders-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label><span>{text("提醒自己什么", "What to remind yourself about", "Qué quieres recordar")}</span><KeyboardInput value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required /></label>
      <label><span>{text("当地日期与时间", "Local date and time", "Fecha y hora locales")}</span><KeyboardInput type="datetime-local" value={localDateTime} onChange={(event) => setLocalDateTime(event.target.value)} required /></label>
      <label><span>{text("时区", "Time zone", "Zona horaria")}</span><KeyboardInput value={timezone} onChange={(event) => setTimezone(event.target.value)} maxLength={80} required /></label>
      <label><span>{text("重复", "Repeat", "Repetir")}</span><select value={frequency} onChange={(event) => setFrequency(event.target.value)}><option value="once">{text("仅一次", "Once", "Una vez")}</option><option value="weekly">{text("每周同一时间", "Weekly at the same local time", "Cada semana a la misma hora local")}</option></select></label>
      {!initialTarget && !editing && <label><span>{text("打开后前往", "Open to", "Abrir en")}</span><select value={targetKind} onChange={(event) => setTargetKind(event.target.value as ReminderTarget["kind"])}><option value="reminders">{text("这条提醒", "This reminder", "Este recordatorio")}</option><option value="plans">{text("共同计划", "Shared plans", "Planes compartidos")}</option><option value="checkins">{text("关心与好时刻", "Care and good moments", "Cariño y buenos momentos")}</option></select></label>}
      <div className="row-actions"><button type="submit" disabled={busy || !title.trim() || !localDateTime}><Plus size={16} />{editing ? text("保存时间修改", "Save changes", "Guardar cambios") : text("保存私人提醒", "Save private reminder", "Guardar recordatorio privado")}</button>{editing && <button type="button" disabled={busy} onClick={() => { setEditing(null); setTitle(""); setLocalDateTime(""); }}>{text("取消修改", "Cancel edit", "Cancelar edición")}</button>}</div>
      <small className="reminders-time-note">{text("每周提醒保留所选当地时间。夏令时跳过的时间会顺延，重复的时间取第一次。", "Weekly reminders keep the chosen local time. Clock-change gaps move forward; repeated times use the first occurrence.", "Los recordatorios semanales mantienen la hora local. Los huecos del cambio horario se adelantan; las horas repetidas usan la primera aparición.")}</small>
    </form>
    <div className="relationship-rows reminders-list">{reminders.length ? reminders.map((reminder) => <article key={reminder.id} id={`reminder-${reminder.id}`}>
      <div><strong>{reminder.title || text("计划提醒", "Plan reminder", "Recordatorio de plan")}</strong><span>{reminder.dueAt ? new Date(reminder.dueAt).toLocaleString(languageTag(language), { timeZone: safeTimeZone(reminder.timezone || timezone) }) : text("尚未选择时间", "Time not chosen", "Hora sin elegir")} · {reminder.timezone || timezone} · {reminder.frequency === "weekly" ? text("每周", "Weekly", "Semanal") : text("一次", "Once", "Una vez")}</span></div>
      <p>{reminder.status === "paused" ? text("已暂停", "Paused", "En pausa") : reminder.status === "cancelled" ? text("来源不可用，已取消", "Cancelled: source unavailable", "Cancelado: origen no disponible") : reminder.deliveries[0] ? statusText(reminder.deliveries[0].status) : text("已保存，待发送", "Saved, waiting to send", "Guardado, pendiente de envío")}</p>
      <div className="row-actions"><button type="button" disabled={busy || reminder.status === "cancelled"} onClick={() => edit(reminder)}>{text("修改时间", "Change time", "Cambiar hora")}</button><button type="button" disabled={busy || reminder.status === "cancelled"} onClick={() => void perform(() => api(`/reminders/${reminder.id}`, "PATCH", { enabled: reminder.status !== "active" }))}>{reminder.status === "active" ? text("暂停", "Pause", "Pausar") : text("开启", "Enable", "Activar")}</button>
        {reminder.deliveries.some((delivery) => ["failed", "retry"].includes(delivery.status)) && <button type="button" disabled={busy || !settings?.enabled} onClick={() => void perform(() => api(`/reminders/${reminder.id}/retry`, "POST", {}))}>{text("重试失败投递", "Retry failed delivery", "Reintentar envío fallido")}</button>}
      </div>
    </article>) : <p className="relationship-empty">{text("还没有提醒。可以先给下一次关心留个时间。", "No reminders yet. Make time for your next caring moment.", "Aún no hay recordatorios. Reserva un momento para expresar cariño.")}</p>}</div>
  </section>;
}
