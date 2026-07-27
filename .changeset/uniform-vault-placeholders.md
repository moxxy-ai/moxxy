---
'@moxxy/cli': patch
---

Resolve `${vault:KEY}` the same way everywhere.

A placeholder in config was always resolved against the local vault, because config loads before any plugin registers. Meanwhile `ctx.getSecret(name)` inside a tool went through whatever `SecretProvider` the machine had active. The same syntax meant two different things, so an organisation that plugged in an external store found it served tools but not config.

The placeholder resolver now takes a lookup function rather than a `VaultStore`, and the session re-resolves config through `session.resolveSecret` once plugins have registered. On a machine with no external provider the result is identical and the extra pass is a no-op walk. Existing callers that pass the vault object keep working.
