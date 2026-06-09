import type { McpServerConfig } from '../types.js';

/**
 * Connect-time secret resolution for MCP server credentials.
 *
 * Server entries in ~/.moxxy/mcp.json (and the `mcp_add_server` /
 * `mcp_test_server` tool args) may carry `${vault:NAME}` placeholders in
 * `env` values (stdio) and `headers` values (http/sse). The PLACEHOLDER is
 * what gets persisted; the plaintext secret only ever materializes in the
 * resolved copy handed to the transport at connect time — never in the
 * model's context, never on disk.
 *
 * plugin-mcp deliberately has no vault dependency: setup wires a resolver
 * (the CLI passes the vault's `resolveString`). A resolver MUST pass literal
 * values through unchanged so pre-placeholder configs keep working.
 */
export type McpSecretResolver = (value: string) => Promise<string>;

/**
 * Return a copy of `server` with every `env` / `headers` value passed
 * through `resolver`. With no resolver (or nothing to resolve) the original
 * object is returned untouched — callers rely on that to persist the
 * placeholder form, not the resolved one.
 */
export async function resolveServerSecrets(
  server: McpServerConfig,
  resolver: McpSecretResolver | null | undefined,
): Promise<McpServerConfig> {
  if (!resolver) return server;
  const kind = server.kind ?? 'stdio';
  if (kind === 'http' || kind === 'sse') {
    const httpish = server as Extract<McpServerConfig, { url: string }>;
    if (!httpish.headers) return server;
    const headers = await resolveRecord(httpish.headers, resolver);
    return headers === httpish.headers ? server : { ...httpish, headers };
  }
  const stdio = server as Extract<McpServerConfig, { command: string }>;
  if (!stdio.env) return server;
  const env = await resolveRecord(stdio.env, resolver);
  return env === stdio.env ? server : { ...stdio, env };
}

async function resolveRecord(
  rec: Record<string, string>,
  resolver: McpSecretResolver,
): Promise<Record<string, string>> {
  let changed = false;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(rec)) {
    const resolved = await resolver(value);
    if (resolved !== value) changed = true;
    out[key] = resolved;
  }
  return changed ? out : rec;
}
