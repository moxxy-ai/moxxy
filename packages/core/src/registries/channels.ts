import type {
  ChannelAvailability,
  ChannelDef,
  ChannelFactoryDeps,
  ChannelRegistry,
} from '@moxxy/sdk';

export class ChannelRegistryImpl implements ChannelRegistry {
  private readonly defs = new Map<string, ChannelDef>();

  register(def: ChannelDef): void {
    if (this.defs.has(def.name)) {
      throw new Error(`Channel already registered: ${def.name}`);
    }
    this.defs.set(def.name, def);
  }

  unregister(name: string): void {
    this.defs.delete(name);
  }

  list(): ReadonlyArray<ChannelDef> {
    return [...this.defs.values()];
  }

  get(name: string): ChannelDef | undefined {
    return this.defs.get(name);
  }

  has(name: string): boolean {
    return this.defs.has(name);
  }

  async listWithAvailability(
    deps: ChannelFactoryDeps,
  ): Promise<ReadonlyArray<{ def: ChannelDef; availability: ChannelAvailability }>> {
    const out: Array<{ def: ChannelDef; availability: ChannelAvailability }> = [];
    for (const def of this.defs.values()) {
      let availability: ChannelAvailability;
      if (def.isAvailable) {
        try {
          availability = await def.isAvailable(deps);
        } catch (err) {
          availability = {
            ok: false,
            reason: err instanceof Error ? err.message : String(err),
          };
        }
      } else {
        availability = { ok: true };
      }
      out.push({ def, availability });
    }
    return out;
  }
}
