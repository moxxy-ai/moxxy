/**
 * Window-event-backed {@link EventBus} — the desktop's out-of-band
 * session-info-refresh signal. `on` wraps `window.addEventListener`, `emit`
 * dispatches a bare `Event`, so a component that still calls
 * `window.dispatchEvent(new Event(name))` directly is heard identically.
 */

import type { EventBus } from '@moxxy/client-core';

export const webEventBus: EventBus = {
  on(event: string, handler: () => void): () => void {
    window.addEventListener(event, handler);
    return () => window.removeEventListener(event, handler);
  },
  emit(event: string): void {
    window.dispatchEvent(new Event(event));
  },
};
