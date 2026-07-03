import type {
  MoxxyRequirement,
  Plugin,
  PluginHostHandle,
  RequirementCheck,
  RequirementIssue,
  ResolvedPluginManifest,
} from '@moxxy/sdk';
import { discoverPlugins } from './discovery.js';
import { toposortPluginManifests, PluginCycleError } from './toposort.js';
import { REGISTRY_KINDS, type RegistryNameRecord } from './registry-kinds.js';

// PluginHostOptions + PluginLoader live in ./host-options.js (a leaf shared with
// registry-kinds.ts to avoid an import cycle). Imported for local use and
// re-exported so existing `import { PluginHostOptions } from './host.js'` call
// sites keep working.
import type { PluginHostOptions, PluginLoader } from './host-options.js';
export type { PluginHostOptions, PluginLoader };

export interface RegisterStaticOptions {
  /**
   * Static requirements to enforce before registration. Mirrors the
   * `moxxy.requirements` field a discovered plugin's package.json would
   * carry; passed explicitly here because statically-imported builtins
   * don't go through `discoverPlugins()`.
   */
  readonly requirements?: ReadonlyArray<MoxxyRequirement>;
}

export type PluginSkipSource = 'static' | 'discovered';
export type PluginSkipReason = 'unmet_requirements' | 'load_error';

export interface PluginSkipRecord {
  readonly pluginName: string;
  readonly source: PluginSkipSource;
  readonly reason: PluginSkipReason;
  readonly message: string;
  readonly packageName?: string;
  readonly issues?: ReadonlyArray<RequirementIssue>;
  readonly hints: ReadonlyArray<string>;
}

export class PluginRequirementError extends Error {
  constructor(
    readonly pluginName: string,
    readonly check: RequirementCheck,
  ) {
    super(
      check.issues
        .filter((issue) => !issue.requirement.optional)
        .map((issue) => issue.message)
        .join('; '),
    );
    this.name = 'PluginRequirementError';
  }
}

interface LoadedRecord extends RegistryNameRecord {
  readonly plugin: Plugin;
  readonly manifest?: ResolvedPluginManifest;
}

export class PluginHost implements PluginHostHandle {
  private readonly loaded = new Map<string, LoadedRecord>();
  private readonly skipped = new Map<string, PluginSkipRecord>();

  constructor(private readonly opts: PluginHostOptions) {}

  list(): ReadonlyArray<{
    name: string;
    version: string;
    loaded: boolean;
    /**
     * True when this plugin was DISCOVERED from `~/.moxxy/plugins` (installed on
     * demand), false when it was statically bundled into the binary. Discovered
     * plugins carry a manifest (registerDiscovered); bundled ones don't
     * (registerStatic). Lets the UI tell "built-in" from "installed".
     */
    installed: boolean;
    kinds: ReadonlyArray<string>;
  }> {
    return [...this.loaded.values()].map((r) => ({
      name: r.plugin.name,
      version: r.plugin.version,
      loaded: true,
      installed: r.manifest != null,
      kinds: contributionKinds(r),
    }));
  }

  listSkipped(): ReadonlyArray<PluginSkipRecord> {
    return [...this.skipped.values()];
  }

  /**
   * The plugin that contributed the named tool — the `loaded` map key, i.e.
   * the package name for discovered plugins and the declared plugin name for
   * statically bundled ones. Linear scan over per-plugin name lists: the
   * registries are small (~40 plugins × a handful of tools) and callers
   * (security routing, audit views) are not hot paths.
   */
  ownerOfTool(toolName: string): string | undefined {
    for (const [key, record] of this.loaded) {
      if (record.toolNames.includes(toolName)) return key;
    }
    return undefined;
  }

  registerStatic(plugin: Plugin, opts: RegisterStaticOptions = {}): void {
    if (this.loaded.has(plugin.name)) {
      throw new Error(`Plugin already registered: ${plugin.name}`);
    }
    this.assertRequirementsReady(plugin, opts.requirements, 'static');
    const record = this.applyPlugin(plugin);
    this.loaded.set(plugin.name, record);
    this.clearSkip(plugin.name);
    this.opts.requirements.registerPlugin(plugin.name, plugin.version);
    this.refreshDispatcher();
  }

