import { useCallback, useEffect, useState, type ComponentType } from "react";
import { ArrowLeft, ArrowsClockwise, X } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { MobileScroll } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";
import { DrawGuess } from "./DrawGuess";
import { Gomoku } from "./Gomoku";
import { ConnectFour, Reversi } from "./BoardGames";
import { Rps, TwoTruths } from "./FunGames";
import { Xiangqi } from "./Xiangqi";
import { Ludo } from "./Ludo";
import { Soup } from "./Soup";
import { PET, type MatchView, type Member } from "./types";

export type Opponent = { name: string; picture: string | null; pet: boolean };

export type Act = (action: Record<string, unknown>) => Promise<boolean>;

/** What every game screen gets. `opponent` is the partner or 小家伙; `act` sends one move and resolves true when it was taken. */
export type ScreenProps<State = unknown> = { match: MatchView<State>; language: Language; userId: string; partnerName: string; opponent: Opponent; act: Act; onRematch: () => void };

// Games played in rounds end with their own button at the bottom (their rounds count); the header doesn't repeat it.
const OWN_END = new Set(["draw", "truths", "rps"]);

// Each game's own screen, by game id (server/matches/index.mjs GAMES). Adding a game adds one line here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SCREENS: Record<string, ComponentType<ScreenProps<any>>> = { gomoku: Gomoku, draw: DrawGuess, reversi: Reversi, connect4: ConnectFour, truths: TwoTruths, rps: Rps, xiangqi: Xiangqi, ludo: Ludo, soup: Soup };

/** One game's own screen. Loads the match, reloads when the other one moves (`changed`), and sends this player's moves. */
export function MatchScreen({ matchId, language, userId, members, pet, changed, name, solo = () => false, onBack, onRematch }: { solo?: (game: string) => boolean; matchId: string; language: Language; userId: string; members: Member[]; pet: { name: string; picture: string | null }; changed: number; name: (game: string) => string; onBack: () => void; onRematch: (game: string, pet: boolean) => Promise<void> }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [match, setMatch] = useState<MatchView | null>(null), [error, setError] = useState(""), [ending, setEnding] = useState(false);
  const load = useCallback(async () => { try { setMatch((await relationshipApi<{ match: MatchView }>(`/api/matches/${encodeURIComponent(matchId)}?language=${language}`)).match); } catch (caught) { setError((caught as Error).message); } }, [matchId, language]);
  useEffect(() => { void load(); }, [load, changed]);
  const act: Act = async (action) => {
    setError("");
    try { setMatch((await relationshipApi<{ match: MatchView }>(`/api/matches/${encodeURIComponent(matchId)}/actions`, jsonBody({ ...action, language }))).match); return true; }
    catch (caught) { setError((caught as Error).message); void load(); return false; }
  };
  const withPet = Boolean(match?.players.includes(PET));
  const rematch = async () => { setError(""); try { await onRematch(match!.game, withPet); } catch (caught) { setError((caught as Error).message); } };
  const partner = members.find((member) => member.id !== userId);
  // With 小家伙 it is the other player: its name, its picture, and no "we'll tell you" (it answers right away).
  const partnerName = withPet ? pet.name : partner?.name || t("TA", "your partner", "tu pareja");
  const opponent = { name: partnerName, picture: withPet ? pet.picture : null, pet: withPet };
  return <>
    <header className="game-top has-side"><button type="button" className="page-back" onClick={onBack} data-testid="match-back" autoFocus><ArrowLeft size={20} />{t("游戏", "Games", "Juegos")}</button><h1>{match ? withPet && !solo(match.game) ? `${name(match.game)} · ${pet.name}` : name(match.game) : ""}</h1>
      {/* Stops the game for both, no winner (founder 11-06); a second tap confirms. */}
      <span className="game-top-side">{match?.status === "active" && !OWN_END.has(match.game) && <button type="button" className={`game-end ${ending ? "is-confirm" : ""}`} onClick={() => { if (!ending) { setEnding(true); return; } setEnding(false); void act({ type: "abandon" }); }} onBlur={() => setEnding(false)} data-testid="match-end">{ending ? t("确定结束？", "End it?", "¿Terminar?") : <><X size={14} weight="bold" />{t("结束", "End", "Terminar")}</>}</button>}</span>
    </header>
    <div className="game-stream"><MobileScroll className="game-scroll"><div className="game-body match-body" data-testid="match-screen">
      {error && <p className="space-error" role="alert">{error}</p>}
      {!match && !error && <p className="game-wait" role="status">{t("正在打开…", "Opening…", "Abriendo…")}</p>}
      {match?.status === "ended" && <section className="game-ended" data-testid="match-ended">
        <p>{match.endedBy === userId ? t("你结束了这局。没下完，不算输赢。", "You ended this game. It doesn't count for anyone.", "Terminaste esta partida. No cuenta para nadie.") : t(`${partnerName} 结束了这局。没下完，不算输赢。`, `${partnerName} ended this game. It doesn't count for anyone.`, `${partnerName} terminó esta partida. No cuenta para nadie.`)}</p>
        <button type="button" className="game-primary" onClick={() => void rematch()} data-testid="game-rematch"><ArrowsClockwise size={16} />{t("再来一局", "Play again", "Otra partida")}</button>
      </section>}
      {match && match.status !== "ended" && SCREENS[match.game] && (() => { const Screen = SCREENS[match.game]; return <Screen match={match} language={language} userId={userId} partnerName={partnerName} opponent={opponent} act={act} onRematch={rematch} />; })()}
    </div></MobileScroll></div>
  </>;
}
