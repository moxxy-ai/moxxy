# mcp

Use this skill to configure external Model Context Protocol (MCP) servers for the current agent.
Once connected, the agent will dynamically inherit all tools from the MCP server as native skills, prefixed with the server name (e.g. `github_list_issues` for a server named `github`).

You MUST ALWAYS reboot yourself after adding or removing an MCP Server for the changes to apply (using `run_applescript`).

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
1. Use `web_crawler` to fetch the page content
2. Look for the MCP JSON configuration on the page (the `mcpServers` JSON block)
3. Call `mcp add-json` with the extracted JSON config
4. Ask the user for any required API keys or env values before adding

### Note
Adding an MCP server directly expands your own toolset on next reboot.
