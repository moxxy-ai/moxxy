---
'@moxxy/cli': patch
---

Cut two vendor SDKs out of the published binary: 5.81 MB to 3.93 MB (-32%).

Neither was imported on purpose. Reading the string helper `providerApiKeyName` from `@moxxy/plugin-provider-admin` also loaded its factory and with it the ~1 MB `openai` SDK; reading `~/.moxxy/mcp.json` through `@moxxy/plugin-mcp`'s barrel loaded `@modelcontextprotocol/sdk` and its `ajv` dependency. Together that was 1.9 MB, a third of the binary, for two config helpers.

Both helpers already lived in clean leaf modules, so they are now exported as subpaths (`@moxxy/plugin-provider-admin/key-name`, `@moxxy/plugin-mcp/config-io`) and the CLI and TUI import those instead of the package barrels.

The build now fails if either SDK reappears. That check lives in the tsup config rather than in dependency-cruiser: cross-package imports in this workspace resolve to `dist/`, which the dep-cruiser config excludes, so a rule there would silently pass forever.
