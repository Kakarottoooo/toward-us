import { useState } from "react";
import { HandHeart, PawPrint, Sparkle } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { BottomSheet } from "../../mobile";
import { jsonBody, relationshipApi } from "../relationship/api";
import type { Character } from "./character";

export type PetView = { points: number; level: number; floor: number; next: number; mood: "happy" | "calm" | "sleepy"; pettedByMe: boolean; pettedByPartner: boolean; gains: Array<{ type: string; points: number; day: string }> };

/** 一起养的小家伙 (founder 11-06): a small pill under the top of Us (Lv and a nudge to pet it) that opens its sheet: how it is
 * doing, 摸摸它 once a day each, and what makes it grow. Growth comes from what the two of them already do together. */
export function PetPill({ language, pet, character, partnerName, onPetted, onMakeCharacter }: { language: Language; pet: PetView; character: Character | null; partnerName: string; onPetted: (pet: PetView) => void; onMakeCharacter: () => void }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pat = async () => {
    setBusy(true); setError("");
    try { onPetted((await relationshipApi<{ pet: PetView }>("/api/together/pet", jsonBody({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", language }))).pet); }
    catch (caught) { setError((caught as Error).message); } finally { setBusy(false); }
  };
  const mood = pet.mood === "happy" ? t("它今天很开心", "It's happy today", "Hoy está feliz") : pet.mood === "calm" ? t("它在等你们", "It's waiting for you", "Los está esperando") : t("它有点想你们了 💤", "It misses you a little 💤", "Los extraña un poco 💤");
  const span = Math.max(1, pet.next - pet.floor), progress = Math.min(100, Math.round(((pet.points - pet.floor) / span) * 100));
  const label: Record<string, string> = { daily: t("一起答了今日一问", "Both answered the daily question", "Respondieron la pregunta del día"), game: t("一起玩了一局", "Played a round", "Jugaron una ronda"), nudge: t("想你了", "Thinking of you", "Pienso en ti"), letter: t("拆开了一封信", "Opened a letter", "Abrieron una carta"), moment: t("存了一个回忆", "Kept a memory", "Guardaron un recuerdo"), agreement: t("说好了一件事", "Made an agreement", "Hicieron un acuerdo"), pet: t("摸摸它", "Petted it", "Lo acariciaron"), both: t("今天两个人都摸了它", "Both petted it today", "Ambos lo acariciaron hoy") };
  const image = character?.image?.still;
  return <>
    <button type="button" className={`pet-pill is-${pet.mood}`} onClick={() => setOpen(true)} data-testid="pet-pill"><PawPrint size={14} weight="fill" />{t("小家伙", "Little one", "Pequeño")} Lv.{pet.level}{!pet.pettedByMe && <em>{t("摸摸它", "Pet it", "Acarícialo")}</em>}</button>
    <BottomSheet open={open} onOpenChange={setOpen} title={t("我们的小家伙", "Our little one", "Nuestro pequeño")} snap={0.75}>
      <div className="pet-sheet" data-testid="pet-sheet">
        <div className={`pet-portrait is-${pet.mood}`}>{image ? <img src={image} alt="" draggable={false} /> : <PawPrint size={56} weight="fill" />}</div>
        <strong className="pet-level">Lv.{pet.level}<small>{t(`亲密值 ${pet.points} / ${pet.next}`, `Closeness ${pet.points} / ${pet.next}`, `Cercanía ${pet.points} / ${pet.next}`)}</small></strong>
        <div className="pet-progress" role="progressbar" aria-valuemin={pet.floor} aria-valuemax={pet.next} aria-valuenow={pet.points}><span style={{ width: `${progress}%` }} /></div>
        <p className="pet-mood">{mood}</p>
        <button type="button" className="pet-pat" disabled={busy || pet.pettedByMe} onClick={() => void pat()} data-testid="pet-pat"><HandHeart size={20} weight="fill" />{pet.pettedByMe ? t("今天摸过了", "Petted today", "Ya lo acariciaste hoy") : t("摸摸它", "Pet it", "Acarícialo")}</button>
        <small className="pet-partner">{pet.pettedByPartner ? t(`${partnerName} 今天也摸过它了`, `${partnerName} petted it today too`, `${partnerName} también lo acarició hoy`) : t(`${partnerName} 今天还没来，两个人都摸会多 +3`, `${partnerName} hasn't come by today; both of you earns +3`, `${partnerName} aún no pasó hoy; si ambos lo acarician, +3`)}</small>
        {!image && <button type="button" className="pet-make" onClick={() => { setOpen(false); onMakeCharacter(); }}>{t("给它做一个样子", "Give it a look", "Dale un aspecto")}</button>}
        <section className="pet-how"><h3><Sparkle size={15} weight="fill" />{t("怎么让它长大", "How it grows", "Cómo crece")}</h3>
          <ul>{(["daily", "game", "letter", "agreement", "moment", "nudge"] as const).map((type) => <li key={type}><span>{label[type]}</span><b>+{{ daily: 10, game: 5, letter: 20, agreement: 10, moment: 3, nudge: 2 }[type]}</b></li>)}</ul></section>
        {!!pet.gains.length && <section className="pet-how"><h3>{t("最近", "Recently", "Recientemente")}</h3><ul>{pet.gains.map((gain, index) => <li key={index}><span>{label[gain.type] || gain.type}</span><b>+{gain.points}</b></li>)}</ul></section>}
        {error && <p className="space-error" role="alert">{error}</p>}
      </div>
    </BottomSheet>
  </>;
}
