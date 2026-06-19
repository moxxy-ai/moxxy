/**
 * Shared base for the "single active backend" registries (speech-to-text,
 * text-to-speech, embeddings). Each one is a Map of named defs with at most one
 * *active* at a time:
 *   - plugins call `register(def)` at load time
 *   - the host / CLI / agent calls `setActive(name, config)` to pick one
 *   - call sites read `getActive()` / `tryGetActive()` to use it (degrading
 *     gracefully when none is active)
 *
 * The three concrete registries differ only along a few axes, expressed via
 * {@link BackendRegistryOptions}:
 *   - how a def becomes an instance (`build`) — `createClient(config)` for
 *     STT/embeddings, `create({ config, getSecret })` for TTS
 *   - whether the first registered def auto-becomes active (`autoAdoptFirst`,
 *     TTS only — STT/embeddings require an explicit `setActive`)
 *   - whether the active instance is (re)built lazily on read (`buildOnRead`,
 *     TTS only — needed because `autoAdoptFirst` can set `active` without ever
 *     building an instance; it also makes `setActive` rebuild when handed a
 *     fresh config)
 *
 * `ProviderRegistry` deliberately stays separate: it is the core LLM path and
 * carries its own ready-state semantics.
 */
export interface BackendRegistryOptions<TDef extends { name: string }, TInstance> {
  /** Capitalised singular noun for error messages, e.g. `'Synthesizer'`. */
  readonly noun: string;
  /** Turn a def + (possibly empty) config into a runtime instance. */
  readonly build: (def: TDef, config: Record<string, unknown>) => TInstance;
  /** Adopt the first registered def as active when nothing is active yet. */
  readonly autoAdoptFirst?: boolean;
  /** (Re)build the active instance lazily on read rather than requiring it to
   *  have been built at `setActive` time. Also makes `setActive` rebuild when a
   *  config is supplied. Pair with {@link autoAdoptFirst}. */
  readonly buildOnRead?: boolean;
}

export class ActiveBackendRegistry<TDef extends { name: string }, TInstance> {
  private readonly defs = new Map<string, TDef>();
  private readonly instances = new Map<string, TInstance>();
  private active: string | null = null;

  constructor(private readonly opts: BackendRegistryOptions<TDef, TInstance>) {}

  register(def: TDef, instance?: TInstance): void {
    if (this.defs.has(def.name)) {
      throw new Error(`${this.opts.noun} already registered: ${def.name}`);
    }
    this.defs.set(def.name, def);
    if (instance) this.instances.set(def.name, instance);
    if (this.opts.autoAdoptFirst && this.active === null) this.active = def.name;
  }

  /** Overwrite an existing def, dropping the cached instance so the next build
   *  uses the new def. */
  replace(def: TDef, instance?: TInstance): void {
    this.defs.set(def.name, def);
    this.instances.delete(def.name);
    if (instance) {
      this.instances.set(def.name, instance);
    } else if (this.active === def.name && !this.opts.buildOnRead) {
      // For a non-buildOnRead registry, getActive() reads the cached instance
      // directly and throws when it's missing. Dropping the active def's cache
      // (e.g. a hot-reloaded plugin re-registering via replace) would otherwise
      // strand getActive() until the next setActive. buildOnRead registries
      // self-heal on read, so they don't need this.
      this.instances.set(def.name, this.buildInstance(def.name));
    }
  }

  unregister(name: string): void {
    this.defs.delete(name);
    this.instances.delete(name);
    if (this.active === name) this.active = null;
  }

  list(): ReadonlyArray<TDef> {
    return [...this.defs.values()];
  }

  has(name: string): boolean {
    return this.defs.has(name);
  }

  setActive(name: string, config?: Record<string, unknown>): TInstance {
    if (!this.defs.has(name)) throw new Error(`${this.opts.noun} not registered: ${name}`);
    if (this.opts.buildOnRead) {
      // Supplying a config (re)builds with it; otherwise reuse / lazily build.
      if (config) this.instances.set(name, this.buildInstance(name, config));
      this.active = name;
      return this.instantiate(name);
    }
    // Build once, on first activation; later activations reuse the cache and
    // ignore `config`.
    let instance = this.instances.get(name);
    if (!instance) {
      instance = this.buildInstance(name, config);
      this.instances.set(name, instance);
    }
    this.active = name;
    return instance;
  }

  /** Deactivate the current backend (callers fall back to their default). */
  clearActive(): void {
    this.active = null;
  }

  getActive(): TInstance {
    if (!this.active) {
      throw new Error(`No active ${this.opts.noun.toLowerCase()}. Call setActive(name) first.`);
    }
    if (this.opts.buildOnRead) return this.instantiate(this.active);
    const inst = this.instances.get(this.active);
    if (!inst) throw new Error(`Active ${this.opts.noun.toLowerCase()} has no instance: ${this.active}`);
    return inst;
  }

  /** Active backend, or null when none is configured. Lets call sites degrade
   *  gracefully (keyword recall, the OS voice, "no transcriber configured"). */
  tryGetActive(): TInstance | null {
    if (!this.active) return null;
    if (this.opts.buildOnRead) {
      try {
        return this.instantiate(this.active);
      } catch {
        return null;
      }
    }
    return this.instances.get(this.active) ?? null;
  }

  getActiveName(): string | null {
    return this.active;
  }

  /** Cached instance for `name`, building it from its def on first use. */
  private instantiate(name: string): TInstance {
    let inst = this.instances.get(name);
    if (!inst) {
      inst = this.buildInstance(name);
      this.instances.set(name, inst);
    }
    return inst;
  }

  private buildInstance(name: string, config?: Record<string, unknown>): TInstance {
    const def = this.defs.get(name);
    if (!def) throw new Error(`${this.opts.noun} not registered: ${name}`);
    return this.opts.build(def, config ?? {});
  }
}
