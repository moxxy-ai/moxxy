---
"@moxxy/desktop": patch
---

Quality sweep finalize: desktop side of the @moxxy/sdk ./server subpath split

The desktop main process (ws-bridge + host modules) now imports Node-only SDK
helpers from `@moxxy/sdk/server` rather than the main barrel, matching the
boundary the dep-cruiser `no-node-builtins-in-renderer` rule now enforces. No
behavior change.
