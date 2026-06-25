import type { ServiceRegistry } from '@moxxy/sdk';

/**
 * In-process inter-plugin service registry (one per Session). A plugin publishes
 * a named service in `onInit`; a sibling plugin resolves it in its own `onInit`.
 * Last-write-wins on a duplicate name (a later plugin may intentionally replace
 * a service); `require` throws when the name was never published.
 */
export class ServiceRegistryImpl implements ServiceRegistry {
  private readonly services = new Map<string, unknown>();

  register<T>(name: string, impl: T): void {
    this.services.set(name, impl);
  }

  get<T>(name: string): T | undefined {
    return this.services.get(name) as T | undefined;
  }

  require<T>(name: string): T {
    if (!this.services.has(name)) {
      throw new Error(
        `Required service not registered: ${name}. The providing plugin's onInit ` +
          'must run first — declare a moxxy.requirements entry on the consumer.',
      );
    }
    return this.services.get(name) as T;
  }

  has(name: string): boolean {
    return this.services.has(name);
  }
}
