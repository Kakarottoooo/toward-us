import { useState } from "react";
import { LockKey } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { KeyboardInput, useKeyboard } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";
import "./privacy.css";

// Opened from the emailed link (/?reset=<token>). The token is single-use and expires after 30 minutes.
export function PasswordResetForm({ language, token, onDone }: { language: Language; token: string; onDone: () => void }) {
  const [password, setPassword] = useState(""); const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(""); const [finished, setFinished] = useState(false);
  const keyboard = useKeyboard(); const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const submit = async () => {
    if (password !== repeat) { setNotice(t("两次输入的密码不同。", "The passwords do not match.", "Las contraseñas no coinciden.")); return; }
    setBusy(true); setNotice(""); keyboard.hide();
    try { await relationshipApi("/api/auth/reset", jsonBody({ token, password, language })); setFinished(true); }
    catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); setPassword(""); setRepeat(""); }
  };
  return <section className="privacy-workspace account-recovery" aria-labelledby="reset-title">
    <header><LockKey size={24} /><h2 id="reset-title">{t("设置新密码", "Choose a new password", "Elige una nueva contraseña")}</h2></header>
    {finished ? <div className="privacy-success" role="status"><h3>{t("密码已更新", "Password updated", "Contraseña actualizada")}</h3><p>{t("所有旧登录都已退出。现在可以用新密码登录。", "All previous sessions are signed out. You can now sign in with your new password.", "Todas las sesiones anteriores se cerraron. Ya puedes entrar con tu nueva contraseña.")}</p><button onClick={() => { keyboard.hide(); onDone(); }}>{t("登录", "Sign in", "Iniciar sesión")}</button></div> : <>
      <p>{t("请为你的账号设置一个新密码。", "Set a new password for your account.", "Define una nueva contraseña para tu cuenta.")}</p>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label><span>{t("新密码（10–128个字符）", "New password (10–128 characters)", "Nueva contraseña (10–128 caracteres)")}</span><KeyboardInput type="password" required autoComplete="new-password" minLength={10} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} onBlur={() => keyboard.hide()} /></label>
        <label><span>{t("再次输入新密码", "Repeat new password", "Repite la nueva contraseña")}</span><KeyboardInput type="password" required autoComplete="new-password" minLength={10} maxLength={128} value={repeat} onChange={(event) => setRepeat(event.target.value)} onBlur={() => keyboard.hide()} /></label>
        <button disabled={busy || password.length < 10 || !repeat} type="submit">{busy ? t("正在更新…", "Updating…", "Actualizando…") : t("更新密码", "Update password", "Cambiar contraseña")}</button>
      </form>
      {notice && <p className="privacy-notice" role="alert">{notice}</p>}
    </>}
  </section>;
}
