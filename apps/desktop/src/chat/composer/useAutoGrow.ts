import { useLayoutEffect, type RefObject } from 'react';

/** Sizes a textarea to its content, up to `max`, past which it scrolls. Reset
 *  to `auto` before measuring so it also shrinks when the text gets shorter. */
export function useAutoGrow(
  ref: RefObject<HTMLTextAreaElement>,
  value: string,
  max: number,
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(max, el.scrollHeight)}px`;
  }, [ref, value, max]);
}
