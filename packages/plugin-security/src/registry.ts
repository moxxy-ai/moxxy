import type { Isolator } from '@moxxy/sdk';
import { noneIsolator } from './isolators/none.js';
import { inprocIsolator } from './isolators/inproc.js';

/**
 * Closed registry of available `Isolator` impls. Phase 1 keeps it
 * private to the plugin; future packages (e.g. `@moxxy/isolator-worker`)
 * register via `buildSecurityPlugin({ isolators: [...] })`.
 */
export class IsolatorRegistry {
  private readonly impls = new Map<string, Isolator>();

  constructor(extras: ReadonlyArray<Isolator> = []) {
    this.register(noneIsolator);
    this.register(inprocIsolator);
    for (const iso of extras) this.register(iso);
  }

  register(iso: Isolator): void {
    this.impls.set(iso.name, iso);
  }

  get(name: string): Isolator | undefined {
    return this.impls.get(name);
  }

  list(): ReadonlyArray<Isolator> {
    return [...this.impls.values()];
  }
}
