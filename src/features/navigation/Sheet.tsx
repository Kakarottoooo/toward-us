import { useEffect, useRef, type ComponentProps } from "react";
import { BottomSheet as DeviceSheet } from "../../mobile";

// The phone's or browser's Back closes the topmost open sheet first, instead of leaving the page under it (QA round 3).
// Each open sheet gets its own history entry. Back pops it: the sheet closes and nothing else hears that popstate (the
// pages and screens below stay where they are). A sheet closed any other way (its button, a swipe, Escape) takes its entry
// back off quietly.
const open: Array<{ id: string; close: () => void }> = [];
// Ids are unique across page loads: after a reload the old sheet entries are still in history, and a counter starting
// again at 1 made a new sheet's entry look like one of them, so Back stopped closing it (QA round 4).
const load = Math.random().toString(36).slice(2, 10);
let seq = 0, quiet = 0, carry = "", here = 0;
const depthOf = (state: unknown) => Number((state as { depth?: number } | null)?.depth) || 0;
const sheetOf = (state: unknown) => (state as { sheet?: unknown } | null)?.sheet;
if (typeof window !== "undefined") {
  // The depth of the current entry, so a popstate can tell Back from Forward.
  here = depthOf(history.state);
  // Reloaded while a sheet was open: its entry is current but the sheet is gone. Step quietly down to the page's own entry
  // (a reload keeps the same document, so this is a popstate, not another load), so the next Back leaves the page.
  if (sheetOf(history.state) !== undefined) { carry = location.href; quiet += 1; history.back(); }
  for (const name of ["pushState", "replaceState"] as const) {
    const original = history[name].bind(history);
    history[name] = (...args: Parameters<History["pushState"]>) => { original(...args); here = depthOf(history.state); };
  }
  window.addEventListener("popstate", (event) => {
    const from = here; here = depthOf(event.state);
    // Our own step back over a sheet closed in the app: the address the page set meanwhile (say, the channel) stays.
    if (quiet > 0) { quiet -= 1; event.stopImmediatePropagation(); if (carry && carry !== location.href) history.replaceState(history.state, "", carry); carry = ""; return; }
    const landed = sheetOf(event.state);
    const top = open.at(-1);
    if (top && landed !== top.id) { open.pop(); event.stopImmediatePropagation(); top.close(); }
    // Landed on the entry of a sheet that is no longer open (closed by Back, closed under a page, or left from before a
    // reload): pass over it in the direction of travel. Forward with nothing beyond it goes quietly back where it was.
    if (landed !== undefined && !open.some((entry) => entry.id === landed)) {
      event.stopImmediatePropagation();
      if (here <= from) history.back();
      else if ((window as { navigation?: { canGoForward?: boolean } }).navigation?.canGoForward) history.forward();
      else { quiet += 1; history.back(); }
    }
  }, true);
}

/** Gives an overlay that is not a BottomSheet (a full-screen room, a card) the same Back behaviour. */
export function useSheetHistory(shown: boolean, close: () => void) {
  const latest = useRef(close); latest.current = close;
  useEffect(() => {
    if (!shown) return;
    const entry = { id: `${load}-${++seq}`, close: () => latest.current() };
    history.pushState({ ...(history.state || {}), sheet: entry.id, depth: (Number(history.state?.depth) || 0) + 1 }, "", location.href);
    open.push(entry);
    return () => {
      const index = open.indexOf(entry);
      if (index < 0) return;
      open.splice(index, 1);
      // After this render's other effects, which may change the address or open a page of their own (then the entry stays
      // under that page and Back passes over it).
      queueMicrotask(() => { if (sheetOf(history.state) === entry.id) { carry = location.href; quiet += 1; history.back(); } });
    };
  }, [shown]);
}

/** The device BottomSheet, with Back closing it. Same props. */
export function BottomSheet(props: ComponentProps<typeof DeviceSheet>) {
  useSheetHistory(props.open, () => props.onOpenChange(false));
  return <DeviceSheet {...props} />;
}
