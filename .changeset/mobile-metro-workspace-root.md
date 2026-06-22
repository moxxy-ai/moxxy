---
'@moxxy/mobile-gateway-app': patch
---

Fix the mobile Metro `workspaceRoot` after the move to `apps/mobile`. It was
`path.resolve(projectRoot, '../../..')`, correct for the old three-deep
`apps/mobile-plugin/mobile` path but now resolving to the directory *above* the
repo. That gave Metro the wrong watch folder and `nodeModulesPaths`, so it
resolved/served the workspace `@moxxy/*` packages incorrectly (e.g. a stale
`@moxxy/client-transport-ws`). Now `../..` → the repo root.
