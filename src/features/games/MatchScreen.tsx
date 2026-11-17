import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ComponentType } from "react";
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
import { TreasureHunt } from "./TreasureHunt";
import { PhotoDetective } from "./PhotoDetective";
import { DotsBoxes } from "./DotsBoxes";
import { DoodleRelay } from "./DoodleRelay";
import { Jigsaw } from "./Jigsaw";
import { PET, hasReplay, type MatchView, type Member } from "./types";

export type Opponent = { name: string; picture: string | null; pet: boolean };

export type Act = (action: Record<string, unknown>) => Promise<boolean>;

/** What every game screen gets. `opponent` is the partner or 小家伙; `act` sends one move and resolves true when it was taken. */
export type ScreenProps<State = unknown> = { match: MatchView<State>; language: Language; userId: string; partnerName: string; opponent: Opponent; act: Act; onRematch: () => void; visible?: boolean };

// Games played in rounds end with their own button at the bottom (their rounds count); the header doesn't repeat it.
const OWN_END = new Set(["draw", "truths", "rps", "doodle", "jigsaw", "detective", "sokoban", "kitchen", "timeline", "photo-relay", "song",
  "escape-room", "spot-difference", "memory-pairs", "date-budget", "forbidden-words", "mines-duo"]);

// Each game's own screen, by game id (server/matches/index.mjs GAMES). Adding a game adds one line here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SCREENS: Record<string, ComponentType<ScreenProps<any>>> = {
  gomoku: Gomoku, draw: DrawGuess, reversi: Reversi, connect4: ConnectFour, truths: TwoTruths, rps: Rps, xiangqi: Xiangqi,
  ludo: Ludo, soup: Soup, hunt: TreasureHunt, dots: DotsBoxes, doodle: DoodleRelay, jigsaw: Jigsaw, detective: PhotoDetective,
  sokoban: lazy(() => import("./Sokoban").then(({ Sokoban }) => ({ default: Sokoban }))),
  battleship: lazy(() => import("./Battleship").then(({ Battleship }) => ({ default: Battleship }))),
  kitchen: lazy(() => import("./Kitchen").then(({ Kitchen }) => ({ default: Kitchen }))),
  timeline: lazy(() => import("./MemoryTimeline").then(({ MemoryTimeline }) => ({ default: MemoryTimeline }))),
  "photo-relay": lazy(() => import("./PhotoRelay").then(({ PhotoRelay }) => ({ default: PhotoRelay }))),
  song: lazy(() => import("./SongRelay").then(({ SongRelay }) => ({ default: SongRelay }))),
  "escape-room": lazy(() => import("./EscapeRoom").then(({ EscapeRoom }) => ({ default: EscapeRoom }))),
  "spot-difference": lazy(() => import("./SpotDifference").then(({ SpotDifference }) => ({ default: SpotDifference }))),
  "memory-pairs": lazy(() => import("./MemoryPairs").then(({ MemoryPairs }) => ({ default: MemoryPairs }))),
  "date-budget": lazy(() => import("./DateBudget").then(({ DateBudget }) => ({ default: DateBudget }))),
  "liar-dice": lazy(() => import("./LiarDice").then(({ LiarDice }) => ({ default: LiarDice }))),
  "mini-golf": lazy(() => import("./MiniGolf").then(({ MiniGolf }) => ({ default: MiniGolf }))),
  "stack-tower": lazy(() => import("./StackTower").then(({ StackTower }) => ({ default: StackTower }))),
  "forbidden-words": lazy(() => import("./ForbiddenWords").then(({ ForbiddenWords }) => ({ default: ForbiddenWords }))),
  "air-hockey": lazy(() => import("./AirHockey").then(({ AirHockey }) => ({ default: AirHockey }))),
  "pinball-duo": lazy(() => import("./PinballDuo").then(({ PinballDuo }) => ({ default: PinballDuo }))),
  "block-duel": lazy(() => import("./BlockDuel").then(({ BlockDuel }) => ({ default: BlockDuel }))),
  "co-pilot": lazy(() => import("./CoPilot").then(({ CoPilot }) => ({ default: CoPilot }))),
  "river-row": lazy(() => import("./RiverRow").then(({ RiverRow }) => ({ default: RiverRow }))),
  "green-light": lazy(() => import("./GreenLight").then(({ GreenLight }) => ({ default: GreenLight }))),
  "mines-duo": lazy(() => import("./MinesDuo").then(({ MinesDuo }) => ({ default: MinesDuo }))),
  "crazy-eights": lazy(() => import("./CrazyEights").then(({ CrazyEights }) => ({ default: CrazyEights }))),
};

