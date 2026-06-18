import type {
  ChannelAvailability,
  ChannelDef,
  ChannelFactoryDeps,
  ChannelRegistry,
} from '@moxxy/sdk';
import { DefMapRegistry } from './def-map-registry.js';

/**
 * Flat name→def registry of channels ({@link DefMapRegistry}) plus
 * `listWithAvailability`, which pairs each channel with its current
 * availability (treating channels without an `isAvailable` hook as
 * `{ ok: true }` and mapping a thrown probe to `{ ok: false }`).
 */
export class ChannelRegistryImpl extends DefMapRegistry<ChannelDef> implements ChannelRegistry {
  constructor() {
    super({ noun: 'Channel', keyOf: (def) => def.name });
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
