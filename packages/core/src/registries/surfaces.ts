import type { SurfaceDef, SurfaceKind, SurfaceRegistry } from '@moxxy/sdk';

/**
 * Registry of surface defs contributed by plugins (terminal, browser, …). Keyed
 * by `kind`. Mirrors {@link ChannelRegistryImpl} — a flat name→def map with
 * register/unregister so the PluginHost can add and remove a plugin's surfaces
 * on load/unload. The live, open instances are managed separately by the
 * {@link SurfaceHostImpl}; this registry only knows the available kinds.
 */
export class SurfaceRegistryImpl implements SurfaceRegistry {
  private readonly defs = new Map<SurfaceKind, SurfaceDef>();

  register(def: SurfaceDef): void {
    if (this.defs.has(def.kind)) {
      throw new Error(`Surface already registered: ${def.kind}`);
    }
    this.defs.set(def.kind, def);
  }

  unregister(kind: SurfaceKind): void {
    this.defs.delete(kind);
  }

  list(): ReadonlyArray<SurfaceDef> {
    return [...this.defs.values()];
  }

  get(kind: SurfaceKind): SurfaceDef | undefined {
    return this.defs.get(kind);
  }

  has(kind: SurfaceKind): boolean {
    return this.defs.has(kind);
  }
}
