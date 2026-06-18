/**
 * Shared base for the "single active def, no built instance" registries
 * (compactors, cache strategies, view renderers, tunnel providers, workflow
 * executors). Each is a `Map<name, def>` with at most one *active* def at a
 * time:
 *   - plugins call `register(def)` at load time (throws on duplicate)
 *   - the first registration auto-activates (when `autoAdoptFirst`, the
 *     default), so a session always has a default once a plugin loads one
 *   - the host / agent calls `setActive(name)` to switch
 *   - call sites read `getActive()` (returns null when nothing is active)
 *   - `unregister` clears the active slot rather than silently picking an
 *     arbitrary successor — callers must `setActive()` again
 *
 * This is the def-only sibling of {@link ActiveBackendRegistry} (which also
 * builds runtime *instances* for STT/TTS/embeddings). The two families share
 * the same surface (register/replace/unregister/list/has/setActive/getActive/
 * getActiveName/clearActive) so they stay consistent.
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

export class ActiveDefRegistry<TDef extends { name: string }> {
  private readonly defs = new Map<string, TDef>();
  private active: string | null = null;
  private readonly noun: string;
  private readonly autoAdoptFirst: boolean;

  constructor(opts: ActiveDefRegistryOptions) {
    this.noun = opts.noun;
    this.autoAdoptFirst = opts.autoAdoptFirst ?? true;
  }

  /**
   * Register a def. Throws on duplicate — use `replace()` to overwrite.
   * Auto-activates the first registration (when `autoAdoptFirst`).
   */
  register(def: TDef): void {
    if (this.defs.has(def.name)) {
      throw new Error(`${this.noun} already registered: ${def.name}`);
    }
    this.defs.set(def.name, def);
    if (this.autoAdoptFirst && !this.active) this.active = def.name;
  }

  /** Overwrite an existing def (or add a new one) without throwing.
   *  Auto-activates when nothing is active yet (mirrors `register`). */
  replace(def: TDef): void {
    this.defs.set(def.name, def);
    if (this.autoAdoptFirst && !this.active) this.active = def.name;
  }

  /**
   * Remove a def. If it was active, the active slot is cleared (callers must
   * `setActive()` rather than getting an arbitrary "next").
   */
  unregister(name: string): void {
    this.defs.delete(name);
    if (this.active === name) this.active = null;
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

  /** Deactivate the current def (callers fall back to their default). */
  clearActive(): void {
    this.active = null;
  }

  getActive(): TDef | null {
    if (!this.active) return null;
    return this.defs.get(this.active) ?? null;
  }

  getActiveName(): string | null {
    return this.active;
  }
}
