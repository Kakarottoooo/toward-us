import { useState } from "react";
import { localized, type Language } from "../../i18n";
import { KeyboardTextarea, useKeyboard } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";
import type { MemoryRecord, SharePreview } from "./types";

export function ShareComposer({ record, collection, language, onShared, onClose }: { record: MemoryRecord; collection: "memories" | "checkins"; language: Language; onShared: () => Promise<void>; onClose: () => void }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<SharePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const keyboard = useKeyboard();
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const run = async (action: () => Promise<void>) => { setBusy(true); setNotice(""); try { await action(); } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); } };
  return <div className="memory-share-composer">
    <h4>{t("只分享你愿意让对方看到的话", "Share only what you want your partner to read", "Comparte solo lo que quieras que lea tu pareja")}</h4>
    <p>{t("原文、私人心情和未提交的内容不会一起分享。对方读过的文字无法被收回。", "Your original, private mood, and unsent text stay private. Text your partner has already read cannot be taken back.", "El original, tu ánimo privado y el texto sin enviar siguen privados. No puedes retirar lo que tu pareja ya ha leído.")}</p>
    <label><span>{t("重新写一句可分享的话", "Write a sentence to share", "Escribe una frase para compartir")}</span><KeyboardTextarea onBlur={() => keyboard.hide()} value={text} maxLength={2000} onChange={(event) => { setText(event.target.value); setPreview(null); }} placeholder={t("例如：这周我们少安排一点活动，好吗？", "For example: Could we make fewer plans this week?", "Por ejemplo: ¿Podemos hacer menos planes esta semana?")} /></label>
    {preview && <div className="memory-share-preview" role="status"><strong>{t("对方将看到的全部文字", "Everything your partner will see", "Todo el texto que verá tu pareja")}</strong><blockquote>{preview.text}</blockquote><p>{collection === "memories" ? t("这只是共同候选。双方各自确认同一版本后，共同 AI 才能引用。", "This is a shared candidate. Joint AI can use it only after both of you confirm the same version.", "Es una propuesta compartida. La IA compartida solo podrá usarla cuando ambos confirmen la misma versión.") : t("这段分享不会自动成为关系记忆，也不会提供给共同 AI。", "This share does not become a relationship memory or go to joint AI automatically.", "Este texto no se convierte automáticamente en un recuerdo ni se envía a la IA compartida.")}</p></div>}
    <div className="memory-actions"><button disabled={busy || !text.trim()} onClick={() => void run(async () => {
      if (preview) { await relationshipApi(`/api/${collection}/${record.id}/share`, jsonBody({ ...preview, confirm: true, language })); await onShared(); onClose(); }
      else { const result = await relationshipApi<{ preview: SharePreview }>(`/api/${collection}/${record.id}/share-preview`, jsonBody({ text, language })); setPreview(result.preview); }
    })}>{preview ? t("确认并分享这段文字", "Confirm and share this text", "Confirmar y compartir este texto") : t("预览分享", "Preview share", "Previsualizar")}</button><button className="memory-quiet" disabled={busy} onClick={onClose}>{t("先不分享", "Keep private", "Mantener privado")}</button></div>
    {notice && <p role="alert">{notice}</p>}
  </div>;
}
