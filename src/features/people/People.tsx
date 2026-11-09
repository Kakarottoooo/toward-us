import { useEffect, useState } from "react";
import { Plus, UsersThree } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { BottomSheet, Carousel } from "../../mobile";
import { relationshipApi } from "../relationship/api";
import "./people.css";

// 我的 TA 们 (founder 11-09: someone single may be getting to know several people, and must find this without being taught).
// The cards appear by themselves: a chat screenshot with someone new files them, and from then on they sit in a row at the
// top of Just me. Tapping one shows what Pinky keeps about them; comparing is a question to Pinky, not a separate screen.
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
export function usePeople(refresh: unknown) {
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    let alive = true;
    relationshipApi<{ people: Person[] }>("/api/people").then((result) => { if (alive) setPeople(result.people); }).catch(() => {});
    return () => { alive = false; };
  }, [refresh]);
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
