import { defineTool, type ToolDef } from '@moxxy/sdk';
import { defaultClientFactory } from '../../client.js';
import { MCP_CONNECT_TIMEOUT_MS, withTimeout } from '../../timeout.js';
import { wrapMcpServerTools } from '../../wrap.js';
import { addServerInput, validateAddServerInput } from '../schema.js';
import { resolveServerSecrets, type McpSecretResolver } from '../secrets.js';

export interface TestServerToolDeps {
  /** Resolves `${vault:NAME}` placeholders in env/header values at connect time. */
  readonly secretResolver?: McpSecretResolver | null;
}

export function buildTestServerTool(deps: TestServerToolDeps = {}): ToolDef {
  return defineTool({
    name: 'mcp_test_server',
    description:
      'Connect to an MCP server WITHOUT saving it to config. Returns the list of tools the ' +
      'server exposes if the connection succeeds, or a connection-error message. Useful for ' +
      'sanity-checking before calling mcp_add_server. Credentials (env/header values) must be ' +
      'vault references, never plaintext: store the secret first via vault_set, then pass ' +
      '"${vault:NAME}" — it is resolved at connect time.',
    inputSchema: addServerInput,
    // Mirrors mcp_add_server: a stdio server is an arbitrary local
    // executable we spawn, so gate behind a prompt rather than running
    // unknown commands silently.
    permission: { action: 'prompt' },
    // Honest capability surface modeled on the Bash tool: for kind="stdio"
    // this spawns a child process the user named (subprocess + broad fs,
    // since the command can touch anything it likes); for http/sse it
    // makes an outbound connection to an arbitrary URL (net: any). Advisory
    // until @moxxy/plugin-security is enabled, then enforced at call time.
    isolation: {
      required: 'inproc',
      capabilities: {
        subprocess: true,
        fs: { read: ['$cwd/**', '/tmp/**'], write: ['$cwd/**', '/tmp/**'] },
        net: { mode: 'any' },
        env: ['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'TERM'],
        timeMs: 600_000,
      },
    },
    handler: async (input) => {
      const server = validateAddServerInput(input);
      let client: Awaited<ReturnType<typeof defaultClientFactory>> | null = null;
      try {
        // Bound the connect + listTools handshake so a wedged / unreachable
        // server surfaces as a readable connection error instead of hanging
        // this tool call forever (defaultClientFactory + listTools take no
        // AbortSignal). On timeout the inner `connect` may still resolve a
        // client after we've rejected; the finally{} below closes whatever
        // `client` we captured, so a late-opening handle isn't leaked.
        client = await withTimeout(
          defaultClientFactory(await resolveServerSecrets(server, deps.secretResolver ?? null)),
          MCP_CONNECT_TIMEOUT_MS,
          `MCP connect "${server.name}"`,
        );
        const wrapped = await withTimeout(
          wrapMcpServerTools({ server, client }),
          MCP_CONNECT_TIMEOUT_MS,
          `MCP listTools "${server.name}"`,
        );
        return {
          ok: true,
          name: server.name,
          tools: wrapped.map((t) => ({ name: t.name, description: t.description })),
        };
      } catch (err) {
        return {
          ok: false,
          name: server.name,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        if (client) {
          try {
            await client.close();
          } catch {
            /* ignore */
          }
        }
      }
    },
  });
}
