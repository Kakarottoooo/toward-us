// The language to answer a request in: the body's or query's `language`, else the signed-in member's saved interface
// language (what they chose in the App beats the browser's), else the browser's Accept-Language, else zh. Sign-in and authorization refusals used to be English-only (QA round 7).
import { acceptedLanguage } from "./auth.mjs";

const LANGUAGES = new Set(["zh", "en", "es"]);
export function requestLanguage(req) {
  for (const value of [req?.body?.language, req?.query?.language]) if (LANGUAGES.has(value)) return value;
  if (LANGUAGES.has(req?.auth?.user?.language)) return req.auth.user.language;
  return acceptedLanguage(req?.headers?.["accept-language"]) || "zh";
}
const pick = (req, zh, en, es) => { const language = requestLanguage(req); return language === "en" ? en : language === "es" ? es : zh; };
export const signInText = (req) => pick(req, "请先登录。", "Please sign in.", "Inicia sesión.");
export const unauthorizedText = (req) => pick(req, "没有权限。", "Unauthorized.", "No autorizado.");
