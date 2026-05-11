import type { LLMProvider, ProviderDef } from '@moxxy/sdk';

export class ProviderRegistry {
  private readonly defs = new Map<string, ProviderDef>();
  private readonly instances = new Map<string, LLMProvider>();
  private active: string | null = null;

  register(def: ProviderDef, instance?: LLMProvider): void {
    this.defs.set(def.name, def);
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

  setActive(name: string, config?: Record<string, unknown>): LLMProvider {
    const def = this.defs.get(name);
    if (!def) throw new Error(`Provider not registered: ${name}`);
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
