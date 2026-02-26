# browser_mcp

Skill: browser_mcp — a simple browser skill that proxies requests to an external MCP chrome-devtools server.

Usage:
- fetch <url> — returns HTML of the page by creating a page in the MCP and evaluating document.documentElement.outerHTML.
- navigate <url> — navigates the selected MCP page to the URL.
- screenshot <url> <out> — creates a page, takes a screenshot via MCP, writes base64-decoded image to <out>.

Configuration:
- Set MCP_BASE_URL to the MCP server base URL that accepts chrome-devtools_* endpoints, e.g. https://mcp.example.com/api
- Optionally set MCP_TOKEN for Bearer auth
- TIMEOUT can adjust curl timeout

Notes / Limitations:
- This is a simple shim; it assumes the MCP server exposes POST endpoints matching the chrome-devtools_* names.
- Response formats vary between MCP servers; this implementation attempts to be tolerant but may need adjustments.
- Avoid running untrusted code returned from MCP.

Example:
  MCP_BASE_URL=https://mcp.example.com/api MCP_TOKEN=token ./run.sh fetch https://example.com
