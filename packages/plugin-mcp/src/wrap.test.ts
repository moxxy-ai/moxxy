import { describe, expect, it, vi } from 'vitest';
import { wrapMcpServerTools } from './wrap.js';
import type { McpClientLike } from './types.js';
import { asSessionId, asToolCallId, asTurnId } from '@moxxy/sdk';

const baseCtx = () => ({
  sessionId: asSessionId('s'),
  turnId: asTurnId('t'),
  callId: asToolCallId('c'),
  cwd: '/tmp',
  signal: new AbortController().signal,
  log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
});

const makeFakeClient = (): McpClientLike & { calls: Array<{ name: string; arguments: unknown }> } => {
  const calls: Array<{ name: string; arguments: unknown }> = [];
  return {
    calls,
    async listTools() {
      return {
        tools: [
          {
            name: 'fetch',
            description: 'Fetch a URL',
            inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
          },
          {
            name: 'shell',
            description: undefined,
            inputSchema: { type: 'object' },
          },
        ],
      };
    },
    async callTool(args) {
      calls.push(args);
      return {
        content: [{ type: 'text', text: `called ${args.name}` }],
        isError: false,
      };
    },
    async close() {},
  };
};

describe('wrapMcpServerTools', () => {
  it('wraps each MCP tool with the default prefix and preserves JSON schema', async () => {
    const client = makeFakeClient();
    const tools = await wrapMcpServerTools({
      server: { name: 'demo', command: 'noop' },
      client,
    });
    expect(tools).toHaveLength(2);
    expect(tools[0]!.name).toBe('mcp__demo__fetch');
    expect(tools[0]!.description).toBe('Fetch a URL');
    expect(tools[0]!.inputJsonSchema).toEqual({
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    });
    expect(tools[1]!.name).toBe('mcp__demo__shell');
    expect(tools[1]!.description).toContain('shell');
  });

  it('routes tool invocations through callTool and stringifies the content', async () => {
    const client = makeFakeClient();
    const tools = await wrapMcpServerTools({
      server: { name: 'demo', command: 'noop' },
      client,
    });
    const result = await tools[0]!.handler({ url: 'https://x' }, baseCtx());
    expect(result).toBe('called fetch');
    expect(client.calls).toEqual([{ name: 'fetch', arguments: { url: 'https://x' } }]);
  });

  it('formats isError results with [error] prefix', async () => {
    const client = makeFakeClient();
    vi.spyOn(client, 'callTool').mockResolvedValueOnce({
      content: [{ type: 'text', text: 'no permission' }],
      isError: true,
    });
    const tools = await wrapMcpServerTools({
      server: { name: 'demo', command: 'noop' },
      client,
    });
    const result = await tools[0]!.handler({ url: 'https://x' }, baseCtx());
    expect(result).toBe('[error] no permission');
  });

  it('honors a custom tool-name prefix', async () => {
    const client = makeFakeClient();
    const tools = await wrapMcpServerTools({
      server: { name: 'demo', command: 'noop' },
      client,
      toolNamePrefix: (s, t) => `x_${s}_${t}`,
    });
    expect(tools[0]!.name).toBe('x_demo_fetch');
  });

  it('aborts when ctx.signal is fired', async () => {
    const client = makeFakeClient();
    const tools = await wrapMcpServerTools({
      server: { name: 'demo', command: 'noop' },
      client,
    });
    const controller = new AbortController();
    const ctx = { ...baseCtx(), signal: controller.signal };
    controller.abort();
    await expect(tools[0]!.handler({ url: 'x' }, ctx)).rejects.toThrow(/aborted/);
  });
});
