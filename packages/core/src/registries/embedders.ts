import type { EmbedderDef, EmbeddingProvider } from '@moxxy/sdk';

/**
 * Registry of text-embedding backends. Mirrors `TranscriberRegistry`:
 *   - plugins call `register(def)` at load time (via `PluginSpec.embedders`)
 *   - the host/CLI calls `setActive(name, config)` once an embedder is chosen
 *   - @moxxy/plugin-memory reads `getActive()` / `tryGetActive()` for recall
 *
 * At most one embedder is active at a time. `createClient` is called lazily on
 * first activation, so a registered-but-unselected embedder (e.g. the heavy
 * transformers one) never instantiates its runtime.
 */
export class EmbedderRegistry {
  private readonly defs = new Map<string, EmbedderDef>();
  private readonly instances = new Map<string, EmbeddingProvider>();
  private active: string | null = null;

  register(def: EmbedderDef, instance?: EmbeddingProvider): void {
    if (this.defs.has(def.name)) {
      throw new Error(`Embedder already registered: ${def.name}`);
    }
    this.defs.set(def.name, def);
    if (instance) this.instances.set(def.name, instance);
  }

  replace(def: EmbedderDef, instance?: EmbeddingProvider): void {
    this.defs.set(def.name, def);
    this.instances.delete(def.name);
    if (instance) this.instances.set(def.name, instance);
  }

  unregister(name: string): void {
    this.defs.delete(name);
    this.instances.delete(name);
    if (this.active === name) this.active = null;
  }

  list(): ReadonlyArray<EmbedderDef> {
    return [...this.defs.values()];
  }

  has(name: string): boolean {
    return this.defs.has(name);
  }

  setActive(name: string, config?: Record<string, unknown>): EmbeddingProvider {
    const def = this.defs.get(name);
    if (!def) throw new Error(`Embedder not registered: ${name}`);
    let instance = this.instances.get(name);
    if (!instance) {
      instance = def.createClient(config ?? {});
      this.instances.set(name, instance);
    }
    this.active = name;
    return instance;
  }

  getActive(): EmbeddingProvider {
    if (!this.active) throw new Error('No active embedder. Call setActive(name) first.');
    const inst = this.instances.get(this.active);
    if (!inst) throw new Error(`Active embedder has no instance: ${this.active}`);
    return inst;
  }

  /** Active embedder, or null when none is configured. Lets memory degrade to keyword recall. */
  tryGetActive(): EmbeddingProvider | null {
    if (!this.active) return null;
    return this.instances.get(this.active) ?? null;
  }

  getActiveName(): string | null {
    return this.active;
  }
}
