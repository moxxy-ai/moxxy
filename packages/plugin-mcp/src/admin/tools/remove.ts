import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import { readMcpConfig, writeMcpConfig } from '../config-io.js';
import { serverNameSchema } from '../schema.js';
import type { McpStoredConfig } from '../types.js';

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
      const cfg = await readMcpConfig();
      const before = cfg.servers.length;
      const next: McpStoredConfig = {
        servers: cfg.servers.filter((s) => s.name !== name),
      };
      const persisted = next.servers.length !== before;
      const detached = await detachServer(name);
      if (persisted) await writeMcpConfig(next);
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
