import { Sticker } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";

// People who finished the former tour while alone can still claim their character introduction.
const owedKey = (id: string) => `toward-us:character-owed:${id}`;
export const characterOwed = (id: string) => { try { return localStorage.getItem(owedKey(id)) === "1"; } catch { return false; } };

export function CharacterOffer({ userId, language, onDone, onCharacter }: {
  userId: string; language: Language; onDone: () => void; onCharacter: () => void;
}) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const done = () => { try { localStorage.removeItem(owedKey(userId)); } catch { /* optional storage */ } onDone(); };
  const title = t("做你们的角色", "Make your own character", "Creen su propio personaje");
  return <div className="onboarding-layer" role="dialog" aria-modal="true" aria-label={title} data-testid="onboarding">
    <div className="onboarding-card"><Sticker size={30} aria-hidden="true" /><h2>{title}</h2>
      <p>{t("拍一张你们宠物的照片，或上传截图、喜欢的形象，Ourever 会把它做成会动的小角色，浮在对话顶部陪着你们俩。以后也可以在设置里做或隐藏。", "Take a photo of your pet, or upload a screenshot or a figure you love: Ourever turns it into a little moving character that floats at the top of your conversation for both of you. You can also make or hide it later in Settings.", "Hazle una foto a su mascota, o sube una captura o una figura que les guste: Ourever la convierte en un personaje que se mueve y flota arriba de su conversación para los dos. También pueden crearlo u ocultarlo luego en Ajustes.")}</p>
      <div className="onboarding-actions">
        <button className="onboarding-next" onClick={() => { done(); onCharacter(); }} data-testid="onboarding-action">{t("现在就做", "Make it now", "Crearlo ahora")}</button>
        <button className="onboarding-secondary" onClick={done}>{t("以后再说", "Not now", "Ahora no")}</button>
      </div>
    </div>
  </div>;
}
