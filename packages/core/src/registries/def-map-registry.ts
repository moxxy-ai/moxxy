/**
 * Shared base for the "flat name→def, no active slot" registries (agents,
 * channels, surfaces). A `Map<key, def>` exposing register (throws on
 * duplicate), replace (overwrite), unregister, list, get and has. The three
 * registries differ only in their noun and key field (`name` vs `kind`),
 * supplied via {@link DefMapRegistryOptions}.
 *
 * `ChannelRegistryImpl` extends this and adds `listWithAvailability`;
 * `SurfaceRegistryImpl` keys on `kind` rather than `name`.
 */
export interface DefMapRegistryOptions<TDef, K> {
  /** Capitalised singular noun for error messages, e.g. `'Agent'`. */
  readonly noun: string;
  /** Extract the map key from a def, e.g. `(d) => d.name` or `(d) => d.kind`. */
  readonly keyOf: (def: TDef) => K;
}

export class DefMapRegistry<TDef, K = string> {
  protected readonly defs = new Map<K, TDef>();
  private readonly noun: string;
  private readonly keyOf: (def: TDef) => K;

  constructor(opts: DefMapRegistryOptions<TDef, K>) {
    this.noun = opts.noun;
    this.keyOf = opts.keyOf;
  }

  /**
   * Register a definition. Throws on duplicate so two plugins can't silently
   * shadow each other — use `replace()` when you really want to override.
   */
  register(def: TDef): void {
    const key = this.keyOf(def);
    if (this.defs.has(key)) {
      throw new Error(`${this.noun} already registered: ${String(key)}`);
    }
    this.defs.set(key, def);
  }

  replace(def: TDef): void {
    this.defs.set(this.keyOf(def), def);
  }

  unregister(key: K): void {
    this.defs.delete(key);
  }

  list(): ReadonlyArray<TDef> {
    return [...this.defs.values()];
  }

  get(key: K): TDef | undefined {
    return this.defs.get(key);
  }

  has(key: K): boolean {
    return this.defs.has(key);
  }
}
