import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { DotsThree, HandHeart, PawPrint, Sparkle, X } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { MobileScroll, useKeyboard } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";
import type { Character } from "./character";

export type PetView = { points: number; level: number; floor: number; next: number; mood: "happy" | "calm" | "sleepy"; pettedByMe: boolean; pettedByPartner: boolean; gains: Array<{ type: string; points: number; day: string }> };
type Spot = { side: "left" | "right"; y: number };

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const petImage = (character: Character | null) => character?.image && character.visible ? (!reducedMotion() && character.image.motion) || character.image.still : null;
export const petHiddenKey = (userId: string) => `pinky-pet-hidden:${userId}`;

/** 一起养的小家伙 (founder 11-06, after Douyin's 合养精灵): the couple's character floats small at the side of the chat instead of
 * across the top, where it blocked the view. It can be dragged up or down and to either edge (remembered), sways when happy,
 * dozes when it misses them, wears a dot until you have petted it today, and steps aside while the keyboard is up.
 * A tap opens its room. */
export function FloatingPet({ userId, language, pet, character, onOpen }: { userId: string; language: Language; pet: PetView; character: Character | null; onOpen: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const keyboard = useKeyboard();
  const spotKey = `pinky-pet-spot:${userId}`;
  const [spot, setSpot] = useState<Spot>(() => {
    try { const saved = JSON.parse(localStorage.getItem(spotKey) || "null"); if ((saved?.side === "left" || saved?.side === "right") && typeof saved.y === "number") return saved; } catch { /* first time */ }
    return { side: "right", y: 0.9 };
  });
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [broken, setBroken] = useState(false);
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null), moved = useRef(false);
  const ref = useRef<HTMLButtonElement>(null);
  const area = () => ref.current?.offsetParent?.getBoundingClientRect() || null;
  const down = (event: ReactPointerEvent) => { press.current = { x: event.clientX, y: event.clientY, moved: false }; moved.current = false; ref.current?.setPointerCapture?.(event.pointerId); };
  const move = (event: ReactPointerEvent) => {
    const start = press.current, box = area();
    if (!start || !box) return;
    if (!start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 8) return;
    start.moved = moved.current = true;
    setDrag({ x: event.clientX - box.left, y: event.clientY - box.top });
  };
  const up = () => {
    const box = area();
    if (press.current?.moved && drag && box) {
      const next: Spot = { side: drag.x < box.width / 2 ? "left" : "right", y: Math.min(0.85, Math.max(0.1, drag.y / box.height)) };
      setSpot(next);
      try { localStorage.setItem(spotKey, JSON.stringify(next)); } catch { /* private mode */ }
    }
    press.current = null; setDrag(null);
  };
  const image = broken ? character?.image?.still || null : petImage(character);
  const style = drag ? { left: drag.x - 36, top: drag.y - 40, right: "auto" } : { top: `clamp(150px, ${spot.y * 100}%, calc(100% - 220px))` };
  return <button ref={ref} type="button" className={`floating-pet is-${spot.side} is-${pet.mood}${drag ? " is-dragging" : ""}${keyboard.visible ? " is-away" : ""}`} style={style}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClick={() => { if (!moved.current) onOpen(); moved.current = false; }}
    aria-label={t(`我们的小家伙 Lv.${pet.level}，打开它的小窝`, `Our little one, Lv.${pet.level}. Open its room`, `Nuestro pequeño, Nv.${pet.level}. Abrir su cuarto`)} data-testid="floating-pet">
    <span className="floating-pet-figure" data-testid={image ? "couple-mascot" : undefined}>{image ? <img src={image} alt="" draggable={false} onError={() => setBroken(true)} /> : <PawPrint size={30} weight="fill" />}</span>
    {pet.mood === "sleepy" && <b className="floating-pet-z" aria-hidden="true">z</b>}
    {!pet.pettedByMe && <i className="floating-pet-dot" aria-hidden="true" />}
    <small>Lv.{pet.level}</small>
  </button>;
}

/** Its room, a whole page like Douyin's 精灵空间: the two of you and your closeness on top, the little one on its rug in the
 * middle with a bubble to pet it, its level right under it, and how it grows below. Rules and options sit in the ··· menu. */
