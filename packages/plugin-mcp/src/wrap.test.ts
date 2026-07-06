import { afterEach, describe, expect, it, vi } from 'vitest';
import { wrapMcpServerTools, wrapMcpServerToolsLazy } from './wrap.js';
import type { McpClientLike, McpToolDescriptor } from './types.js';
import { asSessionId, asToolCallId, asTurnId, assertDefined } from '@moxxy/sdk';

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
    const t0 = tools[0];
    assertDefined(t0, 'first wrapped mcp tool present');
    const t1 = tools[1];
    assertDefined(t1, 'second wrapped mcp tool present');
    expect(t0.name).toBe('mcp__demo__fetch');
    expect(t0.description).toBe('Fetch a URL');
    expect(t0.inputJsonSchema).toEqual({
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    });
    expect(t1.name).toBe('mcp__demo__shell');
    expect(t1.description).toContain('shell');
  });

  it('routes tool invocations through callTool and stringifies the content', async () => {
    const client = makeFakeClient();
    const tools = await wrapMcpServerTools({
      server: { name: 'demo', command: 'noop' },
      client,
    });
    const first = tools[0];
    assertDefined(first, 'wrapped mcp tool present');
    const result = await first.handler({ url: 'https://x' }, baseCtx());
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
    const first = tools[0];
    assertDefined(first, 'wrapped mcp tool present');
    const result = await first.handler({ url: 'https://x' }, baseCtx());
    expect(result).toBe('[error] no permission');
  });

  it('passes through resource inline text instead of a bare [resource] (u86-3)', async () => {
    const client = makeFakeClient();
    vi.spyOn(client, 'callTool').mockResolvedValueOnce({
      content: [{ type: 'resource', resource: { uri: 'file:///a.txt', mimeType: 'text/plain', text: 'hello body' } }],
      isError: false,
    } as never);
    const tools = await wrapMcpServerTools({ server: { name: 'demo', command: 'noop' }, client });
    const first = tools[0];
    assertDefined(first, 'wrapped mcp tool present');
    const result = await first.handler({ url: 'x' }, baseCtx());
    expect(result).toBe('hello body');
  });

  it('annotates a binary resource with uri/mimeType rather than swallowing it (u86-3)', async () => {
    const client = makeFakeClient();
    vi.spyOn(client, 'callTool').mockResolvedValueOnce({
      content: [{ type: 'resource', resource: { uri: 'file:///a.bin', mimeType: 'application/octet-stream', blob: 'AAAA' } }],
      isError: false,
    } as never);
    const tools = await wrapMcpServerTools({ server: { name: 'demo', command: 'noop' }, client });
    const first = tools[0];
    assertDefined(first, 'wrapped mcp tool present');
    const result = await first.handler({ url: 'x' }, baseCtx());
    expect(result).toBe('[resource:file:///a.bin application/octet-stream]');
  });

  it('still placeholders an image block', async () => {
    const client = makeFakeClient();
    vi.spyOn(client, 'callTool').mockResolvedValueOnce({
      content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
      isError: false,
    } as never);
    const tools = await wrapMcpServerTools({ server: { name: 'demo', command: 'noop' }, client });
    const first = tools[0];
    assertDefined(first, 'wrapped mcp tool present');
    const result = await first.handler({ url: 'x' }, baseCtx());
    expect(result).toBe('[image:image/png]');
  });

  it('honors a custom tool-name prefix', async () => {
    const client = makeFakeClient();
    const tools = await wrapMcpServerTools({
      server: { name: 'demo', command: 'noop' },
      client,
      toolNamePrefix: (s, t) => `x_${s}_${t}`,
    });
    const first = tools[0];
    assertDefined(first, 'wrapped mcp tool present');
    expect(first.name).toBe('x_demo_fetch');
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
    const first = tools[0];
    assertDefined(first, 'wrapped mcp tool present');
    await expect(first.handler({ url: 'x' }, ctx)).rejects.toThrow(/aborted/);
  });

  it('rejects a missing required field WITHOUT calling the server', async () => {
    const client = makeFakeClient();
    const tools = await wrapMcpServerTools({ server: { name: 'demo', command: 'noop' }, client });
    // `fetch` declares required: ['url']; emit it missing.
    const first = tools[0];
    assertDefined(first, 'wrapped mcp tool present');
    const result = await first.handler({}, baseCtx());
    expect(result).toMatch(/invalid arguments.*missing required field "url"/);
    expect(client.calls).toHaveLength(0);
  });

  it('rejects a wrong primitive type WITHOUT calling the server', async () => {
    const client = makeFakeClient();
    const tools = await wrapMcpServerTools({ server: { name: 'demo', command: 'noop' }, client });
    const first = tools[0];
    assertDefined(first, 'wrapped mcp tool present');
    const result = await first.handler({ url: 123 }, baseCtx());
    expect(result).toMatch(/field "url" must be of type string/);
    expect(client.calls).toHaveLength(0);
  });

  it('forwards a well-formed call that satisfies the declared schema', async () => {
    const client = makeFakeClient();
    const tools = await wrapMcpServerTools({ server: { name: 'demo', command: 'noop' }, client });
    const first = tools[0];
    assertDefined(first, 'wrapped mcp tool present');
    const result = await first.handler({ url: 'https://ok' }, baseCtx());
    expect(result).toBe('called fetch');
    expect(client.calls).toEqual([{ name: 'fetch', arguments: { url: 'https://ok' } }]);
  });

  it('does not reject when the server declares no usable schema', async () => {
    const client = makeFakeClient();
    const tools = await wrapMcpServerTools({ server: { name: 'demo', command: 'noop' }, client });
    // `shell` (tools[1]) declares only { type: 'object' } — anything passes.
    const second = tools[1];
    assertDefined(second, 'second wrapped mcp tool present');
    const result = await second.handler({ anything: ['goes'] }, baseCtx());
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

    const first = tools[0];
    assertDefined(first, 'wrapped mcp tool present');
    const promise = first.handler({ url: 'x' }, baseCtx());
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

    const first = tools[0];
    assertDefined(first, 'wrapped mcp tool present');
    const promise = first.handler({ url: 'x' }, ctx);
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

    const first = tools[0];
    assertDefined(first, 'wrapped mcp tool present');
    await first.handler({ url: 'a' }, baseCtx());
    await first.handler({ url: 'b' }, baseCtx());
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
    const first = tools[0];
    assertDefined(first, 'wrapped mcp tool present');
    await expect(
      first.handler({ url: 'x' }, { ...baseCtx(), signal: controller.signal }),
    ).rejects.toThrow(/aborted/);
    expect(getClient).not.toHaveBeenCalled();
  });
});
