/**
 * The first-run question's state: which screen of it shows, what each choice
 * means right now, and the chain one press starts. Pressing a choice does
 * whatever is next for it (install, update, sign in) and keeps going until it
 * can be used, so a person presses once and lands in the chat.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, toErrorMessage, useAgentClis, useSettings } from '@moxxy/client-core';
import {
  FREE_PROVIDER,
  PLAN_PROVIDERS,
  readyPlan,
  startOption,
  type StartOption,
  type StartProvider,
} from './start-options';

export type StartView = 'choose' | 'plan' | 'api-key';

export interface UseStartStep {
  readonly view: StartView;
  readonly showChoices: () => void;
  readonly showPlans: () => void;
  readonly showApiKey: () => void;
  readonly plans: ReadonlyArray<StartOption>;
  readonly free: StartOption;
  /** A plan already signed in here, offered as one press; null when none is. */
  readonly ready: StartOption | null;
  /** The choice working through its chain (installing, switching); null when idle. */
  readonly busy: StartProvider | null;
  /** The plan whose browser sign-in is open; null otherwise. */
  readonly signingIn: StartProvider | null;
  readonly error: string | null;
  readonly choose: (provider: StartProvider) => void;
  readonly onSignedIn: () => Promise<void>;
}

export function useStartStep(onDone: () => void): UseStartStep {
  const [view, setView] = useState<StartView>('choose');
  const [pending, setPending] = useState<StartProvider | null>(null);
  const [activating, setActivating] = useState<StartProvider | null>(null);
  const [signingIn, setSigningIn] = useState<StartProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The step of the chain already started for the pending choice, so a failed
  // install is shown instead of being run again and again.
  const started = useRef<string | null>(null);

  const { providers, loading } = useSettings();
  const { jobs, checking, run, check } = useAgentClis();

  const option = useCallback(
    (provider: StartProvider): StartOption =>
      startOption(
        provider,
        providers.find((entry) => entry.name === provider),
        { job: jobs[provider] ?? null, checking, listed: !loading },
      ),
    [providers, jobs, checking, loading],
  );
  const plans = useMemo(() => PLAN_PROVIDERS.map(option), [option]);
  const free = useMemo(() => option(FREE_PROVIDER), [option]);

  // Provisioning, not just switching: it installs the agent's plugin when this
  // home has none yet, makes it the default and restarts the runner on it, and
  // it works before any runner is up, which is the usual first-run state.
  const activate = useCallback(
    async (provider: StartProvider): Promise<void> => {
      setActivating(provider);
      try {
        await api().invoke('onboarding.provisionProvider', { provider });
        onDone();
      } catch (e) {
        setError(`Moxxy could not start ${option(provider).name}. ${toErrorMessage(e)}`);
      } finally {
        setActivating(null);
      }
    },
    [onDone, option],
  );

  const pendingState = pending ? option(pending).state : null;
  useEffect(() => {
    if (!pending || !pendingState) return;
    const once = (step: string, go: () => void): void => {
      if (started.current === `${pending}:${step}`) return;
      started.current = `${pending}:${step}`;
      go();
    };
    switch (pendingState) {
      case 'ready':
        setPending(null);
        void activate(pending);
        return;
      case 'sign-in':
        setPending(null);
        setSigningIn(pending);
        return;
      case 'install':
      case 'failed':
        once('install', () => {
          void run(pending, 'install').then((result) => {
            if (!result.ok) setPending(null);
          });
        });
        return;
      case 'update':
        once('update', () => {
          void run(pending, 'update').then((result) => {
            if (!result.ok) setPending(null);
          });
        });
        return;
      case 'unavailable':
        once('check', () => {
          void check().finally(() => setPending(null));
        });
        return;
      case 'checking':
      case 'installing':
        return;
    }
  }, [pending, pendingState, activate, run, check]);

  const choose = useCallback((provider: StartProvider): void => {
    started.current = null;
    setError(null);
    setSigningIn(null);
    setPending(provider);
  }, []);

  const onSignedIn = useCallback(async (): Promise<void> => {
    if (!signingIn) return;
    const provider = signingIn;
    setSigningIn(null);
    await activate(provider);
  }, [signingIn, activate]);

  const show = (next: StartView) => (): void => {
    setError(null);
    setSigningIn(null);
    setPending(null);
    setView(next);
  };

  return {
    view,
    showChoices: show('choose'),
    showPlans: show('plan'),
    showApiKey: show('api-key'),
    plans,
    free,
    ready: readyPlan(plans),
    busy: activating ?? pending,
    signingIn,
    error,
    choose,
    onSignedIn,
  };
}
