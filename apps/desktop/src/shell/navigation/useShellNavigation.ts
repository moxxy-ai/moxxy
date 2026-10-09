import { useCallback, useEffect, useMemo, useState } from 'react';
import { requestVoiceCall } from '@/lib/voiceCallRequest';
import type { View } from '../views';
import { RUNNER_LOCKED_REASON, isRunnerLocked, viewOf, type DestinationId } from './destinations';
import type { PlaceTarget, SectionTarget } from './places';
import type { ShellNav } from './ShellNav';

/**
 * Where the user is, and the one rule about where they may go: a view that
 * reads the runner session is out of reach while that session loads.
 */
export function useShellNavigation({
  sessionLoading,
  onShowShortcuts,
  onOpenPalette,
  onSection,
}: {
  readonly sessionLoading: boolean;
  readonly onShowShortcuts: () => void;
  readonly onOpenPalette: () => void;
  /** Shows a section in the view that owns it; the views keep that state. */
  readonly onSection: (target: SectionTarget) => void;
}): ShellNav {
  const [view, setView] = useState<View>('chat');

  const isDisabled = useCallback(
    (id: DestinationId): boolean => sessionLoading && isRunnerLocked(id),
    [sessionLoading],
  );

  const go = useCallback(
    (id: DestinationId): void => {
      setView(isDisabled(id) ? 'chat' : viewOf(id));
      if (id === 'voice') requestVoiceCall();
    },
    [isDisabled],
  );

  const open = useCallback(
    (target: PlaceTarget): void => {
      if ('section' in target) onSection(target);
      go(target.destination);
    },
    [go, onSection],
  );

  // The session can start loading under a view that needs it.
  useEffect(() => {
    if (isDisabled(view)) setView('chat');
  }, [isDisabled, view]);

  return useMemo(
    () => ({
      view,
      go,
      open,
      isDisabled,
      disabledReason: RUNNER_LOCKED_REASON,
      showShortcuts: onShowShortcuts,
      openPalette: onOpenPalette,
    }),
    [view, go, open, isDisabled, onShowShortcuts, onOpenPalette],
  );
}
