import { ArrowClockwise, X } from "@phosphor-icons/react";
import { useRef, useState, type CSSProperties } from "react";
import { localized } from "../../i18n";
import type { ScreenProps } from "./MatchScreen";
import { SharedGamePhotoPicker } from "./SharedGamePhotoPicker";
import "./jigsaw.css";

// The built-in images are derived from the original public-domain photos.
// Yosemite: https://commons.wikimedia.org/wiki/File:Yosemite_Valley_(Unsplash).jpg (Matthias Mullie, CC0)
// Autumn: https://commons.wikimedia.org/wiki/File:Autumn_road._-_Flickr_-_Bernard_Spragg.jpg (Bernard Spragg, CC0)
// Reef: https://commons.wikimedia.org/wiki/File:Green-sea-turtle.jpg (U.S. Fish and Wildlife Service)
const names = {
  yosemite: ["山谷", "Mountain valley", "Valle de montaña"],
  autumn: ["秋天的路", "Autumn road", "Camino en otoño"],
  reef: ["海龟", "Sea turtle", "Tortuga marina"],
} as const;
const size = 4;

type JigsawView = {
  picture: keyof typeof names;
  photoId: string | null;
  layout: number;
  order: number[];
  placed: (string | null)[];
};
type Selection = { piece: number; layout: number };

function PieceImage({ src, index, onError }: { src: string; index: number; onError: () => void }) {
  const style: CSSProperties = {
    left: `${-100 * (index % size)}%`,
    top: `${-100 * Math.floor(index / size)}%`,
  };
  return <span className="jigsaw-piece-image" aria-hidden="true"><img src={src} style={style} alt="" draggable={false} onError={onError} /></span>;
}

