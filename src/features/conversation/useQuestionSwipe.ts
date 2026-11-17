import { useRef, type MouseEvent, type PointerEvent } from "react";

type Point = { id: number; x: number; y: number };

export function useQuestionSwipe(deal: (direction: -1 | 1) => void) {
  const start = useRef<Point | null>(null);
  const blockClickUntil = useRef(0);

  return {
    onPointerDownCapture(event: PointerEvent<HTMLDivElement>) {
      if (!event.isPrimary || event.button !== 0) return;
      blockClickUntil.current = 0;
      start.current = (event.target as Element).closest("button, input, textarea, select, a, [contenteditable], [data-scroll-drag='ignore']")
        ? null : { id: event.pointerId, x: event.clientX, y: event.clientY };
    },
    onPointerUpCapture(event: PointerEvent<HTMLDivElement>) {
      const point = start.current;
      if (!point || point.id !== event.pointerId) return;
      start.current = null;
      const dx = event.clientX - point.x, dy = event.clientY - point.y;
      if (Math.abs(dx) < 54 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      blockClickUntil.current = performance.now() + 350;
      deal(dx < 0 ? 1 : -1);
    },
    onPointerCancelCapture() { start.current = null; },
    onClickCapture(event: MouseEvent<HTMLDivElement>) {
      if (event.detail && performance.now() < blockClickUntil.current) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}
