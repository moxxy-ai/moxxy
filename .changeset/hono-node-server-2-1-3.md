---
'@moxxy/plugin-mcp': patch
'@moxxy/agent-connection-kit': patch
---

Move @hono/node-server to 2.1.3, the fix for GHSA-rmxm-3fg6-px4f (`serveStatic` decoded the request path twice, so a static path could slip past middleware). It reaches Moxxy through the MCP SDK's HTTP server.
