import { useEffect, useRef, useState } from "react";
import { CalendarBlank, ChatCircleDots, LockKey, Microphone, StopCircle } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { KeyboardTextarea, useKeyboard } from "../../mobile";
import { Drawing, Sketch, type Stroke } from "../games/PlayDrawing";
import "./daily-drawing.css";

export type DailyAnswerInput = { text?: string; choice?: number; drawing?: Stroke[] };
export type DailyAnswers = Record<string, DailyAnswerInput & { text: string; at: string }>;
export type DailyPlay = {
  kind: "choice" | "guess" | "draw";
  variants: Partial<Record<Language, { options: string[]; followup: string }>>;
  aboutUserId?: string;
};

export function DailyQuestionCard({ questionId, question, answers, userId, members, language, current, askedAt, listening, onVoice, onAnswer, dailyPlay, onContinue, onOpenPlan, readOnly = false, offline = false, inPlay = false, openForAnswer = false }: {
  questionId: string; question: string; answers: DailyAnswers; userId: string; members: Array<{ id: string; name: string }>; language: Language;
  current: boolean; askedAt: string; listening: boolean; onVoice: (append: ((text: string) => void) | null) => void;
  onAnswer: (answer: DailyAnswerInput) => Promise<boolean>; dailyPlay?: DailyPlay; onContinue?: (followup?: string) => void; onOpenPlan?: () => void;
  readOnly?: boolean; offline?: boolean; inPlay?: boolean; openForAnswer?: boolean;
}) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const mine = answers[userId];
  const revealed = Object.keys(answers).length >= 2;
  const drawing = dailyPlay?.kind === "draw";
  const variant = dailyPlay?.variants[language] || dailyPlay?.variants.zh;
  const options = variant?.options;
  // Drafts use the same private storage key in both entry points, with a separate key for choice and sketch.
  const draftKey = `pinky:daily-draft:${userId}:${questionId}`;
  const richDraftKey = `${draftKey}:play`;
  const [savedDraft] = useState(() => { try { return sessionStorage.getItem(draftKey)?.slice(0, 600) || ""; } catch { return ""; } });
  const [savedPlay] = useState<DailyAnswerInput>(() => {
    try { return JSON.parse(sessionStorage.getItem(richDraftKey) || "{}") || {}; } catch { return {}; }
  });
  const [editing, setEditing] = useState(Boolean(savedDraft || savedPlay.drawing?.length || savedPlay.choice !== undefined || ((dailyPlay || openForAnswer) && !mine && !readOnly)));
  const [draft, setDraft] = useState(savedDraft || (mine?.drawing ? "" : mine?.text) || "");
  const [choice, setChoice] = useState(savedPlay.choice ?? mine?.choice);
  const [sketch, setSketch] = useState<Stroke[]>(savedPlay.drawing || mine?.drawing || []);
  const [useWords, setUseWords] = useState(Boolean(drawing && (savedDraft || (mine && !mine.drawing))));
  // Deferring only changes the view here; it sends nothing to the partner.
  const deferredKey = `pinky:daily-deferred:${userId}:${questionId}`;
  const [deferred, setDeferred] = useState(() => { try { return !openForAnswer && localStorage.getItem(deferredKey) === "1"; } catch { return false; } });
  const defer = (value: boolean) => {
    if (listening) onVoice(null);
    keyboard.hide(); setDeferred(value);
    try { if (value) localStorage.setItem(deferredKey, "1"); else localStorage.removeItem(deferredKey); } catch { /* Still works for this visit. */ }
  };
  useEffect(() => {
    try {
      if (editing && !revealed && draft && draft !== mine?.text) sessionStorage.setItem(draftKey, draft);
      else sessionStorage.removeItem(draftKey);
    } catch { /* Keep the in-memory answer usable. */ }
  }, [draftKey, draft, editing, revealed, mine?.text]);
  useEffect(() => {
    try {
      if (dailyPlay && editing && !revealed && (choice !== undefined || sketch.length)) {
        sessionStorage.setItem(richDraftKey, JSON.stringify({ choice, drawing: sketch }));
      } else sessionStorage.removeItem(richDraftKey);
    } catch { /* Keep the in-memory answer usable. */ }
  }, [richDraftKey, dailyPlay, editing, revealed, choice, sketch]);

  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const partner = members.find((member) => member.id !== userId);
  const partnerName = partner?.name || t("TA", "your partner", "tu pareja");
  const answered = options ? choice !== undefined : drawing && !useWords ? sketch.length > 0 : Boolean(draft.trim());
  const modeLabel = dailyPlay?.kind === "guess" ? t("猜 TA 怎么选", "Guess the pick", "Adivina la elección")
    : options ? t("今日二选一", "Today's quick pick", "Elección del día")
      : drawing ? t("一起画一画", "Draw together", "Dibujen juntos") : t("今日一问", "Today's question", "Pregunta del día");
  const revealText = options && revealed ? (
    mine?.choice === answers[partner?.id || ""]?.choice
      ? dailyPlay?.kind === "guess" ? t("猜中了", "Guessed it", "¡Acertaron!") : t("你们选到一起了", "You picked the same", "Eligieron lo mismo")
      : t("你们选得不一样", "You picked differently", "Eligieron distinto")
  ) : "";
  const renderAnswer = (value: DailyAnswers[string]) => value.drawing?.length
    ? <Sketch strokes={value.drawing} label={t("已揭晓的画", "Revealed drawing", "Dibujo revelado")} />
    : <p>{value.choice === undefined ? value.text : options?.[value.choice] ?? value.text}</p>;

  const append = (text: string) => setDraft((value) => (value ? `${value} ${text}` : text).slice(0, 600));
  const press = useRef({ at: 0, stop: false });
  const pressMic = () => { press.current = { at: Date.now(), stop: listening }; if (!listening) onVoice(append); };
  const releaseMic = () => { if (press.current.stop || Date.now() - press.current.at > 500) onVoice(null); };
  const submit = async () => {
    if (!answered || busy || readOnly || offline) return;
    if (listening) onVoice(null);
    keyboard.hide(); setBusy(true); setFailed(false);
    try {
      const value = options ? { choice } : drawing && !useWords ? { drawing: sketch } : { text: draft.trim() };
      if (await onAnswer(value)) setEditing(false);
      else setFailed(true);
    } finally { setBusy(false); }
  };

  const day = new Date(askedAt).toLocaleDateString(languageTag(language), { month: "short", day: "numeric" });
  if (deferred && !mine && !revealed) return <article className="conversation-card daily-card is-past" data-testid="daily-question">
    <header><ChatCircleDots size={16} />{t("每日一问 · 已在此设备收起", "Daily question · Hidden on this device", "Pregunta diaria · Oculta en este dispositivo")}</header>
    <div className="card-actions"><button type="button" onClick={() => defer(false)} data-testid="daily-resume">{t("重新展开", "Show question", "Mostrar pregunta")}</button></div>
  </article>;

  return <article className={`conversation-card daily-card ${current ? "" : "is-past"}`} data-testid="daily-question">
    <header><ChatCircleDots size={16} />{current ? modeLabel : t(`${day} 的问题`, `Question from ${day}`, `Pregunta del ${day}`)}</header>
    {dailyPlay?.kind === "guess" && <small>{dailyPlay.aboutUserId === userId
      ? t("这题关于你。选你真的会做的事。", "This one's about you. Pick what you'd actually do.", "Esta va sobre ti. Elige lo que harías.")
      : t(`猜猜${partnerName}会怎么选。`, `Guess what ${partnerName} would choose.`, `Adivina qué elegiría ${partnerName}.`)}</small>}
    <strong>{question}</strong>
    {revealed ? <>
      {revealText && <small role="status">{revealText}</small>}
      <ul className="daily-answers">{[userId, partner?.id || ""].map((id) => answers[id] &&
        <li key={id}><small>{id === userId ? t("你", "You", "Tú") : partnerName}</small>{renderAnswer(answers[id])}</li>)}</ul>
      {(onOpenPlan || onContinue) && !readOnly && <div className="card-actions">
        {onOpenPlan && <button className="card-primary" type="button" onClick={onOpenPlan}>
          <CalendarBlank size={17} aria-hidden="true" />{t("看看约会点子", "See date ideas", "Ver ideas para una cita")}
        </button>}
        {onContinue && <button className={onOpenPlan ? undefined : "card-primary"} type="button" onClick={() => onContinue(variant?.followup)}>
          {t("接着聊这题", "Keep talking", "Seguir hablando")}
        </button>}
      </div>}
    </> : mine && !editing ? <>
      <div className="daily-mine">{renderAnswer(mine)}</div>
      <small><LockKey size={14} />{onOpenPlan && !readOnly
        ? t(`等${partnerName}也回答，就能一起翻牌、看约会点子。`, `Once ${partnerName} answers, reveal the card and see date ideas.`, `Cuando ${partnerName} responda, podrán revelar la carta y ver ideas para una cita.`)
        : t(`等${partnerName}也回答，你们的答案会一起揭晓`, `Your answers appear together once ${partnerName} answers too`, `Sus respuestas aparecen juntas cuando ${partnerName} también responda`)}</small>
      {!readOnly && <div className="card-actions"><button type="button" onClick={() => {
        setDraft(mine.choice === undefined && !mine.drawing ? mine.text : "");
        setChoice(mine.choice); setSketch(mine.drawing || []); setUseWords(drawing && !mine.drawing); setEditing(true);
      }}>{t("改一下", "Edit", "Editar")}</button></div>}
    </> : readOnly ? null : !editing ? <>
      {onOpenPlan && <small><LockKey size={14} />{t("两个人都回答后，就能翻牌、看约会点子。", "Answer together to reveal the card and see date ideas.", "Respondan ambos para revelar la carta y ver ideas para una cita.")}</small>}
      <div className="card-actions">
        <button type="button" className="card-primary" onClick={() => setEditing(true)}>{current ? t("回答", "Answer", "Responder") : t("回答这题", "Answer this question", "Responder esta pregunta")}</button>
        <button type="button" onClick={() => defer(true)} data-testid="daily-defer">{t("暂时不答", "Not now", "Ahora no")}</button>
      </div>
    </> : <>
      {options ? <div className="card-actions daily-options" role="group" aria-label={t("答案选项", "Answer options", "Opciones")}>
        {options.map((option, index) => <button type="button" key={index} aria-pressed={choice === index} disabled={busy} onClick={() => setChoice(index)}>{option}</button>)}
      </div> : drawing && !useWords ? <Drawing strokes={sketch} onChange={setSketch} language={language} disabled={busy} />
      : <div className="daily-input">
        <KeyboardTextarea aria-label={t("你的回答", "Your answer", "Tu respuesta")} value={draft} disabled={busy}
          onChange={(event) => setDraft(event.target.value)} rows={2} maxLength={600}
          placeholder={listening ? t("正在听，说完再点一下…", "Listening… tap again when done", "Escuchando… toca otra vez al terminar") : t("写下或说出你的回答…", "Write or say your answer…", "Escribe o di tu respuesta…")} />
        <button type="button" className={`daily-mic ${listening ? "listening" : ""}`} disabled={busy || (offline && !listening)} data-scroll-drag="ignore"
          aria-pressed={listening} aria-label={listening ? t("结束语音输入", "Stop voice input", "Terminar dictado") : t("用语音回答", "Answer by voice", "Responder por voz")}
          onPointerDown={pressMic} onPointerUp={releaseMic} onClick={(event) => { if (event.detail === 0) onVoice(listening ? null : append); }}>
          {listening ? <StopCircle size={22} weight="fill" /> : <Microphone size={22} />}
        </button>
      </div>}
      {drawing && <div className="card-actions">
        <button type="button" disabled={busy} onClick={() => { if (listening) onVoice(null); keyboard.hide(); setUseWords(!useWords); }}>
          {useWords ? t("改用画布", "Use the canvas", "Usar el lienzo") : t("用一句话描述", "Describe it in words", "Describirlo con palabras")}
        </button>
      </div>}
      <small><LockKey size={14} />{onOpenPlan
        ? t("两个人都回答后，才会揭晓答案和约会点子。", "Once you both answer, reveal your answers and see date ideas.", "Cuando ambos respondan, verán sus respuestas e ideas para una cita.")
        : t("两个人都回答后才揭晓。", "Answers appear once you both answer.", "Las respuestas se revelan cuando ambos respondan.")}</small>
      {inPlay && failed && <small role="alert">{t("答案没发出去，草稿还在。", "Your answer wasn't sent. Your draft is still here.", "No se envió tu respuesta. Tu borrador sigue aquí.")}</small>}
      <div className="card-actions">
        <button className="card-primary" type="button" disabled={busy || offline || !answered} onClick={() => void submit()}>{dailyPlay ? t("锁好我的答案", "Seal my answer", "Sellar mi respuesta") : t("回答", "Answer", "Responder")}</button>
        {dailyPlay && !mine && <button type="button" disabled={busy} onClick={() => defer(true)}>{t("暂时不答", "Not now", "Ahora no")}</button>}
      </div>
    </>}
  </article>;
}
