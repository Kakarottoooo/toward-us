import { useEffect, useState } from "react";
import { Plus, UsersThree } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { BottomSheet, Carousel } from "../../mobile";
import { relationshipApi } from "../relationship/api";
import "./people.css";

// 我的 TA 们 (founder 11-09: someone single may be getting to know several people, and must find this without being taught).
// The cards appear by themselves: a chat screenshot with someone new files them, and from then on they sit in a row at the
// top of Just me. Tapping one shows what Pinky keeps about them; 对比 and 完整档案 open the 我的 TA 们 page.
export type Person = { id: string; name: string; aliases: string[]; archived: boolean; lastSeenAt: string; facts: number };
/** One Pinky, three stages (founder 11-09): getting to know several people, settled on one, together in Pinky. */
export type Stage = "dating" | "chosen" | "together";
export type PeopleState = { people: Person[]; stage: Stage; chosen: Person | null };
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
  const [state, setState] = useState<PeopleState>({ people: [], stage: "dating", chosen: null });
  useEffect(() => {
    let alive = true;
    // Listing them also has Pinky refresh its reading in the background, so 在了解的人 is ready when opened.
    relationshipApi<PeopleState>(`/api/people?language=${language}`).then((result) => { if (alive) setState({ people: result.people, stage: result.stage || "dating", chosen: result.chosen || null }); }).catch(() => {});
    return () => { alive = false; };
  }, [refresh, language]);
  return state;
}

/** Strips a note such as （可删） from a name for sentences. */
export const plainName = (name: string) => name.replace(/[（(][^）)]*[）)]/g, "").trim() || name;

/** The moment someone is the one: what happens to everyone else and what the person invited will and will not see. */
export function TogetherSheet({ language, person, others, onClose, onInvite }: { language: Language; person: Person | null; others: number; onClose: () => void; onInvite: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const name = person ? plainName(person.name) : "";
  return <BottomSheet open={Boolean(person)} onOpenChange={(next) => { if (!next) onClose(); }} title={t(`你和${name}确定了`, `You and ${name}`, `Tú y ${name}`)} description={t("恭喜。接下来会这样：", "Congratulations. Here is what happens next:", "Enhorabuena. Esto es lo que pasa ahora:")}>
    {person && <div className="person-sheet" data-testid="together-sheet">
      <ul>
        {others > 0 && <li>{t(`其他 ${others} 个人先收起来，不会删除；以后在 设置 → 隐私 → 以前的档案 里还能看到。`, `The other ${others} are put away, not deleted; you can still find them in Settings → Privacy → Earlier people.`, `Las otras ${others} quedan guardadas, no borradas; están en Ajustes → Privacidad.`)}</li>}
        <li>{t(`${name}永远看不到他们，也看不到你和 Pinky 聊过的私密内容。`, `${name} will never see them, nor what you told Pinky in private.`, `${name} nunca las verá, ni lo que le contaste a Pinky en privado.`)}</li>
        <li>{t(`Pinky 记得的关于${name}的事只有你看得到，想分享哪条再分享。`, `What Pinky remembers about ${name} stays yours; share only what you choose.`, `Lo que Pinky recuerda de ${name} es solo tuyo; comparte lo que quieras.`)}</li>
      </ul>
      <div className="person-actions">
        <button type="button" className="person-primary" onClick={onInvite} data-testid="together-invite">{t(`邀请${name}一起用 Pinky`, `Invite ${name} to Pinky`, `Invitar a ${name} a Pinky`)}</button>
        <button type="button" className="person-secondary" onClick={onClose} data-testid="together-later">{t("先不邀请", "Not now", "Ahora no")}</button>
      </div>
    </div>}
  </BottomSheet>;
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
export function PersonSheet({ language, person, onClose, onChat, onFull }: { language: Language; person: Person | null; onClose: () => void; onChat: (person: Person) => void; onFull: (person: Person) => void }) {
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
        <button type="button" className="person-secondary" onClick={() => onFull(person)} data-testid="person-full">{t("完整档案", "Full page", "Ficha completa")}</button>
      </div>
    </div>}
  </BottomSheet>;
}

