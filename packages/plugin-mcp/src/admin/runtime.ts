import { MoxxyError } from '@moxxy/sdk';
import type { McpClientLike, McpServerConfig, McpToolDescriptor } from '../types.js';
import { defaultClientFactory } from '../client.js';
import { MCP_CONNECT_TIMEOUT_MS, withTimeout } from '../timeout.js';
import { wrapMcpServerToolsLazy } from '../wrap.js';
import { mutateMcpConfig } from './config-io.js';
import { resolveServerSecrets, type McpSecretResolver } from './secrets.js';
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

export interface McpRuntimeOptions {
  /**
   * Resolves `${vault:NAME}` placeholders in env/header values at CONNECT
   * time (see `secrets.ts`). The stored config — and everything persisted
   * back to it — keeps the placeholder form.
   */
  readonly secretResolver?: McpSecretResolver | null;
}

export function createMcpRuntime(
  registry: AdminToolRegistryLike | null,
  options: McpRuntimeOptions = {},
): McpRuntime {
  const secretResolver = options.secretResolver ?? null;
  /** Connect with secrets resolved; `server` itself stays placeholder-form. */
  const connect = async (server: McpServerConfig): Promise<McpClientLike> =>
    defaultClientFactory(await resolveServerSecrets(server, secretResolver));
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
    // Bound the connect + listTools handshake. `mcp_add_server` and
    // `enableAndAttach` drive this path at the model's request; a wedged
    // server spawn (or a connected-but-mute endpoint that never answers
    // listTools) would otherwise hang the tool call indefinitely — a
    // permanent pending dot with no recovery short of killing moxxy. On
    // timeout we reject AND close any client that opened, so a slow-to-spawn
    // stdio child / socket can't leak after we've given up on it.
    const client = await withTimeout(
      connect(server),
      MCP_CONNECT_TIMEOUT_MS,
      `MCP connect "${server.name}"`,
    );
    let list: { tools: ReadonlyArray<McpToolDescriptor> };
    try {
      list = await withTimeout(
        client.listTools(),
        MCP_CONNECT_TIMEOUT_MS,
        `MCP listTools "${server.name}"`,
      );
    } catch (err) {
      await client.close().catch(() => {});
      throw err;
    }
    const descriptors = list.tools;
    // List ONCE and feed the descriptors into the lazy wrapper over the
    // already-open client — wrapMcpServerTools would call listTools a second
    // time, paying a redundant round-trip and risking descriptor/tool drift
    // for servers whose tool list is non-deterministic between calls.
    const wrapped = wrapMcpServerToolsLazy({
      server,
      descriptors,
      getClient: () => Promise.resolve(client),
    });
    if (!registry) {
      await client.close();
      return { toolNames: wrapped.map((t) => t.name), descriptors };
    }
    const collisions = wrapped.filter((t) => registry.has(t.name)).map((t) => t.name);
    if (collisions.length > 0) {
      await client.close();
      throw new MoxxyError({
        code: 'CONFIG_INVALID',
        message:
          `mcp_add_server: tool name collision — already registered: ${collisions.join(', ')}. ` +
          'Pick a different server name (the server name becomes a prefix on each tool).',
      });
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
          // Bound the first-call connect so a wedged transport can't hang the
          // triggering tool call forever (the per-call timeout in wrap.ts only
          // covers callTool, not this connect handshake).
          const client = await withTimeout(
            connect(server),
            MCP_CONNECT_TIMEOUT_MS,
            `MCP connect "${server.name}"`,
          );
          // Stash the live client on the runtime entry so shutdown can
          // close it. The entry was created with a sentinel; replace it.
          const runtime = runtimes.get(server.name);
          if (runtime) {
            runtimes.set(server.name, { client, toolNames: runtime.toolNames });
            return client;
          }
          // detachServer ran while this connect was in flight: the runtime
          // entry (and its shutdown close path) is gone. Close the freshly
          // opened client here so its stdio child / socket isn't orphaned,
          // and fail the call rather than handing back a leaked handle.
          await client.close().catch(() => {});
          throw new Error(`MCP server "${server.name}" detached during connect`);
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
      throw new MoxxyError({
        code: 'CONFIG_INVALID',
        message:
          `lazy attach: tool name collision for "${server.name}": ${collisions.join(', ')}. ` +
          'A different server (or a previously-attached version) already owns these names.',
      });
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
    // Bound the connect handshake: a dead endpoint or a stdio child that
    // spawns but never completes the MCP handshake would otherwise hang here,
    // and at boot core awaits onInit serially — one stale entry would make
    // moxxy unstartable. On timeout we reject (the onInit catch logs+skips it).
    const client = await withTimeout(
      connect(server),
      MCP_CONNECT_TIMEOUT_MS,
      `MCP connect "${server.name}"`,
    );
    try {
      // Bound listTools too — a connected-but-unresponsive server can stall
      // discovery just as badly as a dead connect.
      const list = await withTimeout(
        client.listTools(),
        MCP_CONNECT_TIMEOUT_MS,
        `MCP listTools "${server.name}"`,
      );
      const refreshed: McpStoredServer = { ...server, cachedTools: list.tools };
      // Persist the refreshed cache so subsequent boots can lazy-attach
      // without reconnecting. Read-modify-write under the shared config
      // mutex so a concurrent add/remove can't clobber the file.
      await mutateMcpConfig((cfg) => ({
        next: { servers: cfg.servers.map((s) => (s.name === server.name ? refreshed : s)) },
        result: undefined,
      }));
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
