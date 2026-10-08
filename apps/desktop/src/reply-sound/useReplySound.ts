import { useEffect, useMemo, useRef } from 'react';
import type { Desk } from '@moxxy/desktop-ipc-contract';
import { finishedElsewhere } from './finished-elsewhere';
import { ringReplyChime } from './reply-chime';
import { useReplySoundPreference } from './useReplySoundPreference';
import { useRunningSessions } from './useRunningSessions';

/**
 * Rings when a chat that is not on screen finishes its answer, so work left
 * running in one chat calls the person back from another. The chat on screen
 * stays silent: its answer is being read.
 */
export function useReplySound({
  desks,
  onScreenId,
  ring = ringReplyChime,
}: {
  readonly desks: ReadonlyArray<Desk>;
  readonly onScreenId: string | null;
  /** The speaker; replaced in tests, which have none. */
  readonly ring?: () => void;
}): void {
  const enabled = useReplySoundPreference();
  const known = useMemo(() => new Set(desks.flatMap((desk) => desk.sessions.map((session) => session.id))), [desks]);
  const running = useRunningSessions(known);
  const before = useRef(running);
  // Read as they stand when a chat stops, without making the effect run for them.
  const now = useRef({ known, onScreenId, enabled, ring });
  now.current = { known, onScreenId, enabled, ring };

  // React hands over the store once it has settled, so an answer followed at
  // once by its queued message is still "answering" and does not ring.
  useEffect(() => {
    const finished = finishedElsewhere({
      before: before.current,
      after: running,
      known: now.current.known,
      onScreen: now.current.onScreenId,
    });
    before.current = running;
    if (finished.length > 0 && now.current.enabled) now.current.ring();
  }, [running]);
}
