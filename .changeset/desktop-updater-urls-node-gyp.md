---
"@moxxy/desktop": patch
---

fix(desktop): correct self-update feed asset names + modernise the native build

- **Self-update 404 on macOS and Windows.** `productName` ("MoxxyAI Workspaces") has a space, and with no explicit `artifactName` the mac/win artifacts inherited it. electron-builder wrote that space as a hyphen into `latest-mac.yml`/`latest.yml` while GitHub rewrote it to a dot in the uploaded asset, so electron-updater built a download URL that didn't exist (e.g. `…/desktop-v0.8.0/MoxxyAI-Workspaces-0.8.0-arm64-mac.zip`). Mac and Windows now use a space-free `artifactName` (`moxxy-desktop-*`), matching Linux, so the feed path, the on-disk file, and the GitHub asset name all agree and `app.updateShell` resolves. (Releases ≤ 0.8.0 keep the broken names; this only fixes forward.)
- **node-gyp modernised.** Pinned `node-gyp` to `^11.5.0` via root `pnpm.overrides` (was 9.4.1, which `@electron/rebuild` drives to compile `node-pty`) and removed the CI Python 3.11 pin — node-gyp 11 is Python-3.12-native. The Windows leg stays on `windows-2022` because no released node-gyp detects Visual Studio 2026 yet.
