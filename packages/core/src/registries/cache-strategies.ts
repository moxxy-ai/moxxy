import type { CacheStrategyDef } from '@moxxy/sdk';
import { ActiveDefRegistry } from './active-def-registry.js';

/**
 * One active prompt-caching strategy per session. Register throws on
 * duplicate, auto-activates the first, and `unregister` clears the active
 * slot rather than picking an arbitrary successor. See
 * {@link ActiveDefRegistry}.
 */
export class CacheStrategyRegistry extends ActiveDefRegistry<CacheStrategyDef> {
  constructor() {
    super({ noun: 'Cache strategy' });
  }
}
