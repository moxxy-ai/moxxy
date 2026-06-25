---
name: verify-desktop-packaged
description: Build and smoke-test a packaged desktop app (electron-builder --dir + launch + WS-bridge check) — use to verify desktop changes survive packaging, not just dev mode.
---

# Verify the desktop, packaged

Dev mode lies: packaged builds resolve modules differently (externalized
workspace deps caused the 0.0.33 boot-crash, A1/PR #126). Any change to
`apps/desktop/electron/*` or a main-process workspace dep needs this.

```sh
pnpm build                                       # whole repo first (turbo)
pnpm --filter @moxxy/desktop run package:dir     # electron-vite build + electron-builder --dir (no installer, fast)
```

Output: `apps/desktop/release/<platform>/` (macOS arm64:
`apps/desktop/release/mac-arm64/MoxxyAI Workspaces.app`).

Launch + smoke (macOS):

```sh
"apps/desktop/release/mac-arm64/MoxxyAI Workspaces.app/Contents/MacOS/MoxxyAI Workspaces" &
# boots clean = no MODULE_NOT_FOUND in the terminal, window renders past splash
```

WS-bridge smoke (the PR #126 verification):

```sh
MOXXY_WS_BRIDGE=1 "apps/desktop/release/mac-arm64/MoxxyAI Workspaces.app/Contents/MacOS/MoxxyAI Workspaces" &
sleep 8 && lsof -nP -iTCP:8765 -sTCP:LISTEN    # bridge must be listening
```

Gotchas:
- New workspace import in `apps/desktop/electron/main/*`? It MUST be either
  in `BUNDLED_WORKSPACE_DEPS` (`apps/desktop/electron.vite.config.ts`) or a
  guarded dynamic `await import()` behind its feature flag — a bare external
  specifier = packaged boot crash AND a poisoned hot-update bundle.
- A prod dep used by `desktop-host` source must be in `dependencies`, not
  devDependencies (A20).
- `.env` with `VITE_CLERK_PUBLISHABLE_KEY` must exist BEFORE the build
  (electron-vite inlines it); `cp apps/desktop/.env.example apps/desktop/.env`
  for a test key.
- Kill the app afterwards; check `<userData>/app/boot-log.json` if boot
  behaved oddly (debug-self-update skill).
