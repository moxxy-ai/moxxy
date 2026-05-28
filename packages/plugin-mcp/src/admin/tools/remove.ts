import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import { mutateMcpConfig } from '../config-io.js';
import { serverNameSchema } from '../schema.js';

export interface RemoveServerToolDeps {
  detachServer(name: string): Promise<boolean>;
}

export function buildRemoveServerTool(deps: RemoveServerToolDeps): ToolDef {
  const { detachServer } = deps;
  return defineTool({
    name: 'mcp_remove_server',
    description:
      'Remove an MCP server from ~/.moxxy/mcp.json and detach its tools from the live session. ' +
      'The tools become uncallable immediately and the entry is gone on next restart.',
    inputSchema: z.object({ name: serverNameSchema }),
    permission: { action: 'prompt' },
    handler: async ({ name }) => {
      // Read-modify-write under the shared config mutex so a concurrent
      // add/remove can't clobber the file.
      const persisted = await mutateMcpConfig((cfg) => {
        const filtered = cfg.servers.filter((s) => s.name !== name);
        if (filtered.length === cfg.servers.length) {
          // Nothing matched — return the same reference to skip the write.
          return { next: cfg, result: false };
        }
        return { next: { servers: filtered }, result: true };
      });
      const detached = await detachServer(name);
      if (!persisted && !detached) {
        return { removed: false, name, note: `No MCP server named "${name}" was registered.` };
      }
      return {
        removed: true,
        name,
        persistedChange: persisted,
        detachedFromSession: detached,
      };
    },
  });
}
