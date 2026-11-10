import { useEffect, useState, type CSSProperties } from "react";
import { ArrowLeft, ChatCircleDots, Warning } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { PageHeader } from "../conversation/ConversationHome";
import { relationshipApi } from "../relationship/api";
import { Avatar, personColor } from "./People";
import "./people-page.css";

// 在了解的人 (founder 11-09, third mockup): a page for seeing each relationship, not for tasks. Who is chasing whom and how
// deep it goes, what only shows across all of them, and for each person a mirror of the two of them, the turning points,
// who they are and how Pinky reads it. Numbers are counted from the chats; Pinky judges only what text has to show.
type Kind = "mutual" | "you_chase" | "they_chase" | "early" | "faded" | "risk";
type Chase = "you_much" | "you" | "even" | "them" | "them_much";
type Row = { id: string; name: string; kind: Kind; chase: Chase; depth: "shallow" | "medium" | "deep"; shares: "me" | "even" | "them" | "unknown"; view: string; self: string; quote: { text: string; who: "me" | "them"; date: string } | null; traits: Array<{ text: string; evidence: string }>; turns: Array<{ date: string; up: boolean; title: string; quote: string; note: string }> };
type Side = { messages: number; questions: number; chars: number };
type Numbers = { me: Side; them: Side; starts: { me: number; them: number } | null; replyMinutes: { me: number | null; them: number | null } | null; lateNight: { me: number; them: number } | null; longestSilence: number | null; first: string | null; last: string | null };
type PersonInfo = { id: string; name: string; lastSeenAt: string; createdAt?: string; stage: Kind | null; chase: Chase | null; previousChase: Chase | null; chaseAt: string | null };
type Board = { status: "ready" | "pending" | "failed" | "few" | "unavailable"; stale?: boolean; reading?: { insights: Array<{ headline: string; evidence: string }>; people: Row[] }; numbers?: Record<string, Numbers | null>; people: PersonInfo[] };
type Line = { id: string; category: string; text: string };
type Detail = { person: PersonInfo; facts: Line[]; history: Line[]; numbers: Numbers | null; read: Row | null };

const PLACE: Record<Chase, number> = { you_much: 12, you: 30, even: 50, them: 70, them_much: 88 };
const SIZE = { shallow: 16, medium: 23, deep: 30 };
const DAY = 24 * 60 * 60 * 1000;
const days = (from: string) => Math.max(0, Math.floor((Date.now() - Date.parse(from)) / DAY));

function tFor(language: Language) { return (zh: string, en: string, es: string) => localized(language, zh, en, es); }

/** How long they have known each other and when they last talked, in plain words. */
function since(language: Language, person: PersonInfo, numbers: Numbers | null | undefined) {
  const t = tFor(language);
  const start = numbers?.first || person.createdAt || person.lastSeenAt;
  const known = days(start), last = days(numbers?.last || person.lastSeenAt);
  const span = known < 14 ? t(`${known || 1} 天`, `${known || 1} days`, `${known || 1} días`) : known < 60 ? t(`${Math.round(known / 7)} 周`, `${Math.round(known / 7)} weeks`, `${Math.round(known / 7)} semanas`) : t(`${Math.round(known / 30)} 个月`, `${Math.round(known / 30)} months`, `${Math.round(known / 30)} meses`);
  const recent = last === 0 ? t("今天", "today", "hoy") : last === 1 ? t("昨天", "yesterday", "ayer") : t(`${last} 天前`, `${last} days ago`, `hace ${last} días`);
  return t(`认识 ${span} · 最近：${recent}`, `Known ${span} · last: ${recent}`, `Desde hace ${span} · último: ${recent}`);
}

/** One you-versus-them bar: the left share is the member's. */
function Mirror({ label, note, me, them, left, right, color }: { label: string; note: string; me: number; them: number; left?: string; right?: string; color: string }) {
  const total = me + them, mine = total ? Math.round(me / total * 100) : 50;
  return <div className="mirror-row"><span className="mirror-label"><span>{label}</span><small>{note}</small></span>
    {left !== undefined && <b className="mirror-me">{left}</b>}
    <span className="mirror-bar" aria-hidden="true"><i style={{ width: `${mine}%` }} /><i style={{ width: `${100 - mine}%`, background: color }} /></span>
    {right !== undefined && <b className="mirror-them" style={{ color }}>{right}</b>}</div>;
}

