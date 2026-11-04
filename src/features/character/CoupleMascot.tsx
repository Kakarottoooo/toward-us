import { useEffect, useState, type ReactNode } from "react";
import type { Character } from "./character";
import "./character.css";

/**
 * The couple's character floating at the top of the conversation: the cut-out alone, in its own shape and sized by its
 * height, with no box, band or shadow behind it (the founder, 11-03). The moving loop once it exists, the still before
 * that and for anyone who asks for reduced motion. Hidden means nothing at all is drawn in its place.
 * `status` hangs under it while Pinky is working on a reply (the founder, 11-03).
 */
export function CoupleMascot({ character, status = null }: { character: Character | null; status?: ReactNode }) {
  const [reduced, setReduced] = useState(() => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [broken, setBroken] = useState("");
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-reduced-motion: reduce)"), change = () => setReduced(query.matches);
    query.addEventListener?.("change", change);
    return () => query.removeEventListener?.("change", change);
  }, []);
  if (!character?.image || !character.visible) return null;
  const src = character.image.motion && !reduced && broken !== character.image.motion ? character.image.motion : character.image.still;
  if (broken === src) return null;
  return <div className="couple-mascot" aria-hidden="true" data-testid="couple-mascot"><img src={src} alt="" draggable={false} onError={() => setBroken(src)} />{status}</div>;
}
