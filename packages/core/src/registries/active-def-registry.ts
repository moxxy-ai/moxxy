/**
 * Shared base for the "single active def, no built instance" registries
 * (compactors, cache strategies, view renderers, tunnel providers, workflow
 * executors). Each is a `Map<name, def>` with at most one *active* def at a
 * time:
 *   - plugins call `register(def)` at load time (throws on duplicate)
 *   - the first registration auto-activates (when `autoAdoptFirst`, the
 *     default), so a session always has a default once a plugin loads one
 *   - the host / agent calls `setActive(name)` to switch
 *   - call sites read `getActive()` (returns the protected floor, else null,
 *     when nothing is explicitly active)
 *   - `unregister` reverts the active slot to the protected floor (if one was
 *     seeded) rather than going null — so a non-nullable slot is never left
 *     empty by removing a swap target — and otherwise clears it (callers must
 *     `setActive()` again)
 *
 * ## Protected floor ("swap, don't break")
 *
 * Core seeds a non-nullable kind's built-in default with `{ protected: true }`,
 * recording it as the registry's **floor**. The floor is the safety net behind
 * the unified `plugins:` manifest: a user may *swap* the active def to any other
 * registered one, but disabling/removing the swap target reverts to the floor
 * instead of bricking the slot, and the floor itself cannot be unregistered.
 * `getActive()`/`getActiveName()` fall back to the floor whenever nothing is
 * explicitly active. Floors are core-seeded (never plugin-contributed), so a
 * plugin's `unload` never tries to unregister a floor name.
 *
 * This is the def-only sibling of {@link ActiveBackendRegistry} (which also
 * builds runtime *instances* for STT/TTS/embeddings). The two families share
 * the same surface (register/replace/unregister/list/has/setActive/getActive/
 * getActiveName/getFloorName/clearActive) so they stay consistent.
 *
 * `ModeRegistry` (change-listeners + legacy-name migration) and
 * `ProviderRegistry` (disabled-set + built instances) deliberately stay
 * bespoke rather than extend this base.
 */
export interface ActiveDefRegistryOptions {
  /** Capitalised singular noun for error messages, e.g. `'Compactor'`. */
  readonly noun: string;
  /** Adopt the first registered def as active when nothing is active yet.
   *  Defaults to `true`. */
  readonly autoAdoptFirst?: boolean;
}

/** Options for a single registration. */
export interface RegisterOptions {
  /**
   * Mark this def as the registry's protected **floor** — the built-in default
   * a non-nullable slot reverts to when its active swap target is removed, and
   * which itself cannot be unregistered. Core seeds floors at construction; do
   * not pass this from discovered plugins.
   */
  readonly protected?: boolean;
}

export class ActiveDefRegistry<TDef extends { name: string }> {
  private readonly defs = new Map<string, TDef>();
  private active: string | null = null;
  /** Name of the protected floor def, or null when this kind is nullable. */
  private floor: string | null = null;
  private readonly noun: string;
  private readonly autoAdoptFirst: boolean;

  constructor(opts: ActiveDefRegistryOptions) {
    this.noun = opts.noun;
    this.autoAdoptFirst = opts.autoAdoptFirst ?? true;
  }

  /**
   * Register a def. Throws on duplicate — use `replace()` to overwrite.
   * Auto-activates the first registration (when `autoAdoptFirst`).
   * Pass `{ protected: true }` to record it as the floor (§ protected floor).
   */
  register(def: TDef, opts?: RegisterOptions): void {
    if (this.defs.has(def.name)) {
      throw new Error(`${this.noun} already registered: ${def.name}`);
    }
    this.defs.set(def.name, def);
    if (opts?.protected) this.floor = def.name;
    if (this.autoAdoptFirst && !this.active) this.active = def.name;
  }

  /** Overwrite an existing def (or add a new one) without throwing.
   *  Auto-activates when nothing is active yet (mirrors `register`). */
  replace(def: TDef, opts?: RegisterOptions): void {
    this.defs.set(def.name, def);
    if (opts?.protected) this.floor = def.name;
    if (this.autoAdoptFirst && !this.active) this.active = def.name;
  }

  /**
   * Remove a def. The protected floor cannot be removed (throws). If the
   * removed def was active, the active slot reverts to the floor when one is
   * present (so a non-nullable slot is never left empty), otherwise clears.
   */
  unregister(name: string): void {
    if (name === this.floor) {
      throw new Error(
        `${this.noun} '${name}' is a protected default and cannot be removed — swap the default instead`,
      );
    }
    this.defs.delete(name);
    if (this.active === name) {
      this.active = this.floor && this.defs.has(this.floor) ? this.floor : null;
    }
  }

  list(): ReadonlyArray<TDef> {
    return [...this.defs.values()];
  }

  has(name: string): boolean {
    return this.defs.has(name);
  }

  setActive(name: string): void {
    const def = this.defs.get(name);
    if (!def) throw new Error(`${this.noun} not registered: ${name}`);
    this.active = def.name;
  }

  /** Deactivate the current explicit def; falls back to the floor (if any). */
  clearActive(): void {
    this.active = null;
  }

  /**
   * Designate an already-registered def as the protected floor. Used when the
   * built-in default is contributed by a kernel *plugin* (e.g. compactor
   * `summarize`, cacheStrategy `stable-prefix`) rather than core-seeded — setup
   * calls this after the kernel plugin registers. Throws if `name` is unknown.
   */
  markFloor(name: string): void {
    if (!this.defs.has(name)) {
      throw new Error(`${this.noun} not registered: ${name}`);
    }
    this.floor = name;
  }

  /** Name of the protected floor def, or null when this kind has no floor. */
  getFloorName(): string | null {
    return this.floor;
  }

  getActive(): TDef | null {
    const name = this.active ?? this.floor;
    if (!name) return null;
    return this.defs.get(name) ?? null;
  }

  getActiveName(): string | null {
    return this.active ?? this.floor;
  }
}
