import { registerRenderablePlugin } from '@moxxy/client-core';
import { MODE_PLUGIN_IDS } from './mode-events';

/** Ask the chat store to keep what the plan, goal and research modes report. Call once at boot. */
export function registerModeEvents(): void {
  for (const pluginId of MODE_PLUGIN_IDS) registerRenderablePlugin(pluginId);
}
