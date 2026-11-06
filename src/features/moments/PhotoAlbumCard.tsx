import { useEffect, useState } from "react";
import { ImagesSquare, UsersThree } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { askPhotoAccess, connectedAlbum, forgetAlbum, listAlbums, onPhotoProgress, syncAlbum, type PhotoAlbum, type Progress } from "./photoAlbum";

/** Connect one iPhone album (a shared couple album, say); Pinky turns it into memories by day and place. iPhone App only. */
export function PhotoAlbumCard({ language }: { language: Language }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [album, setAlbum] = useState(connectedAlbum());
  const [choices, setChoices] = useState<PhotoAlbum[] | null>(null);
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState<Progress>({ made: 0, remaining: 0, running: false, error: "" });
  useEffect(() => onPhotoProgress(setProgress), []);
  const connect = async () => {
    setNote("");
    const status = await askPhotoAccess();
    if (status !== "authorized" && status !== "limited") { setNote(t("没有拿到相册权限。可以在 iPhone 的“设置 → Pinky → 照片”里打开。", "No photo access. Turn it on in iPhone Settings → Pinky → Photos.", "Sin acceso a fotos. Actívalo en Ajustes → Pinky → Fotos.")); return; }
    const albums = await listAlbums();
    if (!albums.length) { setNote(t("没找到有照片的相册。", "No albums with photos found.", "No se encontraron álbumes con fotos.")); return; }
    setChoices(albums);
  };
  const pick = (choice: PhotoAlbum) => { const chosen = { id: choice.id, title: choice.title }; setChoices(null); setAlbum(chosen); void syncAlbum(chosen, language); };
  const stop = () => { forgetAlbum(); setAlbum(null); };

  if (choices) return <section className="photo-album" data-testid="photo-album">
    <strong>{t("选一个你们俩的相册", "Pick an album of you two", "Elige un álbum de ustedes dos")}</strong>
    <small>{t("里面的照片会按日子和地点整理成你们的回忆，你们俩都能看到。", "Its photos become your memories by day and place, visible to both of you.", "Sus fotos se convierten en sus recuerdos por día y lugar, visibles para ambos.")}</small>
    <ul className="photo-album-list">{choices.map((choice) => <li key={choice.id}><button type="button" onClick={() => pick(choice)}>
      <span>{choice.title || t("未命名相册", "Untitled album", "Álbum sin nombre")}{choice.shared && <em><UsersThree size={13} />{t("共享", "Shared", "Compartido")}</em>}</span>
      <small>{t(`${choice.count} 张`, `${choice.count} photos`, `${choice.count} fotos`)}</small>
    </button></li>)}</ul>
    <button type="button" className="photo-album-quiet" onClick={() => setChoices(null)}>{t("取消", "Cancel", "Cancelar")}</button>
  </section>;

  if (album) return <section className="photo-album" data-testid="photo-album">
    <span className="photo-album-head"><ImagesSquare size={20} weight="fill" /><strong>{t(`已连接相册「${album.title}」`, `Connected album "${album.title}"`, `Álbum conectado «${album.title}»`)}</strong></span>
    <small>{progress.running
      ? t(`正在整理… 已整理 ${progress.made} 段回忆，还剩 ${progress.remaining} 段`, `Sorting… ${progress.made} memories made, ${progress.remaining} to go`, `Ordenando… ${progress.made} recuerdos hechos, faltan ${progress.remaining}`)
      : progress.error ? t("这次没整理完，下次打开 Pinky 会接着来。", "Not finished this time; it continues next time you open Pinky.", "No terminó esta vez; seguirá la próxima vez que abras Pinky.")
      : t("新照片会在你打开 Pinky 时自动整理进回忆。", "New photos are added to your memories when you open Pinky.", "Las fotos nuevas se añaden a sus recuerdos al abrir Pinky.")}</small>
    <span className="photo-album-actions">
      {!progress.running && <button type="button" onClick={() => void syncAlbum(album, language)}>{t("现在整理", "Sort now", "Ordenar ahora")}</button>}
      <button type="button" className="photo-album-quiet" onClick={stop}>{t("断开", "Disconnect", "Desconectar")}</button>
    </span>
  </section>;

  return <section className="photo-album" data-testid="photo-album">
    <span className="photo-album-head"><ImagesSquare size={20} weight="fill" /><strong>{t("从 iPhone 相册自动整理回忆", "Make memories from your iPhone album", "Recuerdos desde tu álbum del iPhone")}</strong></span>
    <small>{t("连上你们的情侣相册，Pinky 按日子和地点整理成一段段回忆，往年的今天还会提起。", "Connect your couple album; Pinky sorts it into memories by day and place, and brings them back on the day in later years.", "Conecta su álbum de pareja; Pinky lo ordena en recuerdos por día y lugar, y los recuerda en el aniversario.")}</small>
    {note && <p className="space-error" role="alert">{note}</p>}
    <span className="photo-album-actions"><button type="button" onClick={() => void connect()} data-testid="photo-album-connect">{t("连接相册", "Connect album", "Conectar álbum")}</button></span>
  </section>;
}
