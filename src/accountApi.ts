// Account and invitation helpers shared by the opening screens and the on-demand partner-invitation page.
import { inInterfaceLanguage, localized, apiErrorText, currentLanguage, type Language } from "./i18n";

export function retryLabel(language: Language) { return localized(language, "重试", "Try again", "Reintentar"); }
export function inviteNetworkMessage(language: Language) {
  return localized(language, "暂时无法连接 Ourever。请检查网络后重试。", "Can’t reach Ourever. Check your connection and try again.", "No se pudo conectar con Ourever. Revisa tu conexión y vuelve a intentarlo.");
}

// Keep only the current tab's explicit join intent across authentication and password recovery.
const inviteIntentKey = "ourever.partner-invite";
function linkedInvite(): string | null {
  const params = new URLSearchParams(location.search);
  if (params.has("invite")) return (params.get("invite") || "").toUpperCase();
  try { return sessionStorage.getItem(inviteIntentKey); } catch { return null; }
}
export function hasInvite() { return linkedInvite() !== null; }
export function inviteCode() { const code = linkedInvite() || ""; return /^[A-Z0-9]{8}$/.test(code) ? code : ""; }
export function rememberInvite() { try { sessionStorage.setItem(inviteIntentKey, inviteCode()); } catch { /* URL remains available */ } }
export function forgetInvite() { try { sessionStorage.removeItem(inviteIntentKey); } catch { /* storage unavailable */ } }
// The server words account errors in Chinese; English and Spanish screens show their own words instead.
const ACCOUNT_ERRORS: Record<string, [en: string, es: string]> = {
  "请输入有效邮箱。": ["Enter a valid email address.", "Introduce un correo electrónico válido."],
  "密码需要 10–128 个字符。": ["Passwords need 10 to 128 characters.", "La contraseña necesita entre 10 y 128 caracteres."],
  "这个邮箱已经注册。": ["This email is already registered. Sign in instead.", "Este correo ya está registrado. Inicia sesión."],
  "尝试次数过多，请稍后再试。": ["Too many attempts. Try again later.", "Demasiados intentos. Inténtalo más tarde."],
  "邮箱或密码不正确。": ["The email or password is not correct.", "El correo o la contraseña no son correctos."],
  "请先登录。": ["Sign in first.", "Inicia sesión primero."],
  "当前账号已经属于一个共同空间。": ["This account already belongs to a shared space.", "Esta cuenta ya pertenece a un espacio compartido."],
  "邀请无效、已过期，或当前账号已经绑定伴侣。": ["This invite is not valid or has expired, or this account is already linked to a partner.", "La invitación no es válida o ha caducado, o esta cuenta ya está vinculada a una pareja."],
};
export function accountError(message: string, language: Language) { const known = ACCOUNT_ERRORS[message]; return known ? localized(language, message, known[0], known[1]) : inInterfaceLanguage(message, language); }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> { const response = await fetch(path, { ...options, credentials: "same-origin", headers: { ...(options.body && typeof options.body === "string" ? { "content-type": "application/json" } : {}), ...options.headers } }); const payload = response.status === 204 ? {} : await response.json().catch(() => ({})); if (!response.ok) throw Object.assign(new Error(apiErrorText(payload, response.status, currentLanguage())), { code: payload.code, status: response.status }); return payload; }
