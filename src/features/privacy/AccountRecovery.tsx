import { useState } from "react";
import { Key } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { KeyboardInput, useKeyboard } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";
import "./privacy.css";

export function AccountRecovery({ language, onBack, onRecovered }: { language: Language; onBack: () => void; onRecovered: () => void }) {
  const [email, setEmail] = useState(""); const [recoveryCode, setRecoveryCode] = useState("");
  const [password, setPassword] = useState(""); const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(""); const [recovered, setRecovered] = useState(false);
  const keyboard = useKeyboard(); const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const submit = async () => {
    if (password !== repeat) { setNotice(t("两次输入的密码不同。", "The passwords do not match.", "Las contraseñas no coinciden.")); return; }
    setBusy(true); setNotice(""); keyboard.hide();
    try { await relationshipApi("/api/auth/recover", jsonBody({ email, recoveryCode, password, language })); setRecovered(true); }
    catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); setPassword(""); setRepeat(""); setRecoveryCode(""); }
  };
  return <section className="privacy-workspace account-recovery" aria-labelledby="recovery-title">
    <header><Key size={24} /><h2 id="recovery-title">{t("找回你的账号", "Recover your account", "Recupera tu cuenta")}</h2></header>
    {recovered ? <div className="privacy-success" role="status"><h3>{t("密码已更新", "Password updated", "Contraseña actualizada")}</h3><p>{t("所有旧登录已失效，这个恢复码也已用完。用新密码登录后，可在隐私设置生成新的恢复码。", "All previous sessions are signed out, and this recovery code is used. Sign in with your new password, then generate a new code in Privacy settings.", "Todas las sesiones anteriores se cerraron y este código ya se utilizó. Inicia sesión con tu nueva contraseña y genera otro código en Privacidad.")}</p><button onClick={onRecovered}>{t("使用新密码登录", "Sign in with new password", "Entrar con la nueva contraseña")}</button></div> : <>
      <p>{t("输入你之前保存在安全位置的一次性恢复码。目前尚未开通邮箱找回；如果没有恢复码，这个页面无法重设密码。", "Use the one-time recovery code you saved earlier. Email recovery is not available yet; this page cannot reset your password without a recovery code.", "Usa el código de recuperación que guardaste antes. La recuperación por correo aún no está disponible; sin un código, esta página no puede restablecer tu contraseña.")}</p>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label><span>{t("注册邮箱", "Account email", "Correo de la cuenta")}</span><KeyboardInput type="email" required autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} onBlur={() => keyboard.hide()} /></label>
        <label><span>{t("一次性恢复码", "One-time recovery code", "Código de recuperación de un solo uso")}</span><KeyboardInput type="password" required autoComplete="off" spellCheck={false} maxLength={80} value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} onBlur={() => keyboard.hide()} /></label>
        <label><span>{t("新密码（10–128个字符）", "New password (10–128 characters)", "Nueva contraseña (10–128 caracteres)")}</span><KeyboardInput type="password" required autoComplete="new-password" minLength={10} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} onBlur={() => keyboard.hide()} /></label>
        <label><span>{t("再次输入新密码", "Repeat new password", "Repite la nueva contraseña")}</span><KeyboardInput type="password" required autoComplete="new-password" minLength={10} maxLength={128} value={repeat} onChange={(event) => setRepeat(event.target.value)} onBlur={() => keyboard.hide()} /></label>
        <button disabled={busy || !email.trim() || !recoveryCode.trim() || password.length < 10 || !repeat} type="submit">{busy ? t("正在验证…", "Verifying…", "Verificando…") : t("验证恢复码并更新密码", "Verify code and update password", "Verificar código y cambiar contraseña")}</button>
      </form>
      <button className="privacy-quiet" disabled={busy} onClick={() => { keyboard.hide(); setPassword(""); setRepeat(""); setRecoveryCode(""); onBack(); }}>{t("返回登录", "Back to sign in", "Volver al inicio de sesión")}</button>
      {notice && <p className="privacy-notice" role="alert">{notice}</p>}
    </>}
  </section>;
}
