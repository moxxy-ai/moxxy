---
"@moxxy/cli": patch
"@moxxy/plugin-webhooks": patch
---

Security (audit A4): webhook fires now actually enforce the trigger's `allowedTools`.
The CLI webhook runner runs each fire against a per-fire scoped view of the active
session — a filtered tool registry (the model only sees the listed tools) plus a
wrapping permission resolver whose `check` and prompt-free `policyCheck` deny any tool
outside the list (so the restriction survives goal-mode auto-approve), delegating
allowed calls to the session's normal resolver chain. An empty `allowedTools` keeps the
existing full-tool-set contract; the `webhook_create` description and setup guide now
state exactly what is enforced and that fires run on the active session, not an
isolated one.
