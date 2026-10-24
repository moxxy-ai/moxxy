---
'@moxxy/desktop': patch
---

Move to Electron 43.8, the fix for GHSA-jr5w-w6x2-84p9 (Electron no longer trusts the compromised eMudhra intermediate certificates), and pick up body-parser 2.4.0, the fix for GHSA-27r3-jxmh-p828 (trailing bytes after a compressed request body could tie up the server); body-parser reaches Moxxy through the MCP SDK's HTTP server. The zod copy pulled in by eslint-plugin-react-hooks moves to 4.6.6, the fix for GHSA-mrhx-c7xc-m3w5.
