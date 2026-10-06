import { useCallback, useState } from 'react';

export interface ChatDock {
  /** The floating composer is tucked into its moxxy button. */
  readonly minimized: boolean;
  readonly hide: () => void;
  readonly show: () => void;
}

/**
 * Whether the composer floating over a full-view pane is tucked away. Only full
 * view floats it, so outside it nothing is ever minimized, and full view opens
 * with the chat shown. A question the agent is blocked on overrides the choice
 * while it is open: a turn must never wait on something you cannot see.
 */
export function useChatDock(docked: boolean, needsYou: boolean): ChatDock {
  const [tucked, setTucked] = useState(false);
  const [wasDocked, setWasDocked] = useState(docked);
  if (wasDocked !== docked) {
    setWasDocked(docked);
    if (!docked) setTucked(false);
  }
  const hide = useCallback(() => setTucked(true), []);
  const show = useCallback(() => setTucked(false), []);
  return { minimized: docked && tucked && !needsYou, hide, show };
}
