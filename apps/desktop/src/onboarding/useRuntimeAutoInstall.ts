import { useEffect, useRef } from 'react';
import type { UseOnboarding } from '@moxxy/client-core';

/**
 * Installs the runtime moxxy needs as soon as the check finds none — a person
 * setting the app up is never asked to. One attempt per onboarding: a failure
 * is shown with a retry instead of looping on a computer that is offline.
 */
export function useRuntimeAutoInstall(ob: Pick<UseOnboarding, 'node' | 'installNode'>): void {
  const tried = useRef(false);
  const missing = ob.node !== null && !ob.node.installed;
  const run = ob.installNode.run;
  useEffect(() => {
    if (!missing || tried.current) return;
    tried.current = true;
    void run();
  }, [missing, run]);
}
