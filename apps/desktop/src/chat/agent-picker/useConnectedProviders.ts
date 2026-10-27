import { useEffect, useMemo, useState } from 'react';
import { api, isProviderConnected } from '@moxxy/client-core';
import type { ProviderInfo } from './types';

export interface ProviderGroups {
  /** SDK agents: the agent app installed on this computer does the work. */
  readonly agents: ReadonlyArray<ProviderInfo>;
  /** API models: Moxxy does the work and calls the model through its API. */
  readonly models: ReadonlyArray<ProviderInfo>;
}

/**
 * The providers the picker offers: the ones Settings → Providers shows as
 * connected, read from the same `settings.providers` answer, so a provider with
 * no key, a signed-out agent or a local server that does not answer is not
 * offered here either. The running provider always stays. Until Settings
 * answers only the running provider shows; when it cannot answer, all do.
 */
export function useConnectedProviders(
  workspaceId: string | null | undefined,
  providers: ReadonlyArray<ProviderInfo>,
  activeProvider: string | null,
): ProviderGroups {
  const [connected, setConnected] = useState<ReadonlySet<string> | 'loading' | 'unknown'>(
    workspaceId ? 'loading' : 'unknown',
  );

  useEffect(() => {
    if (!workspaceId) {
      setConnected('unknown');
      return;
    }
    let live = true;
    setConnected('loading');
    api()
      .invoke('settings.providers', { workspaceId })
      .then((entries) => {
        if (live) setConnected(new Set(entries.filter(isProviderConnected).map((e) => e.name)));
      })
      .catch(() => {
        if (live) setConnected('unknown');
      });
    return () => {
      live = false;
    };
  }, [workspaceId]);

  return useMemo(() => {
    const offered = providers.filter((p) => {
      if (p.name === activeProvider || connected === 'unknown') return true;
      return connected !== 'loading' && connected.has(p.name);
    });
    return {
      agents: offered.filter((p) => p.agentName !== undefined),
      models: offered.filter((p) => p.agentName === undefined),
    };
  }, [providers, activeProvider, connected]);
}
