---
'@moxxy/desktop': patch
---

Fix the plugins-seed bundling script on Windows: resolve the repo root via `fileURLToPath` (the `url.pathname` form produced a doubled drive letter, `D:\D:\a\...`, crashing the desktop release job) and spawn pnpm/npm through the shell so their `.cmd` shims work on Windows runners.
