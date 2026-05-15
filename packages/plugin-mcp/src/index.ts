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
  const clients: McpClientLike[] = [];
  const tools = [] as Awaited<ReturnType<typeof wrapMcpServerTools>>;

  for (const server of opts.servers) {
    const client = await factory(server, opts);
    clients.push(client);
    const wrapped = await wrapMcpServerTools({
      server,
      client,
      toolNamePrefix: opts.toolNamePrefix,
    });
    tools.push(...wrapped);
  }

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

