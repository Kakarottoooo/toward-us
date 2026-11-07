import type { ReactNode } from "react";
import { localized, type Language } from "../../i18n";

// 小家伙的装扮 (founder 11-06, "按对会员+装扮"): drawn over the couple's little one, positioned against the picture's own box.
export const OUTFIT_IDS = ["bow", "crown", "scarf", "glasses", "flower", "santa"] as const;
export type OutfitId = typeof OUTFIT_IDS[number];

export const outfitName = (id: OutfitId, language: Language) => {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  return { bow: t("蝴蝶结", "Bow", "Lazo"), crown: t("小皇冠", "Little crown", "Coronita"), scarf: t("红围巾", "Red scarf", "Bufanda roja"), glasses: t("圆眼镜", "Round glasses", "Gafas redondas"), flower: t("小花", "Flower", "Flor"), santa: t("圣诞帽", "Santa hat", "Gorro navideño") }[id];
};

const ART: Record<OutfitId, ReactNode> = {
  bow: <svg viewBox="0 0 64 40"><path d="M32 20 L6 4 Q0 20 6 36 Z" fill="#f06f8f" /><path d="M32 20 L58 4 Q64 20 58 36 Z" fill="#f06f8f" /><path d="M32 20 L14 10 L14 30 Z M32 20 L50 10 L50 30 Z" fill="#d94d72" opacity=".55" /><circle cx="32" cy="20" r="7" fill="#c93d63" /></svg>,
  crown: <svg viewBox="0 0 64 44"><path d="M6 40 L4 10 L18 22 L32 4 L46 22 L60 10 L58 40 Z" fill="#f5c542" stroke="#c9952a" strokeWidth="2.5" strokeLinejoin="round" /><circle cx="32" cy="27" r="5" fill="#e0475f" /><circle cx="17" cy="31" r="3.5" fill="#4aa3df" /><circle cx="47" cy="31" r="3.5" fill="#4aa3df" /></svg>,
  scarf: <svg viewBox="0 0 80 48"><path d="M4 10 Q40 26 76 10 L76 22 Q40 38 4 22 Z" fill="#d9363e" /><path d="M50 26 L58 46 L68 44 L62 22 Z" fill="#c22a32" /><path d="M10 16 Q40 30 70 16" stroke="#fff" strokeWidth="2" strokeDasharray="4 5" fill="none" opacity=".7" /></svg>,
  glasses: <svg viewBox="0 0 80 32"><circle cx="20" cy="16" r="12" fill="rgba(255,255,255,.25)" stroke="#2b2b2b" strokeWidth="4" /><circle cx="60" cy="16" r="12" fill="rgba(255,255,255,.25)" stroke="#2b2b2b" strokeWidth="4" /><path d="M32 14 Q40 8 48 14" stroke="#2b2b2b" strokeWidth="4" fill="none" /></svg>,
  flower: <svg viewBox="0 0 48 48">{[0, 72, 144, 216, 288].map((angle) => <ellipse key={angle} cx="24" cy="12" rx="8" ry="11" fill="#ff9ebb" transform={`rotate(${angle} 24 24)`} />)}<circle cx="24" cy="24" r="7" fill="#ffd34d" /></svg>,
  santa: <svg viewBox="0 0 72 56"><path d="M8 44 Q20 6 46 8 Q62 10 66 30 L58 32 Q52 20 44 22 Q40 34 56 44 Z" fill="#d9363e" /><rect x="4" y="40" width="58" height="12" rx="6" fill="#fff" /><circle cx="64" cy="32" r="7" fill="#fff" /></svg>,
};

/** The outfit layer; the parent `.pet-dress` is sized by the picture so these percentages follow its head and face. */
export function OutfitLayer({ id }: { id: OutfitId | null | undefined }) {
  if (!id || !OUTFIT_IDS.includes(id)) return null;
  return <span className={`pet-outfit is-${id}`} aria-hidden="true" data-testid={`outfit-${id}`}>{ART[id]}</span>;
}
export const OutfitArt = ({ id }: { id: OutfitId }) => <span className="outfit-art" aria-hidden="true">{ART[id]}</span>;
