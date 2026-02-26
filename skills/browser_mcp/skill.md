# browser_mcp

MCP-backed browser skill. This initial skeleton proxies a small subset of chrome-devtools MCP tools (new_page, navigate_page, take_screenshot, list_pages) to provide a drop-in replacement for the existing `browser` skill using MCP under the hood.

Usage

- fetch: Lightweight fetch that uses MCP new_page + navigate_page + evaluate script to return page text.
- take_screenshot: Capture a screenshot using chrome-devtools take_screenshot.

Security & permissions

- Requires MCP connection to a chrome-devtools server with page access.
- The skill intentionally implements minimal functionality and should be extended with robust error handling and input validation.
