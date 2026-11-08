import { useEffect, useState } from "react";
import { localized, type Language } from "../../i18n";
import { relationshipApi } from "../relationship/api";

type Access = { paired: boolean; facts: { used: number; off: number; together: number }; privateChat: number; us: number; imports: number; photos: number; checkins: number; reminders: number; privateItems: number; sharedByYou: number };

/** Settings → 「Pinky 能看到什么」(founder 11-07, trust you can see): everything Pinky can draw on for you, counted in one place,
 * with where to change it. Counts only; the partner's private things never appear, because they are never yours to see. */
export function AiAccess({ language, onOpen }: { language: Language; onOpen: (page: "profile" | "memory" | "retention" | "summaries") => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [access, setAccess] = useState<Access | null>(null), [error, setError] = useState("");
  useEffect(() => { relationshipApi<Access>("/api/privacy/ai-access").then(setAccess).catch((caught) => setError((caught as Error).message)); }, []);
  if (error) return <p className="settings-error" role="alert">{error}</p>;
  if (!access) return null;
  const row = (label: string, value: string, note: string, page?: "profile" | "memory" | "retention" | "summaries") => {
    const body = <><span className="settings-switch-text"><span className="settings-label">{label}</span><small>{note}</small></span><span className="settings-value">{value}</span></>;
    return page ? <button key={label} type="button" className="settings-row" onClick={() => onOpen(page)}>{body}</button> : <div key={label} className="settings-row">{body}</div>;
  };
  const n = (count: number, zh: string, en: string, es: string) => t(`${count} ${zh}`, `${count} ${en}`, `${count} ${es}`);
  return <>
    <p className="settings-intro" data-testid="ai-access">{t("这些是 Pinky 现在能用来帮你的东西。只算数量，不显示内容；点进去可以改或删。", "This is what Pinky can draw on to help you right now. Counts only, no content; tap a row to change or delete.", "Esto es lo que Pinky puede usar ahora para ayudarte. Solo cantidades, sin contenido; toca una fila para cambiar o borrar.")}</p>
    <section className="settings-group"><h2>{t("只有你和 Pinky", "Only you and Pinky", "Solo tú y Pinky")}</h2><div className="settings-card">
      {row(t("Pinky 记下的你", "What Pinky remembers about you", "Lo que Pinky recuerda de ti"), n(access.facts.used, "条", "items", "datos"), access.facts.off ? t(`另有 ${access.facts.off} 条你设成了 Pinky 不用`, `${access.facts.off} more you set for Pinky not to use`, `${access.facts.off} más que pediste que Pinky no use`) : t("可以改，也可以删", "You can edit or delete them", "Puedes editarlos o borrarlos"), "profile")}
      {row(t("和 Pinky 的私聊", "Your private chat with Pinky", "Tu chat privado con Pinky"), n(access.privateChat, "条消息", "messages", "mensajes"), t("保留多久由你定", "You choose how long it's kept", "Tú eliges cuánto se guarda"), "retention")}
      {row(t("日常记录和心情", "Check-ins and moods", "Registros y ánimo"), n(access.checkins, "条", "entries", "entradas"), t("只有你看得到", "Only you see them", "Solo tú los ves"))}
      {row(t("你的提醒", "Your reminders", "Tus recordatorios"), n(access.reminders, "条", "reminders", "recordatorios"), t("只有你看得到", "Only you see them", "Solo tú los ves"))}
      {row(t("你的私人清单", "Your private lists", "Tus listas privadas"), n(access.privateItems, "项", "items", "elementos"), t("只有你看得到", "Only you see them", "Solo tú los ves"))}
      {row(t("你导入的聊天记录", "Chats you imported", "Chats que importaste"), n(access.imports, "份", "imports", "importaciones"), t("只有你能看；TA 同意后才有一份共享的分析", "Only you can see them; a shared analysis exists only if your partner agrees", "Solo tú los ves; el análisis compartido existe solo si tu pareja acepta"))}
      {row(t("你的照片", "Your photos", "Tus fotos"), n(access.photos, "张", "photos", "fotos"), t("你确认分享的才会进回忆", "Only the ones you share go into Moments", "Solo las que compartes van a Momentos"))}
    </div></section>
    {access.paired && <section className="settings-group"><h2>{t("你们俩", "The two of you", "Ustedes dos")}</h2><div className="settings-card">
      {row(t("“我们俩”的对话", "Your chat in Us", "Su chat en Nosotros"), n(access.us, "条消息", "messages", "mensajes"), t("你们俩和 Pinky 都看得到", "You both and Pinky see it", "Los dos y Pinky lo ven"))}
      {row(t("你们俩都知道的事", "Things you both know", "Lo que saben los dos"), n(access.facts.together, "条", "items", "datos"), t("一起说过或互相分享的", "Said together or shared with each other", "Dicho juntos o compartido"), "profile")}
      {row(t("你确认分享给 TA 的", "What you chose to share", "Lo que elegiste compartir"), n(access.sharedByYou, "次", "times", "veces"), t("每一次都是你点了确认", "Each one was your own tap", "Cada uno fue tu propio toque"), "summaries")}
    </div></section>}
    <p className="settings-note">{t("TA 的私人对话、记录和照片，你看不到，Pinky 也不会拿到“我们俩”里用。语音只在处理时用，不保存录音。", "Your partner's private chats, notes and photos are never shown to you, and Pinky never brings them into Us. Voice is only used while it's processed; no recordings are kept.", "Los chats, notas y fotos privados de tu pareja nunca se te muestran, y Pinky nunca los lleva a Nosotros. La voz solo se usa al procesarla; no se guardan grabaciones.")}</p>
  </>;
}
