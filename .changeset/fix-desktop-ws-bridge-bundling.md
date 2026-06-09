---
"@moxxy/desktop": patch
---

Fix packaged-app boot crash: bundle `@moxxy/ipc-server-ws` into the main-process output and load it lazily.

PR #120 added a top-level static import of `@moxxy/ipc-server-ws` to the Electron main but never added the package to `BUNDLED_WORKSPACE_DEPS`, so `externalizeDepsPlugin` left a bare specifier in `dist-electron/main/index.js` that cannot resolve in the packaged app (electron-builder ships only `dist`/`dist-electron`, no node_modules). Every packaged 0.0.33 build — and the Tier-1 hot-update bundle built from the same tree — crashed at main-process load with MODULE_NOT_FOUND, which would also have re-poisoned self-update overrides.

Two-layer fix: `@moxxy/ipc-server-ws` is now in `BUNDLED_WORKSPACE_DEPS` (with `ws`'s optional native accelerators `bufferutil`/`utf-8-validate` kept external — `ws` falls back to JS implementations), and the bridge is loaded via a guarded dynamic `import()` only when `MOXXY_WS_BRIDGE=1` (the shell-updater pattern), so the opt-in bridge can never take down boot again. Verified on a real packaged build: boots clean, and with `MOXXY_WS_BRIDGE=1` the bridge listens.
