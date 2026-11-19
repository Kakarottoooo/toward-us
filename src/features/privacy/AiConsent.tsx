import { useEffect, useState } from "react";
import { ShieldCheck, WifiSlash } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { MobileScroll } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";
import "./ai-consent.css";

export const AI_NOTICE_VERSION = "2026-11-18";

export function aiDisclosure(language: Language) {
  return localized(language,
    "Pinky 会把与你的请求相关的聊天记录、截图、所选照片和语音发送给 OpenAI 或 Anthropic，用来回复、转录、理解图片及检查内容安全。导入另一人的聊天或截图时，其中对方的消息也会发送。请只提交有权分享的内容。",
    "Pinky sends relevant chat history, screenshots, selected photos and voice recordings to OpenAI or Anthropic for replies, transcription, image understanding and safety screening. Imported chats and screenshots can include the other person’s messages. Only submit material you have permission to share.",
    "Pinky envía el historial de chat pertinente, capturas, fotos elegidas y grabaciones de voz a OpenAI o Anthropic para responder, transcribir, interpretar imágenes y revisar la seguridad. Los chats y capturas importados pueden incluir mensajes de la otra persona. Comparte solo contenido que tengas permiso para enviar.");
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
    try { const { aiConsentAt } = await relationshipApi<{ aiConsentAt: string }>("/api/privacy/ai-consent", jsonBody({ agree: true, noticeVersion: AI_NOTICE_VERSION, language })); onAgreed(aiConsentAt); }
    catch (error) { setNotice((error as Error).message); setBusy(false); }
  };
  return <MobileScroll className="paper-screen ai-consent-screen" data-testid="ai-consent">
    <main className="ai-consent">
      <span className="ai-consent-icon" aria-hidden="true"><ShieldCheck size={30} weight="fill" /></span>
      <h1>{t("允许第三方 AI 处理内容？", "Allow third-party AI processing?", "¿Permitir el procesamiento con IA de terceros?")}</h1>
      <p>{aiDisclosure(language)}</p>
      <ul>
        <li>{t("如果使用照片生成动态角色，处理后的角色图片会发送给 Replicate。", "If you animate a character, the processed character image is sent to Replicate.", "Si animas un personaje, la imagen procesada se envía a Replicate.")}</li>
        <li>{t("不做广告，不卖数据，不跨 App 追踪。", "No ads, no selling data, no tracking across apps.", "Sin anuncios, sin vender datos, sin rastreo entre apps.")}</li>
        <li>{t("随时可以在“设置 → AI 与数据处理方”里撤回。", "Withdraw any time in Settings → AI and data processors.", "Retíralo cuando quieras en Ajustes → IA y encargados de datos.")}</li>
      </ul>
      <LegalLinks language={language} />
      {notice && <p className="form-notice" role="alert">{notice}</p>}
      <button type="button" className="primary-action" disabled={busy} onClick={() => void agree()} data-testid="ai-consent-agree">{busy ? t("正在保存…", "Saving…", "Guardando…") : t("同意并继续", "Agree and continue", "Aceptar y continuar")}</button>
      <button type="button" className="secondary-action" disabled={busy} onClick={onDecline} data-testid="ai-consent-decline">{t("暂不同意，进入账号设置", "Not now, open account settings", "Ahora no, abrir ajustes de cuenta")}</button>
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
  const lang = document.documentElement.lang || "en";
  const language: Language = lang.startsWith("en") ? "en" : lang.startsWith("es") ? "es" : "zh";
  return <div className="offline-banner" role="status" data-testid="offline-banner"><WifiSlash size={16} weight="bold" />{localized(language, "没有网络连接，联网后会自动恢复", "No connection. Pinky picks up again once you're online", "Sin conexión. Pinky sigue en cuanto vuelva la red")}</div>;
}