/** The rows a pair can honestly show: counted ones when counted, Pinky's judgement only for who opens up. */
function mirrors(language: Language, numbers: Numbers | null | undefined, row: Row | null, color: string, full: boolean) {
  const t = tFor(language);
  const lean = (me: number, them: number, mine: string, theirs: string) => me === them || Math.abs(me - them) / Math.max(1, me + them) < 0.12 ? t("差不多", "about even", "parecido") : me > them ? mine : theirs;
  const rows = [];
  if (numbers?.starts) rows.push(<Mirror key="starts" label={t("谁先开口", "Who starts", "Quién empieza")} note={lean(numbers.starts.me, numbers.starts.them, t("你更主动", "you, more", "tú, más"), t("TA 更主动", "they, more", "más esa persona"))} me={numbers.starts.me} them={numbers.starts.them} color={color} {...(full ? { left: `${Math.round(numbers.starts.me / Math.max(1, numbers.starts.me + numbers.starts.them) * 100)}%`, right: `${Math.round(numbers.starts.them / Math.max(1, numbers.starts.me + numbers.starts.them) * 100)}%` } : {})} />);
  else if (numbers && numbers.me.messages + numbers.them.messages > 0) rows.push(<Mirror key="talk" label={t("谁说得多", "Who writes more", "Quién escribe más")} note={lean(numbers.me.messages, numbers.them.messages, t("你多", "you", "tú"), t("TA 多", "they", "esa persona"))} me={numbers.me.messages} them={numbers.them.messages} color={color} {...(full ? { left: String(numbers.me.messages), right: String(numbers.them.messages) } : {})} />);
  if (numbers && numbers.me.questions + numbers.them.questions > 0) rows.push(<Mirror key="questions" label={t("谁在提问", "Who asks", "Quién pregunta")} note={lean(numbers.me.questions, numbers.them.questions, t("你更好奇", "you're curious", "tú preguntas"), t("TA 更好奇你", "they're curious", "le interesas"))} me={numbers.me.questions} them={numbers.them.questions} color={color} {...(full ? { left: String(numbers.me.questions), right: String(numbers.them.questions) } : {})} />);
  if (row && row.shares !== "unknown") { const split = row.shares === "me" ? [65, 35] : row.shares === "them" ? [35, 65] : [50, 50]; rows.push(<Mirror key="shares" label={t("说心里话", "Opens up", "Se abre")} note={row.shares === "me" ? t("你更多", "you, more", "tú, más") : row.shares === "them" ? t("TA 更多", "they, more", "esa persona") : t("一样多", "both", "igual")} me={split[0]} them={split[1]} color={color} />); }
  if (full && numbers?.replyMinutes?.me != null && numbers.replyMinutes.them != null) { const { me, them } = numbers.replyMinutes as { me: number; them: number }; rows.push(<Mirror key="reply" label={t("回复速度", "Reply speed", "Rapidez")} note={lean(them, me, t("你回得快", "you're quicker", "tú respondes antes"), t("TA 回得快", "they're quicker", "responde antes"))} me={them} them={me} color={color} left={minutes(language, me)} right={minutes(language, them)} />); }
  if (full && numbers?.lateNight && numbers.lateNight.me + numbers.lateNight.them > 0) rows.push(<Mirror key="night" label={t("深夜还在聊", "Late at night", "De madrugada")} note={t("零点到五点的消息", "midnight to 5 am", "de 0 a 5 h")} me={numbers.lateNight.me} them={numbers.lateNight.them} color={color} left={`${numbers.lateNight.me}%`} right={`${numbers.lateNight.them}%`} />);
  return rows;
}
const minutes = (language: Language, value: number) => value < 60 ? localized(language, `${Math.round(value)} 分`, `${Math.round(value)}m`, `${Math.round(value)} min`) : localized(language, `${Math.round(value / 60)} 小时`, `${Math.round(value / 60)}h`, `${Math.round(value / 60)} h`);

