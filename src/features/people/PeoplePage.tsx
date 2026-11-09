import { useEffect, useState } from "react";
import { ArrowLeft, ChatCircleDots, Plus, X } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { KeyboardInput, useKeyboard } from "../../mobile";
import { PageHeader } from "../conversation/ConversationHome";
import { jsonBody, relationshipApi } from "../relationship/api";
import { Avatar } from "./People";
import "./people-page.css";

// 我的 TA 们 (founder 11-09: "我要的是一整个功能界面……真实的情况是很复杂的"; he chose B+C of the mockups). A page of its own,
// opened from the menu: 总览 says where each person stands, what changed and what to do now; 对比 holds them side by side
// and against what the member wants, with evidence; 我想要的 is that list. Pinky fills all of it by itself; nothing is a score.
type Stage = "new" | "warming" | "close" | "cooling" | "risk" | "ended";
type Level = { level: "high" | "mid" | "low" | "unknown" | "risk"; label: string };
type Row = { id: string; name: string; stage: Stage; summary: string; view: string; going: string; watch: string; next: string; feeling: string; traits: Array<{ text: string; tone: "good" | "caution" }>; unknowns: string[]; signals: Record<"initiative" | "reliability" | "honesty" | "fit" | "feeling", Level>; fit: Array<{ want: string; verdict: "yes" | "no" | "unknown"; evidence: string }> };
type Want = { id: string; kind: "must" | "nice" | "never"; text: string };
type Reading = { overview: string; leaning: string; decision: string; ask: string; todos: Array<{ id: string; when: string; text: string }>; suggestedWants: Want[]; people: Row[] };
type PersonInfo = { id: string; name: string; stage: Stage | null; previousStage: Stage | null; stageAt: string | null; lastSeenAt: string };
type Board = { status: "ready" | "pending" | "failed" | "few" | "unavailable"; stale?: boolean; reading?: Reading; people: PersonInfo[]; feed: Array<{ personId: string; name: string; text: string }>; wants: Want[] };
type Line = { id: string; category: string; text: string };
type Numbers = { messages: { me: number; them: number }; starts: { me: number; them: number }; replyMinutes: { me: number | null; them: number | null }; longestSilence: number; monthly: Array<{ month: string; me: number; them: number }> };
type Detail = { person: PersonInfo; facts: Line[]; history: Line[]; numbers: Numbers | null; read: Row | null };
type Tab = "overview" | "compare" | "wants";

const ORDER: Stage[] = ["close", "warming", "new", "cooling", "risk", "ended"];
const WEEK = 7 * 24 * 60 * 60 * 1000;
const splitDate = (text: string) => { const match = /^(\d{4}-)?(\d{2}-\d{2})(\s*前后)?\s*/.exec(text); return match ? { date: match[2], text: text.slice(match[0].length) } : { date: "", text }; };

