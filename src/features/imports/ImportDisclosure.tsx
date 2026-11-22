import { useEffect, useRef, useState } from "react";
import { localized, type Language } from "../../i18n";
import { useKeyboard } from "../../mobile";
import { BottomSheet } from "../navigation/Sheet";

type Mode = "private" | "shared" | "sync" | "photos";

/** Resolve the pending choice before any upload, import, or recurring sync is started. */
export function useImportDisclosure(language: Language) {
  const keyboard = useKeyboard();
  const resolveChoice = useRef<((allow: boolean) => void) | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  useEffect(() => () => resolveChoice.current?.(false), []);
  const ask = (scope: Mode = "private") => {
    keyboard.hide();
    resolveChoice.current?.(false);
    setMode(scope);
    return new Promise<boolean>((resolve) => { resolveChoice.current = resolve; });
  };
  const finish = (allow: boolean) => {
    resolveChoice.current?.(allow);
    resolveChoice.current = null;
    setMode(null);
  };
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const dialog = <BottomSheet open={Boolean(mode)} onOpenChange={(open) => { if (!open) finish(false); }}
    title={mode === "photos" ? t("把照片发到「我们俩」？", "Share these photos in Us?", "¿Compartir estas fotos en Nosotros?") : t("发送前确认", "Before you share", "Antes de compartir")} description={mode === "photos"
      ? t("伴侣会看到这些照片。只发你有权分享的照片；使用 AI 功能时，照片可能会发给 OpenAI 或 Anthropic 处理。", "Your partner will see these photos. Share only photos you have permission to share; when you use AI features they may be sent to OpenAI or Anthropic.", "Tu pareja verá estas fotos. Comparte solo fotos que tengas permiso de compartir; al usar la IA pueden enviarse a OpenAI o Anthropic.")
      : t("你选择的内容可能包含其他人的消息、姓名和照片。Ourever 会保存这些内容；使用 AI 功能时，相关内容可能会发给 OpenAI 或 Anthropic 处理。请确认你有权分享，并先移除无关的个人信息。", "Your selection may include other people's messages, names and photos. Ourever stores this material and may send relevant parts to OpenAI or Anthropic when you use AI features. Share only what you have permission to share and remove unrelated personal details first.", "Tu selección puede incluir mensajes, nombres y fotos de otras personas. Ourever guarda este material y puede enviar partes pertinentes a OpenAI o Anthropic al usar la IA. Comparte solo lo que tengas permiso de compartir y elimina primero los datos personales innecesarios.")}>
    <div className="person-sheet" data-testid="import-disclosure">
      {mode === "shared" && <p>{t("你正发往「我们俩」，伴侣也能看到。", "You're sending this to Us. Your partner can see it too.", "Lo vas a enviar a Nosotros. Tu pareja también podrá verlo.")}</p>}
      {mode === "sync" && <p>{t("设置后，Mac 会每小时上传所选对话的新消息；你可以在聊天记录中删除这项同步。", "Once set up, your Mac uploads new messages in the selected conversation every hour. Delete the sync in Chat history to stop it.", "Tras configurarlo, el Mac subirá cada hora los nuevos mensajes del chat elegido. Elimina la sincronización en Historial de chat para detenerla.")}</p>}
      <div className="person-actions"><button type="button" className="person-primary" onClick={() => finish(true)}>{t("我有权分享，继续", "I have permission. Continue", "Tengo permiso. Continuar")}</button><button type="button" className="person-secondary" onClick={() => finish(false)}>{t("取消", "Cancel", "Cancelar")}</button></div>
    </div>
  </BottomSheet>;
  return { ask, dialog };
}
