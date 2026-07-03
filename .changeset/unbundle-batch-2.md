---
'@moxxy/cli': minor
'@moxxy/plugin-plugins-admin': minor
'@moxxy/plugin-view': minor
'@moxxy/plugin-self-update': minor
'@moxxy/plugin-voice-admin': minor
'@moxxy/plugin-provider-admin': minor
'@moxxy/plugin-mcp': minor
---

Slim wave, batch 2: `@moxxy/plugin-view`, `@moxxy/plugin-self-update` and
`@moxxy/plugin-voice-admin` (plugin renamed from `@moxxy/voice-admin` to
match its package) move out of the CLI binary and install on demand.
`@moxxy/plugin-provider-admin` + `@moxxy/plugin-mcp` (entry alias
`@moxxy/plugin-mcp-admin` dropped — the plugin now registers under its
package name) flip publishable as prep but stay bundled until the desktop
seed pack lands: the desktop Settings panels reach them through the
`providerAdmin`/`mcpAdmin` session services on the spawned runner.
self-update's staged-update finalizer stays inlined in the binary (bin.ts
imports it statically); only the registered plugin instance moves out.
