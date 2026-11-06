import { useState, type ReactNode } from "react";
import { ArrowsClockwise, Check, HandFist, HandPalm, Scissors, StopCircle } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { KeyboardInput, useKeyboard } from "../../mobile";
import type { ScreenProps } from "./MatchScreen";
import { BOTH } from "./types";
import "./small-games.css";

// 两个真相一个谎言 and 石头剪刀布 (game batch 2).
type TruthRound = { teller: string; statements: string[] | null; i18n?: Record<Language, string[]>; lie: number | null; guess: number | null; outcome: "caught" | "fooled" | null };
type TruthState = { players: string[]; rounds: TruthRound[]; caught: Record<string, number>; played: number; ended?: boolean };
type RpsRound = { picks: Record<string, string>; winner: string | null };
type RpsState = { players: string[]; stake: string; stakeBy?: string; rounds: RpsRound[]; wins: Record<string, number>; winner: string | null; ended?: boolean };

function EndButton({ language, onEnd }: { language: Language; onEnd: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [confirming, setConfirming] = useState(false);
  return <div className="game-actions is-end"><button type="button" className={`game-quiet ${confirming ? "is-confirm" : ""}`} onClick={() => { if (!confirming) { setConfirming(true); return; } setConfirming(false); onEnd(); }} onBlur={() => setConfirming(false)} data-testid="game-end"><StopCircle size={16} />{confirming ? t("确定结束这局", "Really end this game", "Terminar de verdad") : t("结束这局", "End this game", "Terminar partida")}</button></div>;
}

export function TwoTruths({ match, language, userId, partnerName, act, onRematch }: ScreenProps<TruthState>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const [drafts, setDrafts] = useState(["", "", ""]), [lie, setLie] = useState<number | null>(null), [busy, setBusy] = useState(false);
  const state = match.state, rounds = state.rounds, round = rounds.at(-1)!, previous = rounds.length > 1 ? rounds.at(-2)! : null;
  const lines = (item: TruthRound) => item.i18n?.[language] || item.statements || [];
  const over = match.status !== "active", telling = round.teller === userId;
  const run = async (action: Record<string, unknown>) => { if (busy) return false; keyboard.hide(); setBusy(true); const ok = await act(action); setBusy(false); return ok; };
  const tell = async () => { if (await run({ type: "tell", statements: drafts.map((item) => item.trim()), lie })) { setDrafts(["", "", ""]); setLie(null); } };
  const score = state.played ? t(`你抓到 ${state.caught[userId] || 0} 次 · ${partnerName} 抓到 ${state.caught[state.players.find((id) => id !== userId) || ""] || 0} 次`, `You caught ${state.caught[userId] || 0} · ${partnerName} caught ${state.caught[state.players.find((id) => id !== userId) || ""] || 0}`, `Tú atrapaste ${state.caught[userId] || 0} · ${partnerName} ${state.caught[state.players.find((id) => id !== userId) || ""] || 0}`) : "";
  return <div className="small-game truths">
    {score && <p className="game-stat is-center">{score}</p>}
    {previous && <article className="truths-last" data-testid="truths-last">
      <small>{t("上一轮", "Last round", "Ronda anterior")} · {previous.teller === userId ? t("你说的", "yours", "tuyas") : partnerName}</small>
      <ol>{lines(previous).map((line, index) => <li key={index} className={`${index === previous.lie ? "is-lie" : ""} ${index === previous.guess ? "is-guess" : ""}`}>{line}{index === previous.lie && <em>{t("假的", "the lie", "la mentira")}</em>}</li>)}</ol>
      <b className={previous.outcome === "caught" ? "is-hit" : ""}>{previous.outcome === "caught" ? (previous.teller === userId ? t(`被 ${partnerName} 识破了！`, `${partnerName} caught you!`, `¡${partnerName} te descubrió!`) : t("你识破了！", "You caught it!", "¡Lo descubriste!")) : (previous.teller === userId ? t(`${partnerName} 被你骗到了～`, `You fooled ${partnerName}!`, `¡Engañaste a ${partnerName}!`) : t("被骗到了～", "You were fooled!", "¡Te engañaron!"))}</b>
    </article>}
    {over ? <><p className="gomoku-status">{t("这局结束了。", "This game is over.", "Esta partida terminó.")}</p><div className="game-actions"><button type="button" className="game-primary" onClick={onRematch} data-testid="game-rematch"><ArrowsClockwise size={16} />{t("再来一局", "Play again", "Otra partida")}</button></div></>
      : telling && !round.statements ? <>
        <p className="gomoku-status">{t("写三件关于你的事，其中一件是编的", "Write three things about you; make one of them up", "Escribe tres cosas sobre ti; inventa una")}</p>
        {drafts.map((draft, index) => <div key={index} className={`truths-row ${lie === index ? "is-lie" : ""}`}>
          <KeyboardInput value={draft} maxLength={80} onChange={(event) => setDrafts((current) => current.map((item, at) => at === index ? event.target.value : item))} onBlur={() => keyboard.hide()} placeholder={[t("比如：我小时候养过一只乌龟", "e.g. I had a pet turtle as a kid", "p. ej. De niño tuve una tortuga"), t("我会……", "I can…", "Sé…"), t("我曾经……", "I once…", "Una vez…")][index]} aria-label={t(`第 ${index + 1} 句`, `Statement ${index + 1}`, `Frase ${index + 1}`)} data-testid="truths-input" />
          <button type="button" className={`truths-mark ${lie === index ? "is-on" : ""}`} aria-pressed={lie === index} onClick={() => setLie(index)} data-testid="truths-lie">{t("这句是假的", "This one's the lie", "Esta es la mentira")}</button>
        </div>)}
        <div className="game-actions"><button type="button" className="game-primary" disabled={busy || lie === null || drafts.some((item) => !item.trim())} onClick={() => void tell()} data-testid="truths-tell"><Check size={16} weight="bold" />{t("好了，让 TA 猜", "Done, let them guess", "Listo, que adivine")}</button></div>
      </>
      : telling ? <><p className="gomoku-status" role="status">{t(`等 ${partnerName} 猜哪句是假的…`, `Waiting for ${partnerName} to spot the lie…`, `Esperando a que ${partnerName} encuentre la mentira…`)}</p><ol className="truths-list">{lines(round).map((line, index) => <li key={index} className={index === round.lie ? "is-lie" : ""}>{line}</li>)}</ol></>
      : !round.statements ? <p className="gomoku-status" role="status">{t(`${partnerName} 正在想三件事…`, `${partnerName} is thinking of three things…`, `${partnerName} está pensando tres cosas…`)}</p>
      : <><p className="gomoku-status">{t(`${partnerName} 说的三件事里，哪件是假的？`, `Which of ${partnerName}'s three is the lie?`, `¿Cuál de las tres de ${partnerName} es mentira?`)}</p>
        <div className="truths-choices">{lines(round).map((line, index) => <button key={index} type="button" className="truths-choice" disabled={busy} onClick={() => void run({ type: "guess", index })} data-testid="truths-guess">{line}</button>)}</div></>}
    {!over && <EndButton language={language} onEnd={() => void run({ type: "end" })} />}
  </div>;
}

const ICONS: Record<string, ReactNode> = { rock: <HandFist size={34} weight="duotone" />, paper: <HandPalm size={34} weight="duotone" />, scissors: <Scissors size={34} weight="duotone" /> };

export function Rps({ match, language, userId, partnerName, opponent, act, onRematch }: ScreenProps<RpsState>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const [stake, setStake] = useState(""), [busy, setBusy] = useState(false);
  const state = match.state, round = state.rounds.at(-1)!, partner = state.players.find((id) => id !== userId) || "";
  const names: Record<string, string> = { rock: t("石头", "Rock", "Piedra"), paper: t("布", "Paper", "Papel"), scissors: t("剪刀", "Scissors", "Tijera") };
  const over = match.status !== "active", picked = round.picks[userId], started = state.rounds.length > 1 || Object.keys(round.picks).length > 0;
  const lastDone = [...state.rounds].reverse().find((item) => item.winner);
  const run = async (action: Record<string, unknown>) => { if (busy) return false; keyboard.hide(); setBusy(true); const ok = await act(action); setBusy(false); return ok; };
  const outcome = (item: RpsRound) => item.winner === "tie" ? t("平手，再来！", "A tie, go again!", "¡Empate, otra vez!") : item.winner === userId ? t("这一把你赢了", "You won this one", "Ganaste esta") : t(`这一把 ${partnerName} 赢了`, `${partnerName} won this one`, `${partnerName} ganó esta`);
  return <div className="small-game rps">
    <p className="rps-score" data-testid="rps-score"><span>{t("你", "You", "Tú")} <b>{state.wins[userId] || 0}</b></span><small>{t("三局两胜", "Best of three", "Al mejor de tres")}</small><span><b>{state.wins[partner] || 0}</b> {partnerName}</span></p>
    {state.stake ? <p className="rps-stake">{t("赌注：", "The bet: ", "La apuesta: ")}<b>{state.stake}</b></p>
      : !started && !over ? <form className="rps-stake-form" onSubmit={(event) => { event.preventDefault(); if (stake.trim()) void run({ type: "stake", text: stake.trim() }); }}>
        <KeyboardInput value={stake} maxLength={60} onChange={(event) => setStake(event.target.value)} onBlur={() => keyboard.hide()} placeholder={t("赌点什么？比如：输的人洗碗", "Play for something? e.g. loser does the dishes", "¿Apuestan algo? p. ej. quien pierda lava los platos")} aria-label={t("赌注", "The bet", "La apuesta")} data-testid="rps-stake" />
        <button type="submit" className="game-quiet" disabled={!stake.trim() || busy}>{t("定下", "Set", "Fijar")}</button>
      </form> : null}
    {lastDone && <div className="rps-reveal" data-testid="rps-reveal">
      <span>{ICONS[lastDone.picks[userId]]}<small>{t("你", "You", "Tú")}</small></span>
      <b>{outcome(lastDone)}</b>
      <span>{ICONS[lastDone.picks[partner]]}<small>{partnerName}</small></span>
    </div>}
    {over ? <><p className={`gomoku-status ${state.winner === userId ? "is-win" : ""}`}>{state.winner === userId ? t("你赢了！", "You win!", "¡Ganaste!") : state.winner ? t(`${partnerName} 赢了～`, `${partnerName} wins!`, `¡Gana ${partnerName}!`) : t("这局结束了。", "This game is over.", "Esta partida terminó.")}{state.stake && state.winner && <small className="rps-owes">{state.winner === userId ? t(`${partnerName} 要兑现：${state.stake}`, `${partnerName} owes: ${state.stake}`, `${partnerName} debe: ${state.stake}`) : t(`你要兑现：${state.stake}`, `You owe: ${state.stake}`, `Debes: ${state.stake}`)}</small>}</p>
      <div className="game-actions"><button type="button" className="game-primary" onClick={onRematch} data-testid="game-rematch"><ArrowsClockwise size={16} />{t("再来一局", "Play again", "Otra partida")}</button></div></>
      : picked ? <p className="gomoku-status" role="status">{t(`你出了${names[picked]}，等 ${partnerName} 出…`, `You picked ${names[picked]}. Waiting for ${partnerName}…`, `Elegiste ${names[picked]}. Esperando a ${partnerName}…`)}</p>
      : <><p className="gomoku-status">{round.picks[partner] && !opponent.pet ? t(`${partnerName} 已经出好了，轮到你`, `${partnerName} has picked; your turn`, `${partnerName} ya eligió; te toca`) : match.turn === userId || match.turn === BOTH ? t("出什么？", "Your pick?", "¿Qué eliges?") : ""}</p>
        <div className="rps-picks">{(["rock", "paper", "scissors"] as const).map((choice) => <button key={choice} type="button" className="rps-pick" disabled={busy} onClick={() => void run({ type: "pick", choice })} data-testid={`rps-${choice}`}>{ICONS[choice]}<span>{names[choice]}</span></button>)}</div></>}
    {!over && <EndButton language={language} onEnd={() => void run({ type: "end" })} />}
  </div>;
}
