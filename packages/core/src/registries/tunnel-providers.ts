import type { TunnelProviderDef } from '@moxxy/sdk';

/**
 * One active tunnel provider per session. Mirrors {@link ViewRendererRegistry}:
 * register throws on duplicate, auto-activates the first, `unregister` clears
 * the active slot. Core seeds the `localhost` provider so `getActive()` is
 * non-null even when no tunnel plugin is installed.
 */
export class TunnelProviderRegistry {
  private readonly providers = new Map<string, TunnelProviderDef>();
  private active: string | null = null;

  register(p: TunnelProviderDef): void {
    if (this.providers.has(p.name)) {
      throw new Error(`Tunnel provider already registered: ${p.name}`);
    }
    this.providers.set(p.name, p);
    if (!this.active) this.active = p.name;
  }

  replace(p: TunnelProviderDef): void {
    this.providers.set(p.name, p);
    if (!this.active) this.active = p.name;
  }

  unregister(name: string): void {
    this.providers.delete(name);
    if (this.active === name) this.active = null;
  }

  list(): ReadonlyArray<TunnelProviderDef> {
    return [...this.providers.values()];
  }

  setActive(name: string): void {
    const provider = this.providers.get(name);
    if (!provider) throw new Error(`Tunnel provider not registered: ${name}`);
    this.active = provider.name;
  }

  getActive(): TunnelProviderDef | null {
    if (!this.active) return null;
    return this.providers.get(this.active) ?? null;
  }
}
