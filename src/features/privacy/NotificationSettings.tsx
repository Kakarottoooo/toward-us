import { useEffect, useState, type ReactNode } from "react";
import { Bell, ChatsCircle, Clock, MoonStars, Sparkle } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { relationshipApi } from "../relationship/api";
import { disableNativePush, enableNativePush, inNativeApp, nativePermission, nativePushAvailable, nativePushRegistered, type NativeSettings } from "../reminders/nativePush";
import { enableWebPush, thisBrowserConnected, webPushSupport } from "../reminders/webPush";

type Notify = { messages: boolean; pinky: boolean; reminders: boolean; quiet: boolean };
type Settings = NativeSettings & { dailyQuestionsEnabled?: boolean; notify: Notify; configured: boolean; nativeConfigured?: boolean; nativeEnabled?: boolean; enabled: boolean; devices: Array<{ id: string }> };

/** Settings → Notifications: this phone on or off, then which kinds of news to hear and a quiet night. */
export function NotificationSettings({ language }: { language: Language }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const load = () => relationshipApi<Settings>("/api/reminder-settings").then(setSettings).catch((error) => setNotice((error as Error).message));
  useEffect(() => { void load(); }, []);
  const nativeApp = inNativeApp();
  const [permission, setPermission] = useState<string>();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void nativePermission().then(setPermission); };
    refresh(); document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);
  const ready = nativeApp ? nativePushAvailable(settings) : settings?.configured;
  // In a browser or installed web app, "on" means this browser itself receives the pushes.
  const on = nativeApp ? Boolean(permission === "granted" && settings?.nativeEnabled && nativePushRegistered()) : Boolean(settings?.enabled && thisBrowserConnected(settings?.devices));
  const web = nativeApp ? null : webPushSupport();
  const connect = async () => {
    // Web push asks for permission straight from this tap (Safari only prompts inside a user gesture).
    const pending = nativeApp ? enableNativePush() : enableWebPush({ timezone, language });
    setBusy(true); setNotice("");
    const result = await pending;
    if (nativeApp && result === "registered") {
      try { await relationshipApi("/api/reminder-settings", { method: "PATCH", body: JSON.stringify({ enabled: true, timezone, language }) }); }
      catch (error) { setNotice((error as Error).message); }
    }
    setPermission(await nativePermission()); await load(); setBusy(false);
    if (result === "denied") setNotice(nativeApp ? t("没有拿到通知权限。可以在手机的“设置 → Ourever → 通知”里打开。", "Notifications weren't allowed. You can turn them on in your phone's Settings → Ourever → Notifications.", "No se permitieron las notificaciones. Puedes activarlas en Ajustes → Ourever → Notificaciones.") : t("没有拿到通知权限。可以在浏览器或手机设置里允许 Ourever 发通知。", "Notifications weren't allowed. You can allow them for Ourever in your browser or phone settings.", "No se permitieron las notificaciones. Puedes permitirlas para Ourever en los ajustes del navegador o del teléfono."));
    else if (result === "failed" || result === "unsupported" || result === "off") setNotice(t("这次没连上通知，请稍后再试。", "Notifications couldn't be connected this time. Please try again.", "No se pudieron conectar las notificaciones. Inténtalo de nuevo."));
  };
  const disconnect = async () => {
    setBusy(true); setNotice("");
    try { await disableNativePush(true); await load(); }
    catch { setNotice(t("未能关闭，请重试。", "Couldn’t turn off notifications. Try again.", "No se pudieron desactivar. Inténtalo de nuevo.")); }
    finally { setBusy(false); }
  };
  const valueFor = (key: keyof Notify | "dailyQuestions") => key === "dailyQuestions" ? settings?.dailyQuestionsEnabled ?? settings?.notify.messages : settings?.notify[key];
  const toggle = async (key: keyof Notify | "dailyQuestions") => {
    if (!settings) return;
    const next = !valueFor(key);
    setBusy(true);
    try { setSettings(await relationshipApi<Settings>("/api/reminder-settings/notify", { method: "PATCH", body: JSON.stringify({ [key]: next, timezone }) })); }
    catch (error) { setNotice((error as Error).message); void load(); } finally { setBusy(false); }
  };
  const row = (key: keyof Notify | "dailyQuestions", icon: ReactNode, label: string, hint: string) => <label key={key} className="settings-row settings-switch-row"><span className={`settings-icon tone-${key === "quiet" ? "gray" : key === "pinky" ? "pink" : key === "reminders" ? "blue" : "green"}`}>{icon}</span><span className="settings-switch-text"><span className="settings-label">{label}</span><small>{hint}</small></span><input type="checkbox" role="switch" className="settings-switch" checked={Boolean(valueFor(key))} disabled={!settings || busy} onChange={() => void toggle(key)} /></label>;
  return <>
    <section className="settings-group"><div className="settings-card">
      <div className="settings-row"><span className="settings-icon tone-red"><Bell size={18} weight="bold" /></span><span className="settings-label">{t("这台手机的通知", "Notifications on this phone", "Notificaciones en este teléfono")}</span><span className="settings-value">{!settings ? "" : !ready ? t("还没开通", "Not available yet", "Aún no disponible") : on ? t("已打开", "On", "Activadas") : t("已关闭", "Off", "Desactivadas")}</span></div>
      {settings && ready && nativeApp && !on && <p className="settings-note">{permission === "denied" ? t("在系统设置中允许 Ourever 发送通知后，回到这里开启。", "Allow Ourever notifications in system Settings, then return here.", "Permite las notificaciones de Ourever en Ajustes y vuelve aquí.") : t("手机可提醒你查看伴侣的消息、每日一问和到期提醒。你可以分别关闭这些通知。", "Get partner messages, daily questions and reminders on this phone. Choose each type below.", "Recibe mensajes de tu pareja, preguntas diarias y recordatorios. Elige cada tipo abajo.")}</p>}
      {settings && ready && nativeApp && on && <button type="button" className="settings-row settings-action" disabled={busy} onClick={() => void disconnect()}>{t("关闭这台手机的通知", "Turn off notifications on this phone", "Desactivar las notificaciones en este teléfono")}</button>}
      {settings && ready && !on && permission !== "denied" && (nativeApp || web === "ready") && <button type="button" className="settings-row settings-action" disabled={busy} onClick={() => void connect()}>{t("打开通知", "Turn on notifications", "Activar notificaciones")}</button>}
    </div>
    {settings && ready && !on && web === "install" && <p className="settings-note">{t("在 iPhone 上，先用 Safari 的“分享 → 添加到主屏幕”把 Ourever 放到主屏幕，再从主屏幕打开它，就能在这里打开通知（需要 iOS 16.4 或更新）。", "On iPhone, first add Ourever to your Home Screen (Safari's Share → Add to Home Screen), open it from there, and turn notifications on here (iOS 16.4 or later).", "En iPhone, primero añade Ourever a la pantalla de inicio (Compartir → Añadir a pantalla de inicio en Safari), ábrela desde allí y activa aquí las notificaciones (iOS 16.4 o posterior).")}</p>}
    {settings && !ready && <p className="settings-note">{t("当前无法向这台设备推送。提醒到点时仍会出现在 Ourever 的“只有我”里，重复的提醒照常进到下一次。", "Push delivery is unavailable on this device. When a reminder comes due it still shows in Just me in Ourever, and repeating reminders move on to their next time.", "Las notificaciones no están disponibles en este dispositivo. Cuando llega la hora, el recordatorio aparece en Solo yo dentro de Ourever, y los recordatorios repetidos pasan a la siguiente vez.")}</p>}
    </section>
    <section className="settings-group"><h2>{t("通知我", "Tell me about", "Avísame de")}</h2><div className="settings-card">
      {row("messages", <ChatsCircle size={18} weight="bold" />, t("伴侣消息", "Partner messages", "Mensajes de tu pareja"), t("我们俩的新消息与互动", "New messages and activities in Us", "Mensajes y actividades en Nosotros"))}
      {row("dailyQuestions", <ChatsCircle size={18} weight="bold" />, t("每日一问", "Daily question", "Pregunta diaria"), t("有新问题时通知我", "Notify me when a new question is ready", "Avísame cuando haya una pregunta nueva"))}
      {row("pinky", <Sparkle size={18} weight="bold" />, t("Ourever 的惊喜", "Ourever's surprises", "Sorpresas de Ourever"), t("回顾卡、往年的今天、小家伙长大（默认关）", "Recap cards, on this day, your little one growing (off by default)", "Tarjetas de recuerdos, un día como hoy, su pequeño creciendo (apagado por defecto)"))}
      {row("reminders", <Clock size={18} weight="bold" />, t("提醒和到期的约定", "Reminders and due promises", "Recordatorios y acuerdos que vencen"), t("你设的提醒、纪念日、该复盘的约定", "Your reminders, special dates, reviews", "Tus recordatorios, fechas, revisiones"))}
    </div><p className="settings-note notification-preview-note" data-testid="notification-preview-note">{t("每日一问等问题会写在通知里，可能出现在锁屏上。想保留通知但隐藏内容，请在手机或浏览器的通知设置里关闭预览。", "Questions, including the daily question, appear in notifications and may show on your lock screen. To keep alerts but hide their content, turn off previews in your phone or browser notification settings.", "Las preguntas, incluida la diaria, aparecen en las notificaciones y pueden verse en la pantalla bloqueada. Para recibir avisos sin mostrar su contenido, desactiva las vistas previas en los ajustes de notificaciones del teléfono o navegador.")}</p></section>
    <section className="settings-group"><div className="settings-card">
      {row("quiet", <MoonStars size={18} weight="bold" />, t("夜间免打扰", "Quiet nights", "Noches tranquilas"), t("22:00–8:00 只推你设的提醒", "10 pm–8 am: only your reminders", "22:00–8:00: solo tus recordatorios"))}
    </div></section>
    {notice && <p className="settings-notice" role="status">{notice}</p>}
  </>;
}
