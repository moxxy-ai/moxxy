---
'@moxxy/plugin-provider-admin': patch
---

Security: `provider_test` no longer takes the plaintext API key as model-visible tool input. It now takes the NAME of a vault secret (`keyName`, e.g. `DEEPSEEK_API_KEY`) and resolves the key at call time via `ctx.getSecret`, so the plaintext never enters the model context, the session log, or the desktop NDJSON log. Missing-secret and no-vault cases return actionable guidance (`/vault set <NAME> <key>`); the add-provider skill and `provider_add`'s returned note were updated to route endpoint verification through the vault name.
