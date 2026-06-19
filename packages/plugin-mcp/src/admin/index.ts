import { definePlugin, type Plugin } from '@moxxy/sdk';
import { moxxyPath } from '@moxxy/sdk/server';
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
export { resolveServerSecrets, type McpSecretResolver } from './secrets.js';

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
  const userSkillsDir = opts.userSkillsDir ?? moxxyPath('skills');
  const secretResolver = opts.secretResolver ?? null;

  const runtime = createMcpRuntime(registry, { secretResolver });
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
        detachServer: runtime.detachServer,
        writeMcpUsageSkill,
      }),
      buildRemoveServerTool({ detachServer: runtime.detachServer }),
      buildTestServerTool({ secretResolver }),
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
        // Refresh every uncached server's catalog in PARALLEL: each
        // refreshServerCache now carries its own bounded connect/listTools
        // timeout, so allSettled bounds boot at the slowest server instead of
        // the SUM of every server's handshake latency. (Serially awaiting one
        // dead endpoint after another compounded the wedge.) Cached servers
        // need no connection and resolve immediately.
        const active = cfg.servers.filter((s) => !s.disabled);
        const resolved = await Promise.all(
          active.map(async (server): Promise<McpStoredServer | null> => {
            if (server.cachedTools && server.cachedTools.length > 0) return server;
            try {
              return await runtime.refreshServerCache(server);
            } catch (err) {
              log?.warn?.(`mcp: failed to refresh cache for "${server.name}"`, {
                err: err instanceof Error ? err.message : String(err),
              });
              return null;
            }
          }),
        );
        // Attach serially in config order so tool registration order stays
        // deterministic (the refresh ran concurrently, but attach is cheap and
        // synchronous — no connection — so this adds no boot latency).
        for (const entry of resolved) {
          if (!entry) continue;
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
