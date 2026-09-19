---
'@moxxy/sdk': minor
'@moxxy/cli': minor
---

Raise the supported Node floor from 20.10 to 20.19. Node 20.10 through 20.18 are no longer supported; upgrade to Node 20.19 or newer (22.x and 24.x remain supported). The floor moved so the toolchain can take security-patched dependencies that require `node:util.styleText`, which landed in Node 20.12.