export function PeoplePage({ language, initialPerson, initialTab, onBack, onAsk }: { language: Language; initialPerson: string; initialTab: string; onBack: () => void; onAsk: (text: string, channel: "me" | "us") => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const [tab, setTab] = useState<Tab>(initialTab === "compare" || initialTab === "wants" ? initialTab : "overview");
  const [personId, setPersonId] = useState(initialPerson);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let alive = true, timer = 0, tries = 0;
    const load = (seen: boolean) => relationshipApi<Board>(`/api/people/board?language=${language}${seen ? "&seen=1" : ""}`).then((result) => {
      if (!alive) return;
      setBoard(result); setError("");
      // A new reading is being made in the background: look again until it is in.
      if ((result.status === "pending" || result.stale) && ++tries < 60) timer = window.setTimeout(() => load(false), 3000);
    }).catch((reason) => { if (alive) setError((reason as Error).message); });
    void load(true);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [language, refresh]);
  const stages: Record<Stage, string> = { new: t("刚认识", "Just met", "Recién conocidos"), warming: t("在升温", "Warming up", "Acercándose"), close: t("很近了", "Getting close", "Muy cerca"), cooling: t("在降温", "Cooling off", "Enfriándose"), risk: t("要当心", "Be careful", "Cuidado"), ended: t("已经淡了", "Faded", "Se apagó") };
  const reading = board?.status === "ready" ? board.reading || null : null;
  const rowOf = (id: string) => reading?.people.find((row) => row.id === id) || null;
  const nameOf = (id: string) => board?.people.find((person) => person.id === id)?.name || rowOf(id)?.name || "";
  const waiting = !board || board.status === "pending" ? <p className="people-muted">{t("Pinky 正在把你在了解的人放在一起看…", "Pinky is looking at everyone together…", "Pinky está mirando a todos juntos…")}</p>
    : board.status === "failed" ? <p className="people-muted">{t("这次没能看完，稍后再打开。", "Couldn't finish this time. Open it again later.", "No pude terminar. Vuelve a abrirlo más tarde.")}</p> : null;
  const open = (id: string) => { keyboard.hide(); setPersonId(id); };
  const chip = (stage: Stage | null) => stage ? <span className={`people-stage stage-${stage}`}>{stages[stage]}</span> : null;

  if (personId) return <PersonPage language={language} id={personId} row={rowOf(personId)} stages={stages} onBack={() => { setPersonId(""); setRefresh((value) => value + 1); }} onAsk={onAsk} />;

  const few = board?.status === "few";
  const overview = () => {
    if (few || !board?.people.length) return <p className="people-muted">{board?.people.length ? t("再认识一个人，Pinky 就会把你们放在一起看。", "With one more person, Pinky puts everyone side by side.", "Con una persona más, Pinky las pone lado a lado.") : t("还没有在了解的人。在“只有我”发一张和 TA 的聊天截图，Pinky 会自动建档。", "Nobody yet. Send a chat screenshot with them in Just me and Pinky files them.", "Nadie aún. Envía una captura en Solo yo y Pinky la archiva.")}</p>;
    const people = board.people.map((person) => ({ person, row: rowOf(person.id), stage: (rowOf(person.id)?.stage || person.stage) as Stage | null }));
    const moved = (person: PersonInfo) => person.previousStage && person.stageAt && Date.now() - Date.parse(person.stageAt) < WEEK;
    return <>
      {waiting}
      {!!reading?.todos.length && <section className="people-card people-todo" data-testid="people-todos"><h2>{t("现在要你做的", "To do now", "Para hacer ahora")}</h2>{reading.todos.map((todo, index) => <button key={index} type="button" onClick={() => open(todo.id)}><b>{todo.when}</b><span>{todo.text}</span></button>)}</section>}
      {ORDER.concat([null as unknown as Stage]).map((stage) => {
        const here = people.filter((item) => (item.stage || null) === stage);
        if (!here.length) return null;
        return <section key={stage || "unknown"} className="people-lane" data-testid={`lane-${stage || "unknown"}`}>
          <h2><i className={`lane-dot stage-${stage || "none"}`} />{stage ? stages[stage] : t("正在看", "Reading", "Leyendo")} · {here.length}</h2>
          {here.map(({ person, row }) => <button key={person.id} type="button" className="people-person" onClick={() => open(person.id)} data-testid="people-person">
            <Avatar name={person.name} /><span><strong>{person.name}</strong><small>{row?.summary || t("Pinky 正在看", "Pinky is reading", "Pinky está leyendo")}</small></span>
            {moved(person) ? <em className={person.stage === "risk" ? "risk" : ""}>{stages[person.previousStage!]} → {stages[person.stage!]}</em> : null}
          </button>)}
        </section>;
      })}
      {!!board.feed.length && <section className="people-card"><h2>{t("最近发生了什么", "Lately", "Últimamente")}</h2><ol className="people-feed">{board.feed.map((line, index) => { const { date, text } = splitDate(line.text); return <li key={index}><small>{date}</small><span><b>{line.name}</b> {text}</span></li>; })}</ol></section>}
    </>;
  };

  const levels: Array<[keyof Row["signals"], string]> = [["initiative", t("TA 主动找你", "Reaches out", "Te busca")], ["reliability", t("说到做到", "Keeps plans", "Cumple")], ["honesty", t("对你坦诚", "Honest", "Honesto")], ["fit", t("合你想要的", "Fits you", "Te encaja")], ["feeling", t("你的感觉", "Your feeling", "Tu sensación")]];
  const compare = () => {
    if (few) return <p className="people-muted">{t("再认识一个人，Pinky 就会自动对比。", "With one more person, Pinky compares them.", "Con una persona más, Pinky las compara.")}</p>;
    if (!reading) return waiting;
    const leaning = reading.people.find((row) => row.id === reading.leaning);
    return <>
      <section className="people-card people-read" data-testid="people-overview">{leaning && <p className="people-leaning"><Avatar name={leaning.name} small />{t(`目前更倾向 ${leaning.name}`, `Leaning toward ${leaning.name}`, `Por ahora, ${leaning.name}`)}</p>}<p>{reading.overview}</p>{board?.stale && <small>{t("有新聊天，正在更新…", "New chats in, updating…", "Actualizando…")}</small>}</section>
      <section className="people-card"><h2>{t("一张表看所有人", "Everyone at a glance", "Todos de un vistazo")}</h2>
        <div className="people-matrix-scroll"><table className="people-matrix" data-testid="people-matrix"><thead><tr><th scope="col"><span className="sr-only">{t("方面", "Aspect", "Aspecto")}</span></th>{reading.people.map((row) => <th scope="col" key={row.id}><button type="button" onClick={() => open(row.id)} aria-label={row.name}><Avatar name={row.name} small /><small>{row.name}</small></button></th>)}</tr></thead>
          <tbody>{levels.map(([key, label]) => <tr key={key}><th scope="row">{label}</th>{reading.people.map((row) => <td key={row.id}><span className={`people-level level-${row.signals[key].level}`}>{row.signals[key].label || (row.signals[key].level === "unknown" ? t("未知", "?", "?") : "")}</span></td>)}</tr>)}</tbody></table></div>
        <p className="people-muted small">{t("来自聊天里的实际表现，不是打分；“未知”是还没看到证据。", "From what the chats show, not a score; “?” means no evidence yet.", "Según los chats, no es una nota; “?” es sin evidencia aún.")}</p></section>
      {reading.decision && <section className="people-card people-read"><h2>{t("如果今天就要决定", "If you had to decide today", "Si tuvieras que decidir hoy")}</h2><p>{reading.decision}</p></section>}
      {board?.wants.length ? <section className="people-card" data-testid="people-fit"><h2>{t("每个人对照你想要的", "Each one against what you want", "Cada uno frente a lo que quieres")}</h2>
        {reading.people.map((row) => <div key={row.id} className="people-fit"><button type="button" onClick={() => open(row.id)}><Avatar name={row.name} small /><strong>{row.name}</strong>{chip(row.stage)}</button>
          {row.fit.map((item, index) => <p key={index} className={`fit-${item.verdict}`}><b>{item.want}{item.verdict === "yes" ? " ✓" : item.verdict === "no" ? " ✕" : " ?"}</b><span>{item.evidence}</span></p>)}</div>)}</section>
        : <section className="people-card"><p>{t("告诉 Pinky 你想要什么样的关系，这里会把每个人逐条对照。", "Tell Pinky what you want, and each person is held against it here.", "Dile a Pinky lo que quieres y aquí se compara cada uno.")}</p><button type="button" className="people-secondary" onClick={() => setTab("wants")}>{t("去写我想要的", "Write what I want", "Escribir lo que quiero")}</button></section>}
      {reading.people.some((row) => row.unknowns.length) && <section className="people-card"><h2>{t("下次见面可以了解", "To find out next time", "Para averiguar")}</h2><ul className="people-list">{reading.people.filter((row) => row.unknowns.length).map((row) => <li key={row.id}><b>{row.name}</b> · {row.unknowns[0]}</li>)}</ul></section>}
      <button type="button" className="people-primary" onClick={() => onAsk(t(`帮我对比一下 ${reading.people.map((row) => row.name).join("、")}，谁更适合我？`, `Compare ${reading.people.map((row) => row.name).join(", ")} for me: who suits me better?`, `Compara a ${reading.people.map((row) => row.name).join(", ")}: ¿quién me conviene más?`), "me")} data-testid="people-ask"><ChatCircleDots size={20} weight="fill" />{t("和 Pinky 聊聊这个决定", "Talk it over with Pinky", "Hablarlo con Pinky")}</button>
    </>;
  };

  return <div className="paper-screen relationship-shell people-screen" data-testid="people-page">
    <PageHeader language={language} title={t("我的 TA 们", "People I'm seeing", "Las personas que conozco")} onBack={onBack} />
    <main className="relationship-main people-main">
      <p className="people-muted small">{t("只有你看得到 · 发新聊天会自动更新", "Only you can see this · updates with new chats", "Solo tú lo ves · se actualiza con chats nuevos")}</p>
      <div className="people-tabs" role="tablist">{(["overview", "compare", "wants"] as Tab[]).map((key) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => { keyboard.hide(); setTab(key); }} data-testid={`people-tab-${key}`}>{key === "overview" ? t("总览", "Overview", "Resumen") : key === "compare" ? t("对比", "Compare", "Comparar") : t("我想要的", "What I want", "Lo que quiero")}</button>)}</div>
      {error && <p className="people-error" role="alert">{error}</p>}
      {tab === "overview" ? overview() : tab === "compare" ? compare() : <WantsTab language={language} wants={board?.wants || []} reading={reading} onSaved={() => setRefresh((value) => value + 1)} onAsk={onAsk} />}
    </main>
  </div>;
}

