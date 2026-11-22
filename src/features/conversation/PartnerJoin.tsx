import { useEffect, useState } from "react";
import { KeyboardInput, useKeyboard } from "../../mobile";
import { localized, type Language } from "../../i18n";
import { accountError, api, forgetInvite, hasInvite, inviteCode, inviteNetworkMessage, retryLabel } from "../../accountApi";
import type { AuthMode, InviteFrame, InvitePreview, Pairing } from "../../Prototype";

// The partner-invitation page (signed out: join or sign in; signed in: accept), moved out of the opening bundle.
type JoinAccount = { pairing: Pairing | null; onJoined: (pairing: Pairing) => void; onBack: () => void };
type InviteLookup = InvitePreview | "missing" | "unavailable";
export function PartnerJoin({ language, onLanguage, account, onAuth, Frame, labels }: {
  language: Language; onLanguage: (value: Language) => void; account?: JoinAccount; onAuth?: (mode: AuthMode) => void;
  Frame: typeof InviteFrame; labels: { inviteCode: string; acceptInvite: string; register: string; login: string };
}) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [code, setCode] = useState(inviteCode);
  const malformedLink = hasInvite() && !inviteCode() && !code;
  const [lookup, setLookup] = useState<{ code: string; value: InviteLookup } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  // Declining asks once more, then closes the invitation for good and lets the inviter know.
  const [declining, setDeclining] = useState<"ask" | "busy" | "done" | null>(null);
  const keyboard = useKeyboard();
  const paired = account?.pairing?.status === "active";
  const own = !!code && account?.pairing?.invitation?.code === code;
  const valid = /^[A-Z0-9]{8}$/.test(code);
  const readPreview = valid && !paired && !own;
  useEffect(() => {
    if (!readPreview) return;
    const request = new AbortController();
    api<{ invitation: InvitePreview }>("/api/partner/invitations/" + code, { signal: request.signal })
      .then(result => { if (!request.signal.aborted) setLookup({ code, value: result.invitation }); })
      .catch(reason => { if (!request.signal.aborted) setLookup({ code, value: reason.status === 404 ? "missing" : "unavailable" }); });
    return () => request.abort();
  }, [code, readPreview, attempt]);
  const preview = lookup?.code === code ? lookup.value : null;
  const retry = () => { setError(""); setLookup(null); setAttempt(value => value + 1); };
  const found = typeof preview === "object" ? preview : null;
  const name = found?.inviterName;
  const loading = readPreview && !preview;
  const unusable = own || declining === "done" || (!valid && (!account || malformedLink)) || preview === "missing" || (!!found && found.status !== "open");
  const title = paired ? t("你已经与伴侣配对", "You’re already paired", "Ya tienes pareja vinculada")
    : name && !unusable ? t("加入" + name + "的共同空间", "Join " + name, "Únete a " + name)
    : t("伴侣邀请", "Partner invitation", "Invitación de pareja");
  const problem = own ? t("这是你自己的邀请。把它发给伴侣，或输入对方发给你的邀请码。", "This is your own invitation. Share it with your partner, or enter their code below.", "Esta es tu invitación. Envíala a tu pareja o escribe aquí su código.")
    : preview === "missing" || (!valid && (!account || malformedLink)) ? t("没有找到这份邀请。请向伴侣索取新链接。", "We couldn’t find that invite. Ask your partner for a new link.", "No encontramos esa invitación. Pide un enlace nuevo a tu pareja.")
    : found?.status === "cancelled" ? t("邀请已被取消。请让伴侣重新发送。", "This invite was cancelled. Ask your partner to send a new one.", "Se canceló esta invitación. Pide a tu pareja que envíe otra.")
    : found?.status === "expired" ? t("邀请已过期。请让伴侣发送新链接。", "This invite has expired. Ask your partner for a new link.", "La invitación caducó. Pide un enlace nuevo a tu pareja.")
    : found?.status === "declined" || declining === "done" ? t("你已婉拒这份邀请，对方会收到通知。", "You declined this invite. They'll be told.", "Rechazaste esta invitación. Se le avisará.")
    : found?.status === "used" ? t("邀请已被使用。已加入可登录原账号，否则请向伴侣索取新链接。", "This invite has already been used. Sign in to the account you joined with, or ask your partner for a new link.", "Esta invitación ya se usó. Entra con la cuenta con la que te uniste o pide un enlace nuevo a tu pareja.") : "";
  const decline = async () => {
    if (declining === "busy") return;
    keyboard.hide(); setDeclining("busy"); setError("");
    try {
      await api("/api/partner/invitations/" + code + "/decline", { method: "POST" });
      forgetInvite(); setDeclining("done");
    } catch (reason) {
      setDeclining("ask");
      setError(reason instanceof TypeError ? inviteNetworkMessage(language) : accountError((reason as Error).message, language));
    }
  };
  const accept = async () => {
    if (!account || joining || found?.status !== "open" || own || paired) return;
    keyboard.hide(); setJoining(true); setError("");
    try {
      const result = await api<{ pairing: Pairing }>("/api/partner/accept", { method: "POST", body: JSON.stringify({ code, language }) });
      account.onJoined(result.pairing);
    } catch (reason) {
      setError(reason instanceof TypeError ? inviteNetworkMessage(language) : accountError((reason as Error).message, language));
      setAttempt(value => value + 1);
    } finally { setJoining(false); }
  };
  return <Frame language={language} onLanguage={onLanguage} title={title} signedOut={!account}>
    {paired ? <>
      <p className="pairing-lead">{t("你已有共同空间。若要与其他人配对，请先在设置中退出当前关系。", "You already share a space with your partner. To pair with someone else, first leave your current relationship in Settings.", "Ya compartes un espacio con tu pareja. Para vincularte con otra persona, sal primero de tu relación actual en Ajustes.")}</p>
      <button className="primary-action" onClick={account!.onBack}>{t("返回我的空间", "Back to my space", "Volver a mi espacio")}</button>
    </> : <>
      {declining !== "done" && found?.status !== "declined" && <p className="pairing-lead">{account ? t("接受后就能一起使用“我们俩”，你们各自的私人对话仍然保密。", "Accept to open your shared chat. Each person’s private conversations stay private.", "Acepta para abrir el chat compartido. Las conversaciones privadas de cada persona seguirán siendo privadas.")
        : t("创建账号或登录，就能加入你们两个人在 Ourever 的共同空间。", "Create an account or sign in to join your partner in your private Ourever space.", "Crea una cuenta o inicia sesión para unirte a tu pareja en su espacio privado de Ourever.")}</p>}
      {account && (!hasInvite() || !valid || unusable || code !== inviteCode()) && <label className="editorial-field code-field"><span>{labels.inviteCode}</span>
        <KeyboardInput value={code} onChange={event => { setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)); setError(""); }} maxLength={8} autoComplete="off" data-testid="invite-code" />
      </label>}
      {loading && <p role="status" aria-live="polite">{t("正在查看邀请…", "Checking invitation…", "Comprobando la invitación…")}</p>}
      {(problem || error || preview === "unavailable") && <p className="form-notice" role="alert">{error || problem || inviteNetworkMessage(language)}</p>}
      {preview === "unavailable" && <button className="primary-action" onClick={retry}>{retryLabel(language)}</button>}
      {declining === "ask" || declining === "busy" ? <>
        <p className="pairing-lead">{t(name ? `婉拒后这份邀请就失效了，${name}会收到通知。` : "婉拒后这份邀请就失效了，对方会收到通知。", `Declining closes this invite${name ? ` and tells ${name}` : " and tells them"}.`, `Al rechazarla, la invitación se cierra${name ? ` y ${name} recibe un aviso` : " y se le avisa"}.`)}</p>
        <button className="primary-action" disabled={declining === "busy"} onClick={() => void decline()} data-testid="invite-decline-confirm">{declining === "busy" ? t("正在婉拒…", "Declining…", "Rechazando…") : t("婉拒邀请", "Decline invite", "Rechazar invitación")}</button>
        <button className="secondary-action" disabled={declining === "busy"} onClick={() => setDeclining(null)}>{t("再想想", "Keep it", "Pensarlo")}</button>
      </> : account ? <>
        {preview !== "unavailable" && !unusable && <button className="primary-action" onClick={() => void accept()} disabled={joining || loading || !valid} data-testid="invite-accept">
          {joining ? t("正在加入…", "Joining…", "Uniéndote…") : labels.acceptInvite}
        </button>}
        <button className="secondary-action" disabled={joining} onClick={() => { keyboard.hide(); account.onBack(); }}>{t("返回我的空间", "Back to my space", "Volver a mi espacio")}</button>
        {found?.status === "open" && !unusable && <button className="auth-switch" disabled={joining} onClick={() => setDeclining("ask")} data-testid="invite-decline">{t("婉拒邀请", "Decline invite", "Rechazar invitación")}</button>}
      </> : <>
        <button className="primary-action" onClick={() => onAuth?.("register")} data-testid="invite-join">{labels.register}</button>
        <button className="secondary-action" onClick={() => onAuth?.("login")} data-testid="invite-sign-in">{labels.login}</button>
        {found?.status === "open" && !unusable && <button className="auth-switch" onClick={() => setDeclining("ask")} data-testid="invite-decline">{t("婉拒邀请", "Decline invite", "Rechazar invitación")}</button>}
      </>}
    </>}
  </Frame>;
}
