import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, DotsThree, Flag, ThumbsDown } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { jsonBody, relationshipApi } from "../relationship/api";
import "./report-reply.css";

type Intent = "unhelpful" | "report";
type Delivery = "idle" | "sending" | "sent" | "failed";
async function copyPhotos(ids: string[]) {
  // WebKit requires clipboard.write in the tap handler. Resolve image data inside the promised item.
  const images = Promise.all(ids.map(async id => {
    const response = await fetch("/api/photos/" + encodeURIComponent(id), { credentials: "same-origin" });
    if (!response.ok) throw new Error("Photo unavailable");
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }));
  return navigator.clipboard.write([new ClipboardItem({
    "text/html": images.then(urls => new Blob([urls.map(url => '<img src="' + url + '">').join("")], { type: "text/html" })),
  })]);
}

type MessageActions = { photoIds?: string[]; canReport?: boolean; onRegenerate?: () => void; onUnsend?: () => void };
type Props = MessageActions & { channel?: "me" | "us" | "private-workspace" | "decision"; conversationId?: string; messageId: string; language: Language; demoRoom?: string; messageMenu?: boolean; replyText?: string };

export function ReportReply({ channel, conversationId, messageId, language, demoRoom, messageMenu = false, replyText, ...actions }: Props) {
  const send = (intent?: Intent) => relationshipApi(demoRoom ? `/api/demo/rooms/${encodeURIComponent(demoRoom)}/report` : "/api/feedback/reply",
    jsonBody({ channel, conversationId, messageId, language, ...(intent ? { intent } : {}) }));
  return messageMenu && !demoRoom
    ? <ReplyFeedbackMenu key={messageId} language={language} replyText={replyText} send={send} {...actions} />
    : <InlineReport language={language} send={send} />;
}

function InlineReport({ language, send }: { language: Language; send: () => Promise<unknown> }) {
  const [state, setState] = useState<"idle" | "confirm" | "sending" | "sent" | "failed">("idle");
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const submit = async () => {
    setState("sending");
    try { await send(); setState("sent"); } catch { setState("failed"); }
  };
  return <div className="reply-report">
    {state === "sent" ? <span role="status">{t("已提交举报", "Report received", "Denuncia recibida")}</span> :
      state === "idle" ? <button type="button" onClick={() => setState("confirm")}><Flag size={15} />{t("举报这条回复", "Report this reply", "Denunciar esta respuesta")}</button> :
        <><span role="status">{state === "failed" ? t("未能提交，请再试一次。", "Couldn't submit. Try again.", "No se pudo enviar. Reinténtalo.") : t("将这条回复发送给 Ourever 团队审核。", "Send this reply to the Ourever team for review.", "Envía esta respuesta al equipo de Ourever para su revisión.")}</span>
          <button type="button" disabled={state === "sending"} onClick={() => void submit()}>{t("提交举报", "Submit report", "Enviar denuncia")}</button>
          <button type="button" disabled={state === "sending"} onClick={() => setState("idle")}>{t("取消", "Cancel", "Cancelar")}</button></>}
  </div>;
}

