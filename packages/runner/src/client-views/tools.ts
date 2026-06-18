import type { ToolsClientView } from '@moxxy/sdk';
import type { ViewContext } from './context.js';
import { fakeTool } from './fakes.js';

export function makeToolsView(ctx: ViewContext): ToolsClientView {
  const { requireInfo } = ctx;
  return {
    list: () => requireInfo().tools.map(fakeTool),
    get: (name) => {
      const info = requireInfo().tools.find((t) => t.name === name);
      return info ? fakeTool(info) : undefined;
    },
  };
}
