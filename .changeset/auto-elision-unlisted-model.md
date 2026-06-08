---
"@moxxy/sdk": patch
"@moxxy/cli": patch
---

Fix auto-compaction and auto-elision silently disabling on unrecognised model
ids — the agent could grow its context unbounded and lose earlier context.

`runCompactionIfNeeded` and `runElisionIfNeeded` resolved the model's context
window via an exact `provider.models.find(m => m.id === ctx.model)` and bailed
to a permanent no-op when it missed. But `config.model` is a free-form string
and providers serve ids that aren't in their fixed descriptor list (a newer
release like `claude-opus-4-8`, a dated id, or a runtime provider-admin model),
so any such id turned BOTH context-management features off for the whole
session. A shared `resolveModelContext` now falls back to the provider's first
descriptor — exactly what the TUI context meter already did — so compaction and
elision stay active on unlisted ids. The reactive overflow recovery
(`runCompactionIfNeeded(ctx, { force: true })`) also now runs even when no
window can be resolved at all, so an over-context turn compacts-and-retries
instead of dying.
