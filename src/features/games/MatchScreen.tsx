import { useCallback, useEffect, useState, type ComponentType } from "react";
import { ArrowLeft } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { MobileScroll } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";
import { DrawGuess } from "./DrawGuess";
import { Gomoku } from "./Gomoku";
import { ConnectFour, Reversi } from "./BoardGames";
import { Rps, TwoTruths } from "./FunGames";
import { Xiangqi } from "./Xiangqi";
import { PET, type MatchView, type Member } from "./types";

export type Opponent = { name: string; picture: string | null; pet: boolean };

export type Act = (action: Record<string, unknown>) => Promise<boolean>;

/** What every game screen gets. `opponent` is the partner or 小家伙; `act` sends one move and resolves true when it was taken. */
export type ScreenProps<State = unknown> = { match: MatchView<State>; language: Language; userId: string; partnerName: string; opponent: Opponent; act: Act; onRematch: () => void };

// Each game's own screen, by game id (server/matches/index.mjs GAMES). Adding a game adds one line here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SCREENS: Record<string, ComponentType<ScreenProps<any>>> = { gomoku: Gomoku, draw: DrawGuess, reversi: Reversi, connect4: ConnectFour, truths: TwoTruths, rps: Rps, xiangqi: Xiangqi };

/** One game's own screen. Loads the match, reloads when the other one moves (`changed`), and sends this player's moves. */
export function MatchScreen({ matchId, language, userId, members, pet, changed, name, onBack, onRematch }: { matchId: string; language: Language; userId: string; members: Member[]; pet: { name: string; picture: string | null }; changed: number; name: (game: string) => string; onBack: () => void; onRematch: (game: string, pet: boolean) => Promise<void> }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [match, setMatch] = useState<MatchView | null>(null), [error, setError] = useState("");
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
    <header className="game-top"><button type="button" className="page-back" onClick={onBack} data-testid="match-back" autoFocus><ArrowLeft size={20} />{t("游戏", "Games", "Juegos")}</button><h1>{match ? withPet ? `${name(match.game)} · ${pet.name}` : name(match.game) : ""}</h1></header>
    <div className="game-stream"><MobileScroll className="game-scroll"><div className="game-body match-body" data-testid="match-screen">
      {error && <p className="space-error" role="alert">{error}</p>}
      {!match && !error && <p className="game-wait" role="status">{t("正在打开…", "Opening…", "Abriendo…")}</p>}
      {match && SCREENS[match.game] && (() => { const Screen = SCREENS[match.game]; return <Screen match={match} language={language} userId={userId} partnerName={partnerName} opponent={opponent} act={act} onRematch={rematch} />; })()}
    </div></MobileScroll></div>
  </>;
}
