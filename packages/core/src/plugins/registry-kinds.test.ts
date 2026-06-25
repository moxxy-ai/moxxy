import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  defineAgent,
  defineCacheStrategy,
  defineChannel,
  defineCommand,
  defineCompactor,
  defineEmbedder,
  defineMode,
  definePlugin,
  defineProvider,
  defineSurface,
  defineSynthesizer,
  defineTool,
  defineTranscriber,
  defineTunnelProvider,
  defineViewRenderer,
  defineWorkflowExecutor,
  type Isolator,
} from '@moxxy/sdk';
import { silentLogger } from '../logger.js';
import { ToolRegistryImpl } from '../registries/tools.js';
import { ProviderRegistry } from '../registries/providers.js';
import { ModeRegistry } from '../registries/modes.js';
import { CompactorRegistry } from '../registries/compactors.js';
import { CacheStrategyRegistry } from '../registries/cache-strategies.js';
import { ViewRendererRegistry } from '../registries/view-renderers.js';
import { TunnelProviderRegistry } from '../registries/tunnel-providers.js';
import { ChannelRegistryImpl } from '../registries/channels.js';
import { SurfaceRegistryImpl } from '../registries/surfaces.js';
import { AgentRegistry } from '../registries/agents.js';
import { CommandRegistry } from '../registries/commands.js';
import { TranscriberRegistry } from '../registries/transcribers.js';
import { SynthesizerRegistry } from '../registries/synthesizers.js';
import { EmbedderRegistry } from '../registries/embedders.js';
import { IsolatorRegistry } from '../registries/isolators.js';
import { WorkflowExecutorRegistry } from '../registries/workflow-executors.js';
import { EventStoreRegistry } from '../registries/event-stores.js';
import { RequirementRegistry } from '../requirements.js';
import { HookDispatcherImpl } from './lifecycle.js';
import { PluginHost } from './host.js';
import { REGISTRY_KINDS } from './registry-kinds.js';

// One minimal def per contribution kind, keyed by REGISTRY_KINDS `kind`.
const isolator: Isolator = {
  name: 'iso-1',
  strength: 'none',
  run: async (_call, handler) => handler(undefined),
};

const everyKindPlugin = definePlugin({
  name: 'every-kind',
  tools: [defineTool({ name: 'tool-1', description: '', inputSchema: z.any(), handler: () => null })],
  providers: [
    defineProvider({
      name: 'prov-1',
      models: [],
      createClient: () => ({ name: 'prov-1', models: [], stream: async function* () {}, countTokens: async () => 0 }),
    }),
  ],
  modes: [defineMode({ name: 'mode-1', run: async function* () {} })],
  compactors: [defineCompactor({ name: 'comp-1', shouldCompact: () => false, compact: async () => ({}) as never })],
  cacheStrategies: [defineCacheStrategy({ name: 'cs-1', plan: () => [] })],
  viewRenderers: [defineViewRenderer({ name: 'vr-1', allowList: [], parse: () => ({ ok: false, errors: [] }), validate: () => [] })],
  tunnelProviders: [defineTunnelProvider({ name: 'tp-1', open: () => Promise.resolve({ url: 'http://x', close: () => Promise.resolve() }) })],
  channels: [defineChannel({ name: 'chan-1', description: '', create: () => ({ start: async () => {}, stop: async () => {} }) as never })],
  surfaces: [defineSurface({ kind: 'surf-1', open: () => ({ kind: 'surf-1' }) as never })],
  agents: [defineAgent({ name: 'agent-1', description: '' })],
  commands: [defineCommand({ name: 'cmd-1', description: '', handler: () => ({ text: '' }) as never })],
  transcribers: [defineTranscriber({ name: 'tr-1', createClient: () => ({}) as never })],
  synthesizers: [defineSynthesizer({ name: 'synth-1', create: () => ({}) as never })],
  embedders: [defineEmbedder({ name: 'emb-1', createClient: () => ({}) as never })],
  isolators: [isolator],
  workflowExecutors: [defineWorkflowExecutor({ name: 'wfx-1', run: async () => ({}) as never })],
  eventStores: [
    {
      name: 'es-1',
      open: () => ({
        attach: () => () => {},
        flush: async () => {},
        settleWrites: async () => {},
        updateHeader: () => {},
        degraded: false,
      }),
      restore: async () => [],
      readPage: async () => ({ events: [], prevCursor: null }),
    },
  ],
});

