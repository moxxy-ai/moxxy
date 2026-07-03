import type {
  AgentDef,
  CacheStrategyDef,
  ChannelDef,
  CommandDef,
  CompactorDef,
  ModeDef,
  Plugin,
  ProviderDef,
  SurfaceDef,
  ToolDef,
  TranscriberDef,
  SynthesizerDef,
  EmbedderDef,
  Isolator,
  ViewRendererDef,
  TunnelProviderDef,
  WorkflowExecutorDef,
  EventStoreDef,
  ReflectorDef,
} from '@moxxy/sdk';
import type { PluginHostOptions } from './host-options.js';

/**
 * The per-registry record of the names a loaded plugin contributed. Keyed by
 * the {@link LoadedRecord} field each kind writes to. PluginHost stores one
 * `LoadedRecord` per loaded plugin so `unload` knows exactly which names to
 * unregister from each registry.
 */
export interface RegistryNameRecord {
  readonly toolNames: ReadonlyArray<string>;
  readonly providerNames: ReadonlyArray<string>;
  readonly modeNames: ReadonlyArray<string>;
  readonly compactorNames: ReadonlyArray<string>;
  readonly cacheStrategyNames: ReadonlyArray<string>;
  readonly viewRendererNames: ReadonlyArray<string>;
  readonly tunnelProviderNames: ReadonlyArray<string>;
  readonly channelNames: ReadonlyArray<string>;
  readonly surfaceNames: ReadonlyArray<string>;
  readonly agentNames: ReadonlyArray<string>;
  readonly commandNames: ReadonlyArray<string>;
  readonly transcriberNames: ReadonlyArray<string>;
  readonly synthesizerNames: ReadonlyArray<string>;
  readonly embedderNames: ReadonlyArray<string>;
  readonly isolatorNames: ReadonlyArray<string>;
  readonly workflowExecutorNames: ReadonlyArray<string>;
  readonly eventStoreNames: ReadonlyArray<string>;
  readonly reflectorNames: ReadonlyArray<string>;
}

/**
 * A single contribution kind, mapping a plugin field + registry to the
 * register / unregister / name-extraction operations PluginHost performs for
 * it. Driving register and unregister from this one table keeps the two sides
 * in lockstep — adding a registry kind is one entry, not edits to two parallel
 * 16-line lists.
 *
 * `TDef` is the contribution def type for this kind. The table is declared with
 * heterogeneous defs, so it is widened to `RegistryKind<any>` for iteration;
 * each entry's closures stay individually type-checked against their own def.
 */
export interface RegistryKind<TDef> {
  /** Stable identifier for the kind (used by tests/diagnostics). */
  readonly kind: string;
  /** {@link RegistryNameRecord} field this kind writes its names to. */
  readonly recordField: keyof RegistryNameRecord;
  /** The defs this plugin contributes for this kind. */
  readonly defs: (plugin: Plugin) => ReadonlyArray<TDef>;
  /** Extract the registry key from a def (mostly `.name`; surfaces use `.kind`). */
  readonly nameOf: (def: TDef) => string;
  /**
   * Register a single def into its registry (uses `register` or `replace`).
   * `trusted` is true for statically-registered builtins and false for
   * discovered (untrusted) plugins; most kinds ignore it, but the isolator
   * registry uses it to refuse letting a discovered plugin shadow a builtin.
   *
   * Returns `false` when the registration was REFUSED without taking effect
   * (currently only the isolator registry, when an untrusted plugin tries to
   * shadow a trusted name). PluginHost must NOT track a refused registration
   * for rollback — unregistering it on a later mid-`applyPlugin` failure would
   * delete a name this plugin never actually owned. `void`/`true` means applied.
   */
  readonly register: (opts: PluginHostOptions, def: TDef, trusted: boolean) => void | boolean;
  /** Remove a previously-registered name from its registry. */
  readonly unregister: (opts: PluginHostOptions, name: string) => void;
  /**
   * True when `register` is an override (`replace`) rather than a throw-on-
   * duplicate insert. Such kinds are last-wins and may clobber a name seeded by
   * core or another plugin, so PluginHost must NOT roll them back when a later
   * kind throws mid-`applyPlugin` (unregistering would delete a def this plugin
   * didn't actually own).
   */
  readonly overrideOnRegister?: boolean;
}

