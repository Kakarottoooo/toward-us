import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, CaretLeft, CaretRight, ClockCounterClockwise, Heart, LockKey, Shuffle, Sparkle } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { KeyboardInput, KeyboardTextarea, MobileScroll, useKeyboard } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";
import "./play-together.css";

type Mode = "choice" | "guess" | "truth";
type Answer = { choice?: number; text?: string };
type AnswerInput = Answer & { aboutUserId?: string };
type Reply = { id: string; userId: string; text: string; createdAt: string };
type Card = { id: string; type: Mode; retired?: boolean; title: string; prompt: string; options: string[]; followup: string };
type Round = { id: string; cardId: string; aboutUserId: string | null; answers: Record<string, Answer>; revealed: boolean; replies: Reply[] };
type Board = { version: number; readOnly?: boolean; cards: Card[]; rounds: Round[] };
type Translate = (zh: string, en: string, es: string) => string;
type SharedChoices = { question: string; own: string; partner: string };
type Props = {
  language: Language; userId: string; partnerName: string; paired: boolean; readOnly?: boolean;
  revision: number; conversationId?: string; initialCardId?: string; onClose: () => void; onInvite: () => void;
  onAskPinky?: (choices: SharedChoices) => void;
  renderDaily: (offline: boolean) => ReactNode; onRefreshDaily: () => void;
  onLeaveDaily: () => void; fromGames?: boolean;
  renderPlans?: (questionId?: string) => ReactNode;
};

const playPath = "/api/together/play";
const modes: Mode[] = ["choice", "guess", "truth"];
const browsePageSize = 18;
const modeName = (t: Translate, mode: Mode) => mode === "choice" ? t("二选一", "Pick one", "Elige una") :
  mode === "guess" ? t("猜 TA", "Guess their pick", "Adivina") : t("各写一句", "Write a line", "Una frase cada uno");
const incoming = (round: Round | undefined, me: string) => Boolean(round && !round.revealed && !round.answers[me]);
const searchKey = (text: string) => text.normalize("NFD").replace(/\p{Mark}/gu, "").toLowerCase();
const draftSuffix = (userId: string, conversationId = "") => `pinky:play:v1:${userId}:${conversationId}`;
const readLocal = (key: string) => { try { return sessionStorage.getItem(key) || ""; } catch { return ""; } };
const writeLocal = (key: string, value: string) => {
  try { if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key); } catch { /* Play still works without storage. */ }
};

