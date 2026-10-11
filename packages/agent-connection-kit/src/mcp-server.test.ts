/**
 * The Moxxy tools MCP server: how a vendor agent (Claude, Codex, OpenCode)
 * calls Moxxy's own tools. The client here is the real MCP SDK client, the
 * same code the agents' MCP support is built on.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { startMoxxyMcpServer, type McpToolHandler, type MoxxyMcpServer } from './mcp-server.js';

const servers: MoxxyMcpServer[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function start(handler?: McpToolHandler): Promise<MoxxyMcpServer> {
  const server = await startMoxxyMcpServer(handler ? { handler } : {});
  servers.push(server);
  return server;
}

async function connect(server: MoxxyMcpServer, authorization = server.authorization): Promise<Client> {
  const client = new Client({ name: 'test-agent', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers: { Authorization: authorization } },
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

const titleTool: McpToolHandler = {
  list: () => [
    {
      name: 'browser_title',
      description: 'Read a page title',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    },
  ],
  call: async (name, args) => ({ content: [{ type: 'text', text: `${name}: ${(args as { url: string }).url}` }] }),
};

describe('the Moxxy tools MCP server', () => {
  it('listens only on this computer', async () => {
    const server = await start();
    expect(new URL(server.url).hostname).toBe('127.0.0.1');
  });

  it('lists the Moxxy tools and runs one for the agent', async () => {
    const client = await connect(await start(titleTool));

    const { tools } = await client.listTools();
    const result = await client.callTool({ name: 'browser_title', arguments: { url: 'https://example.com' } });

    expect(tools.map((t) => t.name)).toEqual(['browser_title']);
    expect(tools[0]?.inputSchema).toMatchObject({ type: 'object', required: ['url'] });
    expect(result.content).toEqual([{ type: 'text', text: 'browser_title: https://example.com' }]);
  });

  it('hands back pictures and failures the way MCP describes them', async () => {
    const client = await connect(
      await start({
        list: () => [{ name: 'shot', description: 'Screenshot', inputSchema: { type: 'object' } }],
        call: async () => ({
          content: [{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }],
          isError: false,
        }),
      }),
    );

    const result = await client.callTool({ name: 'shot', arguments: {} });

    expect(result.content).toEqual([{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }]);
  });

  it('reports a tool that threw as a failed result, so the agent can carry on', async () => {
    const client = await connect(
      await start({
        list: titleTool.list,
        call: async () => {
          throw new Error('the page did not load');
        },
      }),
    );

    const result = await client.callTool({ name: 'browser_title', arguments: { url: 'x' } });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'the page did not load' }]);
  });

  it('refuses a tool it does not have', async () => {
    const client = await connect(await start(titleTool));

    await expect(client.callTool({ name: 'nope', arguments: {} })).rejects.toThrow(/nope/);
  });

  it('follows the conversation to the turn that is running now', async () => {
    const server = await start();
    const client = await connect(server);
    expect((await client.listTools()).tools).toEqual([]);

    server.setHandler(titleTool);

    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(['browser_title']);
  });

  it('tells an agent that keeps the list it read that the turn brought other tools, and waits until it reads them', async () => {
    const server = await start();
    const client = await connect(server);
    const reread = new Promise<string[]>((resolve) =>
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        resolve((await client.listTools()).tools.map((t) => t.name));
      }),
    );
    expect((await client.listTools()).tools).toEqual([]);

    server.setHandler(titleTool);

    expect(await Promise.all([server.announceTools(), reread])).toEqual([true, ['browser_title']]);
  });

  it('tells the agent nothing when it already has the turn tools', async () => {
    const server = await start(titleTool);
    const client = await connect(server);
    let notices = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      notices += 1;
    });
    await client.listTools();

    server.setHandler(undefined);
    server.setHandler({ ...titleTool, call: titleTool.call });

    expect(await server.announceTools()).toBe(true);
    expect(notices).toBe(0);
  });

  it('says so when the agent does not read the new tools in time', async () => {
    const server = await start();
    const auth = { authorization: server.authorization, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    await fetch(server.url, { method: 'POST', headers: auth, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    server.setHandler(titleTool);

    expect(await server.announceTools({ timeoutMs: 50 })).toBe(false);
  });

  it('tells the agent no turn is running when nobody can run the tool', async () => {
    const server = await start(titleTool);
    const client = await connect(server);
    await client.listTools();
    server.setHandler(undefined);

    const result = await client.callTool({ name: 'browser_title', arguments: { url: 'x' } });

    expect(result.isError).toBe(true);
  });

  it('stops a tool when the agent hangs up on the call', async () => {
    let stopped: (() => void) | undefined;
    const wasStopped = new Promise<void>((resolve) => (stopped = resolve));
    let started: (() => void) | undefined;
    const hasStarted = new Promise<void>((resolve) => (started = resolve));
    const server = await start({
      list: titleTool.list,
      call: (_name, _args, signal) =>
        new Promise(() => {
          started?.();
          signal.addEventListener('abort', () => stopped?.());
        }),
    });

    const controller = new AbortController();
    const call = fetch(server.url, {
      method: 'POST',
      headers: { authorization: server.authorization, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'browser_title', arguments: {} } }),
      signal: controller.signal,
    }).catch(() => 'hung up');
    await hasStarted;
    controller.abort();

    expect(await call).toBe('hung up');
    await wasStopped;
  });
});

describe('who may talk to the server', () => {
  const post = (server: MoxxyMcpServer, headers: Record<string, string>, body: unknown = { jsonrpc: '2.0', id: 1, method: 'ping' }) =>
    fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify(body),
    });

  it('turns away a caller without the token', async () => {
    const server = await start(titleTool);

    await expect(connect(server, 'Bearer wrong')).rejects.toThrow();
    expect((await post(server, {})).status).toBe(401);
  });

  it('turns away a web page, which always says where it comes from', async () => {
    const server = await start(titleTool);

    const response = await post(server, { authorization: server.authorization, origin: 'https://evil.example' });

    expect(response.status).toBe(403);
  });

  it('answers pings, accepts notifications, and keeps an event stream open only for notices', async () => {
    const server = await start(titleTool);
    const auth = { authorization: server.authorization };

    const ping = await post(server, auth);
    const note = await post(server, auth, { jsonrpc: '2.0', method: 'notifications/initialized' });
    const hangUp = new AbortController();
    const stream = await fetch(server.url, { headers: { ...auth, accept: 'text/event-stream' }, signal: hangUp.signal });
    const plainGet = await fetch(server.url, { headers: auth });
    const strangerStream = await fetch(server.url, { headers: { accept: 'text/event-stream' } });
    hangUp.abort();

    expect(await ping.json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    expect(note.status).toBe(202);
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toBe('text/event-stream');
    expect(plainGet.status).toBe(405);
    expect(strangerStream.status).toBe(401);
  });

  it('says so for a method it does not know', async () => {
    const server = await start(titleTool);

    const response = await post(server, { authorization: server.authorization }, { jsonrpc: '2.0', id: 7, method: 'server/discover' });

    expect(await response.json()).toMatchObject({ id: 7, error: { code: -32601 } });
  });

  it('turns away an MCP version it does not speak', async () => {
    const server = await start(titleTool);

    const response = await post(server, { authorization: server.authorization, 'mcp-protocol-version': '1999-01-01' });

    expect(response.status).toBe(400);
  });
});