export function PeoplePage({ language, initialPerson, onBack, onAsk }: { language: Language; initialPerson: string; onBack: () => void; onAsk: (text: string, channel: "me" | "us") => void }) {
  const t = tFor(language);
  const [personId, setPersonId] = useState(initialPerson);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
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
  }, [language]);
  const kinds: Record<Kind, string> = { mutual: t("双向奔赴", "Both in", "Mutuo"), you_chase: t("你在追", "You're chasing", "Tú persigues"), they_chase: t("TA 在追", "They're chasing", "Te persigue"), early: t("刚开始", "Just started", "Empezando"), faded: t("淡了", "Faded", "Se apagó"), risk: t("要警惕", "Be careful", "Cuidado") };
  if (personId) return <PersonPage language={language} id={personId} kinds={kinds} onBack={() => setPersonId("")} onAsk={onAsk} />;

  const reading = board?.status === "ready" ? board.reading || null : null;
  const rowOf = (id: string) => reading?.people.find((row) => row.id === id) || null;
  const people = board?.people || [];
  const risky = people.filter((person) => rowOf(person.id)?.kind === "risk");
  const onTrack = people.filter((person) => rowOf(person.id) && rowOf(person.id)!.kind !== "risk");
  const moved = onTrack.filter((person) => person.previousChase && person.chaseAt && person.previousChase !== person.chase && days(person.chaseAt) <= 14);
  const order: Kind[] = ["mutual", "they_chase", "early", "you_chase", "faded", "risk"];
  const sorted = people.slice().sort((a, b) => order.indexOf(rowOf(a.id)?.kind || "early") - order.indexOf(rowOf(b.id)?.kind || "early"));

  return <div className="paper-screen relationship-shell people-screen" data-testid="people-page">
    <PageHeader language={language} title={t("在了解的人", "People I'm seeing", "Las personas que conozco")} onBack={onBack} />
    <main className="relationship-main people-main">
      {error && <p className="people-error" role="alert">{error}</p>}
      {!board ? <p className="people-muted">{t("正在打开…", "Opening…", "Abriendo…")}</p>
        : !people.length ? <p className="people-muted">{t("还没有在了解的人。在“只有我”发一张和 TA 的聊天截图，Pinky 会自动建档。", "Nobody yet. Send a chat screenshot in Just me and Pinky files them.", "Nadie aún. Envía una captura en Solo yo y Pinky la archiva.")}</p>
        : board.status === "few" ? <p className="people-muted">{t("再认识一个人，Pinky 就会把你们的关系放在一起看。", "With one more person, Pinky shows your relationships side by side.", "Con una persona más, Pinky muestra todo junto.")}</p>
        : !reading ? <p className="people-muted">{board.status === "failed" ? t("这次没能看完，稍后再打开。", "Couldn't finish this time. Open it again later.", "No pude terminar. Vuelve más tarde.") : t("Pinky 正在看你们的聊天…", "Pinky is reading your chats…", "Pinky está leyendo sus chats…")}</p>
        : <>
          {!!onTrack.length && <section className="people-card" data-testid="people-balance">
            <div className="people-card-head"><h2>{t("谁在追谁", "Who's chasing whom", "Quién persigue a quién")}</h2><small>{t("圆越大，聊得越深", "Bigger dot, deeper talks", "Más grande, más profundo")}</small></div>
            <div className="balance-legend" aria-hidden="true"><span /><span><i>{t("你在追", "You chase", "Tú")}</i><b>{t("双向", "Mutual", "Mutuo")}</b><em>{t("TA 在追", "They chase", "Esa persona")}</em></span></div>
            {onTrack.map((person) => { const row = rowOf(person.id)!; const color = personColor(person.name); const was = moved.includes(person) ? PLACE[person.previousChase!] : null; const size = SIZE[row.depth];
              return <button key={person.id} type="button" className="balance-row" onClick={() => setPersonId(person.id)} data-testid="balance-row" aria-label={`${person.name}：${kinds[row.kind]}`}>
                <span className="balance-who"><Avatar name={person.name} small /><span>{person.name}</span></span>
                <span className="balance-track"><span className="balance-line" /><span className="balance-mid" />
                  {was !== null && <><span className="balance-dot ghost" style={{ left: `${was}%`, width: size, height: size, background: color } as CSSProperties} /><span className="balance-arrow" style={{ left: `${Math.min(was, PLACE[row.chase])}%`, width: `${Math.abs(was - PLACE[row.chase])}%`, borderColor: color } as CSSProperties} /></>}
                  <span className="balance-dot" style={{ left: `${PLACE[row.chase]}%`, width: size, height: size, background: color } as CSSProperties} /></span>
              </button>; })}
            {!!moved.length && <p className="people-muted small">{t("箭头是这两周的变化：", "Arrows are the last two weeks: ", "Las flechas son las dos últimas semanas: ")}{moved.map((person) => t(`${person.name} 从“${kinds[chaseKind(person.previousChase!)]}”变成了“${kinds[chaseKind(person.chase!)]}”`, `${person.name} went from “${kinds[chaseKind(person.previousChase!)]}” to “${kinds[chaseKind(person.chase!)]}”`, `${person.name}: de «${kinds[chaseKind(person.previousChase!)]}» a «${kinds[chaseKind(person.chase!)]}»`)).join(t("；", "; ", "; "))}</p>}
            {risky.map((person) => <p key={person.id} className="people-risk"><b>{t(`${person.name} 不在这里：`, `${person.name} isn't here: `, `${person.name} no está aquí: `)}</b>{rowOf(person.id)!.view}</p>)}
          </section>}
          {!!reading.insights.length && <section className="people-section" data-testid="people-insights"><h2>{t("Pinky 看到你的规律", "Patterns Pinky sees in you", "Lo que Pinky ve en ti")}</h2>
            {reading.insights.map((item, index) => <div key={index} className="people-insight"><b>{item.headline}</b><span>{item.evidence}</span></div>)}</section>}
          <section className="people-section"><h2>{t("每个人", "Each person", "Cada persona")}</h2>
            {sorted.map((person) => { const row = rowOf(person.id); const color = personColor(person.name); const risk = row?.kind === "risk";
              return <button key={person.id} type="button" className={`people-person-card ${risk ? "risk" : ""} kind-${row?.kind || "none"}`} onClick={() => setPersonId(person.id)} data-testid="people-person">
                <span className="person-card-head"><Avatar name={person.name} /><span><strong>{person.name}</strong><small>{since(language, person, board.numbers?.[person.id])}</small></span>{row && <span className={`people-kind kind-${row.kind}`}>{kinds[row.kind]}</span>}</span>
                {risk ? <span className="people-risk-text"><Warning size={16} weight="fill" />{row!.view}</span> : <>
                  {mirrors(language, board.numbers?.[person.id], row, color, false)}
                  {!!row?.traits.length && <span className="people-traits">{row.traits.slice(0, 3).map((trait, index) => <span key={index}>{trait.text}</span>)}</span>}
                  {row?.quote && <span className="people-quote">“{row.quote.text}” <small>{row.quote.who === "me" ? t("你", "you", "tú") : "TA"} · {row.quote.date}</small></span>}
                </>}
              </button>; })}
          </section>
        </>}
    </main>
  </div>;
}

