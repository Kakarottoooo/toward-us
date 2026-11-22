import { useEffect, useRef, type ComponentProps } from "react";
import { BottomSheet as DeviceSheet } from "../../mobile";

// The phone's or browser's Back closes the topmost open sheet first, instead of leaving the page under it (QA round 3).
// Each open sheet gets its own history entry. Back pops it: the sheet closes and nothing else hears that popstate (the
// pages and screens below stay where they are). A sheet closed any other way (its button, a swipe, Escape) takes its entry
// back off quietly.
const open: Array<{ id: number; close: () => void }> = [];
let seq = 0, quiet = 0, carry = "";
// Entries of sheets that closed while a page opened above them: Back passes over them instead of stopping on a copy of the
// page below.
const stale = new Set<number>();
if (typeof window !== "undefined") window.addEventListener("popstate", (event) => {
  // Our own step back over a sheet closed in the app: the address the page set meanwhile (say, the channel) stays.
  if (quiet > 0) { quiet -= 1; event.stopImmediatePropagation(); if (carry && carry !== location.href) history.replaceState(history.state, "", carry); carry = ""; return; }
  const landed = (event.state as { sheet?: number } | null)?.sheet;
  const top = open.at(-1);
  if (top && landed !== top.id) { open.pop(); event.stopImmediatePropagation(); top.close(); }
  // Landed on a stale entry with nothing open: step once more; the entry below is handled as any Back.
  if (landed && stale.has(landed) && !open.length) { event.stopImmediatePropagation(); history.back(); }
}, true);

/** Gives an overlay that is not a BottomSheet (a full-screen room, a card) the same Back behaviour. */
export function useSheetHistory(shown: boolean, close: () => void) {
  const latest = useRef(close); latest.current = close;
  useEffect(() => {
    if (!shown) return;
    const entry = { id: ++seq, close: () => latest.current() };
    history.pushState({ ...(history.state || {}), sheet: entry.id, depth: (Number(history.state?.depth) || 0) + 1 }, "", location.href);
    open.push(entry);
    return () => {
      const index = open.indexOf(entry);
      if (index < 0) return;
      open.splice(index, 1);
      // After this render's other effects, which may change the address or open a page of their own (then the entry stays).
      queueMicrotask(() => { if ((history.state as { sheet?: number } | null)?.sheet === entry.id) { carry = location.href; quiet += 1; history.back(); } else stale.add(entry.id); });
    };
  }, [shown]);
}

/** The device BottomSheet, with Back closing it. Same props. */
export function BottomSheet(props: ComponentProps<typeof DeviceSheet>) {
  useSheetHistory(props.open, () => props.onOpenChange(false));
  return <DeviceSheet {...props} />;
}
