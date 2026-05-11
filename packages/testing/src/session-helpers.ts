import { Session, autoAllowResolver, silentLogger } from '@moxxy/core';
import type { LLMProvider, Plugin } from '@moxxy/sdk';
import { definePlugin, defineProvider } from '@moxxy/sdk';

export interface FakeSessionOptions {
  readonly cwd?: string;
  readonly provider: LLMProvider;
  readonly plugins?: ReadonlyArray<Plugin>;
}

export function createFakeSession(opts: FakeSessionOptions): Session {
  const session = new Session({
    cwd: opts.cwd ?? process.cwd(),
    logger: silentLogger,
    permissionResolver: autoAllowResolver,
  });

  const providerPlugin = definePlugin({
    name: '@moxxy/testing/provider-shim',
    providers: [
      defineProvider({
        name: opts.provider.name,
        models: [...opts.provider.models],
        createClient: () => opts.provider,
      }),
    ],
  });
  session.pluginHost.registerStatic(providerPlugin);
  session.providers.setActive(opts.provider.name);

  for (const plugin of opts.plugins ?? []) session.pluginHost.registerStatic(plugin);
  return session;
}
