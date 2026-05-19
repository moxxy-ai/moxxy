import * as os from 'node:os';
import * as path from 'node:path';
import { definePlugin, type Plugin } from '@moxxy/sdk';
import { readMcpConfig } from './config-io.js';
import { createMcpRuntime } from './runtime.js';
import { createMcpUsageSkillWriter } from './skill.js';
import { buildAddServerTool } from './tools/add.js';
import { buildListServersTool } from './tools/list.js';
import { buildRemoveServerTool } from './tools/remove.js';
import { buildTestServerTool } from './tools/test.js';
import type {
  BuildMcpAdminPluginOptions,
  McpAdminApi,
  McpStoredConfig,
  McpStoredServer,
} from './types.js';

export type {
  AdminSkillRegistryLike,
  AdminToolRegistryLike,
  BuildMcpAdminPluginOptions,
  McpAdminApi,
  McpRuntimeHandle,
  McpServerStatus,
  McpStoredConfig,
  McpStoredServer,
} from './types.js';
export {
  mcpConfigPath,
  readMcpConfig,
  removeServerFromConfig,
  setServerDisabled,
  writeMcpConfig,
} from './config-io.js';

export function buildMcpAdminPluginWithApi(
  opts: BuildMcpAdminPluginOptions = { toolRegistry: null },
): { plugin: Plugin; api: McpAdminApi } {
  return buildMcpAdminPluginInternal(opts);
}

export function buildMcpAdminPlugin(opts: BuildMcpAdminPluginOptions = { toolRegistry: null }): Plugin {
  return buildMcpAdminPluginInternal(opts).plugin;
}

/**
 * Build the MCP admin plugin: tools that let the agent register and
 * manage MCP servers at runtime. When wired to a live tool registry,
 * adds hot-attach so newly-registered servers are callable in the same
 * session without a restart.
 */
function buildMcpAdminPluginInternal(
  opts: BuildMcpAdminPluginOptions,
): { plugin: Plugin; api: McpAdminApi } {
  const registry = opts.toolRegistry;
  const skillRegistry = opts.skillRegistry ?? null;
  const userSkillsDir = opts.userSkillsDir ?? path.join(os.homedir(), '.moxxy', 'skills');

  const runtime = createMcpRuntime(registry);
  const writeMcpUsageSkill = createMcpUsageSkillWriter({ skillRegistry, userSkillsDir });

  const api: McpAdminApi = {
    enableAndAttach: async (name) => {
      const cfg = await readMcpConfig();
      const found = cfg.servers.find((s) => s.name === name);
      if (!found) return null;
      let entry: McpStoredServer = found;
      if (!entry.cachedTools || entry.cachedTools.length === 0) {
        entry = await runtime.refreshServerCache(entry);
      }
      return runtime.attachServerLazy(entry);
    },
    detach: runtime.detachServer,
    listServers: async () => {
      const cfg = await readMcpConfig();
      return cfg.servers.map((s) => ({
        name: s.name,
        enabled: s.disabled !== true,
        connected: runtime.runtimes.has(s.name),
      }));
    },
  };

  const plugin = definePlugin({
    name: '@moxxy/plugin-mcp-admin',
    version: '0.0.0',
    tools: [
      buildListServersTool(),
      buildAddServerTool({
        registry,
        attachServer: runtime.attachServer,
        writeMcpUsageSkill,
      }),
      buildRemoveServerTool({ detachServer: runtime.detachServer }),
      buildTestServerTool(),
    ],
    hooks: {
      // On session init, register lazy stubs for every saved MCP server.
      // Servers WITH a tool-descriptor cache register stubs instantly
      // (no connection). Servers WITHOUT a cache (entry predates the
      // cache feature, edited by hand, etc.) auto-refresh — we connect
      // once, list tools, write the cache back to mcp.json, then
      // register lazy stubs. The connection is closed after listing;
      // subsequent tool calls reconnect via the lazy path.
      onInit: async (ctx) => {
        if (!registry) return;
        const log = (ctx as { logger?: { warn: (msg: string, meta?: unknown) => void } }).logger;
        let cfg: McpStoredConfig;
        try {
          cfg = await readMcpConfig();
        } catch {
          return;
        }
        for (const server of cfg.servers) {
          if (server.disabled) continue;
          let entry: McpStoredServer = server;
          if (!entry.cachedTools || entry.cachedTools.length === 0) {
            try {
              entry = await runtime.refreshServerCache(entry);
            } catch (err) {
              log?.warn?.(`mcp: failed to refresh cache for "${entry.name}"`, {
                err: err instanceof Error ? err.message : String(err),
              });
              continue;
            }
          }
          try {
            runtime.attachServerLazy(entry);
          } catch (err) {
            log?.warn?.(`mcp: failed to attach lazy stubs for "${entry.name}"`, {
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
      },
      // Close every attached MCP client (lazy or eager) on session
      // shutdown so stdio child processes don't get orphaned and HTTP
      // sockets don't leak.
      onShutdown: async () => {
        for (const [, runtime_] of runtime.runtimes) {
          try {
            await runtime_.client.close();
          } catch {
            /* ignore */
          }
        }
        runtime.runtimes.clear();
      },
    },
  });
  return { plugin, api };
}
