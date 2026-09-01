import { useRef, useState } from "react";

const clamp = (value: number) => Math.min(0.72, Math.max(0.18, value));

export function usePanelSplit(initial = 0.38) {
  const [share, setShare] = useState(initial);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const beginDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const container = containerRef.current;
    if (!container) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = container.getBoundingClientRect();
    const move = (pointer: PointerEvent) => setShare(clamp((pointer.clientY - bounds.top) / bounds.height));
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowUp") { event.preventDefault(); setShare((value) => clamp(value - 0.05)); }
    if (event.key === "ArrowDown") { event.preventDefault(); setShare((value) => clamp(value + 0.05)); }
    if (event.key === "Home") { event.preventDefault(); setShare(0.18); }
    if (event.key === "End") { event.preventDefault(); setShare(0.72); }
  };

  return {
    containerRef,
    style: { "--conversation-share": `${share * 100}%` } as React.CSSProperties,
    handleProps: { onPointerDown: beginDrag, onKeyDown, "aria-valuenow": Math.round(share * 100) },
  };
}
