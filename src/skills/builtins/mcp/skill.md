# mcp

Use this skill to configure external Model Context Protocol (MCP) servers for the current agent.
Once connected, the agent will dynamically inherit all tools from the MCP server as native skills, prefixed with the server name (e.g. `github_list_issues` for a server named `github`).

**Naming:** Always use descriptive server names (e.g. `exa`, `github`, `files`). Never use generic names like `default`, `mcp`, or `server`. When adding from a URL config, derive the name from the server purpose (e.g. exa.ai → `exa`, GitHub server → `github`). If the config has a generic key, `add-json` will auto-derive a name from the package/command.

You MUST restart the gateway for changes to apply. Ask the user to run `moxxy gateway restart` or use the dashboard's gateway restart.

### Usage

```bash
# List all connected MCP servers
mcp list

# Add from JSON config (preferred - supports the standard mcpServers format)
mcp add-json '{"mcpServers":{"exa":{"command":"npx","args":["-y","exa-mcp-server"],"env":{"EXA_API_KEY":"your_key"}}}}'

# You can also omit the mcpServers wrapper:
mcp add-json '{"exa":{"command":"npx","args":["-y","exa-mcp-server"],"env":{"EXA_API_KEY":"your_key"}}}'

# Multiple servers at once:
mcp add-json '{"mcpServers":{"exa":{"command":"npx","args":["-y","exa-mcp-server"]},"github":{"command":"npx","args":["-y","@modelcontextprotocol/server-github"]}}}'

# Add manually with positional args (legacy)
mcp add <server_name> <command> <args_string> <env_json>
mcp add "files" "npx" "-y @modelcontextprotocol/server-filesystem /Users/user/Projects" "{}"

# Remove an MCP server
mcp remove <server_name>
```

### Setup from URL

If the user provides a URL for MCP setup (e.g. `https://mcp.exa.ai/mcp`), you should:
1. Use `browser` to fetch the page content (e.g. `browser "fetch" "<url>"`)
2. Look for the MCP JSON configuration on the page (the `mcpServers` JSON block)
3. Call `mcp add-json` with the extracted JSON config
4. Ask the user for any required API keys or env values before adding

### Note
Adding an MCP server directly expands your own toolset after the next gateway restart.
