import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { MobileScroll } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";
import { DrawGuess } from "./DrawGuess";
import { Gomoku } from "./Gomoku";
import type { DrawState, GomokuState, MatchView, Member } from "./types";

export type Act = (action: Record<string, unknown>) => Promise<boolean>;

/** One game's own screen. Loads the match, reloads when the other one moves (`changed`), and sends this player's moves. */
export function MatchScreen({ matchId, language, userId, members, changed, name, onBack, onRematch }: { matchId: string; language: Language; userId: string; members: Member[]; changed: number; name: (game: string) => string; onBack: () => void; onRematch: (game: string) => Promise<void> }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [match, setMatch] = useState<MatchView | null>(null), [error, setError] = useState("");
  const load = useCallback(async () => { try { setMatch((await relationshipApi<{ match: MatchView }>(`/api/matches/${encodeURIComponent(matchId)}?language=${language}`)).match); } catch (caught) { setError((caught as Error).message); } }, [matchId, language]);
  useEffect(() => { void load(); }, [load, changed]);
  const act: Act = async (action) => {
    setError("");
    try { setMatch((await relationshipApi<{ match: MatchView }>(`/api/matches/${encodeURIComponent(matchId)}/actions`, jsonBody({ ...action, language }))).match); return true; }
    catch (caught) { setError((caught as Error).message); void load(); return false; }
  };
  const rematch = async () => { setError(""); try { await onRematch(match!.game); } catch (caught) { setError((caught as Error).message); } };
  const partner = members.find((member) => member.id !== userId);
  const partnerName = partner?.name || t("TA", "your partner", "tu pareja");
  return <>
    <header className="game-top"><button type="button" className="page-back" onClick={onBack} data-testid="match-back" autoFocus><ArrowLeft size={20} />{t("游戏", "Games", "Juegos")}</button><h1>{match ? name(match.game) : ""}</h1></header>
    <div className="game-stream"><MobileScroll className="game-scroll"><div className="game-body match-body" data-testid="match-screen">
      {error && <p className="space-error" role="alert">{error}</p>}
      {!match && !error && <p className="game-wait" role="status">{t("正在打开…", "Opening…", "Abriendo…")}</p>}
      {match?.game === "gomoku" && <Gomoku match={match as MatchView<GomokuState>} language={language} userId={userId} partnerName={partnerName} act={act} onRematch={rematch} />}
      {match?.game === "draw" && <DrawGuess match={match as MatchView<DrawState>} language={language} userId={userId} partnerName={partnerName} act={act} onRematch={rematch} />}
    </div></MobileScroll></div>
  </>;
}
