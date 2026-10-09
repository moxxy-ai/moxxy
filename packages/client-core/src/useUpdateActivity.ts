/**
 * What the installer screen is drawn from: the update this window watches the
 * host carry out (`app.update.plan`, `app.update.progress`) and what the launch
 * after it sets up before the first runner (`app.setup`). It only reflects —
 * the host decides and does every step.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSetupState, AppUpdatePlan, AppUpdateProgress } from '@moxxy/desktop-ipc-contract';
import { api } from './transport.js';

export interface UpdateActivity {
  /** The update carried out while this window watched; null until one starts. */
  readonly plan: AppUpdatePlan | null;
  readonly progress: AppUpdateProgress | null;
  /** What this launch is setting up; null until the host has said. */
  readonly setup: AppSetupState | null;
  /** Asks the host for the update again, after one that failed. */
  readonly retry: () => void;
}

const NOTHING_TO_SET_UP: AppSetupState = { reason: null, phase: 'done', steps: [], notes: [] };

export function useUpdateActivity(): UpdateActivity {
  const [plan, setPlan] = useState<AppUpdatePlan | null>(null);
  const [progress, setProgress] = useState<AppUpdateProgress | null>(null);
  const [setup, setSetup] = useState<AppSetupState | null>(null);
  // A pushed state is newer than the answer to the question asked on mount.
  const pushed = useRef(false);

  useEffect(() => api().subscribe('app.update.plan', setPlan), []);
  useEffect(() => api().subscribe('app.update.progress', setProgress), []);
  useEffect(() => {
    const off = api().subscribe('app.setup.changed', (state: AppSetupState) => {
      pushed.current = true;
      setSetup(state);
    });
    void api()
      .invoke('app.setup')
      .catch(() => NOTHING_TO_SET_UP)
      .then((state) => {
        if (!pushed.current) setSetup(state);
      });
    return off;
  }, []);

  const retry = useCallback((): void => {
    setProgress(null);
    // The outcome arrives as the plan the host pushes; a refusal is one too.
    void api().invoke('app.updateAll').catch(() => undefined);
  }, []);

  return { plan, progress, setup, retry };
}
