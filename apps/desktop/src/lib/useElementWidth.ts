import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * The width of an element's border box, in whole pixels, kept current as it
 * changes; null until it has been measured, and wherever nothing can measure.
 */
export function useElementWidth<T extends HTMLElement>(): {
  readonly ref: RefObject<T>;
  readonly width: number | null;
} {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.borderBoxSize[0];
      if (box) setWidth(Math.ceil(box.inlineSize));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
