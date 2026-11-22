import { useState } from "react";
import { X } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { KeyboardInput } from "../../mobile";
import { relationshipApi } from "../relationship/api";

const hiddenKey = (userId: string) => `ourever:name-prompt-hidden:${userId}`;
export const namePromptHidden = (userId: string) => { try { return localStorage.getItem(hiddenKey(userId)) === "1"; } catch { return false; } };

/** Asked once of a member whose account name the server made up ("我", an email's local part) and who never gave one in first
 * run, so the partner sees a real name instead of the placeholder (QA round 6, finding 3). Settings can change it later. */
export function NamePrompt({ userId, language, onSaved, onHide }: { userId: string; language: Language; onSaved: () => void; onHide: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const hide = () => { try { localStorage.setItem(hiddenKey(userId), "1"); } catch { /* hidden for this visit */ } onHide(); };
  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true); setError("");
    try {
      await relationshipApi("/api/privacy/account", { method: "PATCH", body: JSON.stringify({ name: name.trim() }), signal: AbortSignal.timeout(12000) });
      hide(); onSaved();
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : t("没保存上，请重试。", "Couldn’t save. Try again.", "No se pudo guardar. Inténtalo de nuevo."));
    } finally { setSaving(false); }
  };
  return <form className="name-prompt" data-testid="name-prompt" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <label>{t("你的伴侣看到的名字", "The name your partner sees", "El nombre que ve tu pareja")}
      <KeyboardInput value={name} maxLength={24} autoComplete="given-name" placeholder={t("你的名字", "Your name", "Tu nombre")} onChange={(event) => setName(event.target.value)} />
    </label>
    <button type="submit" className="secondary-action" disabled={!name.trim() || saving}>{saving ? t("正在保存…", "Saving…", "Guardando…") : t("保存", "Save", "Guardar")}</button>
    <button type="button" className="name-prompt-hide" onClick={hide} aria-label={t("以后再说（设置里可以改）", "Not now (change it in Settings)", "Ahora no (cámbialo en Ajustes)")}><X size={16} aria-hidden="true" /></button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
