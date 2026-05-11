import type {
  AppContext,
  CompactorDef,
  LifecycleHooks,
  LoopStrategyDef,
  Plugin,
  PluginHostHandle,
  ProviderDef,
  ResolvedPluginManifest,
  ToolDef,
} from '@moxxy/sdk';
import type { Logger } from '../logger.js';
import type { CompactorRegistry } from '../registries/compactors.js';
import type { LoopRegistry } from '../registries/loops.js';
import type { ProviderRegistry } from '../registries/providers.js';
import type { ToolRegistry } from '../registries/tools.js';
import type { HookDispatcherImpl } from './lifecycle.js';
import { discoverPlugins } from './discovery.js';

export interface PluginHostOptions {
  readonly cwd: string;
  readonly logger: Logger;
  readonly tools: ToolRegistry;
  readonly providers: ProviderRegistry;
  readonly loops: LoopRegistry;
  readonly compactors: CompactorRegistry;
  readonly dispatcher: HookDispatcherImpl;
  readonly loader?: PluginLoader;
}

export interface PluginLoader {
  load(manifest: ResolvedPluginManifest): Promise<Plugin>;
}

interface LoadedRecord {
  readonly plugin: Plugin;
  readonly manifest?: ResolvedPluginManifest;
  readonly toolNames: ReadonlyArray<string>;
  readonly providerNames: ReadonlyArray<string>;
  readonly loopNames: ReadonlyArray<string>;
  readonly compactorNames: ReadonlyArray<string>;
}

export interface PluginRegistrationEvent {
  readonly kind: 'registered' | 'unregistered';
  readonly plugin: Plugin;
  readonly manifest?: ResolvedPluginManifest;
}

export class PluginHost implements PluginHostHandle {
  private readonly loaded = new Map<string, LoadedRecord>();
  private readonly listeners = new Set<(event: PluginRegistrationEvent) => void>();

  constructor(private readonly opts: PluginHostOptions) {}

  list(): ReadonlyArray<{ name: string; version: string; loaded: boolean }> {
    return [...this.loaded.values()].map((r) => ({
      name: r.plugin.name,
      version: r.plugin.version,
      loaded: true,
    }));
  }

  subscribe(fn: (event: PluginRegistrationEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  registerStatic(plugin: Plugin): void {
    if (this.loaded.has(plugin.name)) {
      throw new Error(`Plugin already registered: ${plugin.name}`);
    }
    const record = this.applyPlugin(plugin);
    this.loaded.set(plugin.name, record);
    this.refreshDispatcher();
    this.emit({ kind: 'registered', plugin });
  }

  async discoverAndLoad(extraPaths?: ReadonlyArray<string>): Promise<ReadonlyArray<Plugin>> {
    const manifests = await discoverPlugins({
      cwd: this.opts.cwd,
      logger: this.opts.logger,
      extraPaths,
    });
    const loaded: Plugin[] = [];
    const loader = this.opts.loader;
    if (!loader) {
      this.opts.logger.warn(
        'PluginHost.discoverAndLoad called without a loader; static plugins only. Provide a loader (e.g. jiti loader) to enable dynamic discovery.',
      );
      return loaded;
    }
    for (const manifest of manifests) {
      if (this.loaded.has(manifest.packageName)) continue;
      try {
        const plugin = await loader.load(manifest);
        const record = this.applyPlugin(plugin, manifest);
        this.loaded.set(plugin.name, record);
        loaded.push(plugin);
        this.emit({ kind: 'registered', plugin, manifest });
      } catch (err) {
        this.opts.logger.warn('PluginHost: failed to load plugin', {
          package: manifest.packageName,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.refreshDispatcher();
    return loaded;
  }

  async unload(name: string, _ctx?: AppContext): Promise<void> {
    const record = this.loaded.get(name);
    if (!record) return;
    for (const toolName of record.toolNames) this.opts.tools.unregister(toolName);
    for (const provName of record.providerNames) this.opts.providers.unregister(provName);
    for (const loopName of record.loopNames) this.opts.loops.unregister(loopName);
    for (const compName of record.compactorNames) this.opts.compactors.unregister(compName);
    this.loaded.delete(name);
    this.refreshDispatcher();
    this.emit({ kind: 'unregistered', plugin: record.plugin, manifest: record.manifest });
  }

  async reload(): Promise<void> {
    this.opts.logger.info('PluginHost.reload(): rescanning plugins');
    const manifests = await discoverPlugins({
      cwd: this.opts.cwd,
      logger: this.opts.logger,
    });
    const wanted = new Set(manifests.map((m) => m.packageName));
    for (const [name] of [...this.loaded]) {
      if (!wanted.has(name)) await this.unload(name);
    }
    await this.discoverAndLoad();
  }

  getHooks(): ReadonlyArray<{ name: string; hooks: LifecycleHooks }> {
    return [...this.loaded.values()].map((r) => ({
      name: r.plugin.name,
      hooks: r.plugin.hooks ?? {},
    }));
  }

  private applyPlugin(plugin: Plugin, manifest?: ResolvedPluginManifest): LoadedRecord {
    const toolNames = (plugin.tools ?? []).map((t: ToolDef) => t.name);
    const providerNames = (plugin.providers ?? []).map((p: ProviderDef) => p.name);
    const loopNames = (plugin.loopStrategies ?? []).map((l: LoopStrategyDef) => l.name);
    const compactorNames = (plugin.compactors ?? []).map((c: CompactorDef) => c.name);

    for (const tool of plugin.tools ?? []) this.opts.tools.register(tool);
    for (const provider of plugin.providers ?? []) this.opts.providers.register(provider);
    for (const loop of plugin.loopStrategies ?? []) this.opts.loops.register(loop);
    for (const compactor of plugin.compactors ?? []) this.opts.compactors.register(compactor);

    return { plugin, manifest, toolNames, providerNames, loopNames, compactorNames };
  }

  private refreshDispatcher(): void {
    this.opts.dispatcher.setPlugins([...this.loaded.values()].map((r) => r.plugin));
  }

  private emit(event: PluginRegistrationEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch (err) {
        this.opts.logger.warn('PluginHost listener threw', { err: String(err) });
      }
    }
  }
}
