import { ArrowClockwise, Camera, CheckCircle, DownloadSimple, ImageSquare, Images, PaperPlaneRight } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { localized, type Language } from "../../i18n";
import { useKeyboard } from "../../mobile";
import { shrink } from "../moments/photoJpeg";
import type { ScreenProps } from "./MatchScreen";
import "./photo-rounds.css";

type RelayState = { prompt: Record<Language, string>; submitted: boolean; partnerSubmitted: boolean; revealed: boolean };
type Pick = { blob: Blob; url: string };
type RelayMedia = { path: string; blob: Blob; url: string };
const photoTypes = "image/jpeg,image/png,image/webp,image/heic,image/heif";

export function PhotoRelay({ match, language, partnerName, act, onRematch }: ScreenProps<RelayState>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const { prompt, submitted, partnerSubmitted, revealed } = match.state;
  const [pick, setPick] = useState<Pick | null>(null), [media, setMedia] = useState<RelayMedia | null>(null);
  const [localError, setLocalError] = useState<"read" | "send" | "save" | null>(null), [failedPath, setFailedPath] = useState("");
  const [busy, setBusy] = useState<"prepare" | "submit" | "end" | null>(null), [confirmEnd, setConfirmEnd] = useState(false);
  const [retry, setRetry] = useState(0);
  const sending = useRef(false);
  const camera = useRef<HTMLInputElement>(null), library = useRef<HTMLInputElement>(null);
  const part = revealed ? "pair" : submitted ? "self" : null;
  const path = part ? `/api/matches/${encodeURIComponent(match.id)}/relay-photo/${part}` : null;
  const loaded = path && media?.path === path ? media : null;
  const failed = path === failedPath;

  useEffect(() => () => { if (pick) URL.revokeObjectURL(pick.url); }, [pick]);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let url: string | null = null;
    setFailedPath("");
    void fetch(path, { signal: controller.signal, credentials: "same-origin", cache: "no-store" }).then(async (response) => {
      if (!response.ok || !response.headers.get("content-type")?.startsWith("image/jpeg")) throw new Error("Photo unavailable.");
      const blob = await response.blob();
      if (!controller.signal.aborted) {
        url = URL.createObjectURL(blob);
        setMedia({ path, blob, url });
      }
    }).catch(() => { if (!controller.signal.aborted) setFailedPath(path); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [path, retry]);

  async function choose(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file || sending.current) return;
    sending.current = true;
    setBusy("prepare");
    setLocalError(null);
    try {
      if (file.type === "image/svg+xml" || /\.svgz?$/i.test(file.name)) throw new Error("Expected a photo.");
      const blob = await shrink(file);
      setPick({ blob, url: URL.createObjectURL(blob) });
    } catch { setLocalError("read"); }
    finally { sending.current = false; setBusy(null); }
  }

  async function play(type: "submit" | "abandon") {
    if (sending.current || (type === "submit" && !pick)) return;
    sending.current = true;
    setBusy(type === "submit" ? "submit" : "end");
    setLocalError(null);
    try {
      const sent = await act(type === "submit" ? { type, bytes: pick!.blob } : { type });
      if (sent && type === "submit") setPick(null);
      if (!sent) setLocalError("send");
    } finally { sending.current = false; setBusy(null); }
  }

  async function savePair() {
    if (!loaded || part !== "pair") return;
    setLocalError(null);
    const file = new File([loaded.blob], "pinky-photo-relay.jpg", { type: "image/jpeg" });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
      const link = document.createElement("a");
      link.href = loaded.url;
      link.download = file.name;
      document.body.append(link);
      link.click();
      link.remove();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setLocalError("save");
    }
  }

  const note = localError === "read" ? t("这张照片打不开，换一张试试。", "This photo couldn't be opened. Try another.", "No se pudo abrir esta foto. Prueba con otra.")
    : localError === "send" ? t("操作没有保存。请重试。", "That action wasn't saved. Please try again.", "No se guardó el cambio. Inténtalo de nuevo.")
    : localError === "save" ? t("暂时无法保存合照，点一下重试。", "The collage couldn't be saved. Tap to try again.", "No se pudo guardar el collage. Toca para volver a intentarlo.") : null;

  return <section className="photo-round relay-round" data-testid="photo-relay">
    <header className="photo-round-heading relay-heading">
      <span className="photo-round-icon"><Camera size={25} weight="duotone" aria-hidden="true" /></span>
      <div>
        <h3>{prompt[language]}</h3>
        <p>{revealed ? t("你们的双人照片做好了。", "Your two-photo collage is ready.", "Su collage de dos fotos está listo.")
          : t("各拍一张，双方交齐再揭晓。", "Take a photo each. Reveal them when both are in.", "Tomen una foto cada uno. Se revelan cuando estén las dos.")}</p>
      </div>
    </header>
    {!submitted && <>
      {partnerSubmitted && <p className="photo-round-note" role="status">
        <CheckCircle size={18} aria-hidden="true" />{t(`${partnerName} 已经交了照片。`, `${partnerName} has sent a photo.`, `${partnerName} ya envió una foto.`)}
      </p>}
      {pick ? <>
        <img className="relay-preview" alt={t("你选的照片预览", "Preview of your photo", "Vista previa de tu foto")} src={pick.url} draggable={false} />
        <p className="relay-consent">{t("提交后，等你们都交了，TA 才能看到这张照片。", "Your partner sees this photo only after you both submit.", "Tu pareja verá esta foto cuando los dos hayan enviado la suya.")}</p>
        <div className="photo-round-actions">
          <button type="button" className="game-primary" disabled={Boolean(busy)} onClick={() => void play("submit")} data-testid="photo-relay-submit">
            <PaperPlaneRight size={18} aria-hidden="true" />{busy === "submit" ? t("正在提交…", "Submitting…", "Enviando…") : t("提交照片", "Submit photo", "Enviar foto")}
          </button>
          <button type="button" className="game-quiet" disabled={Boolean(busy)} onClick={() => { setPick(null); setLocalError(null); }}>
            {t("换一张", "Choose another", "Elegir otra")}
          </button>
        </div>
      </> : <div className="photo-round-actions">
        <button type="button" className="game-primary" disabled={Boolean(busy)} onClick={() => { keyboard.hide(); camera.current?.click(); }}>
          <Camera size={18} aria-hidden="true" />{t("拍照", "Take a photo", "Tomar foto")}
        </button>
        <button type="button" className="game-quiet" disabled={Boolean(busy)} onClick={() => { keyboard.hide(); library.current?.click(); }}>
          <Images size={18} aria-hidden="true" />{t("从相册选", "Choose a photo", "Elegir una foto")}
        </button>
      </div>}
      {busy === "prepare" && <p className="photo-round-note" role="status">{t("正在读取照片…", "Opening photo…", "Abriendo foto…")}</p>}
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(event) => void choose(event.currentTarget)} />
      <input ref={library} type="file" accept={photoTypes} hidden onChange={(event) => void choose(event.currentTarget)} data-testid="photo-relay-file" />
    </>}
    {part && <>
      {failed ? <div className="photo-round-note is-error" role="alert">
        <ImageSquare size={20} aria-hidden="true" />{t("这张照片暂时打不开。", "This photo couldn't be loaded.", "Por ahora no se puede cargar esta foto.")}
        <button type="button" className="game-quiet" onClick={() => { setMedia(null); setRetry((value) => value + 1); }}>{t("重试", "Retry", "Reintentar")}</button>
      </div> : loaded ? <img className={revealed ? "relay-collage" : "relay-preview"} src={loaded.url} draggable={false}
        onError={() => setFailedPath(loaded.path)}
        alt={revealed ? t("你们的两张照片并排拼在一起", "Your two photos side by side", "Sus dos fotos una al lado de la otra")
          : t("你已经提交的照片", "The photo you submitted", "La foto que enviaste")} /> :
        <p className="photo-round-note" role="status">{t("正在打开照片…", "Loading photo…", "Cargando foto…")}</p>}
      {revealed ? <div className="photo-round-actions">
        <button type="button" className="game-primary" disabled={!loaded || failed} onClick={() => void savePair()}>
          <DownloadSimple size={18} aria-hidden="true" />{t("保存合照", "Save collage", "Guardar collage")}
        </button>
        <button type="button" className="game-quiet" onClick={onRematch}>
          <ArrowClockwise size={18} aria-hidden="true" />{t("下一题", "Next prompt", "Siguiente reto")}
        </button>
      </div> : <p className="photo-round-note" role="status">
        <CheckCircle size={18} aria-hidden="true" />{t(`已提交，等 ${partnerName} 的照片。`, `Photo sent. Waiting for ${partnerName}.`, `Foto enviada. Falta la de ${partnerName}.`)}
      </p>}
    </>}
    {note && <p className="photo-round-note is-error" role="alert">{note}</p>}
    {match.status === "active" && <footer className="photo-round-footer">
      <button type="button" className={`game-quiet${confirmEnd ? " is-confirm" : ""}`} disabled={Boolean(busy)}
        onClick={() => { if (confirmEnd) void play("abandon"); else setConfirmEnd(true); }}>
        {confirmEnd ? t("确认结束", "Confirm ending", "Confirmar fin") : t("结束这局", "End game", "Terminar partida")}
      </button>
      {confirmEnd && <button type="button" className="game-quiet" disabled={Boolean(busy)} onClick={() => setConfirmEnd(false)}>
        {t("继续玩", "Keep playing", "Seguir jugando")}
      </button>}
    </footer>}
  </section>;
}
