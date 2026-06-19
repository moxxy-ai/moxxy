import type {
  ChannelAvailability,
  ChannelDef,
  ChannelFactoryDeps,
  ChannelRegistry,
} from '@moxxy/sdk';
import { DefMapRegistry } from './def-map-registry.js';

/** Upper bound on a single channel availability probe. `isAvailable` hooks can
 *  do network/process probes (tunnel reachability, binary presence); a hung one
 *  (dead socket, no DNS) must not block the whole listing — which typically
 *  backs a UI picker — indefinitely. */
const AVAILABILITY_PROBE_TIMEOUT_MS = 4_000;

/**
 * Flat name→def registry of channels ({@link DefMapRegistry}) plus
 * `listWithAvailability`, which pairs each channel with its current
 * availability (treating channels without an `isAvailable` hook as
 * `{ ok: true }` and mapping a thrown OR timed-out probe to `{ ok: false }`).
 */
export class ChannelRegistryImpl extends DefMapRegistry<ChannelDef> implements ChannelRegistry {
  constructor() {
    super({ noun: 'Channel', keyOf: (def) => def.name });
  }

  async listWithAvailability(
    deps: ChannelFactoryDeps,
  ): Promise<ReadonlyArray<{ def: ChannelDef; availability: ChannelAvailability }>> {
    // Probe in parallel — a serial loop meant one slow probe also starved every
    // fast probe queued behind it — and bound each probe with a timeout so a
    // single hung channel can't wedge the whole listing.
    return Promise.all(
      [...this.defs.values()].map(async (def) => ({
        def,
        availability: await this.probe(def, deps),
      })),
    );
  }

  private async probe(def: ChannelDef, deps: ChannelFactoryDeps): Promise<ChannelAvailability> {
    if (!def.isAvailable) return { ok: true };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<ChannelAvailability>((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false, reason: 'availability check timed out' }),
          AVAILABILITY_PROBE_TIMEOUT_MS,
        );
      });
      return await Promise.race([Promise.resolve(def.isAvailable(deps)), timeout]);
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