const chaseKind = (chase: Chase): Kind => chase === "you_much" || chase === "you" ? "you_chase" : chase === "them" || chase === "them_much" ? "they_chase" : "mutual";

/** One person: the two of them as a mirror, the turning points, who they are, how the member is with them, Pinky's read. */
function PersonPage({ language, id, kinds, onBack, onAsk }: { language: Language; id: string; kinds: Record<Kind, string>; onBack: () => void; onAsk: (text: string, channel: "me" | "us") => void }) {
  const t = tFor(language);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    relationshipApi<Detail>(`/api/people/${encodeURIComponent(id)}?language=${language}`).then((result) => { if (alive) setDetail(result); }).catch((reason) => { if (alive) setError((reason as Error).message); });
    return () => { alive = false; };
  }, [id, language]);
  const person = detail?.person, read = detail?.read || null, numbers = detail?.numbers || null;
  const color = person ? personColor(person.name) : "#888";
  const rows = person ? mirrors(language, numbers, read, color, true) : [];
  const count = numbers ? numbers.me.messages + numbers.them.messages : 0;
  return <div className="paper-screen relationship-shell people-screen" data-testid="person-page">
    <header className="page-header"><button className="page-back" onClick={onBack} data-testid="person-back"><ArrowLeft size={20} />{t("在了解的人", "People", "Personas")}</button></header>
    <main className="relationship-main people-main">
      {error && <p className="people-error" role="alert">{error}</p>}
      {!detail ? !error && <p className="people-muted">{t("正在打开…", "Opening…", "Abriendo…")}</p> : person && <>
        <div className="person-top"><Avatar name={person.name} /><span><h1>{t(`你和${person.name}`, `You and ${person.name}`, `Tú y ${person.name}`)}</h1><small>{since(language, person, numbers)}{count ? t(` · ${count} 条聊天`, ` · ${count} messages`, ` · ${count} mensajes`) : ""}</small></span>{read && <span className={`people-kind kind-${read.kind}`}>{kinds[read.kind]}</span>}</div>
        {read?.kind === "risk" && <p className="people-risk"><b>{t("要警惕：", "Be careful: ", "Cuidado: ")}</b>{read.view}</p>}
        {!!rows.length && <section className="people-card" data-testid="person-mirror"><div className="people-card-head"><h2>{t("你们俩，像一面镜子", "The two of you, side by side", "Ustedes dos, frente a frente")}</h2><small><i className="key-me" /> {t("你", "you", "tú")}　<i className="key-them" style={{ background: color }} /> TA</small></div>{rows}
          {!numbers?.starts && <p className="people-muted small">{t("导入带时间的完整聊天记录后，还能看到谁先开口、回复速度和深夜聊天。", "Import a full chat history with times to also see who starts, reply speed and late nights.", "Importa un historial con horas para ver quién empieza y la rapidez.")}</p>}</section>}
        {!!read?.turns.length && <section className="people-card" data-testid="person-turns"><h2>{t("关系的转折点", "Turning points", "Momentos clave")}</h2>
          {read.turns.map((turn, index) => <div key={index} className={`people-turn ${turn.up ? "up" : "down"}`}><span aria-label={turn.up ? t("变近", "closer", "más cerca") : t("变远", "further", "más lejos")}>{turn.up ? "↑" : "↓"}</span><span><b>{turn.date} {turn.title}</b>{turn.quote && <q>{turn.quote}</q>}{turn.note && <small>{turn.note}</small>}</span></div>)}</section>}
        {!!read?.traits.length && <section className="people-card"><h2>{t(`${person.name}是个怎样的人`, `Who ${person.name} is`, `Cómo es ${person.name}`)}</h2><div className="people-trait-grid">{read.traits.map((trait, index) => <div key={index}><b>{trait.text}</b><span>{trait.evidence}</span></div>)}</div></section>}
        {read?.self && <section className="people-card"><h2>{t("你在这段关系里的样子", "You, in this one", "Tú, en esta relación")}</h2><p>{read.self}</p></section>}
        {read?.view && read.kind !== "risk" && <section className="people-card people-read" data-testid="person-view"><h2>{t("Pinky 怎么看", "How Pinky sees it", "Cómo lo ve Pinky")}</h2><p>{read.view}</p></section>}
        {!read && <section className="people-card"><h2>{t("你们之间发生过的事", "What happened between you", "Lo que ha pasado")}</h2>{detail.history.length || detail.facts.length ? <ul className="people-list">{[...detail.history, ...detail.facts].slice(0, 12).map((line) => <li key={line.id}>{line.text}</li>)}</ul> : <p className="people-muted">{t("还没记下关于 TA 的事。多发几张你们的聊天，Pinky 会慢慢看清这段关系。", "Nothing kept yet. Send more of your chats.", "Aún no hay nada. Envía más chats.")}</p>}</section>}
        <button type="button" className="people-primary" onClick={() => onAsk(t(`关于 ${person.name}，`, `About ${person.name}: `, `Sobre ${person.name}: `), "me")} data-testid="person-talk"><ChatCircleDots size={20} weight="fill" />{t(`和 Pinky 聊${person.name}`, `Talk about ${person.name}`, `Hablar de ${person.name}`)}</button>
      </>}
    </main>
  </div>;
}
