---
'@moxxy/plugin-webhooks': patch
---

Harden the webhook trigger store and keep generated secrets out of model context.

- Fail-safe `webhooks.json` load: a corrupt or schema-mismatched file is preserved aside
  as `webhooks.json.corrupt-<timestamp>` before the store starts empty (so a subsequent
  write can never clobber the only copy of the triggers and their secrets); other read
  errors refuse all reads/writes; individually invalid entries are quarantined to a 0600
  sidecar while valid triggers are kept. The condition is logged and surfaced as
  `storeWarning` in `webhook_list`/`webhook_create`/`webhook_status`.
- `webhook_create` no longer returns generated secrets through the model's context (tool
  results persist in session logs): the result carries `generatedSecret` with a masked
  preview plus the path of an owner-only (0600) file under `~/.moxxy/webhooks-secrets/`
  that the user reads directly; `webhook_delete` cleans the file up.
