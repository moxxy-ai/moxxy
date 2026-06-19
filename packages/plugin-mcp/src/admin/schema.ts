import { MoxxyError, z } from '@moxxy/sdk';
import type { McpServerConfig } from '../types.js';

export const serverNameSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'name must be slug-like (lowercase letters, digits, hyphens)');

// Flat schema (no discriminated union) so OpenAI's function-calling
// validator accepts it. OpenAI rejects top-level oneOf/anyOf with
// "object schema missing properties"; the model now sees a single
// object with `kind` + every transport-specific field optional, plus
// a runtime guard in the handler that enforces the per-kind required
// set with a readable error.
export const addServerInput = z.object({
  kind: z.enum(['stdio', 'http', 'sse']).describe(
    'Transport kind. "stdio" runs a local executable; "http" and "sse" connect to a remote URL.',
  ),
  name: serverNameSchema,
  // stdio-only fields
  command: z
    .string()
    .min(1)
    .optional()
    .describe('Required when kind="stdio". Executable to spawn (e.g. "npx", "uv", "python").'),
  args: z
    .array(z.string())
    .optional()
    .describe('Optional when kind="stdio". CLI arguments for the executable.'),
  env: z
    .record(z.string())
    .optional()
    .describe(
      'Optional when kind="stdio". Environment variables for the spawned process. ' +
        'Secrets MUST be vault references ("${vault:NAME}", stored via vault_set first), ' +
        'never plaintext — placeholders are resolved at connect time only.',
    ),
  cwd: z
    .string()
    .optional()
    .describe('Optional when kind="stdio". Working directory for the spawned process.'),
  // http/sse-only fields
  url: z
    .string()
    .url()
    // Restrict to http(s): a bare .url() accepts file:, gopher:, ws:, etc.,
    // turning a model-proposed MCP endpoint into an SSRF/file-read surface
    // (e.g. file:///etc/passwd, http://169.254.169.254 metadata). The human
    // permission prompt still gates the add/test, but reject obviously-wrong
    // schemes before any connection is attempted.
    .regex(/^https?:\/\//i, 'url must use the http:// or https:// scheme')
    .optional()
    .describe('Required when kind="http" or "sse". Server URL (http/https only).'),
  headers: z
    .record(z.string())
    .optional()
    .describe(
      'Optional when kind="http" or "sse". HTTP headers (auth, etc). Secrets MUST be ' +
        'vault references ("${vault:NAME}", stored via vault_set first), never plaintext — ' +
        'placeholders are resolved at connect time only.',
    ),
  autoSkill: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'When true (default), auto-write a deterministic usage skill ' +
        '<server-name>-mcp.md into ~/.moxxy/skills/ documenting the ' +
        'tools the server exposes. Pass false if the user explicitly ' +
        'asked for no skill.',
    ),
});

export type AddServerInput = z.infer<typeof addServerInput>;

export function validateAddServerInput(input: AddServerInput): McpServerConfig {
  // autoSkill is consumed by the handler, not by the connection factory —
  // strip it before constructing the McpServerConfig.
  void input.autoSkill;
  if (input.kind === 'stdio') {
    if (!input.command) {
      throw new MoxxyError({
        code: 'CONFIG_INVALID',
        message: 'mcp_add_server: kind="stdio" requires a `command` field (e.g. "npx", "uv", "python").',
      });
    }
    const out: McpServerConfig = {
      kind: 'stdio',
      name: input.name,
      command: input.command,
      ...(input.args ? { args: input.args } : {}),
      ...(input.env ? { env: input.env } : {}),
      ...(input.cwd ? { cwd: input.cwd } : {}),
    };
    return out;
  }
  if (!input.url) {
    throw new MoxxyError({
      code: 'CONFIG_INVALID',
      message: `mcp_add_server: kind="${input.kind}" requires a \`url\` field (the remote MCP endpoint).`,
    });
  }
  return {
    kind: input.kind,
    name: input.name,
    url: input.url,
    ...(input.headers ? { headers: input.headers } : {}),
  };
}
