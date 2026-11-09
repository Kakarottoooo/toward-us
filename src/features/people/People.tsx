import { useEffect, useState } from "react";
import { Plus, UsersThree } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { BottomSheet, Carousel } from "../../mobile";
import { relationshipApi } from "../relationship/api";
import "./people.css";

// 我的 TA 们 (founder 11-09: someone single may be getting to know several people, and must find this without being taught).
// The cards appear by themselves: a chat screenshot with someone new files them, and from then on they sit in a row at the
// top of Just me. Tapping one shows what Pinky keeps about them; 对比 opens a page Pinky has already filled in by itself.
export type Person = { id: string; name: string; aliases: string[]; archived: boolean; lastSeenAt: string; facts: number };
type Line = { id: string; category: string; text: string; quote: string | null };

const COLORS = ["#d9677c", "#2c8f86", "#c98a1c", "#5b6fd6", "#8a5cc2", "#3f8f4f"];
/** The same colour for a name every time, so a person is recognised at a glance. */
export const personColor = (name: string) => COLORS[[...name].reduce((sum, char) => sum + char.codePointAt(0)!, 0) % COLORS.length];
// 阿杰, 小周, 老王: the familiar prefix says nothing, so the next character stands for them.
const initial = (name: string) => { const chars = [...name.trim()]; return (chars.length > 1 && /^[阿小老]$/.test(chars[0]) ? chars[1] : chars[0])?.toUpperCase() || "?"; };

export function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  return <span className={`person-avatar ${small ? "small" : ""}`} style={{ background: personColor(name) }} aria-hidden="true">{initial(name)}</span>;
}

/** The people this member is getting to know, reloaded whenever `refresh` changes (a new note may have filed someone). */
export function usePeople(refresh: unknown, language: Language) {
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    let alive = true;
    // Listing them also has Pinky refresh its comparison in the background, so 对比 is ready when opened.
    relationshipApi<{ people: Person[] }>(`/api/people?language=${language}`).then((result) => { if (alive) setPeople(result.people); }).catch(() => {});
    return () => { alive = false; };
  }, [refresh, language]);
  return people;
}

