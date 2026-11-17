import { ArrowClockwise, ArrowRight, CheckCircle, LockKey, PaperPlaneRight, Sparkle, X } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { localized, type Language } from "../../i18n";
import { KeyboardInput, KeyboardTextarea, useKeyboard } from "../../mobile";
import type { ScreenProps } from "./MatchScreen";
import "./forbidden-words.css";

type Labels = Record<Language, string>;
type Outcome = "correct" | "passed" | "missed";
type ForbiddenState = {
  round: number;
  total: number;
  revision: number;
  phase: "clue" | "guess" | "reveal";
  givesClue: boolean;
  score: number;
  clues: string[];
  guesses: string[];
  attemptsLeft: number;
  outcome: Outcome | null;
  answer: Labels | null;
  forbidden: Labels[];
  recaps: { answer: Labels; outcome: Outcome }[];
};

export function ForbiddenWords({ match, language, partnerName, act, onRematch }: ScreenProps<ForbiddenState>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const state = match.state;
  const [draft, setDraft] = useState({ step: "", value: "" });
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const pending = useRef(false);
  const step = state.round + ":" + state.revision;
  const input = draft.step === step ? draft.value : "";
  const lastClue = state.clues.at(-1);
  const outcome = state.outcome;
  const finished = match.status === "finished";
  const canClue = state.givesClue && state.phase === "clue";
  const canGuess = !state.givesClue && state.phase === "guess";
  const waiting = state.phase !== "reveal" && !canClue && !canGuess;
  const icons = [1, 2, 3];
  const outcomeCopy = (result: Outcome) => result === "correct" ? t("猜到了", "Got it!", "¡Acertaron!") :
    result === "passed" ? t("跳过这张", "Passed", "Pasaron") : t("三次机会用完了", "Out of guesses", "Sin intentos");

  async function send(type: string, data: Record<string, unknown> = {}) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      if (await act({ type, round: state.round, revision: state.revision, ...data })) keyboard.hide();
    } finally { pending.current = false; setBusy(false); }
  }

  return <section className="forbidden-words" aria-label={t("禁词猜词", "Forbidden Words", "Palabras prohibidas")} data-testid="forbidden-words">
    <header className="forbidden-words-hero">
      <div className="forbidden-words-dots" aria-label={t(`第 ${state.round + 1} / ${state.total} 轮`, `Round ${state.round + 1} of ${state.total}`, `Ronda ${state.round + 1} de ${state.total}`)}>
        {Array.from({ length: state.total }, (_, index) => <span key={index} className={index === state.round ? "is-current" : index < state.round ? "is-past" : ""} aria-hidden="true">{index + 1}</span>)}
      </div>
      <strong aria-label={t("猜对数", "Correct answers", "Aciertos")} data-testid="forbidden-words-score">
        <Sparkle size={17} weight="fill" aria-hidden="true" /> {state.score}/{state.total}
      </strong>
    </header>

    {state.phase !== "reveal" && (state.givesClue ? <div className="forbidden-words-private">
      <p><LockKey size={16} weight="fill" aria-hidden="true" />{t("只有你看得到这个词", "Only you can see this word", "Solo tú puedes ver esta palabra")}</p>
      <h3 data-testid="forbidden-words-secret">{state.answer?.[language]}</h3>
      <div className="forbidden-words-banned">
        <span>{t("不能说", "Don't say", "No digas")}</span>
        {state.forbidden.map((word) => <strong key={word.en}>{word[language]}</strong>)}
      </div>
    </div> : <div className="forbidden-words-guess">
      <h3>{t("轮到你猜", "You're the guesser", "Te toca adivinar")}</h3>
      <p>{t("看 TA 的线索，写下你想到的词。", "Read your partner's clue and enter the word that comes to mind.", "Lee la pista de tu pareja y escribe la palabra que se te ocurra.")}</p>
    </div>)}

    {lastClue && <div className="forbidden-words-clue">
      <span>{state.givesClue ? t("你刚给的线索", "Your latest clue", "Tu última pista") : t("最新线索", "Latest clue", "Última pista")}</span>
      <p data-testid="forbidden-words-clue-text" dir="auto">{lastClue}</p>
    </div>}

    {!outcome && <div className="forbidden-words-attempts">
      <span>{t(`还可猜 ${state.attemptsLeft} 次`, `${state.attemptsLeft} guesses left`, `${state.attemptsLeft} intentos restantes`)}</span>
      <span className="forbidden-words-attempt-dots" aria-hidden="true">{icons.map((item) => <i key={item} className={item > state.attemptsLeft ? "is-used" : ""} />)}</span>
    </div>}
    {state.guesses.length > 0 && !outcome && <p className="forbidden-words-guesses">
      {t("已经猜过", "Guessed so far", "Ya probaron")} · <span dir="auto">{state.guesses.join(" · ")}</span>
    </p>}
    {waiting && <p className="forbidden-words-status" role="status">{state.phase === "clue"
      ? state.guesses.length ? t(`还没猜对，等 ${partnerName} 再给一条线索。`, `Good try. Waiting for ${partnerName} to send another clue.`, `Buen intento. Espera otra pista de ${partnerName}.`)
        : t(`等 ${partnerName} 写线索。`, `Waiting for ${partnerName}'s clue.`, `Esperando la pista de ${partnerName}.`)
      : t(`线索发好了，等 ${partnerName} 来猜。`, `Clue sent. Waiting for ${partnerName} to guess.`, `Pista enviada. Esperando a que ${partnerName} adivine.`)}</p>}

    {(canClue || canGuess) && <form className="forbidden-words-form" onSubmit={(event) => {
      event.preventDefault();
      if (input.trim()) void send(canClue ? "clue" : "guess", { text: input });
    }}>
      <label>
        <span>{canClue
          ? state.guesses.length ? t("再给一条线索", "Write another clue", "Escribe otra pista") : t("给 TA 一条线索", "Write a clue", "Escribe una pista")
          : t("你猜是什么？", "What's your guess?", "¿Qué palabra es?")}</span>
        {canClue ? <KeyboardTextarea key={step} rows={2} maxLength={160} value={input} onChange={(event) => setDraft({ step, value: event.target.value })}
          placeholder={t("换个说法，别写答案或禁词", "Describe it without the answer or banned words", "Descríbela sin usar la respuesta ni las palabras prohibidas")}
          data-testid="forbidden-words-clue" /> : <KeyboardInput key={step} maxLength={60} value={input} onChange={(event) => setDraft({ step, value: event.target.value })}
          autoComplete="off" placeholder={t("写一个词或词组", "Enter a word or phrase", "Escribe una palabra o frase")}
          data-testid="forbidden-words-guess" />}
      </label>
      <div className="forbidden-words-actions">
        <button className="game-primary" type="submit" disabled={busy || !input.trim()} data-testid="forbidden-words-send">
          <PaperPlaneRight size={17} aria-hidden="true" />{canClue ? t("发线索", "Send clue", "Enviar pista") : t("提交答案", "Submit guess", "Enviar respuesta")}
        </button>
        <button className="game-quiet" type="button" onClick={() => void send("skip")} disabled={busy} data-testid="forbidden-words-pass">{t("跳过", "Pass", "Pasar")}</button>
      </div>
    </form>}
    {waiting && <button className="game-quiet forbidden-words-pass" type="button" onClick={() => void send("skip")} disabled={busy} data-testid="forbidden-words-pass">{t("跳过这张", "Pass this card", "Pasar esta carta")}</button>}

    {outcome && <div className={"forbidden-words-result" + (outcome === "correct" ? " is-correct" : "")} role="status" data-testid="forbidden-words-result">
      <span>{outcome === "correct" && <CheckCircle size={18} weight="fill" aria-hidden="true" />}{outcomeCopy(outcome)}</span>
      <h3>{state.answer?.[language]}</h3>
      {finished && <p>{t(`你们一共猜对 ${state.total} 张里的 ${state.score} 张。`, `You got ${state.score} of ${state.total} cards together.`, `Acertaron ${state.score} de ${state.total} cartas.`)}</p>}
    </div>}
    {outcome && <div className="forbidden-words-actions">
      <button className="game-primary" type="button" disabled={busy} onClick={finished ? onRematch : () => void send("next")} data-testid={finished ? "forbidden-words-rematch" : "forbidden-words-next"}>
        {finished ? <ArrowClockwise size={17} aria-hidden="true" /> : <ArrowRight size={17} aria-hidden="true" />}
        {finished ? t("换一组词再玩", "Play a new set", "Jugar con otras palabras") : t("交换角色", "Swap roles", "Cambiar papeles")}
      </button>
    </div>}

    {state.recaps.length > 1 && <details className="forbidden-words-recap">
      <summary>{t("看本局记录", "See this game's rounds", "Ver rondas de esta partida")}</summary>
      <ul>{state.recaps.map((item, index) => <li key={index}><strong>{item.answer[language]}</strong><span>{outcomeCopy(item.outcome)}</span></li>)}</ul>
    </details>}

    {!finished && <div className="forbidden-words-end">
      <button className={"game-quiet" + (ending ? " is-confirm" : "")} type="button" onBlur={() => setEnding(false)} disabled={busy}
        onClick={() => { if (!ending) { setEnding(true); return; } keyboard.hide(); setEnding(false); void send("abandon"); }}>
        <X size={16} aria-hidden="true" />{ending ? t("确定结束？", "End the game?", "¿Terminar?") : t("结束", "End game", "Terminar")}
      </button>
    </div>}
  </section>;
}
