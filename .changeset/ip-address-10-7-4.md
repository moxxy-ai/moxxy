---
'@moxxy/desktop': patch
---

Pick up ip-address 10.7.4, the fix for GHSA-rxp7-6hxx-x8q5 (a long IPv6 zone identifier matched in quadratic time); it reaches Moxxy through the MCP SDK's rate limiter. The dependency audit drops its acceptance of sprintf-js GHSA-hp3w-g68c-fv3c, which GitHub has withdrawn.
