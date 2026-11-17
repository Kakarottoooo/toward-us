import { CaretRight, Check, Eyes, ImageSquare, PaperPlaneRight } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { localized } from "../../i18n";
import { KeyboardInput, useKeyboard } from "../../mobile";
import type { ScreenProps } from "./MatchScreen";
import { SharedGamePhotoPicker } from "./SharedGamePhotoPicker";
import "./photo-games.css";

type PhotoQuestion = "where" | "when" | "what";
type DetectiveView = { hosting: boolean; hasClue: boolean; question: PhotoQuestion | null; answer: string | null; guess: string | null };

const questions = ["where", "when", "what"] as const;
const grid = Array.from({ length: 9 }, (_, index) => index);

export function PhotoDetective({ match, language, partnerName, act, onRematch }: ScreenProps<DetectiveView>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [crop, setCrop] = useState(4), [question, setQuestion] = useState<PhotoQuestion>("where");
  const [answer, setAnswer] = useState(""), [guess, setGuess] = useState("");
  const [busy, setBusy] = useState(false), [confirmEnd, setConfirmEnd] = useState(false);
  const [failedImage, setFailedImage] = useState(""), [reloadImage, setReloadImage] = useState(0);
  const writing = useRef(false);
  const state = match.state;
  const image = `/api/matches/${encodeURIComponent(match.id)}/photo-clue?full=${state.guess ? 1 : 0}&r=${reloadImage}`;
  const questionLabel = (value: PhotoQuestion) => value === "where" ? t("这是在哪儿拍的？", "Where was this taken?", "¿Dónde se tomó esta foto?")
    : value === "when" ? t("这是哪一天？", "What day was this?", "¿Qué día fue?")
      : t("这里正在发生什么？", "What was going on here?", "¿Qué estaba pasando aquí?");

  async function play(action: Record<string, unknown>) {
    if (writing.current) return;
    keyboard.hide(); writing.current = true; setBusy(true);
    try { await act(action); }
    finally { writing.current = false; setBusy(false); }
  }

  const rowNames = [t("上", "top", "arriba"), t("中", "middle", "centro"), t("下", "bottom", "abajo")];
  const colNames = [t("左", "left", "izquierda"), t("中", "center", "centro"), t("右", "right", "derecha")];

  return <section className="photo-detective" data-testid="photo-detective">
    {!state.hasClue && state.hosting ? <>
      <p>{t("挑一张有故事的共享照片，留一小角让 TA 猜。", "Pick a shared photo with a story and show just one corner.", "Elige una foto compartida con historia y muestra solo una parte.")}</p>
      <SharedGamePhotoPicker language={language} disabled={busy} onPick={(id) => { setPhotoId(id); setCrop(4); }} />
      {photoId && <>
        <span className="detective-field">{t("选一块当线索", "Choose a section as the clue", "Elige una parte como pista")}</span>
        <div className="detective-crop" role="group" aria-label={t("照片的九个区域", "Nine sections of the photo", "Nueve secciones de la foto")}>
          <img alt="" draggable={false} src={`/api/photos/${encodeURIComponent(photoId)}?w=480`} />
          <div>{grid.map((area) => <button key={area} type="button" aria-pressed={crop === area} disabled={busy}
            aria-label={`${rowNames[Math.floor(area / 3)]} · ${colNames[area % 3]}`} onClick={() => setCrop(area)} data-testid="detective-crop">
            {crop === area && <Check size={18} weight="bold" aria-hidden="true" />}
          </button>)}</div>
        </div>
        <div className="detective-questions" role="group" aria-label={t("想问 TA 什么", "What to ask your partner", "Qué preguntar a tu pareja")}>
          {questions.map((item) => <button key={item} type="button" aria-pressed={item === question} disabled={busy} onClick={() => setQuestion(item)}>
            {questionLabel(item)}
          </button>)}
        </div>
        <label className="detective-field">{t("写下谜底", "Write the answer", "Escribe la respuesta")}
          <KeyboardInput value={answer} maxLength={160} disabled={busy} onChange={(event) => setAnswer(event.target.value)} data-testid="detective-answer" />
        </label>
        <button type="button" className="game-primary" disabled={busy || !answer.trim()} onClick={() => void play({ type: "create_clue", photoId, crop, question, answer })} data-testid="detective-create">
          <PaperPlaneRight size={17} aria-hidden="true" />{t("给 TA 出题", "Send the clue", "Enviar la pista")}
        </button>
      </>}
    </> : !state.hasClue ? <p role="status">{t(`${partnerName} 正在挑照片…`, `${partnerName} is choosing a photo…`, `${partnerName} está eligiendo una foto…`)}</p> : <>
      <p className="detective-prompt">{state.question && questionLabel(state.question)}</p>
      {failedImage === image ? <div className="detective-image-error" role="status">
        <ImageSquare size={22} aria-hidden="true" />{t("共享照片暂时打不开。", "This shared photo is unavailable.", "Esta foto compartida no está disponible.")}
        <button className="game-quiet" type="button" onClick={() => setReloadImage((value) => value + 1)}>{t("重试", "Retry", "Reintentar")}</button>
      </div> : <img className={state.guess ? "detective-image is-full" : "detective-image"} src={image} decoding="async"
        alt={state.guess ? t("揭晓的完整照片", "Revealed photo", "Foto revelada") : t("照片的一小角", "A small crop of the photo", "Una pequeña parte de la foto")}
        onError={() => setFailedImage(image)} data-testid={state.guess ? "detective-reveal" : "detective-clue"} />}
      {state.guess ? <div className="detective-results" aria-live="polite">
        <p><small>{t("猜的是", "The guess", "La suposición")}</small>{state.guess}</p>
        <p><small>{t("谜底", "The answer", "La respuesta")}</small>{state.answer}</p>
        <button type="button" className="game-primary" onClick={onRematch}><Eyes size={17} aria-hidden="true" />
          {t("换人出题", "Swap roles", "Cambiar turnos")}</button>
      </div> : state.hosting ? <p role="status">{t(`等 ${partnerName} 看到照片来猜。`, `Waiting for ${partnerName} to guess.`, `Esperando a que ${partnerName} adivine.`)}</p> : <>
        <label className="detective-field">{t("你猜是什么？", "Your guess", "Tu respuesta")}
          <KeyboardInput value={guess} maxLength={160} disabled={busy} onChange={(event) => setGuess(event.target.value)} data-testid="detective-guess" />
        </label>
        <button type="button" className="game-primary" disabled={busy || !guess.trim() || failedImage === image}
          onClick={() => void play({ type: "guess", text: guess })} data-testid="detective-submit">
          <CaretRight size={17} aria-hidden="true" />{t("提交并揭晓", "Guess and reveal", "Adivinar y revelar")}</button>
      </>}
    </>}
    {match.status === "active" && <button className="game-quiet detective-end" type="button" disabled={busy} onBlur={() => setConfirmEnd(false)}
      onClick={() => { if (confirmEnd) void play({ type: "abandon" }); else setConfirmEnd(true); }}>
      {confirmEnd ? t("确认结束", "Confirm ending", "Confirmar fin") : t("结束这局", "End game", "Terminar partida")}
    </button>}
  </section>;
}
