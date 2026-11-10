import { useEffect, useState } from "react";
import { Plus } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { BottomSheet, Carousel } from "../../mobile";
import { relationshipApi } from "../relationship/api";
import "./people.css";

// 我的 TA 们 (founder 11-09: someone single may be getting to know several people, and must find this without being taught).
// The cards appear by themselves: a chat screenshot with someone new files them, and from then on they sit in a row at the
// top of Just me. Tapping one shows what Pinky keeps about them; 对比 and 完整档案 open the 我的 TA 们 page.
export type Person = { id: string; name: string; aliases: string[]; archived: boolean; lastSeenAt: string; facts: number; thread?: { id: string; updatedAt: string; lastFrom: string | null } | null };
/** One Pinky, three stages (founder 11-09): getting to know several people, settled on one, together in Pinky. */
export type Stage = "dating" | "chosen" | "together";
export type PeopleState = { people: Person[]; stage: Stage; chosen: Person | null };

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

export function PeopleRow({ language, people, current, unread, brainUnread, onBrain, onOpen, onAdd }: { language: Language; people: Person[]; current: string | null; unread: string[]; brainUnread: boolean; onBrain: () => void; onOpen: (person: Person) => void; onAdd: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  if (!people.length) return null;
  // Founder 11-09: "点击一个人，然后自动是一个会话……还有一个主会话，就算大脑，可以问所有人的关系".
  return <Carousel ariaLabel={t("对话", "Conversations", "Conversaciones")} className="people-row" contentClassName="people-row-track">
    <button type="button" className={`person-chip ${current === null ? "current" : ""}`} onClick={onBrain} aria-current={current === null ? "true" : undefined} data-testid="thread-brain"><span className="person-avatar brain">P</span>{brainUnread && current !== null && <i className="chip-dot" aria-label={t("有新消息", "New message", "Mensaje nuevo")} />}<small>Pinky</small></button>
    {people.map((person) => <button key={person.id} type="button" className={`person-chip ${current === person.id ? "current" : ""}`} onClick={() => onOpen(person)} aria-current={current === person.id ? "true" : undefined} data-testid="person-chip"><Avatar name={person.name} />{unread.includes(person.id) && <i className="chip-dot" aria-label={t("有新消息", "New message", "Mensaje nuevo")} />}<small>{person.name}</small></button>)}
    <button type="button" className="person-chip" onClick={onAdd} data-testid="person-add"><span className="person-avatar add"><Plus size={18} /></span><small>{t("新的人", "Someone new", "Alguien nuevo")}</small></button>
  </Carousel>;
}


