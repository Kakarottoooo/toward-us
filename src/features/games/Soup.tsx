import { useEffect, useRef, useState } from "react";
import { ArrowsClockwise, BowlSteam, CheckCircle, Circle, Eye, PaperPlaneRight, Sparkle } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { KeyboardInput, useKeyboard } from "../../mobile";
import type { ScreenProps } from "./MatchScreen";
import { joinHeard, MicButton, useDictation } from "./Dictation";
import "./soup.css";

// What server/matches/soup.mjs view() sends: the 汤底 (truth) and key facts only once the game is over.
type SoupText = Partial<Record<Language, string>>;
type SoupAnswer = "yes" | "no" | "irrelevant" | "partly";
type SoupEntry = { id: string; kind: "ask" | "solve"; by: string; text: string; at: string; answer: SoupAnswer | null; note: SoupText | null; found: number[]; solved?: boolean };
export type SoupState = {
  players: string[]; log: SoupEntry[]; found: number[]; outcome: "solved" | "revealed" | null; endedBy: string | null; cheer: SoupText | null;
  puzzle: null | { source: string; title: SoupText; surface: SoupText; factCount: number; truth?: SoupText; facts?: SoupText[] };
};

const MAX_PENDING = 3;

/** 海龟汤: Pinky's 汤面 on top, the questions and Pinky's answers below, then a box to ask or to propose the 汤底. */
export function Soup({ match, language, userId, partnerName, act, onRematch }: ScreenProps<SoupState>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const pick = (text: SoupText | null | undefined) => text ? text[language] || text.zh || text.en || text.es || "" : "";
  const keyboard = useKeyboard();
  const [voiceNote, setVoiceNote] = useState("");
  // Speaking fills the box like typing does; the player reads it and taps send.
  const dictation = useDictation({ matchId: match.id, language, onText: (heard) => setText((value) => joinHeard(language, value, heard).slice(0, 300)),
    onError: (message) => setVoiceNote(t(/[\u4e00-\u9fff]/.test(message) ? message : "语音暂时用不了，可以先打字。", "Voice is unavailable right now. You can still type.", "La voz no está disponible ahora. Puedes seguir escribiendo.")) });
  const toggleVoice = () => { keyboard.hide(); setVoiceNote(""); dictation.toggle(); };
  const [text, setText] = useState(""), [mode, setMode] = useState<"ask" | "solve">("ask"), [busy, setBusy] = useState(false), [giving, setGiving] = useState(false);
  const end = useRef<HTMLDivElement>(null), truth = useRef<HTMLElement>(null), seen = useRef(match.state.log.length);
  const { puzzle, log, found, outcome } = match.state;
  const over = match.status !== "active";
  const waiting = log.filter((entry) => !entry.answer).length;
  const who = (id: string) => id === userId ? t("你", "You", "Tú") : partnerName;
  // New questions and answers scroll into view, like a chat; opening the game keeps the 汤面 in sight.
  useEffect(() => { if (log.length !== seen.current) { seen.current = log.length; end.current?.scrollIntoView({ block: "nearest" }); } }, [log.length]);
  useEffect(() => { if (over && log.length) truth.current?.scrollIntoView({ block: "start" }); }, [over, log.length]);
  // The microphone goes off when the game ends or the screen closes.
  useEffect(() => { if (over) dictation.stop(); }, [over]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (action: Record<string, unknown>) => { if (busy) return false; setBusy(true); const ok = await act(action); setBusy(false); return ok; };
  const send = async () => { const said = text.trim(); if (!said) return; keyboard.hide(); dictation.stop(); if (await run({ type: mode, text: said })) { setText(""); setMode("ask"); } };
  const verdict = (entry: SoupEntry) => entry.kind === "solve"
    ? entry.solved ? t("答对了！", "That's it!", "¡Eso es!") : t("还不对", "Not yet", "Todavía no")
    : ({ yes: t("是", "Yes", "Sí"), no: t("不是", "No", "No"), irrelevant: t("不重要", "Doesn't matter", "No importa"), partly: t("是也不是", "Yes and no", "Sí y no") } as Record<SoupAnswer, string>)[entry.answer!];
  const tone = (entry: SoupEntry) => entry.kind === "solve" ? (entry.solved ? "yes" : "no") : entry.answer;
  const total = puzzle?.factCount || 0;
  const progress = t(`已找到 ${found.length}/${total} 个关键`, `${found.length} of ${total} keys found`, `${found.length} de ${total} claves encontradas`);

  if (!puzzle) return <div className="soup">
    <p className="soup-wait" role="status" data-testid="soup-brewing"><BowlSteam size={34} weight="duotone" />{over ? t("这局结束了。", "This game is over.", "Esta partida terminó.") : t("Pinky 正在熬一碗汤…", "Pinky is cooking up a puzzle…", "Pinky está preparando un acertijo…")}</p>
    {over && <div className="game-actions"><button type="button" className="game-primary" onClick={onRematch} data-testid="game-rematch"><ArrowsClockwise size={16} />{t("再来一碗", "Another one", "Otro más")}</button></div>}
  </div>;

  return <div className="soup">
    <article className="soup-surface" data-testid="soup-surface">
      <small><BowlSteam size={16} weight="duotone" />{t("汤面", "The puzzle", "El acertijo")} · {pick(puzzle.title)}</small>
      <p>{pick(puzzle.surface)}</p>
    </article>
    <div className="soup-progress" data-testid="soup-progress" aria-label={progress}>
      <span aria-hidden="true">{Array.from({ length: total }, (_, index) => <i key={index} className={index < found.length ? "is-on" : ""} />)}</span>{progress}
    </div>

    {log.length ? <ol className="soup-log" data-testid="soup-log">{log.map((entry) => <li key={entry.id} className={entry.by === userId ? "is-mine" : ""} data-testid="soup-entry">
      <div className="soup-ask"><small>{who(entry.by)}{entry.kind === "solve" && ` · ${t("猜汤底", "Guessed the answer", "Propuso la solución")}`}</small><p>{entry.text}</p></div>
      <div className="soup-reply">
        <span className="soup-pinky">Pinky</span>
        {entry.answer ? <>
          <b className={`soup-verdict is-${tone(entry)}`}>{verdict(entry)}</b>
          {pick(entry.note) && <span className="soup-note">{pick(entry.note)}</span>}
          {entry.found.length > 0 && <em className="soup-found"><Sparkle size={13} weight="fill" />{t(`找到 ${entry.found.length} 个关键`, entry.found.length === 1 ? "Found a key" : `Found ${entry.found.length} keys`, entry.found.length === 1 ? "Una clave" : `${entry.found.length} claves`)}</em>}
        </> : over ? <span className="soup-note">—</span> : <span className="soup-thinking" role="status">{t("在想…", "is thinking…", "está pensando…")}</span>}
      </div>
    </li>)}</ol> : !over && <p className="game-note">{t("问 Pinky 能用“是 / 不是”回答的问题，一点点拼出整个故事。", "Ask Pinky yes-or-no questions and piece the story together.", "Hazle a Pinky preguntas de sí o no y arma la historia.")}</p>}

    {over ? <section ref={truth} className="soup-truth" data-testid="soup-truth">
      <h2>{outcome === "solved" ? pick(match.state.cheer) || t("答对啦！", "You got it!", "¡Lo tienen!") : t("汤底揭晓", "The answer", "La solución")}</h2>
      {outcome === "solved" && match.state.endedBy && <p className="soup-by">{match.state.endedBy === userId ? t("是你猜中的。", "You cracked it.", "Lo resolviste tú.") : t(`${partnerName} 猜中的。`, `${partnerName} cracked it.`, `Lo resolvió ${partnerName}.`)}</p>}
      <p className="soup-truth-text">{pick(puzzle.truth)}</p>
      {puzzle.facts && <ul className="soup-facts">{puzzle.facts.map((fact, index) => <li key={index} className={found.includes(index) ? "is-found" : ""}>{found.includes(index) ? <CheckCircle size={18} weight="fill" /> : <Circle size={18} />}{pick(fact)}</li>)}</ul>}
      <div className="game-actions"><button type="button" className="game-primary" onClick={onRematch} data-testid="game-rematch"><ArrowsClockwise size={16} />{t("再来一碗", "Another one", "Otro más")}</button></div>
    </section> : <>
      <div className="soup-modes" role="radiogroup" aria-label={t("要做什么", "What to do", "Qué hacer")}>
        <button type="button" role="radio" aria-checked={mode === "ask"} className={mode === "ask" ? "is-on" : ""} onClick={() => setMode("ask")} data-testid="soup-mode-ask">{t("问问题", "Ask", "Preguntar")}</button>
        <button type="button" role="radio" aria-checked={mode === "solve"} className={mode === "solve" ? "is-on" : ""} onClick={() => setMode("solve")} data-testid="soup-mode-solve">{t("猜汤底", "Guess the answer", "Resolver")}</button>
      </div>
      <form className="soup-form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <KeyboardInput value={text} onChange={(event) => setText(event.target.value)} onBlur={() => keyboard.hide()} maxLength={mode === "ask" ? 120 : 300}
          placeholder={mode === "ask" ? t("问一个是/不是的问题…", "Ask a yes/no question…", "Haz una pregunta de sí o no…") : t("说出你猜的整个故事…", "Tell the whole story as you see it…", "Cuenta la historia completa…")}
          aria-label={mode === "ask" ? t("你的问题", "Your question", "Tu pregunta") : t("你猜的汤底", "Your answer", "Tu solución")} data-testid="soup-input" />
        <MicButton language={language} dictation={{ ...dictation, toggle: toggleVoice }} />
        <button type="submit" className="game-primary" disabled={!text.trim() || busy || waiting >= MAX_PENDING} aria-label={mode === "ask" ? t("问", "Ask", "Preguntar") : t("猜", "Guess", "Resolver")} data-testid="soup-send"><PaperPlaneRight size={16} weight="fill" /></button>
      </form>
      {dictation.active && <p className="soup-listening" role="status" data-testid="soup-listening">{dictation.connecting ? t("正在打开麦克风…", "Turning on the microphone…", "Activando el micrófono…") : dictation.partial || t("在听…说完再点一下停止。", "Listening… tap again when you're done.", "Escuchando… toca de nuevo al terminar.")}</p>}
      {voiceNote && <p className="game-note" role="alert">{voiceNote}</p>}
      {waiting >= MAX_PENDING && <p className="game-note">{t("等 Pinky 答完再问吧。", "Let Pinky catch up first.", "Deja que Pinky responda primero.")}</p>}
      <div className="game-actions is-end"><button type="button" className={`game-quiet ${giving ? "is-confirm" : ""}`} disabled={busy} onClick={() => { if (!giving) { setGiving(true); return; } setGiving(false); void run({ type: "reveal" }); }} onBlur={() => setGiving(false)} data-testid="soup-reveal"><Eye size={16} />{giving ? t("确定看汤底？", "Really show the answer?", "¿Ver la solución?") : t("看汤底", "Show the answer", "Ver la solución")}</button></div>
    </>}
    <div ref={end} />
  </div>;
}
