/**
 * The installer screen's state: what the host reports, turned into the model
 * the screen draws, plus the two things that are this window's own — what the
 * person closed, and how long it waits for the agent runtime to start.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, useUpdateActivity } from '@moxxy/client-core';
import { useLingering } from './useLingering';
import { updateScreenModel, type RunnerState, type UpdateScreenModel } from './update-screen-model';

/** After setup, how long the screen holds for the agent runtime before the
 *  app's own start-up and connection screens take over. */
const START_WAIT_MS = 90_000;
const SETUP = 'setup';

export interface UpdateScreenState {
  readonly model: UpdateScreenModel | null;
  readonly leaving: boolean;
  readonly onExited: () => void;
  readonly onRetry: () => void;
  readonly onManual: () => void;
  readonly onClose: () => void;
}

export function useUpdateScreen(options: { readonly runner: RunnerState; readonly onboarded: boolean }): UpdateScreenState {
  const { plan, progress, setup, retry } = useUpdateActivity();
  // What was closed: a failed update (by its id) or what setup had to say.
  const [closed, setClosed] = useState<string | null>(null);
  const showing = plan ? plan.id : SETUP;

  // Once setup is done and the agent runtime has either started or failed to,
  // the window is the app's again — for good: a later reconnect is not setup.
  const settled = setup?.phase === 'done';
  const [handedOver, setHandedOver] = useState(false);
  if (settled && options.runner !== 'starting' && !handedOver) setHandedOver(true);
  const holding = settled && !handedOver;
  useEffect(() => {
    if (!holding) return undefined;
    const timer = setTimeout(() => setHandedOver(true), START_WAIT_MS);
    return () => clearTimeout(timer);
  }, [holding]);

  const model = updateScreenModel({
    plan,
    progress,
    setup,
    runner: handedOver && options.runner === 'starting' ? 'stopped' : options.runner,
    onboarded: options.onboarded,
    closed: closed === showing,
  });
  const { shown, leaving, onExited } = useLingering(model);
  const completes = plan?.completes === true;
  const onClose = useCallback(() => {
    // Nothing to go on with while the installed app is behind: back to the version before.
    if (completes) void api().invoke('app.revertUpdate').catch(() => undefined);
    else setClosed(showing);
  }, [completes, showing]);
  const releaseUrl = plan?.releaseUrl;
  const onManual = useCallback(() => {
    if (releaseUrl) void api().invoke('onboarding.openExternal', { url: releaseUrl });
  }, [releaseUrl]);

  return { model: shown, leaving, onExited, onRetry: retry, onManual, onClose };
}