  registerDiscovered(plugin: Plugin, manifest: ResolvedPluginManifest): void {
    // Key the loaded map by the PACKAGE name — not the plugin's declared
    // `name` — so it lines up with `discoverAndLoad`'s dedupe check, `reload`'s
    // `wanted` set, and `unload(packageName)` callers (self-update, config,
    // plugins-admin). Keying by `plugin.name` silently broke all three whenever
    // a plugin's declared name differed from its package name (re-load throws,
    // reload unloads everything, unload no-ops).
    if (this.loaded.has(manifest.packageName)) {
      throw new Error(`Plugin already registered: ${manifest.packageName}`);
    }
    this.assertRequirementsReady(plugin, manifest.requirements, 'discovered', manifest);
    const record = this.applyPlugin(plugin, manifest);
    this.loaded.set(manifest.packageName, record);
    this.clearSkip(plugin.name);
    this.clearSkip(manifest.packageName);
    // Register the requirement under the PACKAGE name, not the declared
    // plugin.name. `kind:'plugin'` requirements are resolved by package name —
    // toposort keys `byPackage` by `manifest.packageName`, so the readiness
    // gate (`requirements.plugins.get(name)`) must agree. Keying by plugin.name
    // here meant a dependent's `{kind:'plugin', name:<packageName>}` would pass
    // toposort ordering but fail the readiness gate whenever a plugin's
    // declared name differed from its package name (host.ts documents that they
    // can differ).
    this.opts.requirements.registerPlugin(manifest.packageName, plugin.version);
    this.refreshDispatcher();
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
    let ordered: ReadonlyArray<ResolvedPluginManifest>;
    try {
      ordered = toposortPluginManifests(manifests);
    } catch (err) {
      if (err instanceof PluginCycleError) {
        this.opts.logger.warn('PluginHost: requirement cycle, falling back to unsorted order', {
          cycle: err.cycle,
        });
        ordered = manifests;
      } else {
        throw err;
      }
    }
    for (const manifest of ordered) {
      if (this.loaded.has(manifest.packageName)) continue;
      // Honor a runtime/config disable: never load a package the user turned off.
      if (this.opts.isDisabled?.(manifest.packageName)) continue;
      try {
        const plugin = await loader.load(manifest);
        this.registerDiscovered(plugin, manifest);
        loaded.push(plugin);
      } catch (err) {
        if (err instanceof PluginRequirementError) {
          this.opts.logger.warn('PluginHost: skipped plugin due to unmet requirements', {
            package: manifest.packageName,
            plugin: err.pluginName,
            err: err.message,
          });
          continue;
        }
        this.recordLoadError(manifest.packageName, 'discovered', manifest.packageName, err);
        this.opts.logger.warn('PluginHost: failed to load plugin', {
          package: manifest.packageName,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.refreshDispatcher();
    return loaded;
  }

  async unload(name: string): Promise<void> {
    const record = this.loaded.get(name);
    if (!record) return;
    // Iterate REGISTRY_KINDS in its declared order — the exact set + order the
    // original hand-written unregister sequence used — so register/unregister
    // stay in lockstep and a new kind is one table entry, not edits here.
    for (const kind of REGISTRY_KINDS) {
      for (const recordedName of record[kind.recordField]) kind.unregister(this.opts, recordedName);
    }
    this.loaded.delete(name);
    // Unregister under the SAME key registration used: package name for
    // discovered plugins (see registerDiscovered), declared name for statics.
    this.opts.requirements.unregisterPlugin(record.manifest?.packageName ?? record.plugin.name);
    this.refreshDispatcher();
  }

  async reload(): Promise<void> {
    this.opts.logger.info('PluginHost.reload(): rescanning plugins');
    // Reuse the same discovery roots the initial load used (incl. the user
    // plugin dirs) for BOTH the "wanted" scan and the re-load. Omitting them
    // would mark user plugins as not-wanted (→ unloaded) and never re-add them.
    const manifests = await discoverPlugins({
      cwd: this.opts.cwd,
      logger: this.opts.logger,
      ...(this.opts.userPaths ? { extraPaths: this.opts.userPaths } : {}),
    });
    // A disabled package is excluded from `wanted`, so the loop below unloads it
    // if currently loaded and discoverAndLoad won't bring it back.
    const wanted = new Set(
      manifests
        .filter((m) => !this.opts.isDisabled?.(m.packageName))
        .map((m) => m.packageName),
    );
    for (const [name] of [...this.loaded]) {
      // Statically-registered builtins have no manifest; never unload them on
      // reload — they aren't discovered from disk so they'd never come back.
      if (this.loaded.get(name)?.manifest && !wanted.has(name)) await this.unload(name);
    }
    await this.discoverAndLoad(this.opts.userPaths);
  }

  private applyPlugin(plugin: Plugin, manifest?: ResolvedPluginManifest): LoadedRecord {
    // A statically-registered builtin (no manifest) is trusted; a discovered
    // plugin (manifest present) is not. The isolator registry uses this to
    // refuse letting a discovered plugin shadow a trusted isolator name.
    const trusted = manifest === undefined;

    // Register in REGISTRY_KINDS order — the exact set + order the original
    // hand-written register sequence used (incl. viewRenderers/tunnelProviders
    // via `replace`). Track what we successfully registered so a mid-loop throw
    // (e.g. a duplicate name colliding with an already-loaded plugin, since most
    // registries throw on duplicate) doesn't strand half-registered
    // contributions: no LoadedRecord is created on throw, so `unload` could
    // never reach them. On failure, unregister in reverse before rethrowing.
    const registered: Array<{ kind: (typeof REGISTRY_KINDS)[number]; name: string }> = [];
    try {
      for (const kind of REGISTRY_KINDS) {
        for (const def of kind.defs(plugin)) {
          // A `false` return means the registration was REFUSED without taking
          // effect (an untrusted plugin shadowing a trusted isolator). Don't
          // track it — neither for rollback (unregistering would delete the
          // trusted impl this plugin never owned) NOR for the LoadedRecord (so
          // a clean `unload` later doesn't delete that same trusted impl).
          const applied = kind.register(this.opts, def, trusted);
          if (applied === false) continue;
          registered.push({ kind, name: kind.nameOf(def) });
        }
      }
    } catch (err) {
      for (let i = registered.length - 1; i >= 0; i--) {
        const entry = registered[i];
        if (!entry) continue;
        const { kind, name } = entry;
        // Don't roll back override-on-register kinds (view/tunnel): they're
        // last-wins `replace`, so this plugin may have clobbered a def core or
        // another plugin owned — unregistering would delete that shared def.
        if (kind.overrideOnRegister) continue;
        try {
          kind.unregister(this.opts, name);
        } catch {
          // Best-effort rollback: keep unwinding the rest even if one
          // unregister throws, so we don't leave further orphans behind.
        }
      }
      throw err;
    }

    // Build the LoadedRecord's per-kind name lists from what was ACTUALLY
    // applied (the `registered` list), not from the raw `defs` snapshot — a
    // refused isolator registration must not appear here, or `unload` would
    // unregister a name this plugin never owned (deleting a trusted builtin).
    const names = {} as Record<keyof RegistryNameRecord, string[]>;
    for (const kind of REGISTRY_KINDS) names[kind.recordField] = [];
    for (const { kind, name } of registered) names[kind.recordField].push(name);

    return {
      plugin,
      manifest,
      ...(names as RegistryNameRecord),
    };
  }

  private assertRequirementsReady(
    plugin: Plugin,
    requirements: ReadonlyArray<MoxxyRequirement> | undefined,
    source: PluginSkipSource = 'static',
    manifest?: ResolvedPluginManifest,
  ): void {
    if (!requirements || requirements.length === 0) return;
    const check = this.opts.requirements.check(requirements);
    if (!check.ready) {
      this.recordRequirementSkip(plugin, source, manifest, check);
      throw new PluginRequirementError(plugin.name, check);
    }
  }

  private refreshDispatcher(): void {
    this.opts.dispatcher.setPlugins([...this.loaded.values()].map((r) => r.plugin));
  }

  private recordRequirementSkip(
    plugin: Plugin,
    source: PluginSkipSource,
    manifest: ResolvedPluginManifest | undefined,
    check: RequirementCheck,
  ): void {
    const blocking = check.issues.filter((issue) => !issue.requirement.optional);
    this.skipped.set(skipKey(plugin.name), {
      pluginName: plugin.name,
      source,
      reason: 'unmet_requirements',
      message: blocking.map((issue) => issue.message).join('; '),
      ...(manifest ? { packageName: manifest.packageName } : {}),
      issues: check.issues,
      hints: blocking.flatMap((issue) => issue.hint ? [issue.hint] : []),
    });
  }

  private recordLoadError(
    pluginName: string,
    source: PluginSkipSource,
    packageName: string | undefined,
    err: unknown,
  ): void {
    this.skipped.set(skipKey(pluginName), {
      pluginName,
      source,
      reason: 'load_error',
      message: err instanceof Error ? err.message : String(err),
      ...(packageName ? { packageName } : {}),
      hints: [],
    });
  }

  private clearSkip(pluginName: string): void {
    this.skipped.delete(skipKey(pluginName));
  }
}

function skipKey(pluginName: string): string {
  return pluginName;
}

/** The contribution categories a loaded plugin actually registered, in a
 *  stable order — lets a UI group plugins by kind (tabs in the picker). */
function contributionKinds(r: LoadedRecord): ReadonlyArray<string> {
  const kinds: string[] = [];
  if (r.providerNames.length) kinds.push('provider');
  if (r.modeNames.length) kinds.push('mode');
  if (r.channelNames.length) kinds.push('channel');
  if (r.surfaceNames.length) kinds.push('surface');
  if (r.embedderNames.length) kinds.push('embedder');
  if (r.transcriberNames.length) kinds.push('transcriber');
  if (r.synthesizerNames.length) kinds.push('synthesizer');
  if (r.isolatorNames.length) kinds.push('isolator');
  if (r.compactorNames.length) kinds.push('compactor');
  if (r.cacheStrategyNames.length) kinds.push('cacheStrategy');
  if (r.viewRendererNames.length) kinds.push('viewRenderer');
  if (r.tunnelProviderNames.length) kinds.push('tunnelProvider');
  if (r.workflowExecutorNames.length) kinds.push('workflowExecutor');
  if (r.agentNames.length) kinds.push('agent');
  if (r.commandNames.length) kinds.push('command');
  if (r.toolNames.length) kinds.push('tool');
  return kinds;
}
