import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, ShareNetwork, UserPlus } from "@phosphor-icons/react";
import type { Pairing } from "../../Prototype";
import { languageTag, localized, type Language } from "../../i18n";
import { BottomSheet, useKeyboard } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";
import "./partner-invite.css";

type InviteProps = {
  userId: string;
  language: Language;
  pairing: Pairing | null;
  onPairingChange: (pairing: Pairing | null) => void;
  onRefreshPairing: () => Promise<void>;
};
type Action = "prepare" | "share" | "copy" | "cancel" | "receipt";
const endpoint = "/api/partner/invitations";

// Keep a successful share/copy separate from rendering a link. If the connection
// drops after the handoff, retry the receipt without opening the share sheet again.
function readReceipt(userId: string) {
  try { return sessionStorage.getItem("ourever:invite-receipt:" + userId) || ""; }
  catch { return ""; }
}

export function usePartnerInvite({ userId, language, pairing, onPairingChange, onRefreshPairing }: InviteProps) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const invitation = pairing?.invitation;
  const [online, setOnline] = useState(() => navigator.onLine);
  const [working, setWorking] = useState<Action | null>(null);
  const [failure, setFailure] = useState<Action | null>(null);
  const [pollFailed, setPollFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [details, setDetails] = useState(false);
  const [receipt, setReceipt] = useState(() => readReceipt(userId));
  const [confirming, setConfirming] = useState(false);
  const [, updateClock] = useState(0);
  const pending = pairing?.status === "pending";
  const cancelled = Boolean(invitation?.cancelledAt);
  const expired = !!invitation && Date.parse(invitation.expiresAt) <= Date.now();
  const usable = !!invitation && !expired && !cancelled;
  const sent = !!invitation && Boolean(invitation.sentAt || invitation.openedAt || receipt === invitation.code);
  // Older clients created the link on demand, without a sent receipt. The owner
  // can still manage that link without having to send it again.
  const canManage = usable && (sent || invitation?.prepared === false);
  const live = useRef(false);
  const locked = useRef(false);
  const polling = useRef(false);
  const inviteUrl = invitation ? new URL("/", location.origin) : null;
  if (inviteUrl && invitation) { inviteUrl.searchParams.set("invite", invitation.code); inviteUrl.searchParams.set("lang", language); }
  const refreshRef = useRef(onRefreshPairing);
  refreshRef.current = onRefreshPairing;
  useEffect(() => {
    live.current = true;
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener("online", changed);
    window.addEventListener("offline", changed);
    return () => {
      live.current = false;
      window.removeEventListener("online", changed);
      window.removeEventListener("offline", changed);
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!navigator.onLine || document.hidden || polling.current || locked.current) return;
    polling.current = true;
    try { await refreshRef.current(); if (live.current) setPollFailed(false); }
    catch { if (live.current) setPollFailed(true); }
    finally { polling.current = false; }
  }, []);

  useEffect(() => {
    if (!pending || cancelled || expired || !online) return;
    const timer = window.setInterval(refresh, sent ? 4000 : 30000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [pending, cancelled, expired, sent, online, refresh]);

  useEffect(() => {
    if (!invitation || cancelled || expired) return;
    const timer = window.setTimeout(() => updateClock(value => value + 1), Math.max(1, Date.parse(invitation.expiresAt) - Date.now() + 1));
    return () => window.clearTimeout(timer);
  }, [invitation?.expiresAt, cancelled, expired]);

  const prepare = useCallback(async (background = false) => {
    if (locked.current || !navigator.onLine) return;
    locked.current = true;
    setFailure(null); setCopied(false); setWorking("prepare");
    try {
      const { pairing: next } = await relationshipApi<{ pairing: Pairing }>(endpoint, jsonBody(background ? { prepare: true } : {}));
      if (live.current) onPairingChange(next);
    } catch { if (live.current) setFailure("prepare"); }
    finally { locked.current = false; if (live.current) setWorking(null); }
  }, [onPairingChange]);

  // Make the first share synchronous with its tap, even in WebKit. A reserved
  // code is neither a sent event nor a waiting state.
  useEffect(() => {
    if (!pairing && online && !failure) void prepare(true);
  }, [pairing, online, failure, prepare]);

  const saveReceipt = (code: string) => {
    setReceipt(code);
    try {
      const key = "ourever:invite-receipt:" + userId;
      if (code) sessionStorage.setItem(key, code); else sessionStorage.removeItem(key);
    } catch { /* An in-memory receipt can still be retried. */ }
  };

  const act = async (action: Action) => {
    keyboard.hide();
    if (action === "prepare" || !invitation || !inviteUrl) return prepare();
    if (locked.current || !navigator.onLine || !usable) return;
    if (Date.parse(invitation.expiresAt) <= Date.now()) { updateClock(value => value + 1); return; }
    locked.current = true;
    setWorking(action); setFailure(null);
    if (action !== "receipt") setCopied(false);
    let attempted = action;
    try {
      const path = endpoint + "/" + encodeURIComponent(invitation.code);
      if (action === "cancel") {
        const { pairing: next } = await relationshipApi<{ pairing: Pairing }>(path, { method: "DELETE" });
        if (live.current) { onPairingChange(next); setConfirming(false); saveReceipt(""); }
        return;
      }
      if (action !== "receipt") {
        const text = t("想和你在 Ourever 开个只属于我们俩的小空间。来吗？", "Want to make a little space for just us on Ourever?", "¿Creamos un espacio solo para los dos en Ourever?");
        let useCopy = action === "copy" || !navigator.share;
        if (!useCopy) {
          try { await navigator.share({ title: "Ourever", text, url: inviteUrl.href }); }
          catch (error) {
            if ((error as Error).name === "AbortError") return;
            useCopy = true;
          }
        }
        if (useCopy) {
          await navigator.clipboard.writeText(action === "copy" ? inviteUrl.href : text + "\n" + inviteUrl.href);
          if (live.current) setCopied(true);
        }
        if (!live.current) return;
        saveReceipt(invitation.code);
      }
      attempted = "receipt";
      const { pairing: next } = await relationshipApi<{ pairing: Pairing }>(path + "/sent", jsonBody({}));
      if (live.current) { onPairingChange(next); saveReceipt(""); }
    } catch { if (live.current) setFailure(attempted); }
    finally { locked.current = false; if (live.current) setWorking(null); }
  };

  useEffect(() => {
    if (online && usable && receipt && receipt === invitation?.code && !working && !failure) void act("receipt");
  }, [receipt, invitation?.code, usable, online, working, failure]);

  const title = cancelled ? t("邀请已取消", "Invite cancelled", "Invitación cancelada")
    : expired ? t("邀请已过期", "Invite expired", "Invitación caducada")
    : sent ? t("等待伴侣加入", "Waiting for your partner", "Esperando a tu pareja")
    : t("邀请你的伴侣", "Invite your partner", "Invita a tu pareja");
  const primary = cancelled || expired ? t("生成新链接", "Create a new link", "Crear un enlace nuevo")
    : sent ? t("再次分享", "Share again", "Compartir de nuevo") : title;
  const loadingText = working === "prepare" ? t("正在准备链接…", "Preparing link…", "Preparando el enlace…")
    : working === "cancel" ? t("正在取消…", "Cancelling…", "Cancelando…")
    : t("正在处理邀请…", "Updating invite…", "Actualizando la invitación…");
  const status = !online ? t("你已离线。联网后可继续邀请。", "You're offline. Reconnect to continue.", "Sin conexión. Vuelve a conectarte para continuar.")
    : failure === "receipt" ? t("链接已准备分享，发送状态尚未保存。", "The link is ready to send. Its sharing status couldn't be saved.", "El enlace está listo para enviar. No se pudo guardar el estado.")
    : failure === "cancel" ? t("未能确认取消结果，请重试。", "Couldn't confirm cancellation. Try again.", "No se pudo confirmar la cancelación. Inténtalo de nuevo.")
    : failure ? t("邀请操作未完成，请重试。", "Couldn't finish this invitation. Try again.", "No se pudo completar la invitación. Inténtalo de nuevo.")
    : pollFailed ? t("暂时无法更新伴侣状态。", "Couldn't refresh your partner's status.", "No se pudo actualizar el estado de tu pareja.")
    : copied ? t("已复制", "Copied", "Copiado") : "";
  const retry = () => {
    if (failure) void act(failure);
    else if (receipt && receipt === invitation?.code && !invitation.sentAt) void act("receipt");
    else void refresh();
  };
  const primaryAction = () => void act(usable ? "share" : "prepare");
  const disabled = !online || !!working || (!invitation && !failure);
  return { t, language, invitation, usable, sent, canManage, cancelled, expired, title, primary, primaryAction, status, retry, failure, pollFailed,
    inviteUrl, disabled, working, loadingText, details, setDetails, confirming, setConfirming, act, copied, receipt };
}

type InviteState = ReturnType<typeof usePartnerInvite>;

function Feedback({ state }: { state: InviteState }) {
  const { status, failure, pollFailed, retry, disabled, t } = state;
  return status ? <div className="partner-invite-feedback"><span role="status">{status}</span>
    {(failure === "share" || failure === "copy") && state.usable && <p className="invite-manual-link">{t("也可以长按复制链接", "Or press and hold to copy the link", "También puedes mantener pulsado para copiar el enlace")}<br /><span>{state.inviteUrl?.href}</span></p>}
    {(failure || pollFailed) && <button type="button" onClick={retry} disabled={disabled}>{t("重试", "Retry", "Reintentar")}</button>}
  </div> : null;
}

export function InvitePanel({ state, onEnterCode }: { state: InviteState; onEnterCode?: () => void }) {
  const { t, invitation, title, primary, primaryAction, working, loadingText, disabled, sent, canManage, usable, confirming, setConfirming, act } = state;
  const time = (value: string) => new Date(value).toLocaleString(languageTag(state.language), { dateStyle: "medium", timeStyle: "short" });
  return <section className="partner-invite-panel" data-testid="conversation-invite" aria-label={title}>
    <h2>{title}</h2>
    {!sent && usable && <p>{t("给 TA 发个链接，就能一起聊天、记下你们的日子。", "Send a link to start your shared chat and keep track of your dates together.", "Envía un enlace para compartir un chat y recordar sus fechas juntos.")}</p>}
    {canManage && invitation && <div className="partner-invite-meta">
      {!invitation.sentAt && <p>{t("创建时间", "Created", "Creada")} <time dateTime={invitation.createdAt}>{time(invitation.createdAt)}</time></p>}
      {invitation.sentAt && <p>{t("分享时间", "Shared", "Compartida")} <time dateTime={invitation.sentAt}>{time(invitation.sentAt)}</time></p>}
      {invitation.openedAt && <p>{t("打开时间", "Opened", "Abierta")} <time dateTime={invitation.openedAt}>{time(invitation.openedAt)}</time></p>}
      <p>{t("过期时间", "Expires", "Caduca")} <time dateTime={invitation.expiresAt}>{time(invitation.expiresAt)}</time></p>
      <p>{t("邀请码", "Invite code", "Código de invitación")} <strong>{invitation.code}</strong></p>
    </div>}
    {(!confirming || !usable) && <div className="partner-invite-actions">
      <button type="button" className="invite-primary" data-testid="share-invite" disabled={disabled} onClick={primaryAction}>
        <ShareNetwork size={18} aria-hidden="true" />{working ? loadingText : primary}
      </button>
      {canManage && <button type="button" disabled={disabled} onClick={() => void act("copy")}><Copy size={17} aria-hidden="true" />{t("复制链接", "Copy link", "Copiar enlace")}</button>}
    </div>}
    {canManage && (confirming ? <div className="partner-invite-confirm" role="group" aria-label={t("确认取消邀请", "Confirm cancellation", "Confirmar cancelación")}>
      <p>{t("取消后，TA 无法再通过这个链接加入。", "Your partner will no longer be able to join with this link.", "Tu pareja ya no podrá unirse con este enlace.")}</p>
      <div className="partner-invite-actions">
        <button type="button" onClick={() => setConfirming(false)}>{t("保留邀请", "Keep invite", "Conservar invitación")}</button>
        <button className="invite-danger" type="button" disabled={disabled} onClick={() => void act("cancel")}>{working === "cancel" ? loadingText : t("确认取消", "Confirm cancellation", "Confirmar cancelación")}</button>
      </div>
    </div> : <button type="button" className="invite-quiet" disabled={disabled} onClick={() => setConfirming(true)}>{t("取消邀请", "Cancel invite", "Cancelar invitación")}</button>)}
    {onEnterCode && !confirming && <button type="button" className="invite-quiet" onClick={onEnterCode} data-testid="enter-partner-code">{t("输入伴侣的邀请码", "Enter partner’s code", "Introducir código de tu pareja")}</button>}
    <Feedback state={state} />
  </section>;
}

export function InviteBar({ state, onEnterCode }: { state: InviteState; onEnterCode: () => void }) {
  const { sent, usable, title, primary, primaryAction, details, setDetails, working, loadingText, disabled, t } = state;
  const waiting = sent && usable;
  return <div className="partner-invite-bar">
    {waiting ? <div className="partner-invite-summary" data-testid="invite-waiting"><strong>{title}</strong>
      <button type="button" onClick={() => setDetails(true)}>{t("查看邀请", "View invite", "Ver invitación")}</button>
    </div> : <button type="button" className="invite-primary" disabled={disabled} onClick={primaryAction} data-testid="empty-invite">
      <UserPlus size={18} aria-hidden="true" />{working ? loadingText : primary}
    </button>}
    {!waiting && state.canManage && <button type="button" onClick={() => setDetails(true)}>{t("管理邀请", "Manage invite", "Gestionar invitación")}</button>}
    {!details && <Feedback state={state} />}
    {details && <BottomSheet open onOpenChange={setDetails} title={t("伴侣邀请", "Partner invite", "Invitación de pareja")}><InvitePanel state={state} onEnterCode={() => { setDetails(false); onEnterCode(); }} /></BottomSheet>}
  </div>;
}

// Shared by first-use (before AI consent) and the conversation home.
export function PartnerInvite(props: InviteProps) {
  const state = usePartnerInvite(props);
  return <InvitePanel state={state} />;
}
