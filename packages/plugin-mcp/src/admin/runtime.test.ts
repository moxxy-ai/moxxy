import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpClientLike, McpServerConfig, McpToolDescriptor } from '../types.js';
import type { AdminToolRegistryLike, McpStoredServer } from './types.js';

// The runtime connects through `defaultClientFactory` (from ../client.js),
// which would spawn a real subprocess / open a real socket. Replace it with
// an injectable fake whose behavior each test controls via `connectImpl`.
const hoisted = vi.hoisted(() => {
  return {
    connectCalls: [] as McpServerConfig[],
    connectImpl: null as ((server: McpServerConfig) => Promise<McpClientLike>) | null,
  };
});

vi.mock('../client.js', () => ({
  defaultClientFactory: async (server: McpServerConfig): Promise<McpClientLike> => {
    hoisted.connectCalls.push(server);
    if (!hoisted.connectImpl) throw new Error('connectImpl not set by test');
    return hoisted.connectImpl(server);
  },
}));

// Imported AFTER the mock is registered (vi.mock is hoisted above imports).
const { createMcpRuntime } = await import('./runtime.js');
const { readMcpConfig, writeMcpConfig } = await import('./config-io.js');

const PING: McpToolDescriptor = { name: 'ping', description: 'pong', inputSchema: { type: 'object' } };

const makeClient = (over: Partial<McpClientLike> = {}): McpClientLike & { closed: number } => {
  const state = { closed: 0 };
  return {
    closed: 0,
    async listTools() {
      return { tools: [PING] };
    },
    async callTool({ name }) {
      return { content: [{ type: 'text', text: `pong ${name}` }] };
    },
    async close() {
      state.closed++;
      (this as { closed: number }).closed = state.closed;
    },
    ...over,
  } as McpClientLike & { closed: number };
};

const makeRegistry = (): AdminToolRegistryLike & { tools: Map<string, unknown> } => {
  const tools = new Map<string, unknown>();
  return {
    tools,
    has: (n) => tools.has(n),
    register: (t) => {
      if (tools.has(t.name)) throw new Error(`dup register ${t.name}`);
      tools.set(t.name, t);
    },
    unregister: (n) => void tools.delete(n),
  };
};

const stored = (over: Partial<McpStoredServer> = {}): McpStoredServer =>
  ({ kind: 'stdio', name: 'demo', command: 'noop', cachedTools: [PING], ...over }) as McpStoredServer;

const baseCtx = () => ({
  sessionId: 's' as never,
  turnId: 't' as never,
  callId: 'c' as never,
  cwd: '/tmp',
  signal: new AbortController().signal,
  log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
});