function ReplyFeedbackMenu({ language, replyText, send, photoIds, canReport = true, onRegenerate, onUnsend }: MessageActions & { language: Language; replyText?: string; send: (intent: Intent) => Promise<unknown> }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [view, setView] = useState<"closed" | "menu" | "confirm" | "unsend">("closed");
  const [delivery, setDelivery] = useState<Record<Intent, Delivery>>({ unhelpful: "idle", report: "idle" });
  const claimed = useRef(new Set<Intent>());
  const initialItem = useRef<Intent>("unhelpful");
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  // The bubble holding this menu contains its float (conversation.css .has-report-menu), marked here rather than with a
  // :has() that restyled the whole thread on every new bubble (QA round 5).
  // After every render: a re-render of the bubble that changes its className would drop the mark.
  useLayoutEffect(() => { root.current?.parentElement?.classList.add("has-report-menu"); });
  useLayoutEffect(() => { const parent = root.current?.parentElement; return () => parent?.classList.remove("has-report-menu"); }, []);
  const unhelpful = useRef<HTMLButtonElement>(null), report = useRef<HTMLButtonElement>(null), confirm = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const [copyStatus, setCopyStatus] = useState("");
  const close = () => { setView("closed"); trigger.current?.focus(); };
  const open = (first: Intent) => { initialItem.current = first; setView("menu"); };
  useEffect(() => {
    if (view === "closed") return;
    if (view === "menu") (initialItem.current === "report" && canReport ? report.current : root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]'))?.focus();
    else confirm.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setView("closed");
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [view]);

  const submit = async (intent: Intent) => {
    if (claimed.current.has(intent)) return;
    claimed.current.add(intent);
    setDelivery(old => ({ ...old, [intent]: "sending" }));
    try {
      await send(intent);
      setDelivery(old => ({ ...old, [intent]: "sent" }));
      if (intent === "report") {
        initialItem.current = "report";
        setView(old => old === "confirm" ? "menu" : old);
      }
    } catch {
      claimed.current.delete(intent);
      setDelivery(old => ({ ...old, [intent]: "failed" }));
    }
  };
  const actions = t("消息操作", "Message actions", "Acciones del mensaje");
  const sending = t("正在提交…", "Sending…", "Enviando…");
  const characters = view === "confirm" && replyText ? Array.from(replyText.trim()) : [];
  const excerpt = characters.length > 160 ? characters.slice(0, 160).join("") + "…" : characters.join("");
  const receipt = (intent: Intent) => {
    if (delivery[intent] === "failed") return intent === "report"
      ? t("举报未能提交，请重试。", "The report couldn’t be sent. Try again.", "No se pudo enviar la denuncia. Inténtalo de nuevo.")
      : t("反馈未能提交，请再点一次重试。", "Feedback couldn’t be sent. Select it again to retry.", "No se pudo enviar el comentario. Vuelve a seleccionarlo.");
    if (delivery[intent] === "sending") return sending;
    if (delivery[intent] !== "sent") return "";
    return intent === "report" ? t("已提交举报", "Report received", "Denuncia recibida") : t("已收到你的反馈", "Feedback received", "Comentario recibido");
  };
  return <div ref={root} className="reply-report reply-report-menu"
    onBlur={(event) => { if (view !== "closed" && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setView("closed"); }}
    onKeyDown={(event) => {
      if (event.key === "Escape" && view !== "closed") { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
    <button ref={trigger} type="button" className="reply-report-trigger" aria-label={actions} title={actions}
      aria-haspopup="menu" aria-expanded={view !== "closed"} aria-controls={view === "closed" ? undefined : panelId}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); open(event.key === "ArrowUp" ? "report" : "unhelpful"); }
      }}
      onClick={() => view === "closed" ? open("unhelpful") : close()}><DotsThree size={22} weight="bold" aria-hidden="true" /></button>
    {view === "menu" && <div className="reply-report-panel">
      <div id={panelId} role="menu" aria-label={actions} className="reply-report-options" onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}>
        {(replyText || Boolean(photoIds?.length)) && <button role="menuitem" tabIndex={-1} type="button" onClick={async () => {
          try { if (replyText) await navigator.clipboard.writeText(replyText); else await copyPhotos(photoIds!); setCopyStatus(t("已复制", "Copied", "Copiado")); }
          catch { setCopyStatus(t("长按文字即可复制", "Touch and hold the text to copy it.", "Mantén pulsada la burbuja para copiar el texto.")); }
        }}>{t("复制", "Copy", "Copiar")}</button>}
        {onRegenerate && <button role="menuitem" tabIndex={-1} type="button" onClick={() => { close(); onRegenerate(); }}>{t("重新生成", "Regenerate", "Volver a generar")}</button>}
        {onUnsend && <button role="menuitem" tabIndex={-1} type="button" onClick={() => setView("unsend")}>{t("撤回", "Undo send", "Anular envío")}</button>}
        {canReport && <><button ref={unhelpful} role="menuitem" tabIndex={-1} type="button" aria-disabled={delivery.unhelpful === "sending" || delivery.unhelpful === "sent"} onClick={() => void submit("unhelpful")}>
          {delivery.unhelpful === "sent" ? <Check size={16} /> : <ThumbsDown size={16} />}{t("这条回复没帮到我", "This reply wasn’t helpful", "Esta respuesta no me ayudó")}
        </button>
        <button ref={report} role="menuitem" tabIndex={-1} type="button" aria-disabled={delivery.report === "sending" || delivery.report === "sent"} onClick={() => { if (!claimed.current.has("report")) setView("confirm"); }}>
          {delivery.report === "sent" ? <Check size={16} /> : <Flag size={16} />}{t("举报不当内容", "Report inappropriate content", "Denunciar contenido inapropiado")}
        </button>
        </>}
      </div>
      <span role="status" className="reply-report-receipt">{[copyStatus, receipt("unhelpful"), receipt("report")].filter(Boolean).join(" · ")}</span>
    </div>}
    {view === "unsend" && <div id={panelId} className="reply-report-panel is-confirming">
      <p>{t("从你们两人的对话中撤回这条消息？", "Remove this message for both of you?", "¿Retirar este mensaje para ambos?")}</p>
      <button ref={confirm} type="button" onClick={() => { close(); onUnsend?.(); }}>{t("确认撤回", "Undo send", "Anular envío")}</button>
      <button type="button" onClick={close}>{t("保留", "Keep message", "Conservar mensaje")}</button>
    </div>}
    {view === "confirm" && <div id={panelId} className="reply-report-panel is-confirming">
      <p id={panelId + "-notice"}>{t("提交后，Ourever 团队会收到这条回复的可见文字，用于审核。只包含这一条回复。", "The Ourever team will receive the visible text of this reply for review. Only this reply is included.", "El equipo de Ourever recibirá el texto visible de esta respuesta para revisarlo. Solo se incluye esta respuesta.")}</p>
      {excerpt && <blockquote>{excerpt}</blockquote>}
      <span role="status" className="reply-report-receipt">{receipt("report")}</span>
      <button ref={confirm} type="button" aria-describedby={panelId + "-notice"} aria-disabled={delivery.report === "sending"} onClick={() => void submit("report")}>{t("提交举报", "Submit report", "Enviar denuncia")}</button>
      <button type="button" onClick={close}>{delivery.report === "sending" ? t("收起", "Close", "Cerrar") : t("取消", "Cancel", "Cancelar")}</button>
    </div>}
  </div>;
}
