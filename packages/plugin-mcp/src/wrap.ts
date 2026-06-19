import { z } from 'zod';
import { defineTool, type ToolDef } from '@moxxy/sdk';
import {
  defaultToolNamePrefix,
  type McpClientLike,
  type McpContentBlock,
  type McpServerConfig,
  type McpToolDescriptor,
} from './types.js';

/**
 * Hard cap on a single MCP tool call. The MCP SDK's `callTool` doesn't
 * accept an AbortSignal, so without a timeout a hung server (crashed
 * stdio child, dead websocket, blocked DB query) would hang the agent's
 * tool-use loop indefinitely — leaving a permanent pending dot in the UI
 * with no way to recover without killing moxxy. 5 minutes is enough room
 * for slow operations (image generation, large queries) but bounded.
 */
const MCP_CALL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Race the MCP call against (1) abort and (2) a hard timeout. Whichever
 * settles first wins. If the underlying callTool ever does resolve after
 * we've rejected, its result is silently discarded — the MCP SDK's
 * cleanup is the SDK's problem.
 */
async function runMcpCallWithFallback<T>(
  callPromise: Promise<T>,
  signal: AbortSignal,
  toolName: string,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = (): void => {
      settle(() => reject(new Error(`aborted MCP tool "${toolName}"`)));
    };
    const timer = setTimeout(() => {
      settle(() =>
        reject(new Error(`MCP tool "${toolName}" timed out after ${MCP_CALL_TIMEOUT_MS}ms`)),
      );
    }, MCP_CALL_TIMEOUT_MS);
    signal.addEventListener('abort', onAbort, { once: true });
    callPromise.then(
      (v) => settle(() => resolve(v)),
      (err: unknown) => settle(() => reject(err instanceof Error ? err : new Error(String(err)))),
    );
  });
}

export interface WrapOptions {
  readonly server: McpServerConfig;
  readonly client: McpClientLike;
  readonly toolNamePrefix?: (serverName: string, toolName: string) => string;
}

export async function wrapMcpServerTools(opts: WrapOptions): Promise<ToolDef[]> {
  const prefix = opts.toolNamePrefix ?? defaultToolNamePrefix;
  const list = await opts.client.listTools();
  // Eager path: the connection is already open, so the resolver is a trivial
  // thunk over the live client.
  const resolveClient = (): Promise<McpClientLike> => Promise.resolve(opts.client);
  return list.tools.map((descriptor) =>
    wrapOneMcpTool(descriptor, opts.server.name, resolveClient, prefix),
  );
}

/**
 * Build ToolDefs from CACHED descriptors without an open client. The
 * provided `getClient` factory is invoked the first time any tool runs;
 * the promise is cached so subsequent calls reuse the same connection.
 * Enables instant TUI boot — connections only happen when the model
 * actually invokes a tool from a given MCP server.
 */
export interface WrapLazyOptions {
  readonly server: McpServerConfig;
  readonly descriptors: ReadonlyArray<McpToolDescriptor>;
  readonly getClient: () => Promise<McpClientLike>;
  readonly toolNamePrefix?: (serverName: string, toolName: string) => string;
}

export function wrapMcpServerToolsLazy(opts: WrapLazyOptions): ToolDef[] {
  const prefix = opts.toolNamePrefix ?? defaultToolNamePrefix;
  return opts.descriptors.map((descriptor) =>
    wrapOneMcpTool(descriptor, opts.server.name, opts.getClient, prefix),
  );
}

/**
 * Single tool builder shared by the eager and lazy paths. They differ only in
 * how the client is obtained: the eager path passes a thunk over a live client,
 * the lazy path passes a `getClient` factory that connects on first call (and
 * caches the connection for subsequent calls). Everything else — name, schema,
 * permission, abort checks, the timeout/abort race, and result rendering — is
 * identical, so it lives here once.
 */
