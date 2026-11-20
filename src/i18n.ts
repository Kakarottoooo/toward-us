import statusCodes from "../shared/http-error-status.json";

export type Language = "zh" | "en" | "es";

export const languages: Language[] = ["zh", "en", "es"];

export function isLanguage(value: string | null): value is Language {
  return value === "zh" || value === "en" || value === "es";
}

export function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem("toward-us.language");
    if (isLanguage(stored)) return stored;
  } catch { /* Storage can be unavailable on first launch. */ }
  if (typeof navigator !== "undefined") {
    for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language]) {
      const language = tag?.toLowerCase().split(/[-_]/)[0];
      if (isLanguage(language)) return language;
    }
  }
  return "en";
}

export function languageTag(language: Language) {
  return language === "zh" ? "zh-CN" : language;
}

export function localized(language: Language, zh: string, en: string, es: string) {
  return language === "zh" ? zh : language === "es" ? es : en;
}

export function brandLabel(language: Language) {
  return "Ourever";
}

export function pageTitle(language: Language) {
  return localized(language, "Ourever · 两个人的关系助手", "Ourever · A shared relationship agent for two", "Ourever · Un agente compartido de relación para dos");
}

/** "1 day" / "3 days", "1 día" / "3 días": a count with the word in its singular or plural form. */
export function counted(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

const CJK = /[぀-ヿ㐀-鿿가-힯]/;

// Errors written in Chinese (by the server or older client code) that an English or Spanish screen may show.
const KNOWN_ERRORS: Record<string, [en: string, es: string]> = {
  "实时转录保存失败。": ["Couldn't save what was said. Try again.", "No se pudo guardar lo dicho. Inténtalo de nuevo."],
  "实时语音连接发生错误。": ["The voice connection had a problem.", "La conexión de voz tuvo un problema."],
  "实时语音返回了无法识别的数据。": ["Voice sent back something unreadable. Try again.", "La voz devolvió datos ilegibles. Inténtalo de nuevo."],
  "当前浏览器不支持实时语音，请继续使用文字。": ["This browser can't do live voice. You can keep typing.", "Este navegador no admite voz en directo. Puedes seguir escribiendo."],
  "麦克风授权已超时，请重新点击并允许访问。": ["Microphone permission timed out. Tap again and allow access.", "El permiso del micrófono caducó. Toca otra vez y permite el acceso."],
  "实时语音暂时不可用。": ["Live voice is unavailable right now.", "La voz en directo no está disponible ahora."],
  "实时语音连接超时，请重试；文字输入仍可继续使用。": ["Voice took too long to connect. Try again, or keep typing.", "La voz tardó demasiado en conectar. Inténtalo de nuevo o sigue escribiendo."],
  "没有获得麦克风权限，仍可使用文字。": ["No microphone permission. You can still type.", "Sin permiso de micrófono. Puedes seguir escribiendo."],
};

/** A message to show on an `language` screen: Chinese text never reaches an English or Spanish screen (known messages are
 * translated, anything else becomes a plain "something went wrong"). */
export function inInterfaceLanguage(message: string, language: Language) {
  if (language === "zh" || !CJK.test(message)) return message;
  const known = KNOWN_ERRORS[message.trim()];
  if (known) return language === "es" ? known[1] : known[0];
  return localized(language, message, "Something went wrong. Please try again.", "Algo salió mal. Inténtalo de nuevo.");
}

const errorCopy: Record<string, [string, string, string]> = {
  "invalid_email": ["请输入有效邮箱。", "Enter a valid email address.", "Introduce un correo electrónico válido."],
  "invalid_password_length": ["密码需要 10–128 个字符。", "Use a password with 10–128 characters.", "Usa una contraseña de 10 a 128 caracteres."],
  "adult_confirmation_required": ["请确认你已年满 18 岁。", "Confirm that you are at least 18 years old.", "Confirma que tienes al menos 18 años."],
  "email_registered": ["这个邮箱已经注册。", "This email is already registered. Sign in to continue.", "Este correo ya está registrado. Inicia sesión para continuar."],
  "rate_limited": ["尝试次数过多，请稍后再试。", "Too many attempts. Try again later.", "Demasiados intentos. Inténtalo más tarde."],
  "invalid_credentials": ["邮箱或密码不正确。", "The email or password is incorrect.", "El correo o la contraseña son incorrectos."],
  "invalid_display_name": ["名字需要 1–24 个字符。", "Use a name with 1–24 characters.", "Usa un nombre de 1 a 24 caracteres."],
  "current_password_required": ["请使用当前密码确认。", "Confirm with your current password.", "Confirma con tu contraseña actual."],
  "language_required": ["请选择一种支持的语言。", "Choose a supported language.", "Elige un idioma compatible."],
  "room_not_found": ["找不到这个房间。", "This room could not be found.", "No se encontró esta sala."],
  "reply_not_found": ["找不到这条回复。", "This reply could not be found.", "No se encontró esta respuesta."],
  "not_found": ["找不到此内容。", "This item could not be found.", "No se encontró este elemento."],
  "auth_required": ["请先登录。", "Sign in to continue.", "Inicia sesión para continuar."],
  "forbidden": ["此账号无权进行此操作。", "Your account does not have permission for this action.", "Tu cuenta no tiene permiso para esta acción."],
  "invalid_input": ["请检查输入的内容后重试。", "Check what you entered and try again.", "Revisa lo que escribiste e inténtalo de nuevo."],
  "conflict": ["内容已更改，请刷新后重试。", "This item has changed. Refresh and try again.", "El contenido ha cambiado. Actualiza y vuelve a intentarlo."],
  "upload_too_large": ["文件过大，请选择较小的文件。", "Choose a smaller file to upload.", "Elige un archivo más pequeño."],
  "unsupported_format": ["请选择支持的文件格式。", "Choose a supported file format.", "Elige un formato de archivo compatible."],
  "service_unavailable": ["服务暂时无法完成请求，请稍后重试。", "The service could not complete this request. Try again shortly.", "El servicio no pudo completar la solicitud. Inténtalo más tarde."],
  "referral_not_found": ["邀请链接无效或已过期。", "This invitation is invalid or has expired.", "Esta invitación no es válida o ya caducó."],
  "network_unavailable": ["无法连接服务器，请检查网络后重试。", "Check your connection and try again.", "Comprueba la conexión e inténtalo de nuevo."]
};

export function apiErrorCode(payload: { code?: string; error?: string }, status: number) {
  if (payload.code) return payload.code;
  if (typeof payload.error === "string" && /^[a-z][a-z0-9_]+$/.test(payload.error)) return payload.error;
  return (statusCodes as Record<string, string>)[String(status)] || "service_unavailable";
}

export function apiErrorText(payload: { code?: string; error?: string }, status: number, language: Language) {
  const code = apiErrorCode(payload, status);
  const fallback = (statusCodes as Record<string, string>)[String(status)] || "service_unavailable";
  // Legacy routes can already supply a specific translated explanation. Keep it over the HTTP category.
  const message = typeof payload.error === "string" ? payload.error : "";
  const readable = message && !/^[a-z][a-z0-9_]*$/.test(message) && (language === "zh" || !CJK.test(message) || KNOWN_ERRORS[message]);
  if (code !== fallback && errorCopy[code]) return localized(language, ...errorCopy[code]);
  if (readable) return inInterfaceLanguage(message, language);
  return localized(language, ...(errorCopy[code] || errorCopy[fallback]));
}

/** The interface language saved on this device, for code outside React state (API helpers, hooks). */
export function currentLanguage(): Language {
  return initialLanguage();
}