/** One game's own screen. Loads the match, reloads when the other one moves (`changed`), and sends this player's moves. */
export function MatchScreen({ matchId, language, userId, members, pet, changed, name, solo = () => false, embedded = false, visible = true, onBack, onRematch }: { embedded?: boolean; visible?: boolean; solo?: (game: string) => boolean; matchId: string; language: Language; userId: string; members: Member[]; pet: { name: string; picture: string | null }; changed: number; name: (game: string) => string; onBack: () => void; onRematch: (game: string, pet: boolean) => Promise<void> }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [match, setMatch] = useState<MatchView | null>(null), [error, setError] = useState(""), [ending, setEnding] = useState(false);
  const update = (next: MatchView) => setMatch((current) => current && current.id === next.id && current.version > next.version ? current : next);
  const load = useCallback(async (showError = true) => {
    try { update((await relationshipApi<{ match: MatchView }>(`/api/matches/${encodeURIComponent(matchId)}?language=${language}`)).match); if (showError) setError(""); }
    catch (caught) { if (showError) setError((caught as Error).message); }
  }, [matchId, language]);
  useEffect(() => { void load(); }, [load, changed]);
  const refreshOnReturn = Boolean(match && hasReplay(match.game));
  const wasHidden = useRef(false);
  useEffect(() => {
    if (!refreshOnReturn) return;
    if (!visible) { wasHidden.current = true; return; }
    const refresh = () => { if (!document.hidden) void load(false); };
    if (wasHidden.current) {
      wasHidden.current = false;
      refresh();
    }
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refreshOnReturn, visible, load]);
  const act: Act = async (action) => {
    setError("");
    const path = `/api/matches/${encodeURIComponent(matchId)}`;
    const upload = match?.game === "photo-relay" && action.type === "submit" && action.bytes instanceof Blob;
    try {
      const result = upload
        ? await relationshipApi<{ match: MatchView }>(`${path}/relay-photo?language=${language}`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: action.bytes as Blob })
        : await relationshipApi<{ match: MatchView }>(`${path}/actions`, jsonBody({ ...action, language }));
      update(result.match);
      return true;
    } catch (caught) {
      setError((caught as Error).message);
      void load(!match || !hasReplay(match.game));
      return false;
    }
  };
  const withPet = Boolean(match?.players.includes(PET));
  const rematch = async () => { setError(""); try { await onRematch(match!.game, withPet); } catch (caught) { setError((caught as Error).message); } };
  const partner = members.find((member) => member.id !== userId);
  // With 小家伙 it is the other player: its name, its picture, and no "we'll tell you" (it answers right away).
  const partnerName = withPet ? pet.name : partner?.name || t("TA", "your partner", "tu pareja");
  const opponent = { name: partnerName, picture: withPet ? pet.picture : null, pet: withPet };
  const opening = <p className="game-wait" role="status">{t("正在打开…", "Opening…", "Abriendo…")}</p>;
  const body = <div className={embedded ? `game-body match-body match-in-chat${match?.game === "hunt" ? " match-hunt" : ""}` : "game-body match-body"} data-testid="match-screen">
      {embedded && match && match.game !== "hunt" && <h2>{name(match.game)}</h2>}
      {error && <p className="space-error" role="alert">{error}{!match && <button type="button" className="game-quiet" onClick={() => void load()}>{t("重试", "Retry", "Reintentar")}</button>}</p>}
      {!match && !error && opening}
      {match?.status === "ended" && <section className="game-ended" data-testid="match-ended">
        <p>{match.endedBy === userId ? t("你结束了这局。没下完，不算输赢。", "You ended this game. It doesn't count for anyone.", "Terminaste esta partida. No cuenta para nadie.") : t(`${partnerName} 结束了这局。没下完，不算输赢。`, `${partnerName} ended this game. It doesn't count for anyone.`, `${partnerName} terminó esta partida. No cuenta para nadie.`)}</p>
        <button type="button" className="game-primary" onClick={() => void rematch()} data-testid="game-rematch"><ArrowsClockwise size={16} />{t("再来一局", "Play again", "Otra partida")}</button>
      </section>}
      {match && match.status !== "ended" && SCREENS[match.game] && (() => { const Screen = SCREENS[match.game]; return <Suspense fallback={opening}><Screen key={match.id} match={match} language={language} userId={userId} partnerName={partnerName} opponent={opponent} act={act} onRematch={rematch} visible={visible} /></Suspense>; })()}
  </div>;
  if (embedded) return body;
  return <>
    <header className="game-top has-side"><button type="button" className="page-back" onClick={onBack} data-testid="match-back" autoFocus><ArrowLeft size={20} />{t("游戏", "Games", "Juegos")}</button><h1>{match ? withPet && !solo(match.game) ? `${name(match.game)} · ${pet.name}` : name(match.game) : ""}</h1>
      {/* Stops the game for both, no winner (founder 11-06); a second tap confirms. */}
      <span className="game-top-side">{match?.status === "active" && !OWN_END.has(match.game) && <button type="button" className={`game-end ${ending ? "is-confirm" : ""}`} onClick={() => { if (!ending) { setEnding(true); return; } setEnding(false); void act({ type: "abandon" }); }} onBlur={() => setEnding(false)} data-testid="match-end">{ending ? t("确定结束？", "End it?", "¿Terminar?") : <><X size={14} weight="bold" />{t("结束", "End", "Terminar")}</>}</button>}</span>
    </header>
    <div className="game-stream"><MobileScroll className="game-scroll">{body}</MobileScroll></div>
  </>;
}
