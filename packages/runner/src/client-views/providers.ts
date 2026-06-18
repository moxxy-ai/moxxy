import type { ProvidersClientView } from '@moxxy/sdk';
import { RunnerMethod } from '../protocol.js';
import type { ViewContext } from './context.js';
import { fakeProvider, fakeProviderDef } from './fakes.js';

export function makeProvidersView(ctx: ViewContext): ProvidersClientView {
  const { peer, requireInfo } = ctx;
  return {
    getActive: () => {
      const info = requireInfo();
      const name = info.activeProvider ?? info.providers[0]?.name ?? 'unknown';
      return fakeProvider(name, info.providers.find((p) => p.name === name)?.models ?? []);
    },
    getActiveName: () => requireInfo().activeProvider,
    list: () => requireInfo().providers.map(fakeProviderDef),
    setActive: (name, config) => {
      void peer
        .request(RunnerMethod.ProviderSetActive, { name, ...(config ? { config } : {}) })
        .catch(() => undefined);
      const models = requireInfo().providers.find((p) => p.name === name)?.models ?? [];
      return fakeProvider(name, models);
    },
    // Provider re-instantiation happens server-side as part of setActive.
    replace: () => undefined,
  };
}
