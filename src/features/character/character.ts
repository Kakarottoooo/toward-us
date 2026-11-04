import { useCallback, useEffect, useState } from "react";
import { localized, type Language } from "../../i18n";
import { relationshipApi } from "../relationship/api";

// The couple's own character (server/character.mjs): one per couple, seen by both, made from one member's photo.
export type MakingState = "cutting" | "moving" | "failed";
export type Character = {
  image: { still: string; motion: string | null } | null;
  making: { state: MakingState; error: string | null } | null;
  uploadedByMe: boolean;
  visible: boolean;
};

/** The character as this member sees it; looks again every few seconds while it is being made, and when the app returns. */
export function useCoupleCharacter(enabled: boolean) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    try { setCharacter((await relationshipApi<{ character: Character | null }>("/api/character")).character); }
    catch { /* Keep what is shown; the next look may work. */ }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => {
    if (!enabled) { setCharacter(null); return; }
    void refresh();
    const again = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [enabled, refresh]);
  const working = character?.making?.state === "cutting" || character?.making?.state === "moving";
  useEffect(() => {
    if (!enabled || !working) return;
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [enabled, working, refresh]);
  return { character, setCharacter, refresh, loaded, working };
}

/** At most 1600px on the long side; a PNG stays PNG (a screenshot may be transparent), anything else becomes JPEG. */
export async function shrinkForCharacter(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = () => reject(new Error("unreadable")); element.src = url; });
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("unreadable")), type, 0.9));
  } finally { URL.revokeObjectURL(url); }
}

export async function uploadCharacter(photo: Blob): Promise<Character> {
  return (await relationshipApi<{ character: Character }>("/api/character", { method: "POST", body: photo, headers: { "content-type": photo.type } })).character;
}

export async function setCharacterVisible(visible: boolean): Promise<Character> {
  return (await relationshipApi<{ character: Character }>("/api/character/display", { method: "POST", body: JSON.stringify({ visible }) })).character;
}

/** What went wrong, by the code the server gives, in the interface language. */
export function characterError(code: string | null | undefined, language: Language) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  switch (code) {
    case "cut_off": return t("角色被照片边缘切到了，请换一张拍到全身的照片。", "Your character runs off the edge of the photo. Try one that shows its whole body.", "El personaje queda cortado por el borde de la foto. Prueba con una que muestre el cuerpo entero.");
    case "no_subject": return t("照片里没找到角色，换一张主体清楚、背景简单的照片。", "No character was found in this photo. Try one with a clear subject on a simple background.", "No encontramos un personaje en esta foto. Prueba con un sujeto claro sobre un fondo sencillo.");
    case "motion_failed": return t("动作没做出来，先用静态的角色；想再试可以重新上传。", "The motion couldn't be made, so your character stays still for now. Upload again to retry.", "No se pudo crear el movimiento; por ahora su personaje queda quieto. Súbanla otra vez para reintentar.");
    case "pair_first": return t("先邀请 TA 加入：角色是你们俩共有的。", "Invite your partner first: the character belongs to both of you.", "Invita primero a tu pareja: el personaje es de los dos.");
    case "busy": return t("上一个角色还在做，做好后再换。", "The last one is still being made. Try again when it's done.", "El anterior aún se está haciendo. Inténtalo cuando termine.");
    case "limit": return t("今天已经做了好几次了，明天再来吧。", "That's plenty for today. Try again tomorrow.", "Por hoy ya es suficiente. Inténtalo mañana.");
    case "unavailable": return t("现在做不了角色，请稍后再试。", "Characters can't be made right now. Try again later.", "Ahora no se pueden crear personajes. Inténtalo más tarde.");
    case "too_large": return t("照片太大了，换一张小一点的。", "This photo is too large. Try a smaller one.", "Esta foto es demasiado grande. Prueba con una más pequeña.");
    case "unreadable": return t("这张图读不出来，换一张 JPG、PNG 或 WebP 照片吧。", "This picture couldn't be read. Try a JPG, PNG or WebP photo.", "No se pudo leer esta imagen. Prueba con una foto JPG, PNG o WebP.");
    default: return t("这次没做成，换一张照片再试试。", "That didn't work this time. Try again with another photo.", "Esta vez no salió. Prueba otra vez con otra foto.");
  }
}
