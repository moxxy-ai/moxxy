import type { ProviderAdminView } from '@moxxy/sdk';
import { RunnerMethod } from '../protocol.js';
import type { ViewContext } from './context.js';

export interface ProviderAdminClientView extends ProviderAdminView {
  /** Enable/disable a provider on the runner (persists to preferences). */
  setEnabled(name: string, enabled: boolean): Promise<void>;
  /** Re-probe every provider's credentials → fresh readyProviders. */
  refreshReady(): Promise<void>;
}

// Provider management (protocol v7): backs the desktop's interactive
// Settings → Providers tab. Gated on the SERVER's reported version so a v7
// client attached to an older runner (a desktop whose JS hot-update outran
// its bundled CLI) gets a clear "update the CLI" error instead of a raw
// method-not-found.
export function makeProviderAdminView(ctx: ViewContext): ProviderAdminClientView {
  const { peer, requireServerProtocol } = ctx;
  return {
    setEnabled: async (name, enabled) => {
      requireServerProtocol(7, 'Enabling/disabling a provider');
      await peer.request(RunnerMethod.ProviderSetEnabled, { name, enabled });
    },
    refreshReady: async () => {
      requireServerProtocol(7, 'Re-probing provider credentials');
      await peer.request(RunnerMethod.ProviderRefreshReady, {});
    },
    configure: async (name, patch) => {
      requireServerProtocol(7, 'Configuring a provider');
      await peer.request(RunnerMethod.ProviderConfigure, { name, patch });
    },
  };
}
