import { defineTool, type ToolDef } from '@moxxy/sdk';
import type { McpServerConfig, McpToolDescriptor } from '../../types.js';
import { mcpConfigPath, readMcpConfig, writeMcpConfig } from '../config-io.js';
import { addServerInput, validateAddServerInput } from '../schema.js';
import type {
  AdminToolRegistryLike,
  McpStoredConfig,
  McpStoredServer,
} from '../types.js';

export interface AddServerToolDeps {
  readonly registry: AdminToolRegistryLike | null;
  attachServer(server: McpServerConfig): Promise<{
    toolNames: ReadonlyArray<string>;
    descriptors: ReadonlyArray<McpToolDescriptor>;
  }>;
  writeMcpUsageSkill(
    server: McpServerConfig,
    descriptors: ReadonlyArray<McpToolDescriptor>,
  ): Promise<{ path: string; skillName: string } | null>;
}

export function buildAddServerTool(deps: AddServerToolDeps): ToolDef {
  const { registry, attachServer, writeMcpUsageSkill } = deps;
  return defineTool({
    name: 'mcp_add_server',
    description:
      'Register a new MCP server in ~/.moxxy/mcp.json. Pick "stdio" for local commands ' +
      '(npm/uv packages, scripts); pick "http" or "sse" for remote HTTP servers. The new ' +
      'server\'s tools become available after the next moxxy restart. Call mcp_test_server ' +
      'first if you want to verify connectivity before persisting.',
    inputSchema: addServerInput,
    permission: { action: 'prompt' },
    handler: async (input) => {
      const server = validateAddServerInput(input);
      const cfg = await readMcpConfig();
      if (cfg.servers.some((s) => s.name === server.name)) {
        throw new Error(
          `mcp_add_server: an MCP server named "${server.name}" already exists. ` +
            `Use mcp_remove_server first, or pick a different name.`,
        );
      }
      // Hot-attach: connect + register tools BEFORE persisting. If
      // attach fails (bad URL, missing command, schema mismatch),
      // we never write a broken entry to disk.
      const { toolNames, descriptors } = await attachServer(server);
      // Cache descriptors so next boot can register lazy stubs
      // without paying the connection cost up-front.
      const stored: McpStoredServer = { ...server, cachedTools: descriptors };
      const next: McpStoredConfig = { servers: [...cfg.servers, stored] };
      await writeMcpConfig(next);
      // Auto-create the usage skill so /skills surfaces the new
      // server alongside hand-authored skills. Best-effort — if
      // skill writing fails, the MCP attach still succeeded.
      let skillResult: { path: string; skillName: string } | null = null;
      if (input.autoSkill !== false) {
        try {
          skillResult = await writeMcpUsageSkill(server, descriptors);
        } catch (err) {
          skillResult = null;
          // surface but don't fail the whole tool call
          return {
            ok: true,
            name: server.name,
            path: mcpConfigPath(),
            attached: registry !== null,
            tools: toolNames,
            skill: null,
            skillError: err instanceof Error ? err.message : String(err),
            note: 'Server attached + persisted; skill creation failed (see skillError).',
          };
        }
      }
      return {
        ok: true,
        name: server.name,
        path: mcpConfigPath(),
        attached: registry !== null,
        tools: toolNames,
        skill: skillResult,
        note: registry
          ? `Live in this session — ${toolNames.length} tool${toolNames.length === 1 ? '' : 's'} now callable.` +
            (skillResult ? ` Usage skill written to ${skillResult.path}.` : '') +
            ' Persisted; survives restart.'
          : 'Saved to config. Restart moxxy to load the tools (no live registry was wired into the admin plugin).',
      };
    },
  });
}
