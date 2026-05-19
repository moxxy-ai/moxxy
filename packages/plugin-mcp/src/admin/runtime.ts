import type { McpClientLike, McpServerConfig, McpToolDescriptor } from '../types.js';
import { defaultClientFactory } from '../client.js';
import { wrapMcpServerTools, wrapMcpServerToolsLazy } from '../wrap.js';
import { readMcpConfig, writeMcpConfig } from './config-io.js';
import type {
  AdminToolRegistryLike,
  McpRuntimeHandle,
  McpStoredServer,
} from './types.js';

export interface McpRuntime {
  readonly runtimes: Map<string, McpRuntimeHandle>;
  attachServer(server: McpServerConfig): Promise<{
    toolNames: ReadonlyArray<string>;
    descriptors: ReadonlyArray<McpToolDescriptor>;
  }>;
  attachServerLazy(server: McpStoredServer): { toolNames: ReadonlyArray<string> };
  refreshServerCache(server: McpStoredServer): Promise<McpStoredServer>;
  detachServer(name: string): Promise<boolean>;
}

export function createMcpRuntime(registry: AdminToolRegistryLike | null): McpRuntime {
  // Track hot-attached runtimes keyed by server name. We need to know
  // which tools each server contributed so `mcp_remove_server` can
  // unregister them cleanly, and which client to close on shutdown.
  const runtimes = new Map<string, McpRuntimeHandle>();

  /**
   * Eager attach used by `mcp_add_server`: connect, list tools, register
   * them. Returns the discovered descriptors so the caller can cache
   * them into mcp.json for lazy boots next time.
   */
  const attachServer: McpRuntime['attachServer'] = async (server) => {
    const client = await defaultClientFactory(server);
    const list = await client.listTools();
    const descriptors = list.tools;
    const wrapped = await wrapMcpServerTools({ server, client });
    if (!registry) {
      await client.close();
      return { toolNames: wrapped.map((t) => t.name), descriptors };
    }
    const collisions = wrapped.filter((t) => registry.has(t.name)).map((t) => t.name);
    if (collisions.length > 0) {
      await client.close();
      throw new Error(
        `mcp_add_server: tool name collision — already registered: ${collisions.join(', ')}. ` +
          'Pick a different server name (the server name becomes a prefix on each tool).',
      );
    }
    for (const tool of wrapped) registry.register(tool);
    runtimes.set(server.name, { client, toolNames: wrapped.map((t) => t.name) });
    return { toolNames: wrapped.map((t) => t.name), descriptors };
  };

  /**
   * Lazy attach used at boot: register stub tools using cached
   * descriptors WITHOUT connecting. The first call to any of these
   * tools triggers a single shared connection via `getOrConnect`;
   * subsequent calls reuse it. Failed connections reset so the next
   * call can retry.
   *
   * When `cachedTools` is missing (catalog entry predates the cache
   * feature or was edited by hand), the caller is responsible for
   * refreshing the cache first via `refreshServerCache`.
   */
  const attachServerLazy: McpRuntime['attachServerLazy'] = (server) => {
    if (!registry) return { toolNames: [] };
    if (runtimes.has(server.name)) return { toolNames: runtimes.get(server.name)!.toolNames };
    const descriptors = server.cachedTools ?? [];
    if (descriptors.length === 0) {
      return { toolNames: [] };
    }

    let connectPromise: Promise<McpClientLike> | null = null;
    const getOrConnect = async (): Promise<McpClientLike> => {
      if (!connectPromise) {
        connectPromise = (async () => {
          const client = await defaultClientFactory(server);
          // Stash the live client on the runtime entry so shutdown can
          // close it. The entry was created with a sentinel; replace it.
          const runtime = runtimes.get(server.name);
          if (runtime) {
            runtimes.set(server.name, { client, toolNames: runtime.toolNames });
          }
          return client;
        })().catch((err) => {
          // Reset so a future call can retry instead of being stuck on
          // a rejected promise.
          connectPromise = null;
          throw err;
        });
      }
      return connectPromise;
    };

    const wrapped = wrapMcpServerToolsLazy({ server, descriptors, getClient: getOrConnect });
    const collisions = wrapped.filter((t) => registry.has(t.name)).map((t) => t.name);
    if (collisions.length > 0) {
      throw new Error(
        `lazy attach: tool name collision for "${server.name}": ${collisions.join(', ')}. ` +
          'A different server (or a previously-attached version) already owns these names.',
      );
    }
    for (const tool of wrapped) registry.register(tool);
    // Sentinel client gets swapped for the real one inside getOrConnect.
    // Until first call, close() is a no-op via the LazyClient sentinel.
    const lazyClient: McpClientLike = {
      listTools: async () => ({ tools: descriptors }),
      callTool: async (args) => (await getOrConnect()).callTool(args),
      close: async () => {
        if (connectPromise) {
          const client = await connectPromise.catch(() => null);
          if (client) await client.close();
        }
      },
    };
    runtimes.set(server.name, { client: lazyClient, toolNames: wrapped.map((t) => t.name) });
    return { toolNames: wrapped.map((t) => t.name) };
  };

  /**
   * Connect to a server, list its tools, and write the descriptors back
   * to mcp.json. Used to refresh stale or missing caches at boot. The
   * connection is closed immediately — registration happens via the
   * caller's subsequent `attachServerLazy` call.
   */
  const refreshServerCache: McpRuntime['refreshServerCache'] = async (server) => {
    const client = await defaultClientFactory(server);
    try {
      const list = await client.listTools();
      const refreshed: McpStoredServer = { ...server, cachedTools: list.tools };
      // Persist the refreshed cache so subsequent boots can lazy-attach
      // without reconnecting.
      const cfg = await readMcpConfig();
      const nextServers = cfg.servers.map((s) => (s.name === server.name ? refreshed : s));
      await writeMcpConfig({ servers: nextServers });
      return refreshed;
    } finally {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    }
  };

  const detachServer: McpRuntime['detachServer'] = async (name) => {
    const runtime = runtimes.get(name);
    if (!runtime) return false;
    runtimes.delete(name);
    if (registry) {
      for (const toolName of runtime.toolNames) registry.unregister(toolName);
    }
    try {
      await runtime.client.close();
    } catch {
      // ignore — best-effort close
    }
    return true;
  };

  return { runtimes, attachServer, attachServerLazy, refreshServerCache, detachServer };
}
