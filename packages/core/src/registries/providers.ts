import type { LLMProvider, ProviderDef } from '@moxxy/sdk';

export class ProviderRegistry {
  private readonly defs = new Map<string, ProviderDef>();
  private readonly instances = new Map<string, LLMProvider>();
  private active: string | null = null;
  /**
   * Names the user disabled. Kept name-based (not def-based) so it can be
   * seeded from preferences BEFORE the plugins register their defs — boot
   * order doesn't matter. A disabled provider stays registered/listable but
   * can't be activated.
   */
  private readonly disabled = new Set<string>();

  /**
   * Register a provider def. Throws on duplicate — use `replace()` for
   * explicit overwrite. Matches the semantics of `tools` and `channels`.
   */
  register(def: ProviderDef, instance?: LLMProvider): void {
    if (this.defs.has(def.name)) {
      throw new Error(`Provider already registered: ${def.name}`);
    }
    this.defs.set(def.name, def);
    if (instance) this.instances.set(def.name, instance);
  }

  /**
   * Overwrite an existing def (also drops the cached instance so the new
   * createClient gets called).
   *
   * Invariant: replacing the ACTIVE provider's def leaves `active` pointing at
   * it but with no cached instance, so `getActive()` throws until the caller
   * rebuilds the instance. Callers replacing the active provider MUST follow
   * with `setActive(name, config)` (replace can't rebuild itself — it has no
   * config). The sole production caller does exactly that.
   */
  replace(def: ProviderDef, instance?: LLMProvider): void {
    this.defs.set(def.name, def);
    this.instances.delete(def.name);
    if (instance) this.instances.set(def.name, instance);
  }

  unregister(name: string): void {
    this.defs.delete(name);
    this.instances.delete(name);
    if (this.active === name) this.active = null;
  }

  list(): ReadonlyArray<ProviderDef> {
    return [...this.defs.values()];
  }

  /**
   * Enable/disable a provider by name. Disabling the ACTIVE provider is
   * refused — switch first, then disable — so a session never ends up with an
   * active-but-disabled provider. Unknown names are accepted (the set seeds
   * from preferences before plugins register), except when disabling via a
   * live toggle is meaningless because the provider is active.
   */
  setEnabled(name: string, enabled: boolean): void {
    if (!enabled && this.active === name) {
      throw new Error(`Cannot disable the active provider "${name}" — switch providers first.`);
    }
    if (enabled) this.disabled.delete(name);
    else this.disabled.add(name);
  }

  isEnabled(name: string): boolean {
    return !this.disabled.has(name);
  }

  setActive(name: string, config?: Record<string, unknown>): LLMProvider {
    const def = this.defs.get(name);
    if (!def) throw new Error(`Provider not registered: ${name}`);
    if (this.disabled.has(name)) {
      throw new Error(`Provider "${name}" is disabled — enable it first.`);
    }
    let instance = this.instances.get(name);
    if (!instance) {
      instance = def.createClient(config ?? {});
      this.instances.set(name, instance);
    }
    this.active = name;
    return instance;
  }

  getActive(): LLMProvider {
    if (!this.active) throw new Error('No active provider. Call setActive(name) first.');
    const inst = this.instances.get(this.active);
    if (!inst) throw new Error(`Active provider has no instance: ${this.active}`);
    return inst;
  }

  getActiveName(): string | null {
    return this.active;
  }
}
