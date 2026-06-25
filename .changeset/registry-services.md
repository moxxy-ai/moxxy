---
'@moxxy/sdk': minor
'@moxxy/core': minor
'@moxxy/cli': patch
---

The host now publishes its core registries on the inter-plugin service registry under well-known names (`agents`, `tools`, `providers`, `viewRenderers`, `synthesizers`), and the SDK exposes a minimal `NamedRegistry<T>` view (`get`/`list`/`has`) so a discovery-loaded plugin can resolve one in `onInit` without importing `@moxxy/core`'s concrete registry types.

Two more closure-injected plugins go discovery-loadable on this seam: `@moxxy/plugin-subagents` (`subagentsPlugin` — resolves the `agents` + `tools` registries for `dispatch_agent`'s kind lookup + parent-tool snapshot) and `@moxxy/plugin-voice-admin` (`voiceAdminPlugin` — resolves the `synthesizers` registry for `list_voices`/`set_voice`). Both read the registries lazily at tool-call time and keep their `build*` factories for direct injection. `builtin-entries` uses the default exports.
