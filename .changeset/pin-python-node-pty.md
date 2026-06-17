---
---

ci(release): pin Python 3.11 on the desktop-build runners so node-gyp can compile `node-pty`. Python 3.12 (now the default on `macos-latest`, `ubuntu-24.04`, and `windows-latest`) dropped the `distutils` stdlib module that `node-gyp@9` imports, which broke both `pnpm install` and electron-builder's `@electron/rebuild`. CI-only change — releases no package.
