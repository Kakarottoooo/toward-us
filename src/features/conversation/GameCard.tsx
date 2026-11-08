import { useEffect, useState } from "react";
import { ArrowsClockwise, GameController, LockKey, Sparkle } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { KeyboardTextarea, useKeyboard } from "../../mobile";
import { QuickReply } from "./QuickReply";

export type GameRound = { type: "choice" | "guess" | "truth"; options: string[]; aboutUserId: string | null; result?: { match: boolean; matched: number; played: number } };
export type GameAnswers = Record<string, { choice?: number; text: string; at: string }>;

// 小游戏: one round on a card in Us. The server sends the partner's answer only once both have answered, so the card shows
// what it was given: pick or write yours, wait for theirs, or both together with whether they matched.
export function GameCard({ questionId, prompt, game, answers, userId, members, language, onAnswer, onAgain }: {
  questionId: string; prompt: string; game: GameRound; answers: GameAnswers; userId: string; members: Array<{ id: string; name: string }>; language: Language;
  onAnswer: (answer: { choice?: number; text?: string }) => Promise<boolean>; onAgain: () => void;
}) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  // Unsent truth answers stay in this tab, scoped to their author and this round.
  const draftKey = `pinky:game-draft:${userId}:${questionId}`;
  const [draft, setDraft] = useState(() => { try { return sessionStorage.getItem(draftKey)?.slice(0, 400) || ""; } catch { return ""; } });
  const [busy, setBusy] = useState(false);
  const partner = members.find((member) => member.id !== userId);
  const partnerName = partner?.name || t("TA", "your partner", "tu pareja");
  const mine = answers[userId], theirs = partner ? answers[partner.id] : undefined;
  const revealed = Object.keys(answers).length >= 2;
  useEffect(() => {
    try {
      if (game.type === "truth" && !mine && !revealed && draft) sessionStorage.setItem(draftKey, draft);
      else sessionStorage.removeItem(draftKey);
    } catch { /* Storage may be unavailable; the current answer remains usable. */ }
  }, [draftKey, draft, game.type, mine, revealed]);
  // A private view preference: declining a question never submits an answer or changes the score.
  const deferredKey = `pinky:game-deferred:${userId}:${questionId}`;
  const [deferred, setDeferred] = useState(() => { try { return localStorage.getItem(deferredKey) === "1"; } catch { return false; } });
  const defer = (value: boolean) => {
    keyboard.hide(); setDeferred(value);
    try { if (value) localStorage.setItem(deferredKey, "1"); else localStorage.removeItem(deferredKey); } catch { /* Still works for this visit. */ }
  };
  const aboutMe = game.aboutUserId === userId;
  const aboutName = members.find((member) => member.id === game.aboutUserId)?.name || partnerName;
  const label = game.type === "choice" ? t("二选一", "Would you rather", "¿Qué prefieres?") : game.type === "guess" ? t(`默契问答 · 关于${aboutMe ? "你" : ` ${aboutName}`}`, `How well do you know ${aboutMe ? "me" : aboutName}?`, `¿Cuánto conoces a ${aboutMe ? "mí" : aboutName}?`) : t("真心话", "Heart to heart", "De corazón");
  const hint = game.type === "guess" ? (aboutMe ? t(`选你自己的答案，看 ${partnerName} 能不能猜中`, `Pick your own answer and see if ${partnerName} guesses it`, `Elige tu respuesta y mira si ${partnerName} acierta`) : t(`猜猜 ${aboutName} 会选哪个`, `Guess what ${aboutName} picked`, `Adivina qué eligió ${aboutName}`)) : "";
  const send = async (answer: { choice?: number; text?: string }) => { if (busy) return; keyboard.hide(); setBusy(true); try { if (await onAnswer(answer)) setDraft(""); } finally { setBusy(false); } };
  const who = (index: number) => [mine?.choice === index ? t("你", "You", "Tú") : "", theirs?.choice === index ? partnerName : ""].filter(Boolean).join(" · ");
  const outcome = () => {
    if (!game.result) return null;
    const score = t(`默契值 ${game.result.matched}/${game.result.played}`, `In sync ${game.result.matched}/${game.result.played}`, `Sintonía ${game.result.matched}/${game.result.played}`);
    const line = game.type === "guess" ? (game.result.match ? t("猜中了！", "Guessed right!", "¡Acertaste!") : t("没猜中～", "Not quite!", "¡Casi!")) : game.result.match ? t("心有灵犀！", "Same pick!", "¡Misma elección!") : t("选得不一样～", "Different picks!", "¡Elecciones distintas!");
    return <p className={`game-result ${game.result.match ? "is-match" : ""}`}><Sparkle size={16} weight="fill" />{line}<small>{score}</small></p>;
  };
  if (deferred && !mine && !revealed) return <article className="conversation-card game-card" data-testid="game-card">
    <header><GameController size={16} />{t("小游戏 · 已在此设备收起", "Game · Hidden on this device", "Juego · Oculto en este dispositivo")}</header>
    <div className="card-actions"><button type="button" onClick={() => defer(false)} data-testid="game-resume">{t("重新展开", "Show question", "Mostrar pregunta")}</button></div>
  </article>;
  return <article className="conversation-card game-card" data-testid="game-card">
    <header><GameController size={16} />{label}</header>
    <strong>{prompt}</strong>
    {hint && !revealed && !mine && <small className="game-hint">{hint}</small>}
    {game.type !== "truth" ? mine || revealed ? <ul className="game-options">{game.options.map((option, index) => {
      const picked = mine?.choice === index;
      return <li key={index} className={`${picked ? "is-mine" : ""} ${revealed && theirs?.choice === index ? "is-theirs" : ""}`} data-testid="game-option">
        <span>{option}</span>{revealed ? who(index) && <em>{who(index)}</em> : picked && <em>{t("你选的", "Your pick", "Tu elección")}</em>}
      </li>;
    })}</ul> : <QuickReply language={language} options={game.options.map((option, index) => ({ value: String(index), label: option }))} busy={busy} onAnswer={(choice) => void send({ choice: Number(choice) })} testId="game-answer" /> : revealed ? <ul className="daily-answers">{[userId, partner?.id || ""].map((id) => answers[id] && <li key={id}><small>{id === userId ? t("你", "You", "Tú") : partnerName}</small><p>{answers[id].text}</p></li>)}</ul>
      : mine ? <div className="daily-mine"><p>{mine.text}</p></div>
      : <><div className="daily-input"><KeyboardTextarea aria-label={t("你的回答", "Your answer", "Tu respuesta")} value={draft} disabled={busy} onChange={(event) => setDraft(event.target.value)} onBlur={() => keyboard.hide()} rows={2} maxLength={400} placeholder={t("写下你的真心话…", "Write your answer…", "Escribe tu respuesta…")} /></div>
        <div className="card-actions"><button className="card-primary" disabled={busy || !draft.trim()} onClick={() => void send({ text: draft.trim() })}>{t("回答", "Answer", "Responder")}</button></div></>}
    {!mine && !revealed && <div className="card-actions"><button type="button" disabled={busy} onClick={() => defer(true)} data-testid="game-defer">{t("这题先不玩", "Pass on this question", "Pasar esta pregunta")}</button></div>}
    {mine && !revealed && <small className="game-wait"><LockKey size={14} />{t(`等 ${partnerName} 也答完，一起揭晓`, `Revealed together once ${partnerName} answers`, `Se revela cuando ${partnerName} también responda`)}</small>}
    {revealed && outcome()}
    {revealed && <div className="card-actions"><button type="button" onClick={onAgain} data-testid="game-again"><ArrowsClockwise size={16} />{t("再来一局", "Play again", "Otra ronda")}</button></div>}
  </article>;
}
