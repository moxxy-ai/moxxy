---
'@moxxy/core': minor
'@moxxy/cli': patch
---

Make `@moxxy/plugin-provider-admin` discovery-loadable — the first of the "stash a session capability" plugins. `Session.providerAdmin` is now a getter over a published `'providerAdmin'` service (RemoteSession keeps its own field for thin clients), and core publishes a stable `'resolveCredentials'` accessor. The plugin's default export (`providerAdminPlugin`) resolves the `'providers'` registry + `'resolveCredentials'` from `ctx.services` in `onInit` (via a lazy `Proxy` so its tools + stored-provider re-registration run unchanged) and publishes its admin api as `'providerAdmin'` — replacing the host stash + `{ providerRegistry, resolveActiveConfig }` closure. The runner + desktop read `session.providerAdmin` exactly as before.
