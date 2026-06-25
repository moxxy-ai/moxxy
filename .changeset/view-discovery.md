---
'@moxxy/cli': patch
---

Convert `@moxxy/plugin-view` to a discovery-loadable default export (`viewPlugin`). The host publishes the shared web-surface ref as the `'viewSurface'` service (the same mutable ref the web channel writes via `publishSurface`), and `viewPlugin` resolves `'viewRenderers'` (active renderer) + `'viewSurface'` from `ctx.services` in `onInit` — typed against minimal inline interfaces so it needs no `@moxxy/core` import — instead of the `{ getRenderer, getSurface }` closure. `present_view` reads both lazily at call time and degrades gracefully when absent. `buildViewPlugin` is kept for direct injection.
