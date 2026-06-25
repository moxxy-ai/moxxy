---
'@moxxy/sdk': minor
'@moxxy/core': minor
'@moxxy/cli': patch
---

Inter-plugin service registry (`AppContext.services`) — plugins publish a named service in `onInit` and consume siblings' services in theirs, requirements-ordered so the provider runs first. This decouples cross-plugin dependencies from the host's `build*({ deps })` constructor wiring, letting a plugin be discovery-loaded (default-exported) instead of hand-built by the orchestrator.

The vault plugin now publishes its secret store (`services.register('vault', vault)`), and `@moxxy/plugin-oauth` is the first consumer to go discovery-loadable: the default-exported `oauthPlugin` resolves the vault from `ctx.services.require('vault')` in `onInit` (declaring `@moxxy/plugin-vault` as a requirement for ordering), so it no longer needs the `{ vault }` closure. `buildOauthPlugin` is kept for direct injection.

Since plugin `onInit` already runs with full in-process privileges (the security isolation wraps tool execution, not plugin code), this doesn't widen the effective trust surface.
