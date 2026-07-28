import { describe, expect, it } from 'vitest';
import { assertDefined } from '@moxxy/sdk';
import { createMcpPlugin } from './index.js';
import type { McpClientLike } from './types.js';

const fakeClient: McpClientLike = {
  async listTools() {
    return {
      tools: [
        { name: 'ping', description: 'returns pong', inputSchema: { type: 'object' } },
      ],
    };
  },
  async callTool({ name }) {
    return { content: [{ type: 'text', text: `pong from ${name}` }] };
  },
  async close() {},
};

describe('createMcpPlugin', () => {
  it('builds a Plugin whose tools wrap each MCP server', async () => {
    const plugin = await createMcpPlugin({
      servers: [{ name: 'demo', command: 'noop' }],
      clientFactory: async () => fakeClient,
    });
    expect(plugin.name).toBe('@moxxy/plugin-mcp');
    expect(plugin.tools).toHaveLength(1);
    const tools = plugin.tools;
    assertDefined(tools, 'plugin.tools present after createMcpPlugin');
    const first = tools[0];
    assertDefined(first, 'first mcp tool present');
    expect(first.name).toBe('mcp__demo__ping');
  });

  it('aggregates tools across multiple servers', async () => {
    const plugin = await createMcpPlugin({
      servers: [
        { name: 'a', command: 'noop' },
        { name: 'b', command: 'noop' },
      ],
      clientFactory: async () => fakeClient,
    });
    expect(plugin.tools).toHaveLength(2);
    const tools = plugin.tools;
    assertDefined(tools, 'plugin.tools present after createMcpPlugin');
    expect(tools.map((t) => t.name)).toEqual(['mcp__a__ping', 'mcp__b__ping']);
  });

  it('connects servers in parallel and bounds boot at the slowest, not the sum (u86-5)', async () => {
    // Parallelism is asserted by observing CONCURRENCY, not elapsed time. The
    // previous version slept 50ms per server and required the whole boot under
    // 90ms, which is a measurement of the machine: two parallel 50ms sleeps
    // routinely exceed that under a loaded suite, and it duly failed in CI.
    // Counting how many listTools calls are in flight at once proves the same
    // property and cannot be wrong because the box is busy.
    let inFlight = 0;
    let peakInFlight = 0;
    const release: Array<() => void> = [];
    const gate = (): Promise<void> =>
      new Promise<void>((resolve) => {
        release.push(resolve);
        // Let both servers reach the gate before either is allowed to finish;
        // serial boot could never get the second one here.
        if (release.length === 2) for (const r of release) r();
        // Fallback so a SERIAL implementation fails on the assertion below
        // (peak of 1) instead of deadlocking into an opaque test timeout.
        else setTimeout(resolve, 200);
      });

    const slowClient = (name: string): McpClientLike => ({
      async listTools() {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await gate();
        inFlight -= 1;
        return { tools: [{ name: 'ping', description: 'p', inputSchema: { type: 'object' } }] };
      },
      async callTool() {
        return { content: [{ type: 'text', text: `pong ${name}` }] };
      },
      async close() {},
    });

    const plugin = await createMcpPlugin({
      servers: [{ name: 'a', command: 'noop' }, { name: 'b', command: 'noop' }],
      clientFactory: async (s) => slowClient(s.name),
    });

    const tools = plugin.tools;
    assertDefined(tools, 'plugin.tools present after createMcpPlugin');
    // Order is still by server, not by completion.
    expect(tools.map((t) => t.name)).toEqual(['mcp__a__ping', 'mcp__b__ping']);
    expect(peakInFlight).toBe(2);
  });

  it('closes already-connected clients when a later server fails to connect', async () => {
    const closed: string[] = [];
    let n = 0;
    const factory = async (server: { name: string }): Promise<McpClientLike> => {
      n++;
      if (n === 2) throw new Error('second server connect failed');
      return { ...fakeClient, async close() { closed.push(server.name); } };
    };
    await expect(
      createMcpPlugin({
        servers: [{ name: 'a', command: 'noop' }, { name: 'b', command: 'noop' }],
        clientFactory: factory,
      }),
    ).rejects.toThrow(/second server connect failed/);
    // The first server's client must have been closed (not leaked), even though
    // we never returned the plugin and so its onShutdown hook was never wired.
    expect(closed).toEqual(['a']);
  });

  it('registers an onShutdown hook that closes all clients', async () => {
    let closed = 0;
    const c: McpClientLike = { ...fakeClient, async close() { closed++; } };
    const plugin = await createMcpPlugin({
      servers: [{ name: 'a', command: 'noop' }, { name: 'b', command: 'noop' }],
      clientFactory: async () => c,
    });
    const hooks = plugin.hooks;
    assertDefined(hooks, 'plugin.hooks registered by createMcpPlugin');
    await hooks.onShutdown?.({} as never);
    expect(closed).toBe(2);
  });
});
