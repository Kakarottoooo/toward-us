import { Images } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { localized, type Language } from "../../i18n";
import { BottomSheet } from "../../mobile";
import { relationshipApi } from "../relationship/api";
import "./photo-games.css";

type Option = { id: string; title?: string };
type PhotoPage = { photos: Option[]; next: string | null };

export function SharedGamePhotoPicker({ language, disabled, onPick }: { language: Language; disabled?: boolean; onPick: (photoId: string) => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [open, setOpen] = useState(false), [photos, setPhotos] = useState<Option[]>([]);
  const [more, setMore] = useState<string | null>(null), [loading, setLoading] = useState(false);
  const [error, setError] = useState(false), [broken, setBroken] = useState<string[]>([]);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);

  async function load(after?: string) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError(false);
    try {
      const params = new URLSearchParams({ language });
      if (after) params.set("after", after);
      const result = await relationshipApi<PhotoPage>(`/api/matches/photos?${params}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setPhotos((current) => after ? [...new Map([...current, ...result.photos].map((item) => [item.id, item])).values()] : result.photos);
      setMore(result.next);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  function close() {
    request.current?.abort();
    setOpen(false);
  }

  return <>
    <button type="button" className="game-quiet game-photo-pick" disabled={disabled}
      onClick={() => { setOpen(true); setPhotos([]); setMore(null); setBroken([]); void load(); }}>
      <Images size={17} aria-hidden="true" />{t("选共享照片", "Choose shared photo", "Elegir foto compartida")}
    </button>
    <BottomSheet open={open} title={t("共同回忆", "Shared memories", "Recuerdos compartidos")} snap={0.72}
      onOpenChange={(next) => { if (!next) close(); }}>
      <section className="game-photo-gallery" aria-label={t("共享照片", "Shared photos", "Fotos compartidas")}>
        {loading && <p role="status">{t("正在找照片…", "Loading photos…", "Buscando fotos…")}</p>}
        {error && <p role="alert">{t("照片暂时没加载出来。", "Photos couldn't load.", "No se pudieron cargar las fotos.")}
          <button type="button" className="game-quiet" onClick={() => void load(photos.length ? more || undefined : undefined)}>{t("重试", "Retry", "Reintentar")}</button></p>}
        {!loading && !error && !photos.length && <p>{t("先在「回忆」里添加共享照片，再回来选。", "Add a photo to Shared memories, then come back to choose it.", "Añade una foto a Recuerdos compartidos y vuelve para elegirla.")}</p>}
        {Boolean(photos.length) && <div className="game-photo-choices">
          {photos.map((item, index) => <button type="button" key={item.id} disabled={disabled || broken.includes(item.id)}
            onClick={() => { close(); onPick(item.id); }} aria-label={item.title || t(`照片 ${index + 1}`, `Photo ${index + 1}`, `Foto ${index + 1}`)} data-testid="game-photo-option">
            {broken.includes(item.id) ? t("照片已不可用", "Photo unavailable", "Foto no disponible") :
              <img src={`/api/photos/${encodeURIComponent(item.id)}?w=240`} alt="" loading="lazy" onError={() => setBroken((current) => [...current, item.id])} />}
          </button>)}
        </div>}
        {more && !error && <button type="button" className="game-quiet" disabled={loading}
          onClick={() => void load(more)}>{t("更多照片", "More photos", "Más fotos")}</button>}
      </section>
    </BottomSheet>
  </>;
}
