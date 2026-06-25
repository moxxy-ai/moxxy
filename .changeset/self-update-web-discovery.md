---
'@moxxy/core': minor
'@moxxy/cli': patch
---

Make the last two closure-injected plugins discovery-loadable, completing the onInit refactor wave (all 11 done).

- **self-update** (`selfUpdatePlugin`): core publishes `'pluginHost'` (reload/unload/listSkipped), a live `'registrySnapshot'`, and a writable `'appendEvent'` (the counterpart to the read-only `ctx.log`); the host publishes a `'getPluginOptions'` config accessor. The plugin resolves them in `onInit`. The Tier-2 core-update tools are gated at build on `MOXXY_NO_CORE_UPDATE` (the env the desktop sets to hide them); `allowCoreUpdate`/`repoUrl` prefs resolve at run.
- **web** (`webChannelPlugin`): core publishes `'tunnelProviders'`; the host publishes the shared `'webControls'` ref + `'webDefaultTunnel'`. The plugin resolves those + the existing `'viewSurface'` ref in `onInit` via a lazy `tunnels` object (keeping its tools + boot tunnel-apply hook present). web writes `viewSurface`; the view plugin reads it.
