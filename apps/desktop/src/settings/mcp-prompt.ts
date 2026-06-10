/**
 * Prompt template for the "Add MCP server" agent flow — wraps the user's
 * free-text description in an instruction that drives the runner's MCP admin
 * tools (mcp_test_server → mcp_add_server) with the vault rules baked in.
 */
export const MCP_PROMPT_TEMPLATE = (description: string): string => `You are
setting up a new MCP (Model Context Protocol) server for the user, using the
MCP admin tools.

1. Derive the server config from the description below. Use kind "stdio"
   for local packages — command "npx" with args ["-y", "<package>"] for npm
   packages, or "uvx" for Python ones — and kind "http" or "sse" for remote
   URLs. Pick a short slug-like name.
2. NEVER put API keys or tokens in plaintext env/header values. If the user
   supplied a secret, store it first with vault_set, then reference it as
   "\${vault:NAME}". If a required secret is missing, stop and ask for it
   instead of guessing.
3. Verify connectivity with mcp_test_server first, then persist with
   mcp_add_server.

Finish with a single short line confirming what was added (server name +
transport), or a single clear question if you are blocked. No code fences,
no long explanations.

USER DESCRIPTION:
${description}`.trim();
