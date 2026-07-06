import { useSyncExternalStore } from 'react';

/**
 * Reactive `prefers-reduced-motion: reduce`. Lets inline-styled animations in
 * the shell (which the global stylesheet's reduced-motion rule can't reach for
 * `transition`s and JS-driven motion) short-circuit for users who ask for less
 * motion — a vestibular accessibility concern. Mirrors {@link useTheme}'s
 * matchMedia subscription shape.
 *
 * In a DOM without `matchMedia` (jsdom/headless) it reports `false` — full
 * motion — which keeps existing snapshot/behavior tests unchanged.
 */
function query(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = query();
      if (mq) mq.addEventListener?.('change', cb);
      return () => {
        if (mq) mq.removeEventListener?.('change', cb);
      };
    },
    () => !!query()?.matches,
    () => false,
  );
}
