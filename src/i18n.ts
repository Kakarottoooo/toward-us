export type Language = "zh" | "en" | "es";

export const languages: Language[] = ["zh", "en", "es"];

export function isLanguage(value: string | null): value is Language {
  return value === "zh" || value === "en" || value === "es";
}

export function initialLanguage(): Language {
  const stored = localStorage.getItem("toward-us.language");
  return isLanguage(stored) ? stored : "zh";
}

export function languageTag(language: Language) {
  return language === "zh" ? "zh-CN" : language;
}

export function localized(language: Language, zh: string, en: string, es: string) {
  return language === "zh" ? zh : language === "es" ? es : en;
}

export function brandLabel(language: Language) {
  return "Pinky";
}

export function pageTitle(language: Language) {
  return localized(language, "Pinky · 拉钩，说好就算数", "Pinky · A shared relationship agent for two", "Pinky · Un agente compartido de relación para dos");
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

/** The interface language saved on this device, for code outside React state (API helpers, hooks). */
export function currentLanguage(): Language {
  try { return initialLanguage(); } catch { return "zh"; }
}
