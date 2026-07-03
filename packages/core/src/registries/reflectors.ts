import type { ReflectorDef } from '@moxxy/sdk';
import { ActiveDefRegistry } from './active-def-registry.js';

/**
 * The single-active Reflector registry (the learning-loop block that watches a
 * finished turn and proposes memory/skill improvements). NULLABLE by design:
 * unlike the event-store/compactor registries there is NO core-seeded protected
 * floor, so `getActive()` returns null until a plugin registers one — reflection
 * is opt-in exactly like transcriber/synthesizer. `autoAdoptFirst` (the default)
 * means the first registered reflector becomes active, and `unregister` reverts
 * to null (no floor to fall back to). Uses throw-on-duplicate `register`.
 */
export class ReflectorRegistry extends ActiveDefRegistry<ReflectorDef> {
  constructor() {
    super({ noun: 'Reflector', autoAdoptFirst: true });
  }
}
