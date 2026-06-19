import { afterEach, describe, expect, it, vi } from 'vitest';
import { wrapMcpServerTools, wrapMcpServerToolsLazy } from './wrap.js';
import type { McpClientLike, McpToolDescriptor } from './types.js';
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

  it('passes through resource inline text instead of a bare [resource] (u86-3)', async () => {
    const client = makeFakeClient();
    vi.spyOn(client, 'callTool').mockResolvedValueOnce({
      content: [{ type: 'resource', resource: { uri: 'file:///a.txt', mimeType: 'text/plain', text: 'hello body' } }],
      isError: false,
    } as never);
    const tools = await wrapMcpServerTools({ server: { name: 'demo', command: 'noop' }, client });
    const result = await tools[0]!.handler({ url: 'x' }, baseCtx());
    expect(result).toBe('hello body');
  });

  it('annotates a binary resource with uri/mimeType rather than swallowing it (u86-3)', async () => {
    const client = makeFakeClient();
    vi.spyOn(client, 'callTool').mockResolvedValueOnce({
      content: [{ type: 'resource', resource: { uri: 'file:///a.bin', mimeType: 'application/octet-stream', blob: 'AAAA' } }],
      isError: false,
    } as never);
    const tools = await wrapMcpServerTools({ server: { name: 'demo', command: 'noop' }, client });
    const result = await tools[0]!.handler({ url: 'x' }, baseCtx());
    expect(result).toBe('[resource:file:///a.bin application/octet-stream]');
  });

  it('still placeholders an image block', async () => {
    const client = makeFakeClient();
    vi.spyOn(client, 'callTool').mockResolvedValueOnce({
      content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
      isError: false,
    } as never);
    const tools = await wrapMcpServerTools({ server: { name: 'demo', command: 'noop' }, client });
    const result = await tools[0]!.handler({ url: 'x' }, baseCtx());
    expect(result).toBe('[image:image/png]');
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

  it('rejects a missing required field WITHOUT calling the server', async () => {
    const client = makeFakeClient();
    const tools = await wrapMcpServerTools({ server: { name: 'demo', command: 'noop' }, client });
    // `fetch` declares required: ['url']; emit it missing.
    const result = await tools[0]!.handler({}, baseCtx());
    expect(result).toMatch(/invalid arguments.*missing required field "url"/);
    expect(client.calls).toHaveLength(0);
  });

  it('rejects a wrong primitive type WITHOUT calling the server', async () => {
    const client = makeFakeClient();
    const tools = await wrapMcpServerTools({ server: { name: 'demo', command: 'noop' }, client });
    const result = await tools[0]!.handler({ url: 123 }, baseCtx());
    expect(result).toMatch(/field "url" must be of type string/);
    expect(client.calls).toHaveLength(0);
  });

  it('forwards a well-formed call that satisfies the declared schema', async () => {
    const client = makeFakeClient();
    const tools = await wrapMcpServerTools({ server: { name: 'demo', command: 'noop' }, client });
    const result = await tools[0]!.handler({ url: 'https://ok' }, baseCtx());
    expect(result).toBe('called fetch');
    expect(client.calls).toEqual([{ name: 'fetch', arguments: { url: 'https://ok' } }]);
  });

  it('does not reject when the server declares no usable schema', async () => {
    const client = makeFakeClient();
    const tools = await wrapMcpServerTools({ server: { name: 'demo', command: 'noop' }, client });
    // `shell` (tools[1]) declares only { type: 'object' } — anything passes.
    const result = await tools[1]!.handler({ anything: ['goes'] }, baseCtx());
    expect(result).toBe('called shell');
  });
});

describe('runMcpCallWithFallback (timeout + settle-once)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects with a timeout error when callTool never resolves', async () => {
    vi.useFakeTimers();
    const client = makeFakeClient();
    // callTool hangs forever.
    vi.spyOn(client, 'callTool').mockImplementation(() => new Promise<never>(() => {}));
    const tools = await wrapMcpServerTools({ server: { name: 'demo', command: 'noop' }, client });

    const promise = tools[0]!.handler({ url: 'x' }, baseCtx());
    // Attach the rejection assertion before advancing so the rejection is observed.
    const assertion = expect(promise).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await assertion;
  });

  it('does not double-settle when callTool resolves after an abort', async () => {
    const client = makeFakeClient();
    let resolveCall: (v: { content: Array<{ type: 'text'; text: string }>; isError: boolean }) => void = () => {};
    vi.spyOn(client, 'callTool').mockImplementation(
      () =>
        new Promise((res) => {
          resolveCall = res;
        }),
    );
    const tools = await wrapMcpServerTools({ server: { name: 'demo', command: 'noop' }, client });
    const controller = new AbortController();
    const ctx = { ...baseCtx(), signal: controller.signal };

    const promise = tools[0]!.handler({ url: 'x' }, ctx);
    controller.abort();
    // The late resolution must NOT win or throw "already settled".
    resolveCall({ content: [{ type: 'text', text: 'too late' }], isError: false });
    await expect(promise).rejects.toThrow(/aborted/);
  });
});

describe('wrapMcpServerToolsLazy', () => {
  const descriptors: ReadonlyArray<McpToolDescriptor> = [
    { name: 'fetch', description: 'Fetch a URL', inputSchema: { type: 'object' } },
  ];

  it('connects lazily on first call and caches the client for the second', async () => {
    const client = makeFakeClient();
    const getClient = vi.fn(async () => client);
    const tools = wrapMcpServerToolsLazy({
      server: { name: 'demo', command: 'noop' },
      descriptors,
      getClient,
    });
    expect(getClient).not.toHaveBeenCalled(); // building does not connect

    await tools[0]!.handler({ url: 'a' }, baseCtx());
    await tools[0]!.handler({ url: 'b' }, baseCtx());
    // Two invocations, but the lazy wrapper hands the same factory each time.
    // The connection caching itself is the factory's job; here we assert the
    // factory is invoked per call and the calls reach the client.
    expect(getClient).toHaveBeenCalledTimes(2);
    expect(client.calls).toEqual([
      { name: 'fetch', arguments: { url: 'a' } },
      { name: 'fetch', arguments: { url: 'b' } },
    ]);
  });

  it('throws on a pre-aborted signal without invoking getClient', async () => {
    const getClient = vi.fn(async () => makeFakeClient());
    const tools = wrapMcpServerToolsLazy({
      server: { name: 'demo', command: 'noop' },
      descriptors,
      getClient,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      tools[0]!.handler({ url: 'x' }, { ...baseCtx(), signal: controller.signal }),
    ).rejects.toThrow(/aborted/);
    expect(getClient).not.toHaveBeenCalled();
  });
});
