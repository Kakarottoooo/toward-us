import { useEffect, useRef, useState } from "react";
import { EnvelopeSimple, Key, SpinnerGap } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { KeyboardInput, useKeyboard } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";
import "./privacy.css";

export function AccountRecovery({ language, onBack, onRecovered }: { language: Language; onBack: () => void; onRecovered: () => void }) {
  const [email, setEmail] = useState(""); const [recoveryCode, setRecoveryCode] = useState("");
  const [password, setPassword] = useState(""); const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(""); const [recovered, setRecovered] = useState(false);
  const [linkEmail, setLinkEmail] = useState(""); const [linkBusy, setLinkBusy] = useState(false); const [linkSent, setLinkSent] = useState(false); const [linkNotice, setLinkNotice] = useState("");
  const sending = useRef(false);
  const [nextSend, setNextSend] = useState({ address: "", at: 0 });
  const [now, setNow] = useState(Date.now);
  const address = linkEmail.trim().toLowerCase();
  const remaining = address === nextSend.address ? Math.max(0, Math.ceil((nextSend.at - now) / 1000)) : 0;
  useEffect(() => {
    if (nextSend.at <= Date.now()) return;
    const timer = window.setInterval(() => {
      const time = Date.now(); setNow(time);
      if (time >= nextSend.at) clearInterval(timer);
    }, 500);
    return () => clearInterval(timer);
  }, [nextSend]);
  const keyboard = useKeyboard(); const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const submit = async () => {
    if (password !== repeat) { setNotice(t("两次输入的密码不同。", "The passwords do not match.", "Las contraseñas no coinciden.")); return; }
    setBusy(true); setNotice(""); keyboard.hide();
    try { await relationshipApi("/api/auth/recover", jsonBody({ email, recoveryCode, password, language })); setPassword(""); setRepeat(""); setRecoveryCode(""); setRecovered(true); }
    catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  };
  const sendLink = async () => {
    if (sending.current || (address === nextSend.address && Date.now() < nextSend.at)) return;
    sending.current = true;
    setLinkBusy(true); setLinkNotice(""); keyboard.hide();
    const cooldown = () => { const at = Date.now(); setNow(at); setNextSend({ address, at: at + 30_000 }); };
    try { await relationshipApi("/api/auth/reset-request", jsonBody({ email: address, language })); cooldown(); setLinkSent(true); }
    catch (error) { if ((error as { status?: number }).status === 429) cooldown(); setLinkNotice((error as Error).message); }
    finally { sending.current = false; setLinkBusy(false); }
  };
  const sendLabel = linkBusy ? t("正在发送…", "Sending…", "Enviando…") : remaining ? t(`${remaining} 秒后重发`, `Resend in ${remaining}s`, `Reenviar en ${remaining} s`) : linkSent ? t("重新发送链接", "Resend link", "Reenviar enlace") : t("发送重设链接", "Send reset link", "Enviar enlace");
  return <section className="privacy-workspace account-recovery" aria-labelledby="recovery-title">
    <header><Key size={24} /><h2 id="recovery-title">{t("找回你的账号", "Recover your account", "Recupera tu cuenta")}</h2></header>
    {recovered ? <div className="privacy-success" role="status"><h3>{t("密码已更新", "Password updated", "Contraseña actualizada")}</h3><p>{t("所有旧登录已失效，这个恢复码也已用完。用新密码登录后，可在隐私设置生成新的恢复码。", "All previous sessions are signed out, and this recovery code is used. Sign in with your new password, then generate a new code in Privacy settings.", "Todas las sesiones anteriores se cerraron y este código ya se utilizó. Inicia sesión con tu nueva contraseña y genera otro código en Privacidad.")}</p><button onClick={onRecovered}>{t("使用新密码登录", "Sign in with new password", "Entrar con la nueva contraseña")}</button></div> : <>
      <div className="reset-link">
        <h3><EnvelopeSimple size={20} /> {t("给我发重设链接", "Send me a reset link", "Envíame un enlace para restablecer")}</h3>
        <form onSubmit={(event) => { event.preventDefault(); void sendLink(); }}>
          {linkSent ? <p className="privacy-success" role="status">{t(`如果有账号使用 ${address}，我们已发送重设链接。请也看看垃圾邮件，可能要几分钟才到。链接 30 分钟内有效。`, `If an account uses ${address}, we sent a link. Check spam; it can take a few minutes. The link works for 30 minutes.`, `Si una cuenta usa ${address}, enviamos un enlace. Revisa el correo no deseado; puede tardar unos minutos. El enlace dura 30 minutos.`)}</p> :
            <label><span>{t("注册邮箱", "Account email", "Correo de la cuenta")}</span><KeyboardInput type="email" disabled={linkBusy} required autoComplete="email" maxLength={254} value={linkEmail} onChange={(event) => setLinkEmail(event.target.value)} onBlur={() => keyboard.hide()} /></label>}
          <button disabled={linkBusy || !!remaining || !address} type="submit" aria-busy={linkBusy}>{linkBusy && <SpinnerGap className="signin-spinner" aria-hidden="true" />} {sendLabel}</button>
          {linkSent && <button type="button" className="privacy-quiet" disabled={linkBusy} onClick={() => { setLinkSent(false); setLinkNotice(""); }}>{t("更改邮箱地址", "Change email address", "Cambiar dirección de correo")}</button>}
        </form>
        {linkNotice && <p className="privacy-notice" role="alert">{linkNotice}</p>}
      </div>
      <h3 className="recovery-code-heading"><Key size={20} /> {t("我有恢复码", "I have a recovery code", "Tengo un código de recuperación")}</h3>
      <p>{t("输入你之前保存在安全位置的一次性恢复码。", "Use the one-time recovery code you saved earlier.", "Usa el código de recuperación de un solo uso que guardaste antes.")}</p>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label><span>{t("注册邮箱", "Account email", "Correo de la cuenta")}</span><KeyboardInput type="email" required autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} onBlur={() => keyboard.hide()} /></label>
        <label><span>{t("一次性恢复码", "One-time recovery code", "Código de recuperación de un solo uso")}</span><KeyboardInput type="text" required autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={80} value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} onBlur={() => keyboard.hide()} /></label>
        <label><span>{t("新密码（10–128个字符）", "New password (10–128 characters)", "Nueva contraseña (10–128 caracteres)")}</span><KeyboardInput type="password" required autoComplete="new-password" minLength={10} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} onBlur={() => keyboard.hide()} /></label>
        <label><span>{t("再次输入新密码", "Repeat new password", "Repite la nueva contraseña")}</span><KeyboardInput type="password" required autoComplete="new-password" minLength={10} maxLength={128} value={repeat} onChange={(event) => setRepeat(event.target.value)} onBlur={() => keyboard.hide()} /></label>
        <button disabled={busy || !email.trim() || !recoveryCode.trim() || password.length < 10 || !repeat} type="submit">{busy ? t("正在验证…", "Verifying…", "Verificando…") : t("验证恢复码并更新密码", "Verify code and update password", "Verificar código y cambiar contraseña")}</button>
      </form>
      <button className="privacy-quiet" disabled={busy} onClick={() => { keyboard.hide(); setPassword(""); setRepeat(""); setRecoveryCode(""); onBack(); }}>{t("返回登录", "Back to sign in", "Volver al inicio de sesión")}</button>
      {notice && <p className="privacy-notice" role="alert">{notice}</p>}
      {/* QA round 4 P8: no code and no mailbox left? The support page has the address to write to. */}
      <button type="button" className="privacy-quiet" onClick={() => { keyboard.hide(); location.assign(`/support?lang=${language}`); }} data-testid="recovery-support">{t("联系客服", "Contact support", "Contactar con soporte")}</button>
    </>}
  </section>;
}
