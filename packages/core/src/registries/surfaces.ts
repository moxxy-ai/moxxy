import type { SurfaceDef, SurfaceKind, SurfaceRegistry } from '@moxxy/sdk';
import { DefMapRegistry } from './def-map-registry.js';

/**
 * Registry of surface defs contributed by plugins (terminal, browser, …),
 * keyed by `kind`. A flat name→def map ({@link DefMapRegistry}) with
 * register/unregister so the PluginHost can add and remove a plugin's
 * surfaces on load/unload. The live, open instances are managed separately by
 * the {@link SurfaceHostImpl}; this registry only knows the available kinds.
 */
export class SurfaceRegistryImpl
  extends DefMapRegistry<SurfaceDef, SurfaceKind>
  implements SurfaceRegistry
{
  constructor() {
    super({ noun: 'Surface', keyOf: (def) => def.kind });
  }
}
