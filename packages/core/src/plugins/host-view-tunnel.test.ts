import { describe, expect, it } from 'vitest';
import { definePlugin, defineTunnelProvider, defineViewRenderer } from '@moxxy/sdk';
import { silentLogger } from '../logger.js';
import { ToolRegistryImpl } from '../registries/tools.js';
import { ProviderRegistry } from '../registries/providers.js';
import { ModeRegistry } from '../registries/modes.js';
import { CompactorRegistry } from '../registries/compactors.js';
import { CacheStrategyRegistry } from '../registries/cache-strategies.js';
import { ViewRendererRegistry } from '../registries/view-renderers.js';
import { TunnelProviderRegistry } from '../registries/tunnel-providers.js';
import { ChannelRegistryImpl } from '../registries/channels.js';
import { AgentRegistry } from '../registries/agents.js';
import { CommandRegistry } from '../registries/commands.js';
import { TranscriberRegistry } from '../registries/transcribers.js';
import { HookDispatcherImpl } from './lifecycle.js';
import { PluginHost } from './host.js';
import { RequirementRegistry } from '../requirements.js';

function makeHost() {
  const tools = new ToolRegistryImpl({ logger: silentLogger, cwd: '/tmp' });
  const providers = new ProviderRegistry();
  const modes = new ModeRegistry();
  const compactors = new CompactorRegistry();
  const cacheStrategies = new CacheStrategyRegistry();
  const viewRenderers = new ViewRendererRegistry();
  const tunnelProviders = new TunnelProviderRegistry();
  const channels = new ChannelRegistryImpl();
  const agents = new AgentRegistry();
  const commands = new CommandRegistry();
  const transcribers = new TranscriberRegistry();
  const requirements = new RequirementRegistry({ tools, providers, modes, compactors, channels, agents, commands, transcribers });
  const dispatcher = new HookDispatcherImpl({ logger: silentLogger });
  const host = new PluginHost({
    cwd: '/tmp',
    logger: silentLogger,
    tools,
    providers,
    modes,
    compactors,
    cacheStrategies,
    viewRenderers,
    tunnelProviders,
    channels,
    agents,
    commands,
    transcribers,
    requirements,
    dispatcher,
  });
  return { host, viewRenderers, tunnelProviders };
}

const vr = defineViewRenderer({ name: 'custom-renderer', allowList: [], parse: () => ({ ok: false, errors: [] }), validate: () => [] });
const tp = defineTunnelProvider({ name: 'ngrok', open: () => Promise.resolve({ url: 'http://x', close: () => Promise.resolve() }) });

describe('PluginHost — view-renderer + tunnel-provider blocks', () => {
  it('registers both block kinds on registerStatic', () => {
    const { host, viewRenderers, tunnelProviders } = makeHost();
    host.registerStatic(definePlugin({ name: 'blocks-demo', viewRenderers: [vr], tunnelProviders: [tp] }));
    expect(viewRenderers.list().map((r) => r.name)).toContain('custom-renderer');
    expect(viewRenderers.getActive()?.name).toBe('custom-renderer'); // first → auto-active
    expect(tunnelProviders.list().map((p) => p.name)).toContain('ngrok');
    expect(tunnelProviders.getActive()?.name).toBe('ngrok');
  });

  it('unregisters both block kinds on unload', async () => {
    const { host, viewRenderers, tunnelProviders } = makeHost();
    host.registerStatic(definePlugin({ name: 'blocks-demo', viewRenderers: [vr], tunnelProviders: [tp] }));
    await host.unload('blocks-demo');
    expect(viewRenderers.list()).toHaveLength(0);
    expect(viewRenderers.getActive()).toBeNull();
    expect(tunnelProviders.list()).toHaveLength(0);
    expect(tunnelProviders.getActive()).toBeNull();
  });

  it('replace semantics: a second renderer plugin overwrites without throwing', () => {
    const { host, viewRenderers } = makeHost();
    host.registerStatic(definePlugin({ name: 'a', viewRenderers: [vr] }));
    const vr2 = defineViewRenderer({ name: 'custom-renderer', allowList: [], parse: () => ({ ok: false, errors: [] }), validate: () => [] });
    // host.applyPlugin uses registry.replace for view renderers, so a same-named
    // renderer from another plugin overwrites instead of throwing.
    host.registerStatic(definePlugin({ name: 'b', viewRenderers: [vr2] }));
    expect(viewRenderers.list()).toHaveLength(1);
    expect(viewRenderers.getActive()).toBe(vr2);
  });
});
