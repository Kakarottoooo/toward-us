import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CaretDown, PawPrint, Play, User, X } from "@phosphor-icons/react";
import { counted, localized, type Language } from "../../i18n";
import { MobileScroll, useKeyboard } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";
import { categories, gameCatalog, type CategoryId, type GameEntry } from "./catalog";
import { MatchScreen } from "./MatchScreen";
import { BOTH, PET, type Hall, type MatchView } from "./types";
import "./games.css";

/** 游戏大厅: every game by category with how to play it, games still going at the top, and each game's own screen. */
export function GameHall({ language, userId, initialMatch = null, petPicture = null, onClose, onPlayCard }: { language: Language; userId: string; initialMatch?: string | null; petPicture?: string | null; onClose: () => void; onPlayCard: (type: "choice" | "guess" | "truth") => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const [hall, setHall] = useState<Hall | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState("");
  const [open, setOpen] = useState<string | null>(initialMatch), [category, setCategory] = useState<CategoryId | "all">("all"), [rules, setRules] = useState<string | null>(null);
  const [changed, setChanged] = useState<{ id: string; at: number } | null>(null), [ending, setEnding] = useState<string | null>(null);
  const load = useCallback(async () => { try { setHall(await relationshipApi<Hall>(`/api/matches?language=${language}`)); setError(""); } catch (caught) { setError((caught as Error).message); } }, [language]);
  useEffect(() => { void load(); }, [load]);
  // A move by the other one shows up right away while either screen is open.
  useEffect(() => {
    const events = new EventSource("/api/relationship/events");
    events.addEventListener("relationship", (event) => { try { const data = JSON.parse((event as MessageEvent).data); if (data.eventType === "match.updated") { setChanged({ id: data.objectId, at: Date.now() }); void load(); } } catch { /* ignore */ } });
    return () => events.close();
  }, [load]);
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !open) onClose(); }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); }, [onClose, open]);

  const catalog = useMemo(() => gameCatalog(language), [language]);
  const sections = categories(language).filter((item) => catalog.some((game) => game.category === item.id));
  const partner = hall?.members.find((member) => member.id !== userId);
  const partnerName = partner?.name || t("TA", "your partner", "tu pareja");
  // 小家伙, their pet, plays the other side when the partner isn't around (founder 11-06); those games are only for me.
  const petName = t("小家伙", "Little one", "Pequeñín");
  const vsPet = (match: MatchView) => match.players.includes(PET);
  const going = (hall?.matches || []).filter((match) => match.status === "active");
  // A game nobody has touched for a week stops asking: it folds away under "很久没动的" (founder 11-06).
  const daysIdle = (match: MatchView) => Math.floor((Date.now() - Date.parse(match.updatedAt)) / 86_400_000);
  const fresh = going.filter((match) => daysIdle(match) < 7), stale = going.filter((match) => daysIdle(match) >= 7);
  const end = async (ids: string[]) => {
    setEnding(null); setError("");
    try { for (const id of ids) await relationshipApi(`/api/matches/${encodeURIComponent(id)}/actions`, jsonBody({ type: "abandon", language })); }
    catch (caught) { setError((caught as Error).message); }
    await load();
  };
  // The End button on a row and "end them all": the first tap asks, the second ends.
  const confirmEnd = (key: string, ids: string[]) => { if (ending !== key) { setEnding(key); return; } void end(ids); };
  const row = (match: MatchView, idle = false) => <div key={match.id} className={`game-going-row ${!idle && (match.turn === userId || match.turn === BOTH) ? "is-mine" : ""}`}>
    <button type="button" className="game-going-open" onClick={() => setOpen(match.id)} data-testid="game-going">
      <span>{catalog.find((game) => game.id === match.game)?.icon}</span>
      <b>{nameOf(match.game)}{vsPet(match) && <em> · {t(`和${petName}`, `with ${petName}`, `con ${petName}`)}</em>}</b>
      <small>{idle ? t(`停了 ${daysIdle(match)} 天`, `Idle ${counted(daysIdle(match), "day", "days")}`, `Parada ${counted(daysIdle(match), "día", "días")}`) : match.turn === userId || match.turn === BOTH ? t("轮到你了", "Your turn", "Te toca") : t(`等 ${vsPet(match) ? petName : partnerName}`, `Waiting for ${vsPet(match) ? petName : partnerName}`, `Esperando a ${vsPet(match) ? petName : partnerName}`)}</small>
    </button>
    <button type="button" className={`game-going-end ${ending === match.id ? "is-confirm" : ""}`} onClick={() => confirmEnd(match.id, [match.id])} onBlur={() => setEnding((value) => value === match.id ? null : value)} aria-label={ending === match.id ? t("确定结束这局", "End this game", "Terminar esta partida") : t(`结束这局${nameOf(match.game)}`, `End this game of ${nameOf(match.game)}`, `Terminar esta partida de ${nameOf(match.game)}`)} data-testid="game-going-end">
      {ending === match.id ? t("结束？", "End?", "¿Fin?") : <X size={16} weight="bold" />}
    </button>
  </div>;
  const start = async (game: GameEntry, pet = false) => {
    if (game.kind === "card") { keyboard.hide(); onPlayCard(game.cardType!); return; }
    const existing = going.find((match) => match.game === game.id && vsPet(match) === pet);
    if (existing) { setOpen(existing.id); return; }
    setBusy(`${game.id}:${pet}`); setError("");
    try { const result = await relationshipApi<{ match: MatchView }>("/api/matches", jsonBody({ game: game.id, language, ...(pet ? { with: "pet" } : {}) })); await load(); setOpen(result.match.id); }
    catch (caught) { setError((caught as Error).message); } finally { setBusy(""); }
  };
  // Each game's line in the hall, from what its server module counts: wins (board games, 石头剪刀布), drawings guessed
  // together (你画我猜), lies caught (两个真相一个谎言), puzzles solved (海龟汤).
  type Stat = { wins?: Record<string, number>; played?: number; guessed?: number; caught?: Record<string, number>; solved?: number };
  const line = (stat: Stat | undefined, other: string, otherName: string, prefix: [string, string, string]) => {
    if (!stat?.played) return "";
    const [zh, en, es] = prefix;
    if (stat.wins) return t(`${zh}你 ${stat.wins[userId] || 0} : ${stat.wins[other] || 0} ${otherName}`, `${en}You ${stat.wins[userId] || 0} : ${stat.wins[other] || 0} ${otherName}`, `${es}Tú ${stat.wins[userId] || 0} : ${stat.wins[other] || 0} ${otherName}`);
    if (stat.guessed !== undefined) return t(`${zh}一起猜中 ${stat.guessed}/${stat.played} 幅`, `${en}Guessed ${stat.guessed} of ${stat.played} together`, `${es}Acertaron ${stat.guessed} de ${stat.played}`);
    if (stat.caught) return t(`${zh}你识破 ${stat.caught[userId] || 0} 次 · ${otherName} ${stat.caught[other] || 0} 次`, `${en}You caught ${stat.caught[userId] || 0} · ${otherName} ${stat.caught[other] || 0}`, `${es}Atrapaste ${stat.caught[userId] || 0} · ${otherName} ${stat.caught[other] || 0}`);
    if (stat.solved !== undefined) return t(`${zh}解开 ${stat.solved}/${stat.played} 碗`, `${en}Solved ${stat.solved} of ${stat.played}`, `${es}Resueltos ${stat.solved} de ${stat.played}`);
    return "";
  };
  const stats = (hall?.stats || {}) as Record<string, Stat>, petStats = (hall?.petStats || {}) as Record<string, Stat>;
  const stat = (game: GameEntry) => line(stats[game.id], partner?.id || "", partnerName, ["", "", ""]);
  const petStat = (game: GameEntry) => line(petStats[game.id], PET, petName, [`和${petName} · `, `With ${petName} · `, `Con ${petName} · `]);
  const nameOf = (id: string) => catalog.find((game) => game.id === id)?.name || id;

  if (open) return <div className="game-hall" role="dialog" aria-modal="true" aria-label={t("游戏", "Games", "Juegos")} data-testid="game-hall">
    <MatchScreen key={open} matchId={open} solo={(id) => Boolean(catalog.find((game) => game.id === id)?.solo)} language={language} userId={userId} members={hall?.members || []} pet={{ name: petName, picture: petPicture }} changed={changed?.id === open ? changed.at : 0} name={nameOf} onBack={() => { keyboard.hide(); setOpen(null); void load(); }} onRematch={async (game, pet) => { const result = await relationshipApi<{ match: MatchView }>("/api/matches", jsonBody({ game, language, ...(pet ? { with: "pet" } : {}) })); await load(); setOpen(result.match.id); }} />
  </div>;

  const shown = category === "all" ? sections : sections.filter((item) => item.id === category);
  return <div className="game-hall" role="dialog" aria-modal="true" aria-label={t("游戏", "Games", "Juegos")} data-testid="game-hall">
    <header className="game-top"><button type="button" className="page-back" onClick={onClose} data-testid="game-hall-close" autoFocus><ArrowLeft size={20} />{t("对话", "Chat", "Chat")}</button><h1>{t("小游戏", "Games", "Juegos")}</h1></header>
    <div className="game-stream"><MobileScroll className="game-scroll"><div className="game-body">
      {error && <p className="space-error" role="alert">{error}</p>}
      {fresh.length > 0 && <section className="game-going" aria-label={t("还没玩完", "Still going", "En curso")}>{fresh.map((match) => row(match))}</section>}
      {stale.length > 0 && <details className="game-stale" data-testid="game-stale">
        <summary>{t(`很久没动的（${stale.length}）`, `Not touched in a while (${stale.length})`, `Sin tocar hace tiempo (${stale.length})`)}</summary>
        <div className="game-going">{stale.map((match) => row(match, true))}</div>
        <button type="button" className={`game-quiet ${ending === "stale" ? "is-confirm" : ""}`} onClick={() => confirmEnd("stale", stale.map((match) => match.id))} onBlur={() => setEnding((value) => value === "stale" ? null : value)} data-testid="game-stale-end">{ending === "stale" ? t(`确定结束这 ${stale.length} 局？`, `End all ${stale.length}?`, `¿Terminar las ${stale.length}?`) : t("全部结束", "End them all", "Terminarlas todas")}</button>
      </details>}
      {sections.length > 1 && <div className="game-tabs" role="tablist" aria-label={t("分类", "Categories", "Categorías")}>
        {[{ id: "all" as const, name: t("全部", "All", "Todos") }, ...sections].map((item) => <button key={item.id} type="button" role="tab" aria-selected={category === item.id} className={category === item.id ? "is-on" : ""} onClick={() => setCategory(item.id)} data-testid={`game-tab-${item.id}`}>{item.name}</button>)}
      </div>}
      {shown.map((section) => <section key={section.id} className="game-section" data-testid={`game-section-${section.id}`}>
        <h2>{section.name}</h2>
        {catalog.filter((game) => game.category === section.id).map((game) => {
          const ongoing = going.find((match) => match.game === game.id && !vsPet(match)), petGoing = going.find((match) => match.game === game.id && vsPet(match)), line = stat(game), petLine = petStat(game);
          return <article key={game.id} className="game-card" data-testid={`game-${game.id}`}>
            <div className="game-card-head">
              <span className="game-card-icon" aria-hidden="true">{game.icon}</span>
              <div><h3>{game.name}</h3><p>{game.tagline}</p>{line && <small className="game-stat">{line}</small>}{petLine && <small className="game-stat is-pet">{petLine}</small>}</div>
            </div>
            <div className="game-card-foot">
              <button type="button" className="game-rules-toggle" aria-expanded={rules === game.id} onClick={() => setRules(rules === game.id ? null : game.id)} data-testid={`game-rules-${game.id}`}><CaretDown size={14} />{t("怎么玩", "How to play", "Cómo se juega")}</button>
              {game.kind === "match" && <button type="button" className="game-play is-pet" disabled={busy === `${game.id}:true`} onClick={() => void start(game, true)} data-testid={`game-pet-${game.id}`}>{game.solo ? <User size={15} weight="fill" /> : petPicture ? <img src={petPicture} alt="" /> : <PawPrint size={15} weight="fill" />}{game.solo ? (petGoing ? t("继续一个人玩", "Continue solo", "Seguir solo") : t("一个人玩", "Play solo", "Jugar solo")) : petGoing ? t(`继续和${petName}`, `Continue with ${petName}`, `Seguir con ${petName}`) : t(`和${petName}玩`, `Play ${petName}`, `Con ${petName}`)}</button>}
              <button type="button" className="game-play" disabled={busy === `${game.id}:false` || hall?.readOnly} onClick={() => void start(game)} data-testid={`game-start-${game.id}`}><Play size={14} weight="fill" />{ongoing ? t("继续", "Continue", "Seguir") : game.kind === "card" ? t("在对话里玩", "Play in chat", "Jugar en el chat") : t("和 TA 玩", "Play your partner", "Con tu pareja")}</button>
            </div>
            {rules === game.id && <ol className="game-rules">{game.rules.map((rule) => <li key={rule}>{rule}</li>)}</ol>}
          </article>;
        })}
      </section>)}
      <p className="game-foot">{t("更多游戏正在路上。", "More games are on the way.", "Vienen más juegos.")}</p>
    </div></MobileScroll></div>
  </div>;
}
