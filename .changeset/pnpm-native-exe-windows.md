---
'@moxxy/sdk': patch
---

On Windows, Moxxy runs pnpm 11 and later when it was installed with npm. That pnpm ships a native `pnpm.exe` behind its `pnpm.cmd`, with no JavaScript file beside it, and Moxxy refused it with "Cannot resolve pnpm JavaScript entry beside Windows shim". Moxxy now runs that `pnpm.exe` directly, still without a shell.
