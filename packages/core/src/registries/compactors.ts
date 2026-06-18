import type { CompactorDef } from '@moxxy/sdk';
import { ActiveDefRegistry } from './active-def-registry.js';

/**
 * One active compaction strategy per session. Register throws on duplicate
 * (use `replace()` to overwrite) and auto-activates the first registration;
 * `unregister` clears the active slot rather than picking an arbitrary
 * successor. See {@link ActiveDefRegistry}.
 */
export class CompactorRegistry extends ActiveDefRegistry<CompactorDef> {
  constructor() {
    super({ noun: 'Compactor' });
  }
}
