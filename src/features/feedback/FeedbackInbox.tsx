import { useCallback, useEffect, useRef, useState } from "react";
import { localized, type Language } from "../../i18n";
import { relationshipApi, jsonBody } from "../relationship/api";

type Sent = {
  id: string; text: string; kind: string | null; status: string; public_note: string | null;
  createdAt: string; updatedAt: string; unread: boolean;
  reward?: { granted_days: number; membership_until: string | null; capped?: boolean } | null;
  attachments?: { index: number; content_type: string; url: string }[];
};

export function FeedbackInbox({ language }: { language: Language }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [items, setItems] = useState<Sent[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState(false);
  const [detail, setDetail] = useState<Sent | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [action, setAction] = useState("");
  const [actionError, setActionError] = useState(false);
  const fetchSeq = useRef(0);
  const selected = useRef("");
  const statuses: Record<string, string> = {
    received: t("已收到", "Received", "Recibido"),
    triaging: t("正在处理", "In progress", "En curso"),
    shipped: t("已修复，请重开 App 再试", "Fixed. Reopen the app and try again.", "Corregido. Vuelve a abrir la app y prueba otra vez."),
    needs_info: t("需要更多信息", "More information needed", "Necesitamos más información"),
    suggestion: t("已记录为建议", "Suggestion recorded", "Sugerencia registrada"),
    wont_fix: t("暂不处理", "No action planned", "Sin cambios previstos"),
    duplicate: t("已合并到相同问题", "Linked to the same issue", "Vinculado al mismo problema"),
    reopened: t("已重新打开，正在处理", "Reopened and in progress", "Reabierto y en curso"),
  };
  const status = (value: string) => statuses[value] || statuses.triaging;
  const rewardText = (item: Sent) => {
    if (!item.reward) return null;
    if (item.reward.capped) return t("本月的反馈奖励已达上限，谢谢你帮忙。", "You’ve reached this month’s feedback reward limit. Thank you for helping.", "Has alcanzado el límite mensual de recompensas por comentarios. Gracias por tu ayuda.");
    const days = item.reward.granted_days;
    if (!days) return null;
    if (days === 1) return t("谢谢你也报告了这个问题，已为你加上 1 天会员。", "Thanks for also reporting this issue. We’ve added 1 day of membership.", "Gracias por avisarnos también de este problema. Hemos añadido 1 día de membresía.");
    return item.status === "shipped"
      ? t(`已修复，送你 ${days} 天会员，谢谢！`, `Fixed! We’ve added ${days} days of membership. Thank you!`, `¡Corregido! Te hemos añadido ${days} días de membresía. ¡Gracias!`)
      : t(`谢谢你的反馈，${days} 天会员已到账。`, `Thanks for your report. We’ve added ${days} days of membership.`, `Gracias por avisarnos. Hemos añadido ${days} días de membresía.`);
  };
  const date = (value: string) => new Date(value).toLocaleString(language === "zh" ? "zh-CN" : language, { dateStyle: "medium", timeStyle: "short" });
  const load = useCallback(async () => {
    const seq = ++fetchSeq.current;
    try {
      const result = await relationshipApi<{ feedback: Sent[] }>("/api/feedback/mine");
      if (seq !== fetchSeq.current) return;
      setItems(result.feedback);
      setFailure(false);
      setDetail((existing) => result.feedback.find((row) => row.id === existing?.id) || null);
    } catch { if (seq === fetchSeq.current) setFailure(true); }
    finally { if (seq === fetchSeq.current) setLoading(false); }
  }, []);
  useEffect(() => {
    const refresh = () => { void load(); };
    refresh();
    window.addEventListener("feedback-updated", refresh);
    window.addEventListener("online", refresh);
    const timer = window.setInterval(() => { if (!document.hidden && navigator.onLine) refresh(); }, 60_000);
    return () => {
      fetchSeq.current++; selected.current = "";
      window.removeEventListener("feedback-updated", refresh);
      window.removeEventListener("online", refresh);
      window.clearInterval(timer);
    };
  }, [load]);
  const open = async (id: string) => {
    setActionError(false); setDeleting(false); setAction(id);
    selected.current = id;
    const path = "/api/feedback/" + encodeURIComponent(id);
    try {
      const { feedback } = await relationshipApi<{ feedback: Sent }>(path);
      if (selected.current !== id) return;
      setDetail(feedback);
      if (feedback.unread) {
        await relationshipApi(path + "/read", jsonBody({ updatedAt: feedback.updatedAt }));
        window.dispatchEvent(new Event("feedback-updated"));
      }
    } catch { if (selected.current === id) setActionError(true); }
    finally { if (selected.current === id) setAction(""); }
  };
  const update = async (method: "delete" | "reopen", id: string) => {
    setAction(id); setActionError(false);
    const path = "/api/feedback/" + encodeURIComponent(id);
    try {
      await relationshipApi(method === "delete" ? path : path + "/reopen", { method: method === "delete" ? "DELETE" : "POST" });
      setDetail(null); selected.current = ""; setDeleting(false);
      window.dispatchEvent(new Event("feedback-updated"));
    } catch { setActionError(true); }
    finally { setAction(""); }
  };
  const retry = t("重试", "Retry", "Reintentar");
  return <section className="feedback-sent">
    <h2>{t("我的反馈", "My feedback", "Mis comentarios")}</h2>
    {loading && <p role="status">{t("正在读取…", "Loading…", "Cargando…")}</p>}
    {failure && <p role="status">{t("暂时无法读取反馈。", "Couldn’t load feedback.", "No se pudieron cargar los comentarios.")} <button type="button" onClick={() => void load()}>{retry}</button></p>}
    {!loading && !failure && !items.length && <p>{t("还没有已提交的反馈。", "No feedback submitted yet.", "Todavía no has enviado comentarios.")}</p>}
    {actionError && <p role="alert">{t("操作未完成，请重试。", "Couldn’t complete this action. Try again.", "No se pudo completar la acción. Inténtalo de nuevo.")}</p>}
    {items.map((item) => {
      const expanded = detail?.id === item.id;
      return <article key={item.id}>
        <button className="feedback-item-toggle" aria-expanded={expanded} type="button" disabled={!!action} onClick={() => {
          if (expanded) { selected.current = ""; setDetail(null); setDeleting(false); }
          else void open(item.id);
        }}>
          <span className="feedback-item-heading"><strong>{status(item.status)}</strong>{item.unread && <span className="feedback-unread">{t("新", "New", "Nuevo")}</span>}
          <time dateTime={item.updatedAt}>{date(item.updatedAt || item.createdAt)}</time></span>
          <span className="feedback-excerpt">{item.text || t("截图", "Screenshot", "Captura")}</span>
          <span className="feedback-toggle-label">{expanded ? t("收起", "Hide details", "Ocultar detalles") : t("查看详情", "View details", "Ver detalles")}</span>
        </button>
        {item.public_note && <p className="feedback-reply"><strong>{t("我们的回复", "Our reply", "Nuestra respuesta")}</strong>{item.public_note}</p>}
        {item.reward && <p className="feedback-reply">{rewardText(item)}</p>}
        {expanded && detail && <div className="feedback-detail">
          <p>{detail.text}</p>
          <small>{t("提交于", "Submitted", "Enviado")} {date(detail.createdAt)}</small>
          {!!detail.attachments?.length && <div className="feedback-detail-shots">{detail.attachments.map(({ index }) =>
            <img key={index} src={`/api/feedback/${encodeURIComponent(item.id)}/attachments/${index}`} loading="lazy" draggable={false}
              alt={t("截图", "Screenshot", "Captura") + " " + (index + 1)} />)}</div>}
          <div className="card-actions">
            {item.status === "shipped" && !deleting && <button type="button" disabled={!!action} onClick={() => void update("reopen", item.id)}>{t("问题还在", "Still broken", "Sigue fallando")}</button>}
            {deleting ? <>
              <button type="button" disabled={!!action} onClick={() => setDeleting(false)}>{t("取消", "Cancel", "Cancelar")}</button>
              <button type="button" disabled={!!action} onClick={() => void update("delete", item.id)}>{t("确认删除", "Confirm deletion", "Confirmar eliminación")}</button>
            </> : <button type="button" disabled={!!action} onClick={() => setDeleting(true)}>{t("删除反馈", "Delete feedback", "Eliminar comentario")}</button>}
          </div>
        </div>}
      </article>;
    })}
  </section>;
}
