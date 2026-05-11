import type { LoopStrategyDef } from '@moxxy/sdk';

export class LoopRegistry {
  private readonly strategies = new Map<string, LoopStrategyDef>();
  private active: string | null = null;

  register(strategy: LoopStrategyDef): void {
    this.strategies.set(strategy.name, strategy);
    if (!this.active) this.active = strategy.name;
  }

  unregister(name: string): void {
    this.strategies.delete(name);
    if (this.active === name) this.active = this.strategies.keys().next().value ?? null;
  }

  list(): ReadonlyArray<LoopStrategyDef> {
    return [...this.strategies.values()];
  }

  setActive(name: string): void {
    if (!this.strategies.has(name)) throw new Error(`Loop strategy not registered: ${name}`);
    this.active = name;
  }

  getActive(): LoopStrategyDef {
    if (!this.active) throw new Error('No active loop strategy registered.');
    const s = this.strategies.get(this.active);
    if (!s) throw new Error(`Active loop strategy missing: ${this.active}`);
    return s;
  }
}
