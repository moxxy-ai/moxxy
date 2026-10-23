import type { AgentActivity, AgentTurnStart, LLMProvider, ProviderDef } from '@moxxy/sdk';

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
  private readonly agentTurnListeners = new Set<(start: AgentTurnStart) => void>();
  private readonly activityListeners = new Set<(activity: AgentActivity) => void>();
  private readonly activeListeners = new Set<(name: string) => void>();
  /** Per provider name: the unsubscribe from its instance's `onAgentTurn` and `onAgentActivity`. */
  private readonly agentTurnWatches = new Map<string, () => void>();

  /**
   * Register a provider def. Throws on duplicate — use `replace()` for
   * explicit overwrite. Matches the semantics of `tools` and `channels`.
   */
  register(def: ProviderDef, instance?: LLMProvider): void {
    if (this.defs.has(def.name)) {
      throw new Error(`Provider already registered: ${def.name}`);
    }
    this.defs.set(def.name, def);
    if (instance) this.keep(def.name, instance);
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
    this.drop(def.name);
    if (instance) this.keep(def.name, instance);
  }

  unregister(name: string): void {
    this.defs.delete(name);
    this.drop(name);
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

  /**
   * Activate a provider, building its client on first activation. NOTE: once an
   * instance is cached, a later `setActive(name, newConfig)` REUSES the cached
   * instance and DROPS `newConfig` — re-config requires `replace()` first
   * (which clears the cache), the flow the sole production caller follows.
   * Reconfiguring by rebuilding here is intentionally avoided so callers don't
   * silently lose instance identity / in-flight state on a redundant activate.
   */
  setActive(name: string, config?: Record<string, unknown>): LLMProvider {
    const def = this.defs.get(name);
    if (!def) throw new Error(`Provider not registered: ${name}`);
    if (this.disabled.has(name)) {
      throw new Error(`Provider "${name}" is disabled — enable it first.`);
    }
    let instance = this.instances.get(name);
    if (!instance) {
      instance = def.createClient(config ?? {});
      this.keep(name, instance);
    }
    const changed = this.active !== name;
    this.active = name;
    if (changed) for (const listener of [...this.activeListeners]) listener(name);
    return instance;
  }

  /** The active provider changed to `name`. Returns the unsubscribe. */
  onActiveChange(listener: (name: string) => void): () => void {
    this.activeListeners.add(listener);
    return () => this.activeListeners.delete(listener);
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

  /** A turn the active provider's agent started by itself (see `LLMProvider.onAgentTurn`). Returns the unsubscribe. */
  onAgentTurn(listener: (start: AgentTurnStart) => void): () => void {
    this.agentTurnListeners.add(listener);
    return () => this.agentTurnListeners.delete(listener);
  }

  /** What the active provider's agent did in the background between turns (see `LLMProvider.onAgentActivity`). Returns the unsubscribe. */
  onAgentActivity(listener: (activity: AgentActivity) => void): () => void {
    this.activityListeners.add(listener);
    return () => this.activityListeners.delete(listener);
  }

  private keep(name: string, instance: LLMProvider): void {
    this.drop(name);
    this.instances.set(name, instance);
    // Only the active agent speaks for the conversation: one switched away from stays quiet.
    const speaks = () => this.active === name && this.instances.get(name) === instance;
    const unsubscribes = [
      instance.onAgentTurn?.((start) => {
        if (speaks()) for (const listener of [...this.agentTurnListeners]) listener(start);
      }),
      instance.onAgentActivity?.((activity) => {
        if (speaks()) for (const listener of [...this.activityListeners]) listener(activity);
      }),
    ].filter((unsubscribe) => unsubscribe !== undefined);
    if (unsubscribes.length > 0) this.agentTurnWatches.set(name, () => unsubscribes.forEach((unsubscribe) => unsubscribe()));
  }

  private drop(name: string): void {
    this.instances.delete(name);
    const unsubscribe = this.agentTurnWatches.get(name);
    if (unsubscribe) unsubscribe();
    this.agentTurnWatches.delete(name);
  }
}