describe('admin/runtime', () => {
  let home: string;
  const original = process.env.MOXXY_HOME;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'moxxy-mcp-rt-'));
    process.env.MOXXY_HOME = home;
    hoisted.connectCalls.length = 0;
    hoisted.connectImpl = null;
  });

  afterEach(async () => {
    if (original === undefined) delete process.env.MOXXY_HOME;
    else process.env.MOXXY_HOME = original;
    await rm(home, { recursive: true, force: true });
  });

  describe('attachServer (eager)', () => {
    it('throws on a tool-name collision and closes the freshly-opened client', async () => {
      const registry = makeRegistry();
      // Pre-register the name the server would produce.
      registry.register({ name: 'mcp__demo__ping' } as never);
      const client = makeClient();
      hoisted.connectImpl = async () => client;
      const rt = createMcpRuntime(registry);
      await expect(rt.attachServer({ kind: 'stdio', name: 'demo', command: 'x' })).rejects.toThrow(
        /tool name collision/,
      );
      // Client must not leak when we bail on collision.
      expect(client.closed).toBe(1);
      // No runtime entry recorded for a failed attach.
      expect(rt.runtimes.has('demo')).toBe(false);
    });

    it('registers wrapped tools and records a runtime handle on success', async () => {
      const registry = makeRegistry();
      const client = makeClient();
      hoisted.connectImpl = async () => client;
      const rt = createMcpRuntime(registry);
      const { toolNames, descriptors } = await rt.attachServer({ kind: 'stdio', name: 'demo', command: 'x' });
      expect(toolNames).toEqual(['mcp__demo__ping']);
      expect(descriptors).toEqual([PING]);
      expect(registry.has('mcp__demo__ping')).toBe(true);
      expect(rt.runtimes.get('demo')?.toolNames).toEqual(['mcp__demo__ping']);
    });

    it('closes the client (no registration) when there is no registry', async () => {
      const client = makeClient();
      hoisted.connectImpl = async () => client;
      const rt = createMcpRuntime(null);
      const { toolNames } = await rt.attachServer({ kind: 'stdio', name: 'demo', command: 'x' });
      expect(toolNames).toEqual(['mcp__demo__ping']);
      expect(client.closed).toBe(1);
      expect(rt.runtimes.has('demo')).toBe(false);
    });
  });

  describe('attachServerLazy', () => {
    it('registers stubs WITHOUT connecting', () => {
      const registry = makeRegistry();
      const rt = createMcpRuntime(registry);
      const { toolNames } = rt.attachServerLazy(stored());
      expect(toolNames).toEqual(['mcp__demo__ping']);
      expect(registry.has('mcp__demo__ping')).toBe(true);
      // No connection until a tool actually runs.
      expect(hoisted.connectCalls).toHaveLength(0);
    });

    it('skips servers with no cached tools', () => {
      const registry = makeRegistry();
      const rt = createMcpRuntime(registry);
      const { toolNames } = rt.attachServerLazy(stored({ cachedTools: [] }));
      expect(toolNames).toEqual([]);
      expect(rt.runtimes.has('demo')).toBe(false);
    });

    it('is idempotent when the server is already attached', () => {
      const registry = makeRegistry();
      const rt = createMcpRuntime(registry);
      rt.attachServerLazy(stored());
      // Second call must not throw a collision against its own prior stubs.
      const { toolNames } = rt.attachServerLazy(stored());
      expect(toolNames).toEqual(['mcp__demo__ping']);
    });

    it('lazy sentinel close() is a no-op until the first call connects', async () => {
      const registry = makeRegistry();
      const rt = createMcpRuntime(registry);
      rt.attachServerLazy(stored());
      const handle = rt.runtimes.get('demo')!;
      // Closing before any tool runs must not connect or throw.
      await handle.client.close();
      expect(hoisted.connectCalls).toHaveLength(0);
    });

    it('first tool call triggers one shared connection; subsequent calls reuse it', async () => {
      const registry = makeRegistry();
      const client = makeClient();
      hoisted.connectImpl = async () => client;
      const rt = createMcpRuntime(registry);
      rt.attachServerLazy(stored());
      const tool = registry.tools.get('mcp__demo__ping') as {
        handler: (i: unknown, c: unknown) => Promise<unknown>;
      };
      await tool.handler({}, baseCtx());
      await tool.handler({}, baseCtx());
      expect(hoisted.connectCalls).toHaveLength(1);
      // The live client replaced the sentinel on the runtime handle.
      expect(rt.runtimes.get('demo')?.client).toBe(client);
    });

    it('getOrConnect retries after a failed connect instead of caching the rejection', async () => {
      const registry = makeRegistry();
      const good = makeClient();
      let attempt = 0;
      hoisted.connectImpl = async () => {
        attempt++;
        if (attempt === 1) throw new Error('connect boom');
        return good;
      };
      const rt = createMcpRuntime(registry);
      rt.attachServerLazy(stored());
      const tool = registry.tools.get('mcp__demo__ping') as {
        handler: (i: unknown, c: unknown) => Promise<unknown>;
      };
      // First call fails...
      await expect(tool.handler({}, baseCtx())).rejects.toThrow(/connect boom/);
      // ...but the connect promise was reset, so a retry succeeds.
      const out = await tool.handler({}, baseCtx());
      expect(out).toBe('pong ping');
      expect(attempt).toBe(2);
    });

    it('throws and does not register on a cross-server name collision', () => {
      const registry = makeRegistry();
      registry.register({ name: 'mcp__demo__ping' } as never);
      const rt = createMcpRuntime(registry);
      expect(() => rt.attachServerLazy(stored())).toThrow(/tool name collision/);
    });
  });

  describe('refreshServerCache', () => {
    it('connects, persists discovered descriptors, and closes the client', async () => {
      await writeMcpConfig({ servers: [{ kind: 'stdio', name: 'demo', command: 'noop' }] });
      const client = makeClient();
      hoisted.connectImpl = async () => client;
      const rt = createMcpRuntime(makeRegistry());
      const refreshed = await rt.refreshServerCache(stored({ cachedTools: undefined }));
      expect(refreshed.cachedTools).toEqual([PING]);
      expect(client.closed).toBe(1);
      const persisted = await readMcpConfig();
      expect(persisted.servers[0]?.cachedTools).toEqual([PING]);
    });

    it('rolls back (writes nothing) and still closes the client when listTools fails', async () => {
      await writeMcpConfig({ servers: [{ kind: 'stdio', name: 'demo', command: 'noop' }] });
      const client = makeClient({
        listTools: async () => {
          throw new Error('list boom');
        },
      });
      hoisted.connectImpl = async () => client;
      const rt = createMcpRuntime(makeRegistry());
      await expect(rt.refreshServerCache(stored({ cachedTools: undefined }))).rejects.toThrow(/list boom/);
      // finally{} must have closed the client even though listTools threw.
      expect(client.closed).toBe(1);
      // No cache written — the on-disk entry is untouched.
      const persisted = await readMcpConfig();
      expect(persisted.servers[0]?.cachedTools).toBeUndefined();
    });
  });

  describe('detachServer', () => {
    it('unregisters tools, closes the client, and forgets the runtime', async () => {
      const registry = makeRegistry();
      const client = makeClient();
      hoisted.connectImpl = async () => client;
      const rt = createMcpRuntime(registry);
      await rt.attachServer({ kind: 'stdio', name: 'demo', command: 'x' });
      expect(await rt.detachServer('demo')).toBe(true);
      expect(registry.has('mcp__demo__ping')).toBe(false);
      expect(rt.runtimes.has('demo')).toBe(false);
      expect(client.closed).toBe(1);
    });

    it('returns false for an unknown server', async () => {
      const rt = createMcpRuntime(makeRegistry());
      expect(await rt.detachServer('ghost')).toBe(false);
    });
  });

  describe('secretResolver (vault placeholders, A43)', () => {
    const fakeResolver = async (value: string): Promise<string> =>
      value.replace(/\$\{vault:([A-Za-z0-9_.-]+)\}/g, (_m, name: string) => `resolved-${name}`);

    it('attachServer connects with resolved env values but keeps the input untouched', async () => {
      hoisted.connectImpl = async () => makeClient();
      const rt = createMcpRuntime(makeRegistry(), { secretResolver: fakeResolver });
      const server: McpServerConfig = {
        kind: 'stdio',
        name: 'demo',
        command: 'x',
        env: { API_KEY: '${vault:demo_key}', PLAIN: 'literal' },
      };
      await rt.attachServer(server);
      const connected = hoisted.connectCalls[0] as Extract<McpServerConfig, { command: string }>;
      // Connect path sees the plaintext…
      expect(connected.env).toEqual({ API_KEY: 'resolved-demo_key', PLAIN: 'literal' });
      // …while the caller-held config object keeps the placeholder.
      expect(server.env).toEqual({ API_KEY: '${vault:demo_key}', PLAIN: 'literal' });
    });

    it('refreshServerCache persists the PLACEHOLDER, never the resolved plaintext', async () => {
      await writeMcpConfig({
        servers: [
          { kind: 'http', name: 'demo', url: 'https://mcp.example.com', headers: { authorization: 'Bearer ${vault:demo_token}' } },
        ],
      });
      hoisted.connectImpl = async () => makeClient();
      const rt = createMcpRuntime(makeRegistry(), { secretResolver: fakeResolver });
      await rt.refreshServerCache(
        { kind: 'http', name: 'demo', url: 'https://mcp.example.com', headers: { authorization: 'Bearer ${vault:demo_token}' } },
      );
      // Connect saw the resolved header.
      const connected = hoisted.connectCalls[0] as Extract<McpServerConfig, { url: string }>;
      expect(connected.headers).toEqual({ authorization: 'Bearer resolved-demo_token' });
      // Disk keeps the placeholder.
      const raw = JSON.stringify(await readMcpConfig());
      expect(raw).toContain('${vault:demo_token}');
      expect(raw).not.toContain('resolved-demo_token');
    });

    it('lazy attach resolves at first-call connect time', async () => {
      hoisted.connectImpl = async () => makeClient();
      const registry = makeRegistry();
      const rt = createMcpRuntime(registry, { secretResolver: fakeResolver });
      rt.attachServerLazy(stored({ env: { TOKEN: '${vault:t}' } } as Partial<McpStoredServer>));
      // No connection yet — lazy stubs only.
      expect(hoisted.connectCalls).toHaveLength(0);
      const tool = registry.tools.get('mcp__demo__ping') as { handler: (i: unknown, c: unknown) => Promise<unknown> };
      await tool.handler({}, baseCtx());
      const connected = hoisted.connectCalls[0] as Extract<McpServerConfig, { command: string }>;
      expect(connected.env).toEqual({ TOKEN: 'resolved-t' });
    });

    it('passes literals through unchanged when no resolver is wired (back-compat)', async () => {
      hoisted.connectImpl = async () => makeClient();
      const rt = createMcpRuntime(makeRegistry());
      const server: McpServerConfig = { kind: 'stdio', name: 'demo', command: 'x', env: { KEY: 'plain-secret' } };
      await rt.attachServer(server);
      const connected = hoisted.connectCalls[0] as Extract<McpServerConfig, { command: string }>;
      expect(connected.env).toEqual({ KEY: 'plain-secret' });
    });
  });

  describe('eager attach lists tools exactly once (no double round-trip)', () => {
    it('calls listTools a single time even though it also wraps the tools', async () => {
      const registry = makeRegistry();
      let listCalls = 0;
      const client = makeClient({
        listTools: async () => {
          listCalls++;
          return { tools: [PING] };
        },
      });
      hoisted.connectImpl = async () => client;
      const rt = createMcpRuntime(registry);
      await rt.attachServer({ kind: 'stdio', name: 'demo', command: 'x' });
      expect(listCalls).toBe(1);
      expect(registry.has('mcp__demo__ping')).toBe(true);
    });
  });

  describe('boot-time connect is bounded by a timeout', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('refreshServerCache rejects (does not hang) when connect never resolves', async () => {
      vi.useFakeTimers();
      // connect hangs forever — without the bounded timeout this would wedge
      // session boot (core awaits onInit serially).
      hoisted.connectImpl = () => new Promise<McpClientLike>(() => {});
      const rt = createMcpRuntime(makeRegistry());
      const promise = rt.refreshServerCache(stored({ cachedTools: undefined }));
      const assertion = expect(promise).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(30 * 1000);
      await assertion;
    });

    it('refreshServerCache rejects when listTools never resolves but still closes the client', async () => {
      vi.useFakeTimers();
      const client = makeClient({
        listTools: () => new Promise<{ tools: ReadonlyArray<McpToolDescriptor> }>(() => {}),
      });
      hoisted.connectImpl = async () => client;
      const rt = createMcpRuntime(makeRegistry());
      const promise = rt.refreshServerCache(stored({ cachedTools: undefined }));
      const assertion = expect(promise).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(30 * 1000);
      await assertion;
      expect(client.closed).toBe(1);
    });

    it('lazy first-call connect rejects on timeout and retries cleanly afterward', async () => {
      vi.useFakeTimers();
      let attempt = 0;
      const good = makeClient();
      hoisted.connectImpl = () => {
        attempt++;
        if (attempt === 1) return new Promise<McpClientLike>(() => {}); // hangs
        return Promise.resolve(good);
      };
      const registry = makeRegistry();
      const rt = createMcpRuntime(registry);
      rt.attachServerLazy(stored());
      const tool = registry.tools.get('mcp__demo__ping') as {
        handler: (i: unknown, c: unknown) => Promise<unknown>;
      };
      const first = tool.handler({}, baseCtx());
      const assertion = expect(first).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(30 * 1000);
      await assertion;
      // The rejected connect promise was reset; a retry connects to the good client.
      vi.useRealTimers();
      const out = await tool.handler({}, baseCtx());
      expect(out).toBe('pong ping');
      expect(attempt).toBe(2);
    });
  });

  describe('lazy connect racing detachServer does not leak the client', () => {
    it('closes the freshly-opened client when the server was detached mid-connect', async () => {
      const registry = makeRegistry();
      const client = makeClient();
      let releaseConnect: (() => void) | null = null;
      // Hold the connect open until the test releases it, so we can detach
      // the server while the connect is still in flight.
      hoisted.connectImpl = () =>
        new Promise<McpClientLike>((resolve) => {
          releaseConnect = () => resolve(client);
        });
      const rt = createMcpRuntime(registry);
      rt.attachServerLazy(stored());
      const tool = registry.tools.get('mcp__demo__ping') as {
        handler: (i: unknown, c: unknown) => Promise<unknown>;
      };
      const callPromise = tool.handler({}, baseCtx());
      // Wait a tick so getOrConnect has entered the connect.
      await Promise.resolve();
      // Detach while the connect is in flight — the runtime entry is removed.
      // detachServer awaits the (lazy sentinel) client.close(), which itself
      // waits on the in-flight connectPromise, so don't await it before the
      // connect is released or the test deadlocks.
      const detachPromise = rt.detachServer('demo');
      // Now let the connect resolve. The freshly-opened client has nowhere to
      // live (entry gone, shutdown loop won't see it) so it must be closed here.
      releaseConnect!();
      await expect(callPromise).rejects.toThrow(/detached during connect/);
      await detachPromise;
      expect(client.closed).toBe(1);
      expect(rt.runtimes.has('demo')).toBe(false);
    });
  });
});