export function PeopleRow({ language, people, onOpen, onCompare, onAdd }: { language: Language; people: Person[]; onOpen: (person: Person) => void; onCompare: () => void; onAdd: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  if (!people.length) return null;
  return <Carousel ariaLabel={t("我在了解的人", "People I'm getting to know", "Personas que estoy conociendo")} className="people-row" contentClassName="people-row-track">
    {people.length > 1 && <button type="button" className="person-chip" onClick={onCompare} data-testid="people-compare"><span className="person-avatar compare"><UsersThree size={20} /></span><small>{t("对比", "Compare", "Comparar")}</small></button>}
    {people.map((person) => <button key={person.id} type="button" className="person-chip" onClick={() => onOpen(person)} data-testid="person-chip"><Avatar name={person.name} /><small>{person.name}</small></button>)}
    <button type="button" className="person-chip" onClick={onAdd} data-testid="person-add"><span className="person-avatar add"><Plus size={18} /></span><small>{t("新的人", "Someone new", "Alguien nuevo")}</small></button>
  </Carousel>;
}

/** One person's card: what Pinky keeps about them and what happened, with talking to Pinky about them as the next step. */
export function PersonSheet({ language, person, others, onClose, onChat, onCompare }: { language: Language; person: Person | null; others: number; onClose: () => void; onChat: (person: Person) => void; onCompare: (person: Person) => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [detail, setDetail] = useState<{ facts: Line[]; history: Line[] } | null>(null);
  useEffect(() => {
    setDetail(null);
    if (!person) return;
    let alive = true;
    relationshipApi<{ facts: Line[]; history: Line[] }>(`/api/people/${encodeURIComponent(person.id)}`).then((result) => { if (alive) setDetail(result); }).catch(() => { if (alive) setDetail({ facts: [], history: [] }); });
    return () => { alive = false; };
  }, [person?.id]);
  const empty = detail && !detail.facts.length && !detail.history.length;
  return <BottomSheet open={Boolean(person)} onOpenChange={(next) => { if (!next) onClose(); }} title={person?.name || ""} description={t("只有你看得到", "Only you can see this", "Solo tú lo ves")}>
    {person && <div className="person-sheet" data-testid="person-sheet">
      {!detail ? <p className="person-muted">{t("正在打开…", "Opening…", "Abriendo…")}</p>
        : empty ? <p className="person-muted">{t(`还没记下关于 ${person.name} 的事。多发几张你们的聊天，或者直接跟 Pinky 说说 TA。`, `Nothing kept about ${person.name} yet. Send more of your chats, or tell Pinky about them.`, `Aún no hay nada sobre ${person.name}. Envía más chats o cuéntale a Pinky.`)}</p>
        : <>
          {!!detail.history.length && <section><h3>{t("你们之间发生过的事", "What happened between you", "Lo que ha pasado")}</h3><ul>{detail.history.slice(0, 6).map((line) => <li key={line.id}>{line.text}</li>)}</ul></section>}
          {!!detail.facts.length && <section><h3>{t("关于 TA", "About them", "Sobre esta persona")}</h3><ul>{detail.facts.slice(0, 10).map((line) => <li key={line.id}>{line.text}</li>)}</ul></section>}
        </>}
      <div className="person-actions">
        <button type="button" className="person-primary" onClick={() => onChat(person)} data-testid="person-chat">{t(`和 Pinky 聊 ${person.name}`, `Talk about ${person.name}`, `Hablar de ${person.name}`)}</button>
        {others > 0 && <button type="button" className="person-secondary" onClick={() => onCompare(person)} data-testid="person-compare">{t("和其他人对比", "Compare", "Comparar")}</button>}
      </div>
    </div>}
  </BottomSheet>;
}

type Stage = "new" | "warming" | "close" | "cooling" | "risk" | "ended";
type Row = { id: string; name: string; stage: Stage; going: string; watch: string; next: string };
type Comparison = { overview: string; leaning: string; ask: string; people: Row[] };
type CompareState = { status: "ready" | "pending" | "failed" | "few" | "unavailable"; stale?: boolean; comparison?: Comparison };

/** 对比 (founder 11-09: "它自动会识别这些暧昧对象，然后自动对比"): everyone at once, compared by Pinky without picking anyone. */
export function PeopleCompare({ language, open, people, onClose, onOpenPerson, onAnswer, onAsk }: { language: Language; open: boolean; people: Person[]; onClose: () => void; onOpenPerson: (person: Person) => void; onAnswer: () => void; onAsk: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [state, setState] = useState<CompareState | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true, timer = 0, tries = 0;
    const load = () => relationshipApi<CompareState>(`/api/people/compare?language=${language}`).then((result) => {
      if (!alive) return;
      setState(result);
      // A new comparison is being made in the background: look again until it is in.
      if ((result.status === "pending" || result.stale) && ++tries < 60) timer = window.setTimeout(load, 3000);
    }).catch(() => { if (alive) setState({ status: "failed" }); });
    void load();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [open, language]);
  const stages: Record<Stage, string> = {
    new: t("刚认识", "Just met", "Recién conocidos"), warming: t("在升温", "Warming up", "Acercándose"), close: t("很近了", "Getting close", "Muy cerca"),
    cooling: t("在降温", "Cooling off", "Enfriándose"), risk: t("要当心", "Be careful", "Cuidado"), ended: t("已经淡了", "Faded", "Se apagó"),
  };
  const comparison = state?.status === "ready" ? state.comparison || null : null;
  const leaning = comparison?.people.find((row) => row.id === comparison.leaning);
  const openRow = (row: Row) => { const person = people.find((item) => item.id === row.id); if (person) onOpenPerson(person); };
  return <BottomSheet open={open} onOpenChange={(next) => { if (!next) onClose(); }} snap={0.9} title={t("Pinky 的对比", "Pinky's comparison", "La comparación de Pinky")} description={t("只有你看得到 · 有新聊天会自动更新", "Only you can see this · updates with new chats", "Solo tú lo ves · se actualiza con chats nuevos")}>
    <div className="compare-page" data-testid="compare-page">
      {!state || state.status === "pending" ? <p className="person-muted">{t("Pinky 正在把你在了解的人放在一起看…", "Pinky is looking at everyone together…", "Pinky está mirando a todos juntos…")}</p>
        : state.status === "few" ? <p className="person-muted">{t("再多认识一个人，Pinky 就会自动帮你对比。", "With one more person, Pinky compares them for you.", "Con una persona más, Pinky las compara por ti.")}</p>
        : !comparison ? <p className="person-muted">{t("这次没能对比好，稍后再打开看看。", "Couldn't compare them this time. Open it again later.", "No pude compararlas esta vez. Vuelve a abrirlo más tarde.")}</p>
        : <>
          <section className="compare-overview" data-testid="compare-overview">
            {leaning && <p className="compare-leaning"><Avatar name={leaning.name} small />{t(`目前更倾向 ${leaning.name}`, `Leaning toward ${leaning.name}`, `Por ahora, ${leaning.name}`)}</p>}
            <p>{comparison.overview}</p>
            {state.stale && <p className="person-muted">{t("有新聊天，正在更新…", "New chats in, updating…", "Hay chats nuevos, actualizando…")}</p>}
          </section>
          {comparison.people.map((row) => <button type="button" key={row.id} className="compare-row" onClick={() => openRow(row)} data-testid="compare-row">
            <span className="compare-head"><Avatar name={row.name} small /><strong>{row.name}</strong><span className={`compare-stage stage-${row.stage}`}>{stages[row.stage]}</span></span>
            {row.going && <span className="compare-line"><b>{t("顺利", "Good", "Bien")}</b>{row.going}</span>}
            {row.watch && <span className="compare-line watch"><b>{t("留意", "Watch", "Ojo")}</b>{row.watch}</span>}
            {row.next && <span className="compare-line"><b>{t("下一步", "Next", "Luego")}</b>{row.next}</span>}
          </button>)}
          {comparison.ask && <p className="compare-ask">{comparison.ask}</p>}
          <div className="person-actions">
            {comparison.ask
              ? <button type="button" className="person-primary" onClick={onAnswer} data-testid="compare-answer">{t("回答 Pinky", "Answer Pinky", "Responder a Pinky")}</button>
              : <button type="button" className="person-primary" onClick={onAsk} data-testid="compare-chat">{t("和 Pinky 聊聊", "Talk it over with Pinky", "Hablarlo con Pinky")}</button>}
          </div>
        </>}
    </div>
  </BottomSheet>;
}
