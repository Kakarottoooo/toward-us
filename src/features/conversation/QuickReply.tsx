import { useState } from "react";
import { localized, type Language } from "../../i18n";
import { useKeyboard } from "../../mobile";

/** Answer choices are a field, with one explicit send action. */
export function QuickReply<T extends string>({ language, options, busy, onAnswer, testId }: { language: Language; options: ReadonlyArray<{ value: T; label: string }>; busy: boolean; onAnswer: (value: T) => void; testId: string }) {
  const [value, setValue] = useState<T | "">("");
  const keyboard = useKeyboard();
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  return <div className="card-actions quick-reply" data-testid={testId}>
    <select value={value} disabled={busy} aria-label={t("你的回答", "Your answer", "Tu respuesta")} onFocus={() => keyboard.hide()} onChange={(event) => setValue(options.find((option) => option.value === event.target.value)?.value || "")}>
      <option value="" disabled>{t("选择回答", "Choose an answer", "Elige una respuesta")}</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <button type="button" className="card-primary" disabled={busy || !value} onClick={() => { if (value) onAnswer(value); }}>{t("发送回答", "Send answer", "Enviar respuesta")}</button>
  </div>;
}
