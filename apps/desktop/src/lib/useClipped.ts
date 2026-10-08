import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** What rounding alone can put between the text's size and its box's. */
const ROUNDING_PX = 1;

/**
 * Whether an element's own styles are cutting `text` short, at the end of a
 * line or after its last allowed line; kept current as the element changes
 * size. False wherever nothing is laid out.
 */
export function useClipped<T extends HTMLElement>(text: string): {
  readonly ref: RefObject<T>;
  readonly clipped: boolean;
} {
  const ref = useRef<T>(null);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = (): void =>
      setClipped(
        element.scrollWidth - element.clientWidth > ROUNDING_PX ||
          element.scrollHeight - element.clientHeight > ROUNDING_PX,
      );
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);

  return { ref, clipped };
}
