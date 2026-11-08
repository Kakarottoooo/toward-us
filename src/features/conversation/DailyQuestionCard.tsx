import { useEffect, useRef, useState } from "react";
import { ChatCircleDots, LockKey, Microphone, StopCircle } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { KeyboardTextarea, useKeyboard } from "../../mobile";

export type DailyAnswers = Record<string, { text: string; at: string }>;

// Today's question for both. The server only ever sends the partner's answer once both have answered,
// so this card just shows what it was given: write yours, wait for theirs, or both side by side.
// An earlier day's question carries its date and stays closed until this member chooses to answer it late.
// The answer can be spoken: the composer's voice input fills this box instead (onVoice), tap to talk or hold to talk.
export function DailyQuestionCard({ questionId, question, answers, userId, members, language, current, askedAt, listening, onVoice, onAnswer }: {
  questionId: string; question: string; answers: DailyAnswers; userId: string; members: Array<{ id: string; name: string }>; language: Language; current: boolean; askedAt: string;
  listening: boolean; onVoice: (append: ((text: string) => void) | null) => void; onAnswer: (text: string) => Promise<boolean>;
}) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const mine = answers[userId];
  const revealed = Object.keys(answers).length >= 2;
  // Unsent words stay in this tab, scoped to their author and question. Never send a draft to the server.
  const draftKey = `pinky:daily-draft:${userId}:${questionId}`;
  const [savedDraft] = useState(() => { try { return sessionStorage.getItem(draftKey)?.slice(0, 600) || ""; } catch { return ""; } });
  const [editing, setEditing] = useState(Boolean(savedDraft));
  const [draft, setDraft] = useState(savedDraft || mine?.text || "");
  // Deferring is a view preference on this device, never an answer or a signal to the partner.
  const deferredKey = `pinky:daily-deferred:${userId}:${questionId}`;
  const [deferred, setDeferred] = useState(() => { try { return localStorage.getItem(deferredKey) === "1"; } catch { return false; } });
  const defer = (value: boolean) => {
    if (listening) onVoice(null);
    keyboard.hide(); setDeferred(value);
    try { if (value) localStorage.setItem(deferredKey, "1"); else localStorage.removeItem(deferredKey); } catch { /* Still works for this visit. */ }
  };
  useEffect(() => {
    try {
      if (editing && !revealed && draft && draft !== mine?.text) sessionStorage.setItem(draftKey, draft);
      else sessionStorage.removeItem(draftKey);
    } catch { /* Storage can be unavailable; keep the current in-memory answer usable. */ }
  }, [draftKey, draft, editing, revealed, mine?.text]);
  const [busy, setBusy] = useState(false);
  const partner = members.find((member) => member.id !== userId);
  const append = (text: string) => setDraft((value) => (value ? `${value} ${text}` : text).slice(0, 600));
  // A quick tap keeps listening until the next tap; holding stops when the finger lifts.
  const press = useRef({ at: 0, stop: false });
  const pressMic = () => { press.current = { at: Date.now(), stop: listening }; if (!listening) onVoice(append); };
  const releaseMic = () => { if (press.current.stop || Date.now() - press.current.at > 500) onVoice(null); };
  const submit = async () => {
    if (!draft.trim() || busy) return;
    if (listening) onVoice(null);
    keyboard.hide(); setBusy(true);
    try { if (await onAnswer(draft.trim())) setEditing(false); } finally { setBusy(false); }
  };
  const day = new Date(askedAt).toLocaleDateString(languageTag(language), { month: "short", day: "numeric" });
  if (deferred && !mine && !revealed) return <article className="conversation-card daily-card is-past" data-testid="daily-question">
    <header><ChatCircleDots size={16} />{t("每日一问 · 已在此设备收起", "Daily question · Hidden on this device", "Pregunta diaria · Oculta en este dispositivo")}</header>
    <div className="card-actions"><button type="button" onClick={() => defer(false)} data-testid="daily-resume">{t("重新展开", "Show question", "Mostrar pregunta")}</button></div>
  </article>;
  return <article className={`conversation-card daily-card ${current ? "" : "is-past"}`} data-testid="daily-question">
    <header><ChatCircleDots size={16} />{current ? t("今日一问", "Today's question", "Pregunta del día") : t(`${day} 的问题`, `Question from ${day}`, `Pregunta del ${day}`)}</header>
    <strong>{question}</strong>
    {revealed ? <ul className="daily-answers">
      {[userId, partner?.id || ""].map((id) => answers[id] && <li key={id}><small>{id === userId ? t("你", "You", "Tú") : partner?.name || t("TA", "Your partner", "Tu pareja")}</small><p>{answers[id].text}</p></li>)}
    </ul> : mine && !editing ? <>
      <div className="daily-mine"><p>{mine.text}</p></div>
      <small><LockKey size={14} />{t(`等 ${partner?.name || "TA"} 也回答，你们的答案会一起揭晓`, `Your answers appear together once ${partner?.name || "your partner"} answers too`, `Sus respuestas aparecen juntas cuando ${partner?.name || "tu pareja"} también responda`)}</small>
      <div className="card-actions"><button onClick={() => { setDraft(mine.text); setEditing(true); }}>{t("改一下", "Edit", "Editar")}</button></div>
    </> : !editing ? <div className="card-actions">
      <button type="button" className="card-primary" onClick={() => setEditing(true)}>{current ? t("回答", "Answer", "Responder") : t("回答这题", "Answer this question", "Responder esta pregunta")}</button>
      <button type="button" onClick={() => defer(true)} data-testid="daily-defer">{t("暂时不答", "Not now", "Ahora no")}</button>
    </div> : <>
      <div className="daily-input"><KeyboardTextarea aria-label={t("你的回答", "Your answer", "Tu respuesta")} value={draft} disabled={busy} onChange={(event) => setDraft(event.target.value)} rows={2} maxLength={600} placeholder={listening ? t("正在听，说完再点一下…", "Listening… tap again when done", "Escuchando… toca otra vez al terminar") : t("写下或说出你的回答…", "Write or say your answer…", "Escribe o di tu respuesta…")} />
        <button type="button" className={`daily-mic ${listening ? "listening" : ""}`} disabled={busy} data-scroll-drag="ignore" aria-pressed={listening} aria-label={listening ? t("结束语音输入", "Stop voice input", "Terminar dictado") : t("用语音回答", "Answer by voice", "Responder por voz")}
          onPointerDown={pressMic} onPointerUp={releaseMic} onClick={(event) => { if (event.detail === 0) onVoice(listening ? null : append); }}>{listening ? <StopCircle size={22} weight="fill" /> : <Microphone size={22} />}</button></div>
      <small><LockKey size={14} />{t("提交后，两个人都回答了才互相揭晓", "Submit when ready. Answers appear once you both answer.", "Envía cuando quieras. Las respuestas se revelan cuando ambos respondan.")}</small>
      <div className="card-actions"><button className="card-primary" disabled={busy || !draft.trim()} onClick={() => void submit()}>{t("回答", "Answer", "Responder")}</button></div>
    </>}
  </article>;
}
