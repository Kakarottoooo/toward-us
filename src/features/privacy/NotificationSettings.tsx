import { useEffect, useState, type ReactNode } from "react";
import { Bell, ChatsCircle, Clock, MoonStars, Sparkle } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { jsonBody, relationshipApi } from "../relationship/api";
import { enableNativePush, nativePushPlugin, nativePushRegistered } from "../reminders/nativePush";

type Notify = { messages: boolean; pinky: boolean; reminders: boolean; quiet: boolean };
type Settings = { notify: Notify; configured: boolean; nativeConfigured?: boolean; nativeEnabled?: boolean; enabled: boolean; devices: unknown[] };

/** Settings → Notifications: this phone on or off, then which kinds of news to hear and a quiet night. */
export function NotificationSettings({ language }: { language: Language }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const load = () => relationshipApi<Settings>("/api/reminder-settings").then(setSettings).catch((error) => setNotice((error as Error).message));
  useEffect(() => { void load(); }, []);
  const nativeApp = Boolean(nativePushPlugin());
  const ready = nativeApp ? settings?.nativeConfigured : settings?.configured;
  const on = nativeApp ? Boolean(settings?.nativeEnabled && nativePushRegistered()) : Boolean(settings?.enabled && settings?.devices.length);
  const connect = async () => {
    setBusy(true); setNotice("");
    const result = await enableNativePush({ force: true });
    if (result === "registered") await relationshipApi("/api/reminder-settings", { method: "PATCH", body: JSON.stringify({ enabled: true, timezone, language }) }).catch(() => {});
    await load(); setBusy(false);
    if (result === "denied") setNotice(t("没有拿到通知权限。可以在手机的“设置 → Pinky → 通知”里打开。", "Notifications weren't allowed. You can turn them on in your phone's Settings → Pinky → Notifications.", "No se permitieron las notificaciones. Puedes activarlas en Ajustes → Pinky → Notificaciones."));
  };
  const toggle = async (key: keyof Notify) => {
    if (!settings) return;
    const next = { ...settings.notify, [key]: !settings.notify[key] };
    setSettings({ ...settings, notify: next });
    try { setSettings(await relationshipApi<Settings>("/api/reminder-settings/notify", { method: "PATCH", body: JSON.stringify({ [key]: next[key], timezone }) })); }
    catch (error) { setNotice((error as Error).message); void load(); }
  };
  const row = (key: keyof Notify, icon: ReactNode, label: string, hint: string) => <label key={key} className="settings-row settings-switch-row"><span className={`settings-icon tone-${key === "quiet" ? "gray" : key === "pinky" ? "pink" : key === "reminders" ? "blue" : "green"}`}>{icon}</span><span className="settings-switch-text"><span className="settings-label">{label}</span><small>{hint}</small></span><input type="checkbox" role="switch" className="settings-switch" checked={Boolean(settings?.notify[key])} disabled={!settings} onChange={() => void toggle(key)} /></label>;
  return <>
    <section className="settings-group"><div className="settings-card">
      <div className="settings-row"><span className="settings-icon tone-red"><Bell size={18} weight="bold" /></span><span className="settings-label">{t("这台手机的通知", "Notifications on this phone", "Notificaciones en este teléfono")}</span><span className="settings-value">{!settings ? "" : !ready ? t("还没开通", "Not available yet", "Aún no disponible") : on ? t("已打开", "On", "Activadas") : t("已关闭", "Off", "Desactivadas")}</span></div>
      {settings && ready && !on && nativeApp && <button type="button" className="settings-row settings-action" disabled={busy} onClick={() => void connect()}>{t("打开通知", "Turn on notifications", "Activar notificaciones")}</button>}
    </div>
    {settings && !ready && <p className="settings-note">{t("推送服务正式上线后就能用；这里的选择现在就会记住。", "Push notifications arrive once the service is live; your choices here are saved now.", "Las notificaciones llegarán cuando el servicio esté activo; tus preferencias ya se guardan.")}</p>}
    </section>
    <section className="settings-group"><h2>{t("通知我", "Tell me about", "Avísame de")}</h2><div className="settings-card">
      {row("messages", <ChatsCircle size={18} weight="bold" />, t("“我们俩”里的新消息", "New messages in Us", "Mensajes nuevos en Nosotros"), t("TA 或 Pinky 在“我们俩”里说了话", "When your partner or Pinky writes in Us", "Cuando tu pareja o Pinky escriben en Nosotros"))}
      {row("pinky", <Sparkle size={18} weight="bold" />, t("Pinky 的惊喜", "Pinky's surprises", "Sorpresas de Pinky"), t("回顾卡、往年的今天", "Recap cards, on this day", "Tarjetas de recuerdos, un día como hoy"))}
      {row("reminders", <Clock size={18} weight="bold" />, t("提醒和到期的约定", "Reminders and due promises", "Recordatorios y acuerdos que vencen"), t("你设的提醒、纪念日、该复盘的约定", "Your reminders, special dates, reviews", "Tus recordatorios, fechas, revisiones"))}
    </div></section>
    <section className="settings-group"><div className="settings-card">
      {row("quiet", <MoonStars size={18} weight="bold" />, t("夜间免打扰", "Quiet nights", "Noches tranquilas"), t("22:00–8:00 只推你设的提醒", "10 pm–8 am: only your reminders", "22:00–8:00: solo tus recordatorios"))}
    </div></section>
    {notice && <p className="settings-notice" role="status">{notice}</p>}
  </>;
}
