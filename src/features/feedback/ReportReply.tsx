import { useState } from "react";
import { Flag } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { jsonBody, relationshipApi } from "../relationship/api";
import "./report-reply.css";

export function ReportReply({ channel, conversationId, messageId, language, demoRoom }: { channel?: "me" | "us" | "private-workspace" | "decision"; conversationId?: string; messageId: string; language: Language; demoRoom?: string }) {
  const [state, setState] = useState<"idle" | "confirm" | "sending" | "sent" | "failed">("idle");
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const submit = async () => {
    setState("sending");
    try {
      const path = demoRoom ? `/api/demo/rooms/${encodeURIComponent(demoRoom)}/report` : "/api/feedback/reply";
      await relationshipApi(path, jsonBody({ channel, conversationId, messageId, language }));
      setState("sent");
    } catch { setState("failed"); }
  };
  return <div className="reply-report">
    {state === "sent" ? <span role="status">{t("已提交举报", "Report received", "Denuncia recibida")}</span> :
      state === "idle" ? <button type="button" onClick={() => setState("confirm")}><Flag size={15} />{t("举报这条回复", "Report this reply", "Denunciar esta respuesta")}</button> :
      <><span role="status">{state === "failed" ? t("未能提交，请再试一次。", "Couldn't submit. Try again.", "No se pudo enviar. Reinténtalo.") : t("将这条回复发送给 Pinky 团队审核。", "Send this reply to the Pinky team for review.", "Envía esta respuesta al equipo de Pinky para su revisión.")}</span>
        <button type="button" disabled={state === "sending"} onClick={() => void submit()}>{t("提交举报", "Submit report", "Enviar denuncia")}</button>
        <button type="button" disabled={state === "sending"} onClick={() => setState("idle")}>{t("取消", "Cancel", "Cancelar")}</button></>}
  </div>;
}
