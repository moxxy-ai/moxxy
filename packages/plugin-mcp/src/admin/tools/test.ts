import { defineTool, type ToolDef } from '@moxxy/sdk';
import { defaultClientFactory } from '../../client.js';
import { wrapMcpServerTools } from '../../wrap.js';
import { addServerInput, validateAddServerInput } from '../schema.js';

export function buildTestServerTool(): ToolDef {
  return defineTool({
    name: 'mcp_test_server',
    description:
      'Connect to an MCP server WITHOUT saving it to config. Returns the list of tools the ' +
      'server exposes if the connection succeeds, or a connection-error message. Useful for ' +
      'sanity-checking before calling mcp_add_server.',
    inputSchema: addServerInput,
    handler: async (input) => {
      const server = validateAddServerInput(input);
      let client: Awaited<ReturnType<typeof defaultClientFactory>> | null = null;
      try {
        client = await defaultClientFactory(server);
        const wrapped = await wrapMcpServerTools({ server, client });
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
