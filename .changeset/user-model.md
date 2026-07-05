---
'@moxxy/plugin-memory': minor
'@moxxy/reflector-default': patch
'@moxxy/cli': patch
---

feat(memory): persistent user model — always-injected `~/.moxxy/memory/user-model.md` + update tool

A first-class user model (Identity / Preferences / Workflows / Context) is now
ALWAYS injected into the system prompt as a delimited `<user-model>` block
(capped at 4000 chars, idempotent per request, error-swallowing). It is updated
only through the deliberate, permission-prompted `memory_update_user_model` tool
— never silently written by the loop. The default reflector now steers durable
user-trait proposals toward this tool, and `moxxy memory user-model` prints the
current file.
