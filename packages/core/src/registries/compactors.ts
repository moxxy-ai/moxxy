import type { CompactorDef } from '@moxxy/sdk';

export class CompactorRegistry {
  private readonly compactors = new Map<string, CompactorDef>();
  private active: string | null = null;

  register(c: CompactorDef): void {
    this.compactors.set(c.name, c);
    if (!this.active) this.active = c.name;
  }

  unregister(name: string): void {
    this.compactors.delete(name);
    if (this.active === name) this.active = this.compactors.keys().next().value ?? null;
  }

  list(): ReadonlyArray<CompactorDef> {
    return [...this.compactors.values()];
  }

  setActive(name: string): void {
    if (!this.compactors.has(name)) throw new Error(`Compactor not registered: ${name}`);
    this.active = name;
  }

  getActive(): CompactorDef | null {
    if (!this.active) return null;
    return this.compactors.get(this.active) ?? null;
  }
}
