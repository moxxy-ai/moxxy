/**
 * Default MCP client factory + transport setup. Lives in its own module so
 * both `index.ts` (the public surface) and `admin.ts` (the runtime
 * admin/hot-attach tools) can pull `defaultClientFactory` without the two
 * referencing each other — which is what would otherwise create the
 * `admin.ts → index.ts → admin.ts` import cycle.
 */

import type {
  McpCallResult,
  McpClientLike,
  McpContentBlock,
  McpPluginOptions,
  McpServerConfig,
  McpToolDescriptor,
} from './types.js';

export async function defaultClientFactory(
  server: McpServerConfig,
  options: McpPluginOptions = { servers: [] },
): Promise<McpClientLike> {
  const { Client } = (await import('@modelcontextprotocol/sdk/client/index.js')) as {
    Client: new (info: { name: string; version: string }, capabilities: { capabilities: Record<string, unknown> }) => McpClientUntyped;
  };
  // Type the SDK boundary ONCE here; the rest of the factory works against the
  // typed `McpClientUntyped` so a signature change in the SDK surfaces as a
  // compile error rather than being papered over by per-call casts.
  const client: McpClientUntyped = new Client(
    { name: options.clientName ?? 'moxxy', version: options.clientVersion ?? '0.0.0' },
    { capabilities: {} },
  );

  const transport = await createTransport(server);
  await client.connect(transport);

  return {
    async listTools() {
      const result = await client.listTools();
      return { tools: (result.tools ?? []).map(toToolDescriptor) };
    },
    async callTool(args) {
      const result = await client.callTool(args);
      const out: McpCallResult = {
        content: result.content?.map(toContentBlock),
        isError: result.isError,
      };
      return out;
    },
    async close() {
      await client.close();
    },
  };
}

/** Narrow one SDK tool entry to our internal descriptor at the single boundary. */
function toToolDescriptor(t: { name: string; description?: string; inputSchema: unknown }): McpToolDescriptor {
  return t;
}

/** Narrow one SDK content block to our internal union at the single boundary. */
function toContentBlock(block: { type: string } & Record<string, unknown>): McpContentBlock {
  return block as McpContentBlock;
}

interface McpClientUntyped {
  connect(transport: unknown): Promise<void>;
  listTools(): Promise<{ tools?: Array<{ name: string; description?: string; inputSchema: unknown }> }>;
  callTool(args: {
    name: string;
    arguments: unknown;
  }): Promise<{ content?: Array<{ type: string } & Record<string, unknown>>; isError?: boolean }>;
  close(): Promise<void>;
}

async function createTransport(server: McpServerConfig): Promise<unknown> {
  const kind: 'stdio' | 'sse' | 'http' = server.kind ?? 'stdio';
  if (kind === 'stdio') {
    const stdioServer = server as { command: string; args?: ReadonlyArray<string>; env?: Record<string, string>; cwd?: string };
    const { StdioClientTransport } = (await import('@modelcontextprotocol/sdk/client/stdio.js')) as {
      StdioClientTransport: new (config: {
        command: string;
        args?: string[];
        env?: Record<string, string>;
        cwd?: string;
        stderr?: 'inherit' | 'pipe' | 'ignore' | 'overlapped' | number;
      }) => unknown;
    };
    // Set stderr to 'ignore' so spawned subprocesses (mcp-remote, etc.)
    // don't dump their boot logs into the moxxy TUI. The SDK defaults
    // to 'inherit' which clobbers the chat with proxy-status lines on
    // every boot. Set MOXXY_MCP_STDERR=inherit to opt back in for
    // debugging.
    const stderrMode: 'inherit' | 'ignore' =
      process.env.MOXXY_MCP_STDERR === 'inherit' ? 'inherit' : 'ignore';
    return new StdioClientTransport({
      command: stdioServer.command,
      args: stdioServer.args ? [...stdioServer.args] : undefined,
      env: stdioServer.env,
      cwd: stdioServer.cwd,
      stderr: stderrMode,
    });
  }
  const httpish = server as { url: string; headers?: Record<string, string> };
  if (kind === 'sse') {
    const { SSEClientTransport } = (await import('@modelcontextprotocol/sdk/client/sse.js')) as {
      SSEClientTransport: new (url: URL, opts?: { requestInit?: { headers?: Record<string, string> } }) => unknown;
    };
    return new SSEClientTransport(new URL(httpish.url), {
      requestInit: httpish.headers ? { headers: httpish.headers } : undefined,
    });
  }
  const { StreamableHTTPClientTransport } = (await import(
    '@modelcontextprotocol/sdk/client/streamableHttp.js'
  )) as {
    StreamableHTTPClientTransport: new (url: URL, opts?: { requestInit?: { headers?: Record<string, string> } }) => unknown;
  };
  return new StreamableHTTPClientTransport(new URL(httpish.url), {
    requestInit: httpish.headers ? { headers: httpish.headers } : undefined,
  });
}
