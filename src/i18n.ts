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