export function Jigsaw({ match, language, userId, partnerName, act, onRematch }: ScreenProps<JigsawView>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const { picture, photoId, layout, order, placed } = match.state;
  const [selection, setSelection] = useState<Selection | null>(null);
  const [wrongSlot, setWrongSlot] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [endPrompt, setEndPrompt] = useState(false);
  const [missingImages, setMissingImages] = useState<string[]>([]);
  const inFlight = useRef(false);
  const complete = match.status === "finished";
  const count = placed.filter((owner) => owner !== null).length;
  const selected = selection?.layout === layout && placed[selection.piece] === null ? selection.piece : null;

  const stockUrl = `/assets/puzzles/${picture}.webp`;
  const photoUrl = photoId ? `/api/photos/${encodeURIComponent(photoId)}?w=480` : null;
  const photoUnavailable = photoUrl !== null && missingImages.includes(photoUrl);
  const src = photoUnavailable || photoUrl === null ? stockUrl : photoUrl;
  const imageUnavailable = missingImages.includes(src);
  const [titleZh, titleEn, titleEs] = names[picture];
  const mistake = selected !== null && wrongSlot !== null && placed[wrongSlot] === null ? wrongSlot : null;
  const imageTitle = photoId && !photoUnavailable
    ? t("你们的照片", "Your shared photo", "Su foto compartida")
    : t(titleZh, titleEn, titleEs);
  const canPickPhoto = match.status === "active" && count === 0 && photoId === null;

  async function send(action: Record<string, unknown>) {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    try {
      return await act(action);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function place(slot: number) {
    if (selected === null) return;
    if (selected !== slot) {
      setWrongSlot(slot);
      return;
    }
    setWrongSlot(null);
    if (await send({ type: "place", piece: selected, slot, layout })) setSelection(null);
  }

  function selectPiece(piece: number) {
    setWrongSlot(null);
    setSelection(selected === piece ? null : { piece, layout });
  }

  function imageFailed() {
    setMissingImages((current) => current.includes(src) ? current : [...current, src]);
  }

  return <section className="jigsaw-game" data-testid="jigsaw" data-layout={layout} data-placed={count} aria-label={t("双人拼图", "Jigsaw Together", "Rompecabezas en pareja")}>
    <header className="jigsaw-heading">
      <strong>{imageTitle}</strong>
      <span aria-live="polite">{count} / {placed.length}</span>
    </header>
    {photoUnavailable && <p className="jigsaw-status" role="status">{t("照片暂不可用，可以接着拼风景图。", "The shared photo is unavailable. You can finish with the landscape.", "La foto compartida no está disponible. Pueden continuar con el paisaje.")}</p>}
    {imageUnavailable ? <div className="jigsaw-failure">
      <p role="alert">{t("图片加载失败。", "The picture couldn’t load.", "No se pudo cargar la imagen.")}</p>
      <button type="button" className="game-primary" onClick={() => setMissingImages([])}>{t("重试", "Retry", "Reintentar")}</button>
    </div> : <>
      {complete ? <img className="jigsaw-completed" src={src} alt={imageTitle} draggable={false} onError={imageFailed} /> :
        <div className="jigsaw-board" role="group" aria-label={t("拼图板", "Puzzle board", "Tablero del rompecabezas")}>
          {placed.map((owner, slot) => {
            const filled = owner !== null;
            const row = Math.floor(slot / size) + 1;
            const column = slot % size + 1;
            const by = owner === userId ? t("你拼的", "Placed by you", "Colocada por ti") : t(`${partnerName} 拼的`, `Placed by ${partnerName}`, `Colocada por ${partnerName}`);
            const label = t(`第 ${row} 行，第 ${column} 列`, `Row ${row}, column ${column}`, `Fila ${row}, columna ${column}`);
            return <button key={slot} type="button" className="jigsaw-slot" data-testid={`jigsaw-slot-${slot}`}
              data-filled={filled} data-wrong={mistake === slot} aria-label={filled ? `${label} · ${by}` : label}
              disabled={busy || match.status !== "active" || selected === null || filled}
              onClick={() => void place(slot)}>
              {filled && <PieceImage src={src} index={slot} onError={imageFailed} />}
            </button>;
          })}
        </div>}
      {complete ? <p className="jigsaw-status" role="status">{t("拼好了！", "You finished the puzzle!", "¡Completaron el rompecabezas!")}</p> : <>
        <p className="jigsaw-status" role="status">
          {mistake !== null ? t("试试另一个格子。", "Try another square.", "Prueba otra casilla.")
            : selected === null ? t("先选一块拼片。", "Choose a piece to place.", "Elige una pieza.")
              : t("点拼图板上的格子。", "Tap a square on the board.", "Toca una casilla del tablero.")}
        </p>
        <div className="jigsaw-tray" role="group" aria-label={t("待拼的拼片", "Unplaced pieces", "Piezas por colocar")}>
          {order.filter((piece) => placed[piece] === null).map((piece) => {
            const number = order.indexOf(piece) + 1;
            return <button key={piece} type="button" className="jigsaw-piece" aria-pressed={selected === piece}
              aria-label={t(`拼片 ${number}`, `Piece ${number}`, `Pieza ${number}`)}
              data-testid={`jigsaw-piece-${piece}`} disabled={busy || match.status !== "active"} onClick={() => selectPiece(piece)}>
              <PieceImage src={src} index={piece} onError={imageFailed} />
            </button>;
          })}
        </div>
      </>}
    </>}
    <div className="jigsaw-actions">
      {complete ? <button type="button" className="game-primary" onClick={onRematch}><ArrowClockwise size={16} />{t("下一张", "New puzzle", "Otro rompecabezas")}</button> :
        <>
          {canPickPhoto && <SharedGamePhotoPicker language={language} disabled={busy}
            onPick={(id: string) => { setSelection(null); setWrongSlot(null); void send({ type: "photo", photoId: id }); }} />}
          <button type="button" className={`game-end${endPrompt ? " is-confirm" : ""}`} onBlur={() => setEndPrompt(false)} disabled={busy}
            onClick={() => {
              if (!endPrompt) { setEndPrompt(true); return; }
              setEndPrompt(false);
              void send({ type: "abandon" });
            }}><X size={14} />{endPrompt ? t("确定结束？", "End puzzle?", "¿Terminar?") : t("结束", "End", "Terminar")}</button>
        </>}
    </div>
  </section>;
}
