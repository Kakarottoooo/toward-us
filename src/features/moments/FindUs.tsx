import { useEffect, useState } from "react";
import { CheckCircle, MagnifyingGlass, UserCircle } from "@phosphor-icons/react";
import { counted, localized, type Language } from "../../i18n";
import { addChosenPhotos, askPhotoAccess, findTogether, lastFound, pickFace, saveFaces, savedFaces, thumbnail, type Face } from "./photoAlbum";

type Candidate = { id: string; takenAt: string; day: string; lat?: number; lon?: number; score: number };

/** 找你们俩的合照 (founder 11-06): no couple album needed. Pick one photo of yourself and one of your partner; the phone looks
 * through the last few years for photos of the two of you and shows the likely ones. Only the ones you tap go into your
 * memories. Nothing is sent until then. iPhone App only. */
export function FindUs({ language, partnerName, onClose }: { language: Language; partnerName: string; onClose: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [faces, setFaces] = useState<{ me: Face | null; partner: Face | null }>(() => savedFaces() || { me: null, partner: null });
  const [step, setStep] = useState<"faces" | "finding" | "choose" | "done">("faces");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [found, setFound] = useState<Candidate[]>([]), [thumbs, setThumbs] = useState<Record<string, string>>({}), [chosen, setChosen] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const pick = async (who: "me" | "partner") => {
    setNote("");
    const status = await askPhotoAccess();
    if (status !== "authorized" && status !== "limited") { setNote(t("没有相册权限。可以在 iPhone 的“设置 → Pinky → 照片”里打开“所有照片”。", "No photo access. Allow all photos in iPhone Settings → Pinky → Photos.", "Sin acceso a fotos. Permite todas las fotos en Ajustes → Pinky → Fotos.")); return; }
    const face = await pickFace();
    if (face === "no_face") { setNote(t("这张照片里没找到清楚的脸，换一张正脸的试试。", "No clear face in that photo; try one facing the camera.", "No hay una cara clara en esa foto; prueba con otra de frente.")); return; }
    if (face) setFaces((current) => ({ ...current, [who]: face }));
  };
  const find = async (since?: number) => {
    if (!faces.me || !faces.partner) return;
    saveFaces({ me: faces.me, partner: faces.partner }); setStep("finding"); setNote("");
    try {
      const result = await findTogether({ me: faces.me, partner: faces.partner }, (done, total) => setProgress({ done, total }), since);
      setFound(result.assets); setChosen(new Set()); setStep("choose");
      if (!result.assets.length) setNote(t(`看了 ${result.scanned} 张照片，没找到两个人的合照。换两张更清楚的正脸照片再试试。`, `Looked at ${counted(result.scanned, "photo", "photos")} and found none of the two of you. Try clearer photos of your faces.`, `Revisé ${counted(result.scanned, "foto", "fotos")} y no encontré ninguna de ustedes dos. Prueba con fotos más claras.`));
    } catch { setStep("faces"); setNote(t("这次没找完，再试一次。", "That didn't finish; try again.", "No terminó; inténtalo de nuevo.")); }
  };
  useEffect(() => {
    let alive = true;
    (async () => { for (const item of found) { if (!alive) return; const data = await thumbnail(item.id); if (alive && data) setThumbs((current) => ({ ...current, [item.id]: data })); } })();
    return () => { alive = false; };
  }, [found]);
  const toggle = (id: string) => setChosen((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const keep = () => { void addChosenPhotos(found.filter((item) => chosen.has(item.id)), language); setStep("done"); };
  const faceSlot = (who: "me" | "partner") => <button type="button" className="find-us-face" onClick={() => void pick(who)} data-testid={`find-us-${who}`}>
    {faces[who] ? <img src={`data:image/jpeg;base64,${faces[who]!.face}`} alt="" draggable={false} /> : <UserCircle size={44} />}
    <span>{who === "me" ? t("你的照片", "A photo of you", "Una foto tuya") : t(`${partnerName} 的照片`, `A photo of ${partnerName}`, `Una foto de ${partnerName}`)}</span>
  </button>;

  return <section className="photo-album find-us" data-testid="find-us">
    <span className="photo-album-head"><MagnifyingGlass size={20} weight="bold" /><strong>{t("从相册里找你们俩的合照", "Find photos of the two of you", "Encontrar fotos de ustedes dos")}</strong></span>
    {step === "faces" && <>
      <small>{t("各选一张能看清脸的照片。手机会在最近三年的照片里找你们俩同框的，找的过程不离开这台手机。", "Pick one clear photo of each face. Your phone looks through the last three years for photos of you together; nothing leaves the phone while it looks.", "Elige una foto clara de cada cara. El teléfono busca en los últimos tres años fotos de ustedes juntos; nada sale del teléfono mientras busca.")}</small>
      <div className="find-us-faces">{faceSlot("me")}{faceSlot("partner")}</div>
      <span className="photo-album-actions">
        <button type="button" disabled={!faces.me || !faces.partner} onClick={() => void find()} data-testid="find-us-start">{t("开始找", "Find them", "Buscar")}</button>
        {lastFound() > 0 && faces.me && faces.partner && <button type="button" className="photo-album-quiet" onClick={() => void find(lastFound() - 86_400_000)}>{t("只找新的", "Only new ones", "Solo nuevas")}</button>}
        <button type="button" className="photo-album-quiet" onClick={onClose}>{t("取消", "Cancel", "Cancelar")}</button>
      </span>
    </>}
    {step === "finding" && <small role="status">{t(`正在看照片… ${progress.done} / ${progress.total}`, `Looking through photos… ${progress.done} / ${progress.total}`, `Revisando fotos… ${progress.done} / ${progress.total}`)}</small>}
    {step === "choose" && !!found.length && <>
      <small>{t("这些可能是你们俩的合照，点一下选中真的是的。只有选中的会放进你们的回忆。", "These may be photos of the two of you; tap the ones that are. Only those go into your memories.", "Estas pueden ser fotos de ustedes dos; toca las que sí lo son. Solo esas van a sus recuerdos.")}</small>
      <div className="find-us-grid">{found.map((item) => <button key={item.id} type="button" className={chosen.has(item.id) ? "is-chosen" : ""} aria-pressed={chosen.has(item.id)} onClick={() => toggle(item.id)} data-testid="find-us-photo">
        {thumbs[item.id] ? <img src={thumbs[item.id]} alt="" draggable={false} /> : <span />}{chosen.has(item.id) && <CheckCircle size={22} weight="fill" />}
      </button>)}</div>
      <span className="photo-album-actions">
        <button type="button" disabled={!chosen.size} onClick={keep} data-testid="find-us-keep">{t(`放进回忆（${chosen.size}）`, `Add to memories (${chosen.size})`, `Añadir a recuerdos (${chosen.size})`)}</button>
        <button type="button" className="photo-album-quiet" onClick={onClose}>{t("先不用", "Not now", "Ahora no")}</button>
      </span>
    </>}
    {step === "choose" && !found.length && <span className="photo-album-actions"><button type="button" onClick={() => setStep("faces")}>{t("换照片再试", "Try other photos", "Probar otras fotos")}</button><button type="button" className="photo-album-quiet" onClick={onClose}>{t("关闭", "Close", "Cerrar")}</button></span>}
    {step === "done" && <><small>{t("好了，正在整理进回忆，几分钟后就能在照片墙里看到。", "Done. They're being added to your memories and show on the photo wall in a few minutes.", "Listo. Se están añadiendo a sus recuerdos y aparecerán en unos minutos.")}</small><span className="photo-album-actions"><button type="button" className="photo-album-quiet" onClick={onClose}>{t("关闭", "Close", "Cerrar")}</button></span></>}
    {note && <p className="space-error" role="alert">{note}</p>}
  </section>;
}