function wrapOneMcpTool(
  descriptor: McpToolDescriptor,
  serverName: string,
  resolveClient: () => Promise<McpClientLike>,
  prefix: (s: string, t: string) => string,
): ToolDef {
  const wrappedName = prefix(serverName, descriptor.name);
  return defineTool({
    name: wrappedName,
    description: descriptor.description ?? `MCP tool ${descriptor.name} on server ${serverName}`,
    inputSchema: z.record(z.string(), z.unknown()),
    inputJsonSchema: descriptor.inputSchema ?? { type: 'object' },
    permission: { action: 'prompt' },
    handler: async (input, ctx) => {
      if (ctx.signal.aborted) throw new Error('aborted');
      // The runtime Zod schema is a permissive record (so OpenAI accepts it),
      // so whatever the model emits would otherwise reach the server verbatim.
      // Fail fast with a readable message on an obviously-malformed call
      // (missing required field / wrong primitive type) instead of forwarding
      // garbage that may crash or hang the server (hitting the 5-min timeout).
      const violation = validateAgainstSchema(input, descriptor.inputSchema);
      if (violation) return `[error] invalid arguments for ${descriptor.name}: ${violation}`;
      // For the lazy path this pays the network/spawn cost only on first call
      // (the factory caches its connection); for the eager path it resolves
      // immediately to the already-open client.
      const client = await resolveClient();
      if (ctx.signal.aborted) throw new Error('aborted');
      const result = await runMcpCallWithFallback(
        client.callTool({ name: descriptor.name, arguments: input }),
        ctx.signal,
        wrappedName,
      );
      return renderResult(result.content, result.isError);
    },
  });
}

function renderResult(content: ReadonlyArray<McpContentBlock> | undefined, isError?: boolean): string {
  const parts: string[] = [];
  for (const block of content ?? []) {
    if (block.type === 'text') parts.push(block.text);
    // Images still can't be surfaced through this string-returning handler
    // (rich image passthrough would need the document/image ContentBlock
    // path); keep the placeholder so the model at least knows one exists.
    else if (block.type === 'image') parts.push(`[image:${block.mimeType}]`);
    else if (block.type === 'resource') parts.push(renderResource(block.resource));
  }
  const text = parts.join('\n');
  return isError ? `[error] ${text}` : text;
}

/**
 * Surface an MCP resource block. A text resource (`resource.text`) is the
 * whole point — passing it through stops the model getting a bare
 * `[resource]` for content it could actually read. A binary/blob resource
 * has no text representation here, so we annotate the placeholder with its
 * uri/mimeType rather than swallow it silently.
 */
function renderResource(resource: unknown): string {
  if (resource && typeof resource === 'object') {
    const r = resource as { uri?: unknown; mimeType?: unknown; text?: unknown };
    if (typeof r.text === 'string') return r.text;
    const meta = [
      typeof r.uri === 'string' ? r.uri : null,
      typeof r.mimeType === 'string' ? r.mimeType : null,
    ].filter((v): v is string => v !== null);
    if (meta.length > 0) return `[resource:${meta.join(' ')}]`;
  }
  return `[resource]`;
}

/**
 * Minimal, dependency-free guard for the model's tool input against the
 * server's declared JSON Schema. We deliberately do NOT pull in a full
 * JSON-Schema validator (ajv) — this only enforces the two cheap invariants
 * that catch the common malformed-call cases: (1) every `required` property is
 * present, and (2) any declared top-level primitive `type` matches. Anything
 * the server's schema doesn't constrain (nested shapes, formats, enums) is
 * left to the server, so a usable schema can't reject a structurally-valid
 * call. Returns a human-readable reason on the first violation, or null.
 */
function validateAgainstSchema(input: unknown, schema: unknown): string | null {
  if (!schema || typeof schema !== 'object') return null;
  const s = schema as { type?: unknown; properties?: unknown; required?: unknown };
  // Only validate object schemas — the model always emits an object here.
  if (s.type !== undefined && s.type !== 'object') return null;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return 'expected an object';
  }
  const obj = input as Record<string, unknown>;
  if (Array.isArray(s.required)) {
    for (const key of s.required) {
      if (typeof key === 'string' && !(key in obj)) {
        return `missing required field "${key}"`;
      }
    }
  }
  if (s.properties && typeof s.properties === 'object') {
    const props = s.properties as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      const propSchema = props[key];
      if (!propSchema || typeof propSchema !== 'object') continue;
      const expected = (propSchema as { type?: unknown }).type;
      if (typeof expected !== 'string') continue;
      if (!matchesPrimitiveType(value, expected)) {
        return `field "${key}" must be of type ${expected}`;
      }
    }
  }
  return null;
}

/** True when `value` satisfies a JSON-Schema primitive `type` keyword. */
function matchesPrimitiveType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'null':
      return value === null;
    default:
      // Unknown/unsupported type keyword — don't reject (server decides).
      return true;
  }
}
