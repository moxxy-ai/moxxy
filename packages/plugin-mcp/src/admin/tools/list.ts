import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import { readMcpConfig } from '../config-io.js';

export function buildListServersTool(): ToolDef {
  return defineTool({
    name: 'mcp_list_servers',
    description:
      'List every MCP server currently registered in ~/.moxxy/mcp.json. Returns name + transport kind + connection details (command/url) for each.',
    inputSchema: z.object({}),
    handler: async () => {
      const cfg = await readMcpConfig();
      return cfg.servers.map((s) =>
        s.kind === undefined || s.kind === 'stdio'
          ? { name: s.name, kind: 'stdio' as const, command: (s as { command: string }).command }
          : { name: s.name, kind: s.kind, url: (s as { url: string }).url },
      );
    },
  });
}