/** 我想要的: what the member wants in a relationship, kept as they set it; Pinky holds everyone against it. */
function WantsTab({ language, wants, reading, onSaved, onAsk }: { language: Language; wants: Want[]; reading: Reading | null; onSaved: () => void; onAsk: (text: string, channel: "me" | "us") => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const [kind, setKind] = useState<Want["kind"]>("must");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const kinds: Record<Want["kind"], string> = { must: t("必须有", "Must have", "Imprescindible"), nice: t("最好有", "Nice to have", "Deseable"), never: t("绝对不要", "Never", "Nunca") };
  const save = async (next: Want[]) => { setBusy(true); try { await relationshipApi("/api/people/wants", { ...jsonBody({ wants: next }), method: "PUT" }); onSaved(); } finally { setBusy(false); } };
  const add = () => { const value = text.trim(); if (!value) return; keyboard.hide(); setText(""); void save([...wants, { id: crypto.randomUUID(), kind, text: value }]); };
  const suggested = !wants.length ? reading?.suggestedWants || [] : [];
  return <>
    {(["must", "nice", "never"] as Want["kind"][]).map((group) => <section key={group} className="people-card"><h2>{kinds[group]}</h2>
      {wants.some((want) => want.kind === group) ? <div className="people-wants">{wants.filter((want) => want.kind === group).map((want) => <span key={want.id} className={`people-want want-${group}`} data-testid="people-want">{want.text}<button type="button" aria-label={t(`去掉“${want.text}”`, `Remove “${want.text}”`, `Quitar «${want.text}»`)} disabled={busy} onClick={() => void save(wants.filter((item) => item.id !== want.id))}><X size={14} /></button></span>)}</div>
        : <p className="people-muted small">{t("还没有", "Nothing yet", "Nada aún")}</p>}</section>)}
    {!!suggested.length && <section className="people-card people-read"><h2>{t("Pinky 从你说过的话里听出来的", "What Pinky heard you say", "Lo que Pinky te oyó decir")}</h2><div className="people-wants">{suggested.map((want) => <span key={want.id} className={`people-want want-${want.kind}`}>{kinds[want.kind]} · {want.text}</span>)}</div><button type="button" className="people-secondary" disabled={busy} onClick={() => void save(suggested)} data-testid="people-use-suggested">{t("就用这些", "Use these", "Usar estas")}</button></section>}
    {reading?.ask && <p className="people-ask">{reading.ask}</p>}
    <section className="people-card"><h2>{t("加一条", "Add one", "Añadir")}</h2>
      <div className="people-kinds" role="radiogroup" aria-label={t("哪一类", "Which kind", "Tipo")}>{(["must", "nice", "never"] as Want["kind"][]).map((key) => <button key={key} type="button" role="radio" aria-checked={kind === key} className={kind === key ? "active" : ""} onClick={() => setKind(key)}>{kinds[key]}</button>)}</div>
      <div className="people-add"><KeyboardInput value={text} onChange={(event) => setText(event.target.value)} onBlur={() => keyboard.hide()} onKeyDown={(event) => { if (event.key === "Enter") add(); }} maxLength={40} placeholder={t("比如：想认真谈、同城、不碰钱", "e.g. wants something serious, same city", "p. ej.: algo serio, misma ciudad")} aria-label={t("我想要的", "What I want", "Lo que quiero")} data-testid="people-want-input" /><button type="button" className="people-primary small" disabled={busy || !text.trim()} onClick={add} data-testid="people-want-add"><Plus size={18} />{t("添加", "Add", "Añadir")}</button></div>
    </section>
    <button type="button" className="people-secondary" onClick={() => onAsk(t("我想要的关系是：", "What I want in a relationship is: ", "Lo que quiero en una relación es: "), "me")}><ChatCircleDots size={18} weight="fill" />{t("跟 Pinky 说说", "Tell Pinky", "Díselo a Pinky")}</button>
  </>;
}

/** One person's whole page: Pinky's read, the numbers from their chats, what happened, who they are, and what is still unknown. */
function PersonPage({ language, id, row, stages, onBack, onAsk }: { language: Language; id: string; row: Row | null; stages: Record<Stage, string>; onBack: () => void; onAsk: (text: string, channel: "me" | "us") => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [archived, setArchived] = useState(false);
  useEffect(() => {
    let alive = true;
    relationshipApi<Detail>(`/api/people/${encodeURIComponent(id)}?language=${language}`).then((result) => { if (alive) setDetail(result); }).catch((reason) => { if (alive) setError((reason as Error).message); });
    return () => { alive = false; };
  }, [id, language]);
  const read = detail?.read || row;
  const person = detail?.person;
  const stage = (read?.stage || person?.stage || null) as Stage | null;
  const numbers = detail?.numbers;
  const share = (part: number, whole: number) => whole ? Math.round(part / whole * 100) : 0;
  const minutes = (value: number | null) => value === null ? t("不确定", "unclear", "incierto") : value < 60 ? t(`${Math.round(value)} 分钟`, `${Math.round(value)} min`, `${Math.round(value)} min`) : t(`${Math.round(value / 60)} 小时`, `${Math.round(value / 60)} h`, `${Math.round(value / 60)} h`);
  const top = Math.max(1, ...(numbers?.monthly || []).map((month) => month.me + month.them));
  const archive = async () => { await relationshipApi(`/api/people/${encodeURIComponent(id)}/archive`, jsonBody({ archived: true })); setArchived(true); };
  return <div className="paper-screen relationship-shell people-screen" data-testid="person-page">
    <header className="page-header"><button className="page-back" onClick={onBack} data-testid="person-back"><ArrowLeft size={20} />{t("我的 TA 们", "People", "Personas")}</button><h1>{person?.name || row?.name || ""}</h1></header>
    <main className="relationship-main people-main">
      {error && <p className="people-error" role="alert">{error}</p>}
      {person && <div className="person-head"><Avatar name={person.name} /><span><strong>{person.name}</strong><small>{read?.summary || ""}</small></span>{stage && <span className={`people-stage stage-${stage}`}>{stages[stage]}</span>}</div>}
      {archived && <p className="people-read people-card" role="status">{t(`已放下 ${person?.name}。以后再发 TA 的聊天，TA 会回到这里。`, `Set ${person?.name} aside. Send a chat with them again and they come back.`, `${person?.name} queda aparte. Si vuelves a enviar un chat, regresa.`)}</p>}
      {read?.view && <section className="people-card people-read" data-testid="person-view"><h2>{t(`Pinky 怎么看 ${person?.name || read.name}`, `How Pinky sees ${person?.name || read.name}`, `Cómo ve Pinky a ${person?.name || read.name}`)}</h2><p>{read.view}</p>{read.next && <p><b>{t("下一步：", "Next: ", "Siguiente: ")}</b>{read.next}</p>}</section>}
      {numbers && <section className="people-card" data-testid="person-numbers"><h2>{t("你们的聊天数据", "Your chats in numbers", "Sus chats en números")}</h2>
        <div className="people-stats">
          <span><b>{t(`TA ${share(numbers.starts.them, numbers.starts.me + numbers.starts.them)}%`, `Them ${share(numbers.starts.them, numbers.starts.me + numbers.starts.them)}%`, `Ellos ${share(numbers.starts.them, numbers.starts.me + numbers.starts.them)}%`)}</b><small>{t("谁先开口", "Who starts", "Quién empieza")}</small></span>
          <span><b>{minutes(numbers.replyMinutes.them)}</b><small>{t(`TA 回你（你回 TA ${minutes(numbers.replyMinutes.me)}）`, `Their replies (yours ${minutes(numbers.replyMinutes.me)})`, `Sus respuestas (tú ${minutes(numbers.replyMinutes.me)})`)}</small></span>
          <span><b>{numbers.messages.me + numbers.messages.them}</b><small>{t(`条消息（TA ${share(numbers.messages.them, numbers.messages.me + numbers.messages.them)}%）`, `messages (them ${share(numbers.messages.them, numbers.messages.me + numbers.messages.them)}%)`, `mensajes (ellos ${share(numbers.messages.them, numbers.messages.me + numbers.messages.them)}%)`)}</small></span>
          <span><b>{t(`${numbers.longestSilence} 天`, `${numbers.longestSilence} days`, `${numbers.longestSilence} días`)}</b><small>{t("最长没说话", "Longest quiet", "Mayor silencio")}</small></span>
        </div>
        {numbers.monthly.length > 1 && <div className="people-bars" role="img" aria-label={t("每月消息数", "Messages by month", "Mensajes por mes")}>{numbers.monthly.map((month) => <span key={month.month} style={{ height: `${Math.max(6, (month.me + month.them) / top * 72)}px` }} title={`${month.month}: ${month.me + month.them}`}><small>{month.month.slice(5)}</small></span>)}</div>}
      </section>}
      {!!detail?.history.length && <section className="people-card"><h2>{t("你们之间发生过的事", "What happened between you", "Lo que ha pasado")}</h2><ol className="people-timeline">{detail.history.map((line) => { const { date, text } = splitDate(line.text); return <li key={line.id}><small>{date}</small><span>{text}</span></li>; })}</ol></section>}
      {(!!read?.traits.length || !!detail?.facts.length) && <section className="people-card"><h2>{t("关于 TA", "About them", "Sobre esta persona")}</h2>
        {!!read?.traits.length && <div className="people-wants">{read.traits.map((trait, index) => <span key={index} className={`people-trait ${trait.tone}`}>{trait.text}</span>)}</div>}
        {!!detail?.facts.length && <ul className="people-list">{detail.facts.slice(0, 10).map((line) => <li key={line.id}>{line.text}</li>)}</ul>}</section>}
      {(!!read?.watch || !!read?.unknowns.length) && <section className="people-card">{read?.watch && <p className="people-watch"><b>{t("要留意", "Keep an eye on", "Ojo")}</b>{read.watch}</p>}{!!read?.unknowns.length && <><h2>{t("还不知道的", "Still unknown", "Aún no se sabe")}</h2><ul className="people-list">{read.unknowns.map((item, index) => <li key={index}>{item}</li>)}</ul></>}</section>}
      {read?.feeling && <section className="people-card"><h2>{t("你的感觉", "How you feel", "Cómo te sientes")}</h2><p>{read.feeling}</p></section>}
      {detail && !read && !detail.history.length && !detail.facts.length && <p className="people-muted">{t("还没记下关于 TA 的事。多发几张你们的聊天，或者跟 Pinky 说说 TA。", "Nothing kept yet. Send more of your chats, or tell Pinky about them.", "Aún no hay nada. Envía más chats o cuéntale a Pinky.")}</p>}
      {person && <div className="people-actions">
        <button type="button" className="people-primary" onClick={() => onAsk(t(`关于 ${person.name}，`, `About ${person.name}: `, `Sobre ${person.name}: `), "me")} data-testid="person-talk"><ChatCircleDots size={20} weight="fill" />{t(`和 Pinky 聊 ${person.name}`, `Talk about ${person.name}`, `Hablar de ${person.name}`)}</button>
        {!archived && <button type="button" className="people-secondary" onClick={() => void archive()} data-testid="person-archive">{t("先放下 TA", "Set aside", "Dejar aparte")}</button>}
      </div>}
    </main>
  </div>;
}
