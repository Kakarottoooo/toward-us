import { useEffect, useRef, type ComponentProps, type RefObject } from "react";
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

/** Keyboard users get back to where they were (QA round 5): once the closed overlay has let go of focus (it lands on the
 * body), the control that opened it takes focus again. */
function returnFocus(opener: Element | null) {
  if (!(opener instanceof HTMLElement)) return;
  let tries = 0;
  const tick = () => {
    if (!opener.isConnected) return;
    const at = document.activeElement;
    if (!at || at === document.body) { opener.focus({ preventScroll: true }); return; }
    if (at.closest("[role=dialog]") && ++tries < 30) window.setTimeout(tick, 50);
  };
  window.setTimeout(tick, 0);
}

// While a sheet, the menu drawer or a full-screen layer is open, body.layer-open hides the floating feedback button. A class
// set here replaced body:has(...), which made every DOM insertion restyle the page (QA round 5).
let layers = 0;
export function useLayerOpen(open: boolean) {
  useEffect(() => {
    if (!open) return;
    layers += 1; document.body.classList.add("layer-open");
    return () => { layers = Math.max(0, layers - 1); if (!layers) document.body.classList.remove("layer-open"); };
  }, [open]);
}

/** The device BottomSheet, with Back closing it and focus returned to its opener. Same props. */
export function BottomSheet(props: ComponentProps<typeof DeviceSheet>) {
  useSheetHistory(props.open, () => props.onOpenChange(false));
  useLayerOpen(props.open);
  useEffect(() => {
    if (!props.open) return;
    const opener = document.activeElement;
    return () => returnFocus(opener);
  }, [props.open]);
  return <DeviceSheet {...props} />;
}

const FOCUSABLE = "button:not([disabled]):not([tabindex='-1']), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";
/** A modal layer that isn't a BottomSheet (the menu drawer): focus moves into it, Tab stays inside, Escape closes it, the
 * rest of the screen is inert while it is open, and focus returns to the opener afterwards (QA round 5). */
export function useModalFocus(layer: RefObject<HTMLElement | null>, close: () => void) {
  const latest = useRef(close); latest.current = close;
  useEffect(() => {
    const root = layer.current;
    if (!root) return;
    const opener = document.activeElement;
    const others = [...(root.parentElement?.children || [])].filter((element) => element !== root && !element.hasAttribute("inert"));
    others.forEach((element) => element.setAttribute("inert", ""));
    const focusable = () => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.getClientRects().length > 0);
    (root.querySelector<HTMLElement>("[data-autofocus]") || focusable()[0])?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); latest.current(); return; }
      if (event.key !== "Tab") return;
      const list = focusable(); if (!list.length) return;
      const first = list[0], last = list[list.length - 1];
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    root.addEventListener("keydown", key);
    return () => { root.removeEventListener("keydown", key); others.forEach((element) => element.removeAttribute("inert")); returnFocus(opener); };
  }, [layer]);
}
