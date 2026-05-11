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
