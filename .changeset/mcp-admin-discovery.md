---
'@moxxy/core': minor
'@moxxy/cli': patch
---

Make `@moxxy/plugin-mcp` discovery-loadable — the second "stash a session capability" plugin. `Session.mcpAdmin` is now a getter over a published `'mcpAdmin'` service, core publishes its `'skills'` registry, and the vault plugin additionally publishes a `'resolveSecrets'` accessor (a `${vault:NAME}`-placeholder resolver) so mcp can resolve secrets without depending on `@moxxy/plugin-vault`. The plugin's default export (`mcpAdminPlugin`) resolves `'tools'` + `'skills'` + `'resolveSecrets'` from `ctx.services` in `onInit` (via lazy `Proxy`s), then publishes its runtime control api as `'mcpAdmin'` — replacing the host stash + `{ toolRegistry, skillRegistry, secretResolver }` closure. `userSkillsDir` defaults to `~/.moxxy/skills`. The runner's mcp handlers + the desktop read `session.mcpAdmin` exactly as before.
