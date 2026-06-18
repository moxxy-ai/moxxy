---
'@moxxy/cli': minor
'@moxxy/desktop': minor
---

Wire the desktop Providers reasoning-effort selector live: it now maps onto the runner's `config.context.reasoning` instead of dead-ending in localStorage. Adds a `session.setReasoning` runner protocol method (v9) + a `settings.setReasoning` IPC command, surfaces `supportsReasoning` on `ProviderEntry` (derived from the runner's model catalog) so the selector only renders where it's honored, and removes the unchecked `(p as { supportsReasoning? })` cast.
