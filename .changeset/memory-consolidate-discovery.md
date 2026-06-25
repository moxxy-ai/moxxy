---
'@moxxy/cli': patch
---

Convert `@moxxy/memory-consolidate` to a discovery-loadable default export (`memoryConsolidatePlugin`). The memory plugin now publishes its long-term store on the inter-plugin service registry (`services.register('memory', store)`), and memory-consolidate resolves both that store and the active provider (via the published `'providers'` registry) from `ctx.services` in `onInit` — typed against a minimal inline interface so it needs no `@moxxy/core` import — instead of the `(store, getProvider)` closure. The `buildMemoryConsolidatePlugin` factory is kept for direct injection; `builtin-entries` uses the default export.
