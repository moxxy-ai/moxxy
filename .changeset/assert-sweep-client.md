---
'@moxxy/client-core': patch
'@moxxy/client-transport-ws': patch
'@moxxy/client-platform-web': patch
'@moxxy/design-tokens': patch
'@moxxy/ipc-server-ws': patch
'@moxxy/plugin-channel-mobile': patch
'@moxxy/plugin-channel-web': patch
'@moxxy/plugin-channel-http': patch
---

Apply the "guard, don't chain" rule across the client-layer, IPC, and channel packages: replaced non-null assertions (`x!`) and depth-2+ optional chains with single-narrowing guard clauses (`assertDefined`/`invariant` from `@moxxy/sdk`, or local guards where `@moxxy/sdk` is not a dependency). Behavior is preserved — genuinely-optional single `?.` reads and silent absence paths are kept; only impossible-by-construction sites became loud throws. No runtime behavior change intended.
