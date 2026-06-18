import { definePlugin, type Plugin } from '@moxxy/sdk';
import type { McpClientLike, McpPluginOptions, McpServerConfig } from './types.js';
import { defaultClientFactory } from './client.js';
import { wrapMcpServerTools } from './wrap.js';

export type {
  McpClientLike,
  McpContentBlock,
  McpPluginOptions,
  McpServerConfig,
  McpToolDescriptor,
  SseServerConfig,
  StdioServerConfig,
  StreamableHttpServerConfig,
} from './types.js';
export { wrapMcpServerTools } from './wrap.js';
export { defaultToolNamePrefix } from './types.js';
export { defaultClientFactory } from './client.js';
export {
  buildMcpAdminPlugin,
  buildMcpAdminPluginWithApi,
  mcpConfigPath,
  readMcpConfig,
  removeServerFromConfig,
  setServerDisabled,
  writeMcpConfig,
  resolveServerSecrets,
  type McpSecretResolver,
  type McpAdminApi,
  type McpServerStatus,
  type McpStoredConfig,
  type McpStoredServer,
} from './admin.js';

export interface CreateMcpPluginOptions extends McpPluginOptions {
  /**
   * Inject a custom client factory. Used by tests; production code uses the
   * default factory that imports `@modelcontextprotocol/sdk`.
   */
  readonly clientFactory?: (server: McpServerConfig, options: McpPluginOptions) => Promise<McpClientLike>;
}

export async function createMcpPlugin(opts: CreateMcpPluginOptions): Promise<Plugin> {
  const factory = opts.clientFactory ?? defaultClientFactory;
  // Connect + list each server in PARALLEL: serial boot paid the sum of every
  // server's spawn/handshake/listTools round-trip, so N servers serialized N
  // latencies. allSettled bounds boot at the slowest server, not the sum,
  // while still letting us close every successfully-opened client if any leg
  // fails (the onShutdown hook is only wired once we RETURN the plugin).
  const opened: McpClientLike[] = [];
  const results = await Promise.allSettled(
    opts.servers.map(async (server) => {
      const client = await factory(server, opts);
      // Record the client the instant it opens, before listTools — so even a
      // listTools failure can't leak its child process / socket.
      opened.push(client);
      return wrapMcpServerTools({ server, client, toolNamePrefix: opts.toolNamePrefix });
    }),
  );

  const failure = results.find((r) => r.status === 'rejected');
  if (failure) {
    await Promise.allSettled(opened.map((c) => c.close()));
    throw (failure as PromiseRejectedResult).reason;
  }

  // Flatten in server order (map preserves index → deterministic tool order).
  const tools = results.flatMap((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof wrapMcpServerTools>>>).value);
  const clients = opened;

  return definePlugin({
    name: '@moxxy/plugin-mcp',
    version: '0.0.0',
    tools,
    hooks: {
      onShutdown: async () => {
        await Promise.allSettled(clients.map((c) => c.close()));
      },
    },
  });
}