export function PlayTogether({ language, userId, partnerName, paired, readOnly = false, revision, conversationId, initialCardId, fromGames, onLeaveDaily, onClose, onInvite, onAskPinky, renderDaily, onRefreshDaily, renderPlans }: Props) {
  const t: Translate = (zh, en, es) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const storage = draftSuffix(userId, conversationId);
  const [board, setBoard] = useState<Board | null>(null);
  const [activeId, setActiveId] = useState(() => initialCardId || readLocal(`${storage}:card`));
  const cardAtOpen = useRef(activeId);
  const [mode, setMode] = useState<Mode | null>(null);
  const [history, setHistory] = useState(false);
  const [browsing, setBrowsing] = useState(() => !initialCardId);
  const [query, setQuery] = useState("");
  const [visibleQuestions, setVisibleQuestions] = useState(browsePageSize);
  const overview = browsing && !history;
  const title = t("双人题卡", "Cards for two", "Cartas para dos");
  const [paused, setPaused] = useState(() => !initialCardId && readLocal(`${storage}:paused`) === "1");
  const [offline, setOffline] = useState(() => !navigator.onLine);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState("");
  const [editRound, setEditRound] = useState("");
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const latest = useRef<Board | null>(null);
  const readGeneration = useRef(0);
  const session = useRef({ language, userId, conversationId });
  session.current = { language, userId, conversationId };
  const update = useCallback((next: Board) => {
    if (latest.current && next.version < latest.current.version) return;
    latest.current = next;
    setBoard(next);
    setLoadError(false);
  }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    const generation = ++readGeneration.current;
    try {
      const params = new URLSearchParams({ language });
      if (cardAtOpen.current) params.set("card", cardAtOpen.current);
      const next = await relationshipApi<Board>(`${playPath}?${params}`, { signal });
      if (generation === readGeneration.current && !signal?.aborted) update(next);
    } catch {
      if (generation === readGeneration.current && !signal?.aborted) setLoadError(true);
    }
  }, [language, update]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, revision, paired]);
  useEffect(() => {
    const onOnline = () => { setOffline(false); void load(); };
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, [load]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !writing.current) onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const all = board?.cards || [];
  const byCard = new Map(board?.rounds.map((round) => [round.cardId, round]));
  const openedCard = all.find((card) => card.id === activeId);
  const catalog = useMemo(() => (board?.cards || []).filter((card) => !card.retired).map((card) => ({
    card, search: searchKey([card.title, card.prompt, ...card.options].join(" ")),
  })), [board?.cards]);
  const matchingMode = mode ? catalog.filter(({ card }) => card.type === mode) : catalog;
  const available = matchingMode.map(({ card }) => card);
  const first = (cards: Card[]) => cards.find((card) => incoming(byCard.get(card.id), userId)) ??
    cards.find((card) => !byCard.has(card.id)) ?? cards[0];
  const initial = first(available);
  const card = openedCard ?? initial;
  const cardIndex = card ? available.indexOf(card) : -1;
  const round = card && byCard.get(card.id);
  const subject = card?.type === "guess" ? round?.aboutUserId || userId : "";
  const inbox = all.filter((item) => incoming(byCard.get(item.id), userId));
  const historyCards = all.filter((item) => byCard.has(item.id));
  const allPlayed = available.length > 0 && available.every((item) => byCard.get(item.id)?.revealed);
  const frozen = readOnly || (board?.readOnly === true && (paired || historyCards.length > 0));
  const disabled = offline || frozen || busy;
  const needle = searchKey(query.trim());
  const narrowed = needle ? matchingMode.filter(({ search }) => search.includes(needle)).map(({ card }) => card) : available;

  function pin(next: Card) {
    if (activeId === next.id) return;
    setActiveId(next.id);
    writeLocal(`${storage}:card`, next.id);
  }
  function select(next: Card) {
    onLeaveDaily();
    keyboard.hide(); setError(""); setHistory(false); setEditRound(""); setPaused(false);
    setBrowsing(false);
    if (mode && next.type !== mode) setMode(null);
    pin(next);
    writeLocal(`${storage}:paused`, "");
  }
  function filterBy(next: Mode | null) {
    keyboard.hide();
    setMode(next);
    setVisibleQuestions(browsePageSize);
  }
  function back() {
    keyboard.hide();
    if (history) setHistory(false);
    else if (!browsing && !initialCardId) setBrowsing(true);
    else onClose();
  }
  function resumeCard(next: Card) {
    keyboard.hide(); onLeaveDaily();
    if (mode && next.type !== mode) setMode(null);
    setBrowsing(false);
  }
  function step(direction: 1 | -1, fresh = false) {
    if (!card) return;
    const start = cardIndex >= 0 ? cardIndex : direction === 1 ? -1 : 0;
    const ordered = available.map((_, offset) => available[(start + direction * (offset + 1) + available.length) % available.length]);
    const next = (fresh ? ordered.find((item) => item.id !== card.id && !byCard.get(item.id)?.revealed) : null)
      ?? ordered.find((item) => item.id !== card.id);
    if (next) select(next);
  }
  function pause(value: boolean) {
    keyboard.hide();
    if (card) pin(card);
    setPaused(value); writeLocal(`${storage}:paused`, value ? "1" : "");
  }
  async function mutate(target: Card, action: "answer" | "reply", input: AnswerInput & { clientId?: string }) {
    if (disabled || writing.current || !paired) return false;
    pin(target);
    writing.current = true; setBusy(true); setError("");
    const atStart = session.current;
    try {
      const next = await relationshipApi<Board>(`${playPath}/${encodeURIComponent(target.id)}/${action}`, jsonBody({ ...input, language }));
      if (session.current.language !== atStart.language || session.current.userId !== atStart.userId || session.current.conversationId !== atStart.conversationId) return false;
      update(next);
      if (action === "answer") setEditRound("");
      return true;
    } catch (caught) {
      if (session.current.language === atStart.language && session.current.userId === atStart.userId && session.current.conversationId === atStart.conversationId) {
        setError(caught instanceof Error ? caught.message : t("没能保存，点一下重试。", "Couldn't save. Tap to retry.", "No se pudo guardar. Toca para reintentar."));
        void load();
      }
      return false;
    } finally { writing.current = false; setBusy(false); }
  }
  return <div className="play-together" role="dialog" aria-modal="true" aria-label={title} data-testid="play-together">
    <header className="play-together-top">
      <button type="button" className="play-icon" onClick={back}
        aria-label={history || (!browsing && !initialCardId) ? t("返回题卡", "Back to cards", "Volver a las cartas")
          : fromGames ? t("返回小游戏", "Back to games", "Volver a los juegos") : t("返回对话", "Back to chat", "Volver al chat")} autoFocus><ArrowLeft size={22} /></button>
      <h1>{title}</h1>
      <button type="button" className={`play-icon${history ? " is-selected" : ""}`} aria-pressed={history} disabled={busy || !board} aria-label={t("玩过的题", "Played cards", "Cartas jugadas")}
        onClick={() => { keyboard.hide(); onLeaveDaily(); setHistory(!history); }}><ClockCounterClockwise size={23} /></button>
    </header>
    <div className="play-together-scroll"><MobileScroll key={history ? "history" : browsing ? "browse" : "card"} className="play-scroll"><div className="play-together-body">
      {offline && <p className="play-status" role="status">{t("没有网络。已经打开的牌还能看，联网后再回答。", "You're offline. You can still read open cards and answer once you're back online.", "Sin conexión. Puedes ver las cartas abiertas y responder al volver.")}</p>}
      {error && <p className="play-status is-error" role="alert">{error}</p>}
      {frozen && <p className="play-status" role="status">{t("这个空间现在只供查看。", "This space is read-only right now.", "Por ahora solo puedes ver este espacio.")}</p>}
      {paired && overview && <section className="play-today" aria-labelledby="play-today-title">
        <h2 id="play-today-title">{t("今日双人题", "Today’s question", "Pregunta de hoy")}</h2>
        {renderDaily(offline) ?? <div className="play-status" role="status">
          {t("新题准备好就会显示在这里。", "The new question will show up here when it's ready.", "La pregunta nueva aparecerá aquí cuando esté lista.")}
          <button type="button" className="play-link" disabled={offline || readOnly} onClick={onRefreshDaily}>{t("刷新", "Refresh", "Actualizar")}</button>
        </div>}
        {renderPlans?.()}
      </section>}
      {loadError && <div className="play-status" role="alert">{t("题卡暂时没加载出来。", "Cards couldn't load.", "No se cargaron las cartas.")} <button className="play-link" type="button" disabled={offline} onClick={() => void load()}>{t("重试", "Retry", "Reintentar")}</button></div>}
      {!board && !loadError && <p className="play-status" role="status">{t("正在打开题卡…", "Opening your cards…", "Abriendo las cartas…")}</p>}
      {board && (history ? <section className="play-history" aria-label={t("玩过的题", "Played cards", "Cartas jugadas")}>
        <h2>{t("玩过的题", "Played cards", "Cartas jugadas")}</h2>
        {historyCards.length ? historyCards.map((item) => {
          const saved = byCard.get(item.id)!;
          return <button key={item.id} type="button" className="play-list-row" onClick={() => select(item)}>
            <span><strong>{item.title}</strong><small>{saved.revealed ? t("已翻牌", "Revealed", "Revelada") : saved.answers[userId] ? t("等 TA 回答", "Waiting for your partner", "Esperando a tu pareja") : t("等你回答", "Waiting for you", "Esperando tu respuesta")}</small></span><CaretRight size={17} />
          </button>;
        }) : <p>{t("还没有玩过的题。回去翻一张，看看 TA 会怎么选。", "No played cards yet. Pick one to see what your partner chooses.", "Aún no hay cartas jugadas. Elige una y descubre qué prefiere tu pareja.")}</p>}
        <button type="button" className="play-link" onClick={() => setHistory(false)}>{t("回到题卡", "Back to cards", "Volver a las cartas")}</button>
      </section> : browsing ? <section className="play-browse" aria-labelledby="play-browse-title">
          <h2 id="play-browse-title">{t("自己挑一题", "Pick a card", "Elijan una carta")}</h2>
          {inbox.length > 0 && <button type="button" className="play-inbox" onClick={() => select(inbox[0])}><Heart size={18} weight="fill" />{t("TA 答过一题，等你来翻牌", "Your partner answered a card. Your turn!", "Tu pareja ya respondió. ¡Te toca!")}</button>}
          {openedCard && openedCard.id !== inbox[0]?.id && <button type="button" className="play-list-row" onClick={() => resumeCard(openedCard)}>
            <span><small>{t("上次打开的题", "Last opened card", "Última carta abierta")}</small><strong>{openedCard.prompt}</strong></span><CaretRight size={17} aria-hidden="true" />
          </button>}
          <div className="play-filters" role="group" aria-label={t("按玩法筛选", "Filter by play style", "Filtrar por tipo de juego")}>
            <button type="button" aria-pressed={mode === null} disabled={busy} onClick={() => filterBy(null)}>{t("全部", "All", "Todas")}</button>
            {modes.map((item) => <button type="button" key={item} aria-pressed={mode === item} disabled={busy} onClick={() => filterBy(item)}>{modeName(t, item)}</button>)}
          </div>
          <KeyboardInput type="search" value={query} maxLength={90} aria-label={t("搜索题目", "Search cards", "Buscar cartas")}
            placeholder={t("搜题目或编号", "Search by question or number", "Busca por pregunta o número")}
            onFocus={onLeaveDaily} onChange={(event) => { setQuery(event.target.value); setVisibleQuestions(browsePageSize); }} />
          <ul>
            {narrowed.slice(0, visibleQuestions).map((item) => <li key={item.id}>
              <button type="button" className="play-list-row" onClick={() => select(item)}>
                <span><small><b className={`play-format is-${item.type}`}>{modeName(t, item.type)}</b> · {item.title}</small><strong>{item.prompt}</strong></span><CaretRight size={17} aria-hidden="true" />
              </button>
            </li>)}
          </ul>
          {!narrowed.length && <p className="play-status" role="status">{t("没找到符合的题目。", "No cards found.", "No encontramos cartas.")}</p>}
          {narrowed.length > visibleQuestions && <button type="button" className="play-quiet" onClick={() => { keyboard.hide(); setVisibleQuestions((current) => current + browsePageSize); }}>
            {t("显示更多题目", "Show more cards", "Mostrar más cartas")}
          </button>}
        </section> : <>
        {initialCardId && <button type="button" className="play-link play-browse-link" disabled={busy} onClick={() => { keyboard.hide(); setMode(null); setBrowsing(true); }}>
          {t("浏览全部题卡", "Browse all cards", "Ver todas las cartas")}
        </button>}
        {inbox.length > 0 && !incoming(round, userId) && <button type="button" className="play-inbox" onClick={() => select(inbox[0])}><Heart size={18} weight="fill" />{t("TA 答过一题，等你来翻牌", "Your partner answered a card. Your turn!", "Tu pareja ya respondió. ¡Te toca!")}</button>}
        {card ? paused ? <section className="play-card is-paused"><p className="play-kicker">{modeName(t, card.type)}</p><h2>{t("下次接着玩", "Pick up where you left off", "Sigue donde lo dejaste")}</h2>
          <p>{t("你停在", "You paused at", "Pausaste en")} 「{card.title}」</p><button type="button" className="play-main" onClick={() => pause(false)}>{t("接着玩", "Keep playing", "Seguir jugando")}</button>
        </section> : <RoundCard key={`${card.id}:${conversationId || ""}:${subject}`} t={t} card={card} round={round} userId={userId} partnerName={partnerName} paired={paired} frozen={frozen} disabled={disabled} busy={busy}
          storage={storage} editing={Boolean(round && round.id === editRound)} onEdit={() => round && setEditRound(round.id)} onCancelEdit={() => setEditRound("")}
          onBegin={() => pin(card)}
          answer={(input) => mutate(card, "answer", input)} reply={(input) => mutate(card, "reply", input)} onInvite={onInvite}
          onAskPinky={card.type === "choice" && paired && !frozen ? onAskPinky : undefined} /> : <p className="play-status">{t("还没有题卡。", "No cards yet.", "Aún no hay cartas.")}</p>}
        {!paused && round?.revealed && renderPlans?.(round.id)}
        {card && <div className="play-navigation">
          <button type="button" className="play-icon" aria-label={t("上一题", "Previous card", "Carta anterior")} onClick={() => step(-1)} disabled={busy || available.length <= (cardIndex >= 0 ? 1 : 0)}><CaretLeft size={20} /></button>
          {cardIndex >= 0 && <span>{cardIndex + 1} / {available.length}</span>}
          <button type="button" className="play-quiet" disabled={busy || available.length <= (cardIndex >= 0 ? 1 : 0)} onClick={() => step(1, true)}><Shuffle size={17} />{t("换一题", "Swap card", "Cambiar carta")}</button>
          {!paused && <button type="button" className="play-link" disabled={busy} onClick={() => pause(true)}>{t("稍后玩", "Later", "Más tarde")}</button>}
        </div>}
        {allPlayed && <p className="play-status">{t("这副牌已经玩完了。你们可以回看答案、继续聊天。", "You've played this deck. Revisit your answers and keep talking.", "Ya jugaron todas las cartas. Pueden releer sus respuestas y seguir hablando.")}</p>}
      </>)}
    </div></MobileScroll></div>
  </div>;
}

