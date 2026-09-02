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
  return language === "zh" ? "Toward Us / 彼此" : "Toward Us";
}

export function pageTitle(language: Language) {
  return localized(language, "Toward Us 彼此 · 两个人的共同关系 Agent", "Toward Us · A shared relationship agent for two", "Toward Us · Un agente compartido de relación para dos");
}
