import { memo, startTransition, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const CHUNK = 20;
const MARGIN = "1600px 0px";

function scrollParent(element: HTMLElement | null) {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

// A chunk's bubbles re-render only when the conversation does (a new render function), not when another chunk scrolls into
// or out of range.
const Chunk = memo(function Chunk({ start, end, render }: { start: number; end: number; render: (start: number, end: number) => ReactNode }) {
  return <>{render(start, end)}</>;
});

/** "Earlier messages" pages in Us, windowed (QA round 5: every page kept all of its bubbles in the DOM, so after 2,000
 * messages each tap was a 1.5 s long task over 18k nodes). Pages are cut into chunks of 20 counted from the seam, so a
 * chunk keeps its messages when an earlier page lands above it. Only chunks within about two screens of the visible part
 * are rendered; the rest are empty blocks of their measured height, so the scroll position never moves. */
export function OlderWindow({ count, keyOf, render }: { count: number; keyOf: (index: number) => string; render: (start: number, end: number) => ReactNode }) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const heights = useRef(new Map<string, number>());
  const observer = useRef<IntersectionObserver | null>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const probe = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = scrollParent(probe.current);
    const io = new IntersectionObserver((entries) => {
      // Heights are read now, while the chunk is still laid out; the swap itself renders as a transition, in small slices
      // that keep scrolling smooth instead of one long task per chunk.
      for (const entry of entries) if (!entry.isIntersecting && entry.boundingClientRect.height) heights.current.set((entry.target as HTMLElement).dataset.chunk!, entry.boundingClientRect.height);
      startTransition(() => setHidden((current) => {
        let next: Set<string> | null = null;
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).dataset.chunk!;
          const far = !entry.isIntersecting;
          if (far !== current.has(key)) { next ??= new Set(current); if (far) next.add(key); else next.delete(key); }
        }
        return next || current;
      }));
    }, { root, rootMargin: MARGIN });
    observer.current = io;
    nodes.current.forEach((node) => io.observe(node));
    return () => { io.disconnect(); observer.current = null; };
  }, []);

  // One stable ref callback per chunk, so a re-render doesn't unobserve and observe every chunk again.
  const refs = useRef(new Map<string, (node: HTMLElement | null) => void>());
  const attach = useCallback((key: string) => {
    let callback = refs.current.get(key);
    if (!callback) {
      callback = (node: HTMLElement | null) => {
        const before = nodes.current.get(key);
        if (before && before !== node) observer.current?.unobserve(before);
        if (node) { nodes.current.set(key, node); observer.current?.observe(node); } else nodes.current.delete(key);
      };
      refs.current.set(key, callback);
    }
    return callback;
  }, []);

  const chunks: Array<[number, number]> = [];
  for (let end = count; end > 0; end -= CHUNK) chunks.unshift([Math.max(0, end - CHUNK), end]);
  return <>
    <div ref={probe} hidden />
    {chunks.map(([start, end]) => {
      const key = keyOf(end - 1);
      return hidden.has(key)
        ? <div key={key} ref={attach(key)} data-chunk={key} className="conversation-older-chunk" style={{ height: heights.current.get(key) || 0 }} aria-hidden="true" />
        : <div key={key} ref={attach(key)} data-chunk={key} className="conversation-older-chunk"><Chunk start={start} end={end} render={render} /></div>;
    })}
  </>;
}
