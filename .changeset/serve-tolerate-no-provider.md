---
"@moxxy/cli": patch
---

`moxxy serve` now boots even when no provider key is configured.

Previously `serve` activated a provider at startup and exited 1 with `AUTH_NO_CREDENTIALS` when none was found — *before* binding its socket. Clients (notably the desktop app) then looped forever on "lost the runner / reconnecting" and could never connect to add a provider. `serve` now boots with `tolerateNoProvider` (matching `channels` / `login`): it binds the socket with no active provider, and turns fail with a clear "no provider" error until one is configured.
