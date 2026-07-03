/**
 * Shared option/loader types for {@link PluginHost}. Extracted into this leaf
 * module so both `host.ts` and the registry-kind table (`registry-kinds.ts`)
 * can depend on `PluginHostOptions` without forming an import cycle
 * (`host.ts` → `registry-kinds.ts` → `host.ts`). Re-exported from `host.ts`
 * for back-compat, so existing `import { PluginHostOptions } from './host.js'`
 * call sites keep working.
 */
import type { Plugin, ResolvedPluginManifest } from '@moxxy/sdk';
import type { Logger } from '../logger.js';
import type { AgentRegistry } from '../registries/agents.js';
import type { CommandRegistry } from '../registries/commands.js';
import type { ChannelRegistryImpl } from '../registries/channels.js';
import type { SurfaceRegistryImpl } from '../registries/surfaces.js';
import type { CacheStrategyRegistry } from '../registries/cache-strategies.js';
import type { ViewRendererRegistry } from '../registries/view-renderers.js';
import type { TunnelProviderRegistry } from '../registries/tunnel-providers.js';
import type { CompactorRegistry } from '../registries/compactors.js';
import type { ModeRegistry } from '../registries/modes.js';
import type { ProviderRegistry } from '../registries/providers.js';
import type { ToolRegistry } from '../registries/tools.js';
import type { TranscriberRegistry } from '../registries/transcribers.js';
import type { SynthesizerRegistry } from '../registries/synthesizers.js';
import type { EmbedderRegistry } from '../registries/embedders.js';
import type { IsolatorRegistry } from '../registries/isolators.js';
import type { WorkflowExecutorRegistry } from '../registries/workflow-executors.js';
import type { EventStoreRegistry } from '../registries/event-stores.js';
import type { ReflectorRegistry } from '../registries/reflectors.js';
import type { HookDispatcherImpl } from './lifecycle.js';
import type { RequirementRegistry } from '../requirements.js';

export interface PluginHostOptions {
  readonly cwd: string;
  readonly logger: Logger;
  readonly tools: ToolRegistry;
  readonly providers: ProviderRegistry;
  readonly modes: ModeRegistry;
  readonly compactors: CompactorRegistry;
  readonly cacheStrategies: CacheStrategyRegistry;
  readonly viewRenderers: ViewRendererRegistry;
  readonly tunnelProviders: TunnelProviderRegistry;
  readonly channels: ChannelRegistryImpl;
  readonly surfaces: SurfaceRegistryImpl;
  readonly agents: AgentRegistry;
  readonly commands: CommandRegistry;
  readonly transcribers: TranscriberRegistry;
  readonly synthesizers: SynthesizerRegistry;
  readonly embedders: EmbedderRegistry;
  readonly isolators: IsolatorRegistry;
  readonly workflowExecutors: WorkflowExecutorRegistry;
  readonly eventStores: EventStoreRegistry;
  readonly reflectors: ReflectorRegistry;
  readonly requirements: RequirementRegistry;
  readonly dispatcher: HookDispatcherImpl;
  readonly loader?: PluginLoader;
  /**
   * Extra discovery roots beyond the cwd-rooted `node_modules` walk (e.g.
   * `~/.moxxy/plugins` and its `node_modules`). Stored so `reload()` reuses
   * them — otherwise a reload would compute its "wanted" set without these
   * paths and unload every user plugin, then fail to rediscover them.
   */
  readonly userPaths?: ReadonlyArray<string>;
  /**
   * Predicate consulted (by PACKAGE name) for discovered plugins on every
   * `discoverAndLoad`/`reload`. Returning `true` keeps the package out of the
   * "wanted" set, so a plugin the user disabled (config `plugins[name].enabled
   * = false`) is never re-loaded by a reload and, if currently loaded, is
   * unloaded. Boot-time builtins are filtered separately by register-plugins;
   * this closes the runtime-toggle / reload hole. Reads live state, so a
   * runtime enable/disable takes effect on the next reload without a restart.
   */
  readonly isDisabled?: (packageName: string) => boolean;
}

export interface PluginLoader {
  load(manifest: ResolvedPluginManifest): Promise<Plugin>;
}