function RoundCard({ t, card, round, userId, partnerName, paired, frozen, disabled, busy, storage, editing, onEdit, onCancelEdit, onBegin, answer, reply, onInvite, onAskPinky }: {
  t: Translate; card: Card; round?: Round; userId: string; partnerName: string; paired: boolean; frozen: boolean; disabled: boolean; busy: boolean;
  storage: string; editing: boolean; onEdit: () => void; onCancelEdit: () => void; onBegin: () => void;
  answer: (input: AnswerInput) => Promise<boolean>; reply: (input: { text: string; clientId: string }) => Promise<boolean>; onInvite: () => void;
  onAskPinky?: (choices: SharedChoices) => void;
}) {
  const own = round?.answers[userId];
  const answerKey = `${storage}:${card.id}:answer:${card.type === "guess" ? round?.aboutUserId || userId : ""}`;
  const replyKey = `${storage}:${card.id}:reply`;
  const [choice, setChoice] = useState<number | undefined>(() => { const saved = readLocal(answerKey); return saved !== "" && card.options[Number(saved)] !== undefined ? Number(saved) : own?.choice; });
  const [text, setText] = useState(() => card.type === "truth" ? readLocal(answerKey) || own?.text || "" : "");
  const [composing, setComposing] = useState(() => Boolean(readLocal(replyKey)));
  const [message, setMessage] = useState(() => readLocal(replyKey));
  const retryReply = useRef<{ text: string; clientId: string } | null>(null);
  const keyboard = useKeyboard();
  const truth = card.type === "truth";
  const waiting = own && !round?.revealed && !editing;
  const revealed = round?.revealed;
  const showAnswer = (value: Answer | undefined) => truth ? value?.text : value?.choice !== undefined ? card.options[value.choice] : "";
  const theirs = round && Object.entries(round.answers).find(([id]) => id !== userId)?.[1];
  const matched = !truth && revealed && own?.choice === theirs?.choice;
  const instruction = card.type === "guess" ? !round?.aboutUserId || round.aboutUserId === userId ?
    t("先选自己的答案，TA 来猜你。", "Pick your own answer. Your partner will guess.", "Elige tu respuesta. Tu pareja intentará adivinarla.") :
    t(`猜 ${partnerName} 选了什么。`, `Guess what ${partnerName} picked.`, `Adivina qué eligió ${partnerName}.`) :
    t("你们各答一次，两个人都答完再翻牌。", "Answer separately. Flip the cards once you're both done.", "Respondan por separado y revelen las cartas cuando ambos terminen.");
  const revealTitle = truth ? t("两个人，都说了一句", "Two answers, one conversation", "Dos respuestas, una conversación") :
    card.type === "guess" ? (matched ? t("猜中了", "Good guess", "¡Acertaron!") : t("原来是这个答案", "A little surprise", "Una pequeña sorpresa")) :
      (matched ? t("你们想到一起了", "You had the same idea", "Pensaron lo mismo") : t("你们想到的有点不同", "You saw it differently", "Lo vieron de otra manera"));
  const submit = async () => {
    keyboard.hide();
    if (await answer(truth ? { text: text.trim() } : { choice, ...(card.type === "guess" ? { aboutUserId: round?.aboutUserId || userId } : {}) })) writeLocal(answerKey, "");
  };
  const sendReply = async () => {
    const next = message.trim();
    if (!next) return;
    keyboard.hide();
    if (retryReply.current?.text !== next) retryReply.current = { text: next, clientId: crypto.randomUUID() };
    if (await reply(retryReply.current)) { retryReply.current = null; setMessage(""); setComposing(false); writeLocal(replyKey, ""); }
  };
  return <section className={`play-card play-card-${card.type}${revealed ? " is-revealed" : ""}`} data-testid="play-card">
    <p className="play-kicker"><span>{modeName(t, card.type)}</span> · {card.title}</p>
    <h2>{card.prompt}</h2>
    {revealed ? <>
      <p className="play-reveal-title" role="status">{revealTitle}</p>
      <div className="play-two-answers">
        <div><small>{t("你", "You", "Tú")}</small><strong>{showAnswer(own)}</strong></div>
        <div><small>{partnerName}</small><strong>{showAnswer(theirs)}</strong></div>
      </div>
      {round.replies.length > 0 && <ul className="play-replies" aria-label={t("接着聊的内容", "Replies", "Respuestas")}>{round.replies.map((item) => <li key={item.id}><small>{item.userId === userId ? t("你", "You", "Tú") : partnerName}</small><p>{item.text}</p></li>)}</ul>}
      {paired && !frozen && (composing ? <div className="play-reply-form">
        <label htmlFor="play-reply">{t("给 TA 留一句", "Leave a reply", "Deja una respuesta")}</label>
        <KeyboardTextarea id="play-reply" rows={2} maxLength={300} value={message} disabled={busy} onChange={(event) => { setMessage(event.target.value); writeLocal(replyKey, event.target.value); }} />
        {!message && <button type="button" className="play-link" onClick={() => { setMessage(card.followup); writeLocal(replyKey, card.followup); }}>{card.followup}</button>}
        <div className="play-actions"><button className="play-main" type="button" disabled={disabled || !message.trim()} onClick={() => void sendReply()}>{busy ? t("发送中…", "Sending…", "Enviando…") : t("发给 TA", "Send to your partner", "Enviar a tu pareja")}</button>
          <button type="button" className="play-link" disabled={busy} onClick={() => { keyboard.hide(); setComposing(false); }}>{t("稍后再聊", "Talk later", "Hablar después")}</button></div>
      </div> : <div className="play-actions"><button type="button" className="play-main" onClick={() => setComposing(true)}>{t("接着聊这题", "Keep talking", "Seguir hablando")}</button>
        {onAskPinky && <button type="button" className="play-quiet" onClick={() => onAskPinky({ question: card.prompt, own: showAnswer(own) || "", partner: showAnswer(theirs) || "" })}>
          <Sparkle size={16} />{t("请 Pinky 想个计划", "Ask Pinky for a plan", "Pide un plan a Pinky")}
        </button>}</div>)}
    </> : waiting ? <div className="play-wait" role="status">
      <p><LockKey size={18} />{t("你的答案已锁好，等 TA 来翻牌。", "Your answer is sealed. Waiting for your partner.", "Tu respuesta está sellada. Esperando a tu pareja.")}</p>
      <strong>{showAnswer(own)}</strong>
      <button type="button" className="play-link" disabled={disabled} onClick={() => { setChoice(own.choice); setText(own.text || ""); onEdit(); }}>{t("改一下答案", "Edit my answer", "Editar mi respuesta")}</button>
    </div> : <>
      <p className="play-instruction">{instruction}</p>
      {truth ? <div className="play-reply-form"><label htmlFor="play-answer">{t("写下一句话", "Write one sentence", "Escribe una frase")}</label>
        <KeyboardTextarea id="play-answer" rows={2} maxLength={200} value={text} disabled={busy} onChange={(event) => { onBegin(); setText(event.target.value); writeLocal(answerKey, event.target.value); }} /></div> :
        <div className="play-options" role="group" aria-label={t("答案选项", "Answer options", "Opciones de respuesta")}>{card.options.map((option, index) =>
          <button type="button" key={option} aria-pressed={choice === index} disabled={busy} onClick={() => { onBegin(); setChoice(index); writeLocal(answerKey, String(index)); }}>{option}</button>)}</div>}
      {paired ? <div className="play-actions">
        <button type="button" className="play-main" disabled={disabled || (truth ? !text.trim() : choice === undefined)} onClick={() => void submit()}>{busy ? t("锁定中…", "Sealing…", "Sellando…") : t("锁好我的答案", "Seal my answer", "Sellar mi respuesta")}</button>
        {editing && <button type="button" className="play-link" disabled={busy} onClick={onCancelEdit}>{t("不改了", "Keep my answer", "Mantener mi respuesta")}</button>}
      </div> : !frozen && <div className="play-actions"><button type="button" className="play-main" onClick={onInvite}>{t("邀请 TA 一起翻牌", "Invite your partner", "Invita a tu pareja")}</button>
        <small>{t("你的选择暂时留在这台设备。", "Your pick stays on this device for now.", "Por ahora tu elección queda en este dispositivo.")}</small></div>}
    </>}
  </section>;
}