export function PetRoom({ language, pet, character, members, userId, hidden, onHiddenChange, onPetted, onMakeCharacter, onClose }: { language: Language; pet: PetView; character: Character | null; members: Array<{ id: string; name: string }>; userId: string; hidden: boolean; onHiddenChange: (hidden: boolean) => void; onPetted: (pet: PetView) => void; onMakeCharacter: () => void; onClose: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [menu, setMenu] = useState(false), [hop, setHop] = useState(0);
  const howRef = useRef<HTMLElement>(null);
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); }, [onClose]);
  const pat = async () => {
    setHop((count) => count + 1);
    if (busy || pet.pettedByMe) return;
    setBusy(true); setError("");
    try { onPetted((await relationshipApi<{ pet: PetView }>("/api/together/pet", jsonBody({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", language }))).pet); }
    catch (caught) { setError((caught as Error).message); } finally { setBusy(false); }
  };
  const me = members.find((member) => member.id === userId), partner = members.find((member) => member.id !== userId);
  const partnerName = partner?.name || t("TA", "your partner", "tu pareja");
  const initial = (name?: string) => (name || "?").slice(0, 1).toUpperCase();
  const mood = pet.mood === "happy" ? t("它今天很开心", "It's happy today", "Hoy está feliz") : pet.mood === "calm" ? t("它在等你们", "It's waiting for you", "Los está esperando") : t("它有点想你们了 💤", "It misses you a little 💤", "Los extraña un poco 💤");
  const span = Math.max(1, pet.next - pet.floor), progress = Math.min(100, Math.round(((pet.points - pet.floor) / span) * 100));
  const label: Record<string, string> = { daily: t("一起答了今日一问", "Both answered the daily question", "Respondieron la pregunta del día"), game: t("一起玩了一局", "Played a round", "Jugaron una ronda"), nudge: t("想你了", "Thinking of you", "Pienso en ti"), letter: t("拆开了一封信", "Opened a letter", "Abrieron una carta"), moment: t("存了一个回忆", "Kept a memory", "Guardaron un recuerdo"), agreement: t("说好了一件事", "Made an agreement", "Hicieron un acuerdo"), pet: t("摸摸它", "Petted it", "Lo acariciaron"), both: t("今天两个人都摸了它", "Both petted it today", "Ambos lo acariciaron hoy") };
  const image = petImage(character);
  const item = (text: string, action: () => void) => <button type="button" role="menuitem" onClick={() => { setMenu(false); action(); }}>{text}</button>;
  return <div className={`pet-room is-${pet.mood}`} role="dialog" aria-modal="true" aria-label={t("我们的小家伙", "Our little one", "Nuestro pequeño")} data-testid="pet-room">
    <header className="pet-room-top">
      <div className="pet-room-pair"><i>{initial(me?.name)}</i><i>{initial(partner?.name)}</i><span><b>{pet.points}</b><small>{t("亲密值", "Closeness", "Cercanía")}</small></span></div>
      <button type="button" className="pet-room-icon" onClick={() => setMenu((open) => !open)} aria-label={t("更多", "More", "Más")} aria-expanded={menu} data-testid="pet-room-menu"><DotsThree size={24} weight="bold" /></button>
      <button type="button" className="pet-room-icon" onClick={onClose} aria-label={t("关闭", "Close", "Cerrar")} data-testid="pet-room-close" autoFocus><X size={22} /></button>
      {menu && <div className="pet-room-menu" role="menu">
        {item(t("怎么让它长大", "How it grows", "Cómo crece"), () => howRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }))}
        {item(hidden ? t("在聊天里显示它", "Show it in the chat", "Mostrarlo en el chat") : t("在聊天里收起它", "Hide it from the chat", "Ocultarlo del chat"), () => onHiddenChange(!hidden))}
        {item(image ? t("给它换个样子", "Give it a new look", "Darle otro aspecto") : t("给它做一个样子", "Give it a look", "Dale un aspecto"), onMakeCharacter)}
      </div>}
    </header>
    <div className="pet-room-stream"><MobileScroll className="pet-room-scroll"><div className="pet-room-body">
      <section className="pet-stage">
        <button type="button" className={`pet-bubble${pet.pettedByMe ? " is-done" : ""}`} disabled={busy} onClick={() => void pat()} data-testid="pet-pat"><span className="pet-bubble-ball"><HandHeart size={26} weight="fill" /><b>{pet.pettedByMe ? "✓" : `+${pet.pettedByPartner ? 4 : 1}`}</b></span><small>{pet.pettedByMe ? t("今天摸过了", "Petted today", "Ya lo acariciaste") : t("摸摸它", "Pet it", "Acarícialo")}</small></button>
        <button type="button" key={hop} className={`pet-figure${hop ? " is-hop" : ""}`} onClick={() => void pat()} aria-label={t("摸摸它", "Pet it", "Acarícialo")}>{image ? <img src={image} alt="" draggable={false} /> : <PawPrint size={88} weight="fill" />}</button>
        <span className="pet-rug" aria-hidden="true" />
      </section>
      <strong className="pet-name">{t("我们的小家伙", "Our little one", "Nuestro pequeño")}</strong>
      <div className="pet-level-bar" role="progressbar" aria-valuemin={pet.floor} aria-valuemax={pet.next} aria-valuenow={pet.points}><span className="pet-level-badge">Lv.{pet.level}</span><span className="pet-level-fill" style={{ width: `${progress}%` }} /><small>{pet.points} / {pet.next}</small></div>
      <p className="pet-mood">{mood}</p>
      <small className="pet-partner">{pet.pettedByPartner ? t(`${partnerName} 今天也摸过它了`, `${partnerName} petted it today too`, `${partnerName} también lo acarició hoy`) : t(`${partnerName} 今天还没来，两个人都摸会多 +3`, `${partnerName} hasn't come by today; both of you earns +3`, `${partnerName} aún no pasó hoy; si ambos lo acarician, +3`)}</small>
      {!image && <button type="button" className="pet-make" onClick={onMakeCharacter}>{t("给它做一个样子", "Give it a look", "Dale un aspecto")}</button>}
      {error && <p className="space-error" role="alert">{error}</p>}
      <section className="pet-how" ref={howRef}><h3><Sparkle size={15} weight="fill" />{t("怎么让它长大", "How it grows", "Cómo crece")}</h3>
        <ul>{(["daily", "game", "letter", "agreement", "moment", "nudge"] as const).map((type) => <li key={type}><span>{label[type]}</span><b>+{{ daily: 10, game: 5, letter: 20, agreement: 10, moment: 3, nudge: 2 }[type]}</b></li>)}</ul></section>
      {!!pet.gains.length && <section className="pet-how"><h3>{t("最近", "Recently", "Recientemente")}</h3><ul>{pet.gains.map((gain, index) => <li key={index}><span>{label[gain.type] || gain.type}</span><b>+{gain.points}</b></li>)}</ul></section>}
    </div></MobileScroll></div>
  </div>;
}
