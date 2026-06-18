import type { ViewRendererDef } from '@moxxy/sdk';
import { ActiveDefRegistry } from './active-def-registry.js';

/**
 * One active view-spec renderer per session. Register throws on duplicate,
 * auto-activates the first, and `unregister` clears the active slot rather
 * than picking an arbitrary successor. Core seeds a default renderer so
 * `getActive()` is non-null even with no plugins. See
 * {@link ActiveDefRegistry}.
 */
export class ViewRendererRegistry extends ActiveDefRegistry<ViewRendererDef> {
  constructor() {
    super({ noun: 'View renderer' });
  }
}
