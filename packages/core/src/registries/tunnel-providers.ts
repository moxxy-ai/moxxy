import type { TunnelProviderDef } from '@moxxy/sdk';
import { ActiveDefRegistry } from './active-def-registry.js';

/**
 * One active tunnel provider per session. Register throws on duplicate,
 * auto-activates the first, and `unregister` clears the active slot. Core
 * seeds the `localhost` provider so `getActive()` is non-null even when no
 * tunnel plugin is installed. See {@link ActiveDefRegistry}.
 */
export class TunnelProviderRegistry extends ActiveDefRegistry<TunnelProviderDef> {
  constructor() {
    super({ noun: 'Tunnel provider' });
  }
}