/**
 * The authoritative ordered list of contribution kinds. The ORDER here is the
 * exact register order `applyPlugin` used and the exact unregister order
 * `unload` used; preserve it when editing.
 */
export const REGISTRY_KINDS: ReadonlyArray<RegistryKind<unknown>> = [
  {
    kind: 'tool',
    recordField: 'toolNames',
    defs: (p) => p.tools ?? [],
    nameOf: (t: ToolDef) => t.name,
    register: (o, t: ToolDef) => o.tools.register(t),
    unregister: (o, n) => o.tools.unregister(n),
  } satisfies RegistryKind<ToolDef>,
  {
    kind: 'provider',
    recordField: 'providerNames',
    defs: (p) => p.providers ?? [],
    nameOf: (d: ProviderDef) => d.name,
    register: (o, d: ProviderDef) => o.providers.register(d),
    unregister: (o, n) => o.providers.unregister(n),
  } satisfies RegistryKind<ProviderDef>,
  {
    kind: 'mode',
    recordField: 'modeNames',
    defs: (p) => p.modes ?? [],
    nameOf: (m: ModeDef) => m.name,
    register: (o, m: ModeDef) => o.modes.register(m),
    unregister: (o, n) => o.modes.unregister(n),
  } satisfies RegistryKind<ModeDef>,
  {
    kind: 'compactor',
    recordField: 'compactorNames',
    defs: (p) => p.compactors ?? [],
    nameOf: (c: CompactorDef) => c.name,
    register: (o, c: CompactorDef) => o.compactors.register(c),
    unregister: (o, n) => o.compactors.unregister(n),
  } satisfies RegistryKind<CompactorDef>,
  {
    kind: 'cacheStrategy',
    recordField: 'cacheStrategyNames',
    defs: (p) => p.cacheStrategies ?? [],
    nameOf: (c: CacheStrategyDef) => c.name,
    register: (o, c: CacheStrategyDef) => o.cacheStrategies.register(c),
    unregister: (o, n) => o.cacheStrategies.unregister(n),
  } satisfies RegistryKind<CacheStrategyDef>,
  {
    kind: 'viewRenderer',
    recordField: 'viewRendererNames',
    defs: (p) => p.viewRenderers ?? [],
    nameOf: (v: ViewRendererDef) => v.name,
    // viewRenderers use `replace` (override-allowed) on the register side.
    register: (o, v: ViewRendererDef) => o.viewRenderers.replace(v),
    unregister: (o, n) => o.viewRenderers.unregister(n),
    overrideOnRegister: true,
  } satisfies RegistryKind<ViewRendererDef>,
  {
    kind: 'tunnelProvider',
    recordField: 'tunnelProviderNames',
    defs: (p) => p.tunnelProviders ?? [],
    nameOf: (t: TunnelProviderDef) => t.name,
    // tunnelProviders use `replace` (override-allowed) on the register side.
    register: (o, t: TunnelProviderDef) => o.tunnelProviders.replace(t),
    unregister: (o, n) => o.tunnelProviders.unregister(n),
    overrideOnRegister: true,
  } satisfies RegistryKind<TunnelProviderDef>,
  {
    kind: 'channel',
    recordField: 'channelNames',
    defs: (p) => p.channels ?? [],
    nameOf: (c: ChannelDef) => c.name,
    register: (o, c: ChannelDef) => o.channels.register(c),
    unregister: (o, n) => o.channels.unregister(n),
  } satisfies RegistryKind<ChannelDef>,
  {
    kind: 'surface',
    recordField: 'surfaceNames',
    defs: (p) => p.surfaces ?? [],
    // surfaces are keyed by `.kind`, not `.name`.
    nameOf: (s: SurfaceDef) => s.kind,
    register: (o, s: SurfaceDef) => o.surfaces.register(s),
    unregister: (o, n) => o.surfaces.unregister(n),
  } satisfies RegistryKind<SurfaceDef>,
  {
    kind: 'agent',
    recordField: 'agentNames',
    defs: (p) => p.agents ?? [],
    nameOf: (a: AgentDef) => a.name,
    register: (o, a: AgentDef) => o.agents.register(a),
    unregister: (o, n) => o.agents.unregister(n),
  } satisfies RegistryKind<AgentDef>,
  {
    kind: 'command',
    recordField: 'commandNames',
    defs: (p) => p.commands ?? [],
    nameOf: (c: CommandDef) => c.name,
    register: (o, c: CommandDef) => o.commands.register(c),
    unregister: (o, n) => o.commands.unregister(n),
  } satisfies RegistryKind<CommandDef>,
  {
    kind: 'transcriber',
    recordField: 'transcriberNames',
    defs: (p) => p.transcribers ?? [],
    nameOf: (t: TranscriberDef) => t.name,
    register: (o, t: TranscriberDef) => o.transcribers.register(t),
    unregister: (o, n) => o.transcribers.unregister(n),
  } satisfies RegistryKind<TranscriberDef>,
  {
    kind: 'synthesizer',
    recordField: 'synthesizerNames',
    defs: (p) => p.synthesizers ?? [],
    nameOf: (s: SynthesizerDef) => s.name,
    register: (o, s: SynthesizerDef) => o.synthesizers.register(s),
    unregister: (o, n) => o.synthesizers.unregister(n),
  } satisfies RegistryKind<SynthesizerDef>,
  {
    kind: 'embedder',
    recordField: 'embedderNames',
    defs: (p) => p.embedders ?? [],
    nameOf: (e: EmbedderDef) => e.name,
    register: (o, e: EmbedderDef) => o.embedders.register(e),
    unregister: (o, n) => o.embedders.unregister(n),
  } satisfies RegistryKind<EmbedderDef>,
  {
    kind: 'isolator',
    recordField: 'isolatorNames',
    defs: (p) => p.isolators ?? [],
    nameOf: (i: Isolator) => i.name,
    register: (o, i: Isolator, trusted): boolean =>
      o.isolators.register(i, { trusted, logger: o.logger }),
    unregister: (o, n) => o.isolators.unregister(n),
  } satisfies RegistryKind<Isolator>,
  {
    kind: 'workflowExecutor',
    recordField: 'workflowExecutorNames',
    defs: (p) => p.workflowExecutors ?? [],
    nameOf: (w: WorkflowExecutorDef) => w.name,
    register: (o, w: WorkflowExecutorDef) => o.workflowExecutors.register(w),
    unregister: (o, n) => o.workflowExecutors.unregister(n),
  } satisfies RegistryKind<WorkflowExecutorDef>,
  {
    kind: 'eventStore',
    recordField: 'eventStoreNames',
    defs: (p) => p.eventStores ?? [],
    nameOf: (e: EventStoreDef) => e.name,
    // Throw-on-duplicate `register` (NOT `replace`): a discovered plugin's store
    // is added but can't shadow the protected JSONL floor and never auto-
    // activates — the user opts in via `plugins.eventStore.default`. The store
    // sees every event, so that explicit opt-in is the trust boundary.
    register: (o, e: EventStoreDef) => o.eventStores.register(e),
    unregister: (o, n) => o.eventStores.unregister(n),
  } satisfies RegistryKind<EventStoreDef>,
  {
    kind: 'reflector',
    recordField: 'reflectorNames',
    defs: (p) => p.reflectors ?? [],
    nameOf: (r: ReflectorDef) => r.name,
    // Throw-on-duplicate `register` (NOT `replace`): a discovered reflector is
    // added but auto-adopts only when nothing is active yet (the registry is
    // nullable — no core floor). The user swaps via `plugins.reflector.default`.
    register: (o, r: ReflectorDef) => o.reflectors.register(r),
    unregister: (o, n) => o.reflectors.unregister(n),
  } satisfies RegistryKind<ReflectorDef>,
] as ReadonlyArray<RegistryKind<unknown>>;