function makeHost() {
  const registries = {
    tools: new ToolRegistryImpl({ logger: silentLogger, cwd: '/tmp' }),
    providers: new ProviderRegistry(),
    modes: new ModeRegistry(),
    compactors: new CompactorRegistry(),
    cacheStrategies: new CacheStrategyRegistry(),
    viewRenderers: new ViewRendererRegistry(),
    tunnelProviders: new TunnelProviderRegistry(),
    channels: new ChannelRegistryImpl(),
    surfaces: new SurfaceRegistryImpl(),
    agents: new AgentRegistry(),
    commands: new CommandRegistry(),
    transcribers: new TranscriberRegistry(),
    synthesizers: new SynthesizerRegistry(),
    embedders: new EmbedderRegistry(),
    isolators: new IsolatorRegistry(),
    workflowExecutors: new WorkflowExecutorRegistry(),
    eventStores: new EventStoreRegistry(),
  };
  const requirements = new RequirementRegistry({
    tools: registries.tools,
    providers: registries.providers,
    modes: registries.modes,
    compactors: registries.compactors,
    channels: registries.channels,
    agents: registries.agents,
    commands: registries.commands,
    transcribers: registries.transcribers,
  });
  const dispatcher = new HookDispatcherImpl({ logger: silentLogger });
  const host = new PluginHost({
    cwd: '/tmp',
    logger: silentLogger,
    ...registries,
    requirements,
    dispatcher,
  });
  // Map each REGISTRY_KINDS entry to its concrete registry instance so the
  // assertions below cover every kind without a hand-maintained second list.
  const byKind: Record<string, { list(): ReadonlyArray<unknown> }> = {
    tool: registries.tools,
    provider: registries.providers,
    mode: registries.modes,
    compactor: registries.compactors,
    cacheStrategy: registries.cacheStrategies,
    viewRenderer: registries.viewRenderers,
    tunnelProvider: registries.tunnelProviders,
    channel: registries.channels,
    surface: registries.surfaces,
    agent: registries.agents,
    command: registries.commands,
    transcriber: registries.transcribers,
    synthesizer: registries.synthesizers,
    embedder: registries.embedders,
    isolator: registries.isolators,
    workflowExecutor: registries.workflowExecutors,
    eventStore: registries.eventStores,
  };
  return { host, byKind };
}

describe('PluginHost register/unregister lockstep (REGISTRY_KINDS)', () => {
  it('the table covers every kind the test exercises', () => {
    const { byKind } = makeHost();
    // Guards that adding a REGISTRY_KINDS entry without updating this test (or
    // vice-versa) is caught — the unload-leak assertion below is only as strong
    // as this coverage.
    expect(REGISTRY_KINDS.map((k) => k.kind).sort()).toEqual(Object.keys(byKind).sort());
  });

  it('registerStatic populates every registry kind', () => {
    const { host, byKind } = makeHost();
    host.registerStatic(everyKindPlugin);
    for (const kind of REGISTRY_KINDS) {
      expect(byKind[kind.kind]!.list().length, `${kind.kind} should be populated`).toBe(1);
    }
  });

  it('unload reverses register for EVERY kind — no registry left populated', async () => {
    const { host, byKind } = makeHost();
    host.registerStatic(everyKindPlugin);
    await host.unload('every-kind');
    for (const kind of REGISTRY_KINDS) {
      expect(byKind[kind.kind]!.list().length, `${kind.kind} should be empty after unload`).toBe(0);
    }
  });

  it('unloading a discovered plugin whose isolator was REFUSED keeps the trusted builtin', async () => {
    const { host, byKind } = makeHost();
    const isolators = byKind.isolator as IsolatorRegistry;
    // A trusted builtin owns the name "worker".
    const trustedWorker: Isolator = { name: 'worker', strength: 'none', run: async (_c, h) => h(undefined) };
    host.registerStatic(definePlugin({ name: 'builtin-sec', isolators: [trustedWorker] }));
    expect(isolators.get('worker')).toBe(trustedWorker);

    // A discovered (untrusted) plugin tries to shadow "worker"; the registry
    // refuses, so the plugin never owned it. Unloading the discovered plugin
    // must NOT delete the trusted impl.
    const rogueWorker: Isolator = { name: 'worker', strength: 'none', run: async (_c, h) => h(undefined) };
    host.registerDiscovered(
      definePlugin({ name: 'rogue', isolators: [rogueWorker] }),
      { entry: './index.js', packageName: '@rogue/pkg', packageVersion: '1.0.0', packagePath: '/tmp/rogue' },
    );
    expect(isolators.get('worker')).toBe(trustedWorker); // refused, not shadowed

    await host.unload('@rogue/pkg');
    // The trusted worker must survive the rogue plugin's unload.
    expect(isolators.get('worker')).toBe(trustedWorker);
    expect(isolators.has('worker')).toBe(true);
  });

  it('a mid-load collision in a discovered plugin whose isolator was REFUSED does not delete the trusted builtin', () => {
    const { host, byKind } = makeHost();
    const isolators = byKind.isolator as IsolatorRegistry;
    const tools = byKind.tool as ToolRegistryImpl;
    const trustedWorker: Isolator = { name: 'worker', strength: 'none', run: async (_c, h) => h(undefined) };
    host.registerStatic(definePlugin({ name: 'builtin-sec', isolators: [trustedWorker] }));
    // Another plugin owns tool "dup".
    host.registerStatic(
      definePlugin({ name: 'first', tools: [defineTool({ name: 'dup', description: '', inputSchema: z.any(), handler: () => null })] }),
    );

    // A discovered plugin: its isolator "worker" is refused (untrusted shadow),
    // then its tool "dup" collides → applyPlugin throws and rolls back. The
    // rollback must NOT unregister "worker" (the plugin never owned it).
    const rogue = definePlugin({
      name: 'rogue',
      isolators: [{ name: 'worker', strength: 'none', run: async (_c, h) => h(undefined) } as Isolator],
      tools: [defineTool({ name: 'dup', description: '', inputSchema: z.any(), handler: () => null })],
    });
    expect(() =>
      host.registerDiscovered(rogue, { entry: './index.js', packageName: '@rogue/pkg', packageVersion: '1.0.0', packagePath: '/tmp/rogue' }),
    ).toThrow(/already registered/);
    // Trusted worker untouched; first plugin's tool untouched.
    expect(isolators.get('worker')).toBe(trustedWorker);
    expect(tools.has('dup')).toBe(true);
    // No half-loaded record for the rogue.
    expect(host.list().map((p) => p.name).sort()).toEqual(['builtin-sec', 'first']);
  });
});
