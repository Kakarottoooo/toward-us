import { useEffect, useState } from "react";
import { ShieldCheck, WifiSlash } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { MobileScroll } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";
import "./ai-consent.css";

// Third-party AI consent (App Review 5.1.2(i), founder 11-12 App Store prep). Everything a person writes, says or picks
// for Pinky goes to outside AI providers; they agree to that explicitly first. New accounts agree on the sign-up screen
// (the sentence sits right above the button); accounts made before this see AiConsentScreen once. Settings can withdraw.
export const AI_PROVIDER_NAMES = "OpenAI, Anthropic";

/** What is sent to which AI provider and why: one sentence, used on sign-up, on the consent screen and in Settings. */
export function aiDisclosure(language: Language) {
  return localized(language,
    "Pinky 用第三方 AI（OpenAI、Anthropic）来回复你、把语音转成文字、看懂图片：你发给 Pinky 的文字、语音和你选择的照片会发送给它们处理，按它们的 API 条款默认不会用来训练模型。",
    "Pinky uses third-party AI (OpenAI, Anthropic) to reply, turn voice into text and understand images: the text, voice and photos you send to Pinky are sent to them for processing, and under their API terms are not used to train their models by default.",
    "Pinky usa IA de terceros (OpenAI, Anthropic) para responder, convertir la voz en texto y entender imágenes: el texto, la voz y las fotos que envías a Pinky se les envían para procesarlos y, según sus condiciones de API, no se usan para entrenar sus modelos por defecto.");
}

/** Links to the public privacy policy and terms, in the reader's language. */
export function LegalLinks({ language, className = "legal-links" }: { language: Language; className?: string }) {
  return <span className={className}>
    <a href={`/privacy?lang=${language}`} data-testid="link-privacy">{localized(language, "隐私政策", "Privacy Policy", "Política de privacidad")}</a>
    <span aria-hidden="true"> · </span>
    <a href={`/terms?lang=${language}`} data-testid="link-terms">{localized(language, "使用条款", "Terms of Use", "Condiciones de uso")}</a>
  </span>;
}

/** Shown once to a signed-in person who has not agreed yet; nothing of theirs reaches an AI provider before they do. */
export function AiConsentScreen({ language, onAgreed, onDecline }: { language: Language; onAgreed: (at: string) => void; onDecline: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  const agree = async () => {
    setBusy(true); setNotice("");
    try { const { aiConsentAt } = await relationshipApi<{ aiConsentAt: string }>("/api/privacy/ai-consent", jsonBody({ agree: true, language })); onAgreed(aiConsentAt); }
    catch (error) { setNotice((error as Error).message); setBusy(false); }
  };
  return <MobileScroll className="paper-screen ai-consent-screen" data-testid="ai-consent">
    <main className="ai-consent">
      <span className="ai-consent-icon" aria-hidden="true"><ShieldCheck size={30} weight="fill" /></span>
      <h1>{t("开始前，确认一件事", "Before you start", "Antes de empezar")}</h1>
      <p>{aiDisclosure(language)}</p>
      <ul>
        <li>{t("只有你主动发给 Pinky 的内容才会发送；你的私人内容另一半看不到。", "Only what you send to Pinky is sent; your partner never sees your private content.", "Solo se envía lo que mandas a Pinky; tu pareja nunca ve lo tuyo privado.")}</li>
        <li>{t("不做广告，不卖数据，不跨 App 追踪。", "No ads, no selling data, no tracking across apps.", "Sin anuncios, sin vender datos, sin rastreo entre apps.")}</li>
        <li>{t("随时可以在“设置 → AI 与数据处理方”里撤回。", "Withdraw any time in Settings → AI and data processors.", "Retíralo cuando quieras en Ajustes → IA y encargados de datos.")}</li>
      </ul>
      <LegalLinks language={language} />
      {notice && <p className="form-notice" role="alert">{notice}</p>}
      <button type="button" className="primary-action" disabled={busy} onClick={() => void agree()} data-testid="ai-consent-agree">{busy ? t("正在保存…", "Saving…", "Guardando…") : t("同意并继续", "Agree and continue", "Aceptar y continuar")}</button>
      <button type="button" className="secondary-action" disabled={busy} onClick={onDecline} data-testid="ai-consent-decline">{t("不同意，退出登录", "Don't agree, sign out", "No acepto, cerrar sesión")}</button>
    </main>
  </MobileScroll>;
}

/** A quiet line at the top while the phone has no network; requests made meanwhile fail with their own message. */
export function OfflineBanner() {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  if (online) return null;
  // The banner sits outside the language state; the page's lang attribute follows the chosen interface language.
  const lang = document.documentElement.lang || "zh";
  const language: Language = lang.startsWith("en") ? "en" : lang.startsWith("es") ? "es" : "zh";
  return <div className="offline-banner" role="status" data-testid="offline-banner"><WifiSlash size={16} weight="bold" />{localized(language, "没有网络连接，联网后会自动恢复", "No connection. Pinky picks up again once you're online", "Sin conexión. Pinky sigue en cuanto vuelva la red")}</div>;
}
