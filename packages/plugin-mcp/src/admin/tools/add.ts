import { defineTool, MoxxyError, type ToolDef } from '@moxxy/sdk';
import type { McpServerConfig, McpToolDescriptor } from '../../types.js';
import { mcpConfigPath, mutateMcpConfig, readMcpConfig } from '../config-io.js';
import { addServerInput, validateAddServerInput } from '../schema.js';
import type {
  AdminToolRegistryLike,
  McpStoredServer,
} from '../types.js';

export interface AddServerToolDeps {
  readonly registry: AdminToolRegistryLike | null;
  attachServer(server: McpServerConfig): Promise<{
    toolNames: ReadonlyArray<string>;
    descriptors: ReadonlyArray<McpToolDescriptor>;
  }>;
  /** Roll back a hot-attach (unregister its tools + close the client) when
   *  persisting the new entry fails after `attachServer` already succeeded. */
  detachServer(name: string): Promise<boolean>;
  writeMcpUsageSkill(
    server: McpServerConfig,
    descriptors: ReadonlyArray<McpToolDescriptor>,
  ): Promise<{ path: string; skillName: string } | null>;
}

export function buildAddServerTool(deps: AddServerToolDeps): ToolDef {
  const { registry, attachServer, detachServer, writeMcpUsageSkill } = deps;
  return defineTool({
    name: 'mcp_add_server',
    description:
      'Register a new MCP server in ~/.moxxy/mcp.json. Pick "stdio" for local commands ' +
      '(npm/uv packages, scripts); pick "http" or "sse" for remote HTTP servers. The new ' +
      'server\'s tools become available after the next moxxy restart. Call mcp_test_server ' +
      'first if you want to verify connectivity before persisting. NEVER pass API keys or ' +
      'tokens in plaintext: store the secret in the vault first (vault_set), then reference ' +
      'it as "${vault:NAME}" in the env/header value — the placeholder is what gets ' +
      'persisted, and it is resolved only at connect time.',
    inputSchema: addServerInput,
    permission: { action: 'prompt' },
    // Mirrors mcp_test_server's honest surface: the hot-attach spawns the
    // user-named stdio command (subprocess + broad fs) or connects to an
    // arbitrary http/sse URL (net: any). On top of that, this tool persists
    // the entry to ~/.moxxy/mcp.json and writes the auto-generated usage
    // skill into ~/.moxxy/skills/.
    isolation: {
      capabilities: {
        subprocess: true,
        fs: {
          read: ['$cwd/**', '/tmp/**', '~/.moxxy/mcp.json'],
          write: ['$cwd/**', '/tmp/**', '~/.moxxy/mcp.json', '~/.moxxy/skills/**'],
        },
        net: { mode: 'any' },
        env: ['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'TERM'],
        timeMs: 600_000,
      },
    },
    handler: async (input) => {
      const server = validateAddServerInput(input);
      const cfg = await readMcpConfig();
      if (cfg.servers.some((s) => s.name === server.name)) {
        throw new MoxxyError({
          code: 'CONFIG_INVALID',
          message:
            `mcp_add_server: an MCP server named "${server.name}" already exists. ` +
            `Use mcp_remove_server first, or pick a different name.`,
        });
      }
      // Hot-attach: connect + register tools BEFORE persisting. If
      // attach fails (bad URL, missing command, schema mismatch),
      // we never write a broken entry to disk.
      const { toolNames, descriptors } = await attachServer(server);
      // Cache descriptors so next boot can register lazy stubs
      // without paying the connection cost up-front.
      const stored: McpStoredServer = { ...server, cachedTools: descriptors };
      // Persist under the shared config mutex, re-reading the latest
      // catalog so a concurrent add/remove can't clobber the file. The
      // duplicate check is repeated against the fresh read to catch a race
      // where two adds for the same name both passed the initial check.
      try {
        await mutateMcpConfig((current) => {
          if (current.servers.some((s) => s.name === server.name)) {
            throw new MoxxyError({
              code: 'CONFIG_INVALID',
              message:
                `mcp_add_server: an MCP server named "${server.name}" already exists. ` +
                `Use mcp_remove_server first, or pick a different name.`,
            });
          }
          return { next: { servers: [...current.servers, stored] }, result: undefined };
        });
      } catch (err) {
        // attachServer already registered the live tools + opened a client, but
        // persistence failed (e.g. a concurrent add for the same name won the
        // race, or the file write threw). Roll the live registry back so we
        // don't strand callable tools with no config entry + a leaked client.
        await detachServer(server.name).catch(() => undefined);
        throw err;
      }
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
