/**
 * Window-event-backed {@link EventBus} — the desktop's out-of-band
 * session-info-refresh signal. `on` wraps `window.addEventListener`, `emit`
 * dispatches a bare `Event`, so a component that still calls
 * `window.dispatchEvent(new Event(name))` directly is heard identically.
 */

import type { EventBus } from '@moxxy/client-core';

// `undefined` off-DOM (worker / SSR / RN bundle) so the capability degrades to
// the consuming hook's unsupported branch instead of throwing a ReferenceError
// on `window` — the package's documented graceful-degradation contract (see kv.ts).
export const webEventBus: EventBus | undefined =
  typeof window !== 'undefined'
    ? {
        on(event: string, handler: () => void): () => void {
          window.addEventListener(event, handler);
          return () => window.removeEventListener(event, handler);
        },
        emit(event: string): void {
          window.dispatchEvent(new Event(event));
        },
      }
    : undefined;
