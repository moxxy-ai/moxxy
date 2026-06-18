import { describe, expect, it } from 'vitest';
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
    expect(plugin.tools![0]!.name).toBe('mcp__demo__ping');
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
    expect(plugin.tools!.map((t) => t.name)).toEqual(['mcp__a__ping', 'mcp__b__ping']);
  });

  it('connects servers in parallel and bounds boot at the slowest, not the sum (u86-5)', async () => {
    // Two servers whose listTools each take ~50ms. Serial boot would take
    // ~100ms; parallel ~50ms. Assert well under the serial sum and that both
    // tool sets land in server order.
    const slowClient = (name: string): McpClientLike => ({
      async listTools() {
        await new Promise((r) => setTimeout(r, 50));
        return { tools: [{ name: 'ping', description: 'p', inputSchema: { type: 'object' } }] };
      },
      async callTool() {
        return { content: [{ type: 'text', text: `pong ${name}` }] };
      },
      async close() {},
    });
    const start = Date.now();
    const plugin = await createMcpPlugin({
      servers: [{ name: 'a', command: 'noop' }, { name: 'b', command: 'noop' }],
      clientFactory: async (s) => slowClient(s.name),
    });
    const elapsed = Date.now() - start;
    expect(plugin.tools!.map((t) => t.name)).toEqual(['mcp__a__ping', 'mcp__b__ping']);
    expect(elapsed).toBeLessThan(90); // < the ~100ms serial sum
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
    await plugin.hooks?.onShutdown?.({} as never);
    expect(closed).toBe(2);
  });
});
