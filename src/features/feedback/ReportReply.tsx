import { useEffect, useId, useRef, useState } from "react";
import { DotsThree, Flag } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { jsonBody, relationshipApi } from "../relationship/api";
import "./report-reply.css";

export function ReportReply({ channel, conversationId, messageId, language, demoRoom, messageMenu = false }: { channel?: "me" | "us" | "private-workspace" | "decision"; conversationId?: string; messageId: string; language: Language; demoRoom?: string; messageMenu?: boolean }) {
  const [state, setState] = useState<"idle" | "menu" | "confirm" | "sending" | "sent" | "failed">("idle");
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuItem = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const status = useRef<HTMLSpanElement>(null);
  const dismiss = () => { setState("idle"); trigger.current?.focus(); };

  useEffect(() => {
    if (!messageMenu) return;
    if (state === "menu") menuItem.current?.focus();
    if (state === "confirm" || state === "failed") confirmButton.current?.focus();
    if (state === "sent") status.current?.focus();
    if (state !== "menu") return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setState("idle");
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [messageMenu, state]);

  const submit = async () => {
    setState("sending");
    try {
      const path = demoRoom ? `/api/demo/rooms/${encodeURIComponent(demoRoom)}/report` : "/api/feedback/reply";
      await relationshipApi(path, jsonBody({ channel, conversationId, messageId, language }));
      setState("sent");
    } catch { setState("failed"); }
  };
  const received = <span role="status" ref={status} tabIndex={messageMenu ? -1 : undefined}>{t("已提交举报", "Report received", "Denuncia recibida")}</span>;
  const confirmation = <>
    <span role="status">{state === "failed" ? t("未能提交，请再试一次。", "Couldn't submit. Try again.", "No se pudo enviar. Reinténtalo.") : t("将这条回复发送给 Ourever 团队审核。", "Send this reply to the Ourever team for review.", "Envía esta respuesta al equipo de Ourever para su revisión.")}</span>
    <button ref={confirmButton} type="button" disabled={state === "sending"} onClick={() => void submit()}>{t("提交举报", "Submit report", "Enviar denuncia")}</button>
    <button type="button" disabled={state === "sending"} onClick={dismiss}>{t("取消", "Cancel", "Cancelar")}</button>
  </>;
  if (!messageMenu) return <div className="reply-report">
    {state === "sent" ? received : state === "idle" ? <button type="button" onClick={() => setState("confirm")}><Flag size={15} />{t("举报这条回复", "Report this reply", "Denunciar esta respuesta")}</button> : confirmation}
  </div>;

  const actions = t("消息操作", "Message actions", "Acciones del mensaje");
  return <div ref={root} className="reply-report reply-report-menu"
    onBlur={(event) => { if (state === "menu" && !event.currentTarget.contains(event.relatedTarget)) setState("idle"); }}
    onKeyDown={(event) => {
      if (event.key === "Escape" && (state === "menu" || state === "confirm" || state === "failed")) {
        event.preventDefault(); event.stopPropagation(); dismiss();
      }
    }}>
    {state === "sent" ? received : <>
      <button ref={trigger} type="button" className="reply-report-trigger" aria-label={actions} title={actions}
        aria-haspopup="menu" aria-expanded={state === "menu"} aria-controls={state === "menu" ? panelId : undefined} disabled={state === "sending"}
        onKeyDown={(event) => {
          if (state === "idle" && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setState("menu"); }
        }}
        onClick={() => state === "idle" ? setState("menu") : dismiss()}><DotsThree size={22} weight="bold" aria-hidden="true" /></button>
      {state === "menu" ? <div id={panelId} role="menu" aria-label={actions} className="reply-report-panel"
        onKeyDown={(event) => { if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) event.preventDefault(); }}>
        <button ref={menuItem} role="menuitem" tabIndex={-1} type="button" onClick={() => setState("confirm")}><Flag size={16} aria-hidden="true" />{t("举报", "Report", "Denunciar")}</button>
      </div> : state !== "idle" && <div className="reply-report-panel is-confirming">{confirmation}</div>}
    </>}
  </div>;
}
