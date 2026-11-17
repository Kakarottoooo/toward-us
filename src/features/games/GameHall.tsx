import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CaretDown, CaretRight, ChatsCircle, ClockCounterClockwise, MagnifyingGlass, PawPrint, Play, SlidersHorizontal, User, X } from "@phosphor-icons/react";
import { counted, localized, type Language } from "../../i18n";
import { BottomSheet, KeyboardInput, MobileScroll, useKeyboard } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";
import { categories, gameCatalog, matchesGameMode, type CategoryId, type GameEntry, type GameMode } from "./catalog";
import { MatchScreen } from "./MatchScreen";
import { BOTH, PET, playsInChat, type ChatGame, type Hall, type MatchView } from "./types";
import "./games.css";

const searchable = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().trim();

/** 游戏大厅: find a game by name, play style or type, and reopen a round from history. */
export function GameHall({ language, userId, initialMatch = null, petPicture = null, onClose, onChatMatch, onQuestions }: { language: Language; userId: string; initialMatch?: string | null; petPicture?: string | null; onClose: () => void; onChatMatch: (game: ChatGame, id: string) => void; onQuestions: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const [hall, setHall] = useState<Hall | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState("");
  const [open, setOpen] = useState<string | null>(initialMatch), [category, setCategory] = useState<CategoryId | "all">("all"), [rules, setRules] = useState<string | null>(null);
  const [mode, setMode] = useState<GameMode>("all"), [search, setSearch] = useState("");
  const [sheet, setSheet] = useState<"type" | "history" | null>(null);
  const [draftType, setDraftType] = useState<CategoryId | "all">("all");
  const [historyError, setHistoryError] = useState("");
  const [changed, setChanged] = useState<{ id: string; at: number } | null>(null), [ending, setEnding] = useState<string | null>(null);
  const load = useCallback(async () => { try { setHall(await relationshipApi<Hall>(`/api/matches?language=${language}`)); setError(""); } catch (caught) { setError((caught as Error).message); } }, [language]);
  useEffect(() => { void load(); }, [load]);
  // A move by the other one shows up right away while either screen is open.
  useEffect(() => {
    const events = new EventSource("/api/relationship/events");
    events.addEventListener("relationship", (event) => { try { const data = JSON.parse((event as MessageEvent).data); if (data.eventType === "match.updated") { setChanged({ id: data.objectId, at: Date.now() }); void load(); } } catch { /* ignore */ } });
    return () => events.close();
  }, [load]);
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented && !open && !sheet) onClose(); }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); }, [onClose, open, sheet]);

  const catalog = useMemo(() => gameCatalog(language), [language]);
  const sections = categories(language).filter((item) => catalog.some((game) => game.category === item.id));
  const partner = hall?.members.find((member) => member.id !== userId);
  const partnerName = partner?.name || t("TA", "your partner", "tu pareja");
  // 小家伙, their pet, plays the other side when the partner isn't around (founder 11-06); those games are only for me.
  const petName = t("小家伙", "Little one", "Pequeñín");
  const vsPet = (match: MatchView) => match.players.includes(PET);
  const closeSheet = () => { setSheet(null); setEnding(null); };
  const openMatch = (match: MatchView) => {
    keyboard.hide();
    closeSheet();
    if (playsInChat(match.game) && !vsPet(match)) onChatMatch(match.game, match.id);
    else setOpen(match.id);
  };
  const going = (hall?.matches || []).filter((match) => match.status === "active");
  const recent = (hall?.matches || []).filter((match) => match.status === "finished");
  // A game nobody has touched for a week stops asking: it folds away under "很久没动的" (founder 11-06).
  const daysIdle = (match: MatchView) => Math.floor((Date.now() - Date.parse(match.updatedAt)) / 86_400_000);
  const fresh = going.filter((match) => daysIdle(match) < 7), stale = going.filter((match) => daysIdle(match) >= 7);
  const end = async (ids: string[]) => {
    setEnding(null); setHistoryError(""); setBusy("history");
    try { for (const id of ids) await relationshipApi(`/api/matches/${encodeURIComponent(id)}/actions`, jsonBody({ type: "abandon", language })); }
    catch (caught) { setHistoryError((caught as Error).message); }
    finally { await load(); setBusy(""); }
  };
  // The End button on a row and "end them all": the first tap asks, the second ends.
  const confirmEnd = (key: string, ids: string[]) => { if (ending !== key) { setEnding(key); return; } void end(ids); };
  const row = (match: MatchView, idle = false) => <div key={match.id} className={`game-going-row ${!idle && (match.turn === userId || match.turn === BOTH) ? "is-mine" : ""}`}>
    <button type="button" className="game-going-open" onClick={() => openMatch(match)} data-testid="game-going">
      <span>{catalog.find((game) => game.id === match.game)?.icon}</span>
      <b>{nameOf(match.game)}{vsPet(match) && <em> · {t(`和${petName}`, `with ${petName}`, `con ${petName}`)}</em>}</b>
      <small>{idle ? t(`停了 ${daysIdle(match)} 天`, `Idle ${counted(daysIdle(match), "day", "days")}`, `Parada ${counted(daysIdle(match), "día", "días")}`) : match.turn === userId || match.turn === BOTH ? t("轮到你了", "Your turn", "Te toca") : t(`等 ${vsPet(match) ? petName : partnerName}`, `Waiting for ${vsPet(match) ? petName : partnerName}`, `Esperando a ${vsPet(match) ? petName : partnerName}`)}</small>
    </button>
    <button type="button" className={`game-going-end ${ending === match.id ? "is-confirm" : ""}`} disabled={busy === "history" || hall?.readOnly} onClick={() => confirmEnd(match.id, [match.id])} onBlur={() => setEnding((value) => value === match.id ? null : value)} aria-label={ending === match.id ? t("确定结束这局", "End this game", "Terminar esta partida") : t(`结束这局${nameOf(match.game)}`, `End this game of ${nameOf(match.game)}`, `Terminar esta partida de ${nameOf(match.game)}`)} data-testid="game-going-end">
      {ending === match.id ? t("结束？", "End?", "¿Fin?") : <X size={16} weight="bold" />}
    </button>
  </div>;
  const start = async (game: GameEntry, pet = false) => {
    const existing = going.find((match) => match.game === game.id && vsPet(match) === pet);
    if (existing) { openMatch(existing); return; }
    setBusy(`${game.id}:${pet}`); setError("");
    try { const result = await relationshipApi<{ match: MatchView }>("/api/matches", jsonBody({ game: game.id, language, ...(pet ? { with: "pet" } : {}) })); await load(); openMatch(result.match); }
    catch (caught) { setError((caught as Error).message); } finally { setBusy(""); }
  };
  // Each game's line in the hall, from what its server module counts: wins (board games, 石头剪刀布), drawings guessed
  // together (你画我猜), lies caught (两个真相一个谎言), puzzles solved (海龟汤).
  type Stat = { wins?: Record<string, number>; played?: number; guessed?: number; caught?: Record<string, number>; solved?: number; assembled?: number; found?: number };
  const line = (stat: Stat | undefined, other: string, otherName: string, prefix: [string, string, string]) => {
    if (!stat?.played) return "";
    const [zh, en, es] = prefix;
    if (stat.wins) return t(`${zh}你 ${stat.wins[userId] || 0} : ${stat.wins[other] || 0} ${otherName}`, `${en}You ${stat.wins[userId] || 0} : ${stat.wins[other] || 0} ${otherName}`, `${es}Tú ${stat.wins[userId] || 0} : ${stat.wins[other] || 0} ${otherName}`);
    if (stat.guessed !== undefined) return t(`${zh}一起猜中 ${stat.guessed}/${stat.played} 幅`, `${en}Guessed ${stat.guessed} of ${stat.played} together`, `${es}Acertaron ${stat.guessed} de ${stat.played}`);
    if (stat.caught) return t(`${zh}你识破 ${stat.caught[userId] || 0} 次 · ${otherName} ${stat.caught[other] || 0} 次`, `${en}You caught ${stat.caught[userId] || 0} · ${otherName} ${stat.caught[other] || 0}`, `${es}Atrapaste ${stat.caught[userId] || 0} · ${otherName} ${stat.caught[other] || 0}`);
    if (stat.found !== undefined) return t(`一起找到 ${stat.found}/${stat.played} 张地图的宝物`, `Found ${stat.found}/${stat.played} treasures together`, `Encontraron ${stat.found}/${stat.played} tesoros juntos`);
    if (stat.assembled !== undefined) return t(`${zh}拼好 ${stat.assembled}/${stat.played} 张`, `${en}Completed ${stat.assembled} of ${stat.played} puzzles`, `${es}Completaron ${stat.assembled} de ${stat.played} rompecabezas`);
    if (stat.solved !== undefined) return t(`${zh}解开 ${stat.solved}/${stat.played} 碗`, `${en}Solved ${stat.solved} of ${stat.played}`, `${es}Resueltos ${stat.solved} de ${stat.played}`);
    return "";
  };
  const stats = (hall?.stats || {}) as Record<string, Stat>, petStats = (hall?.petStats || {}) as Record<string, Stat>;
  const stat = (game: GameEntry) => line(stats[game.id], partner?.id || "", partnerName, ["", "", ""]);
  const petStat = (game: GameEntry) => line(petStats[game.id], PET, petName, [`和${petName} · `, `With ${petName} · `, `Con ${petName} · `]);
  const nameOf = (id: string) => catalog.find((game) => game.id === id)?.name || id;

  const openingGame = open && hall?.matches.find((match) => match.id === open && !vsPet(match))?.game;
  const openingInChat = Boolean(openingGame && playsInChat(openingGame));
  useEffect(() => { if (open && openingGame && playsInChat(openingGame)) onChatMatch(openingGame, open); }, [open, openingGame, onChatMatch]);
  if (open && (openingInChat || !hall && !error)) return <div className="game-hall" role="dialog" aria-modal="true" aria-label={t("游戏", "Games", "Juegos")}>
    <p className="game-wait" role="status">{t("正在打开…", "Opening…", "Abriendo…")}</p>
  </div>;
  if (open) return <div className="game-hall" role="dialog" aria-modal="true" aria-label={t("游戏", "Games", "Juegos")} data-testid="game-hall">
    <MatchScreen key={open} matchId={open} solo={(id) => Boolean(catalog.find((game) => game.id === id)?.solo)} language={language} userId={userId} members={hall?.members || []} pet={{ name: petName, picture: petPicture }} changed={changed?.id === open ? changed.at : 0} name={nameOf} onBack={() => { keyboard.hide(); setOpen(null); void load(); }} onRematch={async (game, pet) => { const result = await relationshipApi<{ match: MatchView }>("/api/matches", jsonBody({ game, language, ...(pet ? { with: "pet" } : {}) })); await load(); setOpen(result.match.id); }} />
  </div>;

  const modeOptions: [GameMode, string][] = [
    ["all", t("全部", "All", "Todos")], ["coop", t("合作", "Co-op", "Cooperar")],
    ["versus", t("对战", "Versus", "Competir")], ["solo", t("单人", "Solo", "Solo")],
  ];
  const typeOptions = [{ id: "all" as const, name: t("全部类型", "All types", "Todos los tipos") }, ...sections];
  const searchLabel = t("搜索游戏", "Search games", "Buscar juegos");
  const typeLabel = t("类型", "Type", "Tipo");
  const typeName = typeOptions.find((item) => item.id === category)?.name || typeLabel;
  const historyLabel = t("对局", "Matches", "Partidas");
  const query = searchable(search);
  const deckName = t("双人题卡", "Cards for two", "Cartas para dos");
  const deckMatches = (mode === "all" || mode === "coop") && (!query || searchable(deckName).includes(query) ||
    catalog.some((game) => game.kind === "card" && searchable(game.name).includes(query)));
  const matchingGames = catalog.filter((game) => game.kind === "match" && matchesGameMode(game, mode) && (!query || searchable(game.name).includes(query)));
  const shown = sections.filter(({ id }) => (category === "all" || category === id) &&
    (id === "words" && deckMatches || matchingGames.some((game) => game.category === id)));
  const shortDate = new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : language, { month: "short", day: "numeric" });
  return <div className="game-hall" role="dialog" aria-modal="true" aria-label={t("游戏", "Games", "Juegos")} data-testid="game-hall">
    <header className="game-top game-hall-header">
      <button type="button" className="page-back" onClick={() => { keyboard.hide(); onClose(); }} data-testid="game-hall-close" autoFocus><ArrowLeft size={20} />{t("对话", "Chat", "Chat")}</button>
      <h1>{t("小游戏", "Games", "Juegos")}</h1>
      <button type="button" className="game-history-entry" aria-haspopup="dialog" data-testid="game-history-open"
        onClick={() => { keyboard.hide(); setHistoryError(""); setSheet("history"); }}><ClockCounterClockwise size={19} aria-hidden="true" />{historyLabel}</button>
    </header>
    <section className="game-hall-filters" aria-label={t("筛选游戏", "Filter games", "Filtrar juegos")}>
      <div className="game-filter-search-row">
        <div className="game-filter-search">
          <MagnifyingGlass size={21} aria-hidden="true" />
          <KeyboardInput type="search" aria-label={searchLabel} placeholder={searchLabel} value={search} maxLength={80} enterKeyHint="search" autoComplete="off"
            onChange={(event) => setSearch(event.currentTarget.value)} onBlur={() => keyboard.hide()}
            onKeyDown={(event) => { if (["Enter", "Escape"].includes(event.key)) { event.preventDefault(); keyboard.hide(); } }} data-testid="game-search" />
          {search && <button type="button" aria-label={t("清除搜索", "Clear search", "Borrar búsqueda")} onClick={() => setSearch("")}><X size={16} aria-hidden="true" /></button>}
        </div>
        <button type="button" className={`game-type-entry${category !== "all" ? " is-active" : ""}`} aria-haspopup="dialog"
          aria-label={category === "all" ? typeLabel : t(`类型：${typeName}`, `Type: ${typeName}`, `Tipo: ${typeName}`)} data-testid="game-type-open"
          onClick={() => { keyboard.hide(); setDraftType(category); setSheet("type"); }}>
          <SlidersHorizontal size={20} aria-hidden="true" />{category === "all" ? typeLabel : typeName}
        </button>
      </div>
      <div className="game-mode-filters" role="group" aria-label={t("玩法", "Play style", "Modo de juego")}>
        {modeOptions.map(([id, name]) => <button key={id} type="button" aria-pressed={mode === id} data-testid={`game-mode-${id}`}
          onClick={() => { keyboard.hide(); setMode(id); }}>{name}</button>)}
      </div>
    </section>
    <div className="game-stream"><MobileScroll key={`${category}:${mode}:${query}`} className="game-scroll"><div className="game-body">
      {error && <p className="space-error" role="alert">{error}</p>}
      {!shown.length && <div className="game-filter-empty" role="status" data-testid="game-filter-empty">
        <p>{t("找不到符合条件的游戏。", "No games match these filters.", "Ningún juego coincide con estos filtros.")}</p>
        <button type="button" className="game-quiet" onClick={() => { keyboard.hide(); setSearch(""); setMode("all"); setCategory("all"); }}>
          {t("清除筛选", "Clear filters", "Quitar filtros")}
        </button>
      </div>}
      {shown.map((section) => <section key={section.id} className="game-section" data-testid={`game-section-${section.id}`}>
        <h2>{section.name}</h2>
        {section.id === "words" && deckMatches && <div className="game-questions">
          <button type="button" onClick={() => { keyboard.hide(); onQuestions(); }} data-testid="game-card-deck">
            <ChatsCircle size={23} aria-hidden="true" />
            <span><strong>{deckName}</strong>
              <small>{t("二选一、默契问答、真心话", "Quick picks, guesses, and heart-to-heart questions", "Elijan, adivinen o escriban lo que sienten")}</small></span>
            <CaretRight size={17} aria-hidden="true" />
          </button>
        </div>}
        {matchingGames.filter((game) => game.category === section.id).map((game) => {
          const ongoing = going.find((match) => match.game === game.id && !vsPet(match)), petGoing = going.find((match) => match.game === game.id && vsPet(match)), line = stat(game), petLine = petStat(game);
          return <article key={game.id} className="game-card" data-testid={`game-${game.id}`}>
            <div className="game-card-head">
              <span className="game-card-icon" aria-hidden="true">{game.icon}</span>
              <div><h3>{game.name}</h3><p>{game.tagline}</p>{line && <small className="game-stat">{line}</small>}{petLine && <small className="game-stat is-pet">{petLine}</small>}</div>
            </div>
            <div className="game-card-foot">
              <button type="button" className="game-rules-toggle" aria-expanded={rules === game.id} onClick={() => setRules(rules === game.id ? null : game.id)} data-testid={`game-rules-${game.id}`}><CaretDown size={14} />{t("怎么玩", "How to play", "Cómo se juega")}</button>
              {game.kind === "match" && !game.partnerOnly && <button type="button" className="game-play is-pet" disabled={busy === `${game.id}:true`} onClick={() => void start(game, true)} data-testid={`game-pet-${game.id}`}>{game.solo ? <User size={15} weight="fill" /> : petPicture ? <img src={petPicture} alt="" /> : <PawPrint size={15} weight="fill" />}{game.solo ? (petGoing ? t("继续一个人玩", "Continue solo", "Seguir solo") : t("一个人玩", "Play solo", "Jugar solo")) : petGoing ? t(`继续和${petName}`, `Continue with ${petName}`, `Seguir con ${petName}`) : t(`和${petName}玩`, `Play ${petName}`, `Con ${petName}`)}</button>}
              <button type="button" className="game-play" disabled={busy === `${game.id}:false` || hall?.readOnly} onClick={() => void start(game)} data-testid={`game-start-${game.id}`}><Play size={14} weight="fill" />{ongoing ? t("继续", "Continue", "Seguir") : playsInChat(game.id) ? t("在对话里玩", "Play in chat", "Jugar en el chat") : t("和 TA 玩", "Play your partner", "Con tu pareja")}</button>
            </div>
            {rules === game.id && <ol className="game-rules">{game.rules.map((rule) => <li key={rule}>{rule}</li>)}</ol>}
          </article>;
        })}
      </section>)}
      {shown.length > 0 && <p className="game-foot">{t("更多游戏正在路上。", "More games are on the way.", "Vienen más juegos.")}</p>}
    </div></MobileScroll></div>
    <BottomSheet open={sheet !== null} title={sheet === "history" ? historyLabel : t("按类型筛选", "Filter by type", "Filtrar por tipo")}
      snap={sheet === "history" ? 0.72 : 0.48} onOpenChange={(isOpen) => { if (!isOpen) closeSheet(); }}>
      <div className="game-hall-sheet" data-testid={sheet === "history" ? "game-history-sheet" : "game-type-sheet"}>
        <button type="button" className="game-sheet-close" aria-label={t("关闭", "Close", "Cerrar")} onClick={closeSheet}><X size={22} aria-hidden="true" /></button>
        {sheet === "type" ? <>
          <div className="game-type-options" role="group" aria-label={typeLabel}>
            {typeOptions.map((item) => <button key={item.id} type="button" aria-pressed={draftType === item.id} data-testid={`game-type-${item.id}`}
              onClick={() => setDraftType(item.id)}>{item.name}</button>)}
          </div>
          <button type="button" className="game-primary game-type-apply" data-testid="game-type-apply" onClick={() => { setCategory(draftType); closeSheet(); }}>
            {t("应用", "Apply", "Aplicar")}
          </button>
        </> : <div className="game-history-content">
          {(historyError || error) && <p className="space-error" role="alert">{historyError || error}</p>}
          {!hall && !error && <p className="game-wait" role="status">{t("正在打开…", "Opening…", "Abriendo…")}</p>}
          {hall && !going.length && !recent.length && <p className="game-wait" role="status">{t("还没有对局。", "No matches yet.", "Todavía no hay partidas.")}</p>}
          {fresh.length > 0 && <section className="game-going" data-testid="game-history-active">
            <h3>{t("进行中", "In progress", "En curso")}</h3>{fresh.map((match) => row(match))}
          </section>}
          {stale.length > 0 && <details className="game-stale" data-testid="game-stale">
            <summary>{t(`很久没动的（${stale.length}）`, `Inactive (${stale.length})`, `Inactivas (${stale.length})`)}</summary>
            <div className="game-going">{stale.map((match) => row(match, true))}</div>
            <button type="button" className={`game-quiet ${ending === "stale" ? "is-confirm" : ""}`} disabled={busy === "history" || hall?.readOnly}
              onClick={() => confirmEnd("stale", stale.map((match) => match.id))} onBlur={() => setEnding((value) => value === "stale" ? null : value)} data-testid="game-stale-end">
              {ending === "stale" ? t(`确定结束这 ${stale.length} 局？`, `End all ${stale.length}?`, `¿Terminar las ${stale.length}?`) : t("全部结束", "End them all", "Terminarlas todas")}
            </button>
          </details>}
          {recent.length > 0 && <section className="game-going" data-testid="game-history-recent">
            <h3>{t("最近玩过", "Recently played", "Partidas recientes")}</h3>
            {recent.map((match) => <div className="game-going-row" key={match.id}>
              <button type="button" className="game-going-open" onClick={() => openMatch(match)}>
                <span aria-hidden="true">{catalog.find((game) => game.id === match.game)?.icon}</span>
                <b>{nameOf(match.game)}{vsPet(match) && <em> · {t(`和${petName}`, `with ${petName}`, `con ${petName}`)}</em>}</b>
                <small>{shortDate.format(new Date(match.finishedAt || match.updatedAt))}</small><CaretRight size={16} aria-hidden="true" />
              </button>
            </div>)}
          </section>}
        </div>}
      </div>
    </BottomSheet>
  </div>;
}
