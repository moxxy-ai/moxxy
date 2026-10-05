import type { ToolRegistry } from './mode.js';
import type { ToolDef } from './tool.js';

const offeredIn = (tool: ToolDef | undefined, mode: string): boolean => !tool?.modes || tool.modes.includes(mode);

/**
 * The registry as a mode sees it: a tool that names its modes is left out of
 * the others — not offered to the model, and refused if called anyway. It stays
 * registered, so its permission and isolation are looked up as before.
 */
export function toolsForMode(tools: ToolRegistry, mode: string): ToolRegistry {
  return {
    list: () => tools.list().filter((tool) => offeredIn(tool, mode)),
    get: (name) => {
      const tool = tools.get(name);
      return offeredIn(tool, mode) ? tool : undefined;
    },
    execute: async (name, input, signal, opts) => {
      if (!offeredIn(tools.get(name), mode)) throw new Error(`${name} is not available in ${mode} mode`);
      return tools.execute(name, input, signal, opts);
    },
  };
}
