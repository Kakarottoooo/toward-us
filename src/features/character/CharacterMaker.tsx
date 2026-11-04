import { useEffect, useRef, useState } from "react";
import { Camera, Images, PawPrint, Person, Sticker } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { characterError, shrinkForCharacter, uploadCharacter, type Character } from "./character";
import "./character.css";

/**
 * 做我们的角色 (the founder, 11-03, after 人脉's "用照片做你的角色"): a photo of the couple's pet, a screenshot or any figure
 * becomes the character both of them see at the top of the conversation. Choosing a photo only previews it; it is
 * sent and shared with the partner only after "Make it our character".
 */
export function CharacterMaker({ language, paired, character, onChange }: { language: Language; paired: boolean; character: Character | null; onChange: (character: Character) => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [picked, setPicked] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const library = useRef<HTMLInputElement>(null), camera = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (picked) URL.revokeObjectURL(picked.url); }, [picked]);
  const working = character?.making?.state === "cutting" || character?.making?.state === "moving";

  const pick = async (input: HTMLInputElement) => {
    const file = input.files?.[0]; input.value = "";
    if (!file) return;
    setNote("");
    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") { setNote(characterError("unreadable", language)); return; }
    try { const blob = await shrinkForCharacter(file); setPicked({ blob, url: URL.createObjectURL(blob) }); }
    catch { setNote(characterError("unreadable", language)); }
  };
  const share = async () => {
    if (!picked || busy) return;
    setBusy(true); setNote("");
    try { onChange(await uploadCharacter(picked.blob)); setPicked(null); }
    catch (error) { setNote(characterError((error as Error).message, language)); }
    finally { setBusy(false); }
  };

  const shown = character?.image ? character.image.motion || character.image.still : null;
  const status = !character?.making ? (shown ? t("做好了。它会浮在对话顶部，你们俩都能看到。", "Done. It floats at the top of your conversation for both of you.", "Listo. Flota arriba de su conversación para los dos.") : "")
    : character.making.state === "cutting" ? t("正在把角色抠出来，大约 15 秒…", "Cutting your character out, about 15 seconds…", "Recortando su personaje, unos 15 segundos…")
    : character.making.state === "moving" ? t("角色出来了！正在让它动起来，大约两分钟，可以先离开这页。", "Here it is! Now making it move, about two minutes. You can leave this page.", "¡Aquí está! Ahora le damos movimiento, unos dos minutos. Puedes salir de esta página.")
    : "";
  const failure = character?.making?.state === "failed" ? characterError(character.making.error, language) : "";

  return <section className="character-maker" data-testid="character-maker">
    <header>
      <span className="character-maker-icon"><Sticker size={24} weight="duotone" /></span>
      <div><h3>{t("做我们的角色", "Make our character", "Crear nuestro personaje")}</h3><p>{t("用一张照片做一个只属于你们俩的小角色，它会动起来，浮在对话顶部。", "Turn one photo into a little character of your own. It comes to life and floats at the top of your conversation.", "Conviertan una foto en un personaje propio. Cobra vida y flota arriba de su conversación.")}</p></div>
    </header>
    <ul className="character-tips">
      <li><PawPrint size={18} />{t("拍你们的宠物", "Take a photo of your pet", "Hazle una foto a su mascota")}</li>
      <li><Images size={18} />{t("也可以上传截图或喜欢的形象", "Or upload a screenshot or a figure you love", "O sube una captura o una figura que les guste")}</li>
      <li><Person size={18} />{t("拍到全身、背景简单", "Show the whole body on a simple background", "Que se vea el cuerpo entero sobre un fondo sencillo")}</li>
    </ul>
    {!paired ? <p className="character-note">{characterError("pair_first", language)}</p> : picked ? <div className="character-confirm">
      <img src={picked.url} alt={t("你选的照片", "The photo you picked", "La foto que elegiste")} draggable={false} />
      <p>{shown ? t("设为你们的角色后，你们俩都会看到它，并替换现在的角色。", "Once it's your character, you both see it, and it replaces the current one.", "Al ser su personaje, los dos lo verán y reemplazará al actual.") : t("设为你们的角色后，你们俩都会在对话顶部看到它。", "Once it's your character, you both see it at the top of your conversation.", "Al ser su personaje, los dos lo verán arriba de su conversación.")}</p>
      <div className="character-actions">
        <button type="button" className="character-primary" disabled={busy} onClick={() => void share()} data-testid="character-share">{busy ? t("正在上传…", "Uploading…", "Subiendo…") : t("设为我们的角色", "Make it our character", "Hacerlo nuestro personaje")}</button>
        <button type="button" className="character-secondary" disabled={busy} onClick={() => setPicked(null)}>{t("换一张", "Pick another", "Elegir otra")}</button>
      </div>
    </div> : <>
      {(shown || working) && <div className="character-result">
        {shown ? <img src={shown} alt={t("你们的角色", "Your character", "Su personaje")} draggable={false} /> : <span className="character-placeholder" aria-hidden="true" />}
        {status && <p role="status">{working && <i className="character-dot" aria-hidden="true" />}{status}</p>}
      </div>}
      {failure && <p className="character-note is-error" role="alert">{failure}</p>}
      <div className="character-actions">
        <button type="button" className="character-primary" disabled={working} onClick={() => camera.current?.click()}><Camera size={18} />{t("拍照", "Take a photo", "Tomar foto")}</button>
        <button type="button" className="character-secondary" disabled={working} onClick={() => library.current?.click()} data-testid="character-choose"><Images size={18} />{shown ? t("换一张照片", "Choose another photo", "Elegir otra foto") : t("从相册选", "Choose a photo", "Elegir una foto")}</button>
      </div>
    </>}
    {note && <p className="character-note is-error" role="alert">{note}</p>}
    <input ref={library} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onChange={(event) => void pick(event.currentTarget)} data-testid="character-file" />
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(event) => void pick(event.currentTarget)} />
  </section>;
}
