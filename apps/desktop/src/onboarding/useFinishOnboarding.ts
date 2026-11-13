import { useCallback } from 'react';
import type { UsePrefs } from '@moxxy/client-core';

/**
 * Ends a first run: remembers that setup is done and enters the app at once.
 * The write is started first but not waited on, so the press opens the chat
 * immediately; App keeps its own flag for this launch, and the stored one
 * gates the next.
 */
export function useFinishOnboarding(update: UsePrefs['update'], onComplete: () => void): () => void {
  return useCallback(() => {
    const persisted = update({ onboardingComplete: true });
    onComplete();
    void Promise.resolve(persisted).catch((error: unknown) => {
      console.error('[onboarding] could not persist completion', error);
    });
  }, [update, onComplete]);
}
